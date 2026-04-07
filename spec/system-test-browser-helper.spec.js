// @ts-check

import {EventEmitter} from "eventemitter3"
import SystemTestBrowserHelper from "../src/system-test-browser-helper.js"

describe("SystemTestBrowserHelper command events", () => {
  it("throws when no command listener is registered", () => {
    const browserHelper = Object.create(SystemTestBrowserHelper.prototype)
    browserHelper.events = new EventEmitter()

    expect(() => {
      browserHelper.emitCommandEvent("navigate", {path: "/missing-listener"})
    }).toThrowError("No listener registered for command event: navigate (/missing-listener)")
  })

  it("does not throw when a command listener is registered", () => {
    const browserHelper = Object.create(SystemTestBrowserHelper.prototype)
    browserHelper.events = new EventEmitter()
    browserHelper.events.on("dismissTo", () => {})

    expect(() => {
      browserHelper.emitCommandEvent("dismissTo", {path: "/ok"})
    }).not.toThrow()
  })

  it("runs the teardown callback for teardown commands", async () => {
    const originalStartScoundrel = SystemTestBrowserHelper.prototype.startScoundrel

    try {
      SystemTestBrowserHelper.prototype.startScoundrel = function () {}

      const browserHelper = new SystemTestBrowserHelper()
      let teardownCount = 0

      browserHelper.onTeardown(async () => {
        teardownCount += 1
      })

      const result = await browserHelper.onCommand({data: {type: "teardown"}})

      expect(result).toEqual({result: "torn-down"})
      expect(teardownCount).toEqual(1)
    } finally {
      SystemTestBrowserHelper.prototype.startScoundrel = originalStartScoundrel
    }
  })
})
