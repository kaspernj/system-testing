import {ShapeHook, useShapeHook} from "set-state-compare"
import {useEffect} from "react"
import SystemTestBrowserHelper from "./system-test-browser-helper.js"

const shared = {
  /** @type {SystemTestBrowserHelper | null} */
  defaultSystemTestBrowserHelper: null
}

/** Shared shape-hook state container for `useSystemTest*` hooks. */
export default class UseSystemTestShapeHook extends ShapeHook {
  static defaultProps = {
    browserHelper: undefined,
    enabled: false,
    onDismissTo: undefined,
    onFirstInitialize: undefined,
    onInitialize: undefined,
    onTeardown: undefined,
    onNavigate: undefined
  }

  /** @returns {SystemTestBrowserHelper | null} */
  systemTestBrowserHelper() {
    if (!this.p.enabled) {
      return null
    }

    if (this.p.browserHelper) {
      this.p.browserHelper.enableOnBrowser()
      return this.p.browserHelper
    }

    if (!shared.defaultSystemTestBrowserHelper) {
      shared.defaultSystemTestBrowserHelper = new SystemTestBrowserHelper()
    }

    shared.defaultSystemTestBrowserHelper.enableOnBrowser()

    return shared.defaultSystemTestBrowserHelper
  }

  /** @returns {{enabled: boolean, systemTestBrowserHelper: SystemTestBrowserHelper | null}} */
  result() {
    const systemTestBrowserHelper = this.systemTestBrowserHelper()

    return this.cache(
      "result",
      () => ({enabled: this.p.enabled, systemTestBrowserHelper}),
      [this.p.enabled, systemTestBrowserHelper]
    )
  }

  /** @returns {void} */
  setup() {
    const systemTestBrowserHelper = this.systemTestBrowserHelper()

    useEffect(() => {
      if (!systemTestBrowserHelper) {
        return
      }

      systemTestBrowserHelper.onFirstInitialize(this.p.onFirstInitialize)
      systemTestBrowserHelper.onInitialize(this.p.onInitialize)
      systemTestBrowserHelper.onTeardown(this.p.onTeardown)
    }, [systemTestBrowserHelper, this.p.onFirstInitialize, this.p.onInitialize, this.p.onTeardown])
  }

  /** @param {{path: string}} args */
  onSystemTestBrowserHelperDismissTo = ({path}) => {
    if (!this.p.enabled || !this.p.onDismissTo) {
      return
    }

    this.p.onDismissTo({path})
  }

  /** @param {{path: string}} args */
  onSystemTestBrowserHelperNavigate = ({path}) => {
    if (!this.p.enabled || !this.p.onNavigate) {
      return
    }

    this.p.onNavigate({path})
  }
}

/**
 * @param {Record<string, any>} props
 * @returns {UseSystemTestShapeHook}
 */
export function useSystemTestShapeHook(props) {
  return useShapeHook(UseSystemTestShapeHook, props)
}
