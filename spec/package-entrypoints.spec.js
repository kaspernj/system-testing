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
})
