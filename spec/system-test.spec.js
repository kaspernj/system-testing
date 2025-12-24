// @ts-check

import wait from "awaitery/build/wait.js"

import SystemTest from "../src/system-test.js"
import DummyHttpServerEnvironment from "./support/dummy-http-server.js"

const dummyHttpServerEnvironment = new DummyHttpServerEnvironment()
jasmine.DEFAULT_TIMEOUT_INTERVAL = 60000

describe("System test", () => {
  /** @type {SystemTest | undefined} */
  let systemTest

  beforeAll(async () => {
    console.log("[system-test] beforeAll: starting dummy HTTP env")
    try {
      await dummyHttpServerEnvironment.start()
      await wait(1000)

      console.log("[system-test] beforeAll: creating SystemTest")
      systemTest = SystemTest.current({
        debug: true,
        host: "127.0.0.1",
        port: 6001,
        httpHost: "0.0.0.0",
        httpPort: 6001,
        errorFilter: (error) => {
          if (typeof error?.value?.[0] === "string" && error.value[0].includes("Uncaught Error: Minified React error #418; visit")) return false
          return true
        }
      })
      console.log("[system-test] beforeAll: starting SystemTest")
      await systemTest.start()
      console.log("[system-test] beforeAll: SystemTest started")
    } catch (error) {
      console.error("[system-test] beforeAll error", error)
      throw error
    }
  })

  afterAll(async () => {
    console.log("[system-test] afterAll: stopping SystemTest and dummy HTTP env")
    try {
      await systemTest?.stop()
      await dummyHttpServerEnvironment.stop()
      console.log("[system-test] afterAll: teardown complete")
    } catch (error) {
      console.error("[system-test] afterAll error", error)
      throw error
    }
  })

  it("shows the welcome text on the front page", async () => {
    await SystemTest.run(async (runningSystemTest) => {
      await runningSystemTest.visit("/")
      await runningSystemTest.findByTestID("welcomeText", {useBaseSelector: false})
    })
  })
})
