// @ts-check

import {execFile, spawn} from "node:child_process"
import {EventEmitter} from "node:events"
import {promisify} from "node:util"

import OwnedProcess, {
  OwnedProcessInspectionError,
  OwnedProcessTerminationError,
  OwnedProcessUnsupportedPlatformError
} from "../src/owned-process.js"

const execFileAsync = promisify(execFile)

/** @returns {{promise: Promise<void>, resolve: () => void}} */
function createDeferred() {
  /** @type {() => void} */
  let resolve = () => {}
  const promise = new Promise((promiseResolve) => {
    resolve = promiseResolve
  })

  return {promise, resolve}
}

/**
 * @param {import("node:stream").Readable} stream
 * @param {string} prefix
 * @returns {Promise<string>}
 */
function waitForLine(stream, prefix) {
  return new Promise((resolve, reject) => {
    let buffered = ""
    const cleanup = () => {
      stream.off("data", onData)
      stream.off("error", onError)
      stream.off("end", onEnd)
    }
    const onData = (chunk) => {
      buffered += chunk.toString()
      const matchingLine = buffered.split("\n").find((line) => line.startsWith(prefix))
      if (!matchingLine) return

      cleanup()
      resolve(matchingLine)
    }
    const onError = (error) => {
      cleanup()
      reject(error)
    }
    const onEnd = () => {
      cleanup()
      reject(new Error(`Stream ended before a line beginning with "${prefix}" arrived`))
    }

    stream.on("data", onData)
    stream.on("error", onError)
    stream.on("end", onEnd)
  })
}

/**
 * @param {number} pid
 * @returns {Promise<string | undefined>}
 */
async function readProcessState(pid) {
  try {
    const {stdout} = await execFileAsync("ps", ["-o", "stat=", "-p", String(pid)], {encoding: "utf8"})

    return stdout.trim() || undefined
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === 1) return undefined

    throw error
  }
}

/** @param {OwnedProcess | undefined} ownedProcess */
async function forceStopOwnedProcess(ownedProcess) {
  if (!ownedProcess) return

  try {
    await ownedProcess.stop()
    return
  } catch {
    try {
      process.kill(-ownedProcess.identity.processGroupId, "SIGKILL")
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ESRCH") throw error
    }
  }

  await ownedProcess.closed
}

/**
 * @param {import("node:child_process").ChildProcess | undefined} child
 * @returns {Promise<void>}
 */
async function forceStopChildGroup(child) {
  if (!child?.pid) return

  try {
    process.kill(-child.pid, "SIGKILL")
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ESRCH") throw error
  }

  if (child.exitCode === null && child.signalCode === null) {
    await new Promise((resolve) => child.once("close", resolve))
  }
}

class FakeChildProcess extends EventEmitter {
  /** @param {number | undefined} pid */
  constructor(pid) {
    super()
    this.pid = pid
  }
}

describe("OwnedProcess", () => {
  it("keeps stop single-flight and sends KILL only after the TERM grace", async () => {
    const closeAfterKill = createDeferred()
    const grace = createDeferred()
    const killSent = createDeferred()
    const termSent = createDeferred()
    const child = new FakeChildProcess(12001)
    const signals = []
    let activeWaits = 0
    let currentTime = 0
    let pids = [12001]
    const processControl = {
      platform: "linux",
      now: () => currentTime,
      spawn: () => {
        queueMicrotask(() => child.emit("spawn"))
        return child
      },
      listProcessGroupPids: async () => pids,
      signalProcessGroup: async (_processGroupId, signal) => {
        signals.push(signal)
        if (signal === "SIGTERM") termSent.resolve()
        if (signal === "SIGKILL") {
          pids = []
          killSent.resolve()
        }
      },
      wait: async (milliseconds) => {
        activeWaits += 1
        try {
          if (signals.includes("SIGKILL")) {
            await closeAfterKill.promise
          } else {
            await grace.promise
          }
          currentTime += milliseconds
        } finally {
          activeWaits -= 1
        }
      }
    }
    const ownedProcess = await OwnedProcess.spawn("fake", [], {
      forceKillWaitMs: 50,
      killGraceMs: 50,
      pollIntervalMs: 50,
      processControl
    })

    const firstStop = ownedProcess.stop()
    const secondStop = ownedProcess.stop()
    let stopSettled = false
    void firstStop.then(() => {
      stopSettled = true
    })
    await termSent.promise

    expect(firstStop).toBe(secondStop)
    expect(signals).toEqual(["SIGTERM"])

    grace.resolve()
    await killSent.promise
    await Promise.resolve()
    expect(stopSettled).toBeFalse()

    child.emit("close", null, "SIGKILL")
    closeAfterKill.resolve()
    await firstStop

    expect(signals).toEqual(["SIGTERM", "SIGKILL"])
    expect(activeWaits).toBe(0)
    expect((await ownedProcess.closed).signal).toBe("SIGKILL")
    expect(child.listenerCount("close")).toBe(0)
    expect(child.listenerCount("error")).toBe(0)
  })

  it("retains exact survivors after terminal failure and permits cleanup retry", async () => {
    const child = new FakeChildProcess(12002)
    const signals = []
    let currentTime = 0
    let pids = [12002, 12003]
    const processControl = {
      platform: "linux",
      now: () => currentTime,
      spawn: () => {
        queueMicrotask(() => child.emit("spawn"))
        return child
      },
      listProcessGroupPids: async () => pids,
      signalProcessGroup: async (_processGroupId, signal) => {
        signals.push(signal)
        if (signal === "SIGKILL") pids = [12003]
      },
      wait: async (milliseconds) => {
        currentTime += milliseconds
      }
    }
    const ownedProcess = await OwnedProcess.spawn("fake", [], {
      forceKillWaitMs: 25,
      killGraceMs: 25,
      pollIntervalMs: 25,
      processControl
    })

    const failure = await ownedProcess.stop().catch((error) => error)

    expect(failure).toEqual(jasmine.any(OwnedProcessTerminationError))
    expect(failure.survivingPids).toEqual([12003])
    expect(failure.directChildClosed).toBeFalse()
    expect(signals).toEqual(["SIGTERM", "SIGKILL"])

    pids = []
    child.emit("close", null, "SIGKILL")
    await ownedProcess.stop()

    expect(child.listenerCount("close")).toBe(0)
    expect(child.listenerCount("error")).toBe(0)
  })

  it("retains ownership when scope inspection fails and permits cleanup retry", async () => {
    const child = new FakeChildProcess(12004)
    const signalProcessGroup = jasmine.createSpy("signalProcessGroup")
    let inspectionFails = true
    const processControl = {
      platform: "linux",
      now: () => 0,
      spawn: () => {
        queueMicrotask(() => child.emit("spawn"))
        return child
      },
      listProcessGroupPids: async () => {
        if (inspectionFails) throw new Error("ps unavailable")

        return []
      },
      signalProcessGroup,
      wait: async () => {}
    }
    const ownedProcess = await OwnedProcess.spawn("fake", [], {processControl})

    await expectAsync(ownedProcess.stop()).toBeRejectedWith(jasmine.any(OwnedProcessInspectionError))
    expect(signalProcessGroup).not.toHaveBeenCalled()

    inspectionFails = false
    child.emit("close", 0, null)
    await ownedProcess.stop()

    expect(child.listenerCount("close")).toBe(0)
    expect(child.listenerCount("error")).toBe(0)
  })

  it("distinguishes a post-spawn close from spawn failure", async () => {
    /** @type {OwnedProcess | undefined} */
    let ownedProcess
    try {
      ownedProcess = await OwnedProcess.spawn(
        process.execPath,
        ["-e", "process.exit(7)"],
        {stderr: "pipe", stdout: "pipe"}
      )

      expect(await ownedProcess.closed).toEqual({code: 7, signal: null})
      await ownedProcess.stop()
    } finally {
      await forceStopOwnedProcess(ownedProcess)
    }
  })

  it("kills a real direct child that ignores TERM and waits for close", async () => {
    /** @type {OwnedProcess | undefined} */
    let ownedProcess
    try {
      ownedProcess = await OwnedProcess.spawn(
        process.execPath,
        [new URL("fixtures/owned-process-ignore-term.js", import.meta.url).pathname],
        {forceKillWaitMs: 1000, killGraceMs: 50, stderr: "pipe", stdout: "pipe"}
      )
      if (!ownedProcess.stdout) throw new Error("Expected piped fixture stdout")
      expect(ownedProcess.identity.pid).toBe(ownedProcess.identity.processGroupId)
      expect(Object.isFrozen(ownedProcess.identity)).toBeTrue()
      await waitForLine(ownedProcess.stdout, "ready")
      const termReceived = waitForLine(ownedProcess.stdout, "term")

      const stopping = ownedProcess.stop()
      await termReceived
      const closeResult = await ownedProcess.closed
      await stopping

      expect(closeResult.signal).toBe("SIGKILL")
      expect(ownedProcess.stdout).toBeNull()
      expect(ownedProcess.stderr).toBeNull()
    } finally {
      await forceStopOwnedProcess(ownedProcess)
    }
  })

  it("kills a descendant created after shutdown starts without touching an unrelated group", async () => {
    /** @type {OwnedProcess | undefined} */
    let ownedProcess
    /** @type {import("node:child_process").ChildProcess | undefined} */
    let unrelatedChild
    try {
      unrelatedChild = spawn(
        process.execPath,
        [new URL("fixtures/owned-process-ignore-term.js", import.meta.url).pathname],
        {detached: true, stdio: ["ignore", "pipe", "pipe"]}
      )
      await new Promise((resolve, reject) => {
        unrelatedChild.once("spawn", resolve)
        unrelatedChild.once("error", reject)
      })
      if (!unrelatedChild.stdout) throw new Error("Expected piped unrelated fixture stdout")
      await waitForLine(unrelatedChild.stdout, "ready")

      ownedProcess = await OwnedProcess.spawn(
        process.execPath,
        [new URL("fixtures/owned-process-late-descendant.js", import.meta.url).pathname],
        {forceKillWaitMs: 1000, killGraceMs: 50, stderr: "pipe", stdout: "pipe"}
      )
      if (!ownedProcess.stdout) throw new Error("Expected piped fixture stdout")
      await waitForLine(ownedProcess.stdout, "ready")
      const descendantCreated = waitForLine(ownedProcess.stdout, "descendant:")

      const stopping = ownedProcess.stop()
      const descendantPid = Number((await descendantCreated).split(":")[1])
      await stopping

      const descendantState = await readProcessState(descendantPid)
      expect(descendantState === undefined || descendantState.startsWith("Z")).toBeTrue()
      expect(() => process.kill(/** @type {number} */ (unrelatedChild?.pid), 0)).not.toThrow()
    } finally {
      await forceStopOwnedProcess(ownedProcess)
      await forceStopChildGroup(unrelatedChild)
    }
  })

  it("treats a zombie process-group member as terminated after the direct child closes", async () => {
    const originalPath = process.env.PATH
    const originalProcessGroupId = process.env.OWNED_PROCESS_TEST_PGID
    /** @type {OwnedProcess | undefined} */
    let ownedProcess
    try {
      const fixturePath = new URL("fixtures/owned-process-zombie-path", import.meta.url).pathname
      if (originalPath === undefined) {
        process.env.PATH = fixturePath
      } else {
        process.env.PATH = `${fixturePath}:${originalPath}`
      }
      ownedProcess = await OwnedProcess.spawn(process.execPath, ["-e", ""], {
        forceKillWaitMs: 0,
        killGraceMs: 0,
        pollIntervalMs: 1,
        stderr: "pipe",
        stdout: "pipe"
      })
      await ownedProcess.closed
      process.env.OWNED_PROCESS_TEST_PGID = String(ownedProcess.identity.processGroupId)

      await ownedProcess.stop()
    } finally {
      if (originalPath === undefined) {
        delete process.env.PATH
      } else {
        process.env.PATH = originalPath
      }
      if (originalProcessGroupId === undefined) {
        delete process.env.OWNED_PROCESS_TEST_PGID
      } else {
        process.env.OWNED_PROCESS_TEST_PGID = originalProcessGroupId
      }
      await forceStopOwnedProcess(ownedProcess)
    }
  })

  it("rejects spawn failure without signaling an unowned process", async () => {
    const child = new FakeChildProcess(undefined)
    const signalProcessGroup = jasmine.createSpy("signalProcessGroup")
    const processControl = {
      platform: "linux",
      now: () => 0,
      spawn: () => {
        queueMicrotask(() => child.emit("error", Object.assign(new Error("spawn failed"), {code: "ENOENT"})))
        return child
      },
      listProcessGroupPids: async () => [],
      signalProcessGroup,
      wait: async () => {}
    }

    await expectAsync(OwnedProcess.spawn("missing", [], {processControl})).toBeRejectedWithError(/spawn failed/)

    expect(signalProcessGroup).not.toHaveBeenCalled()
    expect(child.listenerCount("spawn")).toBe(0)
    expect(child.listenerCount("error")).toBe(0)
  })

  it("rejects unsupported platforms before spawning", async () => {
    const spawnProcess = jasmine.createSpy("spawn")
    const processControl = {
      platform: "win32",
      now: () => 0,
      spawn: spawnProcess,
      listProcessGroupPids: async () => [],
      signalProcessGroup: async () => {},
      wait: async () => {}
    }

    await expectAsync(OwnedProcess.spawn("fake", [], {processControl})).toBeRejectedWith(jasmine.any(OwnedProcessUnsupportedPlatformError))
    expect(spawnProcess).not.toHaveBeenCalled()
  })

  it("rejects invalid timing options before spawning", async () => {
    const spawnProcess = jasmine.createSpy("spawn")
    const processControl = {
      platform: "linux",
      now: () => 0,
      spawn: spawnProcess,
      listProcessGroupPids: async () => [],
      signalProcessGroup: async () => {},
      wait: async () => {}
    }

    await expectAsync(OwnedProcess.spawn("fake", [], {killGraceMs: -1, processControl})).toBeRejectedWithError(RangeError)
    expect(spawnProcess).not.toHaveBeenCalled()
  })
})
