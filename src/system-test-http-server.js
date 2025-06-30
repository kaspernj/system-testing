import fs from "node:fs/promises"
import http from "node:http"
import mime from "mime"
import url from "url"

export default class SystemTestHttpServer {
  close() {
    this.httpServer.close()
  }

  onHttpServerRequest = async (request, response) => {
    const parsedUrl = url.parse(request.url)
    let filePath = `${this.basePath}/dist${parsedUrl.pathname}`

    if (filePath.endsWith("/")) {
      filePath += "index.html"
    }

    let fileExists

    try {
      await fs.stat(filePath)
      fileExists = true
    } catch (_error) {
      fileExists = false
    }

    if (!fileExists) {
      filePath = `${this.basePath}/dist/index.html`
    }

    const fileContent = await fs.readFile(filePath)
    const mimeType = mime.lookup(filePath)

    response.statusCode = 200
    response.setHeader("Content-Type", mimeType)
    response.end(fileContent)
  }

  async start() {
    this.basePath = await fs.realpath(`${__dirname}/../..`) // eslint-disable-line no-undef

    await this.startHttpServer()
  }

  startHttpServer() {
    return new Promise((resolve) => {
      this.httpServer = http.createServer(this.onHttpServerRequest)
      this.httpServer.listen(1984, "localhost", () => {
        resolve()
      })
    })
  }
}
