// @ts-check

import {Key} from "selenium-webdriver"
import SystemTest from "../src/system-test.js"
import SystemTestHelper from "./support/system-test-helper.js"

const systemTestHelper = new SystemTestHelper()
systemTestHelper.installJasmineHooks()
const isNative = process.env.SYSTEM_TEST_NATIVE === "true"
const itIfWeb = isNative ? xit : it

describe("SystemTest interact", () => {
  it("retries on StaleElementReferenceError", async () => {
    const systemTest = systemTestHelper.getSystemTest()
    const driverAdapter = systemTest.getDriverAdapter()
    const originalFindElement = driverAdapter._findElement
    let findCalls = 0

    class StaleElementReferenceError extends Error {}

    const staleElement = {
      click: async () => {
        throw new StaleElementReferenceError("Element is stale")
      }
    }

    const freshElement = {
      click: async () => "ok"
    }

    driverAdapter._findElement = async () => {
      findCalls += 1
      return findCalls === 1 ? staleElement : freshElement
    }

    try {
      const result = await systemTest.interact("#stale-target", "click")

      expect(result).toBe("ok")
      expect(findCalls).toBe(2)
    } finally {
      driverAdapter._findElement = originalFindElement
    }
  })

  itIfWeb("accepts selector objects with finder args", async () => {
    await SystemTest.run(async (runningSystemTest) => {
      const originalBaseSelector = runningSystemTest.getBaseSelector()

      try {
        runningSystemTest.setBaseSelector("#does-not-exist")

        await runningSystemTest.getDriver().executeScript(`
          const elementId = "system-test-interact-target"
          let element = document.getElementById(elementId)

          if (element) {
            element.remove()
          }

          element = document.createElement("button")
          element.id = elementId
          element.setAttribute("data-testid", "scanFooterMenuButton")
          element.style.position = "fixed"
          element.style.top = "12px"
          element.style.left = "12px"
          element.style.zIndex = "9999"
          element.textContent = "Interact target"
          element.addEventListener("click", () => {
            element.setAttribute("data-clicked", "true")
          })
          document.body.appendChild(element)
          return true
        `)

        await runningSystemTest.interact({selector: "[data-testid='scanFooterMenuButton']", useBaseSelector: false}, "click")

        const wasClicked = await runningSystemTest.getDriver().executeScript(`
          const element = document.querySelector("[data-testid='scanFooterMenuButton']")
          return element?.getAttribute("data-clicked") === "true"
        `)

        expect(wasClicked).toBeTrue()
      } finally {
        if (originalBaseSelector) {
          runningSystemTest.setBaseSelector(originalBaseSelector)
        }

        await runningSystemTest.getDriver().executeScript(`
          const element = document.getElementById("system-test-interact-target")
          if (element) element.remove()
          return true
        `)
      }
    })
  })

  itIfWeb("dispatches element.click() via executeScript when method:'js' is set", async () => {
    await SystemTest.run(async (runningSystemTest) => {
      const originalBaseSelector = runningSystemTest.getBaseSelector()

      try {
        runningSystemTest.setBaseSelector("#does-not-exist")

        await runningSystemTest.getDriver().executeScript(`
          const elementId = "system-test-interact-js-target"
          let element = document.getElementById(elementId)

          if (element) {
            element.remove()
          }

          element = document.createElement("button")
          element.id = elementId
          element.setAttribute("data-testid", "systemTestJsClickTarget")
          element.style.position = "fixed"
          element.style.top = "12px"
          element.style.left = "12px"
          element.style.zIndex = "9999"
          element.textContent = "JS click target"
          element.addEventListener("click", () => {
            element.setAttribute("data-clicked", "true")
          })
          document.body.appendChild(element)
          return true
        `)

        await runningSystemTest.interact({selector: "[data-testid='systemTestJsClickTarget']", method: "js", useBaseSelector: false}, "click")

        const wasClicked = await runningSystemTest.getDriver().executeScript(`
          const element = document.querySelector("[data-testid='systemTestJsClickTarget']")
          return element?.getAttribute("data-clicked") === "true"
        `)

        expect(wasClicked).toBeTrue()
      } finally {
        if (originalBaseSelector) {
          runningSystemTest.setBaseSelector(originalBaseSelector)
        }

        await runningSystemTest.getDriver().executeScript(`
          const element = document.getElementById("system-test-interact-js-target")
          if (element) element.remove()
          return true
        `)
      }
    })
  })

  it("clears and sends replacement keys through retryable interactions", async () => {
    const systemTest = systemTestHelper.getSystemTest()
    const interactSpy = spyOn(systemTest, "interact").and.resolveTo(undefined)

    await systemTest.clearAndSendKeys("#replace-target", "new value")

    expect(interactSpy.calls.argsFor(0)).toEqual(["#replace-target", "click"])
    expect(interactSpy.calls.argsFor(1)).toEqual(["#replace-target", "sendKeys", Key.chord(Key.CONTROL, "a"), Key.BACK_SPACE, "new value"])
  })

  it("delegates test ID scrolling to the driver adapter", async () => {
    const systemTest = systemTestHelper.getSystemTest()
    const scrollTestIdIntoViewSpy = spyOn(systemTest.getDriverAdapter(), "scrollTestIdIntoView").and.resolveTo(undefined)

    await systemTest.scrollTestIdIntoView("scrollIntoViewTarget", {useBaseSelector: false})

    expect(scrollTestIdIntoViewSpy).toHaveBeenCalledWith("scrollIntoViewTarget", {useBaseSelector: false})
  })
})
