// @ts-check

import timeout from "awaitery/build/timeout.js"
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

  it("fails the lookup at its deadline when the renderer never answers findElements", async () => {
    const driver = new WebDriverDriver({
      browser: /** @type {any} */ ({
        driver: undefined,
        getSelector: (selector) => selector,
        throwIfHttpServerError: () => {}
      })
    })

    driver.setWebDriver(/** @type {any} */ ({
      // An unresponsive renderer never settles the command. The wait stub mirrors
      // selenium-webdriver's WebDriver.wait, which only evaluates its timeout when the
      // condition promise settles — so a never-settling condition hangs it forever.
      findElements: () => new Promise(() => {}),
      manage: () => ({setTimeouts: async () => {}}),
      wait: (condition) => new Promise((resolve, reject) => {
        Promise.resolve()
          .then(() => condition())
          .then((value) => (value ? resolve(value) : reject(new Error("not found"))), reject)
      })
    }))

    let outcome

    await timeout({timeout: 5000, errorMessage: "all() did not fail at its own deadline"}, async () => {
      outcome = await driver.all("[data-testid='unresponsive']", {timeout: 100, useBaseSelector: false}).then(
        () => "resolved",
        (error) => error
      )
    })

    expect(outcome instanceof Error).toBeTrue()
    expect(String(/** @type {any} */ (outcome)?.message)).toContain("Couldn't get elements")
  })

  it("classifies the hard lookup deadline as a timeout when the wall clock has not advanced", async () => {
    const driver = new WebDriverDriver({
      browser: /** @type {any} */ ({
        driver: undefined,
        getSelector: (selector) => selector,
        throwIfHttpServerError: () => {}
      })
    })

    spyOn(Date, "now").and.returnValue(1000)
    driver.setWebDriver(/** @type {any} */ ({
      findElements: async () => await new Promise(() => {}),
      manage: () => ({setTimeouts: async () => {}}),
      wait: async (condition) => await condition()
    }))

    expect(await driver.exists("#does-not-exist", {timeout: 30, useBaseSelector: false})).toBeFalse()
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

  it("does not hang when the implicit-timeout restore is never answered", async () => {
    const driver = new WebDriverDriver({
      browser: /** @type {any} */ ({
        driver: undefined,
        getSelector: (selector) => selector,
        throwIfHttpServerError: () => {}
      })
    })
    let setTimeoutsCalls = 0

    // Chromedriver serializes session commands, so a restore issued behind an abandoned
    // renderer command is never answered; the bounded bookkeeping must let the callback's
    // own outcome through instead of hanging or masking it.
    driver.setWebDriver(/** @type {any} */ ({
      manage: () => ({
        setTimeouts: () => {
          setTimeoutsCalls += 1

          if (setTimeoutsCalls === 1) return Promise.resolve()

          return new Promise(() => {})
        }
      })
    }))

    const result = await driver.withTemporaryImplicitTimeout(0, async () => "done")

    expect(result).toBe("done")
    expect(setTimeoutsCalls).toBe(2)
  })

  it("keeps the callback error decisive when the implicit-timeout restore is never answered", async () => {
    const driver = new WebDriverDriver({
      browser: /** @type {any} */ ({
        driver: undefined,
        getSelector: (selector) => selector,
        throwIfHttpServerError: () => {}
      })
    })
    let setTimeoutsCalls = 0

    driver.setWebDriver(/** @type {any} */ ({
      manage: () => ({
        setTimeouts: () => {
          setTimeoutsCalls += 1

          if (setTimeoutsCalls === 1) return Promise.resolve()

          return new Promise(() => {})
        }
      })
    }))

    await expectAsync(driver.withTemporaryImplicitTimeout(0, async () => {
      throw new Error("lookup failed")
    })).toBeRejectedWithError("lookup failed")
  })

  it("propagates unrelated implicit-timeout restore failures", async () => {
    const driver = new WebDriverDriver({
      browser: /** @type {any} */ ({
        driver: undefined,
        getSelector: (selector) => selector,
        throwIfHttpServerError: () => {}
      })
    })
    let setTimeoutsCalls = 0

    driver.setWebDriver(/** @type {any} */ ({
      manage: () => ({
        setTimeouts: () => {
          setTimeoutsCalls += 1

          if (setTimeoutsCalls === 1) return Promise.resolve()

          return Promise.reject(new Error("session deleted"))
        }
      })
    }))

    await expectAsync(driver.withTemporaryImplicitTimeout(0, async () => "done")).toBeRejectedWithError("session deleted")
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
