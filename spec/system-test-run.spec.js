// @ts-check

import SystemTest from "../src/system-test.js"

/**
 * @returns {{communicator: {sendCommand: jasmine.Spy}, systemTest: Record<string, any>}}
 */
function createSystemTestRunDouble() {
  const communicator = {
    sendCommand: jasmine.createSpy("sendCommand").and.resolveTo(undefined),
    ws: {readyState: 1}
  }

  return {
    communicator,
    systemTest: {
      debugLog: jasmine.createSpy("debugLog"),
      deleteAllCookies: jasmine.createSpy("deleteAllCookies").and.resolveTo(undefined),
      dismissTo: jasmine.createSpy("dismissTo").and.resolveTo(undefined),
      findByTestID: jasmine.createSpy("findByTestID").and.resolveTo(undefined),
      getCommunicator: jasmine.createSpy("getCommunicator").and.returnValue(communicator),
      getRootPath: jasmine.createSpy("getRootPath").and.returnValue("/blank?systemTest=true"),
      reinitialize: jasmine.createSpy("reinitialize").and.resolveTo(undefined),
      takeScreenshot: jasmine.createSpy("takeScreenshot").and.resolveTo(undefined),
      waitForClientWebSocket: jasmine.createSpy("waitForClientWebSocket").and.resolveTo(undefined),
      ws: {readyState: 1}
    }
  }
}

describe("SystemTest.run", () => {
  it("reinitializes the system test after a failed callback by default", async () => {
    const {communicator, systemTest} = createSystemTestRunDouble()
    spyOn(SystemTest, "current").and.returnValue(/** @type {SystemTest} */ (systemTest))

    await expectAsync(SystemTest.run(async () => {
      throw new Error("boom")
    })).toBeRejectedWithError("boom")

    expect(systemTest.takeScreenshot).toHaveBeenCalled()
    expect(communicator.sendCommand).toHaveBeenCalledWith({type: "teardown"})
    expect(systemTest.reinitialize).toHaveBeenCalledTimes(1)
  })

  it("can skip reinitializing the system test after a failed callback", async () => {
    const {systemTest} = createSystemTestRunDouble()
    spyOn(SystemTest, "current").and.returnValue(/** @type {SystemTest} */ (systemTest))

    await expectAsync(SystemTest.run({reinitializeAfterFailure: false}, async () => {
      throw new Error("boom")
    })).toBeRejectedWithError("boom")

    expect(systemTest.reinitialize).not.toHaveBeenCalled()
  })

  it("does not reinitialize the system test after a successful callback", async () => {
    const {systemTest} = createSystemTestRunDouble()
    spyOn(SystemTest, "current").and.returnValue(/** @type {SystemTest} */ (systemTest))

    await SystemTest.run(async () => {})

    expect(systemTest.reinitialize).not.toHaveBeenCalled()
  })
})
