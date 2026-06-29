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

  it("binds to loopback by default", () => {
    const browserProcess = new BrowserProcess({browser: /** @type {any} */ ({}), name: "spec-browser"})

    expect(browserProcess.host).toEqual("127.0.0.1")
  })

  it("rejects browser commands when a token is configured but missing", async () => {
    const browserProcess = new BrowserProcess({browser: /** @type {any} */ ({}), name: "spec-browser", token: "secret"})

    await expectAsync(
      browserProcess.handlePayload({command: "visit", type: "browser-command", url: "https://example.com"})
    ).toBeRejectedWithError("Browser daemon command rejected: invalid or missing token")
  })

  it("rejects browser commands when the token is wrong", async () => {
    const browserProcess = new BrowserProcess({browser: /** @type {any} */ ({}), name: "spec-browser", token: "secret"})

    await expectAsync(
      browserProcess.handlePayload({command: "visit", token: "nope", type: "browser-command", url: "https://example.com"})
    ).toBeRejectedWithError("Browser daemon command rejected: invalid or missing token")
  })

  it("runs browser commands when the correct token is presented", async () => {
    const browser = {
      visit: async (url) => {
        browser.visitedUrl = url
      }
    }
    const browserProcess = new BrowserProcess({browser: /** @type {any} */ (browser), name: "spec-browser", token: "secret"})

    expect(await browserProcess.handlePayload({command: "visit", token: "secret", type: "browser-command", url: "https://example.com"})).toEqual({ok: true})
    expect(browser.visitedUrl).toBe("https://example.com")
  })

  it("allows the describe command without a token", async () => {
    const browserProcess = new BrowserProcess({browser: /** @type {any} */ ({}), name: "spec-browser", token: "secret"})
    browserProcess.port = 6543

    await expectAsync(browserProcess.handlePayload({command: "describe", type: "browser-daemon"})).toBeResolvedTo({
      name: "spec-browser",
      pid: process.pid,
      port: 6543
    })
  })

  it("excludes the token from the registry entry", () => {
    const browserProcess = new BrowserProcess({browser: /** @type {any} */ ({}), name: "spec-browser", token: "secret"})
    browserProcess.port = 6543

    const entry = browserProcess.buildRegistryEntry()

    expect(entry.token).toBeUndefined()
    expect(JSON.stringify(entry)).not.toContain("secret")
    expect(entry.name).toEqual("spec-browser")
    expect(entry.port).toEqual(6543)
  })
})
