// @ts-check

import WebDriverDriver from "../src/drivers/webdriver-driver.js"

describe("WebDriverDriver waitForNoSelector", () => {
  it("uses a per-call timeout as the total lifecycle budget", async () => {
    const driver = new WebDriverDriver({
      browser: /** @type {any} */ ({
        driver: undefined,
        getSelector: (selector) => selector,
        throwIfHttpServerError: () => {}
      })
    })
    const waitSpy = jasmine.createSpy("wait").and.callFake(async (condition, timeout) => {
      expect(timeout).toBeGreaterThan(0)
      expect(timeout).toBeLessThan(123)
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

  it("performs one asynchronous lookup when the timeout is zero", async () => {
    const driver = new WebDriverDriver({
      browser: /** @type {any} */ ({
        driver: undefined,
        getSelector: (selector) => selector,
        throwIfHttpServerError: () => {}
      })
    })
    const findElementsSpy = jasmine.createSpy("findElements").and.callFake(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      return []
    })
    const setTimeoutsSpy = jasmine.createSpy("setTimeouts").and.callFake(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
    })
    const waitSpy = jasmine.createSpy("wait")

    driver.setWebDriver(/** @type {any} */ ({
      findElements: findElementsSpy,
      manage: () => ({setTimeouts: setTimeoutsSpy}),
      wait: waitSpy
    }))

    await driver.waitForNoSelector("#missing", {timeout: 0, useBaseSelector: false})

    expect(findElementsSpy).toHaveBeenCalledTimes(1)
    expect(setTimeoutsSpy.calls.allArgs()).toEqual([
      [{implicit: 0}],
      [{implicit: 5000}]
    ])
    expect(waitSpy).not.toHaveBeenCalled()
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

  it("restores the implicit wait when ordinary polling reaches its deadline", async () => {
    const driver = new WebDriverDriver({
      browser: /** @type {any} */ ({
        driver: undefined,
        getSelector: (selector) => selector,
        throwIfHttpServerError: () => {}
      })
    })
    const setTimeoutsSpy = jasmine.createSpy("setTimeouts").and.resolveTo(undefined)

    driver.setWebDriver(/** @type {any} */ ({
      manage: () => ({setTimeouts: setTimeoutsSpy}),
      wait: async () => await new Promise(() => {})
    }))

    await expectAsync(
      driver.waitForNoSelector("#still-present", {timeout: 30, useBaseSelector: false})
    ).toBeRejectedWithError(/timeout while waiting for selector to disappear: #still-present/)

    expect(setTimeoutsSpy.calls.allArgs()).toEqual([
      [{implicit: 0}],
      [{implicit: 5000}]
    ])
    expect(() => driver.getWebDriver()).not.toThrow()
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

  it("restores the implicit wait after a late disable when no newer timeout update exists", async () => {
    const driver = new WebDriverDriver({
      browser: /** @type {any} */ ({
        driver: undefined,
        getSelector: (selector) => selector,
        throwIfHttpServerError: () => {}
      })
    })
    /** @type {(() => void) | undefined} */
    let finishDisablingImplicitWait
    const setTimeoutsSpy = jasmine.createSpy("setTimeouts").and.callFake(async ({implicit}) => {
      if (implicit === 0) {
        await new Promise((resolve) => {
          finishDisablingImplicitWait = resolve
        })
      }
    })
    const waitSpy = jasmine.createSpy("wait")

    driver.setWebDriver(/** @type {any} */ ({
      manage: () => ({setTimeouts: setTimeoutsSpy}),
      wait: waitSpy
    }))

    await expectAsync(
      driver.waitForNoSelector("#still-present", {timeout: 30, useBaseSelector: false})
    ).toBeRejectedWithError(/timeout while waiting for selector to disappear: #still-present/)

    expect(() => driver.getWebDriver()).toThrowError(/WebDriver session is unusable/)
    if (!finishDisablingImplicitWait) throw new Error("Expected the implicit wait update to have started")
    finishDisablingImplicitWait()
    await new Promise((resolve) => setTimeout(resolve, 30))

    expect(setTimeoutsSpy.calls.allArgs()).toEqual([
      [{implicit: 0}],
      [{implicit: 5000}]
    ])
    expect(waitSpy).not.toHaveBeenCalled()
  })

  it("does not restore stale timeout state after a timed-out wait returns", async () => {
    const driver = new WebDriverDriver({
      browser: /** @type {any} */ ({
        driver: undefined,
        getSelector: (selector) => selector,
        throwIfHttpServerError: () => {}
      })
    })
    /** @type {(() => void) | undefined} */
    let finishDisablingImplicitWait
    const setTimeoutsSpy = jasmine.createSpy("setTimeouts").and.callFake(async ({implicit}) => {
      if (implicit === 0) {
        await new Promise((resolve) => {
          finishDisablingImplicitWait = resolve
        })
      }
    })

    const originalWebDriver = /** @type {any} */ ({
      manage: () => ({setTimeouts: setTimeoutsSpy}),
      wait: async () => await new Promise(() => {})
    })

    driver.setWebDriver(originalWebDriver)

    await expectAsync(
      driver.waitForNoSelector("#still-present", {timeout: 30, useBaseSelector: false})
    ).toBeRejectedWithError(/timeout while waiting for selector to disappear: #still-present/)

    const replacementWebDriver = /** @type {any} */ ({})

    driver.setWebDriver(replacementWebDriver)
    if (!finishDisablingImplicitWait) throw new Error("Expected the implicit wait update to have started")
    finishDisablingImplicitWait()
    await new Promise((resolve) => setTimeout(resolve, 30))

    expect(setTimeoutsSpy.calls.allArgs()).toEqual([
      [{implicit: 0}]
    ])
    expect(driver.getWebDriver()).toBe(replacementWebDriver)
  })
})
