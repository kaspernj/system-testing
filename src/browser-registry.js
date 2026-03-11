import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

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
