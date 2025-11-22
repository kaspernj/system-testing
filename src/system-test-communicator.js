export default class SystemTestCommunicator {
  constructor({onCommand, parent}) {
    this.onCommand = onCommand
    this.parent = parent
    this._sendQueueCount = 0
    this._sendQueue = []
    this._responses = {}
  }

  flushSendQueue() {
    while (this._sendQueue.length !== 0) {
      const data = this._sendQueue.shift()

      this.ws.send(JSON.stringify(data))
    }
  }

  onError = (error) => {
    console.error("onWebSocketClientError", error)
  }

  onMessage = async (rawData) => {
    const data = JSON.parse(rawData)

    if (data.isTrusted) {
      // Ignore
    } else if (data.type == "command") {
      try {
        const result = await this.onCommand({data: data.data})

        this.respond(data.id, {result})
      } catch (error) {
        this.respond(data.id, {error: error.message})
      }
    } else if (data.type == "response") {
      const response = this._responses[data.id]

      if (!response) {
        throw new Error(`No such response: ${data.id}`)
      }

      delete this._responses[data.id]

      if (data.data.error) {
        response.error(data.data.error)
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

  send(data) {
    this._sendQueue.push(data)

    if (this.ws?.readyState == 1) {
      this.flushSendQueue()
    }
  }

  /**
   * Sends a command and returns a promise that resolves with the response.
   *
   * @param {Object} data - The command data to send.
   * @returns {Promise} A promise that resolves with the response data.
   */
  sendCommand(data) {
    return new Promise((resolve, error) => {
      const id = this._sendQueueCount

      this._sendQueueCount += 1
      this._responses[id] = {resolve, error}
      this.send({type: "command", id, data})
    })
  }

  respond(id, data) {
    this.send({type: "response", id, data})
  }
}
