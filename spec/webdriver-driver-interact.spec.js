// @ts-check

import WebDriverDriver from "../src/drivers/webdriver-driver.js"

describe("WebDriverDriver interact", () => {
  it("falls back to a DOM value setter when sendKeys does not update the field value", async () => {
    const executeScriptCalls = []
    const element = {
      getAttribute: async () => "",
      getText: async () => "",
      sendKeys: async () => null
    }
    const driver = new WebDriverDriver({
      browser: /** @type {any} */ ({
        driver: undefined,
        getSelector: (selector) => selector,
        throwIfHttpServerError: () => {}
      })
    })

    driver._findElement = async () => /** @type {any} */ (element)
    driver.setWebDriver(/** @type {any} */ ({
      executeScript: async (...args) => {
        executeScriptCalls.push(args)
        return "pwd"
      }
    }))

    await driver.interact({selector: "textarea[data-testid='project-environment-agent-input']"}, "sendKeys", "pwd")

    expect(executeScriptCalls.length).toBe(1)
    expect(executeScriptCalls[0][1]).toBe(element)
    expect(executeScriptCalls[0][2]).toBe("pwd")
  })

  it("does not use the DOM value-setter fallback when sendKeys updates the field value", async () => {
    const element = {
      getAttributeCalls: 0,
      getAttribute: async () => {
        element.getAttributeCalls += 1

        return element.getAttributeCalls === 1 ? "" : "pwd"
      },
      getText: async () => "",
      sendKeys: async () => null
    }
    const driver = new WebDriverDriver({
      browser: /** @type {any} */ ({
        driver: undefined,
        getSelector: (selector) => selector,
        throwIfHttpServerError: () => {}
      })
    })
    const executeScriptSpy = jasmine.createSpy("executeScript")

    driver._findElement = async () => /** @type {any} */ (element)
    driver.setWebDriver(/** @type {any} */ ({executeScript: executeScriptSpy}))

    await driver.interact({selector: "textarea[data-testid='project-environment-agent-input']"}, "sendKeys", "pwd")

    expect(executeScriptSpy).not.toHaveBeenCalled()
  })

  it("delegates interact click calls to the driver click helper", async () => {
    const element = {
      click: jasmine.createSpy("elementClick")
    }
    const driver = new WebDriverDriver({
      browser: /** @type {any} */ ({
        driver: undefined,
        getSelector: (selector) => selector,
        throwIfHttpServerError: () => {}
      })
    })
    const clickSpy = jasmine.createSpy("click").and.resolveTo(undefined)

    driver._findElement = async () => /** @type {any} */ (element)
    driver.click = /** @type {any} */ (clickSpy)

    await driver.interact({selector: "[data-testid='project-environment-agent-submit']"}, "click")

    expect(clickSpy).toHaveBeenCalledWith(element)
    expect(element.click).not.toHaveBeenCalled()
  })

  it("dispatches pointer and mouse events for interact press calls", async () => {
    const element = {}
    const executeScriptSpy = jasmine.createSpy("executeScript").and.resolveTo(undefined)
    const driver = new WebDriverDriver({
      browser: /** @type {any} */ ({
        driver: undefined,
        getSelector: (selector) => selector,
        throwIfHttpServerError: () => {}
      })
    })

    driver._findElement = async () => /** @type {any} */ (element)
    driver.setWebDriver(/** @type {any} */ ({executeScript: executeScriptSpy}))

    await driver.interact({selector: "[data-testid='project-environment-agent-submit']"}, "press")

    expect(executeScriptSpy).toHaveBeenCalled()
    expect(executeScriptSpy.calls.mostRecent().args[1]).toBe(element)
  })
})
