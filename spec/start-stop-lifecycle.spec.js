// @ts-check

import {setTimeout as wait} from "node:timers/promises"

import StartStopLifecycle from "../src/start-stop-lifecycle.js"

/** @returns {{promise: Promise<void>, resolve: () => void}} */
function createDeferred() {
  /** @type {() => void} */
  let resolve = () => {}
  const promise = new Promise((promiseResolve) => {
    resolve = promiseResolve
  })

  return {promise, resolve}
}

describe("StartStopLifecycle", () => {
  it("joins concurrent starts and becomes running only after startup is ready", async () => {
    const ready = createDeferred()
    const start = jasmine.createSpy("start").and.callFake(async () => await ready.promise)
    const lifecycle = new StartStopLifecycle({start, stop: async () => {}})

    const firstStart = lifecycle.start()
    const secondStart = lifecycle.ensureRunning()
    let firstStartSettled = false
    void firstStart.then(() => {
      firstStartSettled = true
    })

    await Promise.resolve()
    expect(firstStart).toBe(secondStart)
    expect(start).toHaveBeenCalledTimes(1)
    expect(lifecycle.state).toBe("starting")
    expect(firstStartSettled).toBeFalse()

    ready.resolve()
    await Promise.all([firstStart, secondStart])

    expect(lifecycle.state).toBe("running")
    expect(firstStartSettled).toBeTrue()
  })

  it("aborts and awaits deferred startup before cleaning up once, then permits retry", async () => {
    const initialization = createDeferred()
    let startCalls = 0
    const cleanup = jasmine.createSpy("stop").and.resolveTo(undefined)
    const lifecycle = new StartStopLifecycle({
      start: async ({signal}) => {
        startCalls += 1
        if (startCalls === 1) {
          await initialization.promise
          signal.throwIfAborted()
        }
      },
      stop: cleanup
    })
    const firstStartFailure = lifecycle.start().catch((error) => error)

    await Promise.resolve()
    const stopping = lifecycle.stop()
    let stopSettled = false
    void stopping.then(() => {
      stopSettled = true
    })

    await Promise.resolve()
    expect(lifecycle.state).toBe("stopping")
    expect(stopSettled).toBeFalse()
    expect(cleanup).not.toHaveBeenCalled()

    initialization.resolve()
    expect((await firstStartFailure).name).toBe("AbortError")
    await stopping

    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(lifecycle.state).toBe("idle")

    await lifecycle.start()
    expect(startCalls).toBe(2)
    expect(lifecycle.state).toBe("running")
  })

  it("recognizes standard signal cancellation by its lifecycle abort cause", async () => {
    let startCalls = 0
    const cleanup = jasmine.createSpy("stop").and.resolveTo(undefined)
    const lifecycle = new StartStopLifecycle({
      start: async ({signal}) => {
        startCalls += 1
        if (startCalls === 1) await wait(60000, undefined, {signal})
      },
      stop: cleanup
    })
    const firstStartFailure = lifecycle.start().catch((error) => error)

    await Promise.resolve()
    const stopOutcome = lifecycle.stop().catch((error) => error)
    const restartOutcome = lifecycle.start().catch((error) => error)
    const cancellationError = await firstStartFailure

    expect(cancellationError.name).toBe("AbortError")
    expect(cancellationError).not.toBe(cancellationError.cause)
    expect(cancellationError.cause).toEqual(jasmine.any(Error))
    expect(await stopOutcome).toBeUndefined()
    expect(await restartOutcome).toBeUndefined()
    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(startCalls).toBe(2)
    expect(lifecycle.state).toBe("running")
  })

  it("preserves an unrelated AbortError raised while stopping startup", async () => {
    const initialization = createDeferred()
    const unrelatedAbortError = new Error("unrelated operation aborted", {cause: new Error("unrelated reason")})
    unrelatedAbortError.name = "AbortError"
    const cleanup = jasmine.createSpy("stop").and.resolveTo(undefined)
    const lifecycle = new StartStopLifecycle({
      start: async () => {
        await initialization.promise
        throw unrelatedAbortError
      },
      stop: cleanup
    })
    const startOutcome = lifecycle.start().catch((error) => error)

    await Promise.resolve()
    const stopOutcome = lifecycle.stop().catch((error) => error)
    initialization.resolve()

    expect(await startOutcome).toBe(unrelatedAbortError)
    expect(await stopOutcome).toBe(unrelatedAbortError)
    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(lifecycle.state).toBe("idle")
  })

  it("waits for shutdown before honoring a start requested while stopping", async () => {
    const shutdown = createDeferred()
    const events = []
    const lifecycle = new StartStopLifecycle({
      start: async () => {
        events.push("start")
      },
      stop: async () => {
        events.push("stop beginning")
        await shutdown.promise
        events.push("stop complete")
      }
    })

    await lifecycle.start()
    const stopping = lifecycle.stop()
    const restarting = lifecycle.start()

    await Promise.resolve()
    expect(lifecycle.state).toBe("stopping")
    expect(events).toEqual(["start", "stop beginning"])

    shutdown.resolve()
    await Promise.all([stopping, restarting])

    expect(events).toEqual(["start", "stop beginning", "stop complete", "start"])
    expect(lifecycle.state).toBe("running")
  })

  it("joins concurrent stops and keeps later idle stops idempotent", async () => {
    const shutdown = createDeferred()
    const stop = jasmine.createSpy("stop").and.callFake(async () => await shutdown.promise)
    const lifecycle = new StartStopLifecycle({start: async () => {}, stop})

    await lifecycle.ensureRunning()
    const firstStop = lifecycle.stop()
    const secondStop = lifecycle.stop()

    await Promise.resolve()
    expect(firstStop).toBe(secondStop)
    expect(stop).toHaveBeenCalledTimes(1)
    expect(lifecycle.state).toBe("stopping")

    shutdown.resolve()
    await Promise.all([firstStop, secondStop])
    await lifecycle.stop()

    expect(stop).toHaveBeenCalledTimes(1)
    expect(lifecycle.state).toBe("idle")
  })

  it("cleans up failed startup, resets its guards, and can start again", async () => {
    const startupError = new Error("backend startup failed")
    let startCalls = 0
    const cleanup = jasmine.createSpy("stop").and.resolveTo(undefined)
    const lifecycle = new StartStopLifecycle({
      start: async () => {
        startCalls += 1
        if (startCalls === 1) throw startupError
      },
      stop: cleanup
    })

    await expectAsync(lifecycle.start()).toBeRejectedWith(startupError)
    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(lifecycle.state).toBe("idle")

    await lifecycle.ensureRunning()
    expect(startCalls).toBe(2)
    expect(lifecycle.state).toBe("running")
  })

  it("preserves both startup and cleanup failures", async () => {
    const startupError = new Error("backend startup failed")
    const cleanupError = new Error("backend cleanup failed")
    const lifecycle = new StartStopLifecycle({
      start: async () => {
        throw startupError
      },
      stop: async () => {
        throw cleanupError
      }
    })

    const failure = await lifecycle.start().catch((error) => error)

    expect(failure).toEqual(jasmine.any(AggregateError))
    expect(failure.cause).toBe(startupError)
    expect(failure.errors).toEqual([startupError, cleanupError])
    expect(lifecycle.state).toBe("cleanup-failed")
  })

  it("retains failed explicit cleanup, blocks starts, and retries cleanup", async () => {
    const cleanupError = new Error("backend cleanup failed")
    const start = jasmine.createSpy("start").and.resolveTo(undefined)
    let stopCalls = 0
    const lifecycle = new StartStopLifecycle({
      start,
      stop: async () => {
        stopCalls += 1
        if (stopCalls === 1) throw cleanupError
      }
    })

    await lifecycle.start()
    await expectAsync(lifecycle.stop()).toBeRejectedWith(cleanupError)

    expect(lifecycle.state).toBe("cleanup-failed")
    const blockedStartError = await lifecycle.ensureRunning().catch((error) => error)
    expect(blockedStartError).toEqual(jasmine.any(Error))
    expect(blockedStartError.message).toContain("cleanup failed")
    expect(blockedStartError.cause).toBe(cleanupError)
    expect(start).toHaveBeenCalledTimes(1)

    await lifecycle.stop()

    expect(stopCalls).toBe(2)
    expect(lifecycle.state).toBe("idle")
  })

  it("retains failed-start cleanup and permits only a cleanup retry", async () => {
    const startupError = new Error("backend startup failed")
    const cleanupError = new Error("backend cleanup failed")
    const start = jasmine.createSpy("start").and.rejectWith(startupError)
    let stopCalls = 0
    const lifecycle = new StartStopLifecycle({
      start,
      stop: async () => {
        stopCalls += 1
        if (stopCalls === 1) throw cleanupError
      }
    })

    const failure = await lifecycle.start().catch((error) => error)

    expect(failure).toEqual(jasmine.any(AggregateError))
    expect(failure.cause).toBe(startupError)
    expect(failure.errors).toEqual([startupError, cleanupError])
    expect(lifecycle.state).toBe("cleanup-failed")
    await expectAsync(lifecycle.start()).toBeRejectedWithError(/cleanup failed/)
    expect(start).toHaveBeenCalledTimes(1)

    await lifecycle.stop()

    expect(stopCalls).toBe(2)
    expect(lifecycle.state).toBe("idle")
  })

  it("joins concurrent cleanup retries after a cleanup failure", async () => {
    const retryCleanup = createDeferred()
    let stopCalls = 0
    const lifecycle = new StartStopLifecycle({
      start: async () => {},
      stop: async () => {
        stopCalls += 1
        if (stopCalls === 1) throw new Error("backend cleanup failed")
        await retryCleanup.promise
      }
    })

    await lifecycle.start()
    await expectAsync(lifecycle.stop()).toBeRejected()
    const firstRetry = lifecycle.stop()
    const secondRetry = lifecycle.stop()

    await Promise.resolve()
    expect(firstRetry).toBe(secondRetry)
    expect(stopCalls).toBe(2)
    expect(lifecycle.state).toBe("stopping")

    retryCleanup.resolve()
    await Promise.all([firstRetry, secondRetry])

    expect(lifecycle.state).toBe("idle")
  })

  it("rejects a queued start when cleanup fails without running it later", async () => {
    const cleanup = createDeferred()
    const cleanupError = new Error("backend cleanup failed")
    const start = jasmine.createSpy("start").and.resolveTo(undefined)
    const lifecycle = new StartStopLifecycle({
      start,
      stop: async () => {
        await cleanup.promise
        throw cleanupError
      }
    })

    await lifecycle.start()
    const stopping = lifecycle.stop()
    const queuedStart = lifecycle.start()

    cleanup.resolve()
    await expectAsync(stopping).toBeRejectedWith(cleanupError)
    await expectAsync(queuedStart).toBeRejectedWith(cleanupError)
    await Promise.resolve()

    expect(start).toHaveBeenCalledTimes(1)
    expect(lifecycle.state).toBe("cleanup-failed")
  })

  it("accepts unexpected completion only for the current running generation", async () => {
    const shutdown = createDeferred()
    const generations = []
    const lifecycle = new StartStopLifecycle({
      start: async ({generation}) => {
        generations.push(generation)
      },
      stop: async () => await shutdown.promise
    })

    await lifecycle.start()
    expect(lifecycle.notifyResourceStopped(generations[0])).toBeTrue()
    expect(lifecycle.state).toBe("idle")

    await lifecycle.start()
    expect(lifecycle.notifyResourceStopped(generations[0])).toBeFalse()
    expect(lifecycle.state).toBe("running")

    const stopping = lifecycle.stop()
    expect(lifecycle.notifyResourceStopped(generations[1])).toBeFalse()
    expect(lifecycle.state).toBe("stopping")

    shutdown.resolve()
    await stopping
    expect(lifecycle.state).toBe("idle")
  })
})
