// @ts-check

import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {Key} from "selenium-webdriver"
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

  it("waits for the current URL pathname", async () => {
    const browser = new Browser()
    const urls = [
      "https://example.com/invoices/1/edit?token=abc",
      "https://example.com/invoices/1?token=abc"
    ]

    browser.driverAdapter = /** @type {any} */ ({
      getCurrentUrl: async () => urls.shift() || "https://example.com/invoices/1?token=abc",
      getTimeouts: () => 500
    })

    await browser.waitForPath("/invoices/1")
  })

  it("waits for exact and fragment URL assertions", async () => {
    const browser = new Browser()
    const urls = [
      "https://example.com/invoices?filter=open",
      "https://example.com/invoices?filter=closed",
      "https://example.com/invoices?filter=closed"
    ]

    browser.driverAdapter = /** @type {any} */ ({
      getCurrentUrl: async () => urls.shift() || "https://example.com/invoices?filter=closed",
      getTimeouts: () => 500
    })

    await browser.waitForUrlContains("filter=closed")
    await browser.waitForUrlExcludes("filter=open")
    await browser.waitForCurrentUrl("https://example.com/invoices?filter=closed")
  })

  it("waits for text on elements by test id", async () => {
    const browser = new Browser()
    const findArgs = []
    const waitForTextCalls = []
    const texts = [
      "Removing stale text",
      "Fresh text"
    ]

    browser.driverAdapter = /** @type {any} */ ({
      waitForTestIDText: async (testID, expectedText, args) => {
        waitForTextCalls.push([testID, expectedText, args])
      },
      findByTestID: async (_testID, args) => {
        findArgs.push(args)

        return {
          getText: async () => texts.shift() || "Fresh text"
        }
      },
      getTimeouts: () => 500
    })

    await browser.waitForTestIDText("statusText", "Ready")
    await browser.waitForTestIDTextExcludes("statusText", "stale")

    expect(waitForTextCalls).toEqual([["statusText", "Ready", {timeout: 500}]])
    expect(findArgs).toEqual([
      {timeout: 0},
      {timeout: 0}
    ])
  })

  it("asserts CSS colors by test id", async () => {
    const browser = new Browser()

    browser.driverAdapter = /** @type {any} */ ({
      findByTestID: async () => ({
        getCssValue: async () => "rgb(30 41 59 / 1)"
      })
    })

    await browser.expectTestIDCssColor("panel", "background-color", "30, 41, 59", "255, 255, 255", "panel")
  })

  it("reads visible text through the driver adapter", async () => {
    const browser = new Browser()
    const textCalls = []

    browser.driverAdapter = /** @type {any} */ ({
      text: async (selector, args) => {
        textCalls.push([selector, args])

        return "Visible text"
      }
    })

    expect(await browser.text("body", {visible: null})).toEqual("Visible text")
    expect(textCalls).toEqual([["body", {visible: null}]])
  })

  it("checks selector existence through the driver adapter", async () => {
    const browser = new Browser()
    const existsCalls = []

    browser.driverAdapter = /** @type {any} */ ({
      exists: async (selector, args) => {
        existsCalls.push([selector, args])

        return selector === "#present"
      }
    })

    expect(await browser.exists("#present", {timeout: 0})).toEqual(true)
    expect(await browser.exists("#missing", {timeout: 0})).toEqual(false)
    expect(existsCalls).toEqual([
      ["#present", {timeout: 0}],
      ["#missing", {timeout: 0}]
    ])
  })

  it("rejects CSS color substring matches by test id", async () => {
    const browser = new Browser()

    browser.driverAdapter = /** @type {any} */ ({
      findByTestID: async () => ({
        getCssValue: async () => "rgb(130, 41, 59)"
      })
    })

    await expectAsync(
      browser.expectTestIDCssColor("panel", "background-color", "30, 41, 59", "255, 255, 255", "panel")
    ).toBeRejectedWithError("Expected panel to include rgb(30, 41, 59), got background-color rgb(130, 41, 59)")
  })

  it("replaces input values by test id through shared retryable interactions", async () => {
    const browser = new Browser()
    const calls = []
    const sendFocusedKeysSpy = spyOn(browser, "sendFocusedKeys").and.resolveTo(undefined)

    browser.interact = /** @type {any} */ (async (...args) => {
      calls.push(args)

      if (args[1] === "getProperty") return calls.filter((call) => call[1] === "getProperty").length === 1 ? "Old value" : "Next value"

      return undefined
    })

    await browser.replaceTestIDInputValue("name\"Input", "Next value", {timeout: 250})

    expect(calls.length).toEqual(3)
    expect(calls[0]).toEqual([
      {
        selector: "[data-testid=\"name\\\"Input\"]",
        timeout: 250
      },
      "getProperty",
      "value"
    ])
    expect(calls[1]).toEqual([
      {
        method: "actions",
        selector: "[data-testid=\"name\\\"Input\"]",
        timeout: 250
      },
      "click"
    ])
    expect(calls[2]).toEqual([
      {
        selector: "[data-testid=\"name\\\"Input\"]",
        timeout: 250
      },
      "getProperty",
      "value"
    ])
    expect(sendFocusedKeysSpy.calls.argsFor(0)).toEqual([Key.chord(Key.CONTROL, "a"), Key.BACK_SPACE])
    expect(sendFocusedKeysSpy.calls.argsFor(1)).toEqual(["Next value"])
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
