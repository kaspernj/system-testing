// @ts-check

import BrowserCommandRunner from "../src/browser-command-runner.js"

describe("BrowserCommandRunner", () => {
  it("routes visit and screenshot commands to the browser", async () => {
    const browser = {
      takeScreenshot: async () => ({screenshotPath: "/tmp/test.png"}),
      visit: async (url, args) => {
        browser.visitCall = {args, url}
      }
    }
    const runner = new BrowserCommandRunner({browser: /** @type {any} */ (browser)})

    expect(await runner.run("visit", {url: "https://example.com"})).toEqual({ok: true})
    expect(browser.visitCall).toEqual({args: {}, url: "https://example.com"})
    expect(await runner.run("takeScreenshot")).toEqual({screenshotPath: "/tmp/test.png"})
  })

  it("passes timeout overrides directly to navigation commands", async () => {
    const browser = {
      dismissTo: async (path, args) => {
        browser.dismissToCall = {args, path}
      },
      dismissToCall: undefined,
      visit: async (url, args) => {
        browser.visitCall = {args, url}
      },
      visitCall: undefined
    }
    const runner = new BrowserCommandRunner({browser: /** @type {any} */ (browser)})

    await runner.run("visit", {timeout: 15000, url: "https://example.com"})
    await runner.run("dismissTo", {path: "/projects", timeout: "1200"})

    expect(browser.visitCall).toEqual({args: {timeout: 15000}, url: "https://example.com"})
    expect(browser.dismissToCall).toEqual({args: {timeout: 1200}, path: "/projects"})
  })

  it("serializes element lookups", async () => {
    const element = {
      getTagName: async () => "button",
      getText: async () => "Save",
      isDisplayed: async () => true
    }
    const browser = {
      findByTestID: async (testID) => {
        browser.foundTestID = testID
        return element
      }
    }
    const runner = new BrowserCommandRunner({browser: /** @type {any} */ (browser)})
    const result = await runner.run("findByTestID", {testID: "saveButton"})

    expect(browser.foundTestID).toBe("saveButton")
    expect(result).toEqual({
      element: {
        displayed: true,
        tagName: "button",
        text: "Save"
      }
    })
  })

  it("passes interact args through to the browser", async () => {
    const browser = {
      interact: async (selectorObject, methodName, ...args) => {
        browser.call = {args, methodName, selectorObject}
        return "typed"
      }
    }
    const runner = new BrowserCommandRunner({browser: /** @type {any} */ (browser)})
    const result = await runner.run("interact", {args: ["hello"], methodName: "sendKeys", selector: "[data-testid='email']"})

    expect(browser.call).toEqual({
      args: ["hello"],
      methodName: "sendKeys",
      selectorObject: {selector: "[data-testid='email']"}
    })
    expect(result).toEqual({result: "typed"})
  })

  it("passes interact fallback flags through to the browser", async () => {
    const browser = {
      interact: async (selectorObject, methodName, ...args) => {
        browser.call = {args, methodName, selectorObject}
        return "typed"
      }
    }
    const runner = new BrowserCommandRunner({browser: /** @type {any} */ (browser)})

    await runner.run("interact", {args: ["hello"], methodName: "sendKeys", selector: "[data-testid='email']", withFallback: "true"})

    expect(browser.call).toEqual({
      args: ["hello"],
      methodName: "sendKeys",
      selectorObject: {selector: "[data-testid='email']", withFallback: true}
    })
  })

  it("does not coerce missing optional finder args into falsey defaults", async () => {
    const browser = {
      find: async (selector, findArgs) => {
        browser.call = {findArgs, selector}
        return {
          getTagName: async () => "div",
          getText: async () => "Hello",
          isDisplayed: async () => true
        }
      }
    }
    const runner = new BrowserCommandRunner({browser: /** @type {any} */ (browser)})

    await runner.run("find", {selector: ".card"})

    expect(browser.call).toEqual({
      findArgs: {},
      selector: ".card"
    })
  })

  it("normalizes scrollTo finder args", async () => {
    const browser = {
      find: async (selector, findArgs) => {
        browser.call = {findArgs, selector}
        return {
          getTagName: async () => "div",
          getText: async () => "Hello",
          isDisplayed: async () => true
        }
      }
    }
    const runner = new BrowserCommandRunner({browser: /** @type {any} */ (browser)})

    await runner.run("find", {scrollTo: "true", selector: ".card"})

    expect(browser.call).toEqual({
      findArgs: {scrollTo: true},
      selector: ".card"
    })
  })

  it("rejects invalid timeout overrides", async () => {
    const browser = {}
    const runner = new BrowserCommandRunner({browser: /** @type {any} */ (browser)})

    await expectAsync(runner.run("visit", {timeout: "invalid", url: "https://example.com"})).toBeRejectedWithError("Invalid timeout: invalid")
  })

  it("forwards executeScript scripts and arguments to the browser and returns the resolved value", async () => {
    const browser = {
      executeScript: async (script, ...args) => {
        browser.call = {args, script}
        return "title-string"
      }
    }
    const runner = new BrowserCommandRunner({browser: /** @type {any} */ (browser)})

    const result = await runner.run("executeScript", {script: "return document.title", args: ["one", 2]})

    expect(browser.call).toEqual({args: ["one", 2], script: "return document.title"})
    expect(result).toEqual({result: "title-string"})
  })

  it("requires a non-empty script for executeScript", async () => {
    const browser = {executeScript: async () => undefined}
    const runner = new BrowserCommandRunner({browser: /** @type {any} */ (browser)})

    await expectAsync(runner.run("executeScript", {})).toBeRejectedWithError("executeScript requires script")
    await expectAsync(runner.run("executeScript", {script: ""})).toBeRejectedWithError("executeScript requires script")
  })

  it("normalizes addCookie payload fields and forwards them to the browser", async () => {
    const browser = {
      addCookie: async (cookie) => {
        browser.call = cookie
      }
    }
    const runner = new BrowserCommandRunner({browser: /** @type {any} */ (browser)})

    const result = await runner.run("addCookie", {
      domain: "127.0.0.1",
      expiry: "1234567890",
      httpOnly: "true",
      name: "tensorbuzz_auth",
      path: "/",
      sameSite: "Lax",
      secure: "false",
      value: "encrypted-cookie-value"
    })

    expect(browser.call).toEqual({
      domain: "127.0.0.1",
      expiry: 1234567890,
      httpOnly: true,
      name: "tensorbuzz_auth",
      path: "/",
      sameSite: "Lax",
      secure: false,
      value: "encrypted-cookie-value"
    })
    expect(result).toEqual({ok: true})
  })

  it("requires name and value for addCookie", async () => {
    const browser = {addCookie: async () => undefined}
    const runner = new BrowserCommandRunner({browser: /** @type {any} */ (browser)})

    await expectAsync(runner.run("addCookie", {value: "x"})).toBeRejectedWithError("addCookie requires name")
    await expectAsync(runner.run("addCookie", {name: "auth"})).toBeRejectedWithError("addCookie requires string value")
    await expectAsync(runner.run("addCookie", {name: "auth", value: 123})).toBeRejectedWithError("addCookie requires string value")
  })

  it("rejects malformed boolean attributes for addCookie instead of silently coercing them", async () => {
    const browser = {
      addCookie: async (cookie) => {
        browser.call = cookie
      }
    }
    const runner = new BrowserCommandRunner({browser: /** @type {any} */ (browser)})

    // A typo like `TRUE` or `1` previously coerced silently to `false`,
    // which would downgrade an intended secure/httpOnly cookie without
    // warning. Both forms must fail loudly.
    await expectAsync(runner.run("addCookie", {name: "auth", secure: "TRUE", value: "x"})).toBeRejectedWithError(/addCookie secure must be true or false/)
    await expectAsync(runner.run("addCookie", {httpOnly: "1", name: "auth", value: "x"})).toBeRejectedWithError(/addCookie httpOnly must be true or false/)
    await expectAsync(runner.run("addCookie", {name: "auth", secure: 1, value: "x"})).toBeRejectedWithError(/addCookie secure must be true or false/)
    expect(browser.call).toBeUndefined()
  })

  it("accepts native and string boolean forms for addCookie", async () => {
    const browser = {
      addCookie: async (cookie) => {
        browser.calls = browser.calls || []
        browser.calls.push(cookie)
      }
    }
    const runner = new BrowserCommandRunner({browser: /** @type {any} */ (browser)})

    await runner.run("addCookie", {httpOnly: true, name: "auth", secure: false, value: "x"})
    await runner.run("addCookie", {httpOnly: "false", name: "auth", secure: "true", value: "x"})

    expect(browser.calls).toEqual([
      {httpOnly: true, name: "auth", secure: false, value: "x"},
      {httpOnly: false, name: "auth", secure: true, value: "x"}
    ])
  })
})
