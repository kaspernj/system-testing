/**
 * @param {string[]} argv
 * @returns {{_: string[], flags: Record<string, any>}}
 */
export function parseArgv(argv) {
  const result = {_: [], flags: {}}
  const setFlag = (key, value) => {
    if (!(key in result.flags)) {
      result.flags[key] = value
      return
    }

    if (!Array.isArray(result.flags[key])) {
      result.flags[key] = [result.flags[key]]
    }

    result.flags[key].push(value)
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
 * @param {any} timeoutFlag
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
 * @param {Record<string, any>} flags
 * @returns {{command: string, args: Record<string, any>}}
 */
export function resolveBrowserCommand(flags) {
  const timeout = resolveCliTimeout(flags.timeout)

  if (flags.visit) {
    const args = {url: flags.visit}

    if (timeout !== undefined) {
      args.timeout = timeout
    }

    return {args, command: "visit"}
  }

  if (flags["dismiss-to"]) {
    const args = {path: flags["dismiss-to"]}

    if (timeout !== undefined) {
      args.timeout = timeout
    }

    return {args, command: "dismissTo"}
  }

  if (flags["find-by-test-id"]) {
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
    const args = {
      selector: flags.click,
      timeout,
      useBaseSelector: flags["use-base-selector"],
      visible: flags.visible
    }

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
    const args = {}

    if (flags.url) args.url = flags.url
    if (flags.path) args.path = flags.path
    if (flags.selector) args.selector = flags.selector
    if (flags["test-id"]) args.testID = flags["test-id"]
    if (flags.method) args.methodName = flags.method
    if (flags.arg) args.args = Array.isArray(flags.arg) ? flags.arg : [flags.arg]
    if (flags["with-fallback"] !== undefined) args.withFallback = flags["with-fallback"]
    if (timeout !== undefined) args.timeout = timeout
    if (flags["scroll-to"] !== undefined) args.scrollTo = flags["scroll-to"]
    if (flags.visible !== undefined) args.visible = flags.visible
    if (flags["use-base-selector"] !== undefined) args.useBaseSelector = flags["use-base-selector"]

    return {args, command: flags.command}
  }

  throw new Error("No browser command was given")
}
