// @ts-check

import BrowserCommandRunner from "../src/browser-command-runner.js"

describe("BrowserCommandRunner", () => {
  it("routes visit and screenshot commands to the browser", async () => {
    const browser = {
      takeScreenshot: async () => ({screenshotPath: "/tmp/test.png"}),
      visit: async (url) => {
        browser.visitedUrl = url
      }
    }
    const runner = new BrowserCommandRunner({browser: /** @type {any} */ (browser)})

    expect(await runner.run("visit", {url: "https://example.com"})).toEqual({ok: true})
    expect(browser.visitedUrl).toBe("https://example.com")
    expect(await runner.run("takeScreenshot")).toEqual({screenshotPath: "/tmp/test.png"})
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
})
