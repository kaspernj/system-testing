import qs from "qs"
import useEventEmitter from "ya-use-event-emitter"
import {useSystemTestShapeHook} from "./use-system-test-shape-hook.js"

/** @returns {boolean} */
function isSystemTestEnabled() {
  let enabled = false
  const envEnabled = process.env.EXPO_PUBLIC_SYSTEM_TEST === "true"
  const envHost = process.env.EXPO_PUBLIC_SYSTEM_TEST_HOST
  const initialUrl = globalThis.location?.href

  if (initialUrl) {
    const queryString = initialUrl.substring(initialUrl.indexOf("?") + 1, initialUrl.length)
    const queryParams = qs.parse(queryString)

    if (queryParams.systemTest == "true") {
      enabled = true
    }
  }

  if (envEnabled || envHost) {
    enabled = true
  }

  return enabled
}

/**
 * Generic system-test hook. Supply navigation callbacks for the target runtime/router.
 * @param {object} options
 * @param {import("./system-test-browser-helper.js").default} [options.browserHelper]
 * @param {(args: {path: string}) => void} [options.onDismissTo]
 * @param {function() : void} [options.onFirstInitialize]
 * @param {function() : void} [options.onInitialize]
 * @param {(args: {path: string}) => void} [options.onNavigate]
 * @returns {{enabled: boolean, systemTestBrowserHelper: import("./system-test-browser-helper.js").default | null}}
 */
export default function useSystemTest({browserHelper, onDismissTo, onFirstInitialize, onInitialize, onNavigate, ...restArgs} = {browserHelper: undefined, onDismissTo: undefined, onFirstInitialize: undefined, onInitialize: undefined, onNavigate: undefined}) {
  const restArgsKeys = Object.keys(restArgs)

  if (restArgsKeys.length > 0) {
    throw new Error(`Unknown arguments given to useSystemTest: ${restArgsKeys.join(", ")}`)
  }

  const shapeHook = useSystemTestShapeHook({
    browserHelper,
    enabled: isSystemTestEnabled(),
    onDismissTo,
    onFirstInitialize,
    onInitialize,
    onNavigate
  })
  const systemTestBrowserHelper = shapeHook.systemTestBrowserHelper()

  useEventEmitter(systemTestBrowserHelper?.getEvents(), "dismissTo", shapeHook.tt.onSystemTestBrowserHelperDismissTo)
  useEventEmitter(systemTestBrowserHelper?.getEvents(), "navigate", shapeHook.tt.onSystemTestBrowserHelperNavigate)

  return shapeHook.result()
}
