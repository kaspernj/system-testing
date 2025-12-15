// @ts-check

import fs from "node:fs/promises"
import http from "node:http"
import mime from "mime"
import url from "url"

export default class SystemTestHttpServer {
  /** @returns {void} */
  close() {
    if (!this.httpServer) {
      throw new Error("HTTP server is not initialized")
    }

    this.httpServer.close()
  }

  /**
   * @param {http.IncomingMessage} request
   * @param {http.ServerResponse} response
   * @returns {Promise<void>}
   */
  onHttpServerRequest = async (request, response) => {
    if (!request.url) {
      console.log("No URL! Answering bad request!")

      response.statusCode = 400
      response.end("Bad Request")
      return
    }

    const parsedUrl = url.parse(request.url)
    let filePath = `${process.cwd()}/dist${parsedUrl.pathname}`

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
    this.basePath = await fs.realpath(`${__dirname}/../..`)
    await this.startHttpServer()
  }

  /** @returns {Promise<void>} */
  startHttpServer() {
    return new Promise((resolve) => {
      this.httpServer = http.createServer(this.onHttpServerRequest)
      this.httpServer.listen(1984, "localhost", () => {
        resolve()
      })
    })
  }
}
