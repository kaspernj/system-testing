// @ts-check

import {Session, WebDriver} from "selenium-webdriver"
import SystemTest from "../src/system-test.js"

describe("WebDriver command operation evidence", () => {
  beforeEach(() => spyOn(SystemTest.prototype, "startScoundrel"))

  it("bounds metadata and observes late settlement without exposing command payloads", async () => {
    const systemTest = new SystemTest()
    const adapter = systemTest.getDriverAdapter()
    const diagnostics = spyOn(console, "error")
    let now = 1000
    spyOn(Date, "now").and.callFake(() => now)
    let release
    const pending = new Promise((resolve) => { release = resolve })
    adapter.setWebDriver(new WebDriver(new Session("secret-session-id", {}), {
      execute: async (command) => {
        if (command.getName() === "getTitle") {
          now = 1025
          return await pending
        }
        return null
      }
    }))
    const failure = await adapter.runCommandOperation({name: "notification-detection", timeout: 25, errorMessage: "notification deadline"}, async () => {
      for (let index = 0; index < 40; index++) await adapter.getWebDriver().executeScript("secret-script-and-payload")
      await adapter.getWebDriver().getTitle()
      await adapter.getWebDriver().getCurrentUrl()
    }).catch((error) => error)
    expect(failure.terminalResource).toEqual({scope: "run", name: "webdriver-session"})
    const deadline = JSON.parse(diagnostics.calls.mostRecent().args[1])
    expect(deadline.commands.length).toBe(32)
    expect(deadline.pendingCommands).toEqual([41])
    expect(deadline.commands[31]).toEqual(jasmine.objectContaining({name: "getTitle", sequence: 41, status: "pending"}))
    release("secret-title")
    await new Promise((resolve) => setImmediate(resolve))
    const settlement = JSON.parse(diagnostics.calls.mostRecent().args[1])
    expect(settlement.phase).toBe("late-settlement")
    expect(settlement.pendingCommands).toEqual([])
    expect(settlement.commands[31]).toEqual(jasmine.objectContaining({sequence: 41, status: "fulfilled", settledAt: jasmine.any(Number)}))
    expect(JSON.stringify(diagnostics.calls.allArgs())).not.toContain("secret-")
  })

  it("does not quarantine a different session when old pending work expires", async () => {
    const systemTest = new SystemTest()
    const adapter = systemTest.getDriverAdapter()
    spyOn(console, "error")
    let release
    let issued
    const issuedPromise = new Promise((resolve) => { issued = resolve })
    const pending = new Promise((resolve) => { release = resolve })
    adapter.setWebDriver(new WebDriver(new Session("old", {}), {execute: async () => { issued(); return await pending }}))
    const operation = adapter.runCommandOperation({name: "notification-detection", timeout: 25, errorMessage: "notification deadline"}, async () => {
      await adapter.getWebDriver().getTitle()
      await adapter.getWebDriver().getCurrentUrl()
    }).catch((error) => error)
    await issuedPromise
    const currentDriver = new WebDriver(new Session("current", {}), {execute: async () => null})
    adapter.setWebDriver(currentDriver)
    await operation
    release("old title")
    await new Promise((resolve) => setImmediate(resolve))
    expect(adapter.isSessionUnusable()).toBeFalse()
    expect(adapter.getWebDriver()).toBe(currentDriver)
  })

  it("waits for the actual deadline when a timer wakes early", async () => {
    const systemTest = new SystemTest()
    const adapter = systemTest.getDriverAdapter()
    adapter.setWebDriver(new WebDriver(new Session("clock", {}), {execute: async () => null}))
    spyOn(console, "error")
    let now = 1000
    spyOn(Date, "now").and.callFake(() => now)
    jasmine.clock().install()
    try {
      let settled = false
      const operation = adapter.runCommandOperation({name: "notification-detection", timeout: 25, errorMessage: "notification deadline"}, async () => await new Promise(() => {}))
        .catch(() => { settled = true })
      now = 1024
      jasmine.clock().tick(25)
      for (let index = 0; index < 8; index++) await Promise.resolve()
      expect(settled).toBeFalse()
      now = 1025
      jasmine.clock().tick(1)
      await operation
      expect(settled).toBeTrue()
      expect(adapter.isSessionUnusable()).toBeFalse()
    } finally {
      jasmine.clock().uninstall()
    }
  })

  it("preserves session ownership when the scoped implicit-timeout restoration overruns", async () => {
    const systemTest = new SystemTest()
    const adapter = systemTest.getDriverAdapter()
    spyOn(console, "error")
    let issued
    let release
    const restoring = new Promise((resolve) => { issued = resolve })
    const pending = new Promise((resolve) => { release = resolve })
    adapter.setWebDriver(new WebDriver(new Session("restoration", {}), {
      execute: async (command) => {
        if (command.getName() === "setTimeout" && command.getParameter("implicit") === 5000) {
          issued()
          return await pending
        }
        return null
      }
    }))
    jasmine.clock().install()
    try {
      const operation = adapter.runCommandOperation({name: "notification-disappearance", timeout: 5000, errorMessage: "notification deadline"}, async () => {
        await adapter.withTemporaryImplicitTimeout(0, async () => {})
      }).then(() => "passed", (error) => error)
      await restoring
      jasmine.clock().tick(1000)
      const outcome = await operation
      expect(outcome).toEqual(jasmine.any(Error))
      expect(adapter.isSessionUnusable()).toBeTrue()
      release(null)
      await Promise.resolve()
    } finally {
      jasmine.clock().uninstall()
    }
  })
})
