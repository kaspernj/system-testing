import BrowserRegistry from "./browser-registry.js"
import {resolveDaemonConnectHost} from "./browser-daemon-constants.js"
import WebSocket from "ws"

/** Sends browser commands to a running browser daemon. */
export default class BrowserCommandClient {
  /**
   * @param {object} args
   * @param {string} [args.name]
   * @param {number} [args.port]
   * @param {string} [args.host] Override host. Defaults to the registered daemon's bind host.
   * @param {string} [args.token] Optional shared token sent with each command.
   */
  constructor({name, port, host, token} = {}) {
    this.name = name
    this.port = port
    this.host = host
    this.token = token || undefined
  }

  /**
   * @param {Record<string, any>} payload
   * @returns {Promise<any>}
   */
  async send(payload) {
    let resolvedPort = this.port
    let resolvedHost = this.host

    if (resolvedPort === undefined) {
      const entry = await BrowserRegistry.resolve(this.name)

      resolvedPort = entry.port
      resolvedHost = resolvedHost ?? entry.host
    }

    const ws = new WebSocket(`ws://${resolveDaemonConnectHost(resolvedHost)}:${resolvedPort}`)
    const authorizedPayload = this.token ? {...payload, token: this.token} : payload

    return await new Promise((resolve, reject) => {
      ws.on("open", () => {
        ws.send(JSON.stringify(authorizedPayload))
      })

      ws.on("message", (rawData) => {
        const response = JSON.parse(rawData.toString())

        ws.close()

        if (response.ok) {
          resolve(response.result)
        } else {
          reject(new Error(response.error))
        }
      })

      ws.on("error", reject)
    })
  }
}
