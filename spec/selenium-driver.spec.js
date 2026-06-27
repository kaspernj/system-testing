// @ts-check

import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import timeout from "awaitery/build/timeout.js"
import {Builder} from "selenium-webdriver"
import chrome from "selenium-webdriver/chrome.js"
import SeleniumDriver from "../src/drivers/selenium-driver.js"

/**
 * @param {Record<string, any>} [options]
 * @returns {{driver: SeleniumDriver, browser: {driver: any, throwIfHttpServerError: () => void}}}
 */
function newDriver(options = {}) {
  const browser = {
    driver: undefined,
    throwIfHttpServerError: () => {}
  }
  const driver = new SeleniumDriver({
    browser: /** @type {any} */ (browser),
    options
  })

  return {driver, browser}
}

/**
 * @param {Partial<Record<keyof Builder, any>>} methods
 * @param {() => Promise<void>} callback
 * @returns {Promise<void>}
 */
async function withPatchedBuilder(methods, callback) {
  const originalMethods = new Map()

  for (const [methodName, replacement] of Object.entries(methods)) {
    originalMethods.set(methodName, Builder.prototype[methodName])
    Builder.prototype[methodName] = replacement
  }

  try {
    await callback()
  } finally {
    for (const [methodName, originalMethod] of originalMethods) {
      Builder.prototype[methodName] = originalMethod
    }
  }
}

describe("SeleniumDriver", () => {
  it("uses Chromedriver from PATH before falling back to Selenium Manager", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "system-testing-chromedriver-"))
    const chromedriverPath = path.join(tempDir, process.platform === "win32" ? "chromedriver.exe" : "chromedriver")
    const originalPath = process.env.PATH
    const {driver} = newDriver()
    let configuredService

    await fs.writeFile(chromedriverPath, "")
    await fs.chmod(chromedriverPath, 0o755)
    process.env.PATH = `${tempDir}${path.delimiter}${originalPath ?? ""}`

    try {
      await withPatchedBuilder({
        setChromeService(service) {
          configuredService = service
          return this
        },
        async build() {
          return {
            quit: async () => {}
          }
        }
      }, async () => {
        await driver.start()
      })
    } finally {
      if (originalPath === undefined) {
        delete process.env.PATH
      } else {
        process.env.PATH = originalPath
      }
      await fs.rm(tempDir, {recursive: true, force: true})
      driver._removeExitHandlers()
    }

    expect(configuredService instanceof chrome.ServiceBuilder).toBeTrue()
  })

  it("requests the eager page load strategy so navigation does not block on the full load event", async () => {
    const {driver} = newDriver({chromedriverPath: process.execPath})
    let pageLoadStrategy

    try {
      await withPatchedBuilder({
        async build() {
          pageLoadStrategy = this.getCapabilities().get("pageLoadStrategy")

          return {quit: async () => {}}
        }
      }, async () => {
        await driver.start()
      })
    } finally {
      driver._removeExitHandlers()
    }

    expect(pageLoadStrategy).toEqual("eager")
  })

  it("uses an explicit Chromedriver service when a path is configured", async () => {
    const {driver, browser} = newDriver({chromedriverPath: process.execPath})
    const fakeWebDriver = {
      quit: async () => {}
    }
    let configuredService

    try {
      await withPatchedBuilder({
        setChromeService(service) {
          configuredService = service
          return this
        },
        async build() {
          return fakeWebDriver
        }
      }, async () => {
        await driver.start()
      })
    } finally {
      driver._removeExitHandlers()
    }

    expect(configuredService instanceof chrome.ServiceBuilder).toBeTrue()
    expect(browser.driver).toBe(fakeWebDriver)
  })

  it("fails with a startup timeout when Selenium does not return a WebDriver session", async () => {
    const {driver} = newDriver({driverStartTimeout: 20})

    await withPatchedBuilder({
      async build() {
        return await new Promise(() => {})
      }
    }, async () => {
      await timeout({timeout: 100, errorMessage: "SeleniumDriver.start did not time out"}, async () => {
        await expectAsync(driver.start()).toBeRejectedWithError(/timeout while starting Selenium WebDriver/)
      })
    })
  })
})
