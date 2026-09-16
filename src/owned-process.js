import {execFile, spawn as spawnChild} from "node:child_process"
import {randomUUID} from "node:crypto"
import {setTimeout as wait} from "node:timers/promises"
import {promisify} from "node:util"

/**
 * @typedef {object} OwnedProcessControl
 * @property {string} platform Platform on which process ownership is implemented.
 * @property {(command: string, args: string[], options: import("node:child_process").SpawnOptions) => import("node:child_process").ChildProcess} spawn Spawns the direct child.
 * @property {(processGroupId: number) => Promise<number[]>} listProcessGroupPids Lists exact non-zombie process-group members.
 * @property {(processGroupId: number, signal: OwnedProcessStopSignal) => Promise<void> | void} signalProcessGroup Signals the exact process group.
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

/**
 * @param {number} processGroupId
 * @param {OwnedProcessStopSignal} signal
 */
function signalProcessGroup(processGroupId, signal) {
  process.kill(-processGroupId, signal)
}

/** @type {OwnedProcessControl} */
const defaultProcessControl = {
  listProcessGroupPids,
  now: () => performance.now(),
  platform: process.platform,
  signalProcessGroup,
  spawn: spawnChild,
  wait: async (milliseconds) => await wait(milliseconds)
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
    /** @type {import("node:child_process").SpawnOptions} */
    const spawnOptions = {
      cwd: options.cwd,
      detached: true,
      env: options.env,
      stdio: ["ignore", stdout, stderr]
    }
    const child = processControl.spawn(command, args, spawnOptions)

    return await new Promise((resolve, reject) => {
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

        resolve(new OwnedProcess({child, forceKillWaitMs, killGraceMs, pollIntervalMs, processControl}))
      }

      child.once("error", onSpawnError)
      child.once("spawn", onSpawn)
    })
  }

  /**
   * @param {{
   *   child: import("node:child_process").ChildProcess,
   *   forceKillWaitMs: number,
   *   killGraceMs: number,
   *   pollIntervalMs: number,
   *   processControl: OwnedProcessControl
   * }} args
   */
  constructor({child, forceKillWaitMs, killGraceMs, pollIntervalMs, processControl}) {
    if (!child.pid) throw new Error("Owned process requires a PID")

    this.identity = Object.freeze({pid: child.pid, processGroupId: child.pid, token: randomUUID()})
    this.stdout = child.stdout
    this.stderr = child.stderr
    this._child = child
    this._processControl = processControl
    this._killGraceMs = killGraceMs
    this._forceKillWaitMs = forceKillWaitMs
    this._pollIntervalMs = pollIntervalMs

    /** @type {(result: OwnedProcessCloseResult) => void} */
    let resolveClosed = () => {}
    this.closed = new Promise((resolve) => {
      resolveClosed = resolve
    })
    this._resolveClosed = resolveClosed
    this._onClose = (code, signal) => this._recordClose(code, signal)
    this._onError = (error) => {
      this._processError = error
    }
    child.once("close", this._onClose)
    child.on("error", this._onError)
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
      this._finishTermination()
      return
    }

    await this._signal("SIGTERM", terminationStatus.survivingPids)
    terminationStatus = await this._waitForTermination(this._killGraceMs)
    if (this._isTerminated(terminationStatus)) {
      this._finishTermination()
      return
    }

    await this._signal("SIGKILL", terminationStatus.survivingPids)
    terminationStatus = await this._waitForTermination(this._forceKillWaitMs)
    if (!this._isTerminated(terminationStatus)) {
      throw new OwnedProcessTerminationError(
        this.identity,
        terminationStatus.survivingPids,
        terminationStatus.directChildClosed
      )
    }

    this._finishTermination()
  }

  /**
   * @param {OwnedProcessStopSignal} signal
   * @param {number[]} knownSurvivingPids
   */
  async _signal(signal, knownSurvivingPids) {
    try {
      await this._processControl.signalProcessGroup(this.identity.processGroupId, signal)
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ESRCH") return

      throw new OwnedProcessTerminationError(this.identity, knownSurvivingPids, this._directChildClosed, error)
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
    /** @type {number[]} */
    let processGroupPids
    try {
      processGroupPids = await this._processControl.listProcessGroupPids(this.identity.processGroupId)
    } catch (error) {
      throw new OwnedProcessInspectionError(this.identity, error)
    }

    return {
      directChildClosed: this._directChildClosed,
      survivingPids: [...new Set(processGroupPids)].sort((firstPid, secondPid) => firstPid - secondPid)
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
    this._directChildClosed = true
    /** @type {OwnedProcessCloseResult} */
    const result = {code, signal}
    if (this._processError) result.error = this._processError
    this._resolveClosed(result)
    this._child?.off("error", this._onError)
  }

  _finishTermination() {
    this._terminated = true
    this._child?.off("close", this._onClose)
    this._child?.off("error", this._onError)
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
  _directChildClosed = false
  /** @type {boolean} */
  _terminated = false
  /** @type {Error | undefined} */
  _processError = undefined
  /** @type {(result: OwnedProcessCloseResult) => void} */
  _resolveClosed
  /** @type {(code: number | null, signal: string | null) => void} */
  _onClose
  /** @type {(error: Error) => void} */
  _onError
}
