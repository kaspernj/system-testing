import {Builder} from "selenium-webdriver"
import chrome from "selenium-webdriver/chrome.js"
import WebDriverDriver from "./webdriver-driver.js"

/**
 * @typedef {object} SeleniumDriverOptions
 * @property {string} [browserName] Browser name used by the WebDriver session.
 * @property {string[]} [chromeArguments] Chrome CLI arguments.
 * @property {import("selenium-webdriver/chrome.js").Options} [chromeOptions] Preconfigured Chrome options instance.
 * @property {Record<string, any>} [capabilities] Extra WebDriver capabilities.
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
    const chromeOptions = this.options.chromeOptions ? this.options.chromeOptions : new chrome.Options()
    const chromeArguments = this.options.chromeArguments ?? [
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--headless=new",
      "--no-sandbox",
      "--window-size=1920,1080"
    ]

    for (const argument of chromeArguments) {
      chromeOptions.addArguments(argument)
    }

    const builder = new Builder().forBrowser(this.options.browserName ?? "chrome").setChromeOptions(chromeOptions)
    const capabilities = builder.getCapabilities()

    const loggingPrefs = this.options.loggingPrefs ?? {browser: "ALL"}
    capabilities.set("goog:loggingPrefs", loggingPrefs)

    if (this.options.capabilities) {
      for (const [key, value] of Object.entries(this.options.capabilities)) {
        capabilities.set(key, value)
      }
    }

    const webDriver = await builder.build()

    this.setWebDriver(webDriver)
  }
}
