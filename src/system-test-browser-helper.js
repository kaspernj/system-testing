import {digg} from "diggerize"
import EventEmitter from "events"

import SystemTestCommunicator from "./system-test-communicator"

const shared = {}

export default class SystemTestBrowserHelper {
  static current() {
    if (!shared.systemTestBrowserHelper) {
      throw new Error("No current SystemTestBrowserHelper set")
    }

    return shared.systemTestBrowserHelper
  }

  constructor() {
    this.communicator = new SystemTestCommunicator({parent: this, onCommand: this.onCommand})
    this._enabled = false
    this.events = new EventEmitter()

    shared.systemTestBrowserHelper = this
  }

  connectOnError() {
    window.addEventListener("error", (event) => {
      this.handleError({
        type: "error",
        error: event.error,
        errorClass: event.error?.name,
        file: event.filename,
        line: event.lineno,
        message: event.message || "Unknown error",
        url: window.location.href
      })
    })
  }

  connectUnhandledRejection() {
    window.addEventListener("unhandledrejection", (event) => {
      this.handleError({
        type: "unhandledrejection",
        error: event.reason,
        errorClass: "UnhandledRejection",
        file: null,
        line: null,
        message: event.reason.message || "Unhandled promise rejection",
        url: window.location.href
      })
    })
  }

  handleError(data) {
    let backtrace

    if (data.error && data.error.stack) {
      backtrace = data.error.stack
    } else if (data.file) {
      backtrace = [`${data.file}:${data.line}`]
    }

    data.backtrace = backtrace

    this.communicator.sendCommand(data)
  }

  connectWebSocket() {
    this.ws = new WebSocket("ws://localhost:1985") // eslint-disable-line no-undef

    this.communicator.ws = this.ws
    this.ws.addEventListener("error", digg(this, "communicator", "onError"))
    this.ws.addEventListener("open", digg(this, "communicator", "onOpen"))
    this.ws.addEventListener("message", (event) => this.communicator.onMessage(event.data))
  }

  enableOnBrowser() {
    this._enabled = true
    this.connectWebSocket()
    this.connectOnError()
    this.connectUnhandledRejection()
    this.overrideConsoleLog()
  }

  getEnabled = () => this._enabled
  getEvents = () => this.events

  fakeConsoleError = (...args) => {
    this.communicator.sendCommand({type: "console.error", value: this.consoleLogMessage(args)})

    return this.originalConsoleError(...args)
  }

  fakeConsoleLog = (...args) => {
    this.communicator.sendCommand({type: "console.log", value: this.consoleLogMessage(args)})

    return this.originalConsoleLog(...args)
  }

  consoleLogMessage(arg) {
    if (Array.isArray(arg)) {
      const result = []

      for (const value of arg) {
        result.push(this.consoleLogMessage(value))
      }

      return result
    } else if (Object.prototype.toString.call(arg) === '[object Object]') {
      const result = {}

      for (const key in arg) {
        result[key] = this.consoleLogMessage(arg[key])
      }

      return result
    } else if (typeof arg == "object") {
      return `[object ${arg?.constructor?.name}]`
    } else {
      return arg
    }
  }

  onCommand = async ({data}) => {
    if (data.type == "initialize") {
      this.events.emit("initialize")

      if (this._onInitializeCallback) {
        await this._onInitializeCallback()
      }

      return {result: "initialized"}
    } else if (data.type == "visit") {
      this.events.emit("navigate", {path: data.path})
    } else {
      throw new Error(`Unknown command type for SystemTestBrowserHelper: ${data.type}`)
    }
  }

  onInitialize(callback) {
    this._onInitializeCallback = callback
  }

  overrideConsoleLog() {
    if (this.originalConsoleError || this.originalConsoleLog) {
      throw new Error("Console methods has already been overridden!")
    }

    this.originalConsoleError = console.error
    this.originalConsoleLog = console.log

    console.error = this.fakeConsoleError
    console.log = this.fakeConsoleLog
  }

  async sendQuery(sql) {
    return await this.communicator.sendCommand({type: "query", sql})
  }
}
