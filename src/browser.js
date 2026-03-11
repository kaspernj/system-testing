// @ts-check

import fs from "node:fs/promises"
import moment from "moment"
import {prettify} from "htmlfy"
import timeout from "awaitery/build/timeout.js"
import SeleniumDriver from "./drivers/selenium-driver.js"
import AppiumDriver from "./drivers/appium-driver.js"

/**
 * @typedef {object} BrowserArgs
 * @property {boolean} [debug] Enable debug logging.
 * @property {BrowserDriverConfig} [driver] Driver configuration.
 * @property {import("./system-test-communicator.js").default} [communicator] Optional command communicator for helper-driven navigation.
 * @property {string} [screenshotsPath] Directory used for saved screenshots and browser artifacts.
 */
/**
 * @typedef {object} BrowserDriverConfig
 * @property {"selenium"|"appium"} [type] Driver implementation to use.
 * @property {Record<string, any>} [options] Driver-specific options.
 */

/** Generic browser session wrapper around the configured driver. */
export default class Browser {
  /** @type {import("selenium-webdriver").WebDriver | undefined} */
  driver = undefined

  /** @type {import("./drivers/webdriver-driver.js").default | undefined} */
  driverAdapter = undefined

  _debug = false
  /** @type {BrowserDriverConfig | undefined} */
  _driverConfig = undefined
  /** @type {Error | undefined} */
  _httpServerError = undefined

  /** @param {BrowserArgs} [args] */
  constructor({debug = false, driver, communicator, screenshotsPath = `${process.cwd()}/tmp/screenshots`, ...restArgs} = {}) {
    const restArgsKeys = Object.keys(restArgs)

    if (restArgsKeys.length > 0) {
      throw new Error(`Unknown browser arguments: ${restArgsKeys.join(", ")}`)
    }

    this._debug = debug
    this._driverConfig = driver
    this._screenshotsPath = screenshotsPath
    this.communicator = communicator
    this.driverAdapter = this.createDriver(driver)
  }

  /**
   * @param {BrowserDriverConfig} [driverConfig]
   * @returns {import("./drivers/webdriver-driver.js").default}
   */
  createDriver(driverConfig = {}) {
    const {type = "selenium", options, ...restArgs} = driverConfig
    const restArgsKeys = Object.keys(restArgs)

    if (restArgsKeys.length > 0) {
      throw new Error(`Unknown driver args: ${restArgsKeys.join(", ")}`)
    }

    if (type === "selenium") {
      return new SeleniumDriver({browser: this, options})
    }

    if (type === "appium") {
      return new AppiumDriver({browser: this, options})
    }

    throw new Error(`Unsupported driver type: ${type}`)
  }

  /**
   * @param {import("./system-test-communicator.js").default | undefined} communicator
   * @returns {void}
   */
  setCommunicator(communicator) {
    this.communicator = communicator
  }

  /** @returns {boolean} */
  communicatorExists() {
    return Boolean(this.communicator)
  }

  /**
   * @param {string} baseSelector
   * @returns {void}
   */
  setBaseSelector(baseSelector) { this._baseSelector = baseSelector }

  /** @returns {string | undefined} */
  getBaseSelector() { return this._baseSelector }

  /**
   * @param {string} selector
   * @returns {string}
   */
  getSelector(selector) {
    return this.getBaseSelector() ? `${this.getBaseSelector()} ${selector}` : selector
  }

  /**
   * @param {...any} args
   * @returns {void}
   */
  debugError(...args) {
    console.error("[Browser error]", ...args)
  }

  /**
   * @param {...any} args
   * @returns {void}
   */
  debugLog(...args) {
    if (this._debug) {
      console.log("[Browser debug]", ...args)
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

  /** @returns {number} */
  getTimeouts() { return this.getDriverAdapter().getTimeouts() }

  /** @returns {Promise<void>} */
  async restoreTimeouts() {
    await this.getDriverAdapter().restoreTimeouts()
  }

  /**
   * @param {number} newTimeout
   * @returns {Promise<void>}
   */
  async driverSetTimeouts(newTimeout) {
    await this.getDriverAdapter().driverSetTimeouts(newTimeout)
  }

  /**
   * @param {number} newTimeout
   * @returns {Promise<void>}
   */
  async setTimeouts(newTimeout) {
    await this.getDriverAdapter().setTimeouts(newTimeout)
  }

  /** @returns {Promise<string[]>} */
  async getBrowserLogs() {
    return await this.getDriverAdapter().getBrowserLogs()
  }

  /** @returns {Promise<string>} */
  async getCurrentUrl() {
    return await this.getDriverAdapter().getCurrentUrl()
  }

  /**
   * @param {string} selector
   * @param {import("./system-test.js").FindArgs} [args]
   * @returns {Promise<import("selenium-webdriver").WebElement[]>}
   */
  async all(selector, args = {}) {
    return await this.getDriverAdapter().all(selector, args)
  }

  /**
   * @param {string} selector
   * @param {import("./system-test.js").FindArgs} [args]
   * @returns {Promise<import("selenium-webdriver").WebElement>}
   */
  async find(selector, args = {}) {
    return await this.getDriverAdapter().find(selector, args)
  }

  /**
   * @param {string} testID
   * @param {import("./system-test.js").FindArgs} [args]
   * @returns {Promise<import("selenium-webdriver").WebElement>}
   */
  async findByTestID(testID, args) {
    return await this.getDriverAdapter().findByTestID(testID, args)
  }

  /**
   * @param {string} selector
   * @param {import("./system-test.js").FindArgs} [args]
   * @returns {Promise<import("selenium-webdriver").WebElement>}
   */
  async findNoWait(selector, args = {}) {
    return await this.getDriverAdapter().findNoWait(selector, args)
  }

  /**
   * @param {string | import("selenium-webdriver").WebElement} elementOrIdentifier
   * @param {import("./system-test.js").FindArgs} [args]
   * @returns {Promise<void>}
   */
  async click(elementOrIdentifier, args) {
    await this.getDriverAdapter().click(elementOrIdentifier, args)
  }

  /**
   * @param {import("selenium-webdriver").WebElement|string|{selector: string} & import("./system-test.js").FindArgs} elementOrIdentifier
   * @param {string} methodName
   * @param {...any} args
   * @returns {Promise<any>}
   */
  async interact(elementOrIdentifier, methodName, ...args) {
    return await this.getDriverAdapter().interact(elementOrIdentifier, methodName, ...args)
  }

  /**
   * @param {string} selector
   * @param {import("./system-test.js").WaitForNoSelectorArgs} [args]
   * @returns {Promise<void>}
   */
  async waitForNoSelector(selector, args = {}) {
    await this.getDriverAdapter().waitForNoSelector(selector, args)
  }

  /**
   * @param {string} selector
   * @param {import("./system-test.js").FindArgs} [args]
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

  /** @returns {Promise<string>} */
  async getHTML() {
    return await this.getDriverAdapter().getHTML()
  }

  /**
   * @param {string} path
   * @returns {Promise<void>}
   */
  async driverVisit(path) {
    await this.getDriverAdapter().driverVisit(path)
  }

  /**
   * @param {string} type
   * @param {string} path
   * @returns {Promise<void>}
   */
  async sendBrowserCommand(type, path) {
    if (!this.communicator) {
      throw new Error("Communicator hasn't been initialized yet")
    }

    await timeout(
      {timeout: this.getTimeouts(), errorMessage: `timeout while sending browser command ${type}: ${path}`},
      async () => await this.communicator.sendCommand({type, path})
    )
  }

  /**
   * Visits a path using the injected browser helper when available, otherwise navigates directly with the driver.
   * @param {string} path
   * @returns {Promise<void>}
   */
  async visit(path) {
    if (this.communicatorExists()) {
      await this.sendBrowserCommand("visit", path)
    } else {
      await timeout(
        {timeout: this.getTimeouts(), errorMessage: `timeout while visiting path: ${path}`},
        async () => await this.driverVisit(path)
      )
    }
  }

  /**
   * Dismisses to a path via the injected browser helper when available, otherwise navigates directly with the driver.
   * @param {string} path
   * @returns {Promise<void>}
   */
  async dismissTo(path) {
    if (this.communicatorExists()) {
      await this.sendBrowserCommand("dismissTo", path)
    } else {
      await timeout(
        {timeout: this.getTimeouts(), errorMessage: `timeout while dismissing to path: ${path}`},
        async () => await this.driverVisit(path)
      )
    }
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
   * Takes a screenshot, writes HTML/browser logs to disk, and returns the collected artifacts.
   * @returns {Promise<{currentUrl: string, html: string, htmlPath: string, logs: string[], logsPath: string, screenshotPath: string}>}
   */
  async takeScreenshot() {
    this.debugLog("Getting path for screenshots")
    const path = this._screenshotsPath

    this.debugLog(`Creating dir with recursive: ${path}`)
    await fs.mkdir(path, {recursive: true})

    this.debugLog("Getting screenshot image content")
    const imageContent = await timeout({timeout: 5000, errorMessage: "timeout while taking screenshot"}, async () => await this.getDriverAdapter().takeScreenshot())

    this.debugLog("Generating date variables")
    const now = new Date()
    const timestamp = moment(now).format("YYYY-MM-DD-HH-MM-SS")
    const screenshotPath = `${path}/${timestamp}.png`
    const htmlPath = `${path}/${timestamp}.html`
    const logsPath = `${path}/${timestamp}.logs.txt`

    this.debugLog("Getting browser logs")
    const logs = await timeout({timeout: 5000, errorMessage: "timeout while reading browser logs"}, async () => await this.getBrowserLogs())
    const html = await timeout({timeout: 5000, errorMessage: "timeout while reading page HTML"}, async () => await this.getHTML())
    const htmlPretty = prettify(html)
    this.printBrowserLogsForFailure(logs)

    this.debugLog("Writing files")
    await fs.writeFile(htmlPath, htmlPretty)
    await fs.writeFile(logsPath, logs.join("\n"))
    await fs.writeFile(screenshotPath, imageContent, "base64")

    const currentUrl = await this.getCurrentUrl()

    console.log("Current URL:", currentUrl)
    console.log("Logs:", logsPath)
    console.log("Screenshot:", screenshotPath)
    console.log("HTML:", htmlPath)

    return {
      currentUrl,
      html,
      htmlPath,
      logs,
      logsPath,
      screenshotPath
    }
  }

  /** @returns {Promise<void>} */
  async stopDriver() {
    if (this.driverAdapter) {
      await this.driverAdapter.stop()
    }
  }
}
