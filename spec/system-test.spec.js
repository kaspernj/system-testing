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
      const evalProxy = await scoundrelClient.eval("({ sum: 2 + 3, href: window.location.href })")
      const sum = await (await evalProxy.sum).__serialize()
      const href = await (await evalProxy.href).__serialize()

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
})
