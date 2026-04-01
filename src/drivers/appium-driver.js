import fs from "node:fs/promises"
import path from "node:path"
import {Builder, By} from "selenium-webdriver"
import timeout from "awaitery/build/timeout.js"
import WebDriverDriver from "./webdriver-driver.js"

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
      const appiumModule = await import("appium")
      const appiumMain = appiumModule.main ?? appiumModule.default?.main

      if (!appiumMain) {
        throw new Error("Appium main() is unavailable from the appium package")
      }

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

    const builder = new Builder().usingServer(this.serverUrl)

    if (Object.keys(capabilities).length > 0) {
      builder.withCapabilities(capabilities)
    }

    try {
      const webDriver = await builder.build()

      this.setWebDriver(webDriver)
    } catch (error) {
      await this.cleanupChromeUserDataDir()
      throw error
    }
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
    const {scrollTo = false, visible = true, timeout, ...restArgs} = args
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
    const {scrollTo = false, visible = true, timeout, ...restArgs} = args
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
      const foundElements = await this.getWebDriver().findElements(By.id(testId))

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
