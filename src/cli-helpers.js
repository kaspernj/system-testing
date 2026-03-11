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
 * @param {Record<string, any>} flags
 * @returns {{command: string, args: Record<string, any>}}
 */
export function resolveBrowserCommand(flags) {
  if (flags.visit) {
    return {args: {url: flags.visit}, command: "visit"}
  }

  if (flags["dismiss-to"]) {
    return {args: {path: flags["dismiss-to"]}, command: "dismissTo"}
  }

  if (flags["find-by-test-id"]) {
    return {
      args: {
        testID: flags["find-by-test-id"],
        timeout: flags.timeout,
        useBaseSelector: flags["use-base-selector"],
        visible: flags.visible
      },
      command: "findByTestID"
    }
  }

  if (flags.find) {
    return {
      args: {
        selector: flags.find,
        timeout: flags.timeout,
        useBaseSelector: flags["use-base-selector"],
        visible: flags.visible
      },
      command: "find"
    }
  }

  if (flags.click) {
    return {
      args: {
        selector: flags.click,
        timeout: flags.timeout,
        useBaseSelector: flags["use-base-selector"],
        visible: flags.visible
      },
      command: "click"
    }
  }

  if (flags["wait-for-no-selector"]) {
    return {
      args: {
        selector: flags["wait-for-no-selector"],
        useBaseSelector: flags["use-base-selector"]
      },
      command: "waitForNoSelector"
    }
  }

  if (flags["expect-no-element"]) {
    return {
      args: {
        selector: flags["expect-no-element"],
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
    if (flags.timeout) args.timeout = flags.timeout
    if (flags.visible !== undefined) args.visible = flags.visible
    if (flags["use-base-selector"] !== undefined) args.useBaseSelector = flags["use-base-selector"]

    return {args, command: flags.command}
  }

  throw new Error("No browser command was given")
}
