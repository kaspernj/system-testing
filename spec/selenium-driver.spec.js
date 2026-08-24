// @ts-check

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
    options: {chromeRuntimeResolver: async () => undefined, ...options}
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
  it("exposes a lazily resolved exact Chrome runtime to Selenium startup", async () => {
    const resolver = jasmine.createSpy("resolver").and.resolveTo({
      chromeBinaryPath: "/cache/chrome-headless-shell",
      chromedriverPath: "/cache/chromedriver",
      version: "131.0.6778.85"
    })
    const {driver} = newDriver({chromeRuntimeCachePath: "/custom/cache", chromeRuntimeResolver: resolver})
    let chromeBinary
    let configuredService

    try {
      await withPatchedBuilder({
        setChromeOptions(chromeOptions) {
          chromeBinary = chromeOptions.get("goog:chromeOptions")?.binary
          return this
        },
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
      driver._removeExitHandlers()
    }

    expect(resolver).toHaveBeenCalledWith({
      cachePath: "/custom/cache",
      chromeBinaryPath: undefined,
      chromedriverPath: undefined
    })
    expect(chromeBinary).toEqual("/cache/chrome-headless-shell")
    expect(configuredService instanceof chrome.ServiceBuilder).toBeTrue()
  })

  it("launches a configured Chrome binary so the browser matches the pinned Chromedriver", async () => {
    const {driver} = newDriver({chromedriverPath: process.execPath, chromeBinaryPath: "/opt/chrome-for-testing/chrome-linux64/chrome"})
    let chromeBinary

    try {
      await withPatchedBuilder({
        setChromeOptions(chromeOptions) {
          chromeBinary = chromeOptions.get("goog:chromeOptions")?.binary

          return this
        },
        async build() {
          return {quit: async () => {}}
        }
      }, async () => {
        await driver.start()
      })
    } finally {
      driver._removeExitHandlers()
    }

    expect(chromeBinary).toEqual("/opt/chrome-for-testing/chrome-linux64/chrome")
  })

  it("preserves a binary configured through chromeOptions as an explicit runtime override", async () => {
    const chromeOptions = new chrome.Options().setChromeBinaryPath("/options/chrome")
    const resolver = jasmine.createSpy("resolver").and.resolveTo({
      chromeBinaryPath: "/options/chrome",
      chromedriverPath: "/cache/chromedriver",
      version: "131.0.6778.85"
    })
    const {driver} = newDriver({chromeOptions, chromeRuntimeResolver: resolver})
    let configuredBinary

    try {
      await withPatchedBuilder({
        setChromeOptions(options) {
          configuredBinary = options.get("goog:chromeOptions")?.binary
          return this
        },
        async build() { return {quit: async () => {}} }
      }, async () => { await driver.start() })
    } finally {
      driver._removeExitHandlers()
    }

    expect(resolver).toHaveBeenCalledWith({cachePath: undefined, chromeBinaryPath: "/options/chrome", chromedriverPath: undefined})
    expect(configuredBinary).toEqual("/options/chrome")
  })

  it("rejects conflicting explicit chromeOptions and chromeBinaryPath binaries", async () => {
    const {driver} = newDriver({
      chromeBinaryPath: "/direct/chrome",
      chromeOptions: new chrome.Options().setChromeBinaryPath("/options/chrome")
    })

    try {
      await expectAsync(driver.start()).toBeRejectedWithError(/conflicting Chrome binary/i)
    } finally {
      driver._removeExitHandlers()
    }
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

  it("dispatches visits through location assignment without waiting for Chrome renderer lifecycle", async () => {
    const {driver} = newDriver()
    const executeScript = jasmine.createSpy("executeScript").and.resolveTo(undefined)
    const get = jasmine.createSpy("get")

    driver.setBaseUrl("http://127.0.0.1:1984")
    driver.setWebDriver(/** @type {any} */ ({executeScript, get}))

    await driver.driverVisit("/blank?systemTest=true")

    expect(executeScript).toHaveBeenCalledOnceWith("window.location.assign(arguments[0])", "http://127.0.0.1:1984/blank?systemTest=true")
    expect(get).not.toHaveBeenCalled()
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
