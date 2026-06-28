// @ts-check

import SystemTest, {defaultClientWebSocketConnectTimeout} from "../src/system-test.js"
import {
  defaultSystemTestJasmineStartupTimeoutInterval,
  defaultSystemTestJasmineTimeoutInterval
} from "./support/system-test-helper.js"

describe("SystemTest client WebSocket timeout", () => {
  /** @type {string | undefined} */
  let previousSystemTestHost

  beforeEach(() => {
    previousSystemTestHost = process.env.SYSTEM_TEST_HOST
  })

  afterEach(() => {
    if (previousSystemTestHost === undefined) {
      delete process.env.SYSTEM_TEST_HOST
    } else {
      process.env.SYSTEM_TEST_HOST = previousSystemTestHost
    }
  })

  it("keeps the web client WebSocket startup timeout at thirty seconds", () => {
    process.env.SYSTEM_TEST_HOST = "dist"

    expect(defaultClientWebSocketConnectTimeout()).toEqual(30000)
  })

  it("uses a native-safe client WebSocket startup timeout for Appium native app sessions", () => {
    process.env.SYSTEM_TEST_HOST = "dist"

    expect(defaultClientWebSocketConnectTimeout({
      driver: {
        type: "appium",
        options: {
          capabilities: {
            app: "spec/dummy/android/app/build/outputs/apk/release/app-release.apk",
            browserName: ""
          }
        }
      }
    })).toEqual(120000)
  })

  it("keeps Appium browser sessions on the web client WebSocket startup timeout", () => {
    process.env.SYSTEM_TEST_HOST = "dist"

    expect(defaultClientWebSocketConnectTimeout({
      driver: {
        type: "appium",
        options: {
          capabilities: {
            browserName: "Chrome"
          }
        }
      }
    })).toEqual(30000)
  })

  it("uses a native-safe client WebSocket startup timeout", () => {
    process.env.SYSTEM_TEST_HOST = "native"

    expect(defaultClientWebSocketConnectTimeout()).toEqual(120000)
  })

  it("sets a Jasmine timeout above the native WebSocket startup window", () => {
    process.env.SYSTEM_TEST_HOST = "native"

    expect(defaultSystemTestJasmineTimeoutInterval()).toBeGreaterThan(defaultClientWebSocketConnectTimeout())
  })

  it("uses a longer Jasmine timeout for shared browser startup hooks", () => {
    process.env.SYSTEM_TEST_HOST = "dist"

    expect(defaultSystemTestJasmineStartupTimeoutInterval()).toBeGreaterThan(defaultSystemTestJasmineTimeoutInterval())
  })

  it("keeps the startup timeout above the sum of SystemTest.start internal phase timeouts", () => {
    process.env.SYSTEM_TEST_HOST = "dist"

    // Selenium session creation (60s) + systemTestingComponent lookup (30s) + client WebSocket connect.
    // The shared startup beforeAll must dominate this sum so a hung phase surfaces its own specific
    // error instead of the outer hook timing out first with an opaque "beforeAll failed" cascade.
    const internalStartupPhaseSum = 60000 + 30000 + defaultClientWebSocketConnectTimeout()

    expect(defaultSystemTestJasmineStartupTimeoutInterval()).toBeGreaterThan(internalStartupPhaseSum)
  })

  it("scales the startup timeout above the internal phases for the native client WebSocket window", () => {
    process.env.SYSTEM_TEST_HOST = "native"

    const internalStartupPhaseSum = 60000 + 30000 + defaultClientWebSocketConnectTimeout()

    expect(defaultSystemTestJasmineStartupTimeoutInterval()).toBeGreaterThan(internalStartupPhaseSum)
  })

  it("keeps the Jasmine startup timeout above the native WebSocket window for native Appium under dist", () => {
    process.env.SYSTEM_TEST_HOST = "dist"

    const driver = {
      type: /** @type {const} */ ("appium"),
      options: {
        capabilities: {
          app: "spec/dummy/android/app/build/outputs/apk/release/app-release.apk",
          browserName: ""
        }
      }
    }

    expect(defaultSystemTestJasmineStartupTimeoutInterval(driver)).toBeGreaterThan(defaultClientWebSocketConnectTimeout({driver}))
  })

  it("waits for an explicit client WebSocket startup timeout", async () => {
    jasmine.clock().install()

    try {
      const systemTest = Object.create(SystemTest.prototype)
      systemTest._clientWsConnectTimeout = 42
      systemTest.ws = undefined

      const waitPromise = systemTest.waitForClientWebSocket()
      jasmine.clock().tick(41)

      await expectAsync(Promise.race([
        waitPromise.then(() => "resolved", () => "rejected"),
        Promise.resolve("pending")
      ])).toBeResolvedTo("pending")

      jasmine.clock().tick(1)
      await expectAsync(waitPromise).toBeRejectedWithError("timeout while waiting for client WebSocket connection")
    } finally {
      jasmine.clock().uninstall()
    }
  })
})
