// @ts-check

import {WebDriver} from "selenium-webdriver"

/**
 * @typedef {object} CommandRecord
 * @property {number} sequence Local command sequence.
 * @property {string} name Selenium command name; parameters are never retained.
 * @property {number} issuedAt Wall-clock issue time.
 * @property {number} remainingMs Budget at issue.
 * @property {"pending" | "fulfilled" | "rejected"} status Settlement state.
 * @property {number} [settledAt] Wall-clock settlement time, including late settlement.
 */

/** Owns one deadline and a payload-free view of commands sent to an existing session. */
export default class WebDriverCommandOperation {
  /**
   * @param {object} args Operation ownership.
   * @param {import("./webdriver-driver.js").default} args.adapter Session owner.
   * @param {string} args.name Logical operation name, never a command payload.
   * @param {number} args.timeout Deadline budget in milliseconds.
   * @param {string} args.errorMessage Assertion deadline message.
   * @param {boolean} [args.callbackOwnsTimeout] Existing finder owns its bounded cleanup/outcome.
   */
  constructor({adapter, name, timeout, errorMessage, callbackOwnsTimeout = false}) {
    this.adapter = adapter
    this.name = name
    this.callbackOwnsTimeout = callbackOwnsTimeout
    this.startedAt = Date.now()
    this.deadline = this.startedAt + timeout
    this.error = new Error(errorMessage)
    this.originStack = new Error("WebDriver operation origin").stack?.slice(0, 8192)
    this.session = adapter.sessionCorrelation
    this.sequence = 0
    this.active = true
    this.expired = false
    /** @type {CommandRecord[]} */
    this.commands = []
    /** @type {Set<CommandRecord>} */
    this.pending = new Set()
    /** @type {number | undefined} */
    this.implicitTimeoutChangeId = undefined
    /** @type {Promise<void> | undefined} */
    this.cleanupPromise = undefined
    const source = adapter.getWebDriver()
    this.executor = source.getExecutor()
    // A session view uses Selenium's public constructor/executor contract. It neither
    // creates a session nor replaces the original driver's service/quit ownership.
    this.webDriver = new WebDriver(source.getSession(), {execute: (command) => this.execute(command)})
  }

  /**
   * @param {number} [observedAt] Time sampled at the dispatch boundary.
   * @returns {void}
   */
  assertActive(observedAt = Date.now()) {
    if (this.session !== this.adapter.sessionCorrelation) this.active = false
    if (this.implicitTimeoutChangeId !== undefined && this.implicitTimeoutChangeId !== this.adapter._implicitTimeoutChangeId) this.active = false
    if (this.active && observedAt >= this.deadline) this.expire()
    if (!this.active) throw this.error
    this.adapter.assertSessionUsable()
  }

  /** @returns {void} */
  expire() {
    if (!this.active) return
    this.active = false
    this.expired = true
    // A pending callback alone is not evidence of an outstanding wire command.
    if (this.pending.size && this.session === this.adapter.sessionCorrelation) this.adapter.markSessionUnusable(this.error)
  }

  /**
   * @param {import("selenium-webdriver/lib/command.js").Command} command Fully resolved Selenium command.
   * @returns {Promise<unknown>}
   */
  async execute(command) {
    this.assertActive()
    const name = command.getName()
    const issuedAt = Date.now()
    // Recheck after preparation, before registering any pending wire work. Use
    // this same clock sample for both dispatch ownership and its evidence.
    this.assertActive(issuedAt)
    /** @type {CommandRecord} */
    const record = {
      sequence: ++this.sequence,
      name,
      issuedAt,
      remainingMs: this.deadline - issuedAt,
      status: "pending"
    }
    this.commands.push(record)
    if (this.commands.length > 32) this.commands.shift()
    this.pending.add(record)
    try {
      const value = await this.executor.execute(command)
      record.status = "fulfilled"
      return value
    } catch (error) {
      record.status = "rejected"
      throw error
    } finally {
      record.settledAt = Date.now()
      this.pending.delete(record)
      if (!this.active) this.report("late-settlement")
    }
  }

  /**
   * Restores only the implicit wait under the existing cleanup budget. The
   * cleanup driver never escapes to an application callback or retained element.
   * @param {number} implicitTimeout Original implicit wait.
   * @param {number} timeoutChangeId Owner of the temporary change.
   * @param {{timeout: number, errorMessage: string}} args Existing cleanup bound.
   * @returns {Promise<void>}
   */
  async restoreImplicitTimeout(implicitTimeout, timeoutChangeId, args) {
    if (this.session !== this.adapter.sessionCorrelation || timeoutChangeId !== this.adapter._implicitTimeoutChangeId) return
    if (this.pending.size) this.adapter.markSessionUnusable(this.error)
    this.adapter.assertSessionUsable()

    // Only this fixed restoration command may leave the application's expired
    // context. It has its own executor guard, deadline and settlement evidence.
    const cleanup = this.adapter.commandOperationStorage.exit(() => new WebDriverCommandOperation({
      adapter: this.adapter, name: `${this.name}:implicit-timeout-restoration`, ...args
    }))
    cleanup.implicitTimeoutChangeId = timeoutChangeId
    this.cleanupPromise = this.adapter.commandOperationStorage.run(cleanup, async () => {
      try {
        await cleanup.run(async () => {
          await this.adapter.getWebDriver().manage().setTimeouts({implicit: implicitTimeout})
        })
      } catch (error) {
        if (error instanceof Error && this.session === this.adapter.sessionCorrelation && timeoutChangeId === this.adapter._implicitTimeoutChangeId) {
          this.adapter.markSessionUnusable(error)
        }
        throw error
      }
    })
    await this.cleanupPromise
  }

  /**
   * @template T
   * @param {() => Promise<T>} callback Operation body.
   * @returns {Promise<T>}
   */
  async run(callback) {
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timer
    try {
      if (this.callbackOwnsTimeout) {
        const result = await callback()
        // The finder owns its cleanup budget, but a restore that quarantined the
        // session cannot be reported as a successful operation.
        this.adapter.assertSessionUsable()
        return result
      }
      // This races ownership, not cancellation: execute() keeps observing commands
      // already issued, and every later executor invocation checks ownership again.
      return await new Promise((resolve, reject) => {
        const onDeadline = () => {
          const remaining = this.deadline - Date.now()
          if (remaining > 0) {
            timer = setTimeout(onDeadline, remaining)
            return
          }
          this.expire()
          reject(this.error)
        }
        timer = setTimeout(onDeadline, Math.max(0, this.deadline - Date.now()))
        Promise.resolve().then(callback).then((value) => {
          this.assertActive()
          resolve(value)
        }).catch(reject)
      })
    } catch (error) {
      this.active = false
      this.error = error instanceof Error ? error : new Error("WebDriver operation failed", {cause: error})
      if (this.cleanupPromise) {
        try {
          await this.cleanupPromise
        } catch (cleanupError) {
          if (cleanupError !== error) console.error("[WebDriver implicit timeout restoration failed]", cleanupError)
        }
      }
      // A nested finder can end before this outer deadline while its command is
      // still pending. Ending ownership cannot make that command safe to reuse.
      if ((this.pending.size || this.adapter.isSessionUnusable()) && this.session === this.adapter.sessionCorrelation) this.adapter.markSessionUnusable(this.error)
      this.report(this.expired ? "deadline" : "failure")
      throw error
    } finally {
      clearTimeout(timer)
      this.active = false
    }
  }

  /**
   * @param {"deadline" | "failure" | "late-settlement"} phase Diagnostic event.
   * @returns {void}
   */
  report(phase) {
    console.error("[WebDriver operation]", JSON.stringify({
      phase,
      session: this.session,
      operation: this.name,
      originStack: this.originStack,
      startedAt: this.startedAt,
      deadline: this.deadline,
      observedAt: Date.now(),
      expired: this.expired,
      terminal: this.adapter.isSessionUnusable(),
      pendingCount: this.pending.size,
      pendingCommands: [...this.pending].slice(-32).map((command) => command.sequence),
      commands: this.commands
    }))
  }
}
