// @ts-check

import Client from "scoundrel-remote-eval/build/client/index.js"
import ClientWebSocket from "scoundrel-remote-eval/build/client/connections/web-socket/index.js"
import {digg} from "diggerize"
import {EventEmitter} from "eventemitter3"

import SystemTestCommunicator from "./system-test-communicator.js"

/** @type {{systemTestBrowserHelper: SystemTestBrowserHelper | null}} */
const shared = {
  systemTestBrowserHelper: null
}

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

    this.startScoundrel()
  }

  async startScoundrel() {
    this.scoundrelWs = new WebSocket("http://localhost:8090")

    // @ts-expect-error
    this.scoundrelClientWebSocket = new ClientWebSocket(this.scoundrelWs)

    await this.scoundrelClientWebSocket.waitForOpened()

    this.scoundrelClient = new Client(this.scoundrelClientWebSocket, {enableServerControl: true})
    this.events.emit("scoundrelStarted")
  }

  waitForScoundrelStarted() {
    return new Promise((resolve) => {
      if (this.scoundrelClient) {
        resolve(undefined)
      } else {
        this.events.once("scoundrelStarted", () => {
          resolve(undefined)
        })
      }
    })
  }

  getScoundrel() {
    if (!this.scoundrelClient) {
      throw new Error("Scoundrel client is not started yet")
    }

    return this.scoundrelClient
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
        message: event.reason.message || event.reason || "Unhandled promise rejection without a message",
        url: window.location.href
      })
    })
  }

  /**
   * @param {object} data
   * @param {string} [data.backtrace]
   * @param {Error} [data.error]
   * @param {string} [data.errorClass]
   * @param {string} [data.file]
   * @param {number} [data.line]
   * @param {string} [data.message]
   * @param {string} [data.type]
   * @param {string} [data.url]
   * @returns {void}
   */
  handleError(data) {
    let backtrace

    if (data.error && data.error.stack) {
      backtrace = data.error.stack.split("\n")
      backtrace.shift()
      backtrace = backtrace.join("\n")
    } else if (data.file) {
      backtrace = `${data.file}:${data.line}`
    }

    data.backtrace = backtrace

    this.communicator.sendCommand(data)
  }

  /**
   * @returns {void}
   */
  connectWebSocket() {
    this.ws = new WebSocket("ws://localhost:1985")
    this.communicator.ws = this.ws
    this.ws.addEventListener("error", digg(this, "communicator", "onError"))
    this.ws.addEventListener("open", digg(this, "communicator", "onOpen"))
    this.ws.addEventListener("message", (event) => this.communicator.onMessage(event.data))
  }

  /**
   * @returns {void}
   */
  enableOnBrowser() {
    this._enabled = true
    this.connectWebSocket()
    this.connectOnError()
    this.connectUnhandledRejection()
    this.overrideConsoleLog()
  }

  /**
   * @returns {boolean}
   */
  getEnabled() { return this._enabled }

  /**
   * @returns {EventEmitter}
   */
  getEvents() { return this.events }

  /**
   * @param {any[]} args
   * @returns {void}
   */
  fakeConsoleError = (...args) => {
    this.communicator.sendCommand({type: "console.error", value: this.consoleLogMessage(args)})

    if (this.originalConsoleError) {
      return this.originalConsoleError(...args)
    }
  }

  /**
   * @param {any[]} args
   * @returns {void}
   */
  fakeConsoleLog = (...args) => {
    this.communicator.sendCommand({type: "console.log", value: this.consoleLogMessage(args)})

    if (this.originalConsoleLog) {
      return this.originalConsoleLog(...args)
    }
  }

  /**
   * @param {any} arg
   * @param {any[]} [scannedObjects]
   * @returns {any}
   */
  consoleLogMessage(arg, scannedObjects = []) {
    if (Array.isArray(arg)) {
      if (scannedObjects.includes(arg)) {
        return "[recursive]"
      } else {
        scannedObjects.push(arg)
      }

      const result = []

      for (const value of arg) {
        result.push(this.consoleLogMessage(value, scannedObjects))
      }

      return result
    } else if (Object.prototype.toString.call(arg) === '[object Object]') {
      if (scannedObjects.includes(arg)) {
        return "[recursive]"
      } else {
        scannedObjects.push(arg)
      }

      /** @type {Record<string, any>} */
      const result = {}

      for (const key in arg) {
        result[key] = this.consoleLogMessage(arg[key], scannedObjects)
      }

      return result
    } else if (typeof arg == "object") {
      return `[object ${arg?.constructor?.name}]`
    } else {
      return arg
    }
  }

  /**
   * @param {{data: {path: string, type: string}}} args
   * @returns {Promise<{result: string} | void>}
   */
  onCommand = async ({data}) => {
    if (data.type == "initialize") {
      this.events.emit("initialize")

      if (this._onInitializeCallback) {
        await this._onInitializeCallback()
      }

      return {result: "initialized"}
    } else if (data.type == "visit") {
      this.events.emit("navigate", {path: data.path})
    } else if (data.type == "dismissTo") {
      this.events.emit("dismissTo", {path: data.path})
    } else {
      throw new Error(`Unknown command type for SystemTestBrowserHelper: ${data.type}`)
    }
  }

  /**
   * @param {function() : void} callback
   * @returns {void}
   */
  onInitialize(callback) {
    this._onInitializeCallback = callback
  }

  /**
   * @returns {void}
   */
  overrideConsoleLog() {
    if (this.originalConsoleError || this.originalConsoleLog) {
      throw new Error("Console methods has already been overridden!")
    }

    this.originalConsoleError = console.error
    this.originalConsoleLog = console.log

    console.error = this.fakeConsoleError
    console.log = this.fakeConsoleLog
  }

  /**
   * @param {string} sql
   * @returns {Promise<Array<Record<string, any>>>}
   */
  async sendQuery(sql) {
    // @ts-expect-error
    return await this.communicator.sendCommand({type: "query", sql})
  }
}
