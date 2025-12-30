// @ts-check

import SystemTest from "../src/system-test.js"
import SystemTestHelper from "./support/system-test-helper.js"

const systemTestHelper = new SystemTestHelper()
systemTestHelper.installJasmineHooks()

describe("SystemTest finders", () => {
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
})
