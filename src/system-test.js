// @ts-check

import {Builder, By, error as SeleniumError} from "selenium-webdriver"
import chrome from "selenium-webdriver/chrome.js"
import {digg} from "diggerize"
import fs from "node:fs/promises"
import logging from "selenium-webdriver/lib/logging.js"
import moment from "moment"
import {prettify} from "htmlfy"
import Server from "scoundrel-remote-eval/build/server/index.js"
import ServerWebSocket from "scoundrel-remote-eval/build/server/connections/web-socket/index.js"
import SystemTestCommunicator from "./system-test-communicator.js"
import SystemTestHttpServer from "./system-test-http-server.js"
import {wait, waitFor} from "awaitery"
import {WebSocketServer} from "ws"

class ElementNotFoundError extends Error { }
const {WebDriverError} = SeleniumError

/**
 * @typedef {object} SystemTestArgs
 * @property {string} [host]
 * @property {number} [port]
 * @property {string} [httpHost]
 * @property {number} [httpPort]
 * @property {boolean} [debug]
 * @property {(error: any) => boolean} [errorFilter]
 * @property {Record<string, any>} [urlArgs]
 */

export default class SystemTest {
  /**
   * @typedef {object} FindArgs
   * @property {number} [timeout] Override timeout for lookup.
   * @property {boolean} [visible] Whether to require elements to be visible.
   * @property {boolean} [useBaseSelector] Whether to scope by the base selector.
   */
  static rootPath = "/blank?systemTest=true"

  /** @type {SystemTestCommunicator | undefined} */
  communicator = undefined

  /** @type {import("selenium-webdriver").WebDriver | undefined} */
  driver = undefined

  _started = false
  _driverTimeouts = 5000
  _timeouts = 5000
  _httpHost = "localhost"
  _httpPort = 1984
  /** @type {(error: any) => boolean | undefined} */
  _errorFilter = undefined
  /** @type {WebSocketServer | undefined} */
  scoundrelWss = undefined
  /** @type {WebSocketServer | undefined} */
  clientWss = undefined

  /**
   * Gets the current system test instance
   * @param {SystemTestArgs} [args]
   * @returns {SystemTest}
   */
  static current(args = {}) {
    if (!globalThis.systemTest) {
      globalThis.systemTest = new SystemTest(args)
    }

    return globalThis.systemTest
  }

  /** @returns {SystemTestCommunicator} */
  getCommunicator() {
    if (!this.communicator) {
      throw new Error("Communicator hasn't been initialized yet")
    }

    return this.communicator
  }

  /**
   * Extracts an error message if possible from the payload sent from the browser.
   * @param {{message?: string, value?: any[]} | Error} data
   * @returns {string | undefined}
   */
  extractErrorMessage(data) {
    if (data instanceof Error) return data.message
    if (typeof data === "object" && typeof data.message === "string") return data.message
    if (typeof data === "string") return data

    const firstValue = Array.isArray(data?.value) ? data.value[0] : undefined

    if (firstValue instanceof Error && typeof firstValue.message === "string") return firstValue.message
    if (typeof firstValue === "string") return firstValue

    return undefined
  }

  /**
   * Whether a browser error should be ignored based on built-in rules and an optional error filter.
   * @param {{message?: string, value?: any[]}} data
   * @returns {boolean}
   */
  shouldIgnoreError(data) {
    const message = this.extractErrorMessage(data)

    if (typeof message === "string") {
      if (message.includes("Minified React error #418")) return true
      if (message.includes("Minified React error #419")) return true
    }

    if (this._errorFilter && this._errorFilter(data) === false) {
      return true
    }

    return false
  }

  /**
   * Runs a system test
   * @overload
   * @param {function(SystemTest): Promise<void>} callback
   * @returns {Promise<void>}
   */
  /**
   * Runs a system test
   * @overload
   * @param {SystemTestArgs} args
   * @param {function(SystemTest): Promise<void>} callback
   * @returns {Promise<void>}
   */
  /**
   * Runs a system test
   * @param {SystemTestArgs | function(SystemTest): Promise<void>} [args]
   * @param {function(SystemTest): Promise<void>} [callback]
   * @returns {Promise<void>}
   */
  static async run(args, callback) {
    const resolvedCallback = typeof args === "function" ? args : callback
    const systemTest = this.current(typeof args === "function" ? {} : args)

    if (!resolvedCallback) {
      throw new Error("SystemTest.run requires a callback")
    }

    systemTest.debugLog("Run started")
    await systemTest.getCommunicator().sendCommand({type: "initialize"})
    systemTest.debugLog("Sent initialize command")
    const rootPath = systemTest.getRootPath()
    await systemTest.dismissTo(rootPath)
    systemTest.debugLog(`Dismissed to root path ${rootPath}`)

    try {
      await systemTest.findByTestID("blankText", {useBaseSelector: false})
      systemTest.debugLog("Found blankText")
      await resolvedCallback(systemTest)
      systemTest.debugLog("Run callback completed")
    } catch (error) {
      systemTest.debugLog("Run error caught, taking screenshot")
      await systemTest.takeScreenshot()

      throw error
    }
  }

  /**
   * Creates a new SystemTest instance
   * @param {SystemTestArgs} [args]
   */
  constructor({host = "localhost", port = 8081, httpHost = "localhost", httpPort = 1984, debug = false, errorFilter, urlArgs, ...restArgs} = {host: "localhost", port: 8081, httpHost: "localhost", httpPort: 1984, debug: false}) {
    const restArgsKeys = Object.keys(restArgs)

    if (restArgsKeys.length > 0) {
      throw new Error(`Unknown arguments: ${restArgsKeys.join(", ")}`)
    }

    this._host = host
    this._port = port
    this._httpHost = httpHost
    this._httpPort = httpPort
    this._debug = debug
    this._errorFilter = errorFilter
    this._urlArgs = urlArgs
    this._rootPath = this.buildRootPath()

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

  /** @returns {import("selenium-webdriver").WebDriver} */
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
   * Logs messages when debugging is enabled
   * @param {string} message
   * @returns {void}
   */
  debugLog(message) {
    if (this._debug) {
      console.log(`[SystemTest debug] ${message}`)
    }
  }

  /**
   * Starts Scoundrel server which the browser connects to for remote evaluation in the browser
   * @returns {void}
   */
  startScoundrel() {
    if (this.scoundrelWss) throw new Error("Scoundrel server already started")

    this.scoundrelWss = new WebSocketServer({port: 8090})
    this.serverWebSocket = new ServerWebSocket(this.scoundrelWss)
    this.server = new Server(this.serverWebSocket)
  }

  /**
   * @returns {Promise<void>}
   */
  async stopScoundrel() {
    await Promise.resolve(this.server?.close?.())
    await this.closeWebSocketServer(this.scoundrelWss)
  }

  /**
   * Waits for the Scoundrel client (browser) to connect and returns it.
   * @param {number} [timeoutMs]
   * @returns {Promise<import("scoundrel-remote-eval/build/client/index.js").default>}
   */
  async getScoundrelClient(timeoutMs = 10000) {
    if (!this.server) {
      throw new Error("Scoundrel server is not started")
    }

    const existingClients = this.server.getClients?.()

    if (existingClients && existingClients.length > 0) {
      return existingClients[0]
    }

    if (!this.server.events?.on) {
      throw new Error("Scoundrel server events are unavailable")
    }

    return await new Promise((resolve, reject) => {
      const onNewClient = (client) => {
        clearTimeout(timeout)
        this.server?.events.off("newClient", onNewClient)
        resolve(client)
      }

      const timeout = setTimeout(() => {
        this.server?.events.off("newClient", onNewClient)
        reject(new Error("Timed out waiting for Scoundrel client"))
      }, timeoutMs)

      this.server.events.on("newClient", onNewClient)
    })
  }

  /**
   * Finds all elements by CSS selector
   * @param {string} selector
   * @param {object} [args]
   * @param {number} [args.timeout]
   * @param {boolean} [args.visible]
   * @param {boolean} [args.useBaseSelector]
   * @returns {Promise<import("selenium-webdriver").WebElement[]>}
   */
  async all(selector, args = {}) {
    const {visible = true, timeout, useBaseSelector = true, ...restArgs} = args
    const restArgsKeys = Object.keys(restArgs)
    let actualTimeout

    if (timeout === undefined) {
      actualTimeout = this._driverTimeouts
    } else {
      actualTimeout = timeout
    }

    if (restArgsKeys.length > 0) throw new Error(`Unknown arguments: ${restArgsKeys.join(", ")}`)

    const actualSelector = useBaseSelector ? this.getSelector(selector) : selector
    const getElements = async () => await this.getDriver().findElements(By.css(actualSelector))
    let elements = []

    try {
      if (actualTimeout == 0) {
        elements = await getElements()
      } else {
        await this.getDriver().wait(async () => {
          elements = await getElements()

          return elements.length > 0
        }, actualTimeout)
      }
    } catch (error) {
      throw new Error(`Couldn't get elements with selector: ${actualSelector}: ${error instanceof Error ? error.message : error}`)
    }

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
   * @param {FindArgs} [args]
   * @returns {Promise<import("selenium-webdriver").WebElement>}
   */
  async find(selector, args = {}) {
    let elements = []

    try {
      elements = await this.all(selector, args)
    } catch (error) {
      // Re-throw to recover stack trace
      if (error instanceof Error) {
        if (error.message.startsWith("Wait timed out after")) {
          elements = []
        }

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
   * @param {object} [args]
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
   * @param {FindArgs} [args]
   * @returns {Promise<import("selenium-webdriver").WebElement>}
   */
  async findNoWait(selector, args = {}) {
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

  /** @returns {Promise<string>} */
  async getCurrentUrl() {
    return await this.getDriver().getCurrentUrl()
  }

  /** @returns {number} */
  getTimeouts() { return this._timeouts }

  /**
   * Interacts with an element by calling a method on it with the given arguments.
   * Retrying on ElementNotInteractableError, ElementClickInterceptedError, or StaleElementReferenceError.
   * @param {import("selenium-webdriver").WebElement|string} elementOrIdentifier The element or a CSS selector to find the element.
   * @param {string} methodName The method name to call on the element.
   * @param {...any} args Arguments to pass to the method.
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
          if (
            error.constructor.name === "ElementNotInteractableError" ||
            error.constructor.name === "ElementClickInterceptedError" ||
            error.constructor.name === "StaleElementReferenceError"
          ) {
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
   * @param {FindArgs} [args]
   * @returns {Promise<void>}
   */
  async expectNoElement(selector, args = {}) {
    let found = false

    try {
      await this.findNoWait(selector, args)
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
   * @param {object} [args]
   * @param {boolean} [args.useBaseSelector]
   * @returns {Promise<void>}
   */
  async waitForNoSelector(selector, args) {
    const {useBaseSelector, ...restArgs} = args

    if (Object.keys(restArgs).length > 0) {
      throw new Error(`Unexpected args: ${Object.keys(restArgs).join(", ")}`)
    }

    const actualSelector = useBaseSelector ? this.getSelector(selector) : selector

    await this._withRethrownErrors(async () => {
      await this.getDriver().wait(
        async () => {
          const elements = await this.getDriver().findElements(By.css(actualSelector))

          // Not found at all
          if (elements.length === 0) {
            return true
          }

          // Found but not visible
          const isDisplayed = await elements[0].isDisplayed()

          return !isDisplayed
        },
        this.getTimeouts()
      )
    })
  }

  async _withRethrownErrors(callback) {
    try {
      return await callback()
    } catch (error) {
      if (error instanceof WebDriverError) {
        throw new Error(`Selenium ${error.constructor.name}: ${error.message}`)
      } else {
        throw error
      }
    }
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
      const notificationMessageElements = await this.all("[data-testid='notification-message']", {useBaseSelector: false})

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

  /** @returns {Promise<void>} */
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
    this.debugLog("Start called")
    if (process.env.SYSTEM_TEST_HOST == "expo-dev-server") {
      this.currentUrl = `http://${this._host}:${this._port}`
      this.debugLog(`Using expo-dev-server at ${this.currentUrl}`)
    } else if (process.env.SYSTEM_TEST_HOST == "dist") {
      this.currentUrl = `http://${this._httpHost}:${this._httpPort}`

      this.debugLog(`Spawning HTTP server for dist on ${this._httpHost}:${this._httpPort}`)
      this.systemTestHttpServer = new SystemTestHttpServer({host: this._httpHost, port: this._httpPort, debug: this._debug})

      this.debugLog("Starting HTTP server")
      await this.systemTestHttpServer.start()
      this.debugLog("HTTP server started")
    } else {
      throw new Error("Please set SYSTEM_TEST_HOST to 'expo-dev-server' or 'dist'")
    }

    const options = new chrome.Options()

    options.addArguments("--disable-dev-shm-usage")
    options.addArguments("--disable-gpu")
    options.addArguments("--headless=new")
    options.addArguments("--no-sandbox")
    options.addArguments("--window-size=1920,1080")
    this.debugLog("Chrome options configured")

    this.driver = new Builder()
      .forBrowser("chrome")
      .setChromeOptions(options)
      // @ts-expect-error
      .setCapability("goog:loggingPrefs", {browser: "ALL"})
      .build()
    this.debugLog("WebDriver built")

    await this.setTimeouts(10000)
    this.debugLog("Timeouts set on driver")

    // Web socket server to communicate with browser
    this.debugLog("Starting WebSocket server")
    await this.startWebSocketServer()
    this.debugLog("WebSocket server started")

    // Visit the root page and wait for Expo to be loaded and the app to appear
    this.debugLog("Visiting root path")
    const rootPath = this.getRootPath()
    await this.driverVisit(rootPath)
    this.debugLog(`Visited root path ${rootPath}`)

    //console.log("WAITING")
    //await wait(180000)

    try {
      await this.find("body > #root", {useBaseSelector: false})
      await this.findByTestID("systemTestingComponent", {visible: null, useBaseSelector: false, timeout: 30000})
      this.debugLog("Found root and systemTestingComponent")
    } catch (error) {
      await this.takeScreenshot()
      throw error
    }

    // Wait for client to connect
    this.debugLog("Waiting for client WebSocket connection (opening)")
    this.debugLog(`WS state: ${this.ws?.readyState ?? "none"}`)
    await this.waitForClientWebSocket()
    this.debugLog("Client WebSocket connected")

    this._started = true
    this.setBaseSelector("[data-testid='systemTestingComponent'][data-focussed='true']")
    this.debugLog("Start completed")
  }

  /**
   * @returns {string}
   */
  getRootPath() {
    return this._rootPath ?? SystemTest.rootPath
  }

  /**
   * @returns {string}
   */
  buildRootPath() {
    if (!this._urlArgs) return SystemTest.rootPath

    const url = new URL(SystemTest.rootPath, "http://localhost")
    const appendParam = (key, value) => {
      if (value === undefined || value === null) return
      url.searchParams.append(key, String(value))
    }

    if (this._urlArgs instanceof URLSearchParams) {
      for (const [key, value] of this._urlArgs) {
        appendParam(key, value)
      }
    } else {
      for (const [key, value] of Object.entries(this._urlArgs)) {
        appendParam(key, value)
      }
    }

    const rootPath =  `${url.pathname}${url.search}${url.hash}`

    this.debugLog(`buildRootPath rootPath: ${rootPath}`)

    return rootPath
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
    this._driverTimeouts = newTimeout
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
    return new Promise((resolve, reject) => {
      if (this.ws) {
        resolve()
      }

      this.waitForClientWebSocketPromiseReject = reject
      this.waitForClientWebSocketPromiseResolve = resolve
    })
  }

  /**
   * Starts the web socket server
   * @returns {void}
   */
  startWebSocketServer() {
    this.clientWss = new WebSocketServer({port: 1985})
    this.clientWss.on("connection", this.onWebSocketConnection)
    this.clientWss.on("close", this.onWebSocketClose)
    this.clientWss.on("error", (error) => {
      if (this.waitForClientWebSocketPromiseReject) {
        this.waitForClientWebSocketPromiseReject(error instanceof Error ? error : new Error(String(error)))
        delete this.waitForClientWebSocketPromiseReject
        delete this.waitForClientWebSocketPromiseResolve
      }
    })
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
      const showMessage = !this.shouldIgnoreError(data)

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
      delete this.waitForClientWebSocketPromiseReject
    }
  }

  /** @returns {void} */
  onWebSocketClose = () => {
    this.ws = null
    this.getCommunicator().ws = null

    if (this.waitForClientWebSocketPromiseReject) {
      this.waitForClientWebSocketPromiseReject(new Error("Client websocket closed before connecting"))
      delete this.waitForClientWebSocketPromiseReject
      delete this.waitForClientWebSocketPromiseResolve
    }
  }

  /**
   * Handles an error reported from the browser
   * @param {object} data
   * @param {string} data.message
   * @param {string} [data.backtrace]
   * @returns {void}
   */
  handleError(data) {
    if (this.shouldIgnoreError(data)) return

    const error = new Error(`Browser error: ${data.message}`)

    if (data.backtrace) {
      error.stack = `${error.message}\n${data.backtrace}\n\n${error.stack}`
    }

    console.error(error)
  }

  /**
   * Stops the system test
   * @returns {Promise<void>}
   */
  async stop() {
    await this.stopScoundrel()
    await this.systemTestHttpServer?.close()
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    await this.closeWebSocketServer(this.clientWss)
    await this.driver?.quit()
  }

  /**
   * Fully tears down and restarts the system test instance.
   * @returns {Promise<void>}
   */
  async reinitialize() {
    await this.stop()

    this._started = false
    this._baseSelector = undefined
    this.currentUrl = undefined
    this.driver = undefined
    this.ws = null
    this.clientWss = undefined
    this.scoundrelWss = undefined
    this.server = undefined
    this.serverWebSocket = undefined
    this.systemTestHttpServer = undefined
    this.waitForClientWebSocketPromiseReject = undefined
    this.waitForClientWebSocketPromiseResolve = undefined
    this.communicator = new SystemTestCommunicator({onCommand: this.onCommandReceived})

    this.startScoundrel()
    await this.start()
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

  /**
   * @param {WebSocketServer | undefined} wss
   * @returns {Promise<void>}
   */
  async closeWebSocketServer(wss) {
    if (!wss) return

    await new Promise((resolve, reject) => {
      let settled = false
      const terminateClient = (client) => {
        try {
          client.terminate()
        } catch {
          // Ignore termination errors
        }
      }
      const settle = (callback, arg) => {
        if (settled) return
        settled = true
        callback(arg)
      }

      wss.once("close", () => settle(resolve))
      wss.once("error", (error) => settle(reject, error))
      if (wss.clients && wss.clients.size > 0) {
        wss.clients.forEach(terminateClient)
      }
      wss.close((error) => {
        if (error) settle(reject, error)
        else settle(resolve)
      })
    })
  }
}
