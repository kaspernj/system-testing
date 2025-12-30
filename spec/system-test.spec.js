// @ts-check

import SystemTest from "../src/system-test.js"
import SystemTestHelper from "./support/system-test-helper.js"

const systemTestHelper = new SystemTestHelper()
systemTestHelper.installJasmineHooks()

describe("System test", () => {
  it("shows the welcome text on the front page", async () => {
    await SystemTest.run(async (runningSystemTest) => {
      await runningSystemTest.visit("/")
      await runningSystemTest.findByTestID("welcomeText", {useBaseSelector: false})
    })
  })

  it("evaluates browser JavaScript via Scoundrel", async () => {
    await SystemTest.run(async (runningSystemTest) => {
      const scoundrelClient = await runningSystemTest.getScoundrelClient()
      const evalReference = await scoundrelClient.evalWithReference("({ sum: 2 + 3, href: window.location.href })")
      const sum = await evalReference.readAttribute("sum")
      const href = await evalReference.readAttribute("href")

      expect(sum).toEqual(5)
      expect(href).toContain("systemTest=true")
    })
  })

  it("reinitializes and can keep running", async () => {
    const systemTest = systemTestHelper.getSystemTest()

    await systemTest.visit("/")
    await systemTest.findByTestID("welcomeText", {useBaseSelector: false})

    const scoundrelClient = await systemTest.getScoundrelClient()
    await scoundrelClient.eval("(() => { document.body.setAttribute('data-reinit-marker', 'true'); })()")
    await systemTest.find("body[data-reinit-marker='true']", {useBaseSelector: false})

    await systemTest.reinitialize()

    expect(systemTest.isStarted()).toBeTrue()

    await systemTest.expectNoElement("body[data-reinit-marker='true']", {useBaseSelector: false})
    await systemTest.findByTestID("blankText", {useBaseSelector: false})
    await systemTest.visit("/")
    await systemTest.findByTestID("welcomeText", {useBaseSelector: false})
  })
})
