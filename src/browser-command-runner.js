/** Runs browser commands across CLI and WebSocket transports. */
export default class BrowserCommandRunner {
  /**
   * @param {object} args
   * @param {import("./browser.js").default} args.browser
   */
  constructor({browser}) {
    this.browser = browser
  }

  /**
   * @param {Record<string, any>} commandArgs
   * @returns {{timeout?: number}}
   */
  normalizeTimeoutArgs(commandArgs) {
    const normalizedArgs = {}

    if ("timeout" in commandArgs && commandArgs.timeout !== undefined) {
      normalizedArgs.timeout = Number(commandArgs.timeout)

      if (Number.isNaN(normalizedArgs.timeout)) {
        throw new Error(`Invalid timeout: ${commandArgs.timeout}`)
      }
    }

    return normalizedArgs
  }

  /**
   * @param {Record<string, any>} commandArgs
   * @returns {import("./system-test.js").FindArgs}
   */
  normalizeFindArgs(commandArgs) {
    const findArgs = /** @type {import("./system-test.js").FindArgs} */ (this.normalizeTimeoutArgs(commandArgs))

    if ("visible" in commandArgs && commandArgs.visible !== undefined) {
      if (commandArgs.visible === null || commandArgs.visible === "null") {
        findArgs.visible = null
      } else if (typeof commandArgs.visible === "boolean") {
        findArgs.visible = commandArgs.visible
      } else {
        findArgs.visible = commandArgs.visible === "true"
      }
    }

    if ("useBaseSelector" in commandArgs && commandArgs.useBaseSelector !== undefined) {
      if (typeof commandArgs.useBaseSelector === "boolean") {
        findArgs.useBaseSelector = commandArgs.useBaseSelector
      } else {
        findArgs.useBaseSelector = commandArgs.useBaseSelector === "true"
      }
    }

    if ("scrollTo" in commandArgs && commandArgs.scrollTo !== undefined) {
      if (typeof commandArgs.scrollTo === "boolean") {
        findArgs.scrollTo = commandArgs.scrollTo
      } else {
        findArgs.scrollTo = commandArgs.scrollTo === "true"
      }
    }

    return findArgs
  }

  /**
   * @param {import("selenium-webdriver").WebElement} element
   * @returns {Promise<Record<string, any>>}
   */
  async serializeElement(element) {
    const text = await element.getText()
    const tagName = await element.getTagName()
    const displayed = await element.isDisplayed()

    return {displayed, tagName, text}
  }

  /**
   * @param {string} command
   * @param {Record<string, any>} commandArgs
   * @returns {Promise<any>}
   */
  async run(command, commandArgs = {}) {
    if (command === "visit") {
      const path = commandArgs.path ?? commandArgs.url

      if (!path) {
        throw new Error("visit requires path or url")
      }

      await this.browser.visit(path, this.normalizeTimeoutArgs(commandArgs))
      return {ok: true}
    }

    if (command === "dismissTo") {
      const path = commandArgs.path ?? commandArgs.url

      if (!path) {
        throw new Error("dismissTo requires path or url")
      }

      await this.browser.dismissTo(path, this.normalizeTimeoutArgs(commandArgs))
      return {ok: true}
    }

    if (command === "setBaseSelector") {
      if (!commandArgs.selector) {
        throw new Error("setBaseSelector requires selector")
      }

      this.browser.setBaseSelector(commandArgs.selector)
      return {ok: true}
    }

    if (command === "getCurrentUrl") {
      return {currentUrl: await this.browser.getCurrentUrl()}
    }

    if (command === "getHTML") {
      return {html: await this.browser.getHTML()}
    }

    if (command === "getBrowserLogs") {
      return {logs: await this.browser.getBrowserLogs()}
    }

    if (command === "takeScreenshot") {
      return await this.browser.takeScreenshot()
    }

    if (command === "find") {
      if (!commandArgs.selector) {
        throw new Error("find requires selector")
      }

      const element = await this.browser.find(commandArgs.selector, this.normalizeFindArgs(commandArgs))

      return {element: await this.serializeElement(element)}
    }

    if (command === "findByTestID") {
      const testID = commandArgs.testID ?? commandArgs.testId

      if (!testID) {
        throw new Error("findByTestID requires testID")
      }

      const element = await this.browser.findByTestID(testID, this.normalizeFindArgs(commandArgs))

      return {element: await this.serializeElement(element)}
    }

    if (command === "click") {
      const selector = commandArgs.selector

      if (!selector) {
        throw new Error("click requires selector")
      }

      await this.browser.click(selector, this.normalizeFindArgs(commandArgs))
      return {ok: true}
    }

    if (command === "waitForNoSelector") {
      if (!commandArgs.selector) {
        throw new Error("waitForNoSelector requires selector")
      }

      await this.browser.waitForNoSelector(commandArgs.selector, this.normalizeFindArgs(commandArgs))
      return {ok: true}
    }

    if (command === "expectNoElement") {
      if (!commandArgs.selector) {
        throw new Error("expectNoElement requires selector")
      }

      await this.browser.expectNoElement(commandArgs.selector, this.normalizeFindArgs(commandArgs))
      return {ok: true}
    }

    if (command === "executeScript") {
      const script = commandArgs.script

      if (typeof script !== "string" || script.length === 0) {
        throw new Error("executeScript requires script")
      }

      const scriptArgs = Array.isArray(commandArgs.args) ? commandArgs.args : []
      const result = await this.browser.executeScript(script, ...scriptArgs)

      return {result}
    }

    if (command === "addCookie") {
      const name = commandArgs.name

      if (typeof name !== "string" || name.length === 0) {
        throw new Error("addCookie requires name")
      }

      const value = commandArgs.value

      if (typeof value !== "string") {
        throw new Error("addCookie requires string value")
      }

      /** @type {{name: string, value: string, domain?: string, path?: string, secure?: boolean, httpOnly?: boolean, expiry?: number, sameSite?: "Strict" | "Lax" | "None"}} */
      const cookie = {name, value}

      if (typeof commandArgs.domain === "string" && commandArgs.domain.length > 0) cookie.domain = commandArgs.domain
      if (typeof commandArgs.path === "string" && commandArgs.path.length > 0) cookie.path = commandArgs.path
      if (commandArgs.secure !== undefined) cookie.secure = commandArgs.secure === true || commandArgs.secure === "true"
      if (commandArgs.httpOnly !== undefined) cookie.httpOnly = commandArgs.httpOnly === true || commandArgs.httpOnly === "true"
      if (commandArgs.expiry !== undefined) cookie.expiry = Number(commandArgs.expiry)
      if (typeof commandArgs.sameSite === "string") cookie.sameSite = /** @type {"Strict" | "Lax" | "None"} */ (commandArgs.sameSite)

      await this.browser.addCookie(cookie)

      return {ok: true}
    }

    if (command === "interact") {
      const selector = commandArgs.selector
      const methodName = commandArgs.methodName ?? commandArgs.method
      const methodArgs = Array.isArray(commandArgs.args) ? commandArgs.args : []
      const interactArgs = /** @type {{selector: string} & import("./system-test.js").InteractArgs} */ ({selector, ...this.normalizeFindArgs(commandArgs)})

      if (!selector) {
        throw new Error("interact requires selector")
      }

      if (!methodName) {
        throw new Error("interact requires methodName")
      }

      if ("withFallback" in commandArgs && commandArgs.withFallback !== undefined) {
        if (typeof commandArgs.withFallback === "boolean") {
          interactArgs.withFallback = commandArgs.withFallback
        } else {
          interactArgs.withFallback = commandArgs.withFallback === "true"
        }
      }

      const result = await this.browser.interact(interactArgs, methodName, ...methodArgs)

      return {result}
    }

    throw new Error(`Unknown browser command: ${command}`)
  }
}
