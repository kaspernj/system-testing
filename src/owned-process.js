import {execFile, spawn as spawnChild} from "node:child_process"
import {randomUUID} from "node:crypto"
import {setTimeout as wait} from "node:timers/promises"
import {promisify} from "node:util"

/**
 * @typedef {object} OwnedProcessControl
 * @property {string} platform Platform on which process ownership is implemented.
 * @property {(command: string, args: string[], options: import("node:child_process").SpawnOptions) => import("node:child_process").ChildProcess} spawn Spawns the direct child.
 * @property {(processGroupId: number) => Promise<number[]>} listProcessGroupPids Lists exact non-zombie process-group members.
 * @property {(identity: OwnedProcessIdentity, signal: OwnedProcessStopSignal) => Promise<boolean> | boolean} signalProcessGroupIfOwned Atomically verifies the generation and signals its exact process group, returning false on an identity mismatch.
 * @property {(milliseconds: number) => Promise<void>} wait Waits between ownership checks.
 * @property {() => number} now Reads a monotonic clock.
 */

/**
 * @typedef {object} OwnedProcessSpawnOptions
 * @property {string | URL} [cwd] Working directory for the child.
 * @property {typeof process.env} [env] Environment for the child.
 * @property {import("node:child_process").IOType | import("node:stream").Stream | number | null} [stdout] Child stdout destination.
 * @property {import("node:child_process").IOType | import("node:stream").Stream | number | null} [stderr] Child stderr destination.
 * @property {number} [killGraceMs] Milliseconds to wait after SIGTERM.
 * @property {number} [forceKillWaitMs] Milliseconds to wait after SIGKILL.
 * @property {number} [pollIntervalMs] Milliseconds between owned-scope checks.
 * @property {OwnedProcessControl} [processControl] Process-control adapter, primarily for deterministic tests.
 */

/** @typedef {Readonly<{pid: number, processGroupId: number, token: string}>} OwnedProcessIdentity */
/** @typedef {"SIGTERM" | "SIGKILL"} OwnedProcessStopSignal */
/** @typedef {{code: number | null, signal: string | null, error?: Error}} OwnedProcessCloseResult */
/** @typedef {{directChildClosed: boolean, survivingPids: number[]}} OwnedProcessTerminationStatus */

const execFileAsync = promisify(execFile)
const ownedProcessAnchorUrl = new URL("owned-process-anchor.js", import.meta.url)
const SUPPORTED_PLATFORMS = new Set(["aix", "darwin", "freebsd", "linux", "openbsd", "sunos"])

/**
 * @param {number} value
 * @param {string} name
 * @returns {number}
 */
function validateDuration(value, name) {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name} must be a non-negative finite number`)

  return value
}

/**
 * @param {number} processGroupId
 * @returns {Promise<number[]>}
 */
async function listProcessGroupPids(processGroupId) {
  const {stdout} = await execFileAsync("ps", ["-A", "-o", "pid=,pgid=,stat="], {encoding: "utf8"})
  const pids = []

  for (const line of stdout.split("\n")) {
    const [pidValue, processGroupIdValue, stateValue] = line.trim().split(/\s+/)
    if (!pidValue || !processGroupIdValue || Number(processGroupIdValue) !== processGroupId || stateValue?.startsWith("Z")) continue

    pids.push(Number(pidValue))
  }

  return pids.sort((firstPid, secondPid) => firstPid - secondPid)
}

/** @type {OwnedProcessControl} */
const defaultProcessControl = {
  listProcessGroupPids,
  now: () => performance.now(),
  platform: process.platform,
  signalProcessGroupIfOwned: () => {
    throw new Error("Default owned process groups must be signalled through their anchor")
  },
  spawn: spawnChild,
  wait: async (milliseconds) => await wait(milliseconds)
}

/**
 * @param {{message?: string, name?: string, code?: string | number}} serializedError
 * @returns {Error}
 */
function deserializeError(serializedError) {
  const error = new Error(serializedError.message ?? "Owned process anchor failed")
  if (serializedError.name) error.name = serializedError.name
  if (serializedError.code !== undefined) Object.assign(error, {code: serializedError.code})

  return error
}

export class OwnedProcessUnsupportedPlatformError extends Error {
  /** @param {string} platform */
  constructor(platform) {
    super(`Owned process groups cannot be proven terminated on platform: ${platform}`)
    this.name = "OwnedProcessUnsupportedPlatformError"
    this.platform = platform
  }
}

export class OwnedProcessInspectionError extends Error {
  /**
   * @param {OwnedProcessIdentity} identity
   * @param {unknown} cause
   */
  constructor(identity, cause) {
    super(`Could not inspect owned process group ${identity.processGroupId}`, {cause})
    this.name = "OwnedProcessInspectionError"
    this.identity = identity
  }
}

export class OwnedProcessTerminationError extends Error {
  /**
   * @param {OwnedProcessIdentity} identity
   * @param {number[]} survivingPids
   * @param {boolean} directChildClosed
   * @param {unknown} [cause]
   */
  constructor(identity, survivingPids, directChildClosed, cause) {
    let message = `Owned process group ${identity.processGroupId} still has surviving PIDs: ${survivingPids.join(", ") || "none"}`
    if (!directChildClosed) message += "; direct child close was not observed"
    super(message, {cause})
    this.name = "OwnedProcessTerminationError"
    this.directChildClosed = directChildClosed
    this.identity = identity
    this.survivingPids = survivingPids
  }
}

export default class OwnedProcess {
  /**
   * @param {string} command
   * @param {string[]} args
   * @param {OwnedProcessSpawnOptions} [options]
   * @returns {Promise<OwnedProcess>}
   */
  static async spawn(command, args, options = {}) {
    const processControl = options.processControl ?? defaultProcessControl
    if (!SUPPORTED_PLATFORMS.has(processControl.platform)) {
      throw new OwnedProcessUnsupportedPlatformError(processControl.platform)
    }
    const killGraceMs = validateDuration(options.killGraceMs ?? 1000, "killGraceMs")
    const forceKillWaitMs = validateDuration(options.forceKillWaitMs ?? 1000, "forceKillWaitMs")
    const pollIntervalMs = validateDuration(options.pollIntervalMs ?? 10, "pollIntervalMs")
    if (pollIntervalMs === 0) throw new RangeError("pollIntervalMs must be greater than zero")

    let stdout = options.stdout
    if (stdout === undefined) stdout = "inherit"
    let stderr = options.stderr
    if (stderr === undefined) stderr = "inherit"
    const anchored = processControl === defaultProcessControl
    /** @type {import("node:child_process").SpawnOptions} */
    const spawnOptions = {
      cwd: options.cwd,
      detached: true,
      env: options.env,
      stdio: anchored ? ["ignore", stdout, stderr, "ipc"] : ["ignore", stdout, stderr]
    }
    const child = processControl.spawn(
      anchored ? process.execPath : command,
      anchored ? [ownedProcessAnchorUrl.pathname] : args,
      spawnOptions
    )

    const ownedProcess = await new Promise((resolve, reject) => {
      const cleanupSpawnListeners = () => {
        child.off("error", onSpawnError)
        child.off("spawn", onSpawn)
      }
      const onSpawnError = (/** @type {Error} */ error) => {
        cleanupSpawnListeners()
        reject(error)
      }
      const onSpawn = () => {
        cleanupSpawnListeners()
        if (!child.pid) {
          reject(new Error("Owned process spawned without a PID"))
          return
        }

        resolve(new OwnedProcess({anchored, child, forceKillWaitMs, killGraceMs, pollIntervalMs, processControl}))
      }

      child.once("error", onSpawnError)
      child.once("spawn", onSpawn)
    })
    if (!(ownedProcess instanceof OwnedProcess)) throw new Error("Owned process spawn returned an invalid owner")
    if (anchored) await ownedProcess._startAnchoredTarget(command, args)

    return ownedProcess
  }

  /**
   * @param {{
   *   anchored: boolean,
   *   child: import("node:child_process").ChildProcess,
   *   forceKillWaitMs: number,
   *   killGraceMs: number,
   *   pollIntervalMs: number,
   *   processControl: OwnedProcessControl
   * }} args
   */
  constructor({anchored, child, forceKillWaitMs, killGraceMs, pollIntervalMs, processControl}) {
    if (!child.pid) throw new Error("Owned process requires a PID")

    this.identity = Object.freeze({pid: child.pid, processGroupId: child.pid, token: randomUUID()})
    this.stdout = child.stdout
    this.stderr = child.stderr
    this._child = child
    this._processControl = processControl
    this._killGraceMs = killGraceMs
    this._forceKillWaitMs = forceKillWaitMs
    this._pollIntervalMs = pollIntervalMs
    this._anchored = anchored
    this._anchorPid = child.pid

    /** @type {(result: OwnedProcessCloseResult) => void} */
    let resolveClosed = () => {}
    this.closed = new Promise((resolve) => {
      resolveClosed = resolve
    })
    this._resolveClosed = resolveClosed
    this._onClose = (code, signal) => {
      if (this._anchored) {
        this._recordAnchorClose(code, signal)
      } else {
        this._recordClose(code, signal)
      }
    }
    this._onError = (error) => {
      this._processError = error
    }
    this._onMessage = (message) => this._handleAnchorMessage(message)
    child.once("close", this._onClose)
    child.on("error", this._onError)
    if (this._anchored) child.on("message", this._onMessage)
  }

  /**
   * @param {string} command
   * @param {string[]} args
   * @returns {Promise<void>}
   */
  async _startAnchoredTarget(command, args) {
    /** @type {Promise<void>} */
    const targetSpawned = new Promise((resolve, reject) => {
      this._resolveTargetSpawn = () => resolve()
      this._rejectTargetSpawn = reject
    })
    await this._sendAnchorMessage({args, command, type: "start"})
    await targetSpawned
  }

  /** @returns {Promise<void>} */
  stop() {
    if (this._terminated) return Promise.resolve()
    if (this._stopPromise) return this._stopPromise

    const stopPromise = this._stopOwnedScope()
    this._stopPromise = stopPromise
    void stopPromise.then(
      () => this._clearStopPromise(stopPromise),
      () => this._clearStopPromise(stopPromise)
    )

    return stopPromise
  }

  /** @returns {Promise<void>} */
  async _stopOwnedScope() {
    let terminationStatus = await this._terminationStatus()
    if (this._isTerminated(terminationStatus)) {
      await this._completeTermination()
      return
    }

    if (this._forceKillSent) {
      terminationStatus = await this._waitForTermination(this._forceKillWaitMs)
      if (!this._isTerminated(terminationStatus)) {
        throw new OwnedProcessTerminationError(
          this.identity,
          terminationStatus.survivingPids,
          terminationStatus.directChildClosed
        )
      }

      await this._completeTermination()
      return
    }

    await this._signal("SIGTERM", terminationStatus.survivingPids)
    terminationStatus = await this._waitForTermination(this._killGraceMs)
    if (this._isTerminated(terminationStatus)) {
      await this._completeTermination()
      return
    }

    this._forceKillRequested = true
    try {
      await this._signal("SIGKILL", terminationStatus.survivingPids)
      this._forceKillSent = true
    } catch (error) {
      this._forceKillRequested = false
      throw error
    }
    terminationStatus = await this._waitForTermination(this._forceKillWaitMs)
    if (!this._isTerminated(terminationStatus)) {
      throw new OwnedProcessTerminationError(
        this.identity,
        terminationStatus.survivingPids,
        terminationStatus.directChildClosed
      )
    }

    await this._completeTermination()
  }

  /**
   * @param {OwnedProcessStopSignal} signal
   * @param {number[]} knownSurvivingPids
   */
  async _signal(signal, knownSurvivingPids) {
    if (this._anchored) {
      if (this._anchorClosed) {
        throw new OwnedProcessInspectionError(this.identity, new Error("Owned process anchor closed before signalling completed"))
      }

      try {
        await this._signalWithAnchor(signal)
        return
      } catch (error) {
        throw new OwnedProcessTerminationError(this.identity, knownSurvivingPids, this._directChildClosed, error)
      }
    }

    try {
      if (await this._processControl.signalProcessGroupIfOwned(this.identity, signal)) return
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ESRCH") return

      throw new OwnedProcessTerminationError(this.identity, knownSurvivingPids, this._directChildClosed, error)
    }

    throw new OwnedProcessInspectionError(this.identity, new Error("Owned process-group generation is no longer verifiable"))
  }

  /** @param {OwnedProcessStopSignal} signal */
  async _signalWithAnchor(signal) {
    if (this._pendingAnchorSignal) throw new Error("Owned process anchor already has a pending signal")

    const requestId = randomUUID()
    /** @type {{requestId: string, resolve: () => void, reject: (error: Error) => void}} */
    const pendingAnchorSignal = {reject: () => {}, requestId, resolve: () => {}}
    /** @type {Promise<void>} */
    const signalResponse = new Promise((resolve, reject) => {
      pendingAnchorSignal.reject = reject
      pendingAnchorSignal.resolve = () => resolve()
    })
    this._pendingAnchorSignal = pendingAnchorSignal
    try {
      await this._sendAnchorMessage({requestId, signal, type: "signal"})
      await signalResponse
    } catch (error) {
      if (this._pendingAnchorSignal === pendingAnchorSignal) this._pendingAnchorSignal = undefined
      throw error
    }
  }

  /**
   * @param {Record<string, unknown>} message
   * @returns {Promise<void>}
   */
  async _sendAnchorMessage(message) {
    if (!this._child?.send || !this._child.connected) throw new Error("Owned process anchor IPC is unavailable")

    /** @type {Promise<void>} */
    const messageSent = new Promise((resolve, reject) => {
      this._child?.send?.(message, (error) => {
        if (error) {
          reject(error)
        } else {
          resolve()
        }
      })
    })
    await messageSent
  }

  /** @param {any} message */
  _handleAnchorMessage(message) {
    if (!message || typeof message !== "object" || typeof message.type !== "string") return

    if (message.type === "target-spawned") {
      if (!Number.isInteger(message.pid) || message.pid <= 0) {
        this._rejectTargetSpawn?.(new Error("Owned process anchor reported an invalid target PID"))
      } else {
        this.identity = Object.freeze({
          pid: message.pid,
          processGroupId: this._anchorPid,
          token: this.identity.token
        })
        this._resolveTargetSpawn?.()
      }
      this._rejectTargetSpawn = undefined
      this._resolveTargetSpawn = undefined
      return
    }

    if (message.type === "target-error") {
      const error = deserializeError(message.error ?? {})
      if (this._rejectTargetSpawn) {
        this._rejectTargetSpawn(error)
        this._rejectTargetSpawn = undefined
        this._resolveTargetSpawn = undefined
      } else {
        this._processError = error
      }
      return
    }

    if (message.type === "target-closed") {
      this._recordClose(message.code ?? null, message.signal ?? null)
      return
    }

    const pendingAnchorSignal = this._pendingAnchorSignal
    if (message.type !== "signal-result" || !pendingAnchorSignal || pendingAnchorSignal.requestId !== message.requestId) return

    this._pendingAnchorSignal = undefined
    if (message.error) {
      pendingAnchorSignal.reject(deserializeError(message.error))
    } else {
      pendingAnchorSignal.resolve()
    }
  }

  /**
   * @param {number} timeoutMs
   * @returns {Promise<OwnedProcessTerminationStatus>}
   */
  async _waitForTermination(timeoutMs) {
    const deadline = this._processControl.now() + timeoutMs

    while (true) {
      const terminationStatus = await this._terminationStatus()
      if (this._isTerminated(terminationStatus)) return terminationStatus

      const remainingMs = deadline - this._processControl.now()
      if (remainingMs <= 0) return terminationStatus

      await this._processControl.wait(Math.min(this._pollIntervalMs, remainingMs))
    }
  }

  /** @returns {Promise<OwnedProcessTerminationStatus>} */
  async _terminationStatus() {
    if (this._anchored && this._anchorClosed && !this._forceKillRequested && !this._releasingAnchor) {
      throw new OwnedProcessInspectionError(this.identity, new Error("Owned process anchor closed before terminal proof"))
    }

    /** @type {number[]} */
    let processGroupPids
    try {
      processGroupPids = await this._processControl.listProcessGroupPids(this.identity.processGroupId)
    } catch (error) {
      throw new OwnedProcessInspectionError(this.identity, error)
    }

    const uniqueProcessGroupPids = [...new Set(processGroupPids)].sort((firstPid, secondPid) => firstPid - secondPid)
    if (this._anchored && !this._anchorClosed && !this._forceKillRequested && !uniqueProcessGroupPids.includes(this._anchorPid)) {
      throw new OwnedProcessInspectionError(this.identity, new Error("Owned process anchor is no longer a member of its process group"))
    }

    return {
      directChildClosed: this._directChildClosed,
      survivingPids: this._anchored ? uniqueProcessGroupPids.filter((pid) => pid !== this._anchorPid) : uniqueProcessGroupPids
    }
  }

  /**
   * @param {OwnedProcessTerminationStatus} terminationStatus
   * @returns {boolean}
   */
  _isTerminated(terminationStatus) {
    return terminationStatus.directChildClosed && terminationStatus.survivingPids.length === 0
  }

  /**
   * @param {number | null} code
   * @param {string | null} signal
   */
  _recordClose(code, signal) {
    if (this._directChildClosed) return

    this._directChildClosed = true
    /** @type {OwnedProcessCloseResult} */
    const result = {code, signal}
    if (this._processError) result.error = this._processError
    this._resolveClosed(result)
    if (!this._anchored) this._child?.off("error", this._onError)
  }

  /**
   * @param {number | null} code
   * @param {string | null} signal
   */
  _recordAnchorClose(code, signal) {
    this._anchorClosed = true
    if (this._pendingAnchorSignal) {
      this._pendingAnchorSignal.reject(new Error("Owned process anchor closed before acknowledging its signal"))
      this._pendingAnchorSignal = undefined
    }
    if (this._rejectTargetSpawn) {
      this._rejectTargetSpawn(new Error(`Owned process anchor closed before target spawn (${code ?? signal ?? "unknown"})`))
      this._rejectTargetSpawn = undefined
      this._resolveTargetSpawn = undefined
    }
    if (this._forceKillRequested && !this._directChildClosed) this._recordClose(null, signal ?? "SIGKILL")
  }

  /** @returns {Promise<void>} */
  async _completeTermination() {
    if (this._anchored && !this._anchorClosed) {
      this._releasingAnchor = true
      try {
        await this._sendAnchorMessage({type: "release"})
      } catch (error) {
        if (!this._anchorClosed) throw new OwnedProcessInspectionError(this.identity, error)
      }
      await this._waitForAnchorClose(this._forceKillWaitMs)
      if (!this._anchorClosed) {
        throw new OwnedProcessTerminationError(this.identity, [], this._directChildClosed, new Error("Owned process anchor did not close"))
      }
    }

    this._finishTermination()
  }

  /** @param {number} timeoutMs */
  async _waitForAnchorClose(timeoutMs) {
    const deadline = this._processControl.now() + timeoutMs
    while (!this._anchorClosed) {
      const remainingMs = deadline - this._processControl.now()
      if (remainingMs <= 0) return

      await this._processControl.wait(Math.min(this._pollIntervalMs, remainingMs))
    }
  }

  _finishTermination() {
    this._terminated = true
    this._child?.off("close", this._onClose)
    this._child?.off("error", this._onError)
    this._child?.off("message", this._onMessage)
    this._child = undefined
    this.stdout = null
    this.stderr = null
  }

  /** @param {Promise<void>} stopPromise */
  _clearStopPromise(stopPromise) {
    if (this._stopPromise === stopPromise) this._stopPromise = undefined
  }

  /** @type {OwnedProcessIdentity} */
  identity
  /** @type {import("node:stream").Readable | null} */
  stdout
  /** @type {import("node:stream").Readable | null} */
  stderr
  /** @type {Promise<OwnedProcessCloseResult>} */
  closed
  /** @type {import("node:child_process").ChildProcess | undefined} */
  _child
  /** @type {OwnedProcessControl} */
  _processControl
  /** @type {number} */
  _killGraceMs
  /** @type {number} */
  _forceKillWaitMs
  /** @type {number} */
  _pollIntervalMs
  /** @type {Promise<void> | undefined} */
  _stopPromise = undefined
  /** @type {boolean} */
  _anchored
  /** @type {number} */
  _anchorPid
  /** @type {boolean} */
  _anchorClosed = false
  /** @type {boolean} */
  _forceKillRequested = false
  /** @type {boolean} */
  _forceKillSent = false
  /** @type {boolean} */
  _releasingAnchor = false
  /** @type {boolean} */
  _directChildClosed = false
  /** @type {boolean} */
  _terminated = false
  /** @type {Error | undefined} */
  _processError = undefined
  /** @type {(result: OwnedProcessCloseResult) => void} */
  _resolveClosed
  /** @type {(() => void) | undefined} */
  _resolveTargetSpawn = undefined
  /** @type {((error: Error) => void) | undefined} */
  _rejectTargetSpawn = undefined
  /** @type {{requestId: string, resolve: () => void, reject: (error: Error) => void} | undefined} */
  _pendingAnchorSignal = undefined
  /** @type {(code: number | null, signal: string | null) => void} */
  _onClose
  /** @type {(error: Error) => void} */
  _onError
  /** @type {(message: any) => void} */
  _onMessage
}
