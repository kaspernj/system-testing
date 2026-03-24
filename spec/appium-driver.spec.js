import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import AppiumDriver, {ensureChromeUserDataDirCapability} from "../src/drivers/appium-driver.js"

describe("AppiumDriver", () => {
  it("adds a dedicated user-data-dir for Chrome sessions", async () => {
    const tempRootDir = await fs.mkdtemp(path.join(os.tmpdir(), "system-testing-appium-driver-"))
    const capabilities = {
      browserName: "chrome",
      "goog:chromeOptions": {
        args: ["--headless=new"]
      }
    }

    try {
      const userDataDir = await ensureChromeUserDataDirCapability({
        browserName: "chrome",
        capabilities,
        tempRootDir
      })

      expect(typeof userDataDir).toBe("string")
      expect(capabilities["goog:chromeOptions"].args).toContain(`--user-data-dir=${userDataDir}`)
      await expectAsync(fs.stat(userDataDir)).toBeResolved()
    } finally {
      await fs.rm(tempRootDir, {recursive: true, force: true})
    }
  })

  it("keeps explicit user-data-dir chrome args untouched", async () => {
    const tempRootDir = await fs.mkdtemp(path.join(os.tmpdir(), "system-testing-appium-driver-"))
    const capabilities = {
      browserName: "chrome",
      "goog:chromeOptions": {
        args: ["--headless=new", "--user-data-dir=/custom/profile"]
      }
    }

    try {
      const userDataDir = await ensureChromeUserDataDirCapability({
        browserName: "chrome",
        capabilities,
        tempRootDir
      })

      expect(userDataDir).toBeUndefined()
      expect(capabilities["goog:chromeOptions"].args).toEqual(["--headless=new", "--user-data-dir=/custom/profile"])
    } finally {
      await fs.rm(tempRootDir, {recursive: true, force: true})
    }
  })

  it("cleans up the generated Chrome user-data-dir on stop", async () => {
    const tempRootDir = await fs.mkdtemp(path.join(os.tmpdir(), "system-testing-appium-driver-"))
    const chromeUserDataDir = path.join(tempRootDir, "profile")
    const browser = {
      driver: undefined,
      getSelector: (selector) => selector,
      throwIfHttpServerError: () => {}
    }
    const driver = new AppiumDriver({browser})

    await fs.mkdir(chromeUserDataDir, {recursive: true})
    driver.chromeUserDataDir = chromeUserDataDir
    driver.appiumServer = {close: async () => {}}

    await driver.stop()

    await expectAsync(fs.stat(chromeUserDataDir)).toBeRejected()
    await fs.rm(tempRootDir, {recursive: true, force: true})
  })
})
