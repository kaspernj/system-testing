// @ts-check

import fs from "node:fs/promises"
import http from "node:http"
import mime from "mime"

export default class SystemTestHttpServer {
  /**
   * @param {{host?: string, port?: number, debug?: boolean, onError?: (error: Error) => void, connectHost?: string}} [args]
   */
  constructor({host = "localhost", port = 1984, debug = false, onError, connectHost} = {}) {
    this._host = host
    this._port = port
    this._debug = debug
    this._onError = onError
    this._started = false
    this._connectHost = connectHost ?? (host === "0.0.0.0" ? "127.0.0.1" : host)
    /** @type {Set<import("node:net").Socket>} */
    this._connections = new Set()
  }

  /** @param {any[]} args */
  debugError(...args) {
    console.log("[SystemTestHttpServer]", ...args)
  }

  /** @param {any[]} args */
  debugLog(...args) {
    if (this._debug) {
      console.log("[SystemTestHttpServer]", ...args)
    }
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
        if (error) {
          reject(error)
        } else {
          this._started = false
          resolve()
        }
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

    let fileContent

    try {
      fileContent = await fs.readFile(filePath)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)

      this.debugError(`HTTP server read failed: ${errorMessage}`)
      response.statusCode = 500
      response.end("Internal Server Error")
      return
    }

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
        const errorMessage = error instanceof Error ? error.message : String(error)

        this.debugError(`HTTP server error: ${errorMessage}`)

        if (this._started) {
          if (this._onError) {
            this._onError(error instanceof Error ? error : new Error(errorMessage))
          }
        } else {
          reject(error)
        }
      })
      this.httpServer.listen(this._port, this._host, () => {
        this._started = true
        resolve()
      })
    })
  }

  /**
   * @param {{timeoutMs?: number}} [args]
   * @returns {Promise<void>}
   */
  async assertReachable({timeoutMs = 5000} = {}) {
    const url = `http://${this._connectHost}:${this._port}/`
    const maxAttempts = 3

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await new Promise((resolve, reject) => {
          const request = http.get(url, (response) => {
            const chunks = []

            response.on("data", (chunk) => chunks.push(chunk))
            response.on("end", () => {
              const body = Buffer.concat(chunks).toString("utf8")

              if (response.statusCode !== 200) {
                reject(new Error(`HTTP server health check failed with status ${response.statusCode} for ${url}: ${body.slice(0, 200)}`))
                return
              }

              resolve(undefined)
            })
          })

          request.on("error", (error) => reject(error))

          request.setTimeout(timeoutMs, () => {
            request.destroy(new Error(`HTTP server health check timed out after ${timeoutMs}ms for ${url}`))
          })
        })

        return
      } catch (error) {
        if (attempt === maxAttempts || !this.isRetryableHealthCheckError(error)) {
          throw error
        }

        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }
  }

  /**
   * @param {unknown} error
   * @returns {boolean}
   */
  isRetryableHealthCheckError(error) {
    if (error && typeof error === "object" && "code" in error) {
      if (error.code === "ECONNRESET") return true
      if (error.code === "ECONNREFUSED") return true
      if (error.code === "ETIMEDOUT") return true
    }

    const message = error instanceof Error ? error.message : String(error)

    return message.includes("socket hang up")
  }
}
