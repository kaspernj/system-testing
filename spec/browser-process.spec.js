// @ts-check

import BrowserProcess from "../src/browser-process.js"

describe("BrowserProcess", () => {
  it("accepts top-level websocket payload fields", async () => {
    const browser = {
      visit: async (url) => {
        browser.visitedUrl = url
      }
    }
    const browserProcess = new BrowserProcess({browser: /** @type {any} */ (browser), name: "spec-browser"})

    expect(await browserProcess.handlePayload({command: "visit", type: "browser-command", url: "https://example.com"})).toEqual({ok: true})
    expect(browser.visitedUrl).toBe("https://example.com")
  })

  it("rejects unknown payload types", async () => {
    const browserProcess = new BrowserProcess({browser: /** @type {any} */ ({}), name: "spec-browser"})

    await expectAsync(browserProcess.handlePayload({type: "other"})).toBeRejectedWithError("Unknown payload type: other")
  })

  it("describes the daemon identity for registry verification", async () => {
    const browserProcess = new BrowserProcess({browser: /** @type {any} */ ({}), name: "spec-browser"})
    browserProcess.port = 6543

    await expectAsync(browserProcess.handlePayload({command: "describe", type: "browser-daemon"})).toBeResolvedTo({
      name: "spec-browser",
      pid: process.pid,
      port: 6543
    })
  })
})
