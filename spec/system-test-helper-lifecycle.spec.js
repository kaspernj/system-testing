// @ts-check

import SystemTest from "../src/system-test.js"
import SystemTestHelper from "./support/system-test-helper.js"

describe("SystemTestHelper failed beforeAll cleanup", () => {
  it("stops allocated resources once and preserves startup plus cleanup errors", async () => {
    const state = globalThis.__systemTestHelperState
    const originalState = {...state}
    const originalJasmineTimeout = jasmine.DEFAULT_TIMEOUT_INTERVAL
    state.started = false
    state.refCount = 0
    state.systemTest = undefined
    const helper = new SystemTestHelper()
    const startupError = new Error("root lookup failed", {cause: new Error("renderer query failed")})
    const cleanupError = new Error("driver quit failed")
    const systemTest = {
      start: jasmine.createSpy("start").and.rejectWith(startupError),
      stop: jasmine.createSpy("stop").and.rejectWith(cleanupError)
    }
    spyOn(SystemTest, "current").and.returnValue(/** @type {any} */ (systemTest))
    spyOn(helper.dummyHttpServerEnvironment, "start").and.resolveTo(undefined)
    spyOn(helper.dummyHttpServerEnvironment, "stop").and.resolveTo(undefined)
    const diagnostics = spyOn(console, "error")
    jasmine.clock().install()
    try {
      const startup = helper.start().catch((error) => error)
      await Promise.resolve()
      jasmine.clock().tick(1000)
      const failure = await startup
      expect(failure).toEqual(jasmine.any(AggregateError))
      expect(failure.cause).toBe(startupError)
      expect(failure.errors).toEqual([startupError, cleanupError])
      expect(diagnostics).toHaveBeenCalledWith("[system-test] beforeAll error", failure)
      expect(systemTest.start).toHaveBeenCalledTimes(1)
      expect(systemTest.stop).toHaveBeenCalledTimes(1)
      expect(helper.dummyHttpServerEnvironment.stop).toHaveBeenCalledTimes(1)
      await helper.stop()
      expect(systemTest.stop).toHaveBeenCalledTimes(1)
      expect(helper.dummyHttpServerEnvironment.stop).toHaveBeenCalledTimes(1)
      expect(state.started).toBeFalse()
      expect(state.refCount).toBe(0)
      expect(state.systemTest).toBeUndefined()
    } finally {
      jasmine.clock().uninstall()
      jasmine.DEFAULT_TIMEOUT_INTERVAL = originalJasmineTimeout
      Object.assign(state, originalState)
    }
  })
})
