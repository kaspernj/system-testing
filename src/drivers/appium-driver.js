import fs from "node:fs/promises"
import path from "node:path"
import {Builder, By} from "selenium-webdriver"
import {Command, Name} from "selenium-webdriver/lib/command.js"
import {Origin} from "selenium-webdriver/lib/input.js"
import {wait} from "awaitery"
import timeout from "awaitery/build/timeout.js"
import WebDriverDriver from "./webdriver-driver.js"

const MAX_NATIVE_VIEWPORT_SCROLL_STEPS = 8
const DEFAULT_NATIVE_NEW_COMMAND_TIMEOUT_SECONDS = 180

/**
 * Appium timeout values returned by Selenium.
 * @typedef {{implicit: number, pageLoad?: number, script?: number}} NativeTimeouts
 */
/**
 * Appium timeout update shape accepted by Selenium.
 * @typedef {{implicit?: number, pageLoad?: number, script?: number}} NativeTimeoutOptions
 */
/**
 * Native Appium window dimensions.
 * @typedef {{x: number, y: number, width: number, height: number}} NativeWindowRect
 */
/**
 * Tracks native scroll fallbacks that already reported no movement.
 * @typedef {{tryElementScroll: boolean, tryViewportScroll: boolean}} NativeViewportScrollState
 */
/**
 * Native viewport scroll direction.
 * @typedef {"down"|"up"} NativeViewportScrollDirection
 */
/**
 * Native Android lookup work executed by the scrolling poller.
 * @typedef {{description: string, directFind: () => Promise<import("selenium-webdriver").WebElement>, scrollSelectors: string[]}} NativeControlLookup
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
 * Escapes text for use inside a Java regular expression.
 * @param {string} value Unescaped regex text.
 * @returns {string} Regex-safe text.
 */
function escapeRegExp(value) {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&")
}

/**
 * Escapes text for use inside a quoted UiAutomator Java string.
 * @param {string} value Unescaped Java string text.
 * @returns {string} Java-string-safe text.
 */
function escapeJavaString(value) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
}

/**
 * Builds a UiAutomator selector for React Native and package-qualified resource IDs.
 * @param {string} testId Resource id suffix to match.
 * @returns {string} UiAutomator selector source.
 */
export function androidResourceIdSelector(testId) {
  return `new UiSelector().resourceIdMatches("(^|.*:id/)${escapeJavaString(escapeRegExp(testId))}$")`
}

/**
 * Builds a UiAutomator selector that matches visible text.
 * @param {string} expectedText Text to locate.
 * @returns {string} UiAutomator selector source.
 */
export function androidTextContainsSelector(expectedText) {
  return `new UiSelector().textContains("${escapeJavaString(expectedText)}")`
}

/**
 * Builds a UiAutomator selector that matches an accessibility label.
 * @param {string} expectedText Text to locate.
 * @returns {string} UiAutomator selector source.
 */
export function androidDescriptionContainsSelector(expectedText) {
  return `new UiSelector().descriptionContains("${escapeJavaString(expectedText)}")`
}

/**
 * Checks whether native lookup failed because the control is not currently mounted onscreen.
 * @param {unknown} error Value thrown by Appium lookup.
 * @returns {boolean} Whether native scrolling should be attempted.
 */
function isNativeControlLookupMiss(error) {
  if (!(error instanceof Error)) return false

  return error.message.includes("Element couldn't be found") || error.message.includes("Couldn't get elements")
}

/**
 * Checks whether the hosted Appium driver lacks the mobile gesture extension.
 * @param {unknown} error Value thrown by Appium.
 * @returns {boolean} Whether W3C actions should be used instead.
 */
function isUnsupportedMobileGestureError(error) {
  if (!(error instanceof Error)) return false

  return error.message.includes("NotYetImplementedError") ||
    error.message.includes("Method has not yet been implemented") ||
    error.message.includes("Unknown mobile command")
}

/**
 * Adds a UiAutomator text predicate to a resource-id selector.
 * @param {string} resourceSelector UiAutomator resource-id selector.
 * @param {string} filterSelector UiAutomator text or description selector.
 * @returns {string} Combined selector.
 */
function combineAndroidSelectors(resourceSelector, filterSelector) {
  const prefix = "new UiSelector()"

  if (!filterSelector.startsWith(prefix)) {
    throw new Error(`Expected Android selector to start with ${prefix}, got ${filterSelector}`)
  }

  return `${resourceSelector}${filterSelector.slice(prefix.length)}`
}

/**
 * Adds a UiAutomator child predicate to a resource-id selector.
 * @param {string} resourceSelector UiAutomator resource-id selector.
 * @param {string} childSelector UiAutomator child selector.
 * @returns {string} Combined selector.
 */
function childAndroidSelector(resourceSelector, childSelector) {
  return `${resourceSelector}.childSelector(${childSelector})`
}

/**
 * Escapes text for use as an XPath string literal.
 * @param {string} value Unescaped XPath text.
 * @returns {string} Quoted literal or concat expression safe for XPath.
 */
function xpathStringLiteral(value) {
  if (!value.includes('"')) return `"${value}"`
  if (!value.includes("'")) return `'${value}'`

  return `concat(${value.split('"').map((part) => `"${part}"`).join(", '\"', ")})`
}

/**
 * Builds an XPath selector for text under one native Android resource id.
 * @param {string} testId Resource id suffix to scope under.
 * @param {string} expectedText Text to locate inside that scope.
 * @returns {string} XPath selector source.
 */
function androidScopedTextXpath(testId, expectedText) {
  const resourceId = xpathStringLiteral(testId)
  const text = xpathStringLiteral(expectedText)
  const resourcePredicate = `(@resource-id = ${resourceId} or substring(@resource-id, string-length(@resource-id) - string-length(${resourceId}) + 1) = ${resourceId})`
  const textPredicate = `(contains(@text, ${text}) or contains(@content-desc, ${text}))`

  return `//*[${resourcePredicate} and ${textPredicate}] | //*[${resourcePredicate}]//*[${textPredicate}]`
}

/**
 * Builds selectors that scope text matching to one native resource id.
 * @param {string} testId Stable test id.
 * @param {string} expectedText Text that must appear on that element.
 * @returns {string[]} UiAutomator selectors.
 */
function nativeTestIDTextSelectors(testId, expectedText) {
  const resourceSelector = androidResourceIdSelector(testId)

  return [
    combineAndroidSelectors(resourceSelector, androidTextContainsSelector(expectedText)),
    combineAndroidSelectors(resourceSelector, androidDescriptionContainsSelector(expectedText)),
    childAndroidSelector(resourceSelector, androidTextContainsSelector(expectedText)),
    childAndroidSelector(resourceSelector, androidDescriptionContainsSelector(expectedText))
  ]
}

/**
 * Builds native Android scroll selectors for a scoped text assertion.
 * @param {string} testId Stable test id.
 * @param {string} expectedText Text that must appear on that element.
 * @returns {string[]} UiAutomator selectors.
 */
function nativeTestIDTextScrollSelectors(testId, expectedText) {
  return [
    ...nativeTestIDTextSelectors(testId, expectedText),
    androidResourceIdSelector(testId)
  ]
}

/**
 * Ensures Chrome Appium capabilities use a caller-owned user-data directory.
 * This avoids repeated sessions leaking temp profiles under `/tmp` in CI.
 * @param {object} args
 * @param {string} [args.browserName]
 * @param {Record<string, any>} args.capabilities
 * @param {string} [args.tempRootDir]
 * @returns {Promise<string | undefined>}
 */
export async function ensureChromeUserDataDirCapability({browserName, capabilities, tempRootDir = path.join(process.cwd(), "tmp", "appium-chrome-user-data")}) {
  const resolvedBrowserName = capabilities.browserName ?? browserName

  if (typeof resolvedBrowserName !== "string" || resolvedBrowserName.toLowerCase() !== "chrome") {
    return undefined
  }

  const platformName = capabilities.platformName

  if (typeof platformName === "string" && platformName.toLowerCase() === "android") {
    return undefined
  }

  const chromeOptions = capabilities["goog:chromeOptions"]
  const args = Array.isArray(chromeOptions?.args) ? [...chromeOptions.args] : []

  if (args.some((arg) => typeof arg === "string" && arg.startsWith("--user-data-dir="))) {
    return undefined
  }

  await fs.mkdir(tempRootDir, {recursive: true})

  const userDataDir = await fs.mkdtemp(path.join(tempRootDir, "profile-"))

  args.push(`--user-data-dir=${userDataDir}`)
  capabilities["goog:chromeOptions"] = {
    ...(chromeOptions ?? {}),
    args
  }

  return userDataDir
}

/**
 * Keeps native Appium sessions alive while the React Native app opens the system-test WebSocket.
 * @param {object} args
 * @param {Record<string, any>} args.capabilities
 * @returns {void}
 */
export function ensureNativeNewCommandTimeoutCapability({capabilities}) {
  const platformName = capabilities.platformName

  if (typeof platformName !== "string" || platformName.toLowerCase() !== "android") return
  if (typeof capabilities.browserName === "string" && capabilities.browserName.length > 0) return
  if (capabilities["appium:newCommandTimeout"] !== undefined) return
  if (capabilities.newCommandTimeout !== undefined) return

  capabilities["appium:newCommandTimeout"] = DEFAULT_NATIVE_NEW_COMMAND_TIMEOUT_SECONDS
}

/**
 * Whether a driver config resolves to a native Appium app session rather than a browser.
 * Native app sessions launch an installed app (no `browserName`), so the system-test harness
 * must start the client WebSocket before the app launches and allow the native-safe connect timeout.
 * @param {import("../browser.js").BrowserDriverConfig} [driverConfig]
 * @returns {boolean}
 */
export function isAppiumNativeAppDriverConfig(driverConfig) {
  if (driverConfig?.type !== "appium") return false

  const options = driverConfig.options ?? {}
  const browserName = options.capabilities?.browserName ?? options.browserName

  return typeof browserName !== "string" || browserName.length === 0
}

/**
 * @typedef {object} AppiumDriverOptions
 * @property {string} [serverUrl] Remote Appium server URL to connect to.
 * @property {Record<string, any>} [serverArgs] Options passed to the Appium server.
 * @property {string[]} [useDrivers] Appium driver names to load when starting the server.
 * @property {Record<string, any>} [capabilities] Desired capabilities for the session.
 * @property {string} [browserName] Browser name for web sessions.
 * @property {"accessibilityId"|"css"|"id"} [testIdStrategy] Strategy for resolving test IDs.
 * @property {string} [testIdAttribute] Attribute name when using the CSS test ID strategy.
 */
/**
 * @typedef {object} FindArgs
 * @property {number} [timeout] Override timeout for lookup.
 * @property {boolean | null} [visible] Whether to require elements to be visible (`true`) or hidden (`false`). Use `null` to disable visibility filtering.
 * @property {boolean} [scrollTo] Whether to scroll found elements into view before returning them.
 * @property {string[]} [scrollContainerTestIDs] Native test IDs that should be tried as scroll containers before falling back to viewport gestures.
 * @property {boolean} [useBaseSelector] Whether to scope by the base selector.
 */

/**
 * Appium driver backed by the Appium server package.
 */
export default class AppiumDriver extends WebDriverDriver {
  /** @type {string | undefined} */
  chromeUserDataDir = undefined

  /**
   * @returns {Promise<void>}
   */
  async start() {
    const serverArgs = {...(this.options.serverArgs ?? {})}

    if (this.options.useDrivers && !serverArgs.useDrivers) {
      serverArgs.useDrivers = this.options.useDrivers
    }

    if (this.options.serverUrl) {
      this.serverUrl = this.options.serverUrl
    } else {
      const appiumMain = await this.resolveAppiumMain()

      this.appiumServer = await appiumMain(serverArgs)
      this.serverUrl = this.buildServerUrl(serverArgs)
    }

    const capabilities = this.options.capabilities ? {...this.options.capabilities} : {}

    if (this.options.browserName && !capabilities.browserName) {
      capabilities.browserName = this.options.browserName
    }
    if (capabilities.browserName === undefined) {
      capabilities.browserName = ""
    }

    this.chromeUserDataDir = await ensureChromeUserDataDirCapability({
      browserName: this.options.browserName,
      capabilities
    })
    ensureNativeNewCommandTimeoutCapability({capabilities})

    const builder = new Builder().usingServer(this.serverUrl)

    if (Object.keys(capabilities).length > 0) {
      builder.withCapabilities(capabilities)
    }

    try {
      const webDriver = await builder.build()

      this.setWebDriver(webDriver)
      this.installExitHandlers()
    } catch (error) {
      await this.cleanupChromeUserDataDir()
      throw error
    }
  }

  /**
   * Imports the optional `appium` package. Isolated as a seam so the missing-package
   * path can be unit tested without uninstalling Appium. The specifier is widened to
   * `string` so the build/typecheck does not statically require appium's types when the
   * optional dependency is not installed.
   * @returns {Promise<Record<string, any>>}
   */
  async loadAppiumModule() {
    const appiumPackage = /** @type {string} */ ("appium")

    return await import(appiumPackage)
  }

  /**
   * Resolves Appium's `main()` for the embedded-server path, surfacing an actionable
   * install instruction when the optional `appium` package is not installed.
   * @returns {Promise<(serverArgs: Record<string, any>) => Promise<any>>}
   */
  async resolveAppiumMain() {
    let appiumModule

    try {
      appiumModule = await this.loadAppiumModule()
    } catch (error) {
      const code = error instanceof Error ? /** @type {{code?: string}} */ (error).code : undefined

      if (code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND") {
        throw errorWithCause("The Appium driver requires the optional 'appium' package, which is not installed. Run `npm install --save-dev appium` (plus any Appium drivers you need, e.g. appium-uiautomator2-driver), or pass driver.options.serverUrl to use an external Appium server.", error)
      }

      throw error
    }

    const appiumMain = appiumModule.main ?? appiumModule.default?.main

    if (!appiumMain) {
      throw new Error("Appium main() is unavailable from the appium package")
    }

    return appiumMain
  }

  /**
   * @returns {Promise<void>}
   */
  async stop() {
    try {
      await super.stop()
    } finally {
      if (this.appiumServer?.close) {
        await timeout({timeout: this.getTimeouts(), errorMessage: "timeout while closing Appium server"}, async () => await /** @type {NonNullable<typeof this.appiumServer>} */ (this.appiumServer).close())
      }

      this.appiumServer = undefined
      await this.cleanupChromeUserDataDir()
    }
  }

  /** @returns {Promise<void>} */
  async cleanupChromeUserDataDir() {
    if (!this.chromeUserDataDir) return

    const chromeUserDataDir = this.chromeUserDataDir

    this.chromeUserDataDir = undefined
    await fs.rm(chromeUserDataDir, {recursive: true, force: true})
  }

  /**
   * Deletes all cookies. Skipped for native app contexts where cookie
   * management is not supported by UiAutomator2.
   * @returns {Promise<void>}
   */
  async deleteAllCookies() {
    const browserName = this.options.capabilities?.browserName ?? this.options.browserName

    if (!browserName) return

    await super.deleteAllCookies()
  }

  /**
   * @returns {Promise<string[]>}
   */
  async getBrowserLogs() {
    const platformName = this.options.capabilities?.platformName
    const browserName = this.options.capabilities?.browserName ?? this.options.browserName
    const isAndroid = typeof platformName === "string" && platformName.toLowerCase() === "android"

    if (isAndroid && !browserName) {
      let entries

      try {
        entries = await this.getWebDriver().manage().logs().get("logcat")
      } catch {
        return []
      }

      const logcatLogs = []

      for (const entry of entries) {
        const messageMatch = entry.message.match(/^(.+) (\d+):(\d+) (.+)$/)
        const message = messageMatch ? messageMatch[4] : entry.message

        logcatLogs.push(`${entry.level.name}: ${message}`)
      }

      return logcatLogs
    }

    return await super.getBrowserLogs()
  }

  /**
   * Finds a single element by test ID.
   * @param {string} testID
   * @param {FindArgs} [args]
   * @returns {Promise<import("selenium-webdriver").WebElement>}
   */
  async findByTestID(testID, args) {
    const testIdStrategy = this.options.testIdStrategy ?? "accessibilityId"

    if (testIdStrategy === "css") {
      const testIdAttribute = this.options.testIdAttribute ?? "data-testid"
      return await this.find(`[${testIdAttribute}='${testID}']`, args)
    }
    if (testIdStrategy === "id") {
      return await this.findById(testID, args)
    }

    return await this.findByAccessibilityId(testID, args)
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
      if (error instanceof Error && error.message.startsWith("Element couldn't be found after ")) {
        return false
      }

      throw error
    }
  }

  /**
   * @param {string} testId
   * @param {FindArgs} [args]
   * @returns {Promise<import("selenium-webdriver").WebElement>}
   */
  async findByAccessibilityId(testId, args = {}) {
    const startTime = Date.now()
    /** @type {import("selenium-webdriver").WebElement[]} */
    let elements

    try {
      elements = await this.allByAccessibilityId(testId, args)
    } catch (error) {
      if (error instanceof Error) {
        throw errorWithCause(`${error.constructor.name} - ${error.message} (accessibility id: ${testId})`, error)
      }

      throw errorWithCause(`${typeof error} - ${error} (accessibility id: ${testId})`, error)
    }

    if (elements.length > 1) {
      throw new Error(`More than 1 elements (${elements.length}) was found by accessibility id: ${testId}`)
    }

    if (!elements[0]) {
      const elapsedSeconds = (Date.now() - startTime) / 1000
      throw new Error(`Element couldn't be found after ${elapsedSeconds.toFixed(2)}s by accessibility id: ${testId}`)
    }

    return elements[0]
  }

  /**
   * @param {string} testId
   * @param {FindArgs} [args]
   * @returns {Promise<import("selenium-webdriver").WebElement[]>}
   */
  async allByAccessibilityId(testId, args = {}) {
    const {scrollContainerTestIDs, scrollTo = false, visible = true, timeout, ...restArgs} = args
    void scrollContainerTestIDs
    const restArgsKeys = Object.keys(restArgs).filter((key) => key !== "useBaseSelector")
    let actualTimeout

    if (timeout === undefined) {
      actualTimeout = this._driverTimeouts
    } else {
      actualTimeout = timeout
    }

    if (restArgsKeys.length > 0) throw new Error(`Unknown arguments: ${restArgsKeys.join(", ")}`)

    const startTime = Date.now()
    const getTimeLeft = () => Math.max(actualTimeout - (Date.now() - startTime), 0)
    const getElements = async () => {
      const foundElements = await this.getWebDriver().findElements(new By("accessibility id", testId))

      if (visible !== true && visible !== false) {
        return foundElements
      }

      const filteredElements = []

      for (const element of foundElements) {
        const isDisplayed = await this.isElementDisplayed(element)

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
        if (error instanceof Error && error.constructor.name === "TimeoutError" && getTimeLeft() > 0) {
          continue
        }

        throw errorWithCause(`Couldn't get elements with accessibility id: ${testId}: ${error instanceof Error ? error.message : error}`, error)
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
   * Checks if an element is displayed. For native app contexts, always
   * returns true because Selenium's isDisplayed() JS atom is not supported
   * by UiAutomator2 in native mode, and elements found by UiAutomator2's
   * accessibility id / id search are already in the rendered view hierarchy.
   * @param {import("selenium-webdriver").WebElement} element
   * @returns {Promise<boolean>}
   */
  async isElementDisplayed(element) {
    const browserName = this.options.capabilities?.browserName ?? this.options.browserName

    if (!browserName) return true

    return await element.isDisplayed()
  }

  /**
   * @param {string} testId
   * @param {FindArgs} [args]
   * @returns {Promise<import("selenium-webdriver").WebElement>}
   */
  async findById(testId, args = {}) {
    if (this.isAndroidNativeAppContext() && args.scrollTo) {
      return await this.findNativeControlById(testId, args)
    }

    const startTime = Date.now()
    /** @type {import("selenium-webdriver").WebElement[]} */
    let elements

    try {
      elements = await this.allById(testId, args)
    } catch (error) {
      if (error instanceof Error) {
        throw errorWithCause(`${error.constructor.name} - ${error.message} (id: ${testId})`, error)
      }

      throw errorWithCause(`${typeof error} - ${error} (id: ${testId})`, error)
    }

    if (elements.length > 1) {
      throw new Error(`More than 1 elements (${elements.length}) was found by id: ${testId}`)
    }

    if (!elements[0]) {
      const elapsedSeconds = (Date.now() - startTime) / 1000
      throw new Error(`Element couldn't be found after ${elapsedSeconds.toFixed(2)}s by id: ${testId}`)
    }

    return elements[0]
  }

  /**
   * @param {string} testId
   * @param {FindArgs} [args]
   * @returns {Promise<import("selenium-webdriver").WebElement[]>}
   */
  async allById(testId, args = {}) {
    const {scrollContainerTestIDs, scrollTo = false, visible = true, timeout, ...restArgs} = args
    void scrollContainerTestIDs
    const restArgsKeys = Object.keys(restArgs).filter((key) => key !== "useBaseSelector")
    let actualTimeout

    if (timeout === undefined) {
      actualTimeout = this._driverTimeouts
    } else {
      actualTimeout = timeout
    }

    if (restArgsKeys.length > 0) throw new Error(`Unknown arguments: ${restArgsKeys.join(", ")}`)

    const startTime = Date.now()
    const getTimeLeft = () => Math.max(actualTimeout - (Date.now() - startTime), 0)
    const getElements = async () => {
      const foundElements = await this.getWebDriver().findElements(this.idLocator(testId))

      if (visible !== true && visible !== false) {
        return foundElements
      }

      const filteredElements = []

      for (const element of foundElements) {
        const isDisplayed = await this.isElementDisplayed(element)

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
        if (error instanceof Error && error.constructor.name === "TimeoutError" && getTimeLeft() > 0) {
          continue
        }

        throw errorWithCause(`Couldn't get elements with id: ${testId}: ${error instanceof Error ? error.message : error}`, error)
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
   * Builds an id locator for the active Appium context.
   * @param {string} testId Test id or native resource id suffix.
   * @returns {By} Selenium/Appium locator.
   */
  idLocator(testId) {
    if (this.isAndroidNativeAppContext()) {
      return new By("-android uiautomator", androidResourceIdSelector(testId))
    }

    return By.id(testId)
  }

  /**
   * Finds native Android visible text or an accessibility label, scrolling it into view when needed.
   * @param {string} expectedText Text to locate.
   * @param {FindArgs} [args] Optional lookup settings.
   * @returns {Promise<import("selenium-webdriver").WebElement>} Native element containing the text.
   */
  async findByNativeText(expectedText, args = {}) {
    if (!this.isAndroidNativeAppContext()) {
      throw new Error("findByNativeText is only supported for native Android Appium sessions")
    }

    const selectors = [androidTextContainsSelector(expectedText), androidDescriptionContainsSelector(expectedText)]
    const directFind = async () => {
      for (const selector of selectors) {
        const elements = await this.getWebDriver().findElements(new By("-android uiautomator", selector))

        if (elements.length > 0) return elements[0]
      }

      throw new Error(`Element couldn't be found by text or accessibility label: ${expectedText}`)
    }

    return await this.withNativeImplicitWait(0, async () => {
      return await this.findNativeControlWithScrolling({
        description: `text or accessibility label: ${expectedText}`,
        directFind,
        scrollSelectors: selectors
      }, {...args, scrollTo: args.scrollTo ?? true})
    })
  }

  /**
   * Waits until a test id owns expected visible text or an accessibility label.
   * @param {string} testId Stable native resource id suffix.
   * @param {string} expectedText Text that must appear under the test id.
   * @param {FindArgs} [args] Optional lookup settings.
   * @returns {Promise<void>}
   */
  async waitForTestIDText(testId, expectedText, args = {}) {
    if (!this.isAndroidNativeAppContext()) {
      await super.waitForTestIDText(testId, expectedText, args)
      return
    }

    const selectors = nativeTestIDTextSelectors(testId, expectedText)
    const scopedTextXpath = androidScopedTextXpath(testId, expectedText)
    const directFind = async () => {
      for (const selector of selectors) {
        const elements = await this.getWebDriver().findElements(new By("-android uiautomator", selector))

        if (elements.length > 1) {
          throw new Error(`More than 1 elements (${elements.length}) were found by id ${testId} with text ${expectedText}`)
        }
        if (elements[0]) return elements[0]
      }

      const scopedTextElements = await this.getWebDriver().findElements(By.xpath(scopedTextXpath))
      if (scopedTextElements[0]) return scopedTextElements[0]

      throw new Error(`Element couldn't be found by id ${testId} with text ${expectedText}`)
    }

    await this.withNativeImplicitWait(0, async () => {
      await this.findNativeControlWithScrolling({
        description: `id ${testId} with text ${expectedText}`,
        directFind,
        scrollSelectors: nativeTestIDTextScrollSelectors(testId, expectedText)
      }, {...args, scrollTo: args.scrollTo ?? true})
    })
  }

  /**
   * Finds a native Android control by resource id, scrolling it into view first when requested.
   * @param {string} testId Stable native resource id suffix.
   * @param {FindArgs} [args] Optional lookup settings.
   * @returns {Promise<import("selenium-webdriver").WebElement>} Matching native element.
   */
  async findNativeControlById(testId, args = {}) {
    const directFind = async () => await this.findById(testId, {...args, timeout: 0, scrollTo: false})

    return await this.withNativeImplicitWait(0, async () => {
      return await this.findNativeControlWithScrolling({
        description: `id: ${testId}`,
        directFind,
        scrollSelectors: [androidResourceIdSelector(testId)]
      }, args)
    })
  }

  /**
   * Finds a native control, trying direct lookup, UiScrollable, and viewport gesture scrolling.
   * @param {NativeControlLookup} lookup Lookup callbacks and diagnostics.
   * @param {FindArgs} [args] Optional lookup settings.
   * @returns {Promise<import("selenium-webdriver").WebElement>} Matching native element.
   */
  async findNativeControlWithScrolling(lookup, args = {}) {
    const {scrollContainerTestIDs = [], scrollTo = true, timeout = 10000} = args
    const startTime = Date.now()
    let attemptedUiSelectorScroll = false
    /** @type {unknown} */
    let lastError

    do {
      try {
        return await lookup.directFind()
      } catch (error) {
        if (!isNativeControlLookupMiss(error)) throw error
        lastError = error
      }

      if (scrollTo) {
        if (!attemptedUiSelectorScroll) {
          attemptedUiSelectorScroll = true
          for (const scrollSelector of lookup.scrollSelectors) {
            try {
              await this.scrollNativeUiSelectorIntoView(scrollSelector, scrollContainerTestIDs)
            } catch (error) {
              void error
            }
          }
        }

        try {
          return await lookup.directFind()
        } catch (error) {
          if (!isNativeControlLookupMiss(error)) throw error
          void error
        }

        try {
          return await this.findNativeControlWithViewportScan(lookup.directFind, scrollContainerTestIDs)
        } catch (error) {
          if (!isNativeControlLookupMiss(error)) throw error
          lastError = error
        }
      }

      if (timeout === 0) break
      await wait(100)
    } while (Date.now() - startTime < timeout)

    const elapsedSeconds = (Date.now() - startTime) / 1000
    throw errorWithCause(`Element couldn't be found after ${elapsedSeconds.toFixed(2)}s by ${lookup.description}`, lastError)
  }

  /**
   * Searches native content around the current viewport so retained offsets and
   * below-fold targets are both reachable without exhausting the timeout budget.
   * @param {() => Promise<import("selenium-webdriver").WebElement>} directFind Lookup to retry after each scroll.
   * @param {string[]} scrollContainerTestIDs Native test IDs that may identify scroll containers.
   * @returns {Promise<import("selenium-webdriver").WebElement>} Matching control.
   */
  async findNativeControlWithViewportScan(directFind, scrollContainerTestIDs) {
    const upScrollState = this.newNativeViewportScrollState()
    const downScrollState = this.newNativeViewportScrollState()

    for (let index = 0; index < MAX_NATIVE_VIEWPORT_SCROLL_STEPS; index += 1) {
      await this.scrollNativeViewport(upScrollState, scrollContainerTestIDs, "up")

      try {
        return await directFind()
      } catch (error) {
        if (!isNativeControlLookupMiss(error)) throw error
      }

      await this.scrollNativeViewport(downScrollState, scrollContainerTestIDs, "down")

      try {
        return await directFind()
      } catch (error) {
        if (!isNativeControlLookupMiss(error)) throw error
      }
    }

    throw new Error("Element couldn't be found after native viewport scan")
  }

  /**
   * @returns {NativeViewportScrollState} Fresh scroll fallback state.
   */
  newNativeViewportScrollState() {
    return {
      tryElementScroll: true,
      tryViewportScroll: true
    }
  }

  /**
   * Runs explicit native polling without Appium's implicit wait extending every failed probe.
   * @template TResult Result type.
   * @param {number} implicitWaitMs Implicit wait duration to apply during the callback.
   * @param {() => Promise<TResult>} callback Work that owns its own polling timeout.
   * @returns {Promise<TResult>} Callback result.
   */
  async withNativeImplicitWait(implicitWaitMs, callback) {
    const timeouts = /** @type {NativeTimeouts} */ (await this.getWebDriver().manage().getTimeouts())

    await this.getWebDriver().manage().setTimeouts(/** @type {NativeTimeoutOptions} */ ({implicit: implicitWaitMs}))
    try {
      return await callback()
    } finally {
      await this.getWebDriver().manage().setTimeouts(/** @type {NativeTimeoutOptions} */ ({implicit: timeouts.implicit}))
    }
  }

  /**
   * Scrolls the visible native viewport when UiScrollable cannot identify the owning ScrollView.
   * @param {NativeViewportScrollState} scrollState Per-lookup Appium scroll state.
   * @param {string[]} scrollContainerTestIDs Native test IDs that may identify scroll containers.
   * @param {NativeViewportScrollDirection} direction Direction to scroll the content.
   * @returns {Promise<void>} Resolves after Appium performs the gesture.
   */
  async scrollNativeViewport(scrollState, scrollContainerTestIDs, direction) {
    const windowRect = /** @type {NativeWindowRect} */ (await this.getWebDriver().manage().window().getRect())
    const horizontalInset = Math.max(1, Math.floor(windowRect.width * 0.1))
    const top = Math.max(1, Math.floor(windowRect.height * 0.2))
    const width = Math.max(1, windowRect.width - horizontalInset * 2)
    const height = Math.max(1, Math.floor(windowRect.height * 0.6))

    if (scrollState.tryElementScroll && scrollContainerTestIDs.length > 0) {
      for (const scrollContainerTestID of scrollContainerTestIDs) {
        try {
          const didScroll = await this.scrollNativeElement(scrollContainerTestID, direction)
          if (didScroll) return
        } catch (error) {
          scrollState.tryElementScroll = false
          if (!isUnsupportedMobileGestureError(error)) throw error
        }
      }

      scrollState.tryElementScroll = false
    }

    if (scrollState.tryViewportScroll) {
      try {
        const didScroll = await this.getWebDriver().executeScript("mobile: scrollGesture", {
          direction,
          height,
          left: horizontalInset,
          percent: 0.75,
          top,
          width
        })
        if (didScroll === true) return
        scrollState.tryViewportScroll = false
      } catch (error) {
        scrollState.tryViewportScroll = false
        if (!isUnsupportedMobileGestureError(error)) throw error
      }
    }

    const centerX = Math.floor(windowRect.x + windowRect.width / 2)
    const startY = Math.floor(windowRect.y + windowRect.height * (direction === "down" ? 0.78 : 0.28))
    const endY = Math.floor(windowRect.y + windowRect.height * (direction === "down" ? 0.28 : 0.78))

    await this.getWebDriver().execute(new Command(Name.ACTIONS).setParameter("actions", [
      {
        actions: [
          {duration: 100, origin: Origin.VIEWPORT, type: "pointerMove", x: centerX, y: startY},
          {button: 0, type: "pointerDown"},
          {duration: 250, origin: Origin.VIEWPORT, type: "pointerMove", x: centerX, y: endY},
          {button: 0, type: "pointerUp"}
        ],
        id: "native scroll finger",
        parameters: {
          pointerType: "touch"
        },
        type: "pointer"
      }
    ]))
  }

  /**
   * Scrolls a specific native Android element by test id when Appium exposes it as a scroll container.
   * @param {string} testId Stable native resource id suffix.
   * @param {NativeViewportScrollDirection} direction Direction to scroll the content.
   * @returns {Promise<boolean>} Whether Appium reported more content to scroll.
   */
  async scrollNativeElement(testId, direction) {
    const elements = await this.getWebDriver().findElements(new By("-android uiautomator", androidResourceIdSelector(testId)))
    const scrollElement = elements[0]

    if (!scrollElement) return false

    const didScroll = await this.getWebDriver().executeScript("mobile: scrollGesture", {
      direction,
      elementId: await scrollElement.getId(),
      percent: 0.75
    })

    return didScroll === true
  }

  /**
   * Moves an offscreen Android control into a ScrollView-backed native hierarchy.
   * @param {string} uiSelector UiAutomator selector for the target control.
   * @param {string[]} scrollContainerTestIDs Native test IDs that may identify scroll containers.
   * @returns {Promise<void>} Resolves after UiAutomator attempts the scroll.
   */
  async scrollNativeUiSelectorIntoView(uiSelector, scrollContainerTestIDs) {
    const scrollableSelectors = [
      ...scrollContainerTestIDs.map((scrollContainerTestID) => androidResourceIdSelector(scrollContainerTestID)),
      "new UiSelector().scrollable(true)"
    ]
    /** @type {unknown} */
    let lastError

    for (const scrollableSelector of scrollableSelectors) {
      try {
        const elements = await this.getWebDriver().findElements(new By("-android uiautomator", `new UiScrollable(${scrollableSelector}).scrollIntoView(${uiSelector})`))
        if (elements.length > 0) return
      } catch (error) {
        lastError = error
      }
    }

    if (lastError) throw lastError
  }

  /**
   * Checks whether the current session is a native Android app, not Android Chrome.
   * @returns {boolean} True when UiAutomator resource-id lookup should be used.
   */
  isAndroidNativeAppContext() {
    const platformName = this.options.capabilities?.platformName
    const browserName = this.options.capabilities?.browserName ?? this.options.browserName

    return typeof platformName === "string" && platformName.toLowerCase() === "android" && !browserName
  }

  /**
   * @param {Record<string, any>} serverArgs
   * @returns {string}
   */
  buildServerUrl(serverArgs) {
    const address = serverArgs.address ?? "127.0.0.1"
    const port = serverArgs.port ?? 4723
    const basePath = serverArgs.basePath ? (serverArgs.basePath.startsWith("/") ? serverArgs.basePath : `/${serverArgs.basePath}`) : ""

    return `http://${address}:${port}${basePath}`
  }
}
