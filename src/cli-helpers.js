import {browserDaemonTokenEnvVar} from "./browser-daemon-constants.js"

/**
 * A single parsed CLI flag value. A flag passed without a value is the boolean `true`;
 * a repeatable flag accumulates into an array.
 * @typedef {(string | boolean | (string | boolean)[])} ParsedFlagValue
 */
/** @typedef {Record<string, ParsedFlagValue>} ParsedFlags */
/**
 * The argument bag a browser command forwards to the daemon. Values are scalars or arrays
 * of scalars as produced by the CLI parser and the timeout/number resolvers.
 * @typedef {Record<string, string | number | boolean | null | undefined | (string | number | boolean)[]>} BrowserCommandArgs
 */

/**
 * Resolves the optional browser daemon token from the CLI flag, falling back to the
 * environment variable. Returns undefined when neither is set. Throws when `--token` is
 * passed without a value so token auth never silently enables with the literal `"true"`.
 * @param {ParsedFlags} flags
 * @returns {string | undefined}
 */
export function resolveBrowserDaemonToken(flags) {
  if (flags.token === true) {
    throw new Error("--token requires a value")
  }

  const token = flags.token ?? process.env[browserDaemonTokenEnvVar]

  return token ? String(token) : undefined
}

/**
 * Resolves Chrome launch options from the `browser` CLI flags, forwarding them to the
 * Selenium driver. Returns an options object, or undefined when no launch flags are set.
 * `--chrome-arg` is repeatable. Because the parser treats any `--...` token as a flag,
 * Chrome arguments that themselves start with `--` must use the `=` form, e.g.
 * `--chrome-arg=--ignore-certificate-errors`.
 * @param {ParsedFlags} flags
 * @returns {{chromeBinaryPath?: string, chromedriverPath?: string, chromeArguments?: string[]} | undefined}
 */
export function resolveBrowserDriverOptions(flags) {
  const chromeBinaryPath = flags["chrome-binary"]
  const chromedriverPath = flags["chromedriver"]
  const chromeArg = flags["chrome-arg"]

  if (chromeBinaryPath === true) throw new Error("--chrome-binary requires a value")
  if (chromedriverPath === true) throw new Error("--chromedriver requires a value")
  if (chromeArg === true) {
    throw new Error("--chrome-arg requires a value; use --chrome-arg=<arg> for arguments that start with --")
  }

  const chromeArguments =
    chromeArg === undefined ? undefined : Array.isArray(chromeArg) ? chromeArg.map((arg) => String(arg)) : [String(chromeArg)]

  if (chromeBinaryPath === undefined && chromedriverPath === undefined && chromeArguments === undefined) {
    return undefined
  }

  return {
    chromeBinaryPath: chromeBinaryPath !== undefined ? String(chromeBinaryPath) : undefined,
    chromedriverPath: chromedriverPath !== undefined ? String(chromedriverPath) : undefined,
    chromeArguments
  }
}

/**
 * Returns a flag's value when it is a scalar string, or undefined for bare flags (`true`)
 * and repeatable flags (arrays). Used to feed scalar string CLI flags into daemon options.
 * @param {ParsedFlags} flags
 * @param {string} key
 * @returns {string | undefined}
 */
export function resolveFlagString(flags, key) {
  const value = flags[key]

  return typeof value === "string" ? value : undefined
}

/**
 * @param {string[]} argv
 * @returns {{_: string[], flags: ParsedFlags}}
 */
export function parseArgv(argv) {
  /** @type {{_: string[], flags: ParsedFlags}} */
  const result = {_: [], flags: {}}
  const setFlag = (/** @type {string} */ key, /** @type {string | boolean} */ value) => {
    if (!(key in result.flags)) {
      result.flags[key] = value
      return
    }

    const existing = result.flags[key]
    result.flags[key] = Array.isArray(existing) ? [...existing, value] : [existing, value]
  }

  for (let index = 0; index < argv.length; index++) {
    const value = argv[index]

    if (!value.startsWith("--")) {
      result._.push(value)
      continue
    }

    const flag = value.slice(2)

    if (flag.includes("=")) {
      const [key, ...rest] = flag.split("=")

      setFlag(key, rest.join("="))
      continue
    }

    const nextValue = argv[index + 1]

    if (nextValue && !nextValue.startsWith("--")) {
      setFlag(flag, nextValue)
      index += 1
    } else {
      setFlag(flag, true)
    }
  }

  return result
}

/**
 * Parses a CLI timeout flag into milliseconds.
 * Bare numeric values are treated as seconds for CLI ergonomics.
 * @param {ParsedFlagValue | number} timeoutFlag
 * @returns {number | undefined}
 */
function resolveCliTimeout(timeoutFlag) {
  if (timeoutFlag === undefined) {
    return undefined
  }

  if (typeof timeoutFlag === "number") {
    return timeoutFlag * 1000
  }

  const timeoutString = String(timeoutFlag).trim()

  if (/^\d+(\.\d+)?ms$/i.test(timeoutString)) {
    return Number(timeoutString.slice(0, -2))
  }

  if (/^\d+(\.\d+)?s$/i.test(timeoutString)) {
    return Number(timeoutString.slice(0, -1)) * 1000
  }

  if (/^\d+(\.\d+)?$/.test(timeoutString)) {
    return Number(timeoutString) * 1000
  }

  throw new Error(`Invalid timeout flag: ${timeoutFlag}`)
}

/**
 * @param {ParsedFlagValue | number} numberFlag
 * @param {string} flagName
 * @returns {number | undefined}
 */
function resolveCliNumber(numberFlag, flagName) {
  if (numberFlag === undefined) return undefined
  const numberValue = Number(numberFlag)

  if (Number.isNaN(numberValue)) {
    throw new Error(`Invalid ${flagName} flag: ${numberFlag}`)
  }

  return numberValue
}

/**
 * @param {ParsedFlags} flags
 * @param {BrowserCommandArgs} args
 * @returns {void}
 */
function applyPointerFlags(flags, args) {
  const clickOffsetX = resolveCliNumber(flags["click-offset-x"], "click-offset-x")
  const clickOffsetY = resolveCliNumber(flags["click-offset-y"], "click-offset-y")
  const humanStepDelay = resolveCliNumber(flags["human-step-delay"], "human-step-delay")
  const humanSteps = resolveCliNumber(flags["human-steps"], "human-steps")

  if (flags.method !== undefined) args.method = flags.method
  if (clickOffsetX !== undefined) args.clickOffsetX = clickOffsetX
  if (clickOffsetY !== undefined) args.clickOffsetY = clickOffsetY
  if (humanStepDelay !== undefined) args.humanStepDelay = humanStepDelay
  if (humanSteps !== undefined) args.humanSteps = humanSteps
}

/**
 * @param {ParsedFlags} flags
 * @returns {{command: string, args: BrowserCommandArgs}}
 */
export function resolveBrowserCommand(flags) {
  const timeout = resolveCliTimeout(flags.timeout)

  if (flags.visit) {
    /** @type {BrowserCommandArgs} */
    const args = {url: flags.visit}

    if (timeout !== undefined) {
      args.timeout = timeout
    }

    return {args, command: "visit"}
  }

  if (flags["dismiss-to"]) {
    /** @type {BrowserCommandArgs} */
    const args = {path: flags["dismiss-to"]}

    if (timeout !== undefined) {
      args.timeout = timeout
    }

    return {args, command: "dismissTo"}
  }

  if (flags["find-by-test-id"]) {
    /** @type {BrowserCommandArgs} */
    const args = {
      testID: flags["find-by-test-id"],
      timeout,
      useBaseSelector: flags["use-base-selector"],
      visible: flags.visible
    }

    if (flags["scroll-to"] !== undefined) {
      args.scrollTo = flags["scroll-to"]
    }

    return {
      args,
      command: "findByTestID"
    }
  }

  if (flags.find) {
    /** @type {BrowserCommandArgs} */
    const args = {
      selector: flags.find,
      timeout,
      useBaseSelector: flags["use-base-selector"],
      visible: flags.visible
    }

    if (flags["scroll-to"] !== undefined) {
      args.scrollTo = flags["scroll-to"]
    }

    return {
      args,
      command: "find"
    }
  }

  if (flags.click) {
    /** @type {BrowserCommandArgs} */
    const args = {
      selector: flags.click,
      timeout,
      useBaseSelector: flags["use-base-selector"],
      visible: flags.visible
    }
    applyPointerFlags(flags, args)

    if (flags["scroll-to"] !== undefined) {
      args.scrollTo = flags["scroll-to"]
    }

    return {
      args,
      command: "click"
    }
  }

  if (flags["wait-for-no-selector"]) {
    return {
      args: {
        selector: flags["wait-for-no-selector"],
        timeout,
        useBaseSelector: flags["use-base-selector"]
      },
      command: "waitForNoSelector"
    }
  }

  if (flags["expect-no-element"]) {
    return {
      args: {
        selector: flags["expect-no-element"],
        timeout,
        useBaseSelector: flags["use-base-selector"]
      },
      command: "expectNoElement"
    }
  }

  if (flags["set-base-selector"]) {
    return {args: {selector: flags["set-base-selector"]}, command: "setBaseSelector"}
  }

  if (flags["get-html"]) {
    return {args: {}, command: "getHTML"}
  }

  if (flags["get-browser-logs"]) {
    return {args: {}, command: "getBrowserLogs"}
  }

  if (flags["get-current-url"]) {
    return {args: {}, command: "getCurrentUrl"}
  }

  if (flags["take-screenshot"]) {
    return {args: {}, command: "takeScreenshot"}
  }

  if (flags.command) {
    /** @type {BrowserCommandArgs} */
    const args = {}

    if (flags.url) args.url = flags.url
    if (flags.path) args.path = flags.path
    if (flags.selector) args.selector = flags.selector
    if (flags["test-id"]) args.testID = flags["test-id"]
    if (flags.method) args.methodName = flags.method
    if (flags.arg) args.args = Array.isArray(flags.arg) ? flags.arg : [flags.arg]
    if (flags.command !== "interact") applyPointerFlags(flags, args)
    if (timeout !== undefined) args.timeout = timeout
    if (flags["scroll-to"] !== undefined) args.scrollTo = flags["scroll-to"]
    if (flags.visible !== undefined) args.visible = flags.visible
    if (flags["use-base-selector"] !== undefined) args.useBaseSelector = flags["use-base-selector"]
    if (flags.script) args.script = flags.script
    // Cookie flags use a `cookie-` prefix so the cookie name does not
    // collide with the daemon-level `--name <my-browser>` flag the CLI
    // already consumes for routing.
    if (flags["cookie-name"]) args.name = flags["cookie-name"]
    if (flags["cookie-value"] !== undefined) args.value = flags["cookie-value"]
    if (flags["cookie-domain"]) args.domain = flags["cookie-domain"]
    if (flags["cookie-path"]) args.path = flags["cookie-path"]
    if (flags["cookie-secure"] !== undefined) args.secure = flags["cookie-secure"]
    if (flags["cookie-http-only"] !== undefined) args.httpOnly = flags["cookie-http-only"]
    if (flags["cookie-expiry"] !== undefined) args.expiry = flags["cookie-expiry"]
    if (flags["cookie-same-site"]) args.sameSite = flags["cookie-same-site"]

    return {args, command: String(flags.command)}
  }

  throw new Error("No browser command was given")
}
