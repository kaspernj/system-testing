import {Builder, By} from "selenium-webdriver"
import timeout from "awaitery/build/timeout.js"
import WebDriverDriver from "./webdriver-driver.js"

/**
 * @typedef {object} AppiumDriverOptions
 * @property {string} [serverUrl] Remote Appium server URL to connect to.
 * @property {Record<string, any>} [serverArgs] Options passed to the Appium server.
 * @property {string[]} [useDrivers] Appium driver names to load when starting the server.
 * @property {Record<string, any>} [capabilities] Desired capabilities for the session.
 * @property {string} [browserName] Browser name for web sessions.
 * @property {"accessibilityId"|"css"} [testIdStrategy] Strategy for resolving test IDs.
 * @property {string} [testIdAttribute] Attribute name when using the CSS test ID strategy.
 */
/**
 * @typedef {object} FindArgs
 * @property {number} [timeout] Override timeout for lookup.
 * @property {boolean} [visible] Whether to require elements to be visible.
 * @property {boolean} [useBaseSelector] Whether to scope by the base selector.
 */

/**
 * Appium driver backed by the Appium server package.
 */
export default class AppiumDriver extends WebDriverDriver {
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

    const builder = new Builder().usingServer(this.serverUrl)

    if (Object.keys(capabilities).length > 0) {
      builder.withCapabilities(capabilities)
    }

    const webDriver = await builder.build()

    this.setWebDriver(webDriver)
  }

  /**
   * @returns {Promise<void>}
   */
  async stop() {
    await super.stop()

    if (this.appiumServer?.close) {
      await timeout({timeout: this.getTimeouts(), errorMessage: "timeout while closing Appium server"}, async () => await this.appiumServer.close())
    }

    this.appiumServer = undefined
  }

  /**
   * Finds a single element by test ID.
   * @param {string} testId
   * @param {FindArgs} [args]
   * @returns {Promise<import("selenium-webdriver").WebElement>}
   */
  async findByTestId(testId, args) {
    const testIdStrategy = this.options.testIdStrategy ?? "accessibilityId"

    if (testIdStrategy === "css") {
      const testIdAttribute = this.options.testIdAttribute ?? "data-testid"
      return await this.find(`[${testIdAttribute}='${testId}']`, args)
    }

    return await this.findByAccessibilityId(testId, args)
  }

  /**
   * Finds a single element by test ID.
   * @param {string} testID
   * @param {FindArgs} [args]
   * @returns {Promise<import("selenium-webdriver").WebElement>}
   */
  async findByTestID(testID, args) {
    return await this.findByTestId(testID, args)
  }

  /**
   * @param {string} testId
   * @param {FindArgs} [args]
   * @returns {Promise<import("selenium-webdriver").WebElement>}
   */
  async findByAccessibilityId(testId, args = {}) {
    const startTime = Date.now()
    let elements = []

    try {
      elements = await this.allByAccessibilityId(testId, args)
    } catch (error) {
      // Re-throw to recover stack trace
      if (error instanceof Error) {
        if (error.message.startsWith("Wait timed out after")) {
          elements = []
        }

        throw new Error(`${error.constructor.name} - ${error.message} (accessibility id: ${testId})`)
      } else {
        throw new Error(`${typeof error} - ${error} (accessibility id: ${testId})`)
      }
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
    const {visible = true, timeout, ...restArgs} = args
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
        if (error instanceof Error && error.constructor.name === "TimeoutError" && getTimeLeft() > 0) {
          continue
        }

        throw new Error(`Couldn't get elements with accessibility id: ${testId}: ${error instanceof Error ? error.message : error}`)
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
