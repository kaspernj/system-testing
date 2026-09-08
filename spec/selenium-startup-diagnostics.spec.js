// @ts-check

import {once} from "node:events"
import {ChildProcess, spawn} from "node:child_process"
import fs from "node:fs/promises"
import http from "node:http"
import path from "node:path"
import logging from "selenium-webdriver/lib/logging.js"
import diagnosticsChannel from "node:diagnostics_channel"
import {HttpClient} from "selenium-webdriver/http/index.js"
import {Executor} from "selenium-webdriver/lib/http.js"
import {By, Session, WebDriver} from "selenium-webdriver"
import SystemTest from "../src/system-test.js"
import SystemTestHelper from "./support/system-test-helper.js"

const logger = logging.getLogger("driver.http.Executor")
const marker = "[Selenium startup diagnostics]"

/**
 * @param {(args: {directory: string, helper: SystemTestHelper, messages: jasmine.Spy}) => Promise<void>} callback
 * @returns {Promise<void>}
 */
async function withHelper(callback) {
  const state = globalThis.__systemTestHelperState
  const originalState = {...state}
  const originalTimeout = jasmine.DEFAULT_TIMEOUT_INTERVAL
  const environment = {...process.env}
  await fs.mkdir(path.resolve("tmp"), {recursive: true})
  const directory = await fs.mkdtemp(path.resolve("tmp/startup-diagnostics-spec-"))
  const helper = new SystemTestHelper()
  const originalDummyRoot = helper.dummyHttpServerEnvironment.dummyAppRoot
  state.started = false
  state.refCount = 0
  state.systemTest = undefined
  helper.dummyHttpServerEnvironment.dummyAppRoot = directory
  spyOn(helper.dummyHttpServerEnvironment, "start").and.resolveTo(undefined)
  spyOn(helper.dummyHttpServerEnvironment, "stop").and.resolveTo(undefined)
  process.env.SYSTEM_TEST_STARTUP_DIAGNOSTICS = "true"
  process.env.SYSTEM_TEST_CHROMEDRIVER_PATH = process.execPath
  process.env.SYSTEM_TEST_DRIVER = "selenium"
  const messages = spyOn(console, "error")
  const channels = ["child_process", "http.server.request.start", "http.server.response.finish"]
  const subscriptions = channels.map((name) => diagnosticsChannel.channel(name).hasSubscribers)
  try {
    await callback({directory, helper, messages})
  } finally {
    await helper.stop()
    expect(channels.map((name) => diagnosticsChannel.channel(name).hasSubscribers)).toEqual(subscriptions)
    helper.dummyHttpServerEnvironment.dummyAppRoot = originalDummyRoot
    Object.assign(state, originalState)
    jasmine.DEFAULT_TIMEOUT_INTERVAL = originalTimeout
    for (const name of ["SYSTEM_TEST_STARTUP_DIAGNOSTICS", "SYSTEM_TEST_CHROMEDRIVER_PATH", "SYSTEM_TEST_DRIVER", "SYSTEM_TEST_HTTP_PORT"]) {
      if (environment[name] === undefined) delete process.env[name]
      else process.env[name] = environment[name]
    }
    await fs.rm(directory, {recursive: true})
  }
}

/**
 * @param {SystemTestHelper} helper
 * @returns {Promise<unknown>}
 */
async function start(helper) {
  jasmine.clock().install()
  let result
  try {
    result = helper.start().catch((error) => error)
    await Promise.resolve()
    jasmine.clock().tick(1000)
  } finally {
    jasmine.clock().uninstall()
  }
  return await result
}

describe("Selenium startup diagnostics", () => {
  it("limits process observations and removes listeners from children that never spawn", async () => {
    await withHelper(async ({helper}) => {
      const children = []
      spyOn(SystemTest, "current").and.returnValue(/** @type {any} */ ({
        start: async () => {
          for (let index = 0; index < 40; index++) {
            const child = new ChildProcess()
            children.push(child)
          }
          expect(children.reduce((count, child) => count + child.listenerCount("spawn"), 0)).toBeLessThanOrEqual(8)
        },
        stop: async () => {}
      }))
      expect(await start(helper)).toBeUndefined()
      expect(children.every((child) => child.listenerCount("spawn") === 0)).toBeTrue()
    })
  })

  it("omits unbounded runtime fields and all non-allowlisted capability payloads", async () => {
    await withHelper(async ({directory, helper}) => {
      spyOn(SystemTest, "current").and.returnValue(/** @type {any} */ ({
        start: async () => {
          logger.finer(">>> POST /session")
          const body = {value: {sessionId: "SECRET_SESSION", capabilities: {
            browserVersion: `1.${"1".repeat(60000)}`,
            chrome: {chromedriverVersion: "148.0.7778.178 (SECRET_BUILD_INFO)"},
            pageLoadStrategy: "none",
            secret: "SECRET_CAPABILITY"
          }}}
          logger.finer(`>>>\nPOST /session HTTP/1.1\n\n{"cookie":"SECRET_BODY"}\n<<<\nHTTP/1.1 200\n\n${JSON.stringify(body)}`)
        },
        stop: async () => {}
      }))
      expect(await start(helper)).toBeUndefined()
      const saved = await fs.readFile(path.join(directory, "tmp/startup-diagnostics/selenium.json"), "utf8")
      expect(saved.length).toBeLessThan(50000)
      expect(saved).not.toContain("SECRET_")
      expect(Object.keys(JSON.parse(saved).runtime)).toEqual(["chromedriver", "pageLoadStrategy"])
      expect(JSON.parse(saved).runtime.chromedriver).toBe("148.0.7778.178")
    })
  })

  it("reports artifact write failures separately while retaining the exact startup cause and cleanup", async () => {
    await withHelper(async ({directory, helper, messages}) => {
      await fs.mkdir(path.join(directory, "tmp"))
      await fs.writeFile(path.join(directory, "tmp/startup-diagnostics"), "directory blocked by fixture")
      const primary = new Error("original startup failure")
      const stop = jasmine.createSpy("stop").and.resolveTo(undefined)
      spyOn(SystemTest, "current").and.returnValue(/** @type {any} */ ({start: async () => { throw primary }, stop}))
      expect(await start(helper)).toBe(primary)
      expect(stop).toHaveBeenCalledTimes(1)
      expect(messages.calls.allArgs().some(([label, error]) => label === "[Selenium startup diagnostics write failed]" && error.stack)).toBeTrue()
      expect(messages.calls.allArgs().filter(([label]) => label === marker).length).toBe(2)
    })
  })

  it("persists a pending request before failed cleanup without replacing the primary cause or retaining secrets", async () => {
    await withHelper(async ({directory, helper, messages}) => {
      const primary = new Error("root deadline", {cause: new Error("lookup deadline")})
      const secondary = new Error("quit deadline")
      const systemTest = {
        start: async () => {
          logger.finer(">>> POST /session/SECRET_SESSION/elements")
          throw primary
        },
        stop: jasmine.createSpy("stop").and.callFake(async () => {
          const beforeCleanup = messages.calls.allArgs().find(([label]) => label === marker)
          expect(beforeCleanup).toBeDefined()
          if (beforeCleanup) {
            const beforeCleanupFile = JSON.parse(await fs.readFile(path.join(directory, "tmp/startup-diagnostics/selenium.json"), "utf8"))
            expect(beforeCleanupFile.phase).toBe("startup-failed")
          }
          logger.finer(">>> DELETE /session/SECRET_SESSION")
          throw secondary
        }),
        getDriver: jasmine.createSpy("poisoned session access").and.throwError("session is terminal")
      }
      spyOn(SystemTest, "current").and.returnValue(/** @type {any} */ (systemTest))
      const level = logger.getLevel()
      const failure = await start(helper)
      expect(failure.cause).toBe(primary)
      expect(failure.errors).toEqual([primary, secondary])
      expect(systemTest.stop).toHaveBeenCalledTimes(1)
      expect(systemTest.getDriver).not.toHaveBeenCalled()
      expect(logger.getLevel()).toBe(level)
      const captures = messages.calls.allArgs().filter(([label]) => label === marker)
      expect(captures.length).toBe(2)
      if (!captures.length) return
      const snapshot = JSON.parse(captures[1][1])
      expect(snapshot.phase).toBe("cleanup-failed")
      expect(snapshot.events.some((event) => event.kind === "webdriver-request" && event.command === "findElements")).toBeTrue()
      expect(snapshot.pending.map((event) => event.command)).toEqual(["findElements", "quit"])
      const filename = path.join(directory, "tmp/startup-diagnostics/selenium.json")
      const saved = await fs.readFile(filename, "utf8")
      expect(saved).not.toContain("SECRET_SESSION")
      expect(JSON.parse(saved)).toEqual(snapshot)
      logger.finer(">>> POST /session/AFTER_DISPOSE/elements")
      expect(await fs.readFile(filename, "utf8")).toBe(saved)
    })
  })

  it("observes real HTTP execution and app response completion without logging bodies, cookies or session identifiers", async () => {
    await withHelper(async ({directory, helper, messages}) => {
      const server = http.createServer((request, response) => {
        response.setHeader("Set-Cookie", "SECRET_COOKIE=private")
        response.setHeader("Content-Type", "application/json")
        response.end(JSON.stringify({value: [{"element-6066-11e4-a52e-4f735466cecf": "SECRET_ELEMENT"}]}))
      })
      server.listen(0, "127.0.0.1")
      await once(server, "listening")
      const port = /** @type {import("node:net").AddressInfo} */ (server.address()).port
      process.env.SYSTEM_TEST_HTTP_PORT = String(port)
      const driver = new WebDriver(new Session("SECRET_SESSION", {}), new Executor(new HttpClient(`http://127.0.0.1:${port}`)))
      spyOn(SystemTest, "current").and.returnValue(/** @type {any} */ ({
        start: async () => {
          const elements = await driver.findElements(By.css("[data-secret='SECRET_BODY']"))
          expect(elements.length).toBe(1)
        },
        stop: async () => {}
      }))
      try {
        expect(await start(helper)).toBeUndefined()
        const filename = path.join(directory, "tmp/startup-diagnostics/selenium.json")
        const exists = await fs.stat(filename).then(() => true, () => false)
        expect(exists).toBeTrue()
        if (!exists) return
        const saved = await fs.readFile(filename, "utf8")
        const snapshot = JSON.parse(saved)
        expect(snapshot.phase).toBe("ready")
        expect(snapshot.events.some((event) => event.kind === "webdriver-response" && event.command === "findElements" && event.status === 200)).toBeTrue()
        expect(snapshot.events.some((event) => event.kind === "app-response" && event.status === 200)).toBeTrue()
        expect(snapshot.pending).toEqual([])
        expect(saved).not.toContain("SECRET_")
        expect(messages).not.toHaveBeenCalled()
      } finally {
        await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve(undefined)))
      }
    })
  })

  it("captures allowlisted driver receipt and process exit through public child-process events with bounded output", async () => {
    await withHelper(async ({directory, helper}) => {
      const childSource = `process.stderr.write('[123.123][INFO]: [SECRET_SESSION] COMMAND FindElements {\\n"cookie":"SECRET_COOKIE"\\n}\\n' + 'SECRET_LONG_LINE'.repeat(10000) + '\\n[123.124][INFO]: [SECRET_SESSION] RESPONSE FindElements ERROR tab crashed\\n')`
      let child
      spyOn(SystemTest, "current").and.returnValue(/** @type {any} */ ({
        start: async () => {
          child = spawn(process.execPath, ["-e", childSource, "--", "--port=0"], {stdio: ["ignore", "pipe", "pipe"]})
          child.stderr.resume()
          await once(child, "close")
          throw new Error("startup failed")
        },
        stop: async () => {}
      }))
      expect(await start(helper)).toEqual(jasmine.any(Error))
      const filename = path.join(directory, "tmp/startup-diagnostics/selenium.json")
      const exists = await fs.stat(filename).then(() => true, () => false)
      expect(exists).toBeTrue()
      if (!exists) return
      const saved = await fs.readFile(filename, "utf8")
      const snapshot = JSON.parse(saved)
      expect(snapshot.events.some((event) => event.kind === "driver-command" && event.command === "FindElements")).toBeTrue()
      expect(snapshot.events.some((event) => event.kind === "driver-response" && event.failure === "tab-crashed")).toBeTrue()
      expect(snapshot.events.some((event) => event.kind === "driver-exit" && event.code === 0)).toBeTrue()
      expect(saved).not.toContain("SECRET_")
      expect(saved.length).toBeLessThan(50000)
      expect(child.listenerCount("exit")).toBe(0)
      expect(child.stderr.listenerCount("data")).toBe(0)
    })
  })

  it("keeps an actual pending HTTP request durable and ignores its completion after startup ownership ends", async () => {
    await withHelper(async ({directory, helper}) => {
      let response
      let acknowledge
      const received = new Promise((resolve) => { acknowledge = resolve })
      const server = http.createServer((_request, incomingResponse) => {
        response = incomingResponse
        acknowledge()
      })
      server.listen(0, "127.0.0.1")
      await once(server, "listening")
      const port = /** @type {import("node:net").AddressInfo} */ (server.address()).port
      process.env.SYSTEM_TEST_HTTP_PORT = String(port)
      const driver = new WebDriver(new Session("SECRET_SESSION", {}), new Executor(new HttpClient(`http://127.0.0.1:${port}`)))
      let pending
      const primary = new Error("startup owner ended with pending wire work")
      spyOn(SystemTest, "current").and.returnValue(/** @type {any} */ ({
        start: async () => {
          pending = driver.findElements(By.css("SECRET_SELECTOR"))
          await received
          throw primary
        },
        stop: async () => {}
      }))
      try {
        expect(await start(helper)).toBe(primary)
        const filename = path.join(directory, "tmp/startup-diagnostics/selenium.json")
        const saved = await fs.readFile(filename, "utf8")
        const snapshot = JSON.parse(saved)
        expect(snapshot.pending.some((event) => event.kind === "webdriver-request" && event.command === "findElements")).toBeTrue()
        expect(snapshot.pending.some((event) => event.kind === "app-request")).toBeTrue()
        expect(snapshot.events.some((event) => event.kind === "webdriver-response")).toBeFalse()
        response.end(JSON.stringify({value: []}))
        expect(await pending).toEqual([])
        expect(await fs.readFile(filename, "utf8")).toBe(saved)
        expect(saved).not.toContain("SECRET_")
      } finally {
        if (response && !response.writableEnded) response.end(JSON.stringify({value: []}))
        await pending
        await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve(undefined)))
      }
    })
  })

  it("bounds bookkeeping and restores existing logger listeners after successful startup", async () => {
    await withHelper(async ({directory, helper}) => {
      const existing = jasmine.createSpy("existing logger handler")
      const level = logger.getLevel()
      logger.addHandler(existing)
      spyOn(SystemTest, "current").and.returnValue(/** @type {any} */ ({
        start: async () => {
          for (let count = 0; count < 500; count++) logger.finer(">>> POST /session/SECRET_SESSION/elements")
        },
        stop: async () => {}
      }))
      try {
        expect(await start(helper)).toBeUndefined()
        expect(existing).toHaveBeenCalled()
        expect(logger.getLevel()).toBe(level)
        const filename = path.join(directory, "tmp/startup-diagnostics/selenium.json")
        const exists = await fs.stat(filename).then(() => true, () => false)
        expect(exists).toBeTrue()
        if (!exists) return
        const snapshot = JSON.parse(await fs.readFile(filename, "utf8"))
        expect(snapshot.events.length).toBeLessThanOrEqual(128)
        expect(snapshot.pending.length).toBeLessThanOrEqual(32)
        expect(snapshot.dropped).toBeGreaterThan(0)
      } finally {
        logger.removeHandler(existing)
      }
    })
  })

  it("does not report a version probe exiting as the managed driver exiting", async () => {
    await withHelper(async ({directory, helper}) => {
      spyOn(SystemTest, "current").and.returnValue(/** @type {any} */ ({
        start: async () => {
          const probe = spawn(process.execPath, ["--version"], {stdio: ["ignore", "pipe", "pipe"]})
          probe.stdout.resume()
          await once(probe, "close")
        },
        stop: async () => {}
      }))
      expect(await start(helper)).toBeUndefined()
      const snapshot = JSON.parse(await fs.readFile(path.join(directory, "tmp/startup-diagnostics/selenium.json"), "utf8"))
      expect(snapshot.events.filter((event) => event.kind.startsWith("driver-"))).toEqual([])
    })
  })
})
