// @ts-check

import BrowserRegistry from "../src/browser-registry.js"

describe("BrowserRegistry", () => {
  afterEach(async () => {
    await BrowserRegistry.unregister("spec-browser")
    await BrowserRegistry.unregister("spec-browser-2")
  })

  it("registers and resolves a running browser by name", async () => {
    await BrowserRegistry.register({name: "spec-browser", pid: process.pid, port: 4321})

    const resolved = await BrowserRegistry.resolve("spec-browser")

    expect(resolved.name).toBe("spec-browser")
    expect(resolved.port).toBe(4321)
  })

  it("requires a name when multiple browsers are registered", async () => {
    await BrowserRegistry.register({name: "spec-browser", pid: process.pid, port: 4321})
    await BrowserRegistry.register({name: "spec-browser-2", pid: process.pid, port: 5432})

    await expectAsync(BrowserRegistry.resolve()).toBeRejectedWithError("Multiple browser processes are running (2); pass --name")
  })
})
