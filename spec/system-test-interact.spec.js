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
 * @param {number} [args.dropKeyProbability] Probability (0-1) that any given BACK_SPACE/DELETE press is silently dropped, modelling keystrokes lost intermittently under CI load.
 * @param {number} [args.dropSeed] Seed for the deterministic pseudo-random drop sequence.
 * @param {number} [args.initialCaret] Caret position after the focusing click (defaults to the end of the value).
 * @param {number} [args.focusRequiredClicks] Number of focus clicks needed before the caret lands and deletions take effect (0 means focused from the start). Models a click that reports success without focusing the field until re-clicked.
 * @param {boolean} [args.typingWorks] Whether typed characters land in the value.
 * @returns {{getValue: () => string, interact: (target: any, methodName: string, ...interactArgs: any[]) => Promise<any>, sentKeys: string[]}}
 */
function fakeTextInput(initialValue, {ignoredBackspaces = 0, dropKeyProbability = 0, dropSeed = 1, initialCaret = initialValue.length, focusRequiredClicks = 0, typingWorks = true} = {}) {
  let value = initialValue
  let caret = initialCaret
  let backspacePresses = 0
  let dropRngState = dropSeed >>> 0
  let clickCount = 0
  // A click that reports success but does not land the caret leaves the field unfocused, so
  // deletion keys no-op until enough focus clicks have landed.
  let focused = focusRequiredClicks <= 0
  /** @type {string[]} */
  const sentKeys = []

  // Models a keystroke silently dropped under load. A deterministic LCG keeps the drop
  // sequence reproducible while staying aperiodic relative to the clear-pass structure, so a
  // trailing single character cannot land in a resonance where the same slot drops forever.
  const isDroppedDeletionKey = () => {
    if (dropKeyProbability <= 0) return false

    dropRngState = (Math.imul(dropRngState, 1664525) + 1013904223) >>> 0

    return dropRngState / 0x100000000 < dropKeyProbability
  }

  return {
    getValue: () => value,
    sentKeys,
    interact: async (_target, methodName, ...interactArgs) => {
      if (methodName === "getProperty") return value

      if (methodName === "clear") {
        // Native Selenium `element.clear()` empties the field regardless of caret/focus state.
        value = ""
        caret = 0

        return undefined
      }

      if (methodName === "replaceValueWithJs") {
        // The DOM value-setter escape hatch replaces the whole value in one shot.
        value = String(interactArgs[0] ?? "")
        caret = value.length

        return undefined
      }

      if (methodName === "click") {
        clickCount += 1

        if (!focused && clickCount >= focusRequiredClicks) {
          focused = true
          caret = value.length
        }

        return undefined
      }

      if (methodName === "sendKeys") {
        const key = String(interactArgs[0])

        sentKeys.push(key)

        if (key === Key.BACK_SPACE) {
          backspacePresses += 1

          if (isDroppedDeletionKey()) return undefined

          if (focused && backspacePresses > ignoredBackspaces && caret > 0) {
            value = value.slice(0, caret - 1) + value.slice(caret)
            caret -= 1
          }

          return undefined
        }

        if (key === Key.DELETE) {
          if (isDroppedDeletionKey()) return undefined

          if (focused && caret < value.length) value = value.slice(0, caret) + value.slice(caret + 1)

          return undefined
        }

        // Chords and other control keys are silently dropped, like select-all on headless CI Chrome.
        if (/[\uE000-\uF8FF]/.test(key)) return undefined

        // `key` can be a single character (per-character typing) or a whole string (one fast sendKeys),
        // so advance the caret by its full length.
        if (typingWorks) {
          value = value.slice(0, caret) + key + value.slice(caret)
          caret += key.length
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

  it("clear empties the field with a native element.clear() by default", async () => {
    const systemTest = systemTestHelper.getSystemTest()
    const fakeInput = fakeTextInput("old value")
    const interactSpy = spyOn(systemTest, "interact").and.callFake(fakeInput.interact)

    await systemTest.clear("#target")

    const methodsSeen = interactSpy.calls.allArgs().map((callArgs) => callArgs[1])

    // Native clear is the default: element.clear(), no chord and no per-character key presses.
    expect(methodsSeen).toContain("clear")
    expect(fakeInput.sentKeys).toEqual([])
    expect(fakeInput.getValue()).toBe("")
  })

  it("clear empties the field through the js escape hatch when strategy is 'js'", async () => {
    const systemTest = systemTestHelper.getSystemTest()
    const fakeInput = fakeTextInput("old value")
    const interactSpy = spyOn(systemTest, "interact").and.callFake(fakeInput.interact)

    await systemTest.clear("#target", {strategy: "js"})

    const jsSetCalls = interactSpy.calls.allArgs().filter((callArgs) => callArgs[1] === "replaceValueWithJs")

    expect(jsSetCalls).toEqual([["#target", "replaceValueWithJs", ""]])
    expect(fakeInput.sentKeys).toEqual([])
    expect(fakeInput.getValue()).toBe("")
  })

  it("clear empties prefilled inputs with per-character backspaces under the backspace-keys strategy", async () => {
    const systemTest = systemTestHelper.getSystemTest()
    const fakeInput = fakeTextInput("16")
    const interactSpy = spyOn(systemTest, "interact").and.callFake(fakeInput.interact)

    await systemTest.clear("#target", {strategy: "backspace-keys"})

    expect(interactSpy.calls.argsFor(0)).toEqual([{selector: "#target", method: "actions"}, "click"])
    expect(fakeInput.sentKeys).toEqual([Key.BACK_SPACE, Key.BACK_SPACE])
    expect(fakeInput.getValue()).toBe("")
  })

  it("clear empties on both sides of a mid-value caret under the backspace-keys strategy", async () => {
    // The focusing click can land the caret in the middle of a multiline textarea value,
    // where backspaces alone only delete the text before the caret.
    const systemTest = systemTestHelper.getSystemTest()
    const fakeInput = fakeTextInput("one\ntwo", {initialCaret: 3})
    spyOn(systemTest, "interact").and.callFake(fakeInput.interact)

    await systemTest.clear("#target", {strategy: "backspace-keys"})

    expect(fakeInput.sentKeys.filter((key) => key === Key.DELETE).length).toBe(4)
    expect(fakeInput.getValue()).toBe("")
  })

  it("clear empties with forward deletes under the delete-keys strategy", async () => {
    const systemTest = systemTestHelper.getSystemTest()
    // The focusing click lands the caret at the start, so a forward-delete-first clear empties it.
    const fakeInput = fakeTextInput("ab", {initialCaret: 0})
    spyOn(systemTest, "interact").and.callFake(fakeInput.interact)

    await systemTest.clear("#target", {strategy: "delete-keys"})

    expect(fakeInput.sentKeys).toEqual([Key.DELETE, Key.DELETE])
    expect(fakeInput.getValue()).toBe("")
  })

  it("clear does nothing without keys when the backspace-keys field is already empty", async () => {
    const systemTest = systemTestHelper.getSystemTest()
    const fakeInput = fakeTextInput("")
    spyOn(systemTest, "interact").and.callFake(fakeInput.interact)

    await systemTest.clear("#target", {strategy: "backspace-keys"})

    expect(fakeInput.sentKeys).toEqual([])
    expect(fakeInput.getValue()).toBe("")
  })

  it("clear stays robust when backspace-keys presses are intermittently dropped under load", async () => {
    // Roughly half the clearing key presses are dropped pseudo-randomly, needing more than a
    // fixed number of passes to empty the field. The adaptive loop re-reads the actual residual
    // each pass and re-deletes exactly what remains, so it still converges to an empty field.
    const systemTest = systemTestHelper.getSystemTest()
    const fakeInput = fakeTextInput("user@example.com", {dropKeyProbability: 0.5, dropSeed: 1})
    spyOn(systemTest, "interact").and.callFake(fakeInput.interact)

    await systemTest.clear("#target", {strategy: "backspace-keys"})

    expect(fakeInput.getValue()).toBe("")
  })

  it("clear re-focuses and recovers when the initial focus click never landed the caret", async () => {
    // The initial focusing click reports success but does not land the caret, so deletions no-op
    // against a dead focus state; only a second focus click (issued by the adaptive clear loop
    // after it stalls) actually focuses the field. It must re-focus and recover.
    const systemTest = systemTestHelper.getSystemTest()
    const fakeInput = fakeTextInput("stale", {focusRequiredClicks: 2})
    const interactSpy = spyOn(systemTest, "interact").and.callFake(fakeInput.interact)

    await systemTest.clear("#target", {strategy: "backspace-keys"})

    const clickCalls = interactSpy.calls.allArgs().filter((callArgs) => callArgs[1] === "click")

    expect(clickCalls.length).toBe(2)
    expect(fakeInput.getValue()).toBe("")
  })

  it("clear throws with the remaining value when the backspace-keys strategy can never make progress", async () => {
    // A read-only-like field where no key press ever lands: the adaptive loop makes zero progress
    // even after exhausting its re-focus recovery attempts, then gives up naming the residual.
    const systemTest = systemTestHelper.getSystemTest()
    const fakeInput = fakeTextInput("stuck", {ignoredBackspaces: Number.POSITIVE_INFINITY})
    spyOn(systemTest, "interact").and.callFake(fakeInput.interact)

    await expectAsync(systemTest.clear("#target", {strategy: "backspace-keys"}))
      .toBeRejectedWithError(/clearing made no progress across 3 passes.+"stuck"/)
  })

  it("clear waits the configured keyDelay between the backspace-keys presses", async () => {
    const systemTest = systemTestHelper.getSystemTest()
    const fakeInput = fakeTextInput("ab")
    spyOn(systemTest, "interact").and.callFake(fakeInput.interact)
    const keyDelaySpy = spyOn(systemTest, "waitBetweenKeystrokes").and.resolveTo(undefined)

    await systemTest.clear("#target", {strategy: "backspace-keys", keyDelay: 10})

    expect(keyDelaySpy).toHaveBeenCalledWith(10)
    expect(keyDelaySpy.calls.count()).toBe(2)
  })

  it("fill enters the value with one fast whole-string sendKeys by default", async () => {
    const systemTest = systemTestHelper.getSystemTest()
    const fakeInput = fakeTextInput("")
    const interactSpy = spyOn(systemTest, "interact").and.callFake(fakeInput.interact)

    await systemTest.fill("#target", "new value")

    const sendKeysCalls = interactSpy.calls.allArgs().filter((callArgs) => callArgs[1] === "sendKeys")

    // One whole-string sendKeys, not a per-character loop.
    expect(sendKeysCalls).toEqual([["#target", "sendKeys", "new value"]])
    expect(fakeInput.sentKeys).toEqual(["new value"])
    expect(fakeInput.getValue()).toBe("new value")
  })

  it("fill does not clear the field first (pure append)", async () => {
    const systemTest = systemTestHelper.getSystemTest()
    const fakeInput = fakeTextInput("ab")
    const interactSpy = spyOn(systemTest, "interact").and.callFake(fakeInput.interact)

    await systemTest.fill("#target", "cd")

    const methodsSeen = interactSpy.calls.allArgs().map((callArgs) => callArgs[1])

    expect(methodsSeen).not.toContain("clear")
    expect(fakeInput.getValue()).toBe("abcd")
  })

  it("fill retries until the entered value is visible", async () => {
    const systemTest = systemTestHelper.getSystemTest()
    let value = ""
    let sendKeysCalls = 0
    spyOn(systemTest, "interact").and.callFake(async (_selector, methodName, ...args) => {
      if (methodName === "getProperty") return value

      // The first whole-string sendKeys is silently dropped, forcing a retry.
      if (methodName === "sendKeys") {
        sendKeysCalls += 1
        if (sendKeysCalls >= 2) value += String(args[0])
      }

      return undefined
    })

    await systemTest.fill("#target", "new")

    expect(value).toBe("new")
    expect(sendKeysCalls).toBe(2)
  })

  it("fill throws with the expected and actual values when the value never lands", async () => {
    const systemTest = systemTestHelper.getSystemTest()
    const fakeInput = fakeTextInput("", {typingWorks: false})
    spyOn(systemTest, "interact").and.callFake(fakeInput.interact)

    await expectAsync(systemTest.fill("#target", "new value"))
      .toBeRejectedWithError(/fill did not enter the value after 3 attempts.+Expected "new value", got ""/)
  })

  it("fill sets the value through the js escape hatch without typing when strategy is 'js'", async () => {
    const systemTest = systemTestHelper.getSystemTest()
    const fakeInput = fakeTextInput("old")
    const interactSpy = spyOn(systemTest, "interact").and.callFake(fakeInput.interact)

    await systemTest.fill("#target", "new value", {strategy: "js"})

    const jsSetCalls = interactSpy.calls.allArgs().filter((callArgs) => callArgs[1] === "replaceValueWithJs")

    expect(jsSetCalls).toEqual([["#target", "replaceValueWithJs", "new value"]])
    expect(fakeInput.sentKeys).toEqual([])
    expect(fakeInput.getValue()).toBe("new value")
  })

  it("fill types one character at a time under the per-character strategy", async () => {
    const systemTest = systemTestHelper.getSystemTest()
    const fakeInput = fakeTextInput("")
    spyOn(systemTest, "interact").and.callFake(fakeInput.interact)

    await systemTest.fill("#target", "new", {strategy: "per-character"})

    expect(fakeInput.sentKeys).toEqual(["n", "e", "w"])
    expect(fakeInput.getValue()).toBe("new")
  })

  it("fill waits the configured keyDelay between each per-character keystroke", async () => {
    const systemTest = systemTestHelper.getSystemTest()
    const fakeInput = fakeTextInput("")
    spyOn(systemTest, "interact").and.callFake(fakeInput.interact)
    const keyDelaySpy = spyOn(systemTest, "waitBetweenKeystrokes").and.resolveTo(undefined)

    await systemTest.fill("#target", "abc", {strategy: "per-character", keyDelay: 25})

    expect(keyDelaySpy).toHaveBeenCalledWith(25)
    expect(keyDelaySpy.calls.count()).toBe(3)
  })

  it("clearAndFill clears natively then fills with one whole-string sendKeys by default", async () => {
    const systemTest = systemTestHelper.getSystemTest()
    const fakeInput = fakeTextInput("old value")
    const interactSpy = spyOn(systemTest, "interact").and.callFake(fakeInput.interact)

    await systemTest.clearAndFill("#target", "new value")

    const methodsSeen = interactSpy.calls.allArgs().map((callArgs) => callArgs[1])

    expect(methodsSeen).toContain("clear")
    expect(fakeInput.sentKeys).toEqual(["new value"])
    expect(fakeInput.sentKeys.some((key) => key === Key.BACK_SPACE || key === Key.DELETE)).toBeFalse()
    expect(fakeInput.getValue()).toBe("new value")
  })

  it("clearAndFill composes the backspace-keys clear with the native fill", async () => {
    const systemTest = systemTestHelper.getSystemTest()
    const fakeInput = fakeTextInput("16")
    spyOn(systemTest, "interact").and.callFake(fakeInput.interact)

    await systemTest.clearAndFill("#target", "20", {clearStrategy: "backspace-keys"})

    expect(fakeInput.sentKeys).toEqual([Key.BACK_SPACE, Key.BACK_SPACE, "20"])
    expect(fakeInput.getValue()).toBe("20")
  })

  it("clearAndFill composes the js clear with the js fill", async () => {
    const systemTest = systemTestHelper.getSystemTest()
    const fakeInput = fakeTextInput("old value")
    const interactSpy = spyOn(systemTest, "interact").and.callFake(fakeInput.interact)

    await systemTest.clearAndFill("#target", "new value", {clearStrategy: "js", fillStrategy: "js"})

    const jsSetCalls = interactSpy.calls.allArgs().filter((callArgs) => callArgs[1] === "replaceValueWithJs")

    expect(jsSetCalls).toEqual([["#target", "replaceValueWithJs", ""], ["#target", "replaceValueWithJs", "new value"]])
    expect(fakeInput.sentKeys).toEqual([])
    expect(fakeInput.getValue()).toBe("new value")
  })

  it("clearAndFill threads keyDelay into both the key-based clear and the per-character fill", async () => {
    const systemTest = systemTestHelper.getSystemTest()
    const fakeInput = fakeTextInput("ab")
    spyOn(systemTest, "interact").and.callFake(fakeInput.interact)
    const keyDelaySpy = spyOn(systemTest, "waitBetweenKeystrokes").and.resolveTo(undefined)

    await systemTest.clearAndFill("#target", "cd", {clearStrategy: "backspace-keys", fillStrategy: "per-character", keyDelay: 10})

    // Two clearing backspaces plus two typed characters each pause.
    expect(keyDelaySpy).toHaveBeenCalledWith(10)
    expect(keyDelaySpy.calls.count()).toBe(4)
  })

  it("clearAndSendKeys is a convenience alias for clearAndFill with fast native defaults", async () => {
    const systemTest = systemTestHelper.getSystemTest()
    const fakeInput = fakeTextInput("old")
    const interactSpy = spyOn(systemTest, "interact").and.callFake(fakeInput.interact)

    await systemTest.clearAndSendKeys("#target", "new value")

    const methodsSeen = interactSpy.calls.allArgs().map((callArgs) => callArgs[1])

    expect(methodsSeen).toContain("clear")
    expect(fakeInput.sentKeys).toEqual(["new value"])
    expect(fakeInput.getValue()).toBe("new value")
  })

  it("clearAndSendKeys forwards clear/fill strategy overrides to clearAndFill", async () => {
    const systemTest = systemTestHelper.getSystemTest()
    const fakeInput = fakeTextInput("16")
    spyOn(systemTest, "interact").and.callFake(fakeInput.interact)

    await systemTest.clearAndSendKeys("#target", "20", {clearStrategy: "backspace-keys"})

    expect(fakeInput.sentKeys).toEqual([Key.BACK_SPACE, Key.BACK_SPACE, "20"])
    expect(fakeInput.getValue()).toBe("20")
  })

  itIfWeb("clearAndFill replaces a prefilled input value end-to-end with the native defaults", async () => {
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

        await runningSystemTest.clearAndFill({selector: "[data-testid='clearAndSendKeysTarget']", useBaseSelector: false}, "20")

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

  itIfWeb("clear with the backspace-keys strategy empties a multiline textarea end-to-end even when the click lands the caret mid-text", async () => {
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

        await runningSystemTest.clear({selector: "[data-testid='clearAndSendKeysTextarea']", useBaseSelector: false}, {strategy: "backspace-keys"})
        await runningSystemTest.fill({selector: "[data-testid='clearAndSendKeysTextarea']", useBaseSelector: false}, "replaced")

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

  itIfWeb("fill enters a value into an empty input end-to-end with the native whole-string strategy", async () => {
    await SystemTest.run(async (runningSystemTest) => {
      try {
        await runningSystemTest.getDriver().executeScript(`
          const elementId = "system-test-fill-target"
          let element = document.getElementById(elementId)

          if (element) {
            element.remove()
          }

          element = document.createElement("input")
          element.id = elementId
          element.setAttribute("data-testid", "fillTarget")
          element.value = ""
          element.style.position = "fixed"
          element.style.top = "12px"
          element.style.left = "12px"
          element.style.zIndex = "9999"
          document.body.appendChild(element)
          return true
        `)

        await runningSystemTest.fill({selector: "[data-testid='fillTarget']", useBaseSelector: false}, "hello world")

        const inputValue = await runningSystemTest.interact({selector: "[data-testid='fillTarget']", useBaseSelector: false}, "getProperty", "value")

        expect(inputValue).toBe("hello world")
      } finally {
        await runningSystemTest.getDriver().executeScript(`
          const element = document.getElementById("system-test-fill-target")
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
