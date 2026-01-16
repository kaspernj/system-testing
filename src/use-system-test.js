import qs from "qs"
import SystemTestBrowserHelper from "./system-test-browser-helper.js"
import {useCallback, useMemo} from "react"
import useEventEmitter from "ya-use-event-emitter"
import {useRouter} from "expo-router"

const shared = {
  initialized: false,
  systemTestBrowserHelper: null
}

/**
 * @returns {boolean}
 */
function isSystemTestEnabled() {
  let enabled = false
  const initialUrl = globalThis.location?.href

  if (initialUrl) {
    const queryString = initialUrl.substring(initialUrl.indexOf("?") + 1, initialUrl.length)
    const queryParams = qs.parse(queryString)

    if (queryParams.systemTest == "true") {
      enabled = true
    }
  }

  return enabled
}

/**
 * @returns {SystemTestBrowserHelper}
 */
function getSystemTestBrowserHelper() {
  if (!shared.systemTestBrowserHelper) {
    shared.systemTestBrowserHelper = new SystemTestBrowserHelper()
    shared.systemTestBrowserHelper.enableOnBrowser()
  }

  return shared.systemTestBrowserHelper
}

/**
 * A hook that provides system test capabilities.
 * @param {object} options - Options for the hook.
 * @param {function() : void} options.onInitialize - A callback function that is called when the system test browser helper is initialized.
 * @param {function() : void} options.onFirstInitialize - A callback function that is called the first time the system test browser helper is initialized.
 * @returns {{enabled: boolean, systemTestBrowserHelper: SystemTestBrowserHelper}}
 */
export default function useSystemTest({onFirstInitialize, onInitialize, ...restArgs} = {onFirstInitialize: undefined, onInitialize: undefined}) {
  if (!useMemo) throw new Error("[useSystemTest] React.useMemo is not available")
  if (!useCallback) throw new Error("[useSystemTest] React.useCallback is not available")

  let router = null

  try {
    router = useRouter()
  } catch (error) {
    console.error("[useSystemTest] useRouter unavailable:", error)
  }
  const enabled = useMemo(() => isSystemTestEnabled(), [])
  const systemTestBrowserHelper = enabled ? getSystemTestBrowserHelper() : null
  const result = useMemo(() => ({enabled, systemTestBrowserHelper}), [enabled, systemTestBrowserHelper])
  const instanceShared = useMemo(() => ({enabled: false, router: null}), [])

  instanceShared.enabled = enabled
  instanceShared.router = router

  // Resets navigation when instructed by the system test browser helper
  const onSystemTestBrowserHelperDismissTo = useCallback(({path}) => {
    if (instanceShared.enabled) {
      try {
        instanceShared.router?.dismissTo(path)
      } catch (error) {
        console.error(`Failed to dismiss to path "${path}": ${error.message}`)
      }
    }
  }, [])

  useEventEmitter(shared.systemTestBrowserHelper?.getEvents(), "dismissTo", onSystemTestBrowserHelperDismissTo)


  // Navigates when instructed by the system test browser helper and keeping history of screens
  const onSystemTestBrowserHelperNavigate = useCallback(({path}) => {
    if (instanceShared.enabled) {
      instanceShared.router?.navigate(path)
    }
  }, [])

  useEventEmitter(shared.systemTestBrowserHelper?.getEvents(), "navigate", onSystemTestBrowserHelperNavigate)

  useMemo(() => {
    if (enabled && !shared.initialized) {
      shared.initialized = true
      shared.systemTestBrowserHelper?.onFirstInitialize(onFirstInitialize)
      shared.systemTestBrowserHelper?.onInitialize(onInitialize)
    }
  }, [enabled, onFirstInitialize, onInitialize, shared.systemTestBrowserHelper])

  const restArgsKeys = Object.keys(restArgs)

  if (restArgsKeys.length > 0) throw new Error(`Unknown arguments given to useSystemTest: ${restArgsKeys.join(", ")}`)

  return result
}
