import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import AppiumDriver, {androidDescriptionContainsSelector, androidResourceIdSelector, androidTextContainsSelector, ensureChromeUserDataDirCapability} from "../src/drivers/appium-driver.js"

describe("AppiumDriver", () => {
  it("adds a dedicated user-data-dir for Chrome sessions", async () => {
    const tempRootDir = await fs.mkdtemp(path.join(os.tmpdir(), "system-testing-appium-driver-"))
    const capabilities = {
      browserName: "chrome",
      "goog:chromeOptions": {
        args: ["--headless=new"]
      }
    }

    try {
      const userDataDir = await ensureChromeUserDataDirCapability({
        browserName: "chrome",
        capabilities,
        tempRootDir
      })

      expect(typeof userDataDir).toBe("string")
      expect(capabilities["goog:chromeOptions"].args).toContain(`--user-data-dir=${userDataDir}`)
      await expectAsync(fs.stat(userDataDir)).toBeResolved()
    } finally {
      await fs.rm(tempRootDir, {recursive: true, force: true})
    }
  })

  it("keeps explicit user-data-dir chrome args untouched", async () => {
    const tempRootDir = await fs.mkdtemp(path.join(os.tmpdir(), "system-testing-appium-driver-"))
    const capabilities = {
      browserName: "chrome",
      "goog:chromeOptions": {
        args: ["--headless=new", "--user-data-dir=/custom/profile"]
      }
    }

    try {
      const userDataDir = await ensureChromeUserDataDirCapability({
        browserName: "chrome",
        capabilities,
        tempRootDir
      })

      expect(userDataDir).toBeUndefined()
      expect(capabilities["goog:chromeOptions"].args).toEqual(["--headless=new", "--user-data-dir=/custom/profile"])
    } finally {
      await fs.rm(tempRootDir, {recursive: true, force: true})
    }
  })

  it("does not add desktop Chrome profile args for Android Chrome sessions", async () => {
    const tempRootDir = await fs.mkdtemp(path.join(os.tmpdir(), "system-testing-appium-driver-"))
    const capabilities = {
      browserName: "Chrome",
      platformName: "Android"
    }

    try {
      const userDataDir = await ensureChromeUserDataDirCapability({
        browserName: "Chrome",
        capabilities,
        tempRootDir
      })

      expect(userDataDir).toBeUndefined()
      expect(capabilities["goog:chromeOptions"]).toBeUndefined()
    } finally {
      await fs.rm(tempRootDir, {recursive: true, force: true})
    }
  })

  it("builds Android resource-id selectors for raw React Native test IDs", () => {
    expect(androidResourceIdSelector("systemTestingComponent")).toEqual('new UiSelector().resourceIdMatches("(^|.*:id/)systemTestingComponent$")')
    expect(androidResourceIdSelector("project.board/item[1]")).toEqual('new UiSelector().resourceIdMatches("(^|.*:id/)project\\\\.board/item\\\\[1\\\\]$")')
  })

  it("builds Android text and accessibility-label selectors", () => {
    expect(androidTextContainsSelector('Project "A"')).toEqual('new UiSelector().textContains("Project \\"A\\"")')
    expect(androidDescriptionContainsSelector("Line\\Item")).toEqual('new UiSelector().descriptionContains("Line\\\\Item")')
  })

  it("uses Android resource-id selectors for native Android app id lookups", () => {
    const driver = new AppiumDriver({
      browser: {
        getSelector: (selector) => selector,
        throwIfHttpServerError: () => {}
      },
      options: {
        capabilities: {
          platformName: "Android"
        }
      }
    })

    const locator = driver.idLocator("systemTestingComponent")

    expect(locator.using).toEqual("-android uiautomator")
    expect(locator.value).toEqual('new UiSelector().resourceIdMatches("(^|.*:id/)systemTestingComponent$")')
  })

  it("finds native text through visible text and accessibility label selectors", async () => {
    const element = {getId: async () => "native-text-element"}
    const driver = new AppiumDriver({
      browser: {
        driver: undefined,
        getSelector: (selector) => selector,
        throwIfHttpServerError: () => {}
      },
      options: {
        capabilities: {
          platformName: "Android"
        }
      }
    })
    const setTimeouts = jasmine.createSpy("setTimeouts").and.resolveTo()
    const findElements = jasmine.createSpy("findElements").and.callFake(async (locator) => {
      if (locator.value === androidDescriptionContainsSelector("Native Project")) return [element]

      return []
    })

    driver.setWebDriver(/** @type {import("selenium-webdriver").WebDriver} */ ({
      findElements,
      manage: () => ({
        getTimeouts: async () => ({implicit: 5000}),
        setTimeouts
      })
    }))

    await expectAsync(driver.findByNativeText("Native Project", {timeout: 0})).toBeResolvedTo(element)
    expect(findElements.calls.allArgs().map(([locator]) => locator.value)).toContain(androidTextContainsSelector("Native Project"))
    expect(setTimeouts.calls.allArgs()).toEqual([[{implicit: 0}], [{implicit: 5000}]])
  })

  it("waits for native text scoped to a test id", async () => {
    const element = {getId: async () => "native-test-id-text-element"}
    const driver = new AppiumDriver({
      browser: {
        driver: undefined,
        getSelector: (selector) => selector,
        throwIfHttpServerError: () => {}
      },
      options: {
        capabilities: {
          platformName: "Android"
        }
      }
    })
    const setTimeouts = jasmine.createSpy("setTimeouts").and.resolveTo()
    const findElements = jasmine.createSpy("findElements").and.callFake(async (locator) => {
      if (locator.value === 'new UiSelector().resourceIdMatches("(^|.*:id/)userShowScreen/email/row$").childSelector(new UiSelector().textContains("native@example.com"))') {
        return [element]
      }

      return []
    })

    driver.setWebDriver(/** @type {import("selenium-webdriver").WebDriver} */ ({
      findElements,
      manage: () => ({
        getTimeouts: async () => ({implicit: 5000}),
        setTimeouts
      })
    }))

    await expectAsync(driver.waitForTestIDText("userShowScreen/email/row", "native@example.com", {timeout: 0})).toBeResolved()
    expect(setTimeouts.calls.allArgs()).toEqual([[{implicit: 0}], [{implicit: 5000}]])
  })

  it("scrolls native id lookups with caller-provided scroll containers", async () => {
    const element = {getId: async () => "native-id-element"}
    const targetSelector = androidResourceIdSelector("projectShowScreen/editButton")
    const scrollContainerSelector = androidResourceIdSelector("boardLayout/content/scroll")
    const driver = new AppiumDriver({
      browser: {
        driver: undefined,
        getSelector: (selector) => selector,
        throwIfHttpServerError: () => {}
      },
      options: {
        capabilities: {
          platformName: "Android"
        }
      }
    })
    let directLookups = 0
    const setTimeouts = jasmine.createSpy("setTimeouts").and.resolveTo()
    const findElements = jasmine.createSpy("findElements").and.callFake(async (locator) => {
      if (locator.value === targetSelector) {
        directLookups += 1
        return directLookups > 1 ? [element] : []
      }

      return []
    })

    driver.setWebDriver(/** @type {import("selenium-webdriver").WebDriver} */ ({
      findElements,
      manage: () => ({
        getTimeouts: async () => ({implicit: 5000}),
        setTimeouts
      })
    }))

    await expectAsync(driver.findById("projectShowScreen/editButton", {
      scrollContainerTestIDs: ["boardLayout/content/scroll"],
      scrollTo: true,
      timeout: 0
    })).toBeResolvedTo(element)

    const locatorValues = findElements.calls.allArgs().map(([locator]) => locator.value)
    expect(locatorValues).toContain(`new UiScrollable(${scrollContainerSelector}).scrollIntoView(${targetSelector})`)
    expect(locatorValues).toContain(`new UiScrollable(new UiSelector().scrollable(true)).scrollIntoView(${targetSelector})`)
    expect(setTimeouts.calls.allArgs()).toEqual([[{implicit: 0}], [{implicit: 5000}]])
  })

  it("searches upward when a native id is above the retained viewport offset", async () => {
    const element = {getId: async () => "native-id-element"}
    const targetSelector = androidResourceIdSelector("userShowScreen/email/row")
    const driver = new AppiumDriver({
      browser: {
        driver: undefined,
        getSelector: (selector) => selector,
        throwIfHttpServerError: () => {}
      },
      options: {
        capabilities: {
          platformName: "Android"
        }
      }
    })
    const scrollDirections = []
    let scrolledUp = false
    const findElements = jasmine.createSpy("findElements").and.callFake(async (locator) => {
      if (locator.value === targetSelector) return scrolledUp ? [element] : []

      return []
    })

    driver.setWebDriver(/** @type {import("selenium-webdriver").WebDriver} */ ({
      executeScript: jasmine.createSpy("executeScript").and.callFake(async (script, args) => {
        if (script !== "mobile: scrollGesture") return undefined

        scrollDirections.push(args.direction)
        if (args.direction === "up") scrolledUp = true
        return true
      }),
      findElements,
      manage: () => ({
        getTimeouts: async () => ({implicit: 5000}),
        setTimeouts: async () => {},
        window: () => ({
          getRect: async () => ({x: 0, y: 0, width: 400, height: 800})
        })
      })
    }))

    await expectAsync(driver.findById("userShowScreen/email/row", {
      scrollTo: true,
      timeout: 0
    })).toBeResolvedTo(element)

    expect(scrollDirections).toEqual(["up"])
  })

  it("continues downward after upward native viewport scanning misses", async () => {
    const element = {getId: async () => "native-id-element"}
    const targetSelector = androidResourceIdSelector("organizationShowScreen/project-1/title")
    const driver = new AppiumDriver({
      browser: {
        driver: undefined,
        getSelector: (selector) => selector,
        throwIfHttpServerError: () => {}
      },
      options: {
        capabilities: {
          platformName: "Android"
        }
      }
    })
    const scrollDirections = []
    let downScrolls = 0
    const findElements = jasmine.createSpy("findElements").and.callFake(async (locator) => {
      if (locator.value === targetSelector) return downScrolls >= 2 ? [element] : []

      return []
    })

    driver.setWebDriver(/** @type {import("selenium-webdriver").WebDriver} */ ({
      executeScript: jasmine.createSpy("executeScript").and.callFake(async (script, args) => {
        if (script !== "mobile: scrollGesture") return undefined

        scrollDirections.push(args.direction)
        if (args.direction === "down") downScrolls += 1
        return true
      }),
      findElements,
      manage: () => ({
        getTimeouts: async () => ({implicit: 5000}),
        setTimeouts: async () => {},
        window: () => ({
          getRect: async () => ({x: 0, y: 0, width: 400, height: 800})
        })
      })
    }))

    await expectAsync(driver.findById("organizationShowScreen/project-1/title", {
      scrollTo: true,
      timeout: 0
    })).toBeResolvedTo(element)

    expect(scrollDirections.slice(0, 4)).toEqual(["up", "down", "up", "down"])
    expect(scrollDirections.filter((direction) => direction === "down").length).toEqual(2)
  })

  it("falls back to W3C actions when native mobile scroll gestures are unsupported", async () => {
    let actionsCommand
    const execute = jasmine.createSpy("execute").and.callFake(async (command) => {
      actionsCommand = command
    })
    const driver = new AppiumDriver({
      browser: {
        driver: undefined,
        getSelector: (selector) => selector,
        throwIfHttpServerError: () => {}
      },
      options: {
        capabilities: {
          platformName: "Android"
        }
      }
    })

    driver.setWebDriver(/** @type {import("selenium-webdriver").WebDriver} */ ({
      execute,
      executeScript: jasmine.createSpy("executeScript").and.rejectWith(new Error("Unknown mobile command")),
      findElements: jasmine.createSpy("findElements").and.resolveTo([]),
      manage: () => ({
        getTimeouts: async () => ({implicit: 5000}),
        setTimeouts: async () => {},
        window: () => ({
          getRect: async () => ({x: 0, y: 0, width: 400, height: 800})
        })
      })
    }))

    await expectAsync(driver.findByNativeText("Missing text", {timeout: 0})).toBeRejectedWithError(/Element couldn't be found/)
    if (!actionsCommand) throw new Error("Expected W3C actions command")
    const pointerAction = actionsCommand.getParameter("actions")[0]

    expect(pointerAction.parameters.pointerType).toEqual("touch")
    expect(pointerAction.actions.map((action) => action.type)).toEqual(["pointerMove", "pointerDown", "pointerMove", "pointerUp"])
  })

  it("cleans up the generated Chrome user-data-dir on stop", async () => {
    const tempRootDir = await fs.mkdtemp(path.join(os.tmpdir(), "system-testing-appium-driver-"))
    const chromeUserDataDir = path.join(tempRootDir, "profile")
    const browser = {
      driver: undefined,
      getSelector: (selector) => selector,
      throwIfHttpServerError: () => {}
    }
    const driver = new AppiumDriver({browser})

    await fs.mkdir(chromeUserDataDir, {recursive: true})
    driver.chromeUserDataDir = chromeUserDataDir
    driver.appiumServer = {close: async () => {}}

    await driver.stop()

    await expectAsync(fs.stat(chromeUserDataDir)).toBeRejected()
    await fs.rm(tempRootDir, {recursive: true, force: true})
  })
})
