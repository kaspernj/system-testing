// @ts-check

import {createHash} from "node:crypto"
import diagnosticsChannel from "node:diagnostics_channel"
import fs from "node:fs"
import {createRequire} from "node:module"
import {Socket} from "node:net"
import path from "node:path"
import logging from "selenium-webdriver/lib/logging.js"

/**
 * @typedef {object} StartupEvent
 * @property {number} sequence Local sequence, never a session or element identifier.
 * @property {string} kind Allowlisted event kind.
 * @property {number} observedAt Observation time.
 * @property {string} [command] Allowlisted command name.
 * @property {number} [requestSequence] Corresponding local request sequence.
 * @property {number} [status] HTTP response status.
 * @property {string} [resource] Static resource category, never its URL.
 * @property {number | null} [code] Driver exit code.
 * @property {string | null} [signal] Driver exit signal.
 * @property {string} [failure] Allowlisted driver failure category.
 * @property {number} [processSequence] Local managed-process correlation.
 */

const require = createRequire(import.meta.url)
const driverCommands = new Set(["InitSession", "SetTimeouts", "Navigate", "FindElements", "ExecuteScript", "Quit", "GetLog"])
const httpCommands = new Map([
  ["POST /session", "newSession"], ["GET /status", "status"],
  ["POST /session/:session/timeouts", "setTimeout"], ["POST /session/:session/url", "navigate"],
  ["POST /session/:session/elements", "findElements"], ["POST /session/:session/execute/sync", "executeScript"],
  ["DELETE /session/:session", "quit"]
])

/** Internal, opt-in CI startup observer. It never executes a browser command. */
export default class SeleniumStartupDiagnostics {
  /** @type {SeleniumStartupDiagnostics | undefined} */
  static current

  /**
   * @param {{directory: string, appRoot: string, httpPort: number, chromedriverPath?: string}} args Startup ownership.
   */
  constructor({directory, appRoot, httpPort, chromedriverPath}) {
    this.directory = directory
    this.appRoot = appRoot
    this.httpPort = httpPort
    this.chromedriverPath = chromedriverPath
    this.logger = logging.getLogger("driver.http.Executor")
    this.sequence = 0
    this.dropped = 0
    this.processCandidates = 0
    this.active = false
    /** @type {StartupEvent[]} */
    this.events = []
    /** @type {StartupEvent[]} */
    this.pending = []
    /** @type {WeakMap<import("node:http").IncomingMessage, StartupEvent>} */
    this.appRequests = new WeakMap()
    /** @type {Array<() => void>} */
    this.disposers = []
    /** @type {Record<string, string>} */
    this.runtime = {}
    /** @type {ReturnType<SeleniumStartupDiagnostics["provenance"]> | undefined} */
    this.provenanceInfo = undefined
  }

  /** @returns {void} */
  start() {
    if (this.active) return
    if (SeleniumStartupDiagnostics.current) throw new Error("Selenium startup diagnostics already owned")
    SeleniumStartupDiagnostics.current = this
    this.active = true
    const previousLevel = this.logger.getLevel()
    this.logger.setLevel(logging.Level.FINER)
    this.logger.addHandler(this.onWebDriverLog)
    this.disposers.push(() => {
      this.logger.removeHandler(this.onWebDriverLog)
      this.logger.setLevel(previousLevel)
    })
    for (const [name, listener] of /** @type {Array<[string, (message: unknown) => void]>} */ ([
      ["child_process", this.onChildProcess],
      ["http.server.request.start", this.onAppRequest],
      ["http.server.response.finish", this.onAppResponse]
    ])) {
      diagnosticsChannel.subscribe(name, listener)
      this.disposers.push(() => diagnosticsChannel.unsubscribe(name, listener))
    }
  }

  /**
   * @param {import("selenium-webdriver/chrome.js").ServiceBuilder} service Owner-created service builder.
   * @param {string} executable Resolved owner executable.
   * @returns {void}
   */
  configureService(service, executable) {
    this.chromedriverPath = executable
    // INFO supplies COMMAND/RESPONSE receipts, without verbose DevTools payloads.
    // Pipes are consumed directly; raw driver output is never written to disk.
    service.addArguments("--log-level=INFO").setStdio("pipe")
  }

  /**
   * @param {Omit<StartupEvent, "sequence" | "observedAt">} fields Safe metadata.
   * @returns {StartupEvent}
   */
  record(fields) {
    const event = {sequence: ++this.sequence, observedAt: Date.now(), ...fields}
    this.events.push(event)
    if (this.events.length > 128) {
      this.events.shift()
      this.dropped++
    }
    return event
  }

  /**
   * @param {StartupEvent} event Request observation.
   * @returns {void}
   */
  track(event) {
    if (this.pending.length < 32) this.pending.push(event)
    else this.dropped++
  }

  /**
   * @param {StartupEvent} event Settled request.
   * @returns {void}
   */
  settle(event) {
    const index = this.pending.indexOf(event)
    if (index !== -1) this.pending.splice(index, 1)
  }

  /** @param {import("selenium-webdriver/lib/logging.js").Entry} entry Public Selenium log entry. */
  onWebDriverLog = (entry) => {
    const message = entry.message.slice("[driver.http.Executor] ".length)
    const header = /^>>> (GET|POST|DELETE) (\S+)$/.exec(message)
      ?? /^>>>\n(GET|POST|DELETE) (\S+) HTTP\/1\.1\n/.exec(message)
    if (!header) return
    const endpoint = header[2].replace(/^\/session\/[^/]+/, "/session/:session")
    const command = httpCommands.get(`${header[1]} ${endpoint}`)
    if (!command) return
    if (message.startsWith(">>> ")) {
      this.track(this.record({kind: "webdriver-request", command}))
      return
    }
    const responseIndex = message.indexOf("\n<<<\n")
    const response = message.slice(responseIndex + 5)
    const status = /^HTTP\/1\.1 (\d{3})\n/.exec(response)
    if (!status) return
    const request = this.pending.find((event) => event.kind === "webdriver-request" && event.command === command)
    this.record({kind: "webdriver-response", command, status: Number(status[1]), requestSequence: request?.sequence})
    if (request) this.settle(request)
    if (command === "newSession" && response.length < 65536) {
      try {
        const capabilities = JSON.parse(response.slice(response.indexOf("\n\n") + 2)).value.capabilities
        for (const [name, value] of Object.entries({browser: capabilities.browserVersion, chromedriver: capabilities.chrome?.chromedriverVersion?.split(" ")[0]})) {
          if (typeof value === "string" && /^\d{1,4}(?:\.\d{1,10}){1,4}$/.test(value)) this.runtime[name] = value
        }
        if (["none", "eager", "normal"].includes(capabilities.pageLoadStrategy)) this.runtime.pageLoadStrategy = capabilities.pageLoadStrategy
      } catch {
        // Unsupported/malformed diagnostic envelopes never alter WebDriver's parsing.
        this.record({kind: "runtime-metadata-unavailable"})
      }
    }
  }

  /** @param {{process: import("node:child_process").ChildProcess}} message Public Node process notification. */
  onChildProcess = ({process: child}) => {
    if (this.processCandidates >= 8) {
      this.dropped++
      return
    }
    this.processCandidates++
    // Node publishes creation before spawnfile/stdio are populated. Observe the
    // public spawn event before selecting the exact owner-created executable.
    const onSpawn = () => this.observeDriver(child)
    child.once("spawn", onSpawn)
    this.disposers.push(() => child.removeListener("spawn", onSpawn))
  }

  /**
   * @param {import("node:child_process").ChildProcess} child Started process.
   * @returns {void}
   */
  observeDriver(child) {
    if (child.spawnfile !== this.chromedriverPath) return
    // Runtime resolution also executes this binary with --version. Its exit
    // must never be attributed to the managed service or a crashed browser.
    if (!child.spawnargs.some((argument) => /^--port=\d+$/.test(argument))) return
    const processSequence = this.record({kind: "driver-spawn"}).sequence
    /** @type {(code: number | null, signal: string | null) => void} */
    const onExit = (code, signal) => { this.record({kind: "driver-exit", processSequence, code, signal}) }
    child.once("exit", onExit)
    this.disposers.push(() => child.removeListener("exit", onExit))
    for (const stream of [child.stdout, child.stderr]) {
      if (!stream) continue
      // Do not add event-loop ownership to Selenium's already-unrefed child.
      if (stream instanceof Socket) stream.unref()
      let prefix = ""
      /** @param {Buffer} chunk Driver output chunk. */
      const onData = (chunk) => {
        for (const [index, part] of chunk.toString("utf8").split("\n").entries()) {
          if (index > 0) {
            this.onDriverLine(prefix, processSequence)
            prefix = ""
          }
          prefix += part.slice(0, Math.max(0, 512 - prefix.length))
        }
      }
      stream.on("data", onData)
      this.disposers.push(() => {
        stream.removeListener("data", onData)
        // Keep draining the owned pipe without retaining or parsing later output.
        stream.resume()
        prefix = ""
      })
    }
  }

  /**
   * @param {string} line Bounded prefix; command bodies and unknown lines are discarded.
   * @param {number} processSequence Local managed-process correlation.
   * @returns {void}
   */
  onDriverLine(line, processSequence) {
    const match = /^\[[\d.]+\]\[INFO\]: \[[^\]]+\] (COMMAND|RESPONSE) (\w+)\b/.exec(line)
    if (!match || !driverCommands.has(match[2])) return
    let failure
    if (match[1] === "RESPONSE") {
      const suffix = line.slice(match[0].length)
      if (suffix.startsWith(" ERROR tab crashed")) failure = "tab-crashed"
      else if (suffix.startsWith(" ERROR disconnected")) failure = "disconnected"
      else if (suffix.startsWith(" ERROR timeout")) failure = "timeout"
      else if (suffix.startsWith(" ERROR")) failure = "driver-error"
    }
    this.record({kind: match[1] === "COMMAND" ? "driver-command" : "driver-response", processSequence, command: match[2], failure})
  }

  /** @param {{request: import("node:http").IncomingMessage}} message Public HTTP request notification. */
  onAppRequest = ({request}) => {
    if (request.socket.localPort !== this.httpPort) return
    const pathname = (request.url ?? "").split("?")[0]
    let resource = "document-or-other"
    if (pathname.endsWith(".js")) resource = "javascript"
    else if (/\.(png|jpg|ico|svg|ttf|woff2?)$/.test(pathname)) resource = "image-or-font"
    const event = this.record({kind: "app-request", resource})
    this.appRequests.set(request, event)
    this.track(event)
  }

  /** @param {{request: import("node:http").IncomingMessage, response: import("node:http").ServerResponse}} message Public HTTP completion notification. */
  onAppResponse = ({request, response}) => {
    const event = this.appRequests.get(request)
    if (!event) return
    this.record({kind: "app-response", resource: event.resource, requestSequence: event.sequence, status: response.statusCode})
    this.settle(event)
    this.appRequests.delete(request)
  }

  /** @returns {{node: string, dependencies: Record<string, string>, dist: Array<{resource: string, bytes: number, sha256?: string}>, unavailable: boolean, truncated: boolean}} */
  provenance() {
    /** @type {Record<string, string>} */
    const dependencies = {}
    const dist = []
    let unavailable = false
    let truncated = false
    try {
      for (const name of ["selenium-webdriver", "awaitery", "system-testing"]) dependencies[name] = require(`${name}/package.json`).version
      const jsDirectory = path.join(this.appRoot, "dist/_expo/static/js/web")
      const candidates = ["index.html", "blank.html"]
      const javascriptFiles = fs.readdirSync(jsDirectory).filter((name) => name.endsWith(".js"))
      if (javascriptFiles.length > 8) truncated = true
      for (const name of javascriptFiles.slice(0, 8)) {
        candidates.push(`_expo/static/js/web/${name}`)
      }
      for (const filename of candidates) {
        const filepath = path.join(this.appRoot, "dist", filename)
        const bytes = fs.statSync(filepath).size
        let sha256
        if (bytes <= 8 * 1024 * 1024) sha256 = createHash("sha256").update(fs.readFileSync(filepath)).digest("hex")
        else truncated = true
        dist.push({resource: filename.endsWith(".js") ? "javascript" : filename, bytes, sha256})
      }
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) console.error("[Selenium startup provenance failed]", error)
      unavailable = true
    }
    return {node: process.version, dependencies, dist, unavailable, truncated}
  }

  /**
   * @param {"ready" | "startup-failed" | "cleanup-completed" | "cleanup-failed"} phase Owner lifecycle outcome.
   * @returns {void}
   */
  snapshot(phase) {
    this.provenanceInfo ??= this.provenance()
    const json = JSON.stringify({phase, observedAt: Date.now(), runtime: this.runtime, provenance: this.provenanceInfo, events: this.events, pending: this.pending, dropped: this.dropped})
    if (phase !== "ready") console.error("[Selenium startup diagnostics]", json)
    try {
      fs.mkdirSync(this.directory, {recursive: true})
      fs.writeFileSync(path.join(this.directory, "selenium.json"), `${json}\n`)
    } catch (error) {
      console.error("[Selenium startup diagnostics write failed]", error)
    }
  }

  /** @returns {void} */
  dispose() {
    if (!this.active) return
    this.active = false
    for (const dispose of this.disposers) dispose()
    this.disposers = []
    this.appRequests = new WeakMap()
    if (SeleniumStartupDiagnostics.current === this) SeleniumStartupDiagnostics.current = undefined
  }
}
