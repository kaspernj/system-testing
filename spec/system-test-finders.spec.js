// @ts-check

import SystemTest from "../src/system-test.js"
import SystemTestHelper from "./support/system-test-helper.js"
import {error as SeleniumError} from "selenium-webdriver"

const systemTestHelper = new SystemTestHelper()
systemTestHelper.installJasmineHooks()
const isNative = process.env.SYSTEM_TEST_NATIVE === "true"
const describeIfWeb = isNative ? describe.skip : describe

describeIfWeb("SystemTest finders", () => {
  it("respects useBaseSelector for find", async () => {
    await SystemTest.run(async (runningSystemTest) => {
      const originalBaseSelector = runningSystemTest.getBaseSelector()

      try {
        await runningSystemTest.findByTestID("blankText", {useBaseSelector: true, timeout: 0})

        runningSystemTest.setBaseSelector("#does-not-exist")

        await expectAsync(
          runningSystemTest.findByTestID("blankText", {useBaseSelector: true, timeout: 0})
        ).toBeRejectedWithError(/Element couldn't be found after/)

        await runningSystemTest.visit("/")
        await runningSystemTest.findByTestID("welcomeText", {useBaseSelector: false, timeout: 0})

        await expectAsync(
          runningSystemTest.find("#does-not-exist", {useBaseSelector: false, timeout: 0})
        ).toBeRejectedWithError(/Element couldn't be found after/)
      } finally {
        if (originalBaseSelector) {
          runningSystemTest.setBaseSelector(originalBaseSelector)
        }
      }
    })
  })

  it("retries all and waits for visibility within the timeout", async () => {
    await SystemTest.run(async (runningSystemTest) => {
      const driver = runningSystemTest.getDriver()
      const originalWait = driver.wait.bind(driver)
      let waitCalls = 0

      driver.wait = async (...args) => {
        waitCalls += 1

        if (waitCalls === 1) {
          throw new SeleniumError.TimeoutError("Simulated timeout")
        }

        return await originalWait(...args)
      }

      try {
        await driver.executeScript(`
          const baseSelector = arguments[0]
          const containerId = "system-test-all-retry"
          const base = document.querySelector(baseSelector)

          if (!base) {
            throw new Error("Base element missing")
          }

          let container = document.getElementById(containerId)
          if (container) container.remove()

          container = document.createElement("div")
          container.id = containerId
          container.setAttribute("data-testid", "allRetryTarget")
          container.style.display = "none"
          container.style.width = "12px"
          container.style.height = "12px"
          container.style.background = "#000"
          container.textContent = "Retry target"
          base.appendChild(container)

          setTimeout(() => {
            container.style.display = "block"
          }, 200)

          return true
        `, runningSystemTest.getBaseSelector())

        const elements = await runningSystemTest.all("[data-testid='allRetryTarget']", {timeout: 2000, visible: true})

        expect(elements.length).toEqual(1)
        expect(waitCalls).toBeGreaterThan(1)
      } finally {
        driver.wait = originalWait
        await driver.executeScript(`
          const container = document.getElementById("system-test-all-retry")
          if (container) container.remove()
          return true
        `)
      }
    })
  })

  it("returns quickly when waitForNoSelector has no matches", async () => {
    await SystemTest.run(async (runningSystemTest) => {
      const originalTimeouts = runningSystemTest.getTimeouts()

      try {
        await runningSystemTest.setTimeouts(2000)

        const startTime = Date.now()

        await runningSystemTest.waitForNoSelector("#does-not-exist", {useBaseSelector: false})

        const elapsedMs = Date.now() - startTime

        expect(elapsedMs).toBeLessThan(1500)
      } finally {
        await runningSystemTest.setTimeouts(originalTimeouts)
      }
    })
  })
})
