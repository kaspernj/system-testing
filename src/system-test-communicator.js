// @ts-check

export default class SystemTestCommunicator {
  /** @type {Record<string, {resolve: (data: any) => void, reject: (data: any) => void}>} */
  _responses = {}

  /** @type {Record<string, any>} */
  _sendQueue = []

  _sendQueueCount = 0

  /** @type {WebSocket | null} */
  ws = null

  /**
   * @param {object} args
   * @param {(args: Record<string, any>) => Promise<{result: string} | void>} args.onCommand
   * @param {object} [args.parent]
   */
  constructor({onCommand, parent}) {
    this.onCommand = onCommand
    this.parent = parent
  }

  flushSendQueue() {
    while (this._sendQueue.length !== 0) {
      const data = this._sendQueue.shift()

      if (!this.ws || this.ws.readyState !== 1) {
        throw new Error("WebSocket is not open")
      }

      this.ws.send(JSON.stringify(data))
    }
  }

  /** @param {Error} error */
  onError = (error) => {
    console.error("onWebSocketClientError", error)
  }

  /** @param {string} rawData */
  onMessage = async (rawData) => {
    /** @type {{data: any, id: number, type: string, isTrusted?: boolean}} */
    const data = JSON.parse(rawData)

    if (data.isTrusted) {
      // Ignore
    } else if (data.type == "command") {
      try {
        const result = await this.onCommand({data: data.data})

        this.respond(data.id, {result})
      } catch (error) {
        if (error instanceof Error) {
          this.respond(data.id, {error: error.message})
        } else {
          this.respond(data.id, {error: error})
        }
      }
    } else if (data.type == "response") {
      const response = this._responses[data.id]

      if (!response) {
        throw new Error(`No such response: ${data.id}`)
      }

      delete this._responses[data.id]

      if (data.data.error) {
        response.reject(data.data.error)
      } else {
        response.resolve(data.data.result)
      }
    } else {
      throw new Error(`Unknown type for SystemTestCommunicator: ${data.type}: ${JSON.stringify(data)}`)
    }
  }

  onOpen = () => {
    this.flushSendQueue()
  }

  /**
   * @param {Record<string, any>} data
   * @returns {void}
   */
  send(data) {
    this._sendQueue.push(data)

    if (this.ws?.readyState == 1) {
      this.flushSendQueue()
    }
  }

  /**
   * Sends a command and returns a promise that resolves with the response.
   * @param {Record<string, any>} data - The command data to send.
   * @returns {Promise<void>} A promise that resolves with the response data.
   */
  sendCommand(data) {
    return new Promise((resolve, reject) => {
      const id = this._sendQueueCount

      this._sendQueueCount += 1
      this._responses[id] = {resolve, reject}

      this.send({type: "command", id, data})
    })
  }

  /**
   * @param {number} id
   * @param {Record<string, any>} data
   * @returns {void}
   */
  respond(id, data) {
    this.send({type: "response", id, data})
  }
}
