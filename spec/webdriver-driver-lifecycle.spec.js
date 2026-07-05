// @ts-check

import WebDriverDriver from "../src/drivers/webdriver-driver.js"

/** @returns {{driver: WebDriverDriver, quitCalls: () => number}} */
function newDriver() {
  const driver = new WebDriverDriver({
    browser: /** @type {any} */ ({
      driver: undefined,
      throwIfHttpServerError: () => {}
    })
  })
  let quitCount = 0
  driver.setWebDriver(/** @type {any} */ ({
    quit: async () => {
      quitCount += 1
    }
  }))
  return {driver, quitCalls: () => quitCount}
}

describe("WebDriverDriver lifecycle", () => {
  it("bounds and restores the page-load timeout around withPageLoadTimeout callbacks", async () => {
    const setTimeoutsCalls = []
    const driver = new WebDriverDriver({
      browser: /** @type {any} */ ({
        driver: undefined,
        throwIfHttpServerError: () => {}
      })
    })

    driver.setWebDriver(/** @type {any} */ ({
      manage: () => ({
        setTimeouts: async (timeouts) => {
          setTimeoutsCalls.push(timeouts)
        }
      })
    }))

    const result = await driver.withPageLoadTimeout(20000, async () => "visited")

    expect(result).toBe("visited")
    expect(setTimeoutsCalls).toEqual([{pageLoad: 20000}, {pageLoad: 60000}])
  })

  it("restores the page-load timeout when the withPageLoadTimeout callback throws", async () => {
    const setTimeoutsCalls = []
    const driver = new WebDriverDriver({
      browser: /** @type {any} */ ({
        driver: undefined,
        throwIfHttpServerError: () => {}
      })
    })

    driver.setWebDriver(/** @type {any} */ ({
      manage: () => ({
        setTimeouts: async (timeouts) => {
          setTimeoutsCalls.push(timeouts)
        }
      })
    }))

    await expectAsync(driver.withPageLoadTimeout(20000, async () => {
      throw new Error("timeout: Timed out receiving message from renderer: -0.005")
    })).toBeRejectedWithError(/Timed out receiving message from renderer/)

    expect(setTimeoutsCalls).toEqual([{pageLoad: 20000}, {pageLoad: 60000}])
  })

  it("skips page-load timeout juggling when the driver has no page-load timeout", async () => {
    const setTimeoutsSpy = jasmine.createSpy("setTimeouts")
    const driver = new WebDriverDriver({
      browser: /** @type {any} */ ({
        driver: undefined,
        throwIfHttpServerError: () => {}
      })
    })

    driver.setWebDriver(/** @type {any} */ ({
      manage: () => ({setTimeouts: setTimeoutsSpy})
    }))
    spyOn(driver, "pageLoadTimeoutMs").and.returnValue(undefined)

    const result = await driver.withPageLoadTimeout(20000, async () => "visited")

    expect(result).toBe("visited")
    expect(setTimeoutsSpy).not.toHaveBeenCalled()
  })

  it("installs SIGINT/SIGTERM/beforeExit listeners when installExitHandlers() is called", () => {
    const before = {
      sigint: process.listenerCount("SIGINT"),
      sigterm: process.listenerCount("SIGTERM"),
      beforeExit: process.listenerCount("beforeExit")
    }
    const {driver} = newDriver()
    driver.installExitHandlers()

    expect(process.listenerCount("SIGINT")).toBe(before.sigint + 1)
    expect(process.listenerCount("SIGTERM")).toBe(before.sigterm + 1)
    expect(process.listenerCount("beforeExit")).toBe(before.beforeExit + 1)

    driver._removeExitHandlers()
  })

  it("removes the exit listeners when stop() is called so repeated setup/teardown does not leak", async () => {
    const before = {
      sigint: process.listenerCount("SIGINT"),
      sigterm: process.listenerCount("SIGTERM"),
      beforeExit: process.listenerCount("beforeExit")
    }
    const {driver, quitCalls} = newDriver()
    driver.installExitHandlers()

    await driver.stop()

    expect(process.listenerCount("SIGINT")).toBe(before.sigint)
    expect(process.listenerCount("SIGTERM")).toBe(before.sigterm)
    expect(process.listenerCount("beforeExit")).toBe(before.beforeExit)
    expect(quitCalls()).toBe(1)
  })

  it("quits the WebDriver when the process idles (beforeExit path)", async () => {
    const {driver, quitCalls} = newDriver()
    driver.installExitHandlers()

    await driver._onExitSignal("beforeExit")

    expect(quitCalls()).toBe(1)
    expect(driver.webDriver).toBeUndefined()
  })

  it("does not install handlers when setWebDriver is used directly (unit-test path)", () => {
    const before = {
      sigint: process.listenerCount("SIGINT"),
      sigterm: process.listenerCount("SIGTERM"),
      beforeExit: process.listenerCount("beforeExit")
    }
    newDriver()

    expect(process.listenerCount("SIGINT")).toBe(before.sigint)
    expect(process.listenerCount("SIGTERM")).toBe(before.sigterm)
    expect(process.listenerCount("beforeExit")).toBe(before.beforeExit)
  })

  it("disables implicit waits during explicit selector lookups and restores them afterwards", async () => {
    const calls = []
    let implicitTimeout = 10000
    const driver = new WebDriverDriver({
      browser: /** @type {any} */ ({
        driver: undefined,
        getSelector: (selector) => selector,
        throwIfHttpServerError: () => {}
      })
    })

    driver._driverTimeouts = implicitTimeout
    driver.setWebDriver(/** @type {any} */ ({
      findElements: async () => {
        calls.push(["findElements", implicitTimeout])

        return []
      },
      manage: () => ({
        setTimeouts: async ({implicit}) => {
          implicitTimeout = implicit
          calls.push(["setTimeouts", implicit])
        }
      })
    }))

    await expectAsync(
      driver.find("[data-testid='missing']", {timeout: 0, useBaseSelector: false})
    ).toBeRejectedWithError(/Element couldn't be found/)

    expect(calls).toEqual([
      ["setTimeouts", 0],
      ["findElements", 0],
      ["setTimeouts", 10000]
    ])
    expect(driver._driverTimeouts).toBe(10000)
  })

  it("bounds the page load timeout when applying driver timeouts", async () => {
    const calls = []
    const driver = new WebDriverDriver({
      browser: /** @type {any} */ ({
        driver: undefined,
        getSelector: (selector) => selector,
        throwIfHttpServerError: () => {}
      })
    })

    driver.setWebDriver(/** @type {any} */ ({
      manage: () => ({
        setTimeouts: async (options) => {
          calls.push(options)
        }
      })
    }))

    await driver.driverSetTimeouts(10000)

    expect(calls).toEqual([{implicit: 10000, pageLoad: 60000}])
  })
})
