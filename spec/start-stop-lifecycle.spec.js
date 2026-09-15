// @ts-check

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
    expect(lifecycle.state).toBe("idle")
  })
})
