import qs from "qs"
import SystemTestBrowserHelper from "./system-test-browser-helper"
import {useCallback, useMemo} from "react"
import useEventEmitter from "@kaspernj/api-maker/build/use-event-emitter.js"
import {useRouter} from "expo-router"

const shared = {
  initialized: false,
  systemTestBrowserHelper: null
}

const isSystemTestEnabled = () => {
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

const getSystemTestBrowserHelper = () => {
  if (!shared.systemTestBrowserHelper) {
    shared.systemTestBrowserHelper = new SystemTestBrowserHelper()
    shared.systemTestBrowserHelper.enableOnBrowser()
  }

  return shared.systemTestBrowserHelper
}

/**
 * A hook that provides system test capabilities.
 *
 * @param {Object} options - Options for the hook.
 * @param {Function} options.onInitialize - A callback function that is called when the system test browser helper is initialized.
 *
 * @returns {Object} An object containing:
 *  - enabled: A boolean indicating if system test mode is enabled.
 *  - systemTestBrowserHelper: An instance of SystemTestBrowserHelper if enabled, otherwise null.
 */
export default function useSystemTest({onInitialize, ...restArgs} = {}) {
  const router = useRouter()
  const enabled = useMemo(() => isSystemTestEnabled(), [])
  const systemTestBrowserHelper = enabled ? getSystemTestBrowserHelper() : null
  const result = useMemo(() => ({enabled, systemTestBrowserHelper}), [enabled, systemTestBrowserHelper])
  const instanceShared = useMemo(() => ({}), [])

  instanceShared.enabled = enabled
  instanceShared.router = router

  // Resets navigation when instructed by the system test browser helper
  const onSystemTestBrowserHelperDismissTo = useCallback(({path}) => {
    if (instanceShared.enabled) {
      try {
        instanceShared.router.dismissTo(path)
      } catch (error) {
        console.error(`Failed to dismiss to path "${path}": ${error.message}`)
      }
    }
  }, [])

  useEventEmitter(shared.systemTestBrowserHelper?.getEvents(), "dismissTo", onSystemTestBrowserHelperDismissTo)


  // Navigates when instructed by the system test browser helper and keeping history of screens
  const onSystemTestBrowserHelperNavigate = useCallback(({path}) => {
    if (instanceShared.enabled) {
      instanceShared.router.navigate(path)
    }
  }, [])

  useEventEmitter(shared.systemTestBrowserHelper?.getEvents(), "navigate", onSystemTestBrowserHelperNavigate)

  useMemo(() => {
    if (enabled && !shared.initialized) {
      shared.initialized = true
      shared.systemTestBrowserHelper?.onInitialize(onInitialize)
    }
  }, [enabled, onInitialize, shared.systemTestBrowserHelper])

  const restArgsKeys = Object.keys(restArgs)

  if (restArgsKeys.length > 0) throw new Error(`Unknown arguments given to useSystemTest: ${restArgsKeys.join(", ")}`)

  return result
}
