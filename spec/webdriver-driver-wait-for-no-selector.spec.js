// @ts-check

import WebDriverDriver from "../src/drivers/webdriver-driver.js"

describe("WebDriverDriver waitForNoSelector", () => {
  it("uses a per-call timeout", async () => {
    const driver = new WebDriverDriver({
      browser: /** @type {any} */ ({
        driver: undefined,
        getSelector: (selector) => selector,
        throwIfHttpServerError: () => {}
      })
    })
    const waitSpy = jasmine.createSpy("wait").and.callFake(async (condition, timeout) => {
      expect(timeout).toBe(123)
      expect(await condition()).toBeTrue()
    })
    const setTimeoutsSpy = jasmine.createSpy("setTimeouts").and.resolveTo(undefined)

    driver.setWebDriver(/** @type {any} */ ({
      findElements: async () => [],
      manage: () => ({setTimeouts: setTimeoutsSpy}),
      wait: waitSpy
    }))

    await driver.waitForNoSelector("#missing", {timeout: 123, useBaseSelector: false})

    expect(waitSpy).toHaveBeenCalledTimes(1)
    expect(setTimeoutsSpy.calls.allArgs()).toEqual([
      [{implicit: 0}],
      [{implicit: 5000}]
    ])
  })

  it("enforces the timeout when WebDriver does not settle", async () => {
    const driver = new WebDriverDriver({
      browser: /** @type {any} */ ({
        driver: undefined,
        getSelector: (selector) => selector,
        throwIfHttpServerError: () => {}
      })
    })

    driver.setWebDriver(/** @type {any} */ ({
      manage: () => ({setTimeouts: async () => {}}),
      wait: async () => await new Promise(() => {})
    }))

    const result = await Promise.race([
      driver.waitForNoSelector("#still-present", {timeout: 30, useBaseSelector: false}).catch((error) => error),
      new Promise((resolve) => setTimeout(() => resolve("still pending"), 200))
    ])

    expect(result).toEqual(jasmine.any(Error))
    expect(/** @type {Error} */ (result).message).toContain("timeout while waiting for selector to disappear: #still-present")
  })

  it("enforces the timeout when restoring the implicit wait does not settle", async () => {
    const driver = new WebDriverDriver({
      browser: /** @type {any} */ ({
        driver: undefined,
        getSelector: (selector) => selector,
        throwIfHttpServerError: () => {}
      })
    })

    const setTimeoutsSpy = jasmine.createSpy("setTimeouts").and.callFake(async ({implicit}) => {
      if (implicit === 5000) return await new Promise(() => {})
    })

    driver.setWebDriver(/** @type {any} */ ({
      manage: () => ({setTimeouts: setTimeoutsSpy}),
      wait: async () => await new Promise((resolve) => setTimeout(resolve, 10))
    }))

    const result = await Promise.race([
      driver.waitForNoSelector("#still-present", {timeout: 30, useBaseSelector: false}).catch((error) => error),
      new Promise((resolve) => setTimeout(() => resolve("still pending"), 200))
    ])

    expect(result).toEqual(jasmine.any(Error))
    expect(/** @type {Error} */ (result).message).toContain("timeout while waiting for selector to disappear: #still-present")
  })

  it("enforces the timeout when disabling the implicit wait does not settle", async () => {
    const driver = new WebDriverDriver({
      browser: /** @type {any} */ ({
        driver: undefined,
        getSelector: (selector) => selector,
        throwIfHttpServerError: () => {}
      })
    })
    const waitSpy = jasmine.createSpy("wait")

    driver.setWebDriver(/** @type {any} */ ({
      manage: () => ({setTimeouts: async () => await new Promise(() => {})}),
      wait: waitSpy
    }))

    const result = await Promise.race([
      driver.waitForNoSelector("#still-present", {timeout: 30, useBaseSelector: false}).catch((error) => error),
      new Promise((resolve) => setTimeout(() => resolve("still pending"), 200))
    ])

    expect(result).toEqual(jasmine.any(Error))
    expect(/** @type {Error} */ (result).message).toContain("timeout while waiting for selector to disappear: #still-present")
    expect(waitSpy).not.toHaveBeenCalled()
  })
})
