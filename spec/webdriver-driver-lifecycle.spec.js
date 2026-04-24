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
})
