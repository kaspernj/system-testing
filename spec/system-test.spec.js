// @ts-check

import SystemTest from "../src/system-test.js"
import SystemTestHelper from "./support/system-test-helper.js"

const systemTestHelper = new SystemTestHelper()
systemTestHelper.installJasmineHooks()

describe("System test", () => {
  it("shows the welcome text on the front page", async () => {
    await SystemTest.run(async (runningSystemTest) => {
      await runningSystemTest.visit("/")
      await runningSystemTest.findByTestID("welcomeText")
    })
  })

  it("evaluates browser JavaScript via Scoundrel", async () => {
    await SystemTest.run(async (runningSystemTest) => {
      const scoundrelClient = await runningSystemTest.getScoundrelClient()
      const evalProxy = await scoundrelClient.eval("return ({ sum: 2 + 3, href: window.location.href })")
      const evalResult = await evalProxy.__serialize()
      const sum = evalResult.sum
      const href = evalResult.href

      expect(sum).toEqual(5)
      expect(href).toContain("systemTest=true")
    })
  })

  it("reinitializes and can keep running", async () => {
    const systemTest = systemTestHelper.getSystemTest()

    await systemTest.visit("/")
    await systemTest.findByTestID("welcomeText")

    await systemTest.getDriver().executeScript("const marker = document.querySelector(\"[data-testid='welcomeText']\"); if (!marker) { throw new Error('welcomeText missing'); } marker.id = 'reinit-marker';")
    const markerSelector = `${systemTest.getBaseSelector()} #reinit-marker`
    const markerFound = await systemTest.getDriver().executeScript("return Boolean(document.querySelector(arguments[0]));", markerSelector)
    expect(markerFound).toBeTrue()

    await systemTest.reinitialize()

    expect(systemTest.isStarted()).toBeTrue()

    const markerGone = await systemTest.getDriver().executeScript("return !document.querySelector(arguments[0]);", markerSelector)
    expect(markerGone).toBeTrue()
    await systemTest.findByTestID("blankText")
    await systemTest.visit("/")
    await systemTest.findByTestID("welcomeText")
  })

  it("dismisses only the matching notification message", async () => {
    await SystemTest.run(async (runningSystemTest) => {
      const scoundrelClient = await runningSystemTest.getScoundrelClient()

      await scoundrelClient.eval(`
        const containerId = "system-test-notifications"
        let container = document.getElementById(containerId)

        if (!container) {
          container = document.createElement("div")
          container.id = containerId
          document.body.appendChild(container)
        }

        container.innerHTML = ""

        const addNotification = (count, message) => {
          const wrapper = document.createElement("div")
          const messageContainer = document.createElement("div")
          const messageText = document.createElement("span")

          messageContainer.setAttribute("data-testid", "notification-message")
          messageContainer.setAttribute("data-count", String(count))
          messageText.textContent = message
          messageContainer.appendChild(messageText)
          wrapper.appendChild(messageContainer)
          container.appendChild(wrapper)

          messageText.addEventListener("click", () => {
            setTimeout(() => wrapper.remove(), 100)
          })
        }

        addNotification(1, "First notification")
        addNotification(2, "Second notification")
        return true
      `)

      await runningSystemTest.expectNotificationMessage("First notification")
      await runningSystemTest.find("[data-testid='notification-message'][data-count='2']", {useBaseSelector: false})
      await runningSystemTest.expectNoElement("[data-testid='notification-message'][data-count='1']", {useBaseSelector: false})

      await scoundrelClient.eval(`
        const container = document.getElementById("system-test-notifications")
        if (container) container.remove()
        return true
      `)
    })
  })
})
