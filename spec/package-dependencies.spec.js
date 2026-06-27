// @ts-check

import fs from "node:fs/promises"

describe("package dependencies", () => {
  /** @returns {Promise<Record<string, any>>} */
  const readPackageJson = async () => JSON.parse(await fs.readFile(new URL("../package.json", import.meta.url), "utf8"))

  it("does not ship appium as a normal runtime dependency", async () => {
    const packageJson = await readPackageJson()

    expect(packageJson.dependencies.appium).toBeUndefined()
  })

  it("declares appium as an optional peer dependency", async () => {
    const packageJson = await readPackageJson()

    expect(packageJson.peerDependencies.appium).toBeDefined()
    expect(packageJson.peerDependenciesMeta.appium?.optional).toBeTrue()
  })

  it("keeps appium as a dev dependency so this repo's Appium tests still resolve it", async () => {
    const packageJson = await readPackageJson()

    expect(packageJson.devDependencies.appium).toBeDefined()
  })
})
