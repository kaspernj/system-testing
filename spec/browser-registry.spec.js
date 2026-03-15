// @ts-check

import {spawn} from "node:child_process"

import BrowserRegistry from "../src/browser-registry.js"

describe("BrowserRegistry", () => {
  afterEach(async () => {
    await BrowserRegistry.unregister("spec-browser")
    await BrowserRegistry.unregister("spec-browser-2")
    await BrowserRegistry.unregister("spec-stop-browser")
  })

  it("registers and resolves a running browser by name", async () => {
    await BrowserRegistry.register({name: "spec-browser", pid: process.pid, port: 4321})

    const resolved = await BrowserRegistry.resolve("spec-browser")

    expect(resolved.name).toBe("spec-browser")
    expect(resolved.port).toBe(4321)
  })

  it("requires a name when multiple browsers are registered", async () => {
    spyOn(BrowserRegistry, "list").and.resolveTo([
      {name: "spec-browser", pid: process.pid, port: 4321},
      {name: "spec-browser-2", pid: process.pid, port: 5432}
    ])

    await expectAsync(BrowserRegistry.resolve()).toBeRejectedWithError("Multiple browser processes are running (2); pass --name")
  })

  it("stops a registered browser process by name", async () => {
    const childProcess = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore"
    })

    try {
      spyOn(BrowserRegistry, "verifyEntry").and.resolveTo(true)
      await BrowserRegistry.register({name: "spec-stop-browser", pid: childProcess.pid, port: 6543})

      const stoppedEntry = await BrowserRegistry.stop("spec-stop-browser")

      expect(stoppedEntry.name).toBe("spec-stop-browser")
      expect(BrowserRegistry.isProcessAlive(childProcess.pid)).toBeFalse()
      await expectAsync(BrowserRegistry.resolve("spec-stop-browser")).toBeRejectedWithError(
        "No running browser process found with name: spec-stop-browser"
      )
    } finally {
      if (BrowserRegistry.isProcessAlive(childProcess.pid)) {
        childProcess.kill("SIGKILL")
      }
    }
  })

  it("treats unverifiable entries as stale instead of killing by pid", async () => {
    const childProcess = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore"
    })

    try {
      spyOn(BrowserRegistry, "verifyEntry").and.resolveTo(false)
      await BrowserRegistry.register({name: "spec-stop-browser", pid: childProcess.pid, port: 6543})

      await expectAsync(BrowserRegistry.stop("spec-stop-browser")).toBeRejectedWithError(
        "Browser registry entry spec-stop-browser no longer matches a running browser daemon"
      )
      expect(BrowserRegistry.isProcessAlive(childProcess.pid)).toBeTrue()
      await expectAsync(BrowserRegistry.resolve("spec-stop-browser")).toBeRejectedWithError(
        "No running browser process found with name: spec-stop-browser"
      )
    } finally {
      if (BrowserRegistry.isProcessAlive(childProcess.pid)) {
        childProcess.kill("SIGKILL")
      }
    }
  })
})
