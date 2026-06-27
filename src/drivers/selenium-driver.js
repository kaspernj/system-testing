import fs from "node:fs"
import path from "node:path"
import {Builder} from "selenium-webdriver"
import timeout from "awaitery/build/timeout.js"
import chrome from "selenium-webdriver/chrome.js"
import WebDriverDriver from "./webdriver-driver.js"

const DEFAULT_DRIVER_START_TIMEOUT_MS = 60000

/**
 * @typedef {object} SeleniumDriverOptions
 * @property {string} [browserName] Browser name used by the WebDriver session.
 * @property {string[]} [chromeArguments] Chrome CLI arguments.
 * @property {string} [chromedriverPath] Path to the Chromedriver executable.
 * @property {import("selenium-webdriver/chrome.js").Options} [chromeOptions] Preconfigured Chrome options instance.
 * @property {Record<string, any>} [capabilities] Extra WebDriver capabilities.
 * @property {number} [driverStartTimeout] Timeout while waiting for Selenium to create a WebDriver session.
 * @property {Record<string, any>} [loggingPrefs] Logging preferences for browser logs.
 */

/** @returns {string | undefined} */
function findChromedriverOnPath() {
  const pathEnv = process.env.PATH

  if (!pathEnv) return undefined

  const executableNames = process.platform === "win32" ? ["chromedriver.exe", "chromedriver.cmd", "chromedriver.bat", "chromedriver"] : ["chromedriver"]

  for (const directory of pathEnv.split(path.delimiter)) {
    if (!directory) continue

    for (const executableName of executableNames) {
      const executablePath = path.join(directory, executableName)

      if (isExecutableFile(executablePath)) return executablePath
    }
  }

  return undefined
}

/**
 * @param {string} filePath
 * @returns {boolean}
 */
function isExecutableFile(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.X_OK)
    return true
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && (error.code === "ENOENT" || error.code === "EACCES" || error.code === "ENOTDIR")) {
      return false
    }

    throw error
  }
}

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
    const chromedriverPath = this.options.chromedriverPath ?? process.env.SYSTEM_TEST_CHROMEDRIVER_PATH ?? findChromedriverOnPath()

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
