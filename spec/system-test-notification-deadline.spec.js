// @ts-check

import {Session, WebDriver} from "selenium-webdriver"
import SystemTest from "../src/system-test.js"

/** @returns {{promise: Promise<string>, resolve: (value: string) => void}} */
function deferredText() {
  let resolve
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise })
  return {promise, resolve}
}

describe("SystemTest notification command deadlines", () => {
  beforeEach(() => spyOn(SystemTest.prototype, "startScoundrel"))

  it("keeps the direct notification lookup error terminal when its implicit restoration also times out", async () => {
    const systemTest = new SystemTest()
    const adapter = systemTest.getDriverAdapter()
    const primary = new Error("disappearance query failed", {cause: new Error("original query cause")})
    const originalStack = primary.stack
    const originalCause = primary.cause
    let dismissed = false
    let restoreIssued
    let releaseRestore
    const restoring = new Promise((resolve) => { restoreIssued = resolve })
    const pending = new Promise((resolve) => { releaseRestore = resolve })
    spyOn(console, "error")
    spyOn(systemTest, "takeScreenshot")
    adapter.setWebDriver(new WebDriver(new Session("direct-notification", {}), {
      execute: async (command) => {
        const name = command.getName()
        if (name === "clickElement") dismissed = true
        if (name === "setTimeout" && dismissed && command.getParameter("implicit") === 5000) {
          restoreIssued()
          return await pending
        }
        if (name === "findElements") {
          if (dismissed) throw primary
          return [{"element-6066-11e4-a52e-4f735466cecf": "notification"}]
        }
        if (name === "isElementDisplayed") return true
        if (name === "executeScript") return "Expected notification"
        if (name === "getElementAttribute") return "1"
        return null
      }
    }))
    jasmine.clock().install()
    jasmine.clock().mockDate(new Date(1000))
    try {
      const notification = systemTest.expectNotificationMessage("Expected notification").catch((error) => error)
      await restoring
      jasmine.clock().tick(1000)
      const failure = await notification
      expect(failure).toBe(primary)
      expect(failure.stack).toBe(originalStack)
      expect(failure.cause).toBe(originalCause)
      expect(failure.terminalResource).toEqual({scope: "run", name: "webdriver-session"})
      expect(adapter.isSessionUnusable()).toBeTrue()
      expect(systemTest.takeScreenshot).not.toHaveBeenCalled()
    } finally {
      releaseRestore(null)
      await new Promise((resolve) => setImmediate(resolve))
      jasmine.clock().uninstall()
    }
  })
  it("keeps a healthy session usable when only the wrong notification is visible", async () => {
    const systemTest = new SystemTest()
    const adapter = systemTest.getDriverAdapter()
    spyOn(console, "error")
    adapter.setWebDriver(new WebDriver(new Session("wrong-notification", {}), {
      execute: async (command) => {
        if (command.getName() === "findElements") return [{"element-6066-11e4-a52e-4f735466cecf": "notification"}]
        if (command.getName() === "isElementDisplayed") return true
        if (command.getName() === "executeScript") return "Wrong notification"
        return null
      }
    }))
    const failure = await systemTest.expectNotificationMessage("Expected notification", {dismiss: false, timeout: 25}).catch((error) => error)
    expect(failure.message).toContain("wasn't included in: Wrong notification")
    expect(adapter.isSessionUnusable()).toBeFalse()
    await expectAsync(adapter.getWebDriver().getTitle()).toBeResolved()
  })

  it("starts no retained-element command after a timed-out text query settles late", async () => {
    const systemTest = new SystemTest()
    const query = deferredText()
    const commands = []
    const adapter = systemTest.getDriverAdapter()
    adapter.setWebDriver(new WebDriver(new Session("private-session-id", {}), {
      execute: async (command) => {
        const name = command.getName()
        commands.push(name)
        if (name === "isElementDisplayed") return true
        if (name === "findElements") return [{"element-6066-11e4-a52e-4f735466cecf": "notification"}]
        if (name === "executeScript") {
          if (command.getParameter("script").includes("textContent")) return await query.promise
          return true
        }
        if (name === "getElementAttribute") return "1"
        return null
      }
    }))

    const failure = await systemTest.expectNotificationMessage("Expected notification", {dismiss: false, timeout: 25}).catch((error) => error)
    expect(failure).toEqual(jasmine.any(Error))
    const commandsAtDeadline = commands.slice()
    query.resolve("Expected notification")
    await new Promise((resolve) => setImmediate(resolve))

    expect(commands).toEqual(commandsAtDeadline)
    expect(failure.terminalResource).toEqual({scope: "run", name: "webdriver-session"})
    expect(() => adapter.getWebDriver()).toThrowError(/unusable/)
  })

  it("stops enumeration when settled commands cumulatively cross the deadline without poisoning the session", async () => {
    const systemTest = new SystemTest()
    const adapter = systemTest.getDriverAdapter()
    const commands = []
    let now = 1000
    spyOn(Date, "now").and.callFake(() => now)
    adapter.setWebDriver(new WebDriver(new Session("private-session-id", {}), {
      execute: async (command) => {
        const name = command.getName()
        commands.push(name)
        if (name === "isElementDisplayed") return true
        if (name === "findElements") return [{"element-6066-11e4-a52e-4f735466cecf": "notification"}]
        if (name === "executeScript") {
          if (command.getParameter("script").includes("textContent")) {
            now += 30
            return "Expected notification"
          }
          return true
        }
        if (name === "getElementAttribute") return "1"
        return null
      }
    }))
    const outcome = await systemTest.expectNotificationMessage("Expected notification", {dismiss: false, timeout: 25}).then(
      () => "passed",
      (error) => error
    )
    expect(outcome).toEqual(jasmine.any(Error))
    expect(commands).not.toContain("getElementAttribute")
    expect(() => adapter.getWebDriver()).not.toThrow()
  })

  it("starts no visibility read after the disappearance query settles beyond its deadline", async () => {
    const systemTest = new SystemTest()
    const adapter = systemTest.getDriverAdapter()
    const commands = []
    let release
    const pending = new Promise((resolve) => { release = resolve })
    let finds = 0
    const element = {"element-6066-11e4-a52e-4f735466cecf": "notification"}
    adapter.setWebDriver(new WebDriver(new Session("disappearance", {}), {
      execute: async (command) => {
        const name = command.getName()
        commands.push(name)
        if (name === "findElements") return ++finds === 1 ? [element] : await pending
        if (name === "isElementDisplayed") return true
        if (name === "executeScript") return "Expected notification"
        if (name === "getElementAttribute") return "1"
        return null
      }
    }))
    const failure = await systemTest.expectNotificationMessage("Expected notification", {timeout: 25}).catch((error) => error)
    expect(failure).toEqual(jasmine.any(Error))
    const issued = commands.slice()
    release([element])
    await new Promise((resolve) => setImmediate(resolve))
    expect(commands).toEqual(issued)
    expect(adapter.isSessionUnusable()).toBeTrue()
  })
})
