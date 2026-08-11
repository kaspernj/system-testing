import {Builder} from "selenium-webdriver"
import timeout from "awaitery/build/timeout.js"
import chrome from "selenium-webdriver/chrome.js"
import {resolveChromeRuntime} from "../chrome-runtime-manager.js"
import WebDriverDriver from "./webdriver-driver.js"

const DEFAULT_DRIVER_START_TIMEOUT_MS = 60000

/**
 * @typedef {object} SeleniumDriverOptions
 * @property {string} [browserName] Browser name used by the WebDriver session.
 * @property {string[]} [chromeArguments] Chrome CLI arguments.
 * @property {string} [chromeBinaryPath] Path to a specific Chrome binary to launch.
 * @property {string} [chromedriverPath] Path to the Chromedriver executable.
 * @property {string} [chromeRuntimeCachePath] Cache path for the managed Chrome Headless Shell and ChromeDriver pair.
 * @property {typeof resolveChromeRuntime} [chromeRuntimeResolver] Chrome runtime resolver override, primarily for isolated tests.
 * @property {import("selenium-webdriver/chrome.js").Options} [chromeOptions] Preconfigured Chrome options instance.
 * @property {Record<string, any>} [capabilities] Extra WebDriver capabilities.
 * @property {number} [driverStartTimeout] Timeout while waiting for Selenium to create a WebDriver session.
 * @property {Record<string, any>} [loggingPrefs] Logging preferences for browser logs.
 */

/**
 * Selenium WebDriver implementation.
 */
export default class SeleniumDriver extends WebDriverDriver {
  /**
   * @returns {Promise<void>}
   */
  async start() {
    const browserName = this.options.browserName ?? "chrome"
    const chromeOptions = this.options.chromeOptions ? this.options.chromeOptions : new chrome.Options()
    const optionsChromeBinaryPath = chromeOptions.get("goog:chromeOptions")?.binary

    if (optionsChromeBinaryPath && this.options.chromeBinaryPath && optionsChromeBinaryPath !== this.options.chromeBinaryPath) {
      throw new Error(`Conflicting Chrome binary paths configured through chromeOptions (${optionsChromeBinaryPath}) and chromeBinaryPath (${this.options.chromeBinaryPath})`)
    }

    const chromeRuntime = browserName === "chrome" ? await (this.options.chromeRuntimeResolver ?? resolveChromeRuntime)({
      cachePath: this.options.chromeRuntimeCachePath,
      chromeBinaryPath: this.options.chromeBinaryPath ?? optionsChromeBinaryPath,
      chromedriverPath: this.options.chromedriverPath
    }) : undefined
    const chromeArguments = this.options.chromeArguments ?? [
      // Keep the headless/occluded renderer at full speed. Chrome otherwise throttles and
      // backgrounds it in CI, which surfaces as "Timed out receiving message from renderer"
      // when chromedriver waits on the renderer during navigation.
      "--disable-backgrounding-occluded-windows",
      "--disable-background-timer-throttling",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-renderer-backgrounding",
      "--headless=new",
      "--no-sandbox",
      "--window-size=1920,1080"
    ]

    for (const argument of chromeArguments) {
      chromeOptions.addArguments(argument)
    }

    // Launch a specific Chrome binary when configured (e.g. a pinned Chrome for Testing
    // build) so the browser and the matched Chromedriver stay on the same exact version.
    const chromeBinaryPath = chromeRuntime?.chromeBinaryPath ?? this.options.chromeBinaryPath ?? process.env.SYSTEM_TEST_CHROME_BINARY

    if (chromeBinaryPath) {
      chromeOptions.setBinaryPath(chromeBinaryPath)
    }

    const builder = new Builder().forBrowser(browserName).setChromeOptions(chromeOptions)
    const capabilities = builder.getCapabilities()
    const chromedriverPath = chromeRuntime?.chromedriverPath ?? this.options.chromedriverPath ?? process.env.SYSTEM_TEST_CHROMEDRIVER_PATH

    if (chromedriverPath) {
      builder.setChromeService(new chrome.ServiceBuilder(chromedriverPath))
    }

    const loggingPrefs = this.options.loggingPrefs ?? {browser: "ALL"}
    capabilities.set("goog:loggingPrefs", loggingPrefs)

    // Return navigation at DOMContentLoaded instead of waiting for the full "load" event.
    // The system-test app keeps WebSocket/Scoundrel connections open after first paint, which
    // can hold the load event and hang driverVisit; readiness is asserted explicitly afterwards
    // via systemTestingComponent and the client WebSocket.
    if (!capabilities.get("pageLoadStrategy")) {
      capabilities.set("pageLoadStrategy", "eager")
    }

    if (this.options.capabilities) {
      for (const [key, value] of Object.entries(this.options.capabilities)) {
        capabilities.set(key, value)
      }
    }

    const webDriver = await timeout({timeout: this.options.driverStartTimeout ?? DEFAULT_DRIVER_START_TIMEOUT_MS, errorMessage: "timeout while starting Selenium WebDriver"}, async () => {
      return await builder.build()
    })

    this.setWebDriver(webDriver)
    this.installExitHandlers()
  }
}
