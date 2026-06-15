// @ts-check

import {EventEmitter} from "eventemitter3"
import SystemTestBrowserHelper from "../src/system-test-browser-helper.js"

class FakeWebSocket {
  static instances = []

  constructor(url) {
    this.url = url
    this.readyState = 0
    this.sentMessages = []
    this.listeners = {}

    FakeWebSocket.instances.push(this)
  }

  addEventListener(eventName, callback) {
    this.listeners[eventName] ||= []
    this.listeners[eventName].push(callback)
  }

  emit(eventName, event = {}) {
    for (const callback of this.listeners[eventName] || []) {
      callback(event)
    }
  }

  send(message) {
    this.sentMessages.push(message)
  }
}

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

  it("retries the client websocket connection before open", () => {
    const originalStartScoundrel = SystemTestBrowserHelper.prototype.startScoundrel
    const originalWebSocket = globalThis.WebSocket

    jasmine.clock().install()

    try {
      SystemTestBrowserHelper.prototype.startScoundrel = function () {}
      globalThis.WebSocket = FakeWebSocket
      FakeWebSocket.instances = []

      const browserHelper = new SystemTestBrowserHelper()
      const onError = spyOn(browserHelper.communicator, "onError")
      const onOpen = spyOn(browserHelper.communicator, "onOpen")

      browserHelper.connectWebSocket()
      expect(FakeWebSocket.instances.length).toEqual(1)

      FakeWebSocket.instances[0].emit("close")
      jasmine.clock().tick(250)
      expect(FakeWebSocket.instances.length).toEqual(2)

      FakeWebSocket.instances[1].emit("open")
      expect(onOpen).toHaveBeenCalled()
      expect(onError).not.toHaveBeenCalled()
      expect(browserHelper.ws).toBe(FakeWebSocket.instances[1])
      expect(browserHelper.communicator.ws).toBe(FakeWebSocket.instances[1])
    } finally {
      globalThis.WebSocket = originalWebSocket
      SystemTestBrowserHelper.prototype.startScoundrel = originalStartScoundrel
      jasmine.clock().uninstall()
    }
  })
})
