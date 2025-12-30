// @ts-check

import wait from "awaitery/build/wait.js"

import SystemTest from "../../src/system-test.js"
import DummyHttpServerEnvironment from "./dummy-http-server.js"

const sharedState = globalThis.__systemTestHelperState ??= {
  refCount: 0,
  started: false,
  /** @type {SystemTest | undefined} */
  systemTest: undefined,
  dummyHttpServerEnvironment: new DummyHttpServerEnvironment()
}

export default class SystemTestHelper {
  constructor({debug = process.env.SYSTEM_TEST_DEBUG === "true"} = {}) {
    this.debug = debug
    this.dummyHttpServerEnvironment = sharedState.dummyHttpServerEnvironment
    this.systemTest = sharedState.systemTest

    jasmine.DEFAULT_TIMEOUT_INTERVAL = 60000
  }

  /** @param {...any} args */
  debugLog(...args) { if (this.debug) console.log(...args) }

  installJasmineHooks() {
    beforeAll(async () => {
      await this.start()
    })

    afterAll(async () => {
      await this.stop()
    })
  }

  /** @returns {Promise<void>} */
  async start() {
    sharedState.refCount += 1
    if (sharedState.started) {
      this.systemTest = sharedState.systemTest
      return
    }

    sharedState.started = true
    this.debugLog("[system-test] beforeAll: starting dummy HTTP env")
    try {
      await this.dummyHttpServerEnvironment.start()
      await wait(1000)

      this.debugLog("[system-test] beforeAll: creating SystemTest")
      this.systemTest = SystemTest.current({
        debug: this.debug,
        host: "127.0.0.1",
        port: 3601,
        httpHost: "0.0.0.0",
        httpPort: 3602,
        errorFilter: (error) => {
          if (typeof error?.value?.[0] === "string" && error.value[0].includes("Uncaught Error: Minified React error #418; visit")) return false
          return true
        }
      })
      sharedState.systemTest = this.systemTest
      this.debugLog("[system-test] beforeAll: starting SystemTest")
      await this.systemTest.start()
      this.debugLog("[system-test] beforeAll: SystemTest started")
    } catch (error) {
      sharedState.started = false
      sharedState.refCount = Math.max(0, sharedState.refCount - 1)
      console.error("[system-test] beforeAll error", error)
      throw error
    }
  }

  /** @returns {Promise<void>} */
  async stop() {
    if (!sharedState.started) return
    sharedState.refCount = Math.max(0, sharedState.refCount - 1)
    if (sharedState.refCount > 0) return

    this.debugLog("[system-test] afterAll: stopping SystemTest and dummy HTTP env")
    try {
      await this.systemTest?.stop()
      await this.dummyHttpServerEnvironment.stop()
      this.debugLog("[system-test] afterAll: teardown complete")
      sharedState.started = false
      sharedState.systemTest = undefined
    } catch (error) {
      console.error("[system-test] afterAll error", error)
      throw error
    }
  }

  /** @returns {SystemTest} */
  getSystemTest() {
    if (!this.systemTest) throw new Error("SystemTest hasn't been started yet")
    return this.systemTest
  }
}
