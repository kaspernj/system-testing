// @ts-check

import Client from "scoundrel-remote-eval/build/client/index.js"
import ClientWebSocket from "scoundrel-remote-eval/build/client/connections/web-socket/index.js"
import {EventEmitter} from "eventemitter3"

import SystemTestCommunicator from "./system-test-communicator.js"

const CLIENT_WEBSOCKET_RECONNECT_DELAY_MS = 250
const CLIENT_WEBSOCKET_RECONNECT_WINDOW_MS = 120000
const CLIENT_WEBSOCKET_MAX_RECONNECT_ATTEMPTS = Math.ceil(
  CLIENT_WEBSOCKET_RECONNECT_WINDOW_MS / CLIENT_WEBSOCKET_RECONNECT_DELAY_MS
)

/** @type {{systemTestBrowserHelper: SystemTestBrowserHelper | null}} */
const shared = {
  systemTestBrowserHelper: null
}

/**
 * @param {Event | Error} error
 * @returns {Error}
 */
function webSocketError(error) {
  if (error instanceof Error) return error

  return new Error(`WebSocket connection failed: ${error.type}`)
}

export default class SystemTestBrowserHelper {
  /** @type {string | undefined} */
  static _defaultHost = undefined
  clientWebSocketReconnectAttempts = 0

  /**
   * Sets the default host for all browser helpers. Use this to override the
   * auto-detected host when EXPO_PUBLIC_* env vars cannot be inlined (e.g.,
   * code in node_modules is not processed by babel-preset-expo).
   * @param {string} host
   * @returns {void}
   */
  static setDefaultHost(host) {
    SystemTestBrowserHelper._defaultHost = host
  }

  /**
   * @param {string} parameterName
   * @param {number} fallback
   * @returns {number}
   */
  getSystemTestPort(parameterName, fallback) {
    const location = globalThis.location
    const search = location?.search

    if (!search) {
      return fallback
    }

    const value = new URLSearchParams(search).get(parameterName)

    if (!value) {
      return fallback
    }

    const parsed = Number(value)

    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
  }

  /** @returns {SystemTestBrowserHelper | null} */
  static getCurrent() {
    return shared.systemTestBrowserHelper
  }

  static current() {
    if (!shared.systemTestBrowserHelper) {
      throw new Error("No current SystemTestBrowserHelper set")
    }

    return shared.systemTestBrowserHelper
  }

  constructor() {
    this.communicator = new SystemTestCommunicator({parent: this, onCommand: this.onCommand})
    this._enabled = false
    this._hasInitialized = false
    this.events = new EventEmitter()

    shared.systemTestBrowserHelper = this

    this.startScoundrel()
  }

  async startScoundrel() {
    const host = this.getSystemTestHost()
    const scoundrelPort = this.getSystemTestPort("systemTestScoundrelPort", 8090)

    this.scoundrelWs = new WebSocket(`ws://${host}:${scoundrelPort}`)

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
    if (!window?.addEventListener) return

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
    if (!window?.addEventListener) return

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

  /** @returns {void} */
  connectWebSocket() {
    this.clientWebSocketReconnectAttempts = 0
    this.connectClientWebSocket()
  }

  /** @returns {void} */
  connectClientWebSocket() {
    const host = this.getSystemTestHost()
    const clientWsPort = this.getSystemTestPort("systemTestClientWsPort", 1985)
    const websocket = new WebSocket(`ws://${host}:${clientWsPort}`)
    let opened = false
    let reconnectScheduled = false

    this.ws = websocket
    this.communicator.ws = websocket

    /** @param {Event | Error} error */
    const scheduleReconnect = (error) => {
      if (opened) {
        this.communicator.onError(webSocketError(error))
        return
      }

      if (reconnectScheduled || this.ws !== websocket) return

      this.clientWebSocketReconnectAttempts += 1
      if (this.clientWebSocketReconnectAttempts > CLIENT_WEBSOCKET_MAX_RECONNECT_ATTEMPTS) {
        this.communicator.onError(webSocketError(error))
        return
      }

      reconnectScheduled = true
      setTimeout(() => {
        if (opened || this.ws !== websocket) return

        this.connectClientWebSocket()
      }, CLIENT_WEBSOCKET_RECONNECT_DELAY_MS)
    }

    websocket.addEventListener("error", scheduleReconnect)
    websocket.addEventListener("close", scheduleReconnect)
    websocket.addEventListener("open", () => {
      opened = true
      this.clientWebSocketReconnectAttempts = 0
      this.communicator.onOpen()
    })
    websocket.addEventListener("message", (event) => this.communicator.onMessage(event.data))
  }

  /** @returns {string} */
  getSystemTestHost() {
    const location = globalThis.location
    const defaultHost = location?.hostname || "localhost"
    const search = location?.search
    const envHost = process.env.EXPO_PUBLIC_SYSTEM_TEST_HOST

    if (envHost) return envHost

    if (SystemTestBrowserHelper._defaultHost) return SystemTestBrowserHelper._defaultHost

    if (!search) return defaultHost

    const params = new URLSearchParams(search)
    const host = params.get("systemTestHost")

    const resolvedHost = host || defaultHost

    if (resolvedHost === "0.0.0.0") return "127.0.0.1"

    return resolvedHost
  }

  /** @returns {void} */
  enableOnBrowser() {
    if (this._enabled) {
      return
    }

    this._enabled = true
    this.connectWebSocket()
    this.connectOnError()
    this.connectUnhandledRejection()
    this.overrideConsoleLog()
  }

  /** @returns {boolean} */
  getEnabled() { return this._enabled }

  /** @returns {EventEmitter} */
  getEvents() { return this.events }

  /**
   * Emits a command event and throws when no listener handled it.
   * @param {string} eventName
   * @param {{path: string}} payload
   * @returns {Promise<void>}
   */
  async emitCommandEvent(eventName, payload) {
    const listeners = this.events.listeners(eventName)

    if (listeners.length === 0) {
      throw new Error(`No listener registered for command event: ${eventName} (${payload.path})`)
    }

    for (const listener of listeners) {
      await listener(payload)
    }
  }

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
   * @param {{data: Record<string, any>}} args
   * @returns {Promise<any>}
   */
  onCommand = async ({data}) => {
    if (data.type == "initialize") {
      this.events.emit("initialize")

      if (!this._hasInitialized) {
        this._hasInitialized = true

        if (this._onFirstInitializeCallback) {
          await this._onFirstInitializeCallback()
        }
      }

      if (this._onInitializeCallback) {
        await this._onInitializeCallback()
      }

      return {result: "initialized"}
    } else if (data.type == "teardown") {
      this.events.emit("teardown")

      if (this._onTeardownCallback) {
        await this._onTeardownCallback()
      }

      return {result: "torn-down"}
    } else if (data.type == "waitForScoundrel") {
      await this.waitForScoundrelStarted()
      return {result: "scoundrel-ready"}
    } else if (data.type == "visit") {
      await this.emitCommandEvent("navigate", {path: data.path})
      return {result: "visited"}
    } else if (data.type == "dismissTo") {
      await this.emitCommandEvent("dismissTo", {path: data.path})
      return {result: "dismissed"}
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
   * @param {function() : void} callback
   * @returns {void}
   */
  onTeardown(callback) {
    this._onTeardownCallback = callback
  }

  /**
   * @param {function() : void} callback
   * @returns {void}
   */
  onFirstInitialize(callback) {
    this._onFirstInitializeCallback = callback
  }

  /** @returns {void} */
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
