import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import wait from "awaitery/build/wait.js"
import {WebSocket} from "ws"

import {browserDaemonStopTimeoutMs, browserDaemonVerifyTimeoutMs} from "./browser-daemon-constants.js"

const registryPath = path.join(os.tmpdir(), "system-testing-browser-registry.json")

/** Browser process registry. */
export default class BrowserRegistry {
  /** @returns {string} */
  static getRegistryPath() {
    return registryPath
  }

  /** @returns {Promise<Array<Record<string, any>>>} */
  static async list() {
    const entries = await this._readRegistry()
    const aliveEntries = []
    let dirty = false

    for (const entry of entries) {
      if (this.isProcessAlive(entry.pid)) {
        aliveEntries.push(entry)
      } else {
        dirty = true
      }
    }

    if (dirty) {
      await this._writeRegistry(aliveEntries)
    }

    return aliveEntries
  }

  /**
   * @param {Record<string, any>} entry
   * @returns {Promise<void>}
   */
  static async register(entry) {
    const entries = await this.list()
    const filteredEntries = entries.filter((existingEntry) => existingEntry.name !== entry.name)

    filteredEntries.push(entry)
    await this._writeRegistry(filteredEntries)
  }

  /**
   * @param {string} name
   * @returns {Promise<void>}
   */
  static async unregister(name) {
    const entries = await this.list()
    const filteredEntries = entries.filter((entry) => entry.name !== name)

    await this._writeRegistry(filteredEntries)
  }

  /**
   * @param {string} [name]
   * @returns {Promise<Record<string, any>>}
   */
  static async resolve(name) {
    const entries = await this.list()

    if (name) {
      const entry = entries.find((candidate) => candidate.name === name)

      if (!entry) {
        throw new Error(`No running browser process found with name: ${name}`)
      }

      return entry
    }

    if (entries.length === 1) {
      return entries[0]
    }

    if (entries.length === 0) {
      throw new Error("No running browser processes found")
    }

    throw new Error(`Multiple browser processes are running (${entries.length}); pass --name`)
  }

  /**
   * @param {string} [name]
   * @returns {Promise<Record<string, any>>}
   */
  static async stop(name) {
    const entry = await this.resolve(name)

    if (!(await this.verifyEntry(entry))) {
      await this.unregister(entry.name)
      throw new Error(`Browser registry entry ${entry.name} no longer matches a running browser daemon`)
    }

    try {
      process.kill(entry.pid, "SIGTERM")
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ESRCH") {
        await this.unregister(entry.name)
        return entry
      }

      throw error
    }

    for (let attemptNumber = 1; attemptNumber <= browserDaemonStopTimeoutMs / 50; attemptNumber += 1) {
      if (!this.isProcessAlive(entry.pid)) {
        await this.unregister(entry.name)
        return entry
      }

      await wait(50)
    }

    throw new Error(`Timed out waiting for browser process ${entry.name} (${entry.pid}) to stop`)
  }

  /**
   * @param {Record<string, any>} entry
   * @returns {Promise<boolean>}
   */
  static async verifyEntry(entry) {
    if (typeof entry.port !== "number" || entry.port <= 0) {
      return false
    }

    const ws = new WebSocket(`ws://127.0.0.1:${entry.port}`)

    return await new Promise((resolve) => {
      let settled = false

      const finish = (/** @type {any} */ result) => {
        if (settled) {
          return
        }

        settled = true
        clearTimeout(timeoutId)

        try {
          ws.close()
        } catch {
          // Ignore close errors while validating a registry entry.
        }

        resolve(result)
      }

      const timeoutId = setTimeout(() => {
        finish(false)
      }, browserDaemonVerifyTimeoutMs)

      ws.on("open", () => {
        ws.send(JSON.stringify({command: "describe", type: "browser-daemon"}))
      })

      ws.on("message", (rawData) => {
        try {
          const response = JSON.parse(rawData.toString())
          const result = response?.result

          finish(
            response?.ok === true
            && result?.name === entry.name
            && result?.pid === entry.pid
            && result?.port === entry.port
          )
        } catch {
          finish(false)
        }
      })

      ws.on("error", () => {
        finish(false)
      })
    })
  }

  /**
   * @param {number} pid
   * @returns {boolean}
   */
  static isProcessAlive(pid) {
    if (!pid || typeof pid !== "number") {
      return false
    }

    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }

  /** @returns {Promise<Array<Record<string, any>>>} */
  static async _readRegistry() {
    try {
      const fileContent = await fs.readFile(this.getRegistryPath(), "utf8")
      const parsed = JSON.parse(fileContent)

      if (!Array.isArray(parsed)) {
        return []
      }

      return parsed
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return []
      }

      throw error
    }
  }

  /**
   * @param {Array<Record<string, any>>} entries
   * @returns {Promise<void>}
   */
  static async _writeRegistry(entries) {
    await fs.writeFile(this.getRegistryPath(), JSON.stringify(entries, null, 2))
  }
}
