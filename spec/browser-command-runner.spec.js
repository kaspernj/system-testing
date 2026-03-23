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
})
