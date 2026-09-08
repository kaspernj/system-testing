// @ts-check

import SystemTest from "../src/system-test.js"
import {Session, WebDriver} from "selenium-webdriver"

/** @returns {{promise: Promise<void>, reject: (error: Error) => void, resolve: () => void}} */
function createDeferred() {
  /** @type {() => void} */
  let resolve = () => {}
  /** @type {(error: Error) => void} */
  let reject = () => {}
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return {promise, reject, resolve}
}

/**
 * @param {jasmine.Spy} start
 * @returns {{driverAdapter: Record<string, jasmine.Spy>, systemTest: SystemTest}}
 */
function createSystemTest(start) {
  const systemTest = new SystemTest({
    driver: {
      type: "appium",
      options: {
        capabilities: {
          browserName: ""
        }
      }
    }
  })
  const driverAdapter = {
    setBaseUrl: jasmine.createSpy("setBaseUrl"),
    setTimeouts: jasmine.createSpy("setTimeouts").and.resolveTo(undefined),
    start,
    stop: jasmine.createSpy("stop").and.resolveTo(undefined)
  }

  systemTest.driverAdapter = /** @type {any} */ (driverAdapter)
  spyOn(systemTest, "startWebSocketServer").and.resolveTo(undefined)
  spyOn(systemTest, "findByTestID").and.resolveTo(/** @type {any} */ ({}))
  spyOn(systemTest, "waitForClientWebSocket").and.resolveTo(undefined)

  return {driverAdapter, systemTest}
}

describe("SystemTest.start", () => {
  beforeEach(() => {
    spyOn(SystemTest.prototype, "startScoundrel").and.callFake(function() {
      this.scoundrelWss = /** @type {any} */ ({})
    })
    spyOn(SystemTest.prototype, "stopScoundrel").and.callFake(async function() {
      this.scoundrelWss = undefined
      this.serverWebSocket = undefined
      this.server = undefined
    })
  })

  it("preserves the web startup lookup error when implicit restoration and its screenshot fail", async () => {
    const originalHost = process.env.SYSTEM_TEST_HOST
    process.env.SYSTEM_TEST_HOST = "expo-dev-server"
    const systemTest = new SystemTest()
    const adapter = systemTest.getDriverAdapter()
    const lookupError = new Error("root renderer query rejected")
    const restoring = createDeferred()
    const restoration = createDeferred()
    const commands = []
    const diagnostics = spyOn(console, "error")
    let timeoutChanges = 0
    adapter.setWebDriver(new WebDriver(new Session("private-startup-session", {}), {
      execute: async (command) => {
        commands.push(command.getName())
        if (command.getName() === "findElements") throw lookupError
        if (command.getName() === "setTimeout" && ++timeoutChanges === 3) {
          restoring.resolve()
          await restoration.promise
        }
        return null
      }
    }))
    spyOn(adapter, "start").and.resolveTo(undefined)
    spyOn(systemTest, "startWebSocketServer").and.resolveTo(undefined)
    spyOn(systemTest, "visitInitialRootPath").and.resolveTo(undefined)
    spyOn(systemTest, "waitForClientWebSocket").and.resolveTo(undefined)
    spyOn(systemTest, "reinitialize").and.resolveTo(undefined)
    jasmine.clock().install()
    jasmine.clock().mockDate(new Date(1000))
    try {
      const startup = systemTest.start().catch((error) => error)
      await restoring.promise
      jasmine.clock().tick(1000)
      const failure = await startup
      expect(failure).toEqual(jasmine.any(AggregateError))
      expect(failure.cause?.cause?.cause).toBe(lookupError)
      expect(failure.errors?.[0]).toBe(failure.cause)
      expect(failure.errors?.[1].cause).toEqual(jasmine.objectContaining({
        message: "timeout while restoring the implicit wait timeout",
        terminalResource: {scope: "run", name: "webdriver-session"}
      }))
      expect(adapter.isSessionUnusable()).toBeTrue()
      expect(systemTest.isStarted()).toBeFalse()
      expect(systemTest.reinitialize).not.toHaveBeenCalled()
      expect(systemTest.waitForClientWebSocket).not.toHaveBeenCalled()
      const evidence = diagnostics.calls.allArgs().filter(([label]) => label === "[WebDriver operation]")
      expect(evidence.length).toBe(1)
      if (evidence.length) {
        expect(JSON.parse(evidence[0][1])).toEqual(jasmine.objectContaining({
          operation: "startup-root", pendingCount: 1,
          commands: jasmine.arrayContaining([jasmine.objectContaining({name: "findElements", status: "rejected"})])
        }))
      }
      const commandsAtFailure = commands.slice()
      restoration.resolve()
      await new Promise((resolve) => setImmediate(resolve))
      expect(commands).toEqual(commandsAtFailure)
      const lastEvidence = diagnostics.calls.mostRecent()
      if (lastEvidence) expect(JSON.parse(lastEvidence.args[1]).phase).toBe("late-settlement")
      expect(JSON.stringify(diagnostics.calls.allArgs())).not.toContain("private-startup-session")
    } finally {
      restoration.resolve()
      jasmine.clock().uninstall()
      if (originalHost === undefined) delete process.env.SYSTEM_TEST_HOST
      else process.env.SYSTEM_TEST_HOST = originalHost
    }
  })

  it("preserves the native startup error and a secondary screenshot error", async () => {
    const {systemTest} = createSystemTest(jasmine.createSpy("start").and.resolveTo(undefined))
    const lookupError = new Error("native lookup failed", {cause: new Error("native query rejected")})
    const screenshotError = new Error("native screenshot failed")
    systemTest.findByTestID.and.rejectWith(lookupError)
    spyOn(systemTest, "takeScreenshot").and.rejectWith(screenshotError)
    const failure = await systemTest.start().catch((error) => error)
    expect(failure).toEqual(jasmine.any(AggregateError))
    expect(failure.cause).toBe(lookupError)
    expect(failure.errors).toEqual([lookupError, screenshotError])
    expect(systemTest.isStarted()).toBeFalse()
    expect(systemTest.waitForClientWebSocket).not.toHaveBeenCalled()
  })

  it("retains the startup error unchanged when its screenshot succeeds", async () => {
    const {systemTest} = createSystemTest(jasmine.createSpy("start").and.resolveTo(undefined))
    const lookupError = new Error("native lookup failed")
    systemTest.findByTestID.and.rejectWith(lookupError)
    spyOn(systemTest, "takeScreenshot").and.resolveTo(undefined)
    await expectAsync(systemTest.start()).toBeRejectedWith(lookupError)
  })

  it("shares one pending driver startup between overlapping callers", async () => {
    const driverStart = createDeferred()
    const {driverAdapter, systemTest} = createSystemTest(jasmine.createSpy("start").and.returnValue(driverStart.promise))

    const firstStart = systemTest.start()
    await Promise.resolve()
    const secondStart = systemTest.start()

    try {
      expect(secondStart).toBe(firstStart)
      expect(driverAdapter.start).toHaveBeenCalledTimes(1)
      expect(systemTest.isStarted()).toBeFalse()
    } finally {
      driverStart.resolve()
    }

    await Promise.all([firstStart, secondStart])

    expect(driverAdapter.start).toHaveBeenCalledTimes(1)
    expect(systemTest.isStarted()).toBeTrue()
  })

  it("clears failed startup state so a later call can retry", async () => {
    const failedDriverStart = createDeferred()
    const {driverAdapter, systemTest} = createSystemTest(jasmine.createSpy("start").and.returnValues(failedDriverStart.promise, Promise.resolve()))
    const firstStart = systemTest.start()
    const secondStart = systemTest.start()
    const startupResults = Promise.allSettled([firstStart, secondStart])
    const startupError = new Error("driver startup failed")

    failedDriverStart.reject(startupError)

    const [firstResult, secondResult] = await startupResults

    expect(firstResult).toEqual({status: "rejected", reason: startupError})
    expect(secondResult).toEqual({status: "rejected", reason: startupError})
    expect(driverAdapter.start).toHaveBeenCalledTimes(1)
    expect(systemTest.isStarted()).toBeFalse()

    await systemTest.start()

    expect(driverAdapter.start).toHaveBeenCalledTimes(2)
    expect(systemTest.isStarted()).toBeTrue()
  })

  it("waits for pending startup before stopping its resources", async () => {
    const driverStart = createDeferred()
    const {driverAdapter, systemTest} = createSystemTest(jasmine.createSpy("start").and.returnValue(driverStart.promise))
    const startPromise = systemTest.start()
    const stopPromise = systemTest.stop()

    await Promise.resolve()
    expect(driverAdapter.stop).not.toHaveBeenCalled()

    driverStart.resolve()
    await Promise.all([startPromise, stopPromise])

    expect(driverAdapter.stop).toHaveBeenCalledTimes(1)
    expect(systemTest.isStarted()).toBeFalse()
  })

  it("still stops resources after pending startup fails", async () => {
    const driverStart = createDeferred()
    const {driverAdapter, systemTest} = createSystemTest(jasmine.createSpy("start").and.returnValue(driverStart.promise))
    const startPromise = systemTest.start()
    const startupResult = Promise.allSettled([startPromise])
    const stopPromise = systemTest.stop()

    driverStart.reject(new Error("driver startup failed"))
    await stopPromise

    expect((await startupResult)[0].status).toEqual("rejected")
    expect(driverAdapter.stop).toHaveBeenCalledTimes(1)
    expect(systemTest.isStarted()).toBeFalse()
  })

  it("starts again only after a pending stop disposes the first startup", async () => {
    const firstDriverStart = createDeferred()
    const secondDriverStart = createDeferred()
    const secondDriverStartEntered = createDeferred()
    const events = []
    const {driverAdapter, systemTest} = createSystemTest(jasmine.createSpy("start").and.callFake(() => {
      events.push(`start-${driverAdapter.start.calls.count()}`)
      if (driverAdapter.start.calls.count() === 2) secondDriverStartEntered.resolve()
      return driverAdapter.start.calls.count() === 1 ? firstDriverStart.promise : secondDriverStart.promise
    }))

    driverAdapter.stop.and.callFake(async () => {
      events.push("stop")
    })

    const firstStart = systemTest.start()
    const stopPromise = systemTest.stop()
    const replacementStart = systemTest.start()

    await Promise.resolve()
    expect(driverAdapter.start).toHaveBeenCalledTimes(1)
    firstDriverStart.resolve()
    await stopPromise
    await secondDriverStartEntered.promise

    expect(events).toEqual(["start-1", "stop", "start-2"])
    expect(driverAdapter.start).toHaveBeenCalledTimes(2)

    secondDriverStart.resolve()
    await Promise.all([firstStart, replacementStart])

    expect(systemTest.isStarted()).toBeTrue()
  })

  it("shares one startup queued behind a pending stop", async () => {
    const driverStop = createDeferred()
    const events = []
    const {driverAdapter, systemTest} = createSystemTest(jasmine.createSpy("start").and.callFake(async () => {
      events.push(`driver-start-${driverAdapter.start.calls.count()}`)
    }))

    systemTest.startScoundrel.and.callFake(function() {
      events.push("scoundrel-start")
      this.scoundrelWss = /** @type {any} */ ({})
    })
    driverAdapter.stop.and.returnValue(driverStop.promise)
    await systemTest.start()
    systemTest._ignoredScoundrelClientCount = 1
    events.length = 0

    const stopPromise = systemTest.stop()
    const firstQueuedStart = systemTest.start()
    const secondQueuedStart = systemTest.start()

    try {
      expect(secondQueuedStart).toBe(firstQueuedStart)
      expect(driverAdapter.start).toHaveBeenCalledTimes(1)
    } finally {
      driverStop.resolve()
    }

    await Promise.all([stopPromise, firstQueuedStart, secondQueuedStart])

    expect(driverAdapter.start).toHaveBeenCalledTimes(2)
    expect(systemTest.startScoundrel).toHaveBeenCalledTimes(2)
    expect(systemTest._ignoredScoundrelClientCount).toEqual(0)
    expect(events).toEqual(["scoundrel-start", "driver-start-2"])
    expect(systemTest.isStarted()).toBeTrue()
  })

  it("reinitializes only after pending startup is stopped", async () => {
    const firstDriverStart = createDeferred()
    const replacementDriverStart = createDeferred()
    const replacementDriverStartEntered = createDeferred()
    const events = []
    const {driverAdapter, systemTest} = createSystemTest(jasmine.createSpy("start").and.callFake(async () => {
      events.push("old-start")
      await firstDriverStart.promise
    }))
    const replacementDriverAdapter = {
      setBaseUrl: jasmine.createSpy("replacementSetBaseUrl"),
      setTimeouts: jasmine.createSpy("replacementSetTimeouts").and.resolveTo(undefined),
      start: jasmine.createSpy("replacementStart").and.callFake(async () => {
        events.push("replacement-start")
        replacementDriverStartEntered.resolve()
        await replacementDriverStart.promise
      }),
      stop: jasmine.createSpy("replacementStop").and.resolveTo(undefined)
    }

    driverAdapter.stop.and.callFake(async () => {
      events.push("old-stop")
    })
    spyOn(systemTest, "createDriver").and.returnValue(/** @type {any} */ (replacementDriverAdapter))

    const firstStart = systemTest.start()
    const reinitializePromise = systemTest.reinitialize()

    expect(replacementDriverAdapter.start).not.toHaveBeenCalled()
    firstDriverStart.resolve()
    await firstStart
    await replacementDriverStartEntered.promise

    expect(events).toEqual(["old-start", "old-stop", "replacement-start"])
    replacementDriverStart.resolve()
    await reinitializePromise

    expect(driverAdapter.stop).toHaveBeenCalledTimes(1)
    expect(replacementDriverAdapter.start).toHaveBeenCalledTimes(1)
    expect(systemTest.isStarted()).toBeTrue()
  })
})
