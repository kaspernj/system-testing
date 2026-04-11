import {By, error as SeleniumError} from "selenium-webdriver"
import logging from "selenium-webdriver/lib/logging.js"
import {wait} from "awaitery"
import timeout from "awaitery/build/timeout.js"

/**
 * @param {string} message
 * @param {unknown} cause
 * @returns {Error & {cause: unknown}}
 */
function errorWithCause(message, cause) {
  const error = /** @type {Error & {cause: unknown}} */ (new Error(message))
  error.cause = cause
  return error
}

/**
 * @param {unknown} element
 * @returns {element is import("selenium-webdriver").WebElement}
 */
function isWebDriverElement(element) {
  return Boolean(
    element &&
    typeof element === "object" &&
    "getId" in element &&
    typeof element.getId === "function"
  )
}

/**
 * @param {unknown} error
 * @returns {string | undefined}
 */
function getErrorName(error) {
  if (error instanceof Error) {
    return error.constructor.name
  }

  return undefined
}

/**
 * @param {unknown} error
 * @returns {string | undefined}
 */
function getRetryableInteractErrorName(error) {
  let currentError = error

  while (currentError) {
    const errorName = getErrorName(currentError)

    if (errorName === "ElementNotInteractableError" || errorName === "ElementClickInterceptedError" || errorName === "StaleElementReferenceError") {
      return errorName
    }

    if (!(currentError instanceof Error) || !("cause" in currentError)) {
      return undefined
    }

    currentError = currentError.cause
  }

  return undefined
}

/**
 * @param {...any} args
 * @returns {string}
 */
function getSendKeysTextAppend(...args) {
  return args
    .map((arg) => {
      const stringArg = String(arg)

      if (/[\uE009\uE03D]a\uE000/i.test(stringArg)) {
        return ""
      }

      return stringArg.replace(/[\uE000-\uF8FF]/g, "")
    })
    .join("")
}

/**
 * @param {...any} args
 * @returns {boolean}
 */
function getSendKeysUsesSelectAllAndDelete(...args) {
  return args.some((arg) => /[\uE009\uE03D]a\uE000/i.test(String(arg))) &&
    args.some((arg) => String(arg).includes("\uE003") || String(arg).includes("\uE017"))
}

/**
 * @typedef {object} FindArgs
 * @property {number} [timeout] Override timeout for lookup.
 * @property {boolean | null} [visible] Whether to require elements to be visible (`true`) or hidden (`false`). Use `null` to disable visibility filtering.
 * @property {boolean} [scrollTo] Whether to scroll found elements into view before returning them.
 * @property {boolean} [useBaseSelector] Whether to scope by the base selector.
 */
/**
 * @typedef {FindArgs & {withFallback?: boolean}} InteractArgs
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
   * @param {import("../browser.js").default} args.browser
   * @param {Record<string, any>} [args.options]
   */
  constructor({browser, options = {}}) {
    this.browser = browser
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
    this.browser.throwIfHttpServerError()

    return this.webDriver
  }

  /**
   * @param {import("selenium-webdriver").WebDriver} webDriver
   * @returns {void}
   */
  setWebDriver(webDriver) {
    this.webDriver = webDriver
    this.browser.driver = webDriver
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
      await timeout({timeout: this.getTimeouts(), errorMessage: "timeout while quitting WebDriver"}, async () => await /** @type {NonNullable<typeof this.webDriver>} */ (this.webDriver).quit())
    }

    this.webDriver = undefined
    this.browser.driver = undefined
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
    return this.browser.getSelector(selector)
  }

  /**
   * @param {string} path
   * @returns {Promise<void>}
   */
  async driverVisit(path) {
    const isAbsoluteUrl = /^[a-z]+:\/\//i.test(path)
    const url = isAbsoluteUrl ? path : `${this.getBaseUrl()}${path}`

    await this.getWebDriver().get(url)
  }

  /**
   * Deletes all cookies for the current browser session.
   * @returns {Promise<void>}
   */
  async deleteAllCookies() {
    await this.getWebDriver().manage().deleteAllCookies()
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
    const {scrollTo = false, visible = true, timeout, useBaseSelector = true, ...restArgs} = args
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
    /** @type {import("selenium-webdriver").WebElement[]} */
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

        throw errorWithCause(`Couldn't get elements with selector: ${actualSelector}: ${error instanceof Error ? error.message : error}`, error)
      }
    }
    if (scrollTo) {
      for (const element of elements) {
        await this.scrollElementIntoView(element)
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
    /** @type {import("selenium-webdriver").WebElement[]} */
    let elements

    try {
      elements = await this.all(selector, args)
    } catch (error) {
      if (error instanceof Error) {
        throw errorWithCause(`${error.constructor.name} - ${error.message} (selector: ${this.getSelector(selector)})`, error)
      }

      throw errorWithCause(`${typeof error} - ${error} (selector: ${this.getSelector(selector)})`, error)
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
   * Checks whether an element with the given test ID is currently rendered.
   * @param {string} testID
   * @param {FindArgs} [args]
   * @returns {Promise<boolean>}
   */
  async hasTestID(testID, args) {
    try {
      await this.findByTestID(testID, {...args, timeout: 0})
      return true
    } catch (error) {
      if (error instanceof ElementNotFoundError) {
        return false
      }

      throw error
    }
  }

  /**
   * @param {string|import("selenium-webdriver").WebElement|({selector: string} & FindArgs & {withFallback?: boolean})} elementOrIdentifier
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

      delete restArgs.withFallback

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
          if (error.constructor.name === "ElementClickInterceptedError" || error.constructor.name === "StaleElementReferenceError") {
            throw error
          } else if (error.constructor.name === "ElementNotInteractableError") {
            if (tries >= 3) {
              throw errorWithCause(`Element ${elementOrIdentifier.constructor.name} click failed after ${tries} tries - ${error.constructor.name}: ${error.message}`, error)
            } else {
              await wait(50)
            }
          } else {
            throw errorWithCause(`Element ${elementOrIdentifier.constructor.name} click failed - ${error.constructor.name}: ${error.message}`, error)
          }
        } else {
          throw errorWithCause(`Element ${elementOrIdentifier.constructor.name} click failed - ${typeof error}: ${error}`, error)
        }
      }
    }
  }

  /**
   * @param {import("selenium-webdriver").WebElement} element
   * @returns {Promise<void>}
   */
  async scrollElementIntoView(element) {
    await this.getWebDriver().actions({async: true}).move({origin: element}).perform()
  }

  /**
   * Scrolls an element into view.
   * @param {string|import("selenium-webdriver").WebElement|({selector: string} & FindArgs & {withFallback?: boolean})} elementOrIdentifier
   * @param {FindArgs} [args]
   * @returns {Promise<void>}
   */
  async scrollIntoView(elementOrIdentifier, args) {
    const element = await this._findElement(elementOrIdentifier, args)
    await this.scrollElementIntoView(element)
  }

  /**
   * Scrolls the element with the given test ID into view.
   * @param {string} testID
   * @param {FindArgs} [args]
   * @returns {Promise<void>}
   */
  async scrollTestIdIntoView(testID, args) {
    const element = await this.findByTestID(testID, args)
    await this.scrollElementIntoView(element)
  }

  /**
   * Interacts with an element by calling a method on it with the given arguments.
   * Retrying on ElementNotInteractableError, ElementClickInterceptedError, or StaleElementReferenceError.
   * @param {import("selenium-webdriver").WebElement|string|{selector: string} & InteractArgs} elementOrIdentifier The element or a CSS selector to find the element.
   * @param {string} methodName The method name to call on the element.
   * @param {...any} args Arguments to pass to the method.
   * @returns {Promise<any>}
   */
  async interact(elementOrIdentifier, methodName, ...args) {
    let tries = 0

    while (true) {
      tries++

      const element = await this._findElement(elementOrIdentifier)

      try {
        if (methodName === "sendKeys") {
          if (typeof elementOrIdentifier === "object" && elementOrIdentifier && "withFallback" in elementOrIdentifier && elementOrIdentifier.withFallback) {
            return await this.interactSendKeysWithFallback(element, ...args)
          }

          return await element.sendKeys(...args)
        } else if (methodName === "click") {
          if (isWebDriverElement(element)) {
            await this.click(element)

            return undefined
          }

          return await /** @type {{click: (...clickArgs: any[]) => Promise<any>}} */ (element).click(...args)
        } else if (!(/** @type {any} */ (element))[methodName]) {
          throw new Error(`${element.constructor.name} hasn't an attribute named: ${methodName}`)
        } else if (typeof (/** @type {any} */ (element))[methodName] != "function") {
          throw new Error(`${element.constructor.name}#${methodName} is not a function`)
        }

        // Dont call with candidate, because that will bind the function wrong.
        return await (/** @type {any} */ (element))[methodName](...args)
      } catch (error) {
        if (error instanceof Error) {
          const retryableErrorName = getRetryableInteractErrorName(error)

          if (retryableErrorName) {
            // Retry finding the element and interacting with it
            if (tries >= 3) {
              let elementDescription

              if (typeof elementOrIdentifier == "string") {
                elementDescription = `CSS selector ${elementOrIdentifier}`
              } else {
                elementDescription = `${element.constructor.name}`
              }

              throw errorWithCause(`${elementDescription} ${methodName} failed after ${tries} tries - ${retryableErrorName}: ${error.message}`, error)
            } else {
              await wait(50)
            }
          } else {
            throw errorWithCause(`${element.constructor.name} ${methodName} failed - ${error.constructor.name}: ${error.message}`, error)
          }
        } else {
          throw errorWithCause(`${element.constructor.name} ${methodName} failed - ${typeof error}: ${error}`, error)
        }
      }
    }
  }

  /**
   * @param {import("selenium-webdriver").WebElement} element
   * @returns {Promise<string | undefined>}
   */
  async readInteractableValue(element) {
    const valueProperty = await element.getAttribute("value")

    if (typeof valueProperty == "string") {
      return valueProperty
    }

    const textContent = await element.getText()

    if (typeof textContent == "string") {
      return textContent
    }

    return undefined
  }

  /**
   * @param {import("selenium-webdriver").WebElement} element
   * @param {...any} args
   * @returns {Promise<unknown>}
   */
  async interactSendKeysWithFallback(element, ...args) {
    const expectedAppend = getSendKeysTextAppend(...args)
    const beforeValue = await this.readInteractableValue(element)
    const sendKeysResult = await element.sendKeys(...args)
    const afterValue = await this.readInteractableValue(element)

    if (typeof beforeValue == "string" && typeof afterValue == "string" && afterValue !== beforeValue) {
      return sendKeysResult
    }

    const nextValue = getSendKeysUsesSelectAllAndDelete(...args) ? expectedAppend : `${beforeValue || ""}${expectedAppend}`

    if (typeof beforeValue == "string" && nextValue === beforeValue) {
      return sendKeysResult
    }

    await this.getWebDriver().executeScript(`
      const element = arguments[0]
      const nextValue = String(arguments[1] ?? "")

      if (typeof element.focus == "function") {
        element.focus()
      }

      if (typeof element.value == "string") {
        const prototype = Object.getPrototypeOf(element)
        const descriptor = Object.getOwnPropertyDescriptor(prototype, "value") || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value") || Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")
        const previousValue = String(element.value)

        if (descriptor && typeof descriptor.set == "function") {
          descriptor.set.call(element, nextValue)
        } else {
          element.value = nextValue
        }

        if (element._valueTracker && typeof element._valueTracker.setValue == "function") {
          element._valueTracker.setValue(previousValue)
        }

        element.dispatchEvent(new Event("input", {bubbles: true}))
        element.dispatchEvent(new Event("change", {bubbles: true}))
        return element.value
      }

      if (element.isContentEditable) {
        element.textContent = nextValue
        element.dispatchEvent(new Event("input", {bubbles: true}))
        return element.textContent
      }

      return null
    `, element, nextValue)

    return sendKeysResult
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
        throw errorWithCause(`Selenium ${error.constructor.name}: ${error.message}`, error)
      } else {
        throw error
      }
    }
  }
}
