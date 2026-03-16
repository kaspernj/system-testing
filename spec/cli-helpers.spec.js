// @ts-check

import {parseArgv, resolveBrowserCommand} from "../src/cli-helpers.js"

describe("cli helpers", () => {
  it("parses repeated flags into arrays", () => {
    const parsed = parseArgv(["browser-command", "--command=interact", "--arg", "one", "--arg", "two"])

    expect(parsed._).toEqual(["browser-command"])
    expect(parsed.flags.arg).toEqual(["one", "two"])
  })

  it("resolves convenience visit commands", () => {
    expect(resolveBrowserCommand({visit: "https://example.com"})).toEqual({
      args: {url: "https://example.com"},
      command: "visit"
    })
  })

  it("resolves CLI timeout flags in seconds for convenience commands", () => {
    expect(resolveBrowserCommand({timeout: "15", visit: "https://example.com"})).toEqual({
      args: {
        timeout: 15000,
        url: "https://example.com"
      },
      command: "visit"
    })

    expect(resolveBrowserCommand({"find-by-test-id": "project-environment-instance-ports-screen", timeout: "15"})).toEqual({
      args: {
        testID: "project-environment-instance-ports-screen",
        timeout: 15000,
        useBaseSelector: undefined,
        visible: undefined
      },
      command: "findByTestID"
    })
  })

  it("resolves generic command arguments", () => {
    expect(resolveBrowserCommand({
      arg: ["hello", "world"],
      command: "interact",
      method: "sendKeys",
      selector: "[data-testid='field']",
      timeout: "1500ms",
      "with-fallback": "true"
    })).toEqual({
      args: {
        args: ["hello", "world"],
        methodName: "sendKeys",
        selector: "[data-testid='field']",
        timeout: 1500,
        withFallback: "true"
      },
      command: "interact"
    })
  })

  it("rejects invalid timeout flags", () => {
    expect(() => resolveBrowserCommand({find: ".card", timeout: "soon"})).toThrowError("Invalid timeout flag: soon")
  })
})
