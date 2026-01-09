// @ts-check

import fs from "node:fs/promises"
import http from "node:http"
import mime from "mime"

export default class SystemTestHttpServer {
  /**
   * @param {{host?: string, port?: number, debug?: boolean}} [args]
   */
  constructor({host = "localhost", port = 1984, debug = false} = {}) {
    this._host = host
    this._port = port
    this._debug = debug
    /** @type {Set<import("node:net").Socket>} */
    this._connections = new Set()
  }

  /** @param {string} message */
  debugLog(message) {
    if (this._debug) console.log(`[SystemTestHttpServer] ${message}`)
  }

  /** @returns {Promise<void>} */
  async close() {
    if (!this.httpServer) {
      throw new Error("HTTP server is not initialized")
    }

    if (this._connections.size > 0) {
      for (const connection of this._connections) {
        connection.destroy()
      }
      this._connections.clear()
    }

    await new Promise((resolve, reject) => {
      this.httpServer.close((error) => {
        if (error) reject(error)
        else resolve()
      })
    })
  }

  /**
   * @param {http.IncomingMessage} request
   * @param {http.ServerResponse} response
   * @returns {Promise<void>}
   */
  onHttpServerRequest = async (request, response) => {
    if (!request.url) {
      response.statusCode = 400
      response.end("Bad Request")
      return
    }

    const baseUrl = `http://${request.headers.host || "localhost:1984"}`
    const {pathname} = new URL(request.url, baseUrl)
    let filePath = `${process.cwd()}/dist${pathname}`

    if (filePath.endsWith("/")) {
      filePath += "index.html"
    }

    let fileExists

    try {
      await fs.stat(filePath)
      fileExists = true
    } catch (_error) { // eslint-disable-line no-unused-vars
      fileExists = false
    }

    if (!fileExists) {
      filePath = `${process.cwd()}/dist/index.html`
    }

    const fileContent = await fs.readFile(filePath)
    const mimeType = mime.getType(filePath)

    response.statusCode = 200

    if (mimeType) {
      response.setHeader("Content-Type", mimeType)
    }

    response.end(fileContent)
  }

  /** @returns {Promise<void>} */
  async start() {
    this.debugLog(`Starting HTTP server on ${this._host}:${this._port}`)
    await this.startHttpServer()
    this.debugLog(`HTTP server started on ${this._host}:${this._port}`)
  }

  /** @returns {Promise<void>} */
  startHttpServer() {
    return new Promise((resolve, reject) => {
      this.httpServer = http.createServer(this.onHttpServerRequest)
      this.httpServer.on("connection", (connection) => {
        this._connections.add(connection)
        connection.on("close", () => {
          this._connections.delete(connection)
        })
      })
      this.httpServer.on("error", (error) => {
        this.debugLog(`HTTP server error: ${error instanceof Error ? error.message : String(error)}`)
        reject(error)
      })
      this.httpServer.listen(this._port, this._host, () => resolve())
    })
  }
}
