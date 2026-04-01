// @ts-check

import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import Browser from "../src/browser.js"

describe("Browser", () => {
  it("visits directly with the driver when no communicator is injected", async () => {
    const browser = new Browser()
    const visitedPaths = []

    browser.driverAdapter = /** @type {any} */ ({
      driverVisit: async (visitedPath) => {
        visitedPaths.push(visitedPath)
      },
      getTimeouts: () => 500
    })

    await browser.visit("https://example.com")

    expect(visitedPaths).toEqual(["https://example.com"])
  })

  it("uses per-command timeout overrides for direct navigation", async () => {
    const browser = new Browser()
    const visitedPaths = []

    browser.driverAdapter = /** @type {any} */ ({
      driverVisit: async (visitedPath) => {
        visitedPaths.push(visitedPath)
      },
      getTimeouts: () => 500
    })

    await browser.visit("https://example.com", {timeout: 1500})

    expect(visitedPaths).toEqual(["https://example.com"])
  })

  it("deletes all cookies through the driver adapter", async () => {
    const browser = new Browser()
    let deleteAllCookiesCalls = 0

    browser.driverAdapter = /** @type {any} */ ({
      deleteAllCookies: async () => {
        deleteAllCookiesCalls += 1
      }
    })

    await browser.deleteAllCookies()

    expect(deleteAllCookiesCalls).toEqual(1)
  })

  it("uses the injected communicator for helper-driven navigation", async () => {
    const sentCommands = []
    const browser = new Browser({
      communicator: /** @type {any} */ ({
        sendCommand: async (command) => {
          sentCommands.push(command)
        }
      })
    })

    browser.driverAdapter = /** @type {any} */ ({
      driverVisit: async () => {
        throw new Error("driverVisit should not be called when communicator is injected")
      },
      getTimeouts: () => 500
    })

    await browser.visit("/spa-route")
    await browser.dismissTo("/reset")

    expect(sentCommands).toEqual([
      {type: "visit", path: "/spa-route"},
      {type: "dismissTo", path: "/reset"}
    ])
  })

  it("uses per-command timeout overrides for helper-driven navigation", async () => {
    const sentCommands = []
    const browser = new Browser({
      communicator: /** @type {any} */ ({
        sendCommand: async (command) => {
          sentCommands.push(command)
        }
      })
    })

    browser.driverAdapter = /** @type {any} */ ({
      driverVisit: async () => {
        throw new Error("driverVisit should not be called when communicator is injected")
      },
      getTimeouts: () => 500
    })

    await browser.visit("/spa-route", {timeout: 1500})
    await browser.dismissTo("/reset", {timeout: 2500})

    expect(sentCommands).toEqual([
      {type: "visit", path: "/spa-route"},
      {type: "dismissTo", path: "/reset"}
    ])
  })

  it("writes screenshot, logs, and HTML artifacts", async () => {
    const screenshotsPath = await fs.mkdtemp(path.join(os.tmpdir(), "system-testing-browser-"))
    const browser = new Browser({screenshotsPath})
    const logSpy = spyOn(console, "log")

    browser.driverAdapter = /** @type {any} */ ({
      takeScreenshot: async () => "aGVsbG8=",
      getBrowserLogs: async () => ["INFO: first log line"],
      getHTML: async () => "<html><body><h1>Hello</h1></body></html>",
      getCurrentUrl: async () => "https://example.com",
      getTimeouts: () => 500
    })

    const result = await browser.takeScreenshot()

    expect(result.currentUrl).toBe("https://example.com")
    expect(result.logs).toEqual(["INFO: first log line"])
    expect(await fs.readFile(result.logsPath, "utf8")).toBe("INFO: first log line")
    expect(await fs.readFile(result.htmlPath, "utf8")).toContain("<h1>Hello</h1>")
    expect(await fs.readFile(result.screenshotPath, "base64")).toBe("aGVsbG8=")
    expect(logSpy.calls.allArgs().some((callArgs) => String(callArgs[0]) === "Browser logs:")).toBeTrue()

    await fs.rm(screenshotsPath, {recursive: true, force: true})
  })
})
