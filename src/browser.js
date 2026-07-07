// @ts-check

import fs from "node:fs/promises"
import {Key} from "selenium-webdriver"
import moment from "moment"
import {prettify} from "htmlfy"
import {wait, waitFor} from "awaitery"
import timeout from "awaitery/build/timeout.js"
import SeleniumDriver from "./drivers/selenium-driver.js"
import AppiumDriver from "./drivers/appium-driver.js"
import {testIdSelector} from "./test-id-selector.js"

/**
 * @typedef {object} BrowserArgs
 * @property {boolean} [debug] Enable debug logging.
 * @property {BrowserDriverConfig} [driver] Driver configuration.
 * @property {import("./system-test-communicator.js").default} [communicator] Optional command communicator for helper-driven navigation.
 * @property {(message: string) => void} [onWarning] Callback for retry/fallback warnings from verified helpers. Defaults to `console.warn`.
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
 * @property {string[]} [scrollContainerTestIDs] Native test IDs that should be tried as scroll containers before falling back to viewport gestures.
 * @property {boolean} [scrollTo] Whether to scroll found elements into view before returning them.
 * @property {number} [timeout] Override the timeout for this text wait.
 * @property {boolean} [useBaseSelector] Whether to scope by the base selector.
 * @property {boolean | null} [visible] Whether to require elements to be visible.
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
 * @typedef {object} BrowserClickEffectArgs
 * @property {number} [effectTimeout] How long to await the expected effect after each click before re-clicking (default 2000 ms).
 * @property {number} [timeout] Overall time budget for clicking and awaiting the expected effect.
 */
/**
 * @typedef {object} BrowserStepEvent
 * @property {string} name Step name.
 * @property {string} path Full `parent > child` step path.
 * @property {"running" | "passed" | "failed"} status Step outcome.
 * @property {string} startedAt ISO timestamp when the step started.
 * @property {string} [finishedAt] ISO timestamp when the step settled.
 * @property {string} [error] Failure message when the step failed.
 */

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
  /** @type {string[]} Names of the currently running (possibly nested) steps. */
  _activeSteps = []
  /** @type {BrowserStepEvent[]} Recorded step boundaries for trace/report layers. */
  _stepHistory = []
  /** @type {string | undefined} Path of the step that most recently failed in this run. */
  _lastFailedStepPath = undefined

  /** @param {BrowserArgs} [args] */
  constructor({debug = false, driver, communicator, onWarning, screenshotsPath = `${process.cwd()}/tmp/screenshots`, ...restArgs} = {}) {
    const restArgsKeys = Object.keys(restArgs)

    if (restArgsKeys.length > 0) {
      throw new Error(`Unknown browser arguments: ${restArgsKeys.join(", ")}`)
    }

    this._debug = debug
    this._driverConfig = driver
    this._onWarning = onWarning
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

  /**
   * Reports a retry/fallback warning through the configured `onWarning` callback so
   * callers can handle or silence it, falling back to `console.warn` when none is set.
   * @param {string} message
   * @returns {void}
   */
  warn(message) {
    if (this._onWarning) {
      this._onWarning(message)
    } else {
      console.warn("[Browser warning]", message)
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
   * @returns {Promise<boolean>}
   */
  async exists(selector, args = {}) {
    return await this.getDriverAdapter().exists(selector, args)
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
   * Finds native Android visible text or an accessibility label.
   * @param {string} expectedText Text to locate.
   * @param {import("./system-test.js").FindArgs} [args] Optional lookup settings.
   * @returns {Promise<import("selenium-webdriver").WebElement>} Matching native element.
   */
  async findByNativeText(expectedText, args = {}) {
    return await this.getDriverAdapter().findByNativeText(expectedText, args)
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
   * @param {string} selector
   * @param {import("./system-test.js").FindArgs} [args]
   * @returns {Promise<string>}
   */
  async text(selector, args = {}) {
    return await this.getDriverAdapter().text(selector, args)
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
   * @typedef {"native" | "js" | "backspace-keys" | "delete-keys"} ClearStrategy How a field is emptied.
   *   `"native"` (default) is a normal Selenium `element.clear()`. `"js"` sets the value to `""` through
   *   a DOM prototype setter plus input/change events — the only strategy that reliably drives React
   *   Native Web controlled-input state, kept as an escape hatch. `"backspace-keys"` and `"delete-keys"`
   *   clear with per-character key presses in a deliberately slow, adaptive, caret-safe,
   *   drop/refocus-recovering loop (opt-in only). Flaky clearing is a controlled-input smell — see the
   *   README "Clearing and filling inputs" section.
   */
  /**
   * @typedef {"native" | "js" | "per-character"} FillStrategy How a value is entered.
   *   `"native"` (default) is a single fast `element.sendKeys(value)` (real keyboard events, whole string
   *   at once). `"js"` sets the value directly through a DOM prototype setter plus input/change events —
   *   the React Native Web controlled-input escape hatch. `"per-character"` types the value one key at a
   *   time (deliberately slow, opt-in). All strategies verify the entered value and retry a bounded number
   *   of times before throwing.
   */
  /**
   * @typedef {object} ClearArgs
   * @property {ClearStrategy} [strategy] How to empty the field. Defaults to `"native"`.
   * @property {number} [keyDelay] Milliseconds to wait between key presses for the key-based strategies.
   *   Defaults to `0` (no artificial delay). A controlled-input band-aid knob, not a fix.
   */
  /**
   * @typedef {object} FillArgs
   * @property {FillStrategy} [strategy] How to enter the value. Defaults to `"native"`.
   * @property {number} [keyDelay] Milliseconds to wait between key presses for the `"per-character"`
   *   strategy. Defaults to `0`. A controlled-input band-aid knob, not a fix.
   */
  /**
   * @typedef {object} ClearAndFillArgs
   * @property {ClearStrategy} [clearStrategy] How to empty the field first. Defaults to `"native"`.
   * @property {FillStrategy} [fillStrategy] How to enter the value. Defaults to `"native"`.
   * @property {number} [keyDelay] Milliseconds to wait between key presses for the key-based clear and
   *   fill strategies. Defaults to `0`. A controlled-input band-aid knob, not a fix.
   */

  /**
   * Empties a text entry. Uses a normal Selenium `element.clear()` by default; pass `strategy` to opt into
   * the `js` DOM-setter escape hatch or the deliberately slow key-based (`backspace-keys`/`delete-keys`)
   * clears. Needing a non-native clear is a controlled-input smell — the real fix is an uncontrolled input
   * (`defaultValue` + `onChangeText`), not a clear strategy; see the README "Clearing and filling inputs".
   * @param {import("selenium-webdriver").WebElement|string|{selector: string} & import("./system-test.js").InteractArgs} elementOrIdentifier
   * @param {ClearArgs} [args]
   * @returns {Promise<void>}
   */
  async clear(elementOrIdentifier, {strategy = "native", keyDelay = 0} = {}) {
    if (strategy === "native") {
      await this.interact(elementOrIdentifier, "clear")

      return
    }

    if (strategy === "js") {
      // The DOM-setter escape hatch empties the field by setting its value to "" with input/change events.
      await this.interact(elementOrIdentifier, "replaceValueWithJs", "")

      return
    }

    // Key-based strategies need the caret in the field, so focus it before the adaptive clearing loop.
    await this.interact(this.textEntryClickTarget(elementOrIdentifier), "click")
    await this.clearTextEntryValue(elementOrIdentifier, {clearStrategy: strategy, keyDelay})
  }

  /**
   * Enters `value` into a text entry without clearing it first (pure fill). Uses one fast whole-string
   * `element.sendKeys(value)` by default; pass `strategy` to opt into the `js` DOM-setter escape hatch or
   * the deliberately slow `per-character` typing. Reads the current value first, then verifies the field
   * holds the expected result (`js` replaces the value; the keyboard strategies append at the caret) and
   * retries the whole fill up to three times before throwing with the expected and actual values. Needing
   * `js`/`per-character` to make a value land is a controlled-input smell — see the README.
   * @param {import("selenium-webdriver").WebElement|string|{selector: string} & import("./system-test.js").InteractArgs} elementOrIdentifier
   * @param {string} value
   * @param {FillArgs} [args]
   * @returns {Promise<void>}
   */
  async fill(elementOrIdentifier, value, {strategy = "native", keyDelay = 0} = {}) {
    const rawBeforeValue = await this.interact(elementOrIdentifier, "getProperty", "value")
    const beforeValue = typeof rawBeforeValue == "string" ? rawBeforeValue : ""
    // `js` replaces the whole value; the keyboard strategies append at the caret of the (unclear) field.
    const expectedValue = strategy === "js" ? value : `${beforeValue}${value}`
    let actualValue

    for (let attempt = 1; attempt <= 3; attempt++) {
      if (strategy === "js") {
        await this.interact(elementOrIdentifier, "replaceValueWithJs", value)
      } else if (strategy === "per-character") {
        await this.interact(this.textEntryClickTarget(elementOrIdentifier), "click")

        for (const character of Array.from(value)) {
          await this.interact(elementOrIdentifier, "sendKeys", character)
          await this.waitBetweenKeystrokes(keyDelay)
        }
      } else {
        // Fast default: one whole-string sendKeys with real keyboard events, not a per-character loop.
        await this.interact(this.textEntryClickTarget(elementOrIdentifier), "click")
        await this.interact(elementOrIdentifier, "sendKeys", value)
      }

      actualValue = await this.interact(elementOrIdentifier, "getProperty", "value")

      if (actualValue === expectedValue) return

      if (attempt < 3) {
        this.warn(`fill got ${typeof actualValue == "string" ? JSON.stringify(actualValue) : actualValue} instead of ${JSON.stringify(expectedValue)} on attempt ${attempt}; retrying`)
        await wait(50)
      }
    }

    const actualValueDescription = typeof actualValue == "string" ? JSON.stringify(actualValue) : `missing (${actualValue})`

    throw new Error(`fill did not enter the value after 3 attempts. Expected ${JSON.stringify(expectedValue)}, got ${actualValueDescription}.`)
  }

  /**
   * Clears a text entry and fills it with `value` — `clear()` then `fill()`. Both default to their fast
   * native strategies (`element.clear()` then one whole-string `element.sendKeys`), overridable per side
   * via `clearStrategy`/`fillStrategy`. This is the common replace-the-value flow.
   * @param {import("selenium-webdriver").WebElement|string|{selector: string} & import("./system-test.js").InteractArgs} elementOrIdentifier
   * @param {string} value
   * @param {ClearAndFillArgs} [args]
   * @returns {Promise<void>}
   */
  async clearAndFill(elementOrIdentifier, value, {clearStrategy = "native", fillStrategy = "native", keyDelay = 0} = {}) {
    await this.clear(elementOrIdentifier, {strategy: clearStrategy, keyDelay})
    await this.fill(elementOrIdentifier, value, {strategy: fillStrategy, keyDelay})
  }

  /**
   * Convenience alias for `clearAndFill` with fast native defaults, kept so the many existing call sites
   * keep working while they migrate to `clear`/`fill`/`clearAndFill`. Prefer `clearAndFill` in new code.
   * @param {import("selenium-webdriver").WebElement|string|{selector: string} & import("./system-test.js").InteractArgs} elementOrIdentifier
   * @param {string} value
   * @param {ClearAndFillArgs} [args]
   * @returns {Promise<void>}
   */
  async clearAndSendKeys(elementOrIdentifier, value, args = {}) {
    await this.clearAndFill(elementOrIdentifier, value, args)
  }

  /**
   * Empties a text entry with per-character key presses and returns the (empty) value left in the field.
   * Used by the opt-in `backspace-keys`/`delete-keys` clear strategies. Each pass re-reads the element's
   * actual current value and deletes exactly the characters that remain. The focusing click can land the
   * caret anywhere in the value — for example mid-line in a multiline textarea — so every pass deletes on
   * both sides of the caret (one leading key per remaining character clears everything on the caret's
   * leading side; surplus presses no-op at the boundary; one trailing key per still-remaining character
   * clears the other side). `backspace-keys` leads with BACK_SPACE (clearing before the caret);
   * `delete-keys` leads with DELETE (clearing after the caret). Under CI load individual key presses are
   * intermittently dropped, so re-reading and re-deleting exactly the residual each pass keeps clearing
   * robust as long as each pass makes progress. When progress stalls (the value length is unchanged across
   * `maxStalledPasses` consecutive passes) the focus click may never have landed the caret, so it
   * re-issues the focus click `maxRefocusRecoveries` times before giving up. Only once re-focusing still
   * yields no progress does it throw with the residual value, surfacing genuinely un-clearable fields such
   * as read-only inputs instead of looping forever.
   * @param {import("selenium-webdriver").WebElement|string|{selector: string} & import("./system-test.js").InteractArgs} elementOrIdentifier
   * @param {{clearStrategy?: ClearStrategy, keyDelay?: number}} [args]
   * @returns {Promise<string>}
   */
  async clearTextEntryValue(elementOrIdentifier, {clearStrategy = "backspace-keys", keyDelay = 0} = {}) {
    // Which key clears each side of the caret. `delete-keys` leads with a forward DELETE (clearing after
    // the caret) then mops up with BACK_SPACE; `backspace-keys` is the reverse.
    const leadingKey = clearStrategy === "delete-keys" ? Key.DELETE : Key.BACK_SPACE
    const trailingKey = clearStrategy === "delete-keys" ? Key.BACK_SPACE : Key.DELETE

    // A pass that deletes at least one character resets the counter, so a stall only trips
    // when this many consecutive passes each land zero of their key presses — rather than on
    // the intermittent single-key drops this loop is built to absorb.
    const maxStalledPasses = 3
    // A stall can mean the focus click never actually landed the caret, so re-focus this many
    // times (re-clicking the field like the caller does initially) before declaring the field
    // genuinely un-clearable.
    const maxRefocusRecoveries = 2
    const initialValue = await this.interact(elementOrIdentifier, "getProperty", "value")

    if (typeof initialValue != "string" || initialValue.length === 0) return ""

    let residual = initialValue
    let stalledPasses = 0
    let refocusRecoveries = 0

    while (residual.length > 0) {
      const residualLengthBeforePass = residual.length

      // The leading key deletes the character on its side of the caret wherever the caret is, so one press
      // per remaining character clears everything on that side; surplus presses no-op at the boundary.
      for (let characterIndex = 0; characterIndex < residualLengthBeforePass; characterIndex++) {
        await this.interact(elementOrIdentifier, "sendKeys", leadingKey)
        await this.waitBetweenKeystrokes(keyDelay)
      }

      const valueAfterLeadingKeys = await this.interact(elementOrIdentifier, "getProperty", "value")

      // Once the leading keys exhausted their side the caret sits at the boundary, so one trailing key per
      // still-remaining character deletes everything that was on the other side.
      if (typeof valueAfterLeadingKeys == "string" && valueAfterLeadingKeys.length > 0) {
        for (let characterIndex = 0; characterIndex < valueAfterLeadingKeys.length; characterIndex++) {
          await this.interact(elementOrIdentifier, "sendKeys", trailingKey)
          await this.waitBetweenKeystrokes(keyDelay)
        }
      }

      const valueAfterPass = await this.interact(elementOrIdentifier, "getProperty", "value")

      residual = typeof valueAfterPass == "string" ? valueAfterPass : ""

      if (residual.length === 0) break

      if (residual.length < residualLengthBeforePass) {
        stalledPasses = 0
      } else {
        stalledPasses += 1

        if (stalledPasses >= maxStalledPasses) {
          if (refocusRecoveries >= maxRefocusRecoveries) {
            throw new Error(`Input clearing made no progress across ${maxStalledPasses} passes after ${refocusRecoveries} re-focus attempts; the field still contains ${JSON.stringify(residual)}.`)
          }

          // The deletions may be no-oping because the focus click never landed the caret in
          // the field; re-click it (the same focus action the caller used initially) and keep
          // clearing before giving up.
          refocusRecoveries += 1
          stalledPasses = 0
          this.warn(`Input clearing stalled with ${JSON.stringify(residual)} in the field; re-focusing and retrying`)
          await this.interact(this.textEntryClickTarget(elementOrIdentifier), "click")
          await wait(50)
          continue
        }
      }

      this.warn(`Input clearing left ${JSON.stringify(residual)} in the field; retrying`)
      await wait(50)
    }

    return residual
  }

  /**
   * Waits the configured inter-keystroke delay between individual key presses. A controlled-input
   * band-aid knob for environments where an input misbehaves when keys land too fast; the default `0`
   * does nothing, keeping timing byte-identical to the historic behavior.
   * @param {number} keyDelay
   * @returns {Promise<void>}
   */
  async waitBetweenKeystrokes(keyDelay) {
    if (keyDelay > 0) await wait(keyDelay)
  }

  /**
   * @param {import("selenium-webdriver").WebElement|string|{selector: string} & import("./system-test.js").InteractArgs} elementOrIdentifier
   * @returns {import("selenium-webdriver").WebElement|string|{selector: string} & import("./system-test.js").InteractArgs}
   */
  textEntryClickTarget(elementOrIdentifier) {
    if (typeof elementOrIdentifier === "string") {
      return {selector: elementOrIdentifier, method: "actions"}
    }

    if (typeof elementOrIdentifier === "object" && elementOrIdentifier !== null && "selector" in elementOrIdentifier) {
      return {...elementOrIdentifier, method: "actions"}
    }

    return elementOrIdentifier
  }

  /**
   * Clicks an element and awaits a caller-observable effect, re-clicking while the effect
   * has not appeared yet. This closes the silent-drop failure mode where a click reports
   * success but the app never handles the press: the click only counts once the expected
   * effect callback stops throwing. Only use this for clicks where clicking again before
   * the effect has appeared is safe, such as opening a menu/modal or navigating.
   * @param {string|import("selenium-webdriver").WebElement} elementOrIdentifier
   * @param {() => Promise<any> | any} expectedEffectCallback Throws while the expected effect has not happened yet.
   * @param {import("./system-test.js").FindArgs & BrowserClickEffectArgs} [args] Click args plus effect/overall timeouts.
   * @returns {Promise<void>}
   */
  async clickAndWaitForEffect(elementOrIdentifier, expectedEffectCallback, args = {}) {
    const {effectTimeout = 2000, timeout: timeoutOverride, ...clickArgs} = args
    const totalTimeout = this.getCommandTimeout(timeoutOverride)
    const startedAt = Date.now()
    let clicks = 0

    while (true) {
      clicks++
      await this.click(elementOrIdentifier, clickArgs)

      // Each probe is clamped to the remaining overall budget so a small `timeout`
      // is honored even when it is shorter than the per-click `effectTimeout`.
      const remainingTimeout = totalTimeout - (Date.now() - startedAt)

      try {
        await waitFor({timeout: Math.max(1, Math.min(effectTimeout, remainingTimeout))}, async () => await expectedEffectCallback())

        return
      } catch (effectError) {
        const effectErrorMessage = effectError instanceof Error ? effectError.message : String(effectError)

        if (Date.now() - startedAt >= totalTimeout) {
          throw errorWithCause(`Click produced no observed effect after ${clicks} clicks within ${totalTimeout}ms. Last effect check failure: ${effectErrorMessage}`, effectError)
        }

        this.warn(`Click produced no observed effect on attempt ${clicks} (${effectErrorMessage}); retrying`)
      }
    }
  }

  /**
   * Replaces an input-like element's value by test id.
   * @param {string} testID Field `data-testid` to target.
   * @param {string} nextValue Text to leave in the field.
   * @param {BrowserTestIDInputArgs} [args] Optional lookup timeout.
   * @returns {Promise<void>}
   */
  async replaceTestIDInputValue(testID, nextValue, args = {}) {
    await this.clearAndFill({
      selector: testIdSelector(testID),
      timeout: args.timeout
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
    const {timeout: waitTimeout, ...findArgs} = args

    await this.getDriverAdapter().waitForTestIDText(testID, expectedText, {
      ...findArgs,
      timeout: this.getCommandTimeout(waitTimeout)
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
    const {timeout: waitTimeout, ...findArgs} = args

    await waitFor({timeout: this.getCommandTimeout(waitTimeout)}, async () => {
      const element = await this.findByTestID(testID, {...findArgs, timeout: 0})
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
   * Runs a callback as a named step. Records step boundaries for trace/report layers and,
   * on failure, annotates the original error and failure artifacts with the active step
   * path without changing the callback's return value or error type. Steps may be nested.
   * @template T
   * @param {string} name
   * @param {() => Promise<T> | T} callback
   * @returns {Promise<T>}
   */
  async step(name, callback) {
    if (this._activeSteps.length === 0) {
      this._lastFailedStepPath = undefined
    }

    const stepPath = [...this._activeSteps, name]
    /** @type {BrowserStepEvent} */
    const event = {name, path: stepPath.join(" > "), startedAt: new Date().toISOString(), status: "running"}

    this._activeSteps.push(name)
    this._stepHistory.push(event)
    this.debugLog(`Step started: ${event.path}`)

    try {
      const result = await callback()

      event.status = "passed"
      event.finishedAt = new Date().toISOString()
      this.debugLog(`Step passed: ${event.path}`)

      return result
    } catch (error) {
      event.status = "failed"
      event.finishedAt = new Date().toISOString()
      event.error = error instanceof Error ? error.message : String(error)

      // The innermost failing step runs this catch first, so the first assignment (after the
      // top-level reset) keeps the deepest path. This also covers non-Error rejections (e.g.
      // helper-driven visit/dismissTo failures), which cannot carry the step on the value.
      if (this._lastFailedStepPath === undefined) {
        this._lastFailedStepPath = event.path
      }

      throw this.annotateErrorWithStep(error, event.path)
    } finally {
      this._activeSteps.pop()
    }
  }

  /**
   * Adds step context to a thrown error once (the innermost failing step wins), preserving
   * the original error instance and type.
   * @param {unknown} error
   * @param {string} stepPath
   * @returns {unknown}
   */
  annotateErrorWithStep(error, stepPath) {
    if (!(error instanceof Error) || /** @type {any} */ (error).systemTestStep) {
      return error
    }

    /** @type {any} */ (error).systemTestStep = stepPath
    error.message = `${error.message} (in step: ${stepPath})`

    return error
  }

  /**
   * Path of the step currently running, or undefined when no step is active.
   * @returns {string | undefined}
   */
  currentStepPath() {
    return this._activeSteps.length > 0 ? this._activeSteps.join(" > ") : undefined
  }

  /**
   * Recorded step boundaries, for trace/report layers.
   * @returns {BrowserStepEvent[]}
   */
  getStepHistory() {
    return this._stepHistory
  }

  /**
   * Clears step history and active-step state. Called at the start of each `SystemTest.run`
   * example so reused browser instances do not carry steps across examples.
   * @returns {void}
   */
  resetSteps() {
    this._activeSteps = []
    this._stepHistory = []
    this._lastFailedStepPath = undefined
  }

  /**
   * Takes a screenshot, writes HTML/browser logs to disk, and returns the collected artifacts.
   * @returns {Promise<{currentUrl: string, html: string, htmlPath: string, logs: string[], logsPath: string, screenshotPath: string, step: string | undefined}>}
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
    const step = this.currentStepPath() ?? this._lastFailedStepPath

    console.log("Current URL:", currentUrl)
    if (step) console.log("Active step:", step)
    console.log("Logs:", logsPath)
    console.log("Screenshot:", screenshotPath)
    console.log("HTML:", htmlPath)

    return {
      currentUrl,
      html,
      htmlPath,
      logs,
      logsPath,
      screenshotPath,
      step
    }
  }

  /** @returns {Promise<void>} */
  async stopDriver() {
    if (this.driverAdapter) {
      await this.driverAdapter.stop()
    }
  }
}
