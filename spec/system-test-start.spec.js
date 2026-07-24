// @ts-check

import SystemTest from "../src/system-test.js"

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
