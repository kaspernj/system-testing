// @ts-check

import SystemTest from "../src/system-test.js"

/** @returns {SystemTest} */
function createSystemTest() {
  return Object.create(SystemTest.prototype)
}

describe("SystemTest notifications", () => {
  it("reads the current notification messages without waiting", async () => {
    const systemTest = createSystemTest()
    const allSpy = jasmine.createSpy("all").and.resolveTo([
      {getText: async () => "First notification"},
      {getText: async () => "Second notification"}
    ])

    systemTest.all = /** @type {any} */ (allSpy)

    expect(await systemTest.notificationMessages()).toEqual(["First notification", "Second notification"])
    expect(allSpy).toHaveBeenCalledOnceWith("[data-testid='notification-message']", {timeout: 0, useBaseSelector: false})
  })

  it("dismisses the current notification messages without waiting for the initial lookup", async () => {
    const systemTest = createSystemTest()
    const firstNotification = {click: async () => {}}
    const secondNotification = {click: async () => {}}
    const allSpy = jasmine.createSpy("all").and.resolveTo([firstNotification, secondNotification])
    const interactSpy = jasmine.createSpy("interact").and.resolveTo(undefined)
    const waitForNoSelectorSpy = jasmine.createSpy("waitForNoSelector").and.resolveTo(undefined)

    systemTest.all = /** @type {any} */ (allSpy)
    systemTest.interact = /** @type {any} */ (interactSpy)
    systemTest.waitForNoSelector = /** @type {any} */ (waitForNoSelectorSpy)

    await systemTest.dismissNotificationMessages()

    expect(allSpy).toHaveBeenCalledOnceWith("[data-testid='notification-message']", {timeout: 0, useBaseSelector: false})
    expect(interactSpy.calls.allArgs()).toEqual([
      [firstNotification, "click"],
      [secondNotification, "click"]
    ])
    expect(waitForNoSelectorSpy).toHaveBeenCalledOnceWith("[data-testid='notification-message']", {useBaseSelector: false})
  })

  it("honors a bounded timeout while waiting for a missing notification", async () => {
    const systemTest = createSystemTest()
    const allSpy = jasmine.createSpy("all").and.resolveTo([])
    const startTime = Date.now()
    let caughtError

    systemTest.all = /** @type {any} */ (allSpy)

    try {
      await systemTest.expectNotificationMessage("Missing notification", {timeout: 100})
    } catch (error) {
      caughtError = error
    }

    const elapsedMs = Date.now() - startTime

    expect(caughtError).toEqual(jasmine.any(Error))
    expect(/** @type {Error} */ (caughtError).message).toContain("Notification message Missing notification wasn't included")
    expect(elapsedMs).toBeGreaterThanOrEqual(75)
    expect(elapsedMs).toBeLessThan(750)
    expect(allSpy).toHaveBeenCalledWith("[data-testid='notification-message']", {timeout: 0, useBaseSelector: false})
  })

  it("rejects a zero timeout before starting a notification lookup", async () => {
    const systemTest = createSystemTest()
    const allSpy = jasmine.createSpy("all").and.returnValue(new Promise(() => {}))

    systemTest.all = /** @type {any} */ (allSpy)

    await expectAsync(
      systemTest.expectNotificationMessage("Expected notification", {timeout: 0})
    ).toBeRejectedWithError("Notification message timeout must be greater than 0")
    expect(allSpy).not.toHaveBeenCalled()
  })

  it("uses the remaining assertion timeout while waiting for a dismissed notification to disappear", async () => {
    const systemTest = createSystemTest()
    const notification = {
      getAttribute: async () => "3",
      getText: async () => "Expected notification"
    }
    const allSpy = jasmine.createSpy("all").and.resolveTo([notification])
    const interactSpy = jasmine.createSpy("interact").and.callFake(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25))
    })
    const waitForNoSelectorSpy = jasmine.createSpy("waitForNoSelector").and.resolveTo(undefined)

    systemTest.all = /** @type {any} */ (allSpy)
    systemTest.getDriver = /** @type {any} */ (() => ({executeScript: async () => "Expected notification"}))
    systemTest.interact = /** @type {any} */ (interactSpy)
    systemTest.waitForNoSelector = /** @type {any} */ (waitForNoSelectorSpy)

    await systemTest.expectNotificationMessage("Expected notification", {timeout: 100})

    expect(waitForNoSelectorSpy).toHaveBeenCalledTimes(1)
    const waitArgs = waitForNoSelectorSpy.calls.mostRecent().args[1]

    expect(waitArgs.useBaseSelector).toBeFalse()
    expect(waitArgs.timeout).toBeGreaterThan(0)
    expect(waitArgs.timeout).toBeLessThan(100)
  })

  it("includes the dismissal click in the total timeout", async () => {
    const systemTest = createSystemTest()
    const notification = {
      getAttribute: async () => "4",
      getText: async () => "Expected notification"
    }

    systemTest.all = /** @type {any} */ (async () => [notification])
    systemTest.getDriver = /** @type {any} */ (() => ({executeScript: async () => "Expected notification"}))
    systemTest.interact = /** @type {any} */ (async () => await new Promise(() => {}))

    const result = await Promise.race([
      systemTest.expectNotificationMessage("Expected notification", {timeout: 30}).catch((error) => error),
      new Promise((resolve) => setTimeout(() => resolve("still pending"), 200))
    ])

    expect(result).toEqual(jasmine.any(Error))
    expect(/** @type {Error} */ (result).message).toContain("timeout while dismissing notification: Expected notification")
  })

  it("enforces the total timeout when notification detection does not settle", async () => {
    const systemTest = createSystemTest()
    let lookupCount = 0

    systemTest.all = /** @type {any} */ (async () => {
      lookupCount += 1

      if (lookupCount === 1) return []

      return await new Promise(() => {})
    })

    const result = await Promise.race([
      systemTest.expectNotificationMessage("Expected notification", {dismiss: false, timeout: 80}).catch((error) => error),
      new Promise((resolve) => setTimeout(() => resolve("still pending"), 300))
    ])

    expect(result).toEqual(jasmine.any(Error))
    expect(/** @type {Error} */ (result).message).toContain("timeout while finding notification: Expected notification")
  })

  it("enforces the total timeout when disappearance polling does not settle", async () => {
    const systemTest = createSystemTest()
    const notification = {
      getAttribute: async () => "5",
      getText: async () => "Expected notification"
    }

    systemTest.all = /** @type {any} */ (async () => [notification])
    systemTest.getDriver = /** @type {any} */ (() => ({executeScript: async () => "Expected notification"}))
    systemTest.interact = /** @type {any} */ (async () => {})
    systemTest.waitForNoSelector = /** @type {any} */ (async () => await new Promise(() => {}))

    const result = await Promise.race([
      systemTest.expectNotificationMessage("Expected notification", {timeout: 30}).catch((error) => error),
      new Promise((resolve) => setTimeout(() => resolve("still pending"), 200))
    ])

    expect(result).toEqual(jasmine.any(Error))
    expect(/** @type {Error} */ (result).message).toContain("timeout while waiting for notification to disappear: Expected notification")
  })
})
