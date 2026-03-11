import BrowserRegistry from "./browser-registry.js"
import WebSocket from "ws"

/** Sends browser commands to a running browser daemon. */
export default class BrowserCommandClient {
  /**
   * @param {object} args
   * @param {string} [args.name]
   * @param {number} [args.port]
   */
  constructor({name, port} = {}) {
    this.name = name
    this.port = port
  }

  /**
   * @param {Record<string, any>} payload
   * @returns {Promise<any>}
   */
  async send(payload) {
    const resolvedPort = this.port ?? (await BrowserRegistry.resolve(this.name)).port
    const ws = new WebSocket(`ws://127.0.0.1:${resolvedPort}`)

    return await new Promise((resolve, reject) => {
      ws.on("open", () => {
        ws.send(JSON.stringify(payload))
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
