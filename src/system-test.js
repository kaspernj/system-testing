// @ts-check

import {Builder, By} from "selenium-webdriver"
import chrome from "selenium-webdriver/chrome.js"
import {digg} from "diggerize"
import fs from "node:fs/promises"
import logging from "selenium-webdriver/lib/logging.js"
import moment from "moment"
import {prettify} from "htmlfy"
import Server from "scoundrel-remote-eval/src/server/index.js"
import ServerWebSocket from "scoundrel-remote-eval/src/server/connections/web-socket/index.js"
import SystemTestCommunicator from "./system-test-communicator.js"
import SystemTestHttpServer from "./system-test-http-server.js"
import {wait, waitFor} from "awaitery"
import {WebSocketServer} from "ws"

class ElementNotFoundError extends Error { }

/** @type {{systemTest: SystemTest | null}} */
const shared = {
  systemTest: null
}

export default class SystemTest {
  static rootPath = "/blank?systemTest=true"

  /** @type {SystemTestCommunicator | undefined} */
  communicator = undefined

  /** @type {import("selenium-webdriver").WebDriver | undefined} */
  driver = undefined

  _started = false
  _timeouts = 5000

  /**
   * Gets the current system test instance
   * @param {object} [args]
   * @param {string} [args.host]
   * @param {number} [args.port]
   * @returns {SystemTest}
   */
  static current(args) {
    if (!globalThis.systemTest) {
      globalThis.systemTest = new SystemTest(args)
    }

    return globalThis.systemTest
  }

  getCommunicator() {
    if (!this.communicator) {
      throw new Error("Communicator hasn't been initialized yet")
    }

    return this.communicator
  }

  /**
   * Runs a system test
   * @param {function(SystemTest): Promise<void>} callback
   * @returns {Promise<void>}
   */
  static async run(callback) {
    const systemTest = this.current()

    await systemTest.getCommunicator().sendCommand({type: "initialize"})
    await systemTest.dismissTo(SystemTest.rootPath)

    try {
      await systemTest.findByTestID("blankText", {useBaseSelector: false})
      await callback(systemTest)
    } catch (error) {
      await systemTest.takeScreenshot()

      throw error
    }
  }

  /**
   * Creates a new SystemTest instance
   * @param {object} [args]
   * @param {string} [args.host]
   * @param {number} [args.port]
   */
  constructor({host = "localhost", port = 8081, ...restArgs} = {host: "localhost", port: 8081}) {
    const restArgsKeys = Object.keys(restArgs)

    if (restArgsKeys.length > 0) {
      throw new Error(`Unknown arguments: ${restArgsKeys.join(", ")}`)
    }

    this._host = host
    this._port = port

    /** @type {Record<number, object>} */
    this._responses = {}

    this._sendCount = 0
    this.startScoundrel()
    this.communicator = new SystemTestCommunicator({onCommand: this.onCommandReceived})
  }

  /**
   * Gets the base selector for scoping element searches
   * @returns {string | undefined}
   */
  getBaseSelector() { return this._baseSelector }

  /**
   * @returns {import("selenium-webdriver").WebDriver}
   */
  getDriver() {
    if (!this) throw new Error("No this?")
    if (!this.driver) throw new Error("Driver hasn't been initialized yet")

    return this.driver
  }

  /**
   * Sets the base selector for scoping element searches
   * @param {string} baseSelector
   */
  setBaseSelector(baseSelector) { this._baseSelector = baseSelector }

  /**
   * Gets a selector scoped to the base selector
   * @param {string} selector
   * @returns {string}
   */
  getSelector(selector) {
    return this.getBaseSelector() ? `${this.getBaseSelector()} ${selector}` : selector
  }

  /**
   * Starts Scoundrel server which the browser connects to for remote evaluation in the browser
   * @returns {void}
   */
  startScoundrel() {
    if (this.wss) throw new Error("Scoundrel server already started")

    this.wss = new WebSocketServer({port: 8090})
    this.serverWebSocket = new ServerWebSocket(this.wss)
    this.server = new Server(this.serverWebSocket)
  }

  /**
   * @returns {void}
   */
  stopScoundrel() {
    this.server?.close()
    this.wss?.close()
  }

  /**
   * Finds all elements by CSS selector
   * @param {string} selector
   * @param {object} args
   * @param {boolean} [args.visible]
   * @param {boolean} [args.useBaseSelector]
   * @returns {Promise<import("selenium-webdriver").WebElement[]>}
   */
  async all(selector, args = {}) {
    const {visible = true, useBaseSelector = true, ...restArgs} = args
    const restArgsKeys = Object.keys(restArgs)

    if (restArgsKeys.length > 0) throw new Error(`Unknown arguments: ${restArgsKeys.join(", ")}`)

    const actualSelector = useBaseSelector ? this.getSelector(selector) : selector

    let elements = []

    await this.getDriver().wait(async () => {
      elements = await this.getDriver().findElements(By.css(actualSelector))

      return elements.length > 0
    }, this.getTimeouts())

    const activeElements = []

    for (const element of elements) {
      let keep = true

      if (visible === true || visible === false) {
        const isDisplayed = await element.isDisplayed()

        if (visible && !isDisplayed) keep = false
        if (!visible && isDisplayed) keep = false
      }

      if (keep) activeElements.push(element)
    }

    return activeElements
  }

  /**
   * Clicks an element that has children which fills out the element and would otherwise have caused a ElementClickInterceptedError
   * @param {string|import("selenium-webdriver").WebElement} elementOrIdentifier
   * @returns {Promise<void>}
   */
  async click(elementOrIdentifier) {
    let tries = 0

    while (true) {
      tries++

      try {
        const element = await this._findElement(elementOrIdentifier)
        const actions = this.getDriver().actions({async: true})

        await actions.move({origin: element}).click().perform()
        break
      } catch (error) {
        if (error instanceof Error) {
          if (error.constructor.name === "ElementNotInteractableError") {
            if (tries >= 3) {
              throw new Error(`Element ${elementOrIdentifier.constructor.name} click failed after ${tries} tries - ${error.constructor.name}: ${error.message}`)
            } else {
              await wait(50)
            }
          } else {
            // Re-throw with un-corrupted stack trace
            throw new Error(`Element ${elementOrIdentifier.constructor.name} click failed - ${error.constructor.name}: ${error.message}`)
          }
        } else {
          throw new Error(`Element ${elementOrIdentifier.constructor.name} click failed - ${typeof error}: ${error}`)
        }
      }
    }
  }

  /**
   * Finds a single element by CSS selector
   * @param {string} selector
   * @param {object} args
   * @returns {Promise<import("selenium-webdriver").WebElement>}
   */
  async find(selector, args = {}) {
    let elements

    try {
      elements = await this.all(selector, args)
    } catch (error) {
      // Re-throw to recover stack trace
      if (error instanceof Error) {
        throw new Error(`${error.message} (selector: ${this.getSelector(selector)})`)
      } else {
        throw new Error(`${error} (selector: ${this.getSelector(selector)})`)
      }
    }

    if (elements.length > 1) {
      throw new Error(`More than 1 elements (${elements.length}) was found by CSS: ${this.getSelector(selector)}`)
    }

    if (!elements[0]) {
      throw new ElementNotFoundError(`Element couldn't be found after ${(this.getTimeouts() / 1000).toFixed(2)}s by CSS: ${this.getSelector(selector)}`)
    }

    return elements[0]
  }

  /**
   * Finds a single element by test ID
   * @param {string} testID
   * @param {object} args
   * @returns {Promise<import("selenium-webdriver").WebElement>}
   */
  async findByTestID(testID, args) { return await this.find(`[data-testid='${testID}']`, args) }

  /**
   * @param {string|import("selenium-webdriver").WebElement} elementOrIdentifier
   * @returns {Promise<import("selenium-webdriver").WebElement>}
   */
  async _findElement(elementOrIdentifier) {
    let element

    if (typeof elementOrIdentifier == "string") {
      element = await this.find(elementOrIdentifier)
    } else {
      element = elementOrIdentifier
    }

    return element
  }

  /**
   * Finds a single element by CSS selector without waiting
   * @param {string} selector
   * @param {object} [args]
   * @returns {Promise<import("selenium-webdriver").WebElement>}
   */
  async findNoWait(selector, args) {
    await this.driverSetTimeouts(0)

    try {
      return await this.find(selector, args)
    } finally {
      await this.restoreTimeouts()
    }
  }

  /**
   * Gets browser logs
   * @returns {Promise<string[]>}
   */
  async getBrowserLogs() {
    const entries = await this.getDriver().manage().logs().get(logging.Type.BROWSER)
    const browserLogs = []

    for (const entry of entries) {
      const messageMatch = entry.message.match(/^(.+) (\d+):(\d+) (.+)$/)
      let message

      if (messageMatch) {
        message = messageMatch[4]
      } else {
        message = entry.message
      }

      browserLogs.push(`${entry.level.name}: ${message}`)
    }

    return browserLogs
  }

  /**
   * @returns {Promise<string>}
   */
  async getCurrentUrl() {
    return await this.getDriver().getCurrentUrl()
  }

  /**
   * @returns {number}
   */
  getTimeouts() { return this._timeouts }

  /**
   * Interacts with an element by calling a method on it with the given arguments.
   * Retrying on ElementNotInteractableError.
   * @param {import("selenium-webdriver").WebElement|string} elementOrIdentifier - The element or a CSS selector to find the element.
   * @param {string} methodName - The method name to call on the element.
   * @param {...any} args - Arguments to pass to the method.
   * @returns {Promise<any>}
   */
  async interact(elementOrIdentifier, methodName, ...args) {
    let tries = 0

    while (true) {
      tries++

      const element = await this._findElement(elementOrIdentifier)

      if (!element[methodName]) {
        throw new Error(`${element.constructor.name} hasn't an attribute named: ${methodName}`)
      } else if (typeof element[methodName] != "function") {
        throw new Error(`${element.constructor.name}#${methodName} is not a function`)
      }

      try {
        // Dont call with candidate, because that will bind the function wrong.
        return await element[methodName](...args)
      } catch (error) {
        if (error instanceof Error) {
          if (error.constructor.name === "ElementNotInteractableError") {
            // Retry finding the element and interacting with it
            if (tries >= 3) {
              let elementDescription

              if (typeof elementOrIdentifier == "string") {
                elementDescription = `CSS selector ${elementOrIdentifier}`
              } else {
                elementDescription = `${element.constructor.name}`
              }

              throw new Error(`${elementDescription} ${methodName} failed after ${tries} tries - ${error.constructor.name}: ${error.message}`)
            } else {
              await wait(50)
            }
          } else {
            // Re-throw with un-corrupted stack trace
            throw new Error(`${element.constructor.name} ${methodName} failed - ${error.constructor.name}: ${error.message}`)
          }
        } else {
          throw new Error(`${element.constructor.name} ${methodName} failed - ${typeof error}: ${error}`)
        }
      }
    }
  }

  /**
   * Expects no element to be found by CSS selector
   * @param {string} selector
   * @returns {Promise<void>}
   */
  async expectNoElement(selector) {
    let found = false

    try {
      await this.findNoWait(selector)
      found = true
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Element couldn't be found after ")) {
        // Ignore
      } else {
        throw error
      }
    }

    if (found) {
      throw new Error(`Expected not to find: ${selector}`)
    }
  }

  /**
   * @param {string} selector
   * @param {object} args
   * @param {boolean} [args.useBaseSelector]
   * @returns {Promise<void>}
   */
  async waitForNoSelector(selector, args) {
    const {useBaseSelector, ...restArgs} = args

    if (Object.keys(restArgs).length > 0) {
      throw new Error(`Unexpected args: ${Object.keys(restArgs).join(", ")}`)
    }

    await this.getDriver().wait(
      async () => {
        const elements = await this.getDriver().findElements(By.css(selector))

        // Not found at all
        if (elements.length === 0) {
          return true;
        }

        // Found but not visible
        const isDisplayed = await elements[0].isDisplayed()
        return !isDisplayed
      },
      this.getTimeouts()
    )
  }

  /**
   * Gets notification messages
   * @returns {Promise<string[]>}
   */
  async notificationMessages() {
    const notificationMessageElements = await this.all("[data-class='notification-message']", {useBaseSelector: false})
    const notificationMessageTexts = []

    for (const notificationMessageElement of notificationMessageElements) {
      const text = await notificationMessageElement.getText()

      notificationMessageTexts.push(text)
    }

    return notificationMessageTexts
  }

  /**
   * Expects a notification message to appear and waits for it if necessary.
   * @param {string} expectedNotificationMessage
   * @returns {Promise<void>}
   */
  async expectNotificationMessage(expectedNotificationMessage) {
    /** @type {string[]} */
    const allDetectedNotificationMessages = []
    let foundNotificationMessageElement

    await waitFor(async () => {
      const notificationMessageElements = await this.all("[data-class='notification-message']", {useBaseSelector: false})

      for (const notificationMessageElement of notificationMessageElements) {
        const notificationMessage = await notificationMessageElement.getText()

        if (!allDetectedNotificationMessages.includes(notificationMessage)) {
          allDetectedNotificationMessages.push(notificationMessage)
        }

        if (notificationMessage == expectedNotificationMessage) {
          foundNotificationMessageElement = notificationMessageElement
          return
        }
      }

      throw new Error(`Notification message ${expectedNotificationMessage} wasn't included in: ${allDetectedNotificationMessages.join(", ")}`)
    })

    if (foundNotificationMessageElement) {
      await this.interact(foundNotificationMessageElement, "click") // Dismiss the notification message
    }
  }

  /**
   * @returns {Promise<void>}
   */
  async dismissNotificationMessages() {
    const notificationMessageElements = await this.all("[data-class='notification-message']", {useBaseSelector: false})

    for (const notificationMessageElement of notificationMessageElements) {
      await this.interact(notificationMessageElement, "click")
    }

    await this.waitForNoSelector("[data-class='notification-message']", {useBaseSelector: false})
  }

  /**
   * Indicates whether the system test has been started
   * @returns {boolean}
   */
  isStarted() { return this._started }

  /**
   * Gets the HTML of the current page
   * @returns {Promise<string>}
   */
  async getHTML() { return await this.getDriver().getPageSource() }

  /**
   * Starts the system test
   * @returns {Promise<void>}
   */
  async start() {
    if (process.env.SYSTEM_TEST_HOST == "expo-dev-server") {
      this.currentUrl = `http://${this._host}:${this._port}`
    } else if (process.env.SYSTEM_TEST_HOST == "dist") {
      this.currentUrl = `http://${this._host}:1984`
      this.systemTestHttpServer = new SystemTestHttpServer()

      await this.systemTestHttpServer.start()
    } else {
      throw new Error("Please set SYSTEM_TEST_HOST to 'expo-dev-server' or 'dist'")
    }

    const options = new chrome.Options()

    options.addArguments("--disable-dev-shm-usage")
    options.addArguments("--disable-gpu")
    options.addArguments("--headless=new")
    options.addArguments("--no-sandbox")
    options.addArguments("--window-size=1920,1080")

    this.driver = new Builder()
      .forBrowser("chrome")
      .setChromeOptions(options)
      // @ts-expect-error
      .setCapability("goog:loggingPrefs", {browser: "ALL"})
      .build()

    await this.setTimeouts(5000)

    // Web socket server to communicate with browser
    await this.startWebSocketServer()

    // Visit the root page and wait for Expo to be loaded and the app to appear
    await this.driverVisit(SystemTest.rootPath)

    try {
      await this.find("body > #root", {useBaseSelector: false})
      await this.find("[data-testid='systemTestingComponent']", {visible: null, useBaseSelector: false})
    } catch (error) {
      await this.takeScreenshot()
      throw error
    }

    // Wait for client to connect
    await this.waitForClientWebSocket()

    this._started = true
    this.setBaseSelector("[data-testid='systemTestingComponent'][data-focussed='true']")
  }

  /**
   * Restores previously set timeouts
   * @returns {Promise<void>}
   */
  async restoreTimeouts() {
    if (!this.getTimeouts()) {
      throw new Error("Timeouts haven't previously been set")
    }

    await this.driverSetTimeouts(this.getTimeouts())
  }

  /**
   * Sets driver timeouts
   * @param {number} newTimeout
   * @returns {Promise<void>}
   */
  async driverSetTimeouts(newTimeout) {
    await this.getDriver().manage().setTimeouts({implicit: newTimeout})
  }

  /**
   * Sets timeouts and stores the previous timeouts
   * @param {number} newTimeout
   * @returns {Promise<void>}
   */
  async setTimeouts(newTimeout) {
    this._timeouts = newTimeout
    await this.restoreTimeouts()
  }

  /**
   * Waits for the client web socket to connect
   * @returns {Promise<void>}
   */
  waitForClientWebSocket() {
    return new Promise((resolve) => {
      if (this.ws) {
        resolve()
      }

      this.waitForClientWebSocketPromiseResolve = resolve
    })
  }

  /**
   * Starts the web socket server
   * @returns {void}
   */
  startWebSocketServer() {
    this.wss = new WebSocketServer({port: 1985})
    this.wss.on("connection", this.onWebSocketConnection)
    this.wss.on("close", this.onWebSocketClose)
  }

  /**
   * Sets the on command callback
   * @param {function({type: string, data: Record<string, any>}): Promise<void>} callback
   * @returns {void}
   */
  onCommand(callback) {
    this._onCommandCallback = callback
  }

  /**
   * Handles a command received from the browser
   * @param {{data: {message: string, backtrace: string, type: string, value: any[]}}} args
   * @returns {Promise<any>}
   */
  onCommandReceived = async ({data}) => {
    const type = data.type
    let result

    if (type == "console.error") {
      const errorMessage = data.value[0]
      let showMessage = true

      if (errorMessage.includes("Minified React error #419")) {
        showMessage = false
      }

      if (showMessage) {
        console.error("Browser error", ...data.value)
      }
    } else if (type == "console.log") {
      console.log("Browser log", ...data.value)
    } else if (type == "error" || data.type == "unhandledrejection") {
      this.handleError(data)
    } else if (this._onCommandCallback) {
      result = await this._onCommandCallback({data, type})
    } else {
      console.error(`onWebSocketClientMessage unknown data (type ${type})`, data)
    }

    return result
  }

  /**
   * Handles a new web socket connection
   * @param {WebSocket} ws
   * @returns {Promise<void>}
   */
  onWebSocketConnection = async (ws) => {
    this.ws = ws
    this.getCommunicator().ws = ws
    this.getCommunicator().onOpen()

    // @ts-expect-error
    this.ws.on("error", digg(this, "communicator", "onError"))

    // @ts-expect-error
    this.ws.on("message", digg(this, "communicator", "onMessage"))

    if (this.waitForClientWebSocketPromiseResolve) {
      this.waitForClientWebSocketPromiseResolve()
      delete this.waitForClientWebSocketPromiseResolve
    }
  }

  /**
   * @returns {void}
   */
  onWebSocketClose = () => {
    this.ws = null
    this.getCommunicator().ws = null
  }

  /**
   * Handles an error reported from the browser
   * @param {object} data
   * @param {string} data.message
   * @param {string} [data.backtrace]
   * @returns {void}
   */
  handleError(data) {
    if (data.message.includes("Minified React error #419")) {
      // Ignore this error message
      return
    }

    const error = new Error(`Browser error: ${data.message}`)

    if (data.backtrace) {
      error.stack = `${error.message}\n${data.backtrace}`
    }

    console.error(error)
  }

  /**
   * Stops the system test
   * @returns {Promise<void>}
   */
  async stop() {
    this.stopScoundrel()
    this.systemTestHttpServer?.close()
    this.wss?.close()
    await this.driver?.quit()
  }

  /**
   * Visits a path in the browser
   * @param {string} path
   * @returns {Promise<void>}
   */
  async driverVisit(path) {
    const url = `${this.currentUrl}${path}`

    await this.getDriver().get(url)
  }

  /**
   * Takes a screenshot, saves HTML and browser logs
   * @returns {Promise<void>}
   */
  async takeScreenshot() {
    const path = `${process.cwd()}/tmp/screenshots`

    await fs.mkdir(path, {recursive: true})

    const imageContent = await this.getDriver().takeScreenshot()
    const now = new Date()
    const screenshotPath = `${path}/${moment(now).format("YYYY-MM-DD-HH-MM-SS")}.png`
    const htmlPath = `${path}/${moment(now).format("YYYY-MM-DD-HH-MM-SS")}.html`
    const logsPath = `${path}/${moment(now).format("YYYY-MM-DD-HH-MM-SS")}.logs.txt`
    const logsText = await this.getBrowserLogs()
    const html = await this.getHTML()
    const htmlPretty = prettify(html)

    await fs.writeFile(htmlPath, htmlPretty)
    await fs.writeFile(logsPath, logsText.join("\n"))
    await fs.writeFile(screenshotPath, imageContent, "base64")

    console.log("Current URL:", await this.getCurrentUrl())
    console.log("Logs:", logsPath)
    console.log("Screenshot:", screenshotPath)
    console.log("HTML:", htmlPath)
  }

  /**
   * Visits a path in the browser
   * @param {string} path
   * @returns {Promise<void>}
   */
  async visit(path) {
    await this.getCommunicator().sendCommand({type: "visit", path})
  }

  /**
   * Dismisses to a path in the browser
   * @param {string} path
   * @returns {Promise<void>}
   */
  async dismissTo(path) {
    await this.getCommunicator().sendCommand({type: "dismissTo", path})
  }
}
