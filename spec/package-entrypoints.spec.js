// @ts-check

import fs from "node:fs/promises"

describe("package entrypoints", () => {
  it("keeps Expo Router out of package-level peer dependencies", async () => {
    const packageJson = JSON.parse(await fs.readFile(new URL("../package.json", import.meta.url), "utf8"))

    expect(packageJson.peerDependencies["expo-router"]).toBeUndefined()
    expect(packageJson.peerDependenciesMeta["expo-router"]).toBeUndefined()
  })

  it("does not load the Expo Router hook through the root index", async () => {
    const indexSource = await fs.readFile(new URL("../src/index.js", import.meta.url), "utf8")

    expect(indexSource).not.toContain("use-system-test-expo")
  })

  it("keeps the Expo Router hook available through the explicit Expo entrypoint", async () => {
    const expoSource = await fs.readFile(new URL("../src/expo.js", import.meta.url), "utf8")

    expect(expoSource).toContain("use-system-test-expo")
  })

  it("exposes the root entrypoint with types through the exports map", async () => {
    const packageJson = JSON.parse(await fs.readFile(new URL("../package.json", import.meta.url), "utf8"))

    expect(packageJson.exports["."]).toEqual({
      types: "./build/index.d.ts",
      default: "./build/index.js"
    })
  })

  it("exposes the Expo Router hook through the ./expo subpath, not the root", async () => {
    const packageJson = JSON.parse(await fs.readFile(new URL("../package.json", import.meta.url), "utf8"))

    expect(packageJson.exports["./expo"]).toEqual({
      types: "./build/expo.d.ts",
      default: "./build/expo.js"
    })
    expect(packageJson.exports["."].default).not.toContain("expo")
  })

  it("keeps existing deep build imports and package.json resolvable", async () => {
    const packageJson = JSON.parse(await fs.readFile(new URL("../package.json", import.meta.url), "utf8"))

    expect(packageJson.exports["./build/*"]).toEqual("./build/*")
    expect(packageJson.exports["./package.json"]).toEqual("./package.json")
  })

  it("ships every exports target inside the published build files", async () => {
    const packageJson = JSON.parse(await fs.readFile(new URL("../package.json", import.meta.url), "utf8"))
    const targets = []

    for (const entry of Object.values(packageJson.exports)) {
      if (typeof entry === "string") {
        targets.push(entry)
      } else {
        for (const conditionTarget of Object.values(entry)) targets.push(conditionTarget)
      }
    }

    for (const target of targets) {
      if (!target.startsWith("./build/") || target.includes("*")) continue

      await expectAsync(fs.access(new URL(`../${target.slice(2)}`, import.meta.url))).toBeResolved()
    }
  })
})
