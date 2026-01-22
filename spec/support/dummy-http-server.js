// @ts-check

import fs from "node:fs/promises"
import path from "node:path"
import {fileURLToPath} from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * Ensures the dummy app's dist folder is served for system tests.
 */
export default class DummyHttpServerEnvironment {
  constructor({host = "dist"} = {}) {
    this.host = host
    this.dummyAppRoot = path.resolve(__dirname, "..", "dummy")
    /** @type {string | undefined} */
    this.originalCwd = undefined
    this.started = false
  }

  /** @returns {Promise<void>} */
  async start() {
    if (this.started) return

    this.originalCwd = process.cwd()
    const resolvedHost = process.env.SYSTEM_TEST_HOST ?? this.host
    process.env.SYSTEM_TEST_HOST ||= resolvedHost

    if (resolvedHost === "dist") {
      await this.ensureDistFolder()
      process.chdir(this.dummyAppRoot)
    }
    this.started = true
  }

  /** @returns {Promise<void>} */
  async stop() {
    if (!this.started) return
    if (this.originalCwd) process.chdir(this.originalCwd)
    this.started = false
  }

  /** @returns {Promise<void>} */
  async ensureDistFolder() {
    const distPath = path.join(this.dummyAppRoot, "dist")

    try {
      const stats = await fs.stat(distPath)
      if (!stats.isDirectory()) {
        throw new Error(`Expected dist path to be a directory: ${distPath}`)
      }
    } catch (error) {
      throw new Error(`Missing dist folder for dummy app at ${distPath}: ${error instanceof Error ? error.message : error}`)
    }
  }
}
