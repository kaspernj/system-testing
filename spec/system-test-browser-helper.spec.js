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
})
