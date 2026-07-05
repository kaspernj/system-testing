// @ts-check

import {Key} from "selenium-webdriver"
import SystemTest from "../src/system-test.js"
import SystemTestHelper from "./support/system-test-helper.js"

const systemTestHelper = new SystemTestHelper()
systemTestHelper.installJasmineHooks()
const isNative = process.env.SYSTEM_TEST_NATIVE === "true"
const itIfWeb = isNative ? xit : it

/**
 * Creates a stateful `interact` fake modelling a real text input receiving keys at a caret.
 * Select-all chords are ignored on purpose, matching headless CI Chrome sessions
 * where CTRL+A silently no-ops while plain typing still lands in the field.
 * @param {string} initialValue Value the input starts with.
 * @param {object} [args] Caret placement and failure-mode toggles.
 * @param {number} [args.ignoredBackspaces] Number of leading BACK_SPACE presses that are silently dropped.
 * @param {number} [args.initialCaret] Caret position after the focusing click (defaults to the end of the value).
 * @param {boolean} [args.typingWorks] Whether typed characters land in the value.
 * @returns {{getValue: () => string, interact: (target: any, methodName: string, ...interactArgs: any[]) => Promise<any>, sentKeys: string[]}}
 */
function fakeTextInput(initialValue, {ignoredBackspaces = 0, initialCaret = initialValue.length, typingWorks = true} = {}) {
  let value = initialValue
  let caret = initialCaret
  let backspacePresses = 0
  /** @type {string[]} */
  const sentKeys = []

  return {
    getValue: () => value,
    sentKeys,
    interact: async (_target, methodName, ...interactArgs) => {
      if (methodName === "getProperty") return value

      if (methodName === "sendKeys") {
        const key = String(interactArgs[0])

        sentKeys.push(key)

        if (key === Key.BACK_SPACE) {
          backspacePresses += 1

          if (backspacePresses > ignoredBackspaces && caret > 0) {
            value = value.slice(0, caret - 1) + value.slice(caret)
            caret -= 1
          }

          return undefined
        }

        if (key === Key.DELETE) {
          if (caret < value.length) value = value.slice(0, caret) + value.slice(caret + 1)

          return undefined
        }

        // Chords and other control keys are silently dropped, like select-all on headless CI Chrome.
        if (/[\uE000-\uF8FF]/.test(key)) return undefined

        if (typingWorks) {
          value = value.slice(0, caret) + key + value.slice(caret)
          caret += 1
        }
      }

      return undefined
    }
  }
}

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

        // Record isTrusted on the click event. The WebDriver default click
        // path fires a trusted user-gesture event (isTrusted=true). An
        // executeScript("arguments[0].click()") call fires a programmatic
        // click, which is always isTrusted=false. This is how we actually
        // prove method:"js" took the executeScript path instead of the
        // normal WebDriver click.
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
          element.addEventListener("click", (event) => {
            element.setAttribute("data-clicked", "true")
            element.setAttribute("data-trusted", String(event.isTrusted))
          })
          document.body.appendChild(element)
          return true
        `)

        await runningSystemTest.interact({selector: "[data-testid='systemTestJsClickTarget']", method: "js", useBaseSelector: false}, "click")

        const result = await runningSystemTest.getDriver().executeScript(`
          const element = document.querySelector("[data-testid='systemTestJsClickTarget']")
          return {
            clicked: element?.getAttribute("data-clicked"),
            trusted: element?.getAttribute("data-trusted")
          }
        `)

        expect(result).toEqual({clicked: "true", trusted: "false"})
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

  itIfWeb("dispatches a trusted click event by default (not via executeScript)", async () => {
    await SystemTest.run(async (runningSystemTest) => {
      const originalBaseSelector = runningSystemTest.getBaseSelector()

      try {
        runningSystemTest.setBaseSelector("#does-not-exist")

        // Paired companion to the method:"js" spec above: asserts the
        // default click path fires a trusted (isTrusted=true) event. This
        // is what distinguishes the default path from method:"js". If both
        // this and the js spec pass, the js path is demonstrably different.
        await runningSystemTest.getDriver().executeScript(`
          const elementId = "system-test-interact-default-target"
          let element = document.getElementById(elementId)

          if (element) {
            element.remove()
          }

          element = document.createElement("button")
          element.id = elementId
          element.setAttribute("data-testid", "systemTestDefaultClickTarget")
          element.style.position = "fixed"
          element.style.top = "12px"
          element.style.left = "12px"
          element.style.zIndex = "9999"
          element.textContent = "Default click target"
          element.addEventListener("click", (event) => {
            element.setAttribute("data-clicked", "true")
            element.setAttribute("data-trusted", String(event.isTrusted))
          })
          document.body.appendChild(element)
          return true
        `)

        await runningSystemTest.interact({selector: "[data-testid='systemTestDefaultClickTarget']", useBaseSelector: false}, "click")

        const result = await runningSystemTest.getDriver().executeScript(`
          const element = document.querySelector("[data-testid='systemTestDefaultClickTarget']")
          return {
            clicked: element?.getAttribute("data-clicked"),
            trusted: element?.getAttribute("data-trusted")
          }
        `)

        expect(result).toEqual({clicked: "true", trusted: "true"})
      } finally {
        if (originalBaseSelector) {
          runningSystemTest.setBaseSelector(originalBaseSelector)
        }

        await runningSystemTest.getDriver().executeScript(`
          const element = document.getElementById("system-test-interact-default-target")
          if (element) element.remove()
          return true
        `)
      }
    })
  })

  it("clears input elements with select-all and backspace before sending replacement keys", async () => {
    const systemTest = systemTestHelper.getSystemTest()
    const interactSpy = spyOn(systemTest, "interact").and.callFake(async (_selector, methodName) => {
      if (methodName === "getTagName") return "input"
      if (methodName === "getProperty") return "new value"

      return undefined
    })

    await systemTest.clearAndSendKeys("#replace-target", "new value")

    expect(interactSpy.calls.argsFor(0)).toEqual([{selector: "#replace-target", method: "actions"}, "click"])
    expect(interactSpy.calls.argsFor(1)).toEqual(["#replace-target", "sendKeys", Key.chord(Key.CONTROL, "a")])
    expect(interactSpy.calls.argsFor(2)).toEqual(["#replace-target", "sendKeys", Key.BACK_SPACE])
    expect(interactSpy.calls.argsFor(3)).toEqual(["#replace-target", "sendKeys", "n"])
    expect(interactSpy.calls.argsFor(12)).toEqual(["#replace-target", "getProperty", "value"])
  })

  it("types replacement input text one character at a time", async () => {
    const systemTest = systemTestHelper.getSystemTest()
    const interactSpy = spyOn(systemTest, "interact").and.callFake(async (_selector, methodName) => {
      if (methodName === "getTagName") return "input"
      if (methodName === "getProperty") return "new"

      return undefined
    })

    await systemTest.clearAndSendKeys("#replace-target", "new")

    expect(interactSpy.calls.argsFor(3)).toEqual(["#replace-target", "sendKeys", "n"])
    expect(interactSpy.calls.argsFor(4)).toEqual(["#replace-target", "sendKeys", "e"])
    expect(interactSpy.calls.argsFor(5)).toEqual(["#replace-target", "sendKeys", "w"])
    expect(interactSpy.calls.argsFor(6)).toEqual(["#replace-target", "getProperty", "value"])
  })

  it("retries clear and replacement keys until the requested value is visible", async () => {
    const systemTest = systemTestHelper.getSystemTest()
    const observedValues = ["", "new value"]
    const interactSpy = spyOn(systemTest, "interact").and.callFake(async (_selector, methodName) => {
      if (methodName === "getTagName") return "input"
      if (methodName === "getProperty") return observedValues.shift()

      return undefined
    })

    await systemTest.clearAndSendKeys("#replace-target", "new value")

    const getValueCalls = interactSpy.calls
      .allArgs()
      .filter((callArgs) => callArgs[1] === "getProperty")

    expect(interactSpy.calls.argsFor(0)).toEqual([{selector: "#replace-target", method: "actions"}, "click"])
    expect(interactSpy.calls.argsFor(13)).toEqual([{selector: "#replace-target", method: "actions"}, "click"])
    expect(getValueCalls.length).toBe(2)
  })

  it("replaceInputValue clears prefilled inputs with per-character backspaces before typing", async () => {
    const systemTest = systemTestHelper.getSystemTest()
    const fakeInput = fakeTextInput("16")
    const interactSpy = spyOn(systemTest, "interact").and.callFake(fakeInput.interact)

    await systemTest.replaceInputValue("#replace-target", "20")

    expect(interactSpy.calls.argsFor(0)).toEqual([{selector: "#replace-target", method: "actions"}, "click"])
    expect(fakeInput.sentKeys).toEqual([Key.BACK_SPACE, Key.BACK_SPACE, "2", "0"])
    expect(fakeInput.getValue()).toBe("20")
  })

  it("replaceInputValue clears text on both sides of a mid-value caret with backspaces and deletes", async () => {
    // The focusing click can land the caret in the middle of a multiline textarea value,
    // where backspaces alone only delete the text before the caret.
    const systemTest = systemTestHelper.getSystemTest()
    const fakeInput = fakeTextInput("one\ntwo", {initialCaret: 3})
    spyOn(systemTest, "interact").and.callFake(fakeInput.interact)

    await systemTest.replaceInputValue("#replace-target", "replaced")

    expect(fakeInput.sentKeys.filter((key) => key === Key.DELETE).length).toBe(4)
    expect(fakeInput.getValue()).toBe("replaced")
  })

  it("replaceInputValue replaces prefilled values without select-all chords so ignored chords cannot leave old text behind", async () => {
    // Models the deterministic CI failure mode where CTRL+A+BACKSPACE had zero effect
    // while subsequent typing landed, leaving old + typed text in the field.
    const systemTest = systemTestHelper.getSystemTest()
    const fakeInput = fakeTextInput("16")
    spyOn(systemTest, "interact").and.callFake(fakeInput.interact)

    await systemTest.replaceInputValue("#replace-target", "20")

    expect(fakeInput.sentKeys.some((key) => key.includes(Key.CONTROL))).toBeFalse()
    expect(fakeInput.getValue()).toBe("20")
  })

  it("replaceInputValue types replacement text one character at a time and skips clearing keys when the input is already empty", async () => {
    const systemTest = systemTestHelper.getSystemTest()
    const fakeInput = fakeTextInput("")
    spyOn(systemTest, "interact").and.callFake(fakeInput.interact)

    await systemTest.replaceInputValue("#replace-target", "new")

    expect(fakeInput.sentKeys).toEqual(["n", "e", "w"])
    expect(fakeInput.getValue()).toBe("new")
  })

  it("replaceInputValue retries clearing until the field is verified empty before typing", async () => {
    const systemTest = systemTestHelper.getSystemTest()
    const fakeInput = fakeTextInput("old", {ignoredBackspaces: 3})
    const interactSpy = spyOn(systemTest, "interact").and.callFake(fakeInput.interact)

    await systemTest.replaceInputValue("#replace-target", "new")

    const clickCalls = interactSpy.calls.allArgs().filter((callArgs) => callArgs[1] === "click")

    expect(clickCalls.length).toBe(2)
    expect(fakeInput.getValue()).toBe("new")
  })

  it("replaceInputValue throws with the expected and actual values when typing does not land", async () => {
    const systemTest = systemTestHelper.getSystemTest()
    const fakeInput = fakeTextInput("", {typingWorks: false})
    spyOn(systemTest, "interact").and.callFake(fakeInput.interact)

    await expectAsync(systemTest.replaceInputValue("#replace-target", "new value"))
      .toBeRejectedWithError(/did not update the element value after 3 attempts.+Expected "new value", got ""/)
  })

  it("replaceInputValue throws with the remaining value when clearing never empties the field", async () => {
    const systemTest = systemTestHelper.getSystemTest()
    const fakeInput = fakeTextInput("stuck", {ignoredBackspaces: Number.POSITIVE_INFINITY})
    spyOn(systemTest, "interact").and.callFake(fakeInput.interact)

    await expectAsync(systemTest.replaceInputValue("#replace-target", "new value"))
      .toBeRejectedWithError(/clearing did not empty the element value after 3 attempts.+"stuck".+"new value"/)
  })

  itIfWeb("replaceInputValue replaces a prefilled input value end-to-end", async () => {
    await SystemTest.run(async (runningSystemTest) => {
      try {
        await runningSystemTest.getDriver().executeScript(`
          const elementId = "system-test-clear-and-send-keys-target"
          let element = document.getElementById(elementId)

          if (element) {
            element.remove()
          }

          element = document.createElement("input")
          element.id = elementId
          element.setAttribute("data-testid", "clearAndSendKeysTarget")
          element.value = "16"
          element.style.position = "fixed"
          element.style.top = "12px"
          element.style.left = "12px"
          element.style.zIndex = "9999"
          document.body.appendChild(element)
          return true
        `)

        await runningSystemTest.replaceInputValue({selector: "[data-testid='clearAndSendKeysTarget']", useBaseSelector: false}, "20")

        const inputValue = await runningSystemTest.interact({selector: "[data-testid='clearAndSendKeysTarget']", useBaseSelector: false}, "getProperty", "value")

        expect(inputValue).toBe("20")
      } finally {
        await runningSystemTest.getDriver().executeScript(`
          const element = document.getElementById("system-test-clear-and-send-keys-target")
          if (element) element.remove()
          return true
        `)
      }
    })
  })

  itIfWeb("replaceInputValue replaces a multiline textarea value end-to-end even when the click lands the caret mid-text", async () => {
    await SystemTest.run(async (runningSystemTest) => {
      try {
        await runningSystemTest.getDriver().executeScript(`
          const elementId = "system-test-clear-and-send-keys-textarea"
          let element = document.getElementById(elementId)

          if (element) {
            element.remove()
          }

          element = document.createElement("textarea")
          element.id = elementId
          element.setAttribute("data-testid", "clearAndSendKeysTextarea")
          element.rows = 3
          element.value = "one\\ntwo\\nthree\\nfour\\nfive\\nsix"
          element.style.position = "fixed"
          element.style.top = "12px"
          element.style.left = "12px"
          element.style.zIndex = "9999"
          document.body.appendChild(element)
          return true
        `)

        await runningSystemTest.replaceInputValue({selector: "[data-testid='clearAndSendKeysTextarea']", useBaseSelector: false}, "replaced")

        const textareaValue = await runningSystemTest.interact({selector: "[data-testid='clearAndSendKeysTextarea']", useBaseSelector: false}, "getProperty", "value")

        expect(textareaValue).toBe("replaced")
      } finally {
        await runningSystemTest.getDriver().executeScript(`
          const element = document.getElementById("system-test-clear-and-send-keys-textarea")
          if (element) element.remove()
          return true
        `)
      }
    })
  })

  itIfWeb("refuses actions clicks when another element would receive the click", async () => {
    await SystemTest.run(async (runningSystemTest) => {
      try {
        await runningSystemTest.getDriver().executeScript(`
          for (const elementId of ["system-test-actions-click-target", "system-test-actions-click-overlay"]) {
            const existingElement = document.getElementById(elementId)
            if (existingElement) existingElement.remove()
          }

          const button = document.createElement("button")
          button.id = "system-test-actions-click-target"
          button.setAttribute("data-testid", "actionsClickTarget")
          button.style.position = "fixed"
          button.style.top = "12px"
          button.style.left = "12px"
          button.style.zIndex = "9999"
          button.textContent = "Actions click target"
          button.addEventListener("click", () => {
            button.setAttribute("data-clicked", "true")
          })
          document.body.appendChild(button)

          const overlay = document.createElement("div")
          overlay.id = "system-test-actions-click-overlay"
          overlay.setAttribute("data-testid", "actionsClickOverlay")
          overlay.style.position = "fixed"
          overlay.style.top = "0"
          overlay.style.left = "0"
          overlay.style.right = "0"
          overlay.style.bottom = "0"
          overlay.style.zIndex = "10000"
          document.body.appendChild(overlay)
          return true
        `)

        await expectAsync(
          runningSystemTest.interact({checkInterception: true, selector: "[data-testid='actionsClickTarget']", method: "actions", useBaseSelector: false}, "click")
        ).toBeRejectedWithError(/ElementClickInterceptedError.+actionsClickOverlay/)

        const clickedWhileObstructed = await runningSystemTest.interact({selector: "[data-testid='actionsClickTarget']", useBaseSelector: false}, "getAttribute", "data-clicked")

        expect(clickedWhileObstructed).toBeNull()

        await runningSystemTest.getDriver().executeScript(`
          document.getElementById("system-test-actions-click-overlay").remove()
          return true
        `)

        await runningSystemTest.interact({selector: "[data-testid='actionsClickTarget']", method: "actions", useBaseSelector: false}, "click")

        const clickedAfterOverlayRemoval = await runningSystemTest.interact({selector: "[data-testid='actionsClickTarget']", useBaseSelector: false}, "getAttribute", "data-clicked")

        expect(clickedAfterOverlayRemoval).toBe("true")
      } finally {
        await runningSystemTest.getDriver().executeScript(`
          for (const elementId of ["system-test-actions-click-target", "system-test-actions-click-overlay"]) {
            const element = document.getElementById(elementId)
            if (element) element.remove()
          }
          return true
        `)
      }
    })
  })

  it("re-clicks through clickAndWaitForEffect when the expected effect has not appeared", async () => {
    const systemTest = systemTestHelper.getSystemTest()
    const clickSpy = spyOn(systemTest, "click").and.resolveTo(undefined)

    await systemTest.clickAndWaitForEffect("#effect-target", () => {
      if (clickSpy.calls.count() < 2) throw new Error("effect not visible yet")
    }, {effectTimeout: 100, method: "actions"})

    expect(clickSpy.calls.count()).toBe(2)
    expect(clickSpy).toHaveBeenCalledWith("#effect-target", {method: "actions"})
  })

  it("clamps each clickAndWaitForEffect probe to the remaining overall timeout", async () => {
    const systemTest = systemTestHelper.getSystemTest()
    spyOn(systemTest, "click").and.resolveTo(undefined)
    const startedAt = Date.now()

    // With the default 2000ms effectTimeout, an unclamped first probe alone would
    // blow way past the 300ms overall budget.
    await expectAsync(
      systemTest.clickAndWaitForEffect("#effect-target", () => {
        throw new Error("effect never appeared")
      }, {timeout: 300})
    ).toBeRejectedWithError(/no observed effect/)

    expect(Date.now() - startedAt).toBeLessThan(1500)
  })

  it("throws with the last effect failure when clickAndWaitForEffect never observes the effect", async () => {
    const systemTest = systemTestHelper.getSystemTest()
    const clickSpy = spyOn(systemTest, "click").and.resolveTo(undefined)

    await expectAsync(
      systemTest.clickAndWaitForEffect("#effect-target", () => {
        throw new Error("menu never opened")
      }, {effectTimeout: 50, timeout: 250})
    ).toBeRejectedWithError(/no observed effect.+menu never opened/)

    expect(clickSpy.calls.count()).toBeGreaterThan(1)
  })

  it("delegates test ID scrolling to the driver adapter", async () => {
    const systemTest = systemTestHelper.getSystemTest()
    const scrollTestIdIntoViewSpy = spyOn(systemTest.getDriverAdapter(), "scrollTestIdIntoView").and.resolveTo(undefined)

    await systemTest.scrollTestIdIntoView("scrollIntoViewTarget", {useBaseSelector: false})

    expect(scrollTestIdIntoViewSpy).toHaveBeenCalledWith("scrollIntoViewTarget", {useBaseSelector: false})
  })
})
