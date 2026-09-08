// @ts-check

import {Session, WebDriver} from "selenium-webdriver"
import SystemTest from "../src/system-test.js"
import WebDriverCommandOperation from "../src/drivers/webdriver-command-operation.js"
import {Command, Name} from "selenium-webdriver/lib/command.js"

describe("WebDriver command operation evidence", () => {
  beforeEach(() => spyOn(SystemTest.prototype, "startScoundrel"))

  it("rejects a command when the clock crosses the deadline during dispatch preparation without recording pending work", async () => {
    const adapter = new SystemTest().getDriverAdapter()
    const execute = jasmine.createSpy("execute").and.resolveTo(null)
    adapter.setWebDriver(new WebDriver(new Session("dispatch", {}), {execute}))
    const operation = new WebDriverCommandOperation({adapter, name: "notification-dismissal", timeout: 25, errorMessage: "expired"})
    spyOn(Date, "now").and.returnValues(operation.deadline - 1, operation.deadline, operation.deadline)

    await expectAsync(operation.execute(new Command(Name.CLICK_ELEMENT))).toBeRejectedWith(operation.error)
    expect(execute).not.toHaveBeenCalled()
    expect(operation.pending.size).toBe(0)
    expect(operation.commands).toEqual([])
    expect(operation.sequence).toBe(0)
    expect(adapter.isSessionUnusable()).toBeFalse()
  })

  it("restores implicit wait after a settled deadline crossing while rejecting later application commands", async () => {
    const adapter = new SystemTest().getDriverAdapter()
    let now = 1000
    let implicit = 5000
    const commands = []
    spyOn(Date, "now").and.callFake(() => now)
    spyOn(console, "error")
    adapter.setWebDriver(new WebDriver(new Session("cleanup", {}), {execute: async (command) => {
      commands.push(command.getName())
      if (command.getName() === "setTimeout") implicit = command.getParameter("implicit")
      return null
    }}))
    const failure = await adapter.runCommandOperation({name: "notification-detection", timeout: 25, errorMessage: "expired"}, async () => {
      await adapter.withTemporaryImplicitTimeout(0, async () => {
        now = 1026
        await adapter.getWebDriver().getTitle()
      })
      await adapter.getWebDriver().getCurrentUrl()
    }).catch((error) => error)
    expect(failure.message).toBe("expired")
    expect(implicit).toBe(5000)
    expect(adapter._driverTimeouts).toBe(5000)
    expect(adapter.isSessionUnusable()).toBeFalse()
    expect(commands).toEqual(["setTimeout", "setTimeout"])
  })

  it("quarantines a refused implicit restoration instead of leaving a healthy session with altered timeouts", async () => {
    const adapter = new SystemTest().getDriverAdapter()
    const refusal = new Error("restore refused")
    let implicit = 5000
    spyOn(console, "error")
    adapter.setWebDriver(new WebDriver(new Session("cleanup", {}), {execute: async (command) => {
      // Selenium also tries its legacy timeout command after a rejected setter.
      if (command.getParameter("implicit") === 5000 || command.getParameter("ms") === 5000) throw refusal
      implicit = command.getParameter("implicit")
      return null
    }}))
    const failure = await adapter.runCommandOperation({name: "notification-detection", timeout: 25, errorMessage: "expired"}, async () => {
      await adapter.withTemporaryImplicitTimeout(0, async () => {})
    }).catch((error) => error)
    expect(failure).toBe(refusal)
    expect(implicit).toBe(0)
    expect(adapter.isSessionUnusable()).toBeTrue()
    expect(failure.terminalResource).toEqual({scope: "run", name: "webdriver-session"})
  })

  for (const stalls of [false, true]) {
    it(`owns implicit restoration beyond the application deadline and ${stalls ? "quarantines its own overrun" : "awaits safe restoration"}`, async () => {
      const adapter = new SystemTest().getDriverAdapter()
      let restoreIssued
      let release
      const restoring = new Promise((resolve) => { restoreIssued = resolve })
      const pending = new Promise((resolve) => { release = resolve })
      const commands = []
      const diagnostics = spyOn(console, "error")
      let implicit = 5000
      adapter.setWebDriver(new WebDriver(new Session("cleanup", {}), {execute: async (command) => {
        commands.push(command.getName())
        if (command.getName() === "setTimeout") {
          if (command.getParameter("implicit") === 5000) { restoreIssued(); await pending }
          implicit = command.getParameter("implicit")
        }
        return null
      }}))
      jasmine.clock().install()
      jasmine.clock().mockDate(new Date(1000))
      try {
        let settled = false
        const operation = adapter.runCommandOperation({name: "notification-detection", timeout: 25, errorMessage: "expired"}, async () => {
          await adapter.withTemporaryImplicitTimeout(0, async () => {})
          await adapter.getWebDriver().getTitle()
        }).catch((error) => { settled = true; return error })
        await restoring
        jasmine.clock().tick(25)
        await new Promise((resolve) => setImmediate(resolve))
        expect(settled).toBeFalse()
        expect(adapter.isSessionUnusable()).toBeFalse()
        if (stalls) jasmine.clock().tick(975)
        else release(null)
        const failure = await operation
        expect(failure.message).toBe("expired")
        expect(adapter.isSessionUnusable()).toBe(stalls)
        if (stalls) expect(failure.terminalResource).toEqual({scope: "run", name: "webdriver-session"})
        else expect(implicit).toBe(5000)
        release(null)
        await new Promise((resolve) => setImmediate(resolve))
        expect(commands).toEqual(["setTimeout", "setTimeout"])
        if (stalls) {
          const events = diagnostics.calls.allArgs().filter(([label]) => label === "[WebDriver operation]").map(([, value]) => JSON.parse(value))
          expect(events.some((event) => event.phase === "late-settlement" && event.pendingCount === 0)).toBeTrue()
        }
      } finally {
        release(null)
        await new Promise((resolve) => setImmediate(resolve))
        jasmine.clock().uninstall()
      }
    })
  }

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
    jasmine.clock().mockDate(new Date(1000))
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

  it("reports a terminal restore after a successful finder without discarding the finder's cleanup ownership", async () => {
    const systemTest = new SystemTest()
    const adapter = systemTest.getDriverAdapter()
    const diagnostics = spyOn(console, "error")
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
    jasmine.clock().mockDate(new Date(1000))
    try {
      const operation = adapter.runCommandOperation({
        name: "startup-root", timeout: 5000, errorMessage: "root deadline", callbackOwnsTimeout: true
      }, async () => await adapter.withTemporaryImplicitTimeout(0, async () => "found")).catch((error) => error)
      await restoring
      jasmine.clock().tick(1000)
      const outcome = await operation
      expect(outcome).toEqual(jasmine.any(Error))
      expect(outcome.cause?.message).toBe("timeout while restoring the implicit wait timeout")
      expect(diagnostics).toHaveBeenCalled()
      if (diagnostics.calls.count()) {
        expect(JSON.parse(diagnostics.calls.mostRecent().args[1])).toEqual(jasmine.objectContaining({
          phase: "failure", operation: "startup-root", terminal: true, pendingCount: 0
        }))
        const events = diagnostics.calls.allArgs().filter(([label]) => label === "[WebDriver operation]").map(([, value]) => JSON.parse(value))
        expect(events).toContain(jasmine.objectContaining({operation: "startup-root:implicit-timeout-restoration", pendingCount: 1}))
      }
    } finally {
      release(null)
      await new Promise((resolve) => setImmediate(resolve))
      jasmine.clock().uninstall()
    }
  })
})
