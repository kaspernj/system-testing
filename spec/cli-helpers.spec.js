// @ts-check

import {parseArgv, resolveBrowserCommand, resolveBrowserDaemonToken, resolveBrowserDriverOptions} from "../src/cli-helpers.js"

describe("cli helpers", () => {
  describe("resolveBrowserDaemonToken", () => {
    /** @type {string | undefined} */
    let previousToken

    beforeEach(() => {
      previousToken = process.env.SYSTEM_TEST_BROWSER_TOKEN
      delete process.env.SYSTEM_TEST_BROWSER_TOKEN
    })

    afterEach(() => {
      if (previousToken === undefined) {
        delete process.env.SYSTEM_TEST_BROWSER_TOKEN
      } else {
        process.env.SYSTEM_TEST_BROWSER_TOKEN = previousToken
      }
    })

    it("prefers the flag over the environment variable", () => {
      process.env.SYSTEM_TEST_BROWSER_TOKEN = "env-token"

      expect(resolveBrowserDaemonToken({token: "flag-token"})).toEqual("flag-token")
    })

    it("falls back to the environment variable", () => {
      process.env.SYSTEM_TEST_BROWSER_TOKEN = "env-token"

      expect(resolveBrowserDaemonToken({})).toEqual("env-token")
    })

    it("returns undefined when neither the flag nor the environment variable is set", () => {
      expect(resolveBrowserDaemonToken({})).toBeUndefined()
    })

    it("throws when --token is passed without a value instead of using the literal \"true\"", () => {
      expect(() => resolveBrowserDaemonToken({token: true})).toThrowError("--token requires a value")
    })
  })

  describe("resolveBrowserDriverOptions", () => {
    it("returns undefined when no launch flags are set", () => {
      expect(resolveBrowserDriverOptions({})).toBeUndefined()
    })

    it("returns the Chrome binary path when --chrome-binary is set", () => {
      expect(resolveBrowserDriverOptions({"chrome-binary": "/opt/chrome"})).toEqual({
        chromeBinaryPath: "/opt/chrome",
        chromedriverPath: undefined,
        chromeArguments: undefined
      })
    })

    it("returns the chromedriver path when --chromedriver is set", () => {
      expect(resolveBrowserDriverOptions({"chromedriver": "/opt/chromedriver"})).toEqual({
        chromeBinaryPath: undefined,
        chromedriverPath: "/opt/chromedriver",
        chromeArguments: undefined
      })
    })

    it("wraps a single --chrome-arg into an array", () => {
      expect(resolveBrowserDriverOptions({"chrome-arg": "--start-maximized"})).toEqual({
        chromeBinaryPath: undefined,
        chromedriverPath: undefined,
        chromeArguments: ["--start-maximized"]
      })
    })

    it("preserves repeated --chrome-arg values in order", () => {
      expect(resolveBrowserDriverOptions({"chrome-arg": ["--ignore-certificate-errors", "--start-maximized"]})).toEqual({
        chromeBinaryPath: undefined,
        chromedriverPath: undefined,
        chromeArguments: ["--ignore-certificate-errors", "--start-maximized"]
      })
    })

    it("combines the binary, driver, and argument flags", () => {
      expect(
        resolveBrowserDriverOptions({"chrome-arg": ["--a"], "chrome-binary": "/opt/chrome", chromedriver: "/opt/chromedriver"})
      ).toEqual({
        chromeBinaryPath: "/opt/chrome",
        chromedriverPath: "/opt/chromedriver",
        chromeArguments: ["--a"]
      })
    })

    it("throws when --chrome-binary is passed without a value", () => {
      expect(() => resolveBrowserDriverOptions({"chrome-binary": true})).toThrowError("--chrome-binary requires a value")
    })

    it("throws when --chromedriver is passed without a value", () => {
      expect(() => resolveBrowserDriverOptions({chromedriver: true})).toThrowError("--chromedriver requires a value")
    })

    it("throws when --chrome-arg is passed without a value", () => {
      expect(() => resolveBrowserDriverOptions({"chrome-arg": true})).toThrowError(
        "--chrome-arg requires a value; use --chrome-arg=<arg> for arguments that start with --"
      )
    })
  })

  it("parses repeated flags into arrays", () => {
    const parsed = parseArgv(["browser-command", "--command=interact", "--arg", "one", "--arg", "two"])

    expect(parsed._).toEqual(["browser-command"])
    expect(parsed.flags.arg).toEqual(["one", "two"])
  })

  it("keeps chrome argument values that start with -- when passed with =", () => {
    const parsed = parseArgv(["browser", "dozer", "--chrome-arg=--ignore-certificate-errors"])

    expect(parsed._).toEqual(["browser", "dozer"])
    expect(parsed.flags["chrome-arg"]).toBe("--ignore-certificate-errors")
  })

  it("accumulates repeated --chrome-arg= values in order", () => {
    const parsed = parseArgv([
      "browser",
      "dozer",
      "--chrome-arg=--ignore-certificate-errors",
      "--chrome-arg=--start-maximized"
    ])

    expect(parsed.flags["chrome-arg"]).toEqual(["--ignore-certificate-errors", "--start-maximized"])
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
      timeout: "1500ms"
    })).toEqual({
      args: {
        args: ["hello", "world"],
        methodName: "sendKeys",
        selector: "[data-testid='field']",
        timeout: 1500
      },
      command: "interact"
    })
  })

  it("resolves the js value-setter escape hatch as a plain interact method", () => {
    expect(resolveBrowserCommand({
      arg: ["new value"],
      command: "interact",
      method: "replaceValueWithJs",
      selector: "[data-testid='field']"
    })).toEqual({
      args: {
        args: ["new value"],
        methodName: "replaceValueWithJs",
        selector: "[data-testid='field']"
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

  it("threads human click flags through convenience click commands", () => {
    expect(resolveBrowserCommand({
      click: "iframe[title='Security challenge widget']",
      "click-offset-x": "32",
      "click-offset-y": "28",
      "human-step-delay": "75",
      "human-steps": "5",
      method: "human",
      timeout: "20"
    })).toEqual({
      args: {
        clickOffsetX: 32,
        clickOffsetY: 28,
        humanStepDelay: 75,
        humanSteps: 5,
        method: "human",
        selector: "iframe[title='Security challenge widget']",
        timeout: 20000,
        useBaseSelector: undefined,
        visible: undefined
      },
      command: "click"
    })
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
