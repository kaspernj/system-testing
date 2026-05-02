// @ts-check

import fs from "node:fs/promises"
import {Key} from "selenium-webdriver"
import moment from "moment"
import {prettify} from "htmlfy"
import {waitFor} from "awaitery"
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
/**
 * @typedef {object} BrowserNavigationArgs
 * @property {number} [timeout] Override the timeout for this navigation command.
 */
/**
 * @typedef {object} BrowserPathWaitArgs
 * @property {number} [timeout] Override the timeout for this path wait.
 */
/**
 * @typedef {object} BrowserTextWaitArgs
 * @property {number} [timeout] Override the timeout for this text wait.
 */
/**
 * @typedef {object} BrowserCurrentUrlWaitArgs
 * @property {number} [timeout] Override the timeout for this URL wait.
 */
/**
 * @typedef {object} BrowserTestIDInputArgs
 * @property {number} [timeout] Override timeout for the input lookup.
 */

/**
 * Builds a data-testid CSS selector.
 * @param {string} testID Raw value from a `data-testid` attribute.
 * @returns {string} CSS attribute selector.
 */
function testIdSelector(testID) {
  return `[data-testid="${cssAttributeValue(testID)}"]`
}

/**
 * Escapes a value for use inside a double-quoted CSS attribute selector.
 * @param {string | number} value Raw attribute value.
 * @returns {string} Escaped selector value.
 */
function cssAttributeValue(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, "\\\"")
}

/**
 * Extracts the RGB channels from CSS `rgb(...)`/`rgba(...)` values or an RGB fragment.
 * @param {string} value CSS color value or RGB fragment like `30, 41, 59`.
 * @returns {[number, number, number] | undefined}
 */
function cssRgbChannels(value) {
  const rgbMatch = value.match(/rgba?\(([^)]+)\)/)
  const channelsValue = rgbMatch ? rgbMatch[1] : value
  const channels = channelsValue
    .replace(/\s*\/.*$/, "")
    .split(/[,\s]+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((channel) => Number(channel))

  if (channels.length !== 3 || channels.some((channel) => !Number.isFinite(channel))) return undefined

  return /** @type {[number, number, number]} */ (channels)
}

/**
 * Checks whether a browser-normalized CSS color matches the RGB triplet.
 * @param {string} actualValue Browser-normalized CSS color.
 * @param {string} rgbFragment RGB fragment like `30, 41, 59`.
 * @returns {boolean} Whether the RGB channels match.
 */
function cssValueMatchesRgb(actualValue, rgbFragment) {
  const actualChannels = cssRgbChannels(actualValue)
  const expectedChannels = cssRgbChannels(rgbFragment)

  if (!actualChannels || !expectedChannels) return false

  return actualChannels.every((actualChannel, index) => actualChannel === expectedChannels[index])
}

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
   * Waits until the current URL pathname exactly matches the expected path.
   * @param {string} expectedPath
   * @param {BrowserPathWaitArgs} [args]
   * @returns {Promise<void>}
   */
  async waitForPath(expectedPath, args = {}) {
    await waitFor({timeout: this.getCommandTimeout(args.timeout)}, async () => {
      const currentUrl = await this.getCurrentUrl()
      const currentPath = new URL(currentUrl).pathname

      if (currentPath !== expectedPath) {
        throw new Error(`Timed out waiting for path ${expectedPath}. Current URL: ${currentUrl}`)
      }
    })
  }

  /**
   * Waits until the current URL exactly matches the expected URL.
   * @param {string} expectedUrl Exact URL expected.
   * @param {BrowserCurrentUrlWaitArgs} [args] Optional timeout.
   * @returns {Promise<void>}
   */
  async waitForCurrentUrl(expectedUrl, args = {}) {
    await waitFor({timeout: this.getCommandTimeout(args.timeout)}, async () => {
      const currentUrl = await this.getCurrentUrl()

      if (currentUrl !== expectedUrl) {
        throw new Error(`Timed out waiting for URL ${expectedUrl}. Current URL: ${currentUrl}`)
      }
    })
  }

  /**
   * Waits until the current URL contains a fragment.
   * @param {string} expectedFragment Fragment that should appear.
   * @param {BrowserCurrentUrlWaitArgs} [args] Optional timeout.
   * @returns {Promise<void>}
   */
  async waitForUrlContains(expectedFragment, args = {}) {
    await waitFor({timeout: this.getCommandTimeout(args.timeout)}, async () => {
      const currentUrl = await this.getCurrentUrl()

      if (!currentUrl.includes(expectedFragment)) {
        throw new Error(`Timed out waiting for URL to include ${expectedFragment}. Current URL: ${currentUrl}`)
      }
    })
  }

  /**
   * Waits until the current URL does not contain a fragment.
   * @param {string} unexpectedFragment Fragment that should disappear.
   * @param {BrowserCurrentUrlWaitArgs} [args] Optional timeout.
   * @returns {Promise<void>}
   */
  async waitForUrlExcludes(unexpectedFragment, args = {}) {
    await waitFor({timeout: this.getCommandTimeout(args.timeout)}, async () => {
      const currentUrl = await this.getCurrentUrl()

      if (currentUrl.includes(unexpectedFragment)) {
        throw new Error(`Timed out waiting for URL to exclude ${unexpectedFragment}. Current URL: ${currentUrl}`)
      }
    })
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
   * @param {import("selenium-webdriver").WebElement|string|{selector: string} & import("./system-test.js").InteractArgs} elementOrIdentifier
   * @param {string} methodName
   * @param {...any} args
   * @returns {Promise<any>}
   */
  async interact(elementOrIdentifier, methodName, ...args) {
    return await this.getDriverAdapter().interact(elementOrIdentifier, methodName, ...args)
  }

  /**
   * Clears an input and sends replacement keys through retryable browser interactions.
   * @param {import("selenium-webdriver").WebElement|string|{selector: string} & import("./system-test.js").InteractArgs} elementOrIdentifier
   * @param {string} nextValue
   * @returns {Promise<void>}
   */
  async clearAndSendKeys(elementOrIdentifier, nextValue) {
    await this.interact(elementOrIdentifier, "click")
    await this.interact(elementOrIdentifier, "sendKeys", Key.chord(Key.CONTROL, "a"), Key.BACK_SPACE, nextValue)
  }

  /**
   * Replaces an input-like element's value by test id.
   * @param {string} testID Field `data-testid` to target.
   * @param {string} nextValue Text to leave in the field.
   * @param {BrowserTestIDInputArgs} [args] Optional lookup timeout.
   * @returns {Promise<void>}
   */
  async replaceTestIDInputValue(testID, nextValue, args = {}) {
    await this.clearAndSendKeys({
      selector: testIdSelector(testID),
      timeout: args.timeout,
      withFallback: true
    }, nextValue)
  }

  /**
   * Waits until a test id contains expected visible text.
   * @param {string} testID Element `data-testid` to inspect.
   * @param {string} expectedText Fragment that must appear in the element text.
   * @param {BrowserTextWaitArgs} [args] Optional timeout.
   * @returns {Promise<void>}
   */
  async waitForTestIDText(testID, expectedText, args = {}) {
    await waitFor({timeout: this.getCommandTimeout(args.timeout)}, async () => {
      const element = await this.findByTestID(testID, {timeout: 0})
      const actualText = await element.getText()

      if (!actualText.includes(expectedText)) {
        throw new Error(`Timed out waiting for text ${expectedText}. Last text was ${actualText}`)
      }
    })
  }

  /**
   * Waits until a test id no longer contains excluded visible text.
   * @param {string} testID Element `data-testid` to inspect.
   * @param {string} excludedText Fragment that should disappear from the element text.
   * @param {BrowserTextWaitArgs} [args] Optional timeout.
   * @returns {Promise<void>}
   */
  async waitForTestIDTextExcludes(testID, excludedText, args = {}) {
    await waitFor({timeout: this.getCommandTimeout(args.timeout)}, async () => {
      const element = await this.findByTestID(testID, {timeout: 0})
      const actualText = await element.getText()

      if (actualText.includes(excludedText)) {
        throw new Error(`Timed out waiting for text to exclude ${excludedText}. Last text was ${actualText}`)
      }
    })
  }

  /**
   * Asserts a rendered element has a CSS color from the expected palette.
   * @param {string} testID Element `data-testid` to inspect.
   * @param {string} propertyName CSS property to read.
   * @param {string} expectedRgb Expected RGB fragment.
   * @param {string} lightRgb Disallowed RGB fragment.
   * @param {string} description Human-readable element description.
   * @returns {Promise<void>}
   */
  async expectTestIDCssColor(testID, propertyName, expectedRgb, lightRgb, description) {
    const element = await this.findByTestID(testID)
    const actualValue = await element.getCssValue(propertyName)

    if (cssValueMatchesRgb(actualValue, lightRgb)) {
      throw new Error(`Expected ${description} to avoid the light palette, got ${propertyName} ${actualValue}`)
    }
    if (!cssValueMatchesRgb(actualValue, expectedRgb)) {
      throw new Error(`Expected ${description} to include rgb(${expectedRgb}), got ${propertyName} ${actualValue}`)
    }
  }

  /**
   * Scrolls an element into view.
   * @param {import("selenium-webdriver").WebElement|string|{selector: string} & import("./system-test.js").FindArgs} elementOrIdentifier
   * @param {import("./system-test.js").FindArgs} [args]
   * @returns {Promise<void>}
   */
  async scrollIntoView(elementOrIdentifier, args) {
    await this.getDriverAdapter().scrollIntoView(elementOrIdentifier, args)
  }

  /**
   * Scrolls the element with the given test ID into view.
   * @param {string} testID
   * @param {import("./system-test.js").FindArgs} [args]
   * @returns {Promise<void>}
   */
  async scrollTestIdIntoView(testID, args) {
    await this.getDriverAdapter().scrollTestIdIntoView(testID, args)
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
   * @param {number | undefined} timeoutOverride
   * @returns {number}
   */
  getCommandTimeout(timeoutOverride) {
    if (timeoutOverride !== undefined) {
      return timeoutOverride
    }

    return this.getTimeouts()
  }

  /**
   * @param {string} path
   * @returns {Promise<void>}
   */
  async driverVisit(path) {
    await this.getDriverAdapter().driverVisit(path)
  }

  /** @returns {Promise<void>} */
  async deleteAllCookies() {
    await this.getDriverAdapter().deleteAllCookies()
  }

  /**
   * Add a cookie to the active driver session for the current document
   * origin. Useful when an out-of-band login (curl, fetch, etc.) returned
   * a `Set-Cookie` value and the test needs the browser to start
   * authenticated without driving the sign-in UI.
   *
   * The driver must already be on a page whose origin/domain matches the
   * cookie domain, otherwise Selenium will reject the call.
   * @param {{name: string, value: string, domain?: string, path?: string, secure?: boolean, httpOnly?: boolean, expiry?: number, sameSite?: "Strict" | "Lax" | "None"}} cookie
   * @returns {Promise<void>}
   */
  async addCookie(cookie) {
    if (!cookie || typeof cookie.name !== "string" || cookie.name.length === 0) {
      throw new Error("addCookie requires a non-empty `name`")
    }

    if (typeof cookie.value !== "string") {
      throw new Error("addCookie requires a string `value`")
    }

    await this.getDriver().manage().addCookie(cookie)
  }

  /**
   * Run an arbitrary script in the active browser session and return the
   * resolved value. `script` is the function body executed in the browser
   * (`new Function("...")`-style); `args` are forwarded as `arguments[i]`.
   * Asynchronous scripts must `return` a Promise, which Selenium awaits.
   *
   * Useful for verification flows that need to call into application code
   * (e.g. `fetch("/development/sign-in", {...})`) without going through the
   * UI, or to read browser state the existing finder/interact commands
   * don't expose.
   * @param {string} script
   * @param {...any} args
   * @returns {Promise<any>}
   */
  async executeScript(script, ...args) {
    if (typeof script !== "string" || script.length === 0) {
      throw new Error("executeScript requires a non-empty `script` string")
    }

    return await this.getDriver().executeScript(script, ...args)
  }

  /**
   * @param {string} type
   * @param {string} path
   * @param {BrowserNavigationArgs} [args]
   * @returns {Promise<void>}
   */
  async sendBrowserCommand(type, path, args = {}) {
    if (!this.communicator) {
      throw new Error("Communicator hasn't been initialized yet")
    }

    await timeout(
      {timeout: this.getCommandTimeout(args.timeout), errorMessage: `timeout while sending browser command ${type}: ${path}`},
      async () => await /** @type {NonNullable<typeof this.communicator>} */ (this.communicator).sendCommand({type, path})
    )
  }

  /**
   * Visits a path using the injected browser helper when available, otherwise navigates directly with the driver.
   * @param {string} path
   * @param {BrowserNavigationArgs} [args]
   * @returns {Promise<void>}
   */
  async visit(path, args = {}) {
    if (this.communicatorExists() && (!this.communicator?.ws || this.communicator.ws.readyState === 1)) {
      await this.sendBrowserCommand("visit", path, args)
    } else {
      await timeout(
        {timeout: this.getCommandTimeout(args.timeout), errorMessage: `timeout while visiting path: ${path}`},
        async () => await this.driverVisit(path)
      )
    }
  }

  /**
   * Dismisses to a path via the injected browser helper when available, otherwise navigates directly with the driver.
   * @param {string} path
   * @param {BrowserNavigationArgs} [args]
   * @returns {Promise<void>}
   */
  async dismissTo(path, args = {}) {
    if (this.communicatorExists() && (!this.communicator?.ws || this.communicator.ws.readyState === 1)) {
      await this.sendBrowserCommand("dismissTo", path, args)
    } else {
      await timeout(
        {timeout: this.getCommandTimeout(args.timeout), errorMessage: `timeout while dismissing to path: ${path}`},
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
