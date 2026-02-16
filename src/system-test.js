// @ts-check

import {digg} from "diggerize"
import fs from "node:fs/promises"
import moment from "moment"
import {prettify} from "htmlfy"
import Server from "scoundrel-remote-eval/build/server/index.js"
import ServerWebSocket from "scoundrel-remote-eval/build/server/connections/web-socket/index.js"
import SystemTestCommunicator from "./system-test-communicator.js"
import SystemTestHttpServer from "./system-test-http-server.js"
import {waitFor} from "awaitery"
import timeout from "awaitery/build/timeout.js"
import {WebSocketServer} from "ws"
import SeleniumDriver from "./drivers/selenium-driver.js"
import AppiumDriver from "./drivers/appium-driver.js"

/**
 * @typedef {object} SystemTestArgs
 * @property {string} [host] Hostname for the app server.
 * @property {number} [port] Port for the app server.
 * @property {string} [httpHost] Hostname for the static HTTP server.
 * @property {number} [httpPort] Port for the static HTTP server.
 * @property {string} [httpConnectHost] Hostname used by the driver to reach the HTTP server.
 * @property {boolean} [debug] Enable debug logging.
 * @property {(error: any) => boolean} [errorFilter] Filter for browser errors (return false to ignore).
 * @property {Record<string, any>} [urlArgs] Query params appended to the root path.
 * @property {SystemTestDriverConfig} [driver] Driver configuration.
 */
/**
 * @typedef {object} SystemTestDriverConfig
 * @property {"selenium"|"appium"} [type] Driver implementation to use.
 * @property {Record<string, any>} [options] Driver-specific options.
 */
/**
 * @typedef {object} FindArgs
 * @property {number} [timeout] Override timeout for lookup.
 * @property {boolean | null} [visible] Whether to require elements to be visible (`true`) or hidden (`false`). Use `null` to disable visibility filtering.
 * @property {boolean} [useBaseSelector] Whether to scope by the base selector.
 */
/**
 * @typedef {object} WaitForNoSelectorArgs
 * @property {boolean} [useBaseSelector] Whether to scope by the base selector.
 */
/**
 * @typedef {object} NotificationMessageArgs
 * @property {boolean} [dismiss] Whether to dismiss the notification after it appears.
 */

export default class SystemTest {
  static rootPath = "/blank?systemTest=true"

  /** @type {SystemTestCommunicator | undefined} */
  communicator = undefined

  /** @type {import("selenium-webdriver").WebDriver | undefined} */
  driver = undefined

  /** @type {import("./drivers/webdriver-driver.js").default | undefined} */
  driverAdapter = undefined

  _started = false
  /** @type {SystemTestDriverConfig | undefined} */
  _driverConfig = undefined
  _httpHost = "localhost"
  _httpPort = 1984
  /** @type {(error: any) => boolean | undefined} */
  _errorFilter = undefined
  /** @type {Error | undefined} */
  _httpServerError = undefined
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

    systemTest.debugLog("Run started - send initialize")
    await timeout({timeout: 10_000, errorMessage: "Sending intialize to useSystemTest() timed out"}, async () => {
      await systemTest.getCommunicator().sendCommand({type: "initialize"})
    })

    systemTest.debugLog("getRootPath")
    const rootPath = systemTest.getRootPath()

    systemTest.debugLog(`Visit rootPath with dismissTo: ${rootPath}`)
    await systemTest.dismissTo(rootPath)
    systemTest.debugLog(`Dismissed to root path ${rootPath}`)

    try {
      systemTest.debugLog("findByTestID blankText")
      await systemTest.findByTestID("blankText", {useBaseSelector: false})
      systemTest.debugLog("Found blankText")

      systemTest.debugLog("resolvedCallback")
      await resolvedCallback(systemTest)
      systemTest.debugLog("Run callback completed")
    } catch (error) {
      systemTest.debugLog(`Run error caught, taking screenshot: ${error instanceof Error ? error.message : error}`)
      await systemTest.takeScreenshot()

      throw error
    }
  }

  /**
   * Creates a new SystemTest instance
   * @param {SystemTestArgs} [args]
   */
  constructor({host = "localhost", port = 8081, httpHost = "localhost", httpPort = 1984, httpConnectHost, debug = false, errorFilter, urlArgs, driver, ...restArgs} = {host: "localhost", port: 8081, httpHost: "localhost", httpPort: 1984, debug: false}) {
    const restArgsKeys = Object.keys(restArgs)

    if (restArgsKeys.length > 0) {
      throw new Error(`Unknown arguments: ${restArgsKeys.join(", ")}`)
    }

    this._host = host
    this._port = port
    this._httpHost = httpHost
    this._httpPort = httpPort
    this._httpConnectHost = httpConnectHost
    this._debug = debug
    this._errorFilter = errorFilter
    this._urlArgs = urlArgs
    this._rootPath = this.buildRootPath()
    this._driverConfig = driver
    this.driverAdapter = this.createDriver(driver)

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
    return this.getDriverAdapter().getWebDriver()
  }

  /** @returns {import("./drivers/webdriver-driver.js").default} */
  getDriverAdapter() {
    if (!this.driverAdapter) {
      throw new Error("Driver hasn't been initialized yet")
    }

    return this.driverAdapter
  }

  /**
   * @param {SystemTestDriverConfig} [driverConfig]
   * @returns {import("./drivers/webdriver-driver.js").default}
   */
  createDriver(driverConfig = {}) {
    const {type = "selenium", options, ...restArgs} = driverConfig
    const restArgsKeys = Object.keys(restArgs)

    if (restArgsKeys.length > 0) {
      throw new Error(`Unknown driver args: ${restArgsKeys.join(", ")}`)
    }

    if (type === "selenium") {
      return new SeleniumDriver({systemTest: this, options})
    }

    if (type === "appium") {
      return new AppiumDriver({systemTest: this, options})
    }

    throw new Error(`Unsupported driver type: ${type}`)
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
   * Logs messages
   * @param {any[]} args
   * @returns {void}
   */
  debugError(...args) {
    console.error("[SystemTest error]", ...args)
  }

  /**
   * Logs messages when debugging is enabled
   * @param {any[]} args
   * @returns {void}
   */
  debugLog(...args) {
    if (this._debug) {
      console.log("[SystemTest debug]", ...args)
    }
  }

  /** @returns {void} */
  throwIfHttpServerError() {
    if (this._httpServerError) {
      throw new Error(`HTTP server error: ${this._httpServerError.message}`)
    }
  }

  /**
   * @param {Error} error
   * @returns {void}
   */
  onHttpServerError = (error) => {
    const errorMessage = error instanceof Error ? error.message : String(error)

    this._httpServerError = error instanceof Error ? error : new Error(errorMessage)
    console.error(`HTTP server error: ${errorMessage}`)
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
    if (this.server?.close) {
      await timeout({timeout: this.getTimeouts(), errorMessage: "timeout while waiting for Scoundrel to stop"}, async () => await this.server.close())
    }
    await this.closeWebSocketServer(this.scoundrelWss, "Scoundrel WebSocket server")
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

    this.debugLog("getScoundrelClient: waiting for browser Scoundrel initialization")
    await timeout({timeout: timeoutMs, errorMessage: "Timed out waiting for Scoundrel to initialize"}, async () => {
      await this.getCommunicator().sendCommand({type: "waitForScoundrel"})
    })
    this.debugLog("getScoundrelClient: browser reported Scoundrel initialized")

    /**
     * @param {any} client
     * @returns {boolean}
     */
    const isOpenClient = (client) => client?.backend?.ws?.readyState === 1

    const existingClients = this.server.getClients?.()
    const openExistingClients = existingClients?.filter(isOpenClient)

    if (openExistingClients && openExistingClients.length > 0) {
      this.debugLog(`getScoundrelClient: using existing open client (${openExistingClients.length} available)`)
      return openExistingClients[openExistingClients.length - 1]
    }
    this.debugLog(`getScoundrelClient: no open cached clients, waiting for new connection (cached total: ${existingClients?.length ?? 0})`)

    if (!this.server.events?.on) {
      throw new Error("Scoundrel server events are unavailable")
    }

    let onNewClient
    const cleanupListener = () => {
      if (onNewClient) {
        this.server?.events.off("newClient", onNewClient)
      }
    }

    try {
      return await timeout({timeout: timeoutMs, errorMessage: "Timed out waiting for Scoundrel client"}, async () => await new Promise((resolve) => {
        onNewClient = (client) => {
          if (!isOpenClient(client)) return
          cleanupListener()
          this.debugLog("getScoundrelClient: received new open client")
          resolve(client)
        }

        this.server.events.on("newClient", onNewClient)
      }))
    } finally {
      cleanupListener()
    }
  }

  /**
   * Finds all elements by CSS selector
   * @param {string} selector
   * @param {FindArgs} [args]
   * @returns {Promise<import("selenium-webdriver").WebElement[]>}
   */
  async all(selector, args = {}) {
    return await this.getDriverAdapter().all(selector, args)
  }

  /**
   * Clicks an element that has children which fills out the element and would otherwise have caused a ElementClickInterceptedError
   * @param {string|import("selenium-webdriver").WebElement} elementOrIdentifier
   * @returns {Promise<void>}
   */
  /**
   * Clicks an element, allowing selector args when using a CSS selector.
   * @param {string|import("selenium-webdriver").WebElement} elementOrIdentifier
   * @param {FindArgs} [args]
   * @returns {Promise<void>}
   */
  async click(elementOrIdentifier, args) {
    await this.getDriverAdapter().click(elementOrIdentifier, args)
  }

  /**
   * Finds a single element by CSS selector
   * @param {string} selector
   * @param {FindArgs} [args]
   * @returns {Promise<import("selenium-webdriver").WebElement>}
   */
  async find(selector, args = {}) {
    return await this.getDriverAdapter().find(selector, args)
  }

  /**
   * Finds a single element by test ID
   * @param {string} testID
   * @param {FindArgs} [args]
   * @returns {Promise<import("selenium-webdriver").WebElement>}
   */
  async findByTestID(testID, args) {
    return await this.getDriverAdapter().findByTestID(testID, args)
  }

  /**
   * Finds a single element by CSS selector without waiting
   * @param {string} selector
   * @param {FindArgs} [args]
   * @returns {Promise<import("selenium-webdriver").WebElement>}
   */
  async findNoWait(selector, args = {}) {
    return await this.getDriverAdapter().findNoWait(selector, args)
  }

  /**
   * Gets browser logs
   * @returns {Promise<string[]>}
   */
  async getBrowserLogs() {
    return await this.getDriverAdapter().getBrowserLogs()
  }

  /** @returns {Promise<string>} */
  async getCurrentUrl() {
    return await this.getDriverAdapter().getCurrentUrl()
  }

  /** @returns {number} */
  getTimeouts() { return this.getDriverAdapter().getTimeouts() }

  /**
   * Interacts with an element by calling a method on it with the given arguments.
   * Retrying on ElementNotInteractableError, ElementClickInterceptedError, or StaleElementReferenceError.
   * @param {import("selenium-webdriver").WebElement|string|{selector: string} & FindArgs} elementOrIdentifier The element or a CSS selector to find the element.
   * @param {string} methodName The method name to call on the element.
   * @param {...any} args Arguments to pass to the method.
   * @returns {Promise<any>}
   */
  async interact(elementOrIdentifier, methodName, ...args) {
    return await this.getDriverAdapter().interact(elementOrIdentifier, methodName, ...args)
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
   * @param {WaitForNoSelectorArgs} [args]
   * @returns {Promise<void>}
   */
  async waitForNoSelector(selector, args = {}) {
    await this.getDriverAdapter().waitForNoSelector(selector, args)
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
   * @param {NotificationMessageArgs} [args]
   * @returns {Promise<void>}
   */
  async expectNotificationMessage(expectedNotificationMessage, args = {}) {
    const {dismiss = true, ...restArgs} = args

    if (Object.keys(restArgs).length > 0) {
      throw new Error(`Unexpected args: ${Object.keys(restArgs).join(", ")}`)
    }

    /** @type {string[]} */
    const allDetectedNotificationMessages = []
    let foundNotificationMessageElement
    let foundNotificationMessageCount

    await waitFor(async () => {
      const notificationMessageElements = await this.all("[data-testid='notification-message']", {useBaseSelector: false})

      for (const notificationMessageElement of notificationMessageElements) {
        const notificationMessage = (await this.getDriver().executeScript("return arguments[0].textContent;", notificationMessageElement))?.trim() || await notificationMessageElement.getText()

        if (!allDetectedNotificationMessages.includes(notificationMessage)) {
          allDetectedNotificationMessages.push(notificationMessage)
        }

        if (notificationMessage == expectedNotificationMessage) {
          foundNotificationMessageElement = notificationMessageElement
          foundNotificationMessageCount = await notificationMessageElement.getAttribute("data-count")
          return
        }
      }

      throw new Error(`Notification message ${expectedNotificationMessage} wasn't included in: ${allDetectedNotificationMessages.join(", ")}`)
    })

    if (foundNotificationMessageElement && dismiss) {
      await this.interact(foundNotificationMessageElement, "click") // Dismiss the notification message
      if (!foundNotificationMessageCount) {
        throw new Error("Expected notification message to have a data-count")
      }

      await this.waitForNoSelector(`[data-testid='notification-message'][data-count='${foundNotificationMessageCount}']`, {useBaseSelector: false})
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
  async getHTML() { return await this.getDriverAdapter().getHTML() }

  /**
   * Starts the system test
   * @returns {Promise<void>}
   */
  async start() {
    this.debugLog("Start called")
    const isNativeHost = process.env.SYSTEM_TEST_HOST === "native"

    if (isNativeHost) {
      this.currentUrl = "native://"
      this.debugLog("Using native app host")
    } else if (process.env.SYSTEM_TEST_HOST == "expo-dev-server") {
      this.currentUrl = `http://${this._host}:${this._port}`
      this.debugLog(`Using expo-dev-server at ${this.currentUrl}`)
    } else if (process.env.SYSTEM_TEST_HOST == "dist") {
      const connectHost = this._httpConnectHost ?? this._httpHost
      this.currentUrl = `http://${connectHost}:${this._httpPort}`

      this.debugLog(`Spawning HTTP server for dist on ${this._httpHost}:${this._httpPort}`)
      this.systemTestHttpServer = new SystemTestHttpServer({
        host: this._httpHost,
        port: this._httpPort,
        debug: this._debug,
        onError: this.onHttpServerError
      })

      this.debugLog("Starting HTTP server")
      await this.systemTestHttpServer.start()
      this.debugLog("Checking HTTP server health")
      await this.systemTestHttpServer.assertReachable({timeoutMs: this.getTimeouts()})
      this.debugLog("HTTP server started")
    } else {
      throw new Error("Please set SYSTEM_TEST_HOST to 'expo-dev-server', 'dist', or 'native'")
    }

    this.driverAdapter.setBaseUrl(this.currentUrl)
    this.debugLog("Starting driver")
    await this.driverAdapter.start()
    this.debugLog("Driver started")

    await this.setTimeouts(10000)
    this.debugLog("Timeouts set on driver")

    // Web socket server to communicate with browser
    this.debugLog("Starting WebSocket server")
    await this.startWebSocketServer()
    this.debugLog("WebSocket server started")

    if (!isNativeHost) {
      // Visit the root page and wait for Expo to be loaded and the app to appear
      this.debugLog("Visiting root path")
      const rootPath = this.getRootPath()
      await this.driverVisit(rootPath)
      this.debugLog(`Visited root path ${rootPath}`)

      try {
        this.debugLog("Finding root element body > #root")
        await this.find("body > #root", {useBaseSelector: false})
        this.debugLog("Found root element body > #root")

        this.debugLog("Finding systemTestingComponent")
        await this.findByTestID("systemTestingComponent", {useBaseSelector: false, timeout: 30000, visible: true})
        this.debugLog("Found systemTestingComponent")
        this.debugLog("Found root and systemTestingComponent")
      } catch (error) {
        this.debugLog("Error while finding root/systemTestingComponent, taking screenshot")
        await this.takeScreenshot()
        this.debugLog("Screenshot captured after root/systemTestingComponent lookup failure")
        throw error
      }
    } else {
      try {
        this.debugLog("Finding systemTestingComponent for native app")
        await this.findByTestID("systemTestingComponent", {useBaseSelector: false, timeout: 30000, visible: true})
        this.debugLog("Found systemTestingComponent for native app")
      } catch (error) {
        this.debugLog("Error while finding native systemTestingComponent, taking screenshot")
        await this.takeScreenshot()
        this.debugLog("Screenshot captured after native systemTestingComponent lookup failure")
        throw error
      }
    }

    // Wait for client to connect
    this.debugLog("Waiting for client WebSocket connection (opening)")
    this.debugLog(`WS state: ${this.ws?.readyState ?? "none"}`)
    this.debugLog("waitForClientWebSocket")
    await this.waitForClientWebSocket()
    this.debugLog("Client WebSocket connected")

    this._started = true
    this.debugLog("Marked system test as started")
    if (!isNativeHost) {
      this.debugLog("Setting base selector to focused systemTestingComponent")
      this.setBaseSelector("[data-testid='systemTestingComponent'][data-focussed='true']")
      this.debugLog("Base selector set")
    }
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
    await this.getDriverAdapter().restoreTimeouts()
  }

  /**
   * Sets driver timeouts
   * @param {number} newTimeout
   * @returns {Promise<void>}
   */
  async driverSetTimeouts(newTimeout) {
    await this.getDriverAdapter().driverSetTimeouts(newTimeout)
  }

  /**
   * Sets timeouts and stores the previous timeouts
   * @param {number} newTimeout
   * @returns {Promise<void>}
   */
  async setTimeouts(newTimeout) {
    await this.getDriverAdapter().setTimeouts(newTimeout)
  }

  /**
   * Waits for the client web socket to connect
   * @returns {Promise<void>}
   */
  async waitForClientWebSocket() {
    try {
      await timeout({timeout: 30000, errorMessage: "timeout while waiting for client WebSocket connection"}, () => new Promise((resolve, reject) => {
        if (this.ws) {
          resolve()
          return
        }

        this.waitForClientWebSocketPromiseReject = reject
        this.waitForClientWebSocketPromiseResolve = resolve
      }))
    } catch (error) {
      delete this.waitForClientWebSocketPromiseReject
      delete this.waitForClientWebSocketPromiseResolve
      throw error
    }
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
      this.debugError(error)

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
   * @param {{data: {message: string, backtrace?: string, type: string, value: any[]}}} args
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
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    await this.closeWebSocketServer(this.clientWss, "client WebSocket server")
    if (this.driverAdapter) {
      await this.driverAdapter.stop()
    }
    if (this.systemTestHttpServer) {
      await timeout({timeout: this.getTimeouts(), errorMessage: "timeout while closing HTTP server"}, async () => await this.systemTestHttpServer.close())
    }
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
    this.driverAdapter = this.createDriver(this._driverConfig)
    this.ws = null
    this.clientWss = undefined
    this.scoundrelWss = undefined
    this.server = undefined
    this.serverWebSocket = undefined
    this.systemTestHttpServer = undefined
    this._httpServerError = undefined
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
    await this.getDriverAdapter().driverVisit(path)
  }

  /**
   * Formats browser logs for console output and truncates overly long output.
   * @param {string[]} logs
   * @param {number} [maxLines]
   * @returns {string[]}
   */
  formatBrowserLogsForConsole(logs, maxLines = 200) {
    if (!Array.isArray(logs) || logs.length === 0) {
      return ["(no browser logs)"]
    }

    if (logs.length <= maxLines) {
      return logs
    }

    const keptLogs = logs.slice(logs.length - maxLines)
    const hiddenCount = logs.length - maxLines

    return [`(showing last ${maxLines} of ${logs.length} browser logs, ${hiddenCount} omitted)`, ...keptLogs]
  }

  /**
   * Prints browser logs to stdout for CI visibility when tests fail.
   * @param {string[]} logs
   * @returns {void}
   */
  printBrowserLogsForFailure(logs) {
    console.log("Browser logs:")

    for (const line of this.formatBrowserLogsForConsole(logs)) {
      console.log(line)
    }
  }

  /**
   * Takes a screenshot, saves HTML and browser logs
   * @returns {Promise<void>}
   */
  async takeScreenshot() {
    this.debugLog("Getting path for screenshots")
    const path = `${process.cwd()}/tmp/screenshots`

    this.debugLog(`Creating dir with recursive: ${path}`)
    await fs.mkdir(path, {recursive: true})

    this.debugLog("Getting screenshot image content")
    const imageContent = await timeout({timeout: 5000, errorMessage: "timeout while taking screenshot"}, async () => await this.getDriverAdapter().takeScreenshot())

    this.debugLog("Generating date variables")
    const now = new Date()
    const screenshotPath = `${path}/${moment(now).format("YYYY-MM-DD-HH-MM-SS")}.png`
    const htmlPath = `${path}/${moment(now).format("YYYY-MM-DD-HH-MM-SS")}.html`
    const logsPath = `${path}/${moment(now).format("YYYY-MM-DD-HH-MM-SS")}.logs.txt`

    this.debugLog("Getting browser logs")
    const logsText = await timeout({timeout: 5000, errorMessage: "timeout while reading browser logs"}, async () => await this.getBrowserLogs())
    const html = await timeout({timeout: 5000, errorMessage: "timeout while reading page HTML"}, async () => await this.getHTML())
    const htmlPretty = prettify(html)
    this.printBrowserLogsForFailure(logsText)

    this.debugLog("Writing files")
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
    await timeout(
      {timeout: this.getTimeouts(), errorMessage: `timeout while visiting path: ${path}`},
      async () => await this.getCommunicator().sendCommand({type: "visit", path})
    )
  }

  /**
   * Dismisses to a path in the browser
   * @param {string} path
   * @returns {Promise<void>}
   */
  async dismissTo(path) {
    await timeout(
      {timeout: this.getTimeouts(), errorMessage: `timeout while dismissing to path: ${path}`},
      async () => await this.getCommunicator().sendCommand({type: "dismissTo", path})
    )
  }

  /**
   * @param {WebSocketServer | undefined} wss
   * @param {string} [label]
   * @returns {Promise<void>}
   */
  async closeWebSocketServer(wss, label = "WebSocket server") {
    if (!wss) return

    await timeout({timeout: this.getTimeouts(), errorMessage: `timeout while closing ${label}`}, async () => await new Promise((resolve, reject) => {
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
    }))
  }
}
