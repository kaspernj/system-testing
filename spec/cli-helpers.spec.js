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

  it("resolves generic command arguments", () => {
    expect(resolveBrowserCommand({
      arg: ["hello", "world"],
      command: "interact",
      method: "sendKeys",
      selector: "[data-testid='field']"
    })).toEqual({
      args: {
        args: ["hello", "world"],
        methodName: "sendKeys",
        selector: "[data-testid='field']"
      },
      command: "interact"
    })
  })
})
