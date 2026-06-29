// @ts-check

import {WebSocketServer} from "ws"
import BrowserCommandClient from "../src/browser-command-client.js"

/**
 * Starts a local daemon stub that captures the first payload it receives.
 * @returns {Promise<{port: number, getReceived: () => any, close: () => Promise<void>}>}
 */
async function startStubDaemon() {
  const wss = new WebSocketServer({host: "127.0.0.1", port: 0})

  await new Promise((resolve) => wss.once("listening", resolve))

  const address = wss.address()

  if (!address || typeof address === "string") throw new Error("Could not resolve stub daemon port")

  /** @type {any} */
  let received

  wss.on("connection", (ws) => {
    ws.on("message", (rawData) => {
      received = JSON.parse(rawData.toString())
      ws.send(JSON.stringify({ok: true, result: "done"}))
    })
  })

  return {
    port: address.port,
    getReceived: () => received,
    close: () => new Promise((resolve) => wss.close(() => resolve(undefined)))
  }
}

describe("BrowserCommandClient", () => {
  it("includes the token in sent payloads when configured", async () => {
    const daemon = await startStubDaemon()

    try {
      const client = new BrowserCommandClient({port: daemon.port, token: "secret"})
      const result = await client.send({command: "visit", type: "browser-command", url: "https://example.com"})

      expect(result).toEqual("done")
      expect(daemon.getReceived().token).toEqual("secret")
      expect(daemon.getReceived().command).toEqual("visit")
    } finally {
      await daemon.close()
    }
  })

  it("omits the token from sent payloads when not configured", async () => {
    const daemon = await startStubDaemon()

    try {
      const client = new BrowserCommandClient({port: daemon.port})

      await client.send({command: "visit", type: "browser-command", url: "https://example.com"})

      expect("token" in daemon.getReceived()).toBeFalse()
    } finally {
      await daemon.close()
    }
  })
})
