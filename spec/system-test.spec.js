// @ts-check

import wait from "awaitery/build/wait.js"

import SystemTest from "../src/system-test.js"
import DummyHttpServerEnvironment from "./support/dummy-http-server.js"

const debug = process.env.SYSTEM_TEST_DEBUG === "true"
const debugLog = (...args) => { if (debug) console.log(...args) }
const dummyHttpServerEnvironment = new DummyHttpServerEnvironment()
jasmine.DEFAULT_TIMEOUT_INTERVAL = 60000

describe("System test", () => {
  /** @type {SystemTest | undefined} */
  let systemTest

  beforeAll(async () => {
    debugLog("[system-test] beforeAll: starting dummy HTTP env")
    try {
      await dummyHttpServerEnvironment.start()
      await wait(1000)

      debugLog("[system-test] beforeAll: creating SystemTest")
      systemTest = SystemTest.current({
        debug,
        host: "127.0.0.1",
        port: 6001,
        httpHost: "0.0.0.0",
        httpPort: 6001,
        errorFilter: (error) => {
          if (typeof error?.value?.[0] === "string" && error.value[0].includes("Uncaught Error: Minified React error #418; visit")) return false
          return true
        }
      })
      debugLog("[system-test] beforeAll: starting SystemTest")
      await systemTest.start()
      debugLog("[system-test] beforeAll: SystemTest started")
    } catch (error) {
      console.error("[system-test] beforeAll error", error)
      throw error
    }
  })

  afterAll(async () => {
    debugLog("[system-test] afterAll: stopping SystemTest and dummy HTTP env")
    try {
      await systemTest?.stop()
      await dummyHttpServerEnvironment.stop()
      debugLog("[system-test] afterAll: teardown complete")
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
})
