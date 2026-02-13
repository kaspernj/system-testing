// @ts-check

import SystemTest from "../src/system-test.js"

describe("SystemTest browser log output", () => {
  /** @returns {{formatBrowserLogsForConsole: typeof SystemTest.prototype.formatBrowserLogsForConsole, printBrowserLogsForFailure: typeof SystemTest.prototype.printBrowserLogsForFailure}} */
  function buildLoggingHelpers() {
    return {
      formatBrowserLogsForConsole: SystemTest.prototype.formatBrowserLogsForConsole,
      printBrowserLogsForFailure: SystemTest.prototype.printBrowserLogsForFailure
    }
  }

  it("prints a placeholder when no browser logs were collected", () => {
    const systemTest = buildLoggingHelpers()

    expect(systemTest.formatBrowserLogsForConsole([])).toEqual(["(no browser logs)"])
  })

  it("truncates browser logs to the configured max lines", () => {
    const systemTest = buildLoggingHelpers()
    const logs = ["line-1", "line-2", "line-3", "line-4"]

    expect(systemTest.formatBrowserLogsForConsole(logs, 2)).toEqual([
      "(showing last 2 of 4 browser logs, 2 omitted)",
      "line-3",
      "line-4"
    ])
  })

  it("prints a browser log heading and each collected log line", () => {
    const systemTest = buildLoggingHelpers()
    const logSpy = spyOn(console, "log")

    systemTest.printBrowserLogsForFailure(["warn-1", "error-2"])

    expect(logSpy.calls.allArgs()).toEqual([
      ["Browser logs:"],
      ["warn-1"],
      ["error-2"]
    ])
  })
})
