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
  const systemTest = {
    _browserErrors: [],
    _errorFilter: undefined,
    _failOnBrowserError: true,
    _failOnConsoleError: false,
    debugLog: jasmine.createSpy("debugLog"),
    deleteAllCookies: jasmine.createSpy("deleteAllCookies").and.resolveTo(undefined),
    dismissTo: jasmine.createSpy("dismissTo").and.resolveTo(undefined),
    driverVisit: jasmine.createSpy("driverVisit").and.resolveTo(undefined),
    findByTestID: jasmine.createSpy("findByTestID").and.resolveTo(undefined),
    getCommunicator: jasmine.createSpy("getCommunicator").and.returnValue(communicator),
    getRootPath: jasmine.createSpy("getRootPath").and.returnValue("/blank?systemTest=true"),
    reinitialize: jasmine.createSpy("reinitialize").and.resolveTo(undefined),
    resetToRootPathForRun: SystemTest.prototype.resetToRootPathForRun,
    takeScreenshot: jasmine.createSpy("takeScreenshot").and.resolveTo(undefined),
    waitForClientWebSocket: jasmine.createSpy("waitForClientWebSocket"),
    ws: {readyState: 1}
  }

  systemTest.waitForClientWebSocket.and.callFake(async () => {
    const ws = {readyState: 1}

    systemTest.ws = ws
    communicator.ws = ws
  })

  systemTest.applyArgs = jasmine.createSpy("applyArgs").and.callFake((args = {}) => {
    if ("errorFilter" in args) systemTest._errorFilter = args.errorFilter
    if ("failOnBrowserError" in args) systemTest._failOnBrowserError = args.failOnBrowserError ?? true
    if ("failOnConsoleError" in args) systemTest._failOnConsoleError = args.failOnConsoleError ?? false
  })

  return {
    communicator,
    systemTest
  }
}

describe("SystemTest.run", () => {
  const originalSystemTestHost = process.env.SYSTEM_TEST_HOST

  afterEach(() => {
    if (originalSystemTestHost === undefined) {
      delete process.env.SYSTEM_TEST_HOST
    } else {
      process.env.SYSTEM_TEST_HOST = originalSystemTestHost
    }
  })

  it("reloads the root path through the driver before each web run", async () => {
    process.env.SYSTEM_TEST_HOST = "expo-dev-server"
    const {systemTest} = createSystemTestRunDouble()
    spyOn(SystemTest, "current").and.returnValue(/** @type {SystemTest} */ (systemTest))

    await SystemTest.run(async () => {})

    expect(systemTest.driverVisit).toHaveBeenCalledOnceWith("/blank?systemTest=true")
    expect(systemTest.waitForClientWebSocket).toHaveBeenCalledTimes(1)
    expect(systemTest.dismissTo).not.toHaveBeenCalled()
  })

  it("uses in-app dismissTo before each native run", async () => {
    process.env.SYSTEM_TEST_HOST = "native"
    const {systemTest} = createSystemTestRunDouble()
    spyOn(SystemTest, "current").and.returnValue(/** @type {SystemTest} */ (systemTest))

    await SystemTest.run(async () => {})

    expect(systemTest.dismissTo).toHaveBeenCalledOnceWith("/blank?systemTest=true")
    expect(systemTest.driverVisit).not.toHaveBeenCalled()
  })

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

  it("clears run-scoped browser error state after a successful callback", async () => {
    const {systemTest} = createSystemTestRunDouble()
    const errorFilter = () => false
    spyOn(SystemTest, "current").and.returnValue(/** @type {SystemTest} */ (systemTest))

    await SystemTest.run({errorFilter, failOnBrowserError: false, failOnConsoleError: true}, async (runningSystemTest) => {
      runningSystemTest._browserErrors.push(new Error("transient browser error"))
    })

    expect(systemTest._browserErrors).toEqual([])
    expect(systemTest._errorFilter).toBeUndefined()
    expect(systemTest._failOnBrowserError).toBeTrue()
    expect(systemTest._failOnConsoleError).toBeFalse()
  })
})
