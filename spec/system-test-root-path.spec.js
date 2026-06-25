// @ts-check

import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import SystemTest from "../src/system-test.js"
import SystemTestHttpServer from "../src/system-test-http-server.js"

describe("SystemTest root path", () => {
  /** @type {string | undefined} */
  let previousSystemTestHost
  /** @type {string | undefined} */
  let previousCwd

  beforeEach(() => {
    previousSystemTestHost = process.env.SYSTEM_TEST_HOST
    previousCwd = process.cwd()
  })

  afterEach(async () => {
    if (previousSystemTestHost === undefined) {
      delete process.env.SYSTEM_TEST_HOST
    } else {
      process.env.SYSTEM_TEST_HOST = previousSystemTestHost
    }

    if (previousCwd) process.chdir(previousCwd)
  })

  it("serves directory index files for exported static routes without trailing slashes", async () => {
    const tempRootPath = await fs.mkdtemp(path.join(os.tmpdir(), "system-testing-dist-"))

    try {
      await fs.mkdir(path.join(tempRootPath, "dist", "admin", "events"), {recursive: true})
      await fs.writeFile(path.join(tempRootPath, "dist", "admin", "events", "index.html"), "admin events")
      process.chdir(tempRootPath)

      const response = {
        body: "",
        headers: {},
        statusCode: 0,
        end(content) {
          this.body = content.toString()
        },
        setHeader(key, value) {
          this.headers[key] = value
        }
      }

      await new SystemTestHttpServer().onHttpServerRequest(
        /** @type {any} */ ({headers: {host: "localhost:1984"}, url: "/admin/events"}),
        /** @type {any} */ (response)
      )

      expect(response.statusCode).toBe(200)
      expect(response.body).toBe("admin events")
      expect(response.headers["Content-Type"]).toBe("text/html")
    } finally {
      process.chdir(previousCwd || tempRootPath)
      await fs.rm(tempRootPath, {force: true, recursive: true})
    }
  })

  it("serves exported sibling HTML files before same-name route directories", async () => {
    const tempRootPath = await fs.mkdtemp(path.join(os.tmpdir(), "system-testing-dist-"))

    try {
      await fs.mkdir(path.join(tempRootPath, "dist", "events", "[id]"), {recursive: true})
      await fs.writeFile(path.join(tempRootPath, "dist", "events.html"), "events route")
      await fs.writeFile(path.join(tempRootPath, "dist", "events", "[id]", "index.html"), "event show route")
      process.chdir(tempRootPath)

      const response = {
        body: "",
        headers: {},
        statusCode: 0,
        end(content) {
          this.body = content.toString()
        },
        setHeader(key, value) {
          this.headers[key] = value
        }
      }

      await new SystemTestHttpServer().onHttpServerRequest(
        /** @type {any} */ ({headers: {host: "localhost:1984"}, url: "/events"}),
        /** @type {any} */ (response)
      )

      expect(response.statusCode).toBe(200)
      expect(response.body).toBe("events route")
      expect(response.headers["Content-Type"]).toBe("text/html")
    } finally {
      process.chdir(previousCwd || tempRootPath)
      await fs.rm(tempRootPath, {force: true, recursive: true})
    }
  })

  it("waits for the initial root path navigation when Android Chrome reports host routing is not ready", async () => {
    process.env.SYSTEM_TEST_HOST = "dist"
    const adapter = {
      getTimeouts: () => 100,
      setBaseUrl: jasmine.createSpy("setBaseUrl"),
      setTimeouts: jasmine.createSpy("setTimeouts").and.resolveTo(undefined),
      start: jasmine.createSpy("start").and.resolveTo(undefined)
    }
    const visitAttempts = []

    spyOn(SystemTestHttpServer.prototype, "start").and.resolveTo(undefined)
    spyOn(SystemTestHttpServer.prototype, "assertReachable").and.resolveTo(undefined)
    spyOn(SystemTest.prototype, "getDriverAdapter").and.returnValue(/** @type {any} */ (adapter))
    spyOn(SystemTest.prototype, "startScoundrel").and.resolveTo(undefined)
    spyOn(SystemTest.prototype, "startWebSocketServer").and.resolveTo(undefined)
    spyOn(SystemTest.prototype, "waitForClientWebSocket").and.resolveTo(undefined)
    spyOn(SystemTest.prototype, "find").and.resolveTo(/** @type {any} */ ({}))
    spyOn(SystemTest.prototype, "findByTestID").and.resolveTo(/** @type {any} */ ({}))
    spyOn(SystemTest.prototype, "driverVisit").and.callFake((path) => {
      visitAttempts.push(path)

      if (visitAttempts.length === 1) {
        return Promise.reject("unknown error: net::ERR_ADDRESS_UNREACHABLE")
      }

      return Promise.resolve()
    })

    await new SystemTest({
      httpConnectHost: "10.0.2.2",
      httpHost: "0.0.0.0",
      httpPort: 1984
    }).start()

    expect(visitAttempts).toEqual([
      "/blank?systemTest=true",
      "/blank?systemTest=true"
    ])
  })

  it("propagates custom websocket ports into the browser URL", () => {
    spyOn(SystemTest.prototype, "startScoundrel").and.callFake(() => {})

    const systemTest = new SystemTest({
      clientWsPort: 4123,
      scoundrelPort: 5123
    })

    const rootPath = systemTest.getRootPath()
    const url = new URL(rootPath, "http://localhost")

    expect(url.searchParams.get("systemTestClientWsPort")).toBe("4123")
    expect(url.searchParams.get("systemTestScoundrelPort")).toBe("5123")
  })

  it("keeps explicit URL args authoritative when the same params are already set", () => {
    spyOn(SystemTest.prototype, "startScoundrel").and.callFake(() => {})

    const systemTest = new SystemTest({
      clientWsPort: 4123,
      scoundrelPort: 5123,
      urlArgs: {
        systemTestClientWsPort: 7001,
        systemTestScoundrelPort: 7002
      }
    })

    const rootPath = systemTest.getRootPath()
    const url = new URL(rootPath, "http://localhost")

    expect(url.searchParams.getAll("systemTestClientWsPort")).toEqual(["7001"])
    expect(url.searchParams.getAll("systemTestScoundrelPort")).toEqual(["7002"])
  })
  it("ignores the known Chrome password-field DOM warning in live browser errors", () => {
    spyOn(SystemTest.prototype, "startScoundrel").and.callFake(() => {})

    const systemTest = new SystemTest()

    expect(systemTest.shouldIgnoreError({
      value: ["[DOM] Password field is not contained in a form: (More info: https://goo.gl/9p2vKq) %o"]
    })).toBeTrue()
  })


  it("ignores the known Chrome password-field DOM warning when Chrome prefixes the URL", () => {
    spyOn(SystemTest.prototype, "startScoundrel").and.callFake(() => {})

    const systemTest = new SystemTest()

    expect(systemTest.shouldIgnoreError({
      value: ["http://127.0.0.1:8085/ - [DOM] Password field is not contained in a form: (More info: https://goo.gl/9p2vKq) %o"]
    })).toBeTrue()
  })

  it("does not ignore app errors that only mention the same phrase", () => {
    spyOn(SystemTest.prototype, "startScoundrel").and.callFake(() => {})

    const systemTest = new SystemTest()

    expect(systemTest.shouldIgnoreError({
      value: ["Password field is not contained in a form"]
    })).toBeFalse()
  })

})
