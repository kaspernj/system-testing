import {Builder, By} from "selenium-webdriver"
import chrome from "selenium-webdriver/chrome.js"
import {digg} from "diggerize"
import fs from "node:fs/promises"
import logging from "selenium-webdriver/lib/logging.js"
import moment from "moment"
import {prettify} from "htmlfy"
import SystemTestCommunicator from "./system-test-communicator.js"
import SystemTestHttpServer from "./system-test-http-server.js"
import {WebSocketServer} from "ws"

class ElementNotFoundError extends Error { }

export default class SystemTest {
  static current() {
    if (!globalThis.systemTest) {
      globalThis.systemTest = new SystemTest()
    }

    return globalThis.systemTest
  }

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

  constructor() {
    this.communicator = new SystemTestCommunicator({onCommand: this.onCommandReceived})
    this._responses = {}
    this._sendCount = 0
  }

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

  // Clicks an element that has children which fills out the element and would otherwise have caused a ElementClickInterceptedError
  async click(element) {
    const actions = this.driver.actions({async: true})

    await actions.move({origin: element}).click().perform()
  }

  async find(selector, args = {}) {
    const elements = await this.all(selector, args)

    if (elements.length > 1) {
      throw new Error(`More than 1 elements (${elements.length}) was found by CSS: ${selector}`)
    }

    if (!elements[0]) {
      throw new ElementNotFoundError(`Element couldn't be found by CSS: ${selector}`)
    }

    return elements[0]
  }

  findByTestID = async (testID, args) => await this.find(`[data-testid='${testID}']`, args)

  async findNoWait(selector) {
    await this.driverSetTimeouts(0)

    try {
      return await this.find(selector)
    } finally {
      await this.restoreTimeouts()
    }
  }

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

  async notificationMessages() {
    const notificationMessageElements = await this.all("[data-class='notification-message']")
    const notificationMessageTexts = []

    for (const notificationMessageElement of notificationMessageElements) {
      const text = await notificationMessageElement.getText()

      notificationMessageTexts.push(text)
    }

    return notificationMessageTexts
  }

  isStarted() {
    return this._started
  }

  async getHTML() {
    return await this.driver.getPageSource()
  }

  async start() {
    if (process.env.SYSTEM_TEST_HOST == "expo-dev-server") {
      this.currentUrl = "http://localhost:8081"
    } else if (process.env.SYSTEM_TEST_HOST == "dist") {
      this.currentUrl = "http://localhost:1984"
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

    await this.setTimeouts(4000)

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

  async restoreTimeouts() {
    if (!this._timeouts) {
      throw new Error("Timeouts haven't previously been set")
    }

    await this.driverSetTimeouts(this._timeouts)
  }

  async driverSetTimeouts(newTimeout) {
    await this.driver.manage().setTimeouts({implicit: newTimeout})
  }

  async setTimeouts(newTimeout) {
    this._timeouts = newTimeout
    await this.restoreTimeouts()
  }

  waitForClientWebSocket() {
    return new Promise((resolve) => {
      if (this.ws) {
        resolve()
      }

      this.waitForClientWebSocketPromiseResolve = resolve
    })
  }

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

    if (data.trace) {
      const errorTrace = error.trace

      error.trace = `${data.trace}${errorTrace}`
    }

    console.error(error)
  }

  async stop() {
    this.systemTestHttpServer?.close()
    this.wss?.close()
    await this.driver.quit()
  }

  async driverVisit(path) {
    const url = `${this.currentUrl}${path}`

    await this.driver.get(url)
  }

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

    console.log("Logs:", logsPath)
    console.log("Screenshot:", screenshotPath)
    console.log("HTML:", htmlPath)
  }

  async visit(path) {
    await this.communicator.sendCommand({type: "visit", path})
  }
}
