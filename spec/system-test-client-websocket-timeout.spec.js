// @ts-check

import SystemTest, {defaultClientWebSocketConnectTimeout} from "../src/system-test.js"
import {defaultSystemTestJasmineTimeoutInterval} from "./support/system-test-helper.js"

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

  it("uses a native-safe client WebSocket startup timeout", () => {
    process.env.SYSTEM_TEST_HOST = "native"

    expect(defaultClientWebSocketConnectTimeout()).toEqual(120000)
  })

  it("sets a Jasmine timeout above the native WebSocket startup window", () => {
    process.env.SYSTEM_TEST_HOST = "native"

    expect(defaultSystemTestJasmineTimeoutInterval()).toBeGreaterThan(defaultClientWebSocketConnectTimeout())
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
