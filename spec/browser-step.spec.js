// @ts-check

import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import Browser from "../src/browser.js"

/**
 * @param {string} screenshotsPath
 * @returns {Browser}
 */
function stubbedBrowser(screenshotsPath) {
  const browser = new Browser({screenshotsPath})

  browser.driverAdapter = /** @type {any} */ ({
    takeScreenshot: async () => "",
    getBrowserLogs: async () => [],
    getHTML: async () => "<html><body></body></html>",
    getCurrentUrl: async () => "about:blank"
  })

  return browser
}

describe("Browser.step", () => {
  it("runs the callback and returns its result", async () => {
    const browser = new Browser()

    expect(await browser.step("sign in", async () => 42)).toEqual(42)
  })

  it("exposes the active step path only while the callback runs", async () => {
    const browser = new Browser()
    let activeDuring

    expect(browser.currentStepPath()).toBeUndefined()

    await browser.step("sign in", async () => {
      activeDuring = browser.currentStepPath()
    })

    expect(activeDuring).toEqual("sign in")
    expect(browser.currentStepPath()).toBeUndefined()
  })

  it("records passed steps in history", async () => {
    const browser = new Browser()

    await browser.step("a", async () => {})
    await browser.step("b", async () => {})

    expect(browser.getStepHistory().map((event) => `${event.path}:${event.status}`)).toEqual(["a:passed", "b:passed"])
  })

  it("preserves the original error and annotates it with the step path on failure", async () => {
    const browser = new Browser()
    const original = new Error("boom")
    let thrown

    try {
      await browser.step("sign in", async () => {
        throw original
      })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBe(original)
    expect(/** @type {Error} */ (thrown).message).toEqual("boom (in step: sign in)")
    expect(/** @type {any} */ (thrown).systemTestStep).toEqual("sign in")
    expect(browser.getStepHistory()[0].status).toEqual("failed")
    expect(browser.currentStepPath()).toBeUndefined()
  })

  it("annotates nested step failures once with the deepest path", async () => {
    const browser = new Browser()
    const original = new Error("boom")
    let thrown

    try {
      await browser.step("outer", async () => {
        await browser.step("inner", async () => {
          throw original
        })
      })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBe(original)
    expect(/** @type {Error} */ (thrown).message).toEqual("boom (in step: outer > inner)")
    expect(/** @type {any} */ (thrown).systemTestStep).toEqual("outer > inner")
    expect(browser.getStepHistory().map((event) => `${event.name}:${event.status}`)).toEqual(["outer:failed", "inner:failed"])
    expect(browser.getStepHistory()[1].path).toEqual("outer > inner")
  })

  it("passes non-Error rejections through unchanged while recording the failed step", async () => {
    const browser = new Browser()
    let thrown

    try {
      await browser.step("visit", async () => {
        throw "communicator failure"
      })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toEqual("communicator failure")
    expect(browser.getStepHistory()[0].status).toEqual("failed")
  })

  it("resets step history and failure state", async () => {
    const browser = new Browser()

    await browser.step("a", async () => {})

    expect(browser.getStepHistory().length).toEqual(1)

    browser.resetSteps()

    expect(browser.getStepHistory()).toEqual([])
    expect(browser.currentStepPath()).toBeUndefined()
  })

  describe("failure artifacts", () => {
    /** @type {string} */
    let screenshotsPath

    beforeEach(async () => {
      screenshotsPath = await fs.mkdtemp(path.join(os.tmpdir(), "system-testing-step-"))
    })

    afterEach(async () => {
      await fs.rm(screenshotsPath, {force: true, recursive: true})
    })

    it("includes the active step in screenshot artifacts", async () => {
      const browser = stubbedBrowser(screenshotsPath)
      let artifacts

      await browser.step("sign in", async () => {
        artifacts = await browser.takeScreenshot()
      })

      expect(artifacts.step).toEqual("sign in")
    })

    it("includes the failed step in artifacts captured after the step unwinds", async () => {
      const browser = stubbedBrowser(screenshotsPath)

      try {
        await browser.step("checkout", async () => {
          throw new Error("x")
        })
      } catch {
        // Expected.
      }

      const artifacts = await browser.takeScreenshot()

      expect(artifacts.step).toEqual("checkout")
    })

    it("records the failed step in artifacts for non-Error rejections", async () => {
      const browser = stubbedBrowser(screenshotsPath)

      try {
        await browser.step("visit", async () => {
          throw "communicator failure"
        })
      } catch {
        // Expected.
      }

      expect((await browser.takeScreenshot()).step).toEqual("visit")
    })

    it("omits the step from artifacts when no step ran", async () => {
      const browser = stubbedBrowser(screenshotsPath)

      expect((await browser.takeScreenshot()).step).toBeUndefined()
    })

    it("clears the last failed step after resetSteps", async () => {
      const browser = stubbedBrowser(screenshotsPath)

      try {
        await browser.step("checkout", async () => {
          throw new Error("x")
        })
      } catch {
        // Expected.
      }

      browser.resetSteps()

      expect((await browser.takeScreenshot()).step).toBeUndefined()
    })
  })
})
