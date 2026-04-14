// @ts-check

import {Key, error as SeleniumError} from "selenium-webdriver"
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

    await driver.interact({selector: "textarea[data-testid='project-environment-agent-input']", withFallback: true}, "sendKeys", "pwd")

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

    await driver.interact({selector: "textarea[data-testid='project-environment-agent-input']", withFallback: true}, "sendKeys", "pwd")

    expect(executeScriptSpy).not.toHaveBeenCalled()
  })

  it("does not use the DOM value-setter fallback unless explicitly requested", async () => {
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
    const executeScriptSpy = jasmine.createSpy("executeScript")

    driver._findElement = async () => /** @type {any} */ (element)
    driver.setWebDriver(/** @type {any} */ ({executeScript: executeScriptSpy}))

    await driver.interact({selector: "textarea[data-testid='project-environment-agent-input']"}, "sendKeys", "pwd")

    expect(executeScriptSpy).not.toHaveBeenCalled()
  })

  it("strips withFallback before selector lookup and preserves regular find args", async () => {
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
    const findSpy = jasmine.createSpy("find").and.resolveTo(element)

    driver.find = /** @type {any} */ (findSpy)
    driver.setWebDriver(/** @type {any} */ ({
      executeScript: async (...args) => {
        executeScriptCalls.push(args)
        return "pwd"
      }
    }))

    await driver.interact({selector: "textarea[data-testid='project-environment-agent-input']", visible: false, withFallback: true}, "sendKeys", "pwd")

    expect(findSpy).toHaveBeenCalledWith("textarea[data-testid='project-environment-agent-input']", {visible: false})
    expect(executeScriptCalls.length).toBe(1)
  })

  it("delegates interact click calls for webdriver elements to the driver click helper", async () => {
    const element = {
      getId: async () => "webdriver-element-id",
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

    expect(clickSpy).toHaveBeenCalledWith(element, {})
    expect(element.click).not.toHaveBeenCalled()
  })

  it("passes scrollTo through interact click calls for webdriver elements", async () => {
    const element = {
      getId: async () => "webdriver-element-id",
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

    await driver.interact({selector: "[data-testid='project-environment-agent-submit']", scrollTo: true}, "click")

    expect(clickSpy).toHaveBeenCalledWith(element, {scrollTo: true})
    expect(element.click).not.toHaveBeenCalled()
  })

  it("passes the actions click method through interact click calls for webdriver elements", async () => {
    const element = {
      getId: async () => "webdriver-element-id",
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

    await driver.interact({selector: "[data-testid='project-environment-agent-submit']", method: "actions", scrollTo: true}, "click")

    expect(clickSpy).toHaveBeenCalledWith(element, {method: "actions", scrollTo: true})
    expect(element.click).not.toHaveBeenCalled()
  })

  it("strips interact-only selector args before element lookup for click interactions", async () => {
    const element = {
      getId: async () => "webdriver-element-id",
      click: jasmine.createSpy("elementClick")
    }
    const driver = new WebDriverDriver({
      browser: /** @type {any} */ ({
        driver: undefined,
        getSelector: (selector) => selector,
        throwIfHttpServerError: () => {}
      })
    })
    const findElementSpy = jasmine.createSpy("_findElement").and.resolveTo(element)
    const clickSpy = jasmine.createSpy("click").and.resolveTo(undefined)

    driver._findElement = /** @type {any} */ (findElementSpy)
    driver.click = /** @type {any} */ (clickSpy)

    await driver.interact({selector: "[data-testid='project-environment-agent-submit']", method: "actions", scrollTo: true}, "click")

    expect(findElementSpy).toHaveBeenCalledWith("[data-testid='project-environment-agent-submit']", {scrollTo: true})
    expect(clickSpy).toHaveBeenCalledWith(element, {method: "actions", scrollTo: true})
  })

  it("passes scrollTo through to the element lookup for non-click interact methods", async () => {
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
    const findSpy = jasmine.createSpy("find").and.resolveTo(element)

    driver.find = /** @type {any} */ (findSpy)
    driver.setWebDriver(/** @type {any} */ ({executeScript: jasmine.createSpy("executeScript")}))

    await driver.interact({selector: "textarea[data-testid='project-environment-agent-input']", scrollTo: true}, "sendKeys", "pwd")

    expect(findSpy).toHaveBeenCalledWith("textarea[data-testid='project-environment-agent-input']", {scrollTo: true})
  })

  it("uses a plain element click by default", async () => {
    const element = {
      click: jasmine.createSpy("elementClick").and.resolveTo(undefined),
      getId: async () => "webdriver-element-id"
    }
    const driver = new WebDriverDriver({
      browser: /** @type {any} */ ({
        driver: undefined,
        getSelector: (selector) => selector,
        throwIfHttpServerError: () => {}
      })
    })
    const scrollSpy = jasmine.createSpy("scrollElementIntoView").and.resolveTo(undefined)
    const actionsSpy = jasmine.createSpy("actions")

    driver._findElement = async () => /** @type {any} */ (element)
    driver.scrollElementIntoView = /** @type {any} */ (scrollSpy)
    driver.setWebDriver(/** @type {any} */ ({actions: actionsSpy}))

    await driver.click(element)

    expect(scrollSpy).not.toHaveBeenCalled()
    expect(actionsSpy).not.toHaveBeenCalled()
    expect(element.click).toHaveBeenCalled()
  })

  it("does not scroll normal webdriver clicks into view unless explicitly requested", async () => {
    const element = {
      click: jasmine.createSpy("elementClick").and.resolveTo(undefined),
      getId: async () => "webdriver-element-id"
    }
    const driver = new WebDriverDriver({
      browser: /** @type {any} */ ({
        driver: undefined,
        getSelector: (selector) => selector,
        throwIfHttpServerError: () => {}
      })
    })
    const scrollSpy = jasmine.createSpy("scrollElementIntoView").and.resolveTo(undefined)

    driver._findElement = async () => /** @type {any} */ (element)
    driver.scrollElementIntoView = /** @type {any} */ (scrollSpy)

    await driver.click(element)

    expect(scrollSpy).not.toHaveBeenCalled()
    expect(element.click).toHaveBeenCalled()
  })

  it("scrolls normal webdriver clicks into view when requested", async () => {
    const element = {
      click: jasmine.createSpy("elementClick").and.resolveTo(undefined),
      getId: async () => "webdriver-element-id"
    }
    const driver = new WebDriverDriver({
      browser: /** @type {any} */ ({
        driver: undefined,
        getSelector: (selector) => selector,
        throwIfHttpServerError: () => {}
      })
    })
    const scrollSpy = jasmine.createSpy("scrollElementIntoView").and.resolveTo(undefined)

    driver._findElement = async () => /** @type {any} */ (element)
    driver.scrollElementIntoView = /** @type {any} */ (scrollSpy)

    await driver.click(element, {scrollTo: true})

    expect(scrollSpy).toHaveBeenCalledWith(element)
    expect(element.click).toHaveBeenCalled()
  })

  it("strips click-only selector args before element lookup", async () => {
    const element = {
      click: jasmine.createSpy("elementClick").and.resolveTo(undefined),
      getId: async () => "webdriver-element-id"
    }
    const driver = new WebDriverDriver({
      browser: /** @type {any} */ ({
        driver: undefined,
        getSelector: (selector) => selector,
        throwIfHttpServerError: () => {}
      })
    })
    const findElementSpy = jasmine.createSpy("_findElement").and.resolveTo(element)
    const scrollSpy = jasmine.createSpy("scrollElementIntoView").and.resolveTo(undefined)
    const performSpy = jasmine.createSpy("perform").and.resolveTo(undefined)
    const clickSpy = jasmine.createSpy("click").and.returnValue({perform: performSpy})
    const moveSpy = jasmine.createSpy("move").and.returnValue({click: clickSpy})
    const actionsSpy = jasmine.createSpy("actions").and.returnValue({move: moveSpy})

    driver._findElement = /** @type {any} */ (findElementSpy)
    driver.scrollElementIntoView = /** @type {any} */ (scrollSpy)
    driver.setWebDriver(/** @type {any} */ ({actions: actionsSpy}))

    await driver.click("[data-testid='project-environment-agent-submit']", {method: "actions", scrollTo: true, visible: false})

    expect(findElementSpy).toHaveBeenCalledWith("[data-testid='project-environment-agent-submit']", {visible: false})
    expect(scrollSpy).toHaveBeenCalledWith(element)
    expect(actionsSpy).toHaveBeenCalledWith({async: true})
    expect(moveSpy).toHaveBeenCalledWith({origin: element})
    expect(clickSpy).toHaveBeenCalled()
    expect(performSpy).toHaveBeenCalled()
    expect(element.click).not.toHaveBeenCalled()
  })

  it("does not scroll webdriver action clicks into view unless explicitly requested", async () => {
    const element = {
      getId: async () => "webdriver-element-id"
    }
    /** @type {{click: jasmine.Spy, move: jasmine.Spy, perform: jasmine.Spy}} */
    const actions = /** @type {any} */ ({})
    actions.click = jasmine.createSpy("click").and.returnValue(actions)
    actions.move = jasmine.createSpy("move").and.returnValue(actions)
    actions.perform = jasmine.createSpy("perform").and.resolveTo(undefined)
    const driver = new WebDriverDriver({
      browser: /** @type {any} */ ({
        driver: undefined,
        getSelector: (selector) => selector,
        throwIfHttpServerError: () => {}
      })
    })
    const scrollSpy = jasmine.createSpy("scrollElementIntoView").and.resolveTo(undefined)

    driver._findElement = async () => /** @type {any} */ (element)
    driver.scrollElementIntoView = /** @type {any} */ (scrollSpy)
    driver.setWebDriver(/** @type {any} */ ({
      actions: () => actions
    }))

    await driver.click(element, {method: "actions"})

    expect(scrollSpy).not.toHaveBeenCalled()
    expect(actions.move).toHaveBeenCalledWith({origin: element})
    expect(actions.click).toHaveBeenCalled()
    expect(actions.perform).toHaveBeenCalled()
  })

  it("scrolls webdriver action clicks into view when requested", async () => {
    const element = {
      getId: async () => "webdriver-element-id"
    }
    /** @type {{click: jasmine.Spy, move: jasmine.Spy, perform: jasmine.Spy}} */
    const actions = /** @type {any} */ ({})
    actions.click = jasmine.createSpy("click").and.returnValue(actions)
    actions.move = jasmine.createSpy("move").and.returnValue(actions)
    actions.perform = jasmine.createSpy("perform").and.resolveTo(undefined)
    const driver = new WebDriverDriver({
      browser: /** @type {any} */ ({
        driver: undefined,
        getSelector: (selector) => selector,
        throwIfHttpServerError: () => {}
      })
    })
    const scrollSpy = jasmine.createSpy("scrollElementIntoView").and.resolveTo(undefined)

    driver._findElement = async () => /** @type {any} */ (element)
    driver.scrollElementIntoView = /** @type {any} */ (scrollSpy)
    driver.setWebDriver(/** @type {any} */ ({
      actions: () => actions
    }))

    await driver.click(element, {method: "actions", scrollTo: true})

    expect(scrollSpy).toHaveBeenCalledWith(element)
    expect(actions.move).toHaveBeenCalledWith({origin: element})
    expect(actions.click).toHaveBeenCalled()
    expect(actions.perform).toHaveBeenCalled()
  })

  it("calls plain element click handlers directly for non-webdriver elements", async () => {
    const element = {
      click: jasmine.createSpy("elementClick").and.resolveTo("clicked")
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

    const result = await driver.interact({selector: "[data-testid='project-environment-agent-submit']"}, "click")

    expect(clickSpy).not.toHaveBeenCalled()
    expect(element.click).toHaveBeenCalled()
    expect(result).toBe("clicked")
  })

  it("retries interact clicks when the webdriver click helper wraps a stale-element error", async () => {
    const elements = [
      {getId: async () => "stale-element"},
      {getId: async () => "fresh-element"}
    ]
    const driver = new WebDriverDriver({
      browser: /** @type {any} */ ({
        driver: undefined,
        getSelector: (selector) => selector,
        throwIfHttpServerError: () => {}
      })
    })
    let findElementCalls = 0
    const clickSpy = jasmine.createSpy("click").and.callFake(async () => {
      if (findElementCalls === 1) {
        throw new Error("wrapped stale element", {cause: new SeleniumError.StaleElementReferenceError("element is stale")})
      }

      return undefined
    })

    driver._findElement = async () => /** @type {any} */ (elements[findElementCalls++])
    driver.click = /** @type {any} */ (clickSpy)

    await driver.interact({selector: "[data-testid='project-environment-agent-submit']"}, "click")

    expect(findElementCalls).toBe(2)
    expect(clickSpy.calls.count()).toBe(2)
  })

  it("does not append webdriver control keys in the DOM value-setter fallback", async () => {
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
        return null
      }
    }))

    await driver.interact({selector: "textarea[data-testid='project-environment-agent-input']", withFallback: true}, "sendKeys", Key.ENTER)

    expect(executeScriptCalls).toEqual([])
  })

  it("replaces the current value when sendKeys uses select-all and delete", async () => {
    const executeScriptCalls = []
    const element = {
      value: "old",
      getAttribute: async () => element.value,
      getId: async () => "webdriver-element-id",
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
    const clickSpy = jasmine.createSpy("click").and.resolveTo(undefined)

    driver._findElement = async () => /** @type {any} */ (element)
    driver.click = /** @type {any} */ (clickSpy)
    driver.setWebDriver(/** @type {any} */ ({
      executeScript: async (...args) => {
        executeScriptCalls.push(args)
        element.value = args[2]
        return args[2]
      }
    }))

    await driver.interact(
      {selector: "textarea[data-testid='project-environment-agent-input']", withFallback: true},
      "sendKeys",
      Key.chord(Key.CONTROL, "a"),
      Key.BACK_SPACE,
      "new"
    )

    expect(clickSpy).not.toHaveBeenCalled()
    expect(executeScriptCalls.length).toBe(1)
    expect(executeScriptCalls[0][2]).toBe("new")
  })

  it("scrolls an element into view with webdriver actions first", async () => {
    const element = {
      getId: async () => "webdriver-element-id"
    }
    const performSpy = jasmine.createSpy("perform").and.resolveTo(undefined)
    const moveSpy = jasmine.createSpy("move").and.returnValue({perform: performSpy})
    const driver = new WebDriverDriver({
      browser: /** @type {any} */ ({
        driver: undefined,
        getSelector: (selector) => selector,
        throwIfHttpServerError: () => {}
      })
    })
    const executeScriptSpy = jasmine.createSpy("executeScript")
    const webDriver = {
      actions: jasmine.createSpy("actions").and.returnValue({move: moveSpy}),
      executeScript: executeScriptSpy
    }

    driver._findElement = async () => /** @type {any} */ (element)
    driver.setWebDriver(/** @type {any} */ (webDriver))
    driver.isElementInViewport = /** @type {any} */ (jasmine.createSpy("isElementInViewport").and.resolveTo(true))

    await driver.scrollIntoView({selector: "[data-testid='project-environment-agent-submit']"})

    expect(webDriver.actions).toHaveBeenCalledWith({async: true})
    expect(moveSpy).toHaveBeenCalledWith({origin: element})
    expect(performSpy).toHaveBeenCalled()
    expect(executeScriptSpy).not.toHaveBeenCalled()
  })

  it("filters the known Chrome password-not-in-form warning from browser logs", async () => {
    const driver = new WebDriverDriver({
      browser: /** @type {any} */ ({
        driver: undefined,
        getSelector: (selector) => selector,
        throwIfHttpServerError: () => {}
      })
    })

    driver.setWebDriver(/** @type {any} */ ({
      manage: () => ({
        logs: () => ({
          get: async () => ([
            {level: {name: "DEBUG"}, message: "http://127.0.0.1:8085/sign-in 0:0 [DOM] Password field is not contained in a form: (More info: https://goo.gl/9p2vKq) %o"},
            {level: {name: "INFO"}, message: "http://127.0.0.1:8085/sign-in 0:0 Something useful"}
          ])
        })
      })
    }))

    expect(await driver.getBrowserLogs()).toEqual(["INFO: Something useful"])
  })
})
