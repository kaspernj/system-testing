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

export default class SystemTest {
  /**
   * Gets the current system test instance
   *
   * @param {object} args
   * @returns {SystemTest}
   */
  static current(args) {
    if (!globalThis.systemTest) {
      globalThis.systemTest = new SystemTest(args)
    }

    return globalThis.systemTest
  }

  /**
   * Runs a system test
   *
   * @param {function(SystemTest): Promise<void>} callback
   */
  static async run(callback) {
    const systemTest = this.current()

    await systemTest.communicator.sendCommand({type: "initialize"})
    await systemTest.visit("/blank")

    try {
      await systemTest.findByTestID("blankText")
      await callback(systemTest)
    } catch (error) {
      await systemTest.takeScreenshot()

      throw error
    }
  }

  /**
   * Creates a new SystemTest instance
   *
   * @param {object} args
   * @param {string} args.host
   * @param {number} args.port
   */
  constructor({host = "localhost", port = 8081, ...restArgs} = {}) {
    const restArgsKeys = Object.keys(restArgs)

    if (restArgsKeys.length > 0) {
      throw new Error(`Unknown arguments: ${restArgsKeys.join(", ")}`)
    }

    this._host = host
    this._port = port
    this._responses = {}
    this._sendCount = 0
    this.startScoundrel()
    this.communicator = new SystemTestCommunicator({onCommand: this.onCommandReceived})
  }

  /** Starts Scoundrel server which the browser connects to for remote evaluation in the browser */
  startScoundrel() {
    this.wss = new WebSocketServer({port: 8090})
    this.serverWebSocket = new ServerWebSocket(this.wss)
    this.server = new Server(this.serverWebSocket)
  }

  stopScoundrel() {
    this.server?.close()
    this.wss?.close()
  }

  /**
   * Finds all elements by CSS selector
   *
   * @param {string} selector
   * @param {object} args
   *
   * @returns {import("selenium-webdriver").WebElement[]}
   */
  async all(selector, args = {}) {
    const {visible = true} = args
    const elements = await this.driver.findElements(By.css(selector))
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
   *
   * @param {import("selenium-webdriver").WebElement} element
   **/
  async click(element) {
    if (typeof element == "string") {
      element = await this.find(element)
    }

    const actions = this.driver.actions({async: true})

    await actions.move({origin: element}).click().perform()
  }

  /**
   * Finds a single element by CSS selector
   *
   * @param {string} selector
   * @param {object} args
   * @returns {import("selenium-webdriver").WebElement}
   */
  async find(selector, args = {}) {
    let elements

    try {
      elements = await this.all(selector, args)
    } catch (error) {
      // Re-throw to recover stack trace
      throw new Error(`${error.message} (selector: ${selector})`)
    }

    if (elements.length > 1) {
      throw new Error(`More than 1 elements (${elements.length}) was found by CSS: ${selector}`)
    }

    if (!elements[0]) {
      throw new ElementNotFoundError(`Element couldn't be found by CSS: ${selector}`)
    }

    return elements[0]
  }

  /**
   * Finds a single element by test ID
   *
   * @param {string} testID
   * @param {object} args
   * @returns {import("selenium-webdriver").WebElement}
   */
  async findByTestID(testID, args) { return await this.find(`[data-testid='${testID}']`, args) }

  /**
   * Finds a single element by CSS selector without waiting
   *
   * @param {string} selector
   * @returns {import("selenium-webdriver").WebElement}
   */
  async findNoWait(selector) {
    await this.driverSetTimeouts(0)

    try {
      return await this.find(selector)
    } finally {
      await this.restoreTimeouts()
    }
  }

  /**
   * Gets browser logs
   *
   * @returns {Promise<string[]>}
   */
  async getBrowserLogs() {
    const entries = await this.driver.manage().logs().get(logging.Type.BROWSER)
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

  async getCurrentUrl() {
    return await this.driver.getCurrentUrl()
  }

  /**
   * Interacts with an element by calling a method on it with the given arguments.
   * Retrying on ElementNotInteractableError.
   *
   * @param {import("selenium-webdriver").WebElement|string} elementOrIdentifier - The element or a CSS selector to find the element.
   * @param {string} methodName - The method name to call on the element.
   * @param {...any} args - Arguments to pass to the method.
   *
   * @returns {Promise<any>}
   */
  async interact(elementOrIdentifier, methodName, ...args) {
    let element
    let tries = 0

    while (true) {
      tries++

      if (typeof elementOrIdentifier == "string") {
        element = await this.find(elementOrIdentifier)
      } else {
        element = elementOrIdentifier
      }

      if (!element[methodName]) {
        // throw new Error(`${element.constructor.name} has no method named: ${methodName}`)
      }

      try {
        return await element[methodName](...args)
      } catch (error) {
        if (error.constructor.name === "ElementNotInteractableError") {
          // Retry finding the element and interacting with it
          if (tries >= 3) {
            throw new Error(`${element.constructor.name} ${methodName} failed after ${tries} tries - ${error.constructor.name}: ${error.message}`)
          } else {
            await wait(100)
          }
        } else {
          // Re-throw with un-corrupted stack trace
          throw new Error(`${element.constructor.name} ${methodName} failed - ${error.constructor.name}: ${error.message}`)
        }
      }
    }
  }

  /**
   * Expects no element to be found by CSS selector
   *
   * @param {string} selector
   */
  async expectNoElement(selector) {
    let found = false

    try {
      await this.findNoWait(selector)
      found = true
    } catch (error) {
      if (!error.message.startsWith("Element couldn't be found by CSS:")) {
        throw error
      }
    }

    if (found) {
      throw new Error(`Expected not to find: ${selector}`)
    }
  }

  /**
   * Gets notification messages
   *
   * @returns {Promise<string[]>}
   */
  async notificationMessages() {
    const notificationMessageElements = await this.all("[data-class='notification-message']")
    const notificationMessageTexts = []

    for (const notificationMessageElement of notificationMessageElements) {
      const text = await notificationMessageElement.getText()

      notificationMessageTexts.push(text)
    }

    return notificationMessageTexts
  }

  /**
   * Expects a notification message to appear and waits for it if necessary.
   *
   * @param {string} expectedNotificationMessage
   */
  async expectNotificationMessage(expectedNotificationMessage) {
    const allDetectedNotificationMessages = []

    await waitFor(async () => {
      const notificationMessages = await this.notificationMessages()

      for (const notificationMessage of notificationMessages) {
        if (!allDetectedNotificationMessages.includes(notificationMessage)) {
          allDetectedNotificationMessages.push(notificationMessage)
        }

        if (notificationMessage == expectedNotificationMessage) {
          return
        }
      }

      throw new Error(`Notification message ${expectedNotificationMessage} wasn't included in: ${allDetectedNotificationMessages.join(", ")}`)
    })
  }

  /**
   * Indicates whether the system test has been started
   *
   * @returns {boolean}
   */
  isStarted() { return this._started }

  /**
   * Gets the HTML of the current page
   *
   * @returns {Promise<string>}
   */
  async getHTML() { return await this.driver.getPageSource() }

  /**
   * Starts the system test
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
      .setCapability("goog:loggingPrefs", {browser: "ALL"})
      .build()

    await this.setTimeouts(5000)

    // Web socket server to communicate with browser
    await this.startWebSocketServer()

    // Visit the root page and wait for Expo to be loaded and the app to appear
    await this.driverVisit("/?systemTest=true")

    try {
      await this.find("body > #root")
      await this.find("[data-testid='systemTestingComponent']", {visible: null})
    } catch (error) {
      await systemTest.takeScreenshot()

      throw error
    }

    // Wait for client to connect
    await this.waitForClientWebSocket()

    this._started = true
  }

  /**
   * Restores previously set timeouts
   */
  async restoreTimeouts() {
    if (!this._timeouts) {
      throw new Error("Timeouts haven't previously been set")
    }

    await this.driverSetTimeouts(this._timeouts)
  }

  /**
   * Sets driver timeouts
   *
   * @param {number} newTimeout
   */
  async driverSetTimeouts(newTimeout) {
    await this.driver.manage().setTimeouts({implicit: newTimeout})
  }

  /**
   * Sets timeouts and stores the previous timeouts
   *
   * @param {number} newTimeout
   */
  async setTimeouts(newTimeout) {
    this._timeouts = newTimeout
    await this.restoreTimeouts()
  }

  /**
   * Waits for the client web socket to connect
   *
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
   */
  startWebSocketServer() {
    this.wss = new WebSocketServer({port: 1985})
    this.wss.on("connection", this.onWebSocketConnection)
    this.wss.on("close", this.onWebSocketClose)
  }

  onCommand(callback) {
    this._onCommandCallback = callback
  }

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

  onWebSocketConnection = async (ws) => {
    this.ws = ws
    this.communicator.ws = ws
    this.communicator.onOpen()
    this.ws.on("error", digg(this, "communicator", "onError"))
    this.ws.on("message", digg(this, "communicator", "onMessage"))

    if (this.waitForClientWebSocketPromiseResolve) {
      this.waitForClientWebSocketPromiseResolve()
      delete this.waitForClientWebSocketPromiseResolve
    }
  }

  onWebSocketClose = () => {
    this.ws = null
    this.communicator.ws = null
  }

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
   */
  async stop() {
    this.stopScoundrel()
    this.systemTestHttpServer?.close()
    this.wss?.close()
    await this.driver.quit()
  }

  /**
   * Visits a path in the browser
   *
   * @param {string} path
   */
  async driverVisit(path) {
    const url = `${this.currentUrl}${path}`

    await this.driver.get(url)
  }

  /**
   * Takes a screenshot, saves HTML and browser logs
   */
  async takeScreenshot() {
    const path = `${process.cwd()}/tmp/screenshots`

    await fs.mkdir(path, {recursive: true})

    const imageContent = await this.driver.takeScreenshot()
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
   *
   * @param {string} path
   */
  async visit(path) {
    await this.communicator.sendCommand({type: "visit", path})
  }
}
