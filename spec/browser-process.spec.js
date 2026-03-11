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
})
