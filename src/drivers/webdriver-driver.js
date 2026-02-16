import {By, error as SeleniumError} from "selenium-webdriver"
import logging from "selenium-webdriver/lib/logging.js"
import {wait} from "awaitery"
import timeout from "awaitery/build/timeout.js"

/**
 * @typedef {object} FindArgs
 * @property {number} [timeout] Override timeout for lookup.
 * @property {boolean} [visible] Whether to require elements to be visible.
 * @property {boolean} [useBaseSelector] Whether to scope by the base selector.
 */
/**
 * @typedef {object} WaitForNoSelectorArgs
 * @property {boolean} [useBaseSelector] Whether to scope by the base selector.
 */

class ElementNotFoundError extends Error { }
const {WebDriverError} = SeleniumError

/**
 * Base driver using selenium-webdriver sessions.
 */
export default class WebDriverDriver {
  /**
   * @param {object} args
   * @param {import("../system-test.js").default} args.systemTest
   * @param {Record<string, any>} [args.options]
   */
  constructor({systemTest, options = {}}) {
    this.systemTest = systemTest
    this.options = options
    this.baseUrl = undefined
    this.webDriver = undefined
    this._driverTimeouts = 5000
    this._timeouts = 5000
  }

  /**
   * @param {string} baseUrl
   * @returns {void}
   */
  setBaseUrl(baseUrl) {
    this.baseUrl = baseUrl
  }

  /** @returns {string} */
  getBaseUrl() {
    if (!this.baseUrl) {
      throw new Error("Driver base URL has not been set")
    }

    return this.baseUrl
  }

  /** @returns {number} */
  getTimeouts() { return this._timeouts }

  /**
   * @returns {import("selenium-webdriver").WebDriver}
   */
  getWebDriver() {
    if (!this.webDriver) throw new Error("Driver hasn't been initialized yet")
    this.systemTest.throwIfHttpServerError()

    return this.webDriver
  }

  /**
   * @param {import("selenium-webdriver").WebDriver} webDriver
   * @returns {void}
   */
  setWebDriver(webDriver) {
    this.webDriver = webDriver
    this.systemTest.driver = webDriver
  }

  /**
   * @returns {Promise<void>}
   */
  async start() {
    throw new Error("start() must be implemented by the driver")
  }

  /**
   * @returns {Promise<void>}
   */
  async stop() {
    if (this.webDriver) {
      await timeout({timeout: this.getTimeouts(), errorMessage: "timeout while quitting WebDriver"}, async () => await this.webDriver.quit())
    }

    this.webDriver = undefined
    this.systemTest.driver = undefined
  }

  /**
   * @param {number} newTimeout
   * @returns {Promise<void>}
   */
  async driverSetTimeouts(newTimeout) {
    this._driverTimeouts = newTimeout
    await this.getWebDriver().manage().setTimeouts({implicit: newTimeout})
  }

  /**
   * @returns {Promise<void>}
   */
  async restoreTimeouts() {
    if (!this.getTimeouts()) {
      throw new Error("Timeouts haven't previously been set")
    }

    await this.driverSetTimeouts(this.getTimeouts())
  }

  /**
   * @param {number} newTimeout
   * @returns {Promise<void>}
   */
  async setTimeouts(newTimeout) {
    this._timeouts = newTimeout
    await this.restoreTimeouts()
  }

  /**
   * @param {string} selector
   * @returns {string}
   */
  getSelector(selector) {
    return this.systemTest.getSelector(selector)
  }

  /**
   * @param {string} path
   * @returns {Promise<void>}
   */
  async driverVisit(path) {
    const url = `${this.getBaseUrl()}${path}`

    await this.getWebDriver().get(url)
  }

  /** @returns {Promise<string>} */
  async getCurrentUrl() {
    try {
      return await this.getWebDriver().getCurrentUrl()
    } catch {
      return ""
    }
  }

  /** @returns {Promise<string>} */
  async getHTML() {
    return await this.getWebDriver().getPageSource()
  }

  /** @returns {Promise<string>} */
  async takeScreenshot() {
    return await this.getWebDriver().takeScreenshot()
  }

  /**
   * Gets browser logs
   * @returns {Promise<string[]>}
   */
  async getBrowserLogs() {
    let entries

    try {
      entries = await this.getWebDriver().manage().logs().get(logging.Type.BROWSER)
    } catch {
      return []
    }
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
   * Finds all elements by CSS selector
   * @param {string} selector
   * @param {FindArgs} [args]
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
    const startTime = Date.now()
    const getTimeLeft = () => Math.max(actualTimeout - (Date.now() - startTime), 0)
    const getElements = async () => {
      const foundElements = await this.getWebDriver().findElements(By.css(actualSelector))

      if (visible !== true && visible !== false) {
        return foundElements
      }

      const filteredElements = []

      for (const element of foundElements) {
        const isDisplayed = await element.isDisplayed()

        if (visible && !isDisplayed) continue
        if (!visible && isDisplayed) continue

        filteredElements.push(element)
      }

      return filteredElements
    }
    let elements = []

    while (true) {
      const timeLeft = actualTimeout == 0 ? 0 : getTimeLeft()

      try {
        if (timeLeft == 0) {
          elements = await getElements()
        } else {
          await this.getWebDriver().wait(async () => {
            elements = await getElements()

            return elements.length > 0
          }, timeLeft)
        }

        break
      } catch (error) {
        let isStaleElementError = false

        if (error instanceof SeleniumError.StaleElementReferenceError) {
          isStaleElementError = true
        } else if (error instanceof WebDriverError && error.message.toLowerCase().includes("stale element reference")) {
          isStaleElementError = true
        }

        if (
          (error instanceof SeleniumError.TimeoutError || isStaleElementError)
          && getTimeLeft() > 0
        ) {
          continue
        }

        throw new Error(`Couldn't get elements with selector: ${actualSelector}: ${error instanceof Error ? error.message : error}`)
      }
    }
    return elements
  }

  /**
   * Finds a single element by CSS selector
   * @param {string} selector
   * @param {FindArgs} [args]
   * @returns {Promise<import("selenium-webdriver").WebElement>}
   */
  async find(selector, args = {}) {
    const startTime = Date.now()
    let elements = []

    try {
      elements = await this.all(selector, args)
    } catch (error) {
      // Re-throw to recover stack trace
      if (error instanceof Error) {
        if (error.message.startsWith("Wait timed out after")) {
          elements = []
        }

        throw new Error(`${error.constructor.name} - ${error.message} (selector: ${this.getSelector(selector)})`)
      } else {
        throw new Error(`${typeof error} - ${error} (selector: ${this.getSelector(selector)})`)
      }
    }

    if (elements.length > 1) {
      throw new Error(`More than 1 elements (${elements.length}) was found by CSS: ${this.getSelector(selector)}`)
    }

    if (!elements[0]) {
      const elapsedSeconds = (Date.now() - startTime) / 1000
      throw new ElementNotFoundError(`Element couldn't be found after ${elapsedSeconds.toFixed(2)}s by CSS: ${this.getSelector(selector)}`)
    }

    return elements[0]
  }

  /**
   * Finds a single element by test ID
   * @param {string} testID
   * @param {FindArgs} [args]
   * @returns {Promise<import("selenium-webdriver").WebElement>}
   */
  async findByTestID(testID, args) {
    return await this.find(`[data-testid='${testID}']`, args)
  }

  /**
   * @param {string|import("selenium-webdriver").WebElement|{selector: string} & FindArgs} elementOrIdentifier
   * @param {FindArgs} [args]
   * @returns {Promise<import("selenium-webdriver").WebElement>}
   */
  async _findElement(elementOrIdentifier, args) {
    /** @type {import("selenium-webdriver").WebElement} */
    let element

    if (typeof elementOrIdentifier == "string") {
      element = await this.find(elementOrIdentifier, args)
    } else if (typeof elementOrIdentifier == "object" && elementOrIdentifier !== null && "selector" in elementOrIdentifier) {
      const {selector, ...restArgs} = elementOrIdentifier

      element = await this.find(selector, restArgs)
    } else {
      element = /** @type {import("selenium-webdriver").WebElement} */ (elementOrIdentifier)
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
   * Clicks an element, allowing selector args when using a CSS selector.
   * @param {string|import("selenium-webdriver").WebElement} elementOrIdentifier
   * @param {FindArgs} [args]
   * @returns {Promise<void>}
   */
  async click(elementOrIdentifier, args) {
    let tries = 0

    while (true) {
      tries++

      try {
        const element = await this._findElement(elementOrIdentifier, args)
        const actions = this.getWebDriver().actions({async: true})

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
   * Interacts with an element by calling a method on it with the given arguments.
   * Retrying on ElementNotInteractableError, ElementClickInterceptedError, or StaleElementReferenceError.
   * @param {import("selenium-webdriver").WebElement|string|{selector: string} & FindArgs} elementOrIdentifier The element or a CSS selector to find the element.
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
   * @param {string} selector
   * @param {WaitForNoSelectorArgs} [args]
   * @returns {Promise<void>}
   */
  async waitForNoSelector(selector, args = {}) {
    const {useBaseSelector, ...restArgs} = args

    if (Object.keys(restArgs).length > 0) {
      throw new Error(`Unexpected args: ${Object.keys(restArgs).join(", ")}`)
    }

    const actualSelector = useBaseSelector ? this.getSelector(selector) : selector

    await this.driverSetTimeouts(0)

    try {
      await this._withRethrownErrors(async () => {
        await this.getWebDriver().wait(
          async () => {
            const elements = await this.getWebDriver().findElements(By.css(actualSelector))

            // Not found at all
            if (elements.length === 0) {
              return true
            }

            // Found but not visible
            try {
              const isDisplayed = await elements[0].isDisplayed()

              return !isDisplayed
            } catch (error) {
              if (
                error instanceof Error &&
                (error.constructor.name === "StaleElementReferenceError" || error.message.includes("stale element reference"))
              ) {
                return false
              }

              throw error
            }
          },
          this.getTimeouts()
        )
      })
    } finally {
      await this.restoreTimeouts()
    }
  }

  /**
   * @param {() => Promise<any>} callback
   * @returns {Promise<any>}
   */
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
}
