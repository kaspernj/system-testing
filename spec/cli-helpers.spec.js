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

  it("threads scrollTo through convenience and generic browser commands", () => {
    expect(resolveBrowserCommand({"find-by-test-id": "saveButton", "scroll-to": "true"})).toEqual({
      args: {
        scrollTo: "true",
        testID: "saveButton",
        timeout: undefined,
        useBaseSelector: undefined,
        visible: undefined
      },
      command: "findByTestID"
    })

    expect(resolveBrowserCommand({command: "find", selector: ".card", "scroll-to": "true"})).toEqual({
      args: {
        scrollTo: "true",
        selector: ".card"
      },
      command: "find"
    })
  })

  it("rejects invalid timeout flags", () => {
    expect(() => resolveBrowserCommand({find: ".card", timeout: "soon"})).toThrowError("Invalid timeout flag: soon")
  })

  it("threads executeScript flags through the generic command path", () => {
    expect(resolveBrowserCommand({
      arg: ["one", "two"],
      command: "executeScript",
      script: "return arguments[0] + arguments[1]"
    })).toEqual({
      args: {
        args: ["one", "two"],
        script: "return arguments[0] + arguments[1]"
      },
      command: "executeScript"
    })
  })

  it("threads addCookie flags through the generic command path without colliding with the daemon --name", () => {
    // `--name` is reserved at the CLI level for the browser daemon being
    // routed to, so cookie commands use the `cookie-` prefix instead.
    expect(resolveBrowserCommand({
      command: "addCookie",
      "cookie-domain": "127.0.0.1",
      "cookie-http-only": true,
      "cookie-name": "tensorbuzz_auth",
      "cookie-path": "/",
      "cookie-same-site": "Lax",
      "cookie-secure": false,
      "cookie-value": "encrypted-cookie-value"
    })).toEqual({
      args: {
        domain: "127.0.0.1",
        httpOnly: true,
        name: "tensorbuzz_auth",
        path: "/",
        sameSite: "Lax",
        secure: false,
        value: "encrypted-cookie-value"
      },
      command: "addCookie"
    })
  })
})
