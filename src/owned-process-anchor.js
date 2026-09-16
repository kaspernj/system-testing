import {spawn} from "node:child_process"

/**
 * @param {unknown} error
 * @returns {{message: string, name?: string, code?: string | number}}
 */
function serializeError(error) {
  if (!(error instanceof Error)) return {message: String(error)}

  return {
    code: "code" in error && (typeof error.code === "string" || typeof error.code === "number") ? error.code : undefined,
    message: error.message,
    name: error.name
  }
}

/**
 * @param {Record<string, unknown>} message
 * @param {(error?: Error | null) => void} [callback]
 */
function send(message, callback = () => {}) {
  if (!process.send || !process.connected) {
    callback(new Error("Owned process parent IPC is unavailable"))
    return
  }

  process.send(message, callback)
}

/** @param {number} code */
function closeAnchor(code) {
  releasing = true
  if (process.connected) process.disconnect?.()
  process.exit(code)
}

/** @type {import("node:child_process").ChildProcess | undefined} */
let target
let targetClosed = false
let targetSpawned = false
let releasing = false

process.on("SIGTERM", () => {})
process.on("disconnect", () => {
  if (releasing) return

  // This live group leader anchors the numeric identity until this exact syscall.
  process.kill(-process.pid, "SIGKILL")
})
process.on("message", (message) => {
  if (!message || typeof message !== "object" || !("type" in message)) return

  if (message.type === "start") {
    if (target) {
      send({error: serializeError(new Error("Owned process target already started")), type: "target-error"})
      return
    }
    if (!("command" in message) || typeof message.command !== "string" || !("args" in message) || !Array.isArray(message.args)) {
      send({error: serializeError(new Error("Owned process anchor received invalid spawn arguments")), type: "target-error"}, () => closeAnchor(1))
      return
    }

    target = spawn(message.command, message.args, {stdio: ["ignore", "inherit", "inherit"]})
    target.once("spawn", () => {
      targetSpawned = true
      send({pid: target?.pid, type: "target-spawned"})
    })
    target.on("error", (error) => {
      send({error: serializeError(error), type: "target-error"}, () => {
        if (!targetSpawned) closeAnchor(1)
      })
    })
    target.once("close", (code, signal) => {
      targetClosed = true
      if (targetSpawned) send({code, signal, type: "target-closed"})
    })
    return
  }

  if (message.type === "release") {
    if (!target || targetClosed) closeAnchor(0)
    return
  }

  if (message.type !== "signal" || !("requestId" in message) || typeof message.requestId !== "string" || !("signal" in message)) return
  if (message.signal !== "SIGTERM" && message.signal !== "SIGKILL") return

  if (message.signal === "SIGKILL") {
    send({requestId: message.requestId, type: "signal-result"}, (error) => {
      if (error) return

      process.kill(-process.pid, "SIGKILL")
    })
    return
  }

  try {
    process.kill(-process.pid, message.signal)
    send({requestId: message.requestId, type: "signal-result"})
  } catch (error) {
    send({error: serializeError(error), requestId: message.requestId, type: "signal-result"})
  }
})
