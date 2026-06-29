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
  const scoundrelClients = [
    {backend: {ws: {readyState: 1}}},
    {backend: {ws: {readyState: 1}}}
  ]
  const systemTest = {
    _browserErrors: [],
    _errorFilter: undefined,
    _failOnBrowserError: true,
    _failOnConsoleError: false,
    _ignoredScoundrelClientCount: 0,
    _clientWsPort: 5233,
    _scoundrelPort: 5234,
    _urlArgs: {velociousTest: true},
    buildSystemTestPath: SystemTest.prototype.buildSystemTestPath,
    communicator,
    communicatorExists: jasmine.createSpy("communicatorExists").and.returnValue(true),
    debugLog: jasmine.createSpy("debugLog"),
    deleteAllCookies: jasmine.createSpy("deleteAllCookies").and.resolveTo(undefined),
    dismissTo: jasmine.createSpy("dismissTo").and.resolveTo(undefined),
    driverVisit: jasmine.createSpy("driverVisit").and.resolveTo(undefined),
    findByTestID: jasmine.createSpy("findByTestID").and.resolveTo(undefined),
    getCommandTimeout: jasmine.createSpy("getCommandTimeout").and.callFake((timeout) => timeout ?? 500),
    getCommunicator: jasmine.createSpy("getCommunicator").and.returnValue(communicator),
    getRootPath: jasmine.createSpy("getRootPath").and.returnValue("/blank?systemTest=true"),
    ignoreExistingScoundrelClients: SystemTest.prototype.ignoreExistingScoundrelClients,
    initializeBrowserContext: SystemTest.prototype.initializeBrowserContext,
    reinitialize: jasmine.createSpy("reinitialize").and.resolveTo(undefined),
    resetSteps: jasmine.createSpy("resetSteps"),
    resetToRootPathForRun: SystemTest.prototype.resetToRootPathForRun,
    sendBrowserCommand: SystemTest.prototype.sendBrowserCommand,
    server: {
      getClients: jasmine.createSpy("getClients").and.callFake(() => scoundrelClients)
    },
    takeScreenshot: jasmine.createSpy("takeScreenshot").and.resolveTo(undefined),
    visit: SystemTest.prototype.visit,
    visitPathWithDriverAndReconnect: SystemTest.prototype.visitPathWithDriverAndReconnect,
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
  /** @type {string | undefined} */
  let previousSystemTestHost

  beforeEach(() => {
    previousSystemTestHost = process.env.SYSTEM_TEST_HOST
  })

  afterEach(() => {
    if (previousSystemTestHost === undefined) {
      delete process.env.SYSTEM_TEST_HOST
    } else {
      process.env.SYSTEM_TEST_HOST = previousSystemTestHost
    }
  })

  it("uses in-app dismissTo before each run without reloading an open web session", async () => {
    process.env.SYSTEM_TEST_HOST = "expo-dev-server"
    const {systemTest} = createSystemTestRunDouble()
    spyOn(SystemTest, "current").and.returnValue(/** @type {SystemTest} */ (systemTest))

    await SystemTest.run(async () => {})

    expect(systemTest.dismissTo).toHaveBeenCalledOnceWith("/blank?systemTest=true")
    expect(systemTest.driverVisit).not.toHaveBeenCalled()
    expect(systemTest.waitForClientWebSocket).not.toHaveBeenCalled()
    expect(systemTest._ignoredScoundrelClientCount).toEqual(0)
    expect(systemTest.resetSteps).toHaveBeenCalled()
  })

  it("waits for websocket reconnection after in-app run reset closes the current websocket", async () => {
    process.env.SYSTEM_TEST_HOST = "expo-dev-server"
    const {systemTest} = createSystemTestRunDouble()
    systemTest.ws = {readyState: 3}
    spyOn(SystemTest, "current").and.returnValue(/** @type {SystemTest} */ (systemTest))

    await SystemTest.run(async () => {})

    expect(systemTest.dismissTo).toHaveBeenCalledOnceWith("/blank?systemTest=true")
    expect(systemTest.driverVisit).not.toHaveBeenCalled()
    expect(systemTest.waitForClientWebSocket).toHaveBeenCalledTimes(1)
  })

  it("uses in-app navigation for connected web visits so browser-local state is preserved", async () => {
    process.env.SYSTEM_TEST_HOST = "expo-dev-server"
    const {communicator, systemTest} = createSystemTestRunDouble()

    await systemTest.visit("/sign-in?from=test")

    expect(communicator.sendCommand).toHaveBeenCalledOnceWith({type: "visit", path: "/sign-in?from=test&velociousTest=true&systemTest=true&systemTestClientWsPort=5233&systemTestScoundrelPort=5234"})
    expect(systemTest.driverVisit).not.toHaveBeenCalled()
    expect(systemTest.waitForClientWebSocket).not.toHaveBeenCalled()
    expect(systemTest._ignoredScoundrelClientCount).toEqual(0)
  })

  it("reloads web visits through the driver when the command websocket is closed", async () => {
    process.env.SYSTEM_TEST_HOST = "expo-dev-server"
    const {communicator, systemTest} = createSystemTestRunDouble()
    communicator.ws = {readyState: 3}

    await systemTest.visit("/sign-in?from=test")

    expect(systemTest.driverVisit).toHaveBeenCalledOnceWith("/sign-in?from=test&velociousTest=true&systemTest=true&systemTestClientWsPort=5233&systemTestScoundrelPort=5234")
    expect(systemTest.waitForClientWebSocket).toHaveBeenCalledTimes(1)
    expect(communicator.sendCommand).toHaveBeenCalledOnceWith({type: "initialize"})
    expect(systemTest._ignoredScoundrelClientCount).toEqual(2)
  })

  it("reloads web visits through the driver when the command websocket is missing", async () => {
    process.env.SYSTEM_TEST_HOST = "expo-dev-server"
    const {communicator, systemTest} = createSystemTestRunDouble()
    communicator.ws = null

    await systemTest.visit("/sign-in?from=test")

    expect(systemTest.driverVisit).toHaveBeenCalledOnceWith("/sign-in?from=test&velociousTest=true&systemTest=true&systemTestClientWsPort=5233&systemTestScoundrelPort=5234")
    expect(systemTest.waitForClientWebSocket).toHaveBeenCalledTimes(1)
    expect(communicator.sendCommand).toHaveBeenCalledOnceWith({type: "initialize"})
    expect(systemTest._ignoredScoundrelClientCount).toEqual(2)
  })

  it("uses in-app navigation for native visits", async () => {
    process.env.SYSTEM_TEST_HOST = "native"
    const {communicator, systemTest} = createSystemTestRunDouble()

    await systemTest.visit("/sign-in", {timeout: 1500})

    expect(communicator.sendCommand).toHaveBeenCalledOnceWith({type: "visit", path: "/sign-in"})
    expect(systemTest.driverVisit).not.toHaveBeenCalled()
  })

  it("ignores pre-reload Scoundrel clients when resolving the current browser client", async () => {
    const oldClient = {backend: {ws: {readyState: 1}}}
    const currentClient = {backend: {ws: {readyState: 1}}}
    /** @type {Record<string, any>} */
    const systemTest = {
      _ignoredScoundrelClientCount: 1,
      debugLog: jasmine.createSpy("debugLog"),
      getCommunicator: jasmine.createSpy("getCommunicator").and.returnValue({
        sendCommand: jasmine.createSpy("sendCommand").and.resolveTo(undefined)
      }),
      getScoundrelClient: SystemTest.prototype.getScoundrelClient,
      server: {
        getClients: jasmine.createSpy("getClients").and.returnValue([oldClient, currentClient])
      }
    }

    const client = await systemTest.getScoundrelClient()

    expect(client).toBe(currentClient)
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
