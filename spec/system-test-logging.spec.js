// @ts-check

import SystemTestHelper from "./support/system-test-helper.js"

const systemTestHelper = new SystemTestHelper()
systemTestHelper.installJasmineHooks()
const isNative = process.env.SYSTEM_TEST_NATIVE === "true"
const itIfWeb = isNative ? xit : it

describe("SystemTest browser log output", () => {
  itIfWeb("prints browser logs after a startup crash triggered by query params", async () => {
    const systemTest = systemTestHelper.getSystemTest()
    const logSpy = spyOn(console, "log")
    const visitPath = "/blank?systemTest=true&systemTestThrowOnStartup=true"
    const expectedMessage = "System test startup crash requested"

    try {
      await systemTest.driverVisit(visitPath)
      expect(await systemTest.getCurrentUrl()).toContain("systemTestThrowOnStartup=true")
      await expectAsync(systemTest.getDriver().executeScript(`
        if (window.location.search.includes("systemTestThrowOnStartup=true")) {
          console.error("${expectedMessage}")
          throw new Error("${expectedMessage}")
        }
      `)).toBeRejected()
    } finally {
      await systemTest.takeScreenshot()
      await systemTest.driverVisit("/blank?systemTest=true")
      await systemTest.findByTestID("blankText", {useBaseSelector: false})
    }

    const printedLines = logSpy.calls.allArgs().map((callArgs) => String(callArgs[0]))

    expect(printedLines).toContain("Browser logs:")
    expect(printedLines.some((line) => line.includes(expectedMessage) || line.includes("(no browser logs)"))).toBeTrue()
  })
})
