import Browser from "./browser.js"
import BrowserCommandRunner from "./browser-command-runner.js"
import {browserDaemonStopTimeoutMs} from "./browser-daemon-constants.js"
import BrowserRegistry from "./browser-registry.js"
import {WebSocketServer} from "ws"

/** Long-running browser daemon exposing browser commands over WebSocket. */
export default class BrowserProcess {
  /**
   * @param {object} args
   * @param {string} args.name
   * @param {Browser} [args.browser]
   * @param {Record<string, any>} [args.browserArgs]
   * @param {string} [args.baseUrl]
   * @param {boolean} [args.debug]
   * @param {number} [args.port]
   */
  constructor({name, browser, browserArgs = {}, baseUrl, debug = false, port = 0}) {
    this.name = name
    this.browser = browser ?? new Browser({debug, ...browserArgs})
    this.baseUrl = baseUrl
    this.debug = debug
    this.requestRunner = new BrowserCommandRunner({browser: this.browser})
    this.requestCount = 0
    this.port = port
  }

  /** @returns {Promise<void>} */
  async start() {
    if (!this.name) {
      throw new Error("Browser process requires a name")
    }

    if (this.baseUrl) {
      this.browser.getDriverAdapter().setBaseUrl(this.baseUrl)
    }

    await this.browser.getDriverAdapter().start()
    await this.browser.setTimeouts(browserDaemonStopTimeoutMs)

    this.wss = new WebSocketServer({port: this.port})
    await new Promise((resolve) => {
      this.wss.once("listening", resolve)
    })

    const address = this.wss.address()

    if (!address || typeof address === "string") {
      throw new Error("Could not resolve browser process port")
    }

    this.port = address.port
    this.wss.on("connection", this.onConnection)

    await BrowserRegistry.register({
      baseUrl: this.baseUrl,
      name: this.name,
      pid: process.pid,
      port: this.port,
      startedAt: new Date().toISOString()
    })

    const stop = async () => {
      await this.stop()
      process.exit(0)
    }

    process.once("SIGINT", stop)
    process.once("SIGTERM", stop)
  }

  /** @returns {Promise<void>} */
  async stop() {
    if (this.stopped) {
      return
    }

    this.stopped = true
    await BrowserRegistry.unregister(this.name)

    if (this.wss) {
      await new Promise((resolve, reject) => {
        this.wss.close((error) => {
          if (error) {
            reject(error)
          } else {
            resolve(undefined)
          }
        })
      })
    }

    await this.browser.stopDriver()
  }

  /**
   * @param {import("ws").WebSocket} ws
   * @returns {void}
   */
  onConnection = (ws) => {
    ws.on("message", async (rawData) => {
      const requestId = `${Date.now()}-${this.requestCount++}`

      try {
        const payload = JSON.parse(rawData.toString())
        const result = await this.handlePayload(payload)

        ws.send(JSON.stringify({ok: true, requestId, result, type: "browser-command-result"}))
      } catch (error) {
        ws.send(JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
          ok: false,
          requestId,
          type: "browser-command-result"
        }))
      }
    })
  }

  /**
   * @param {Record<string, any>} payload
   * @returns {Promise<any>}
   */
  async handlePayload(payload) {
    if (payload.type === "browser-daemon") {
      if (payload.command !== "describe") {
        throw new Error(`Unknown browser daemon command: ${payload.command}`)
      }

      return {name: this.name, pid: process.pid, port: this.port}
    }

    if (payload.type !== "browser-command") {
      throw new Error(`Unknown payload type: ${payload.type}`)
    }

    const command = payload.command
    const commandArgs = payload.args ? {...payload.args} : {}

    if (payload.url && !commandArgs.url) {
      commandArgs.url = payload.url
    }

    if (payload.path && !commandArgs.path) {
      commandArgs.path = payload.path
    }

    if (payload.selector && !commandArgs.selector) {
      commandArgs.selector = payload.selector
    }

    if (payload.testID && !commandArgs.testID) {
      commandArgs.testID = payload.testID
    }

    return await this.requestRunner.run(command, commandArgs)
  }
}
