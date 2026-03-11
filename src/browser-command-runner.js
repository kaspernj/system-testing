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
   * @returns {Record<string, any>}
   */
  normalizeFindArgs(commandArgs) {
    const findArgs = {}

    if ("timeout" in commandArgs && commandArgs.timeout !== undefined) {
      findArgs.timeout = Number(commandArgs.timeout)
    }

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

      await this.browser.visit(path)
      return {ok: true}
    }

    if (command === "dismissTo") {
      const path = commandArgs.path ?? commandArgs.url

      if (!path) {
        throw new Error("dismissTo requires path or url")
      }

      await this.browser.dismissTo(path)
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

    if (command === "interact") {
      const selector = commandArgs.selector
      const methodName = commandArgs.methodName ?? commandArgs.method
      const methodArgs = Array.isArray(commandArgs.args) ? commandArgs.args : []

      if (!selector) {
        throw new Error("interact requires selector")
      }

      if (!methodName) {
        throw new Error("interact requires methodName")
      }

      const result = await this.browser.interact({selector, ...this.normalizeFindArgs(commandArgs)}, methodName, ...methodArgs)

      return {result}
    }

    throw new Error(`Unknown browser command: ${command}`)
  }
}
