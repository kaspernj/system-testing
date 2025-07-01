import qs from "qs"
import SystemTestBrowserHelper from "./system-test-browser-helper"
import {useCallback, useEffect, useMemo, useState} from "react"
import useEventEmitter from "@kaspernj/api-maker/build/use-event-emitter.js"
import {useRouter} from "expo-router"

export default function useSystemTest({onInitialize, ...restArgs} = {}) {
  const router = useRouter()
  const shared = useMemo(() => ({}), [])
  const [enabled, setEnabled] = useState(undefined)
  const [systemTestBrowserHelper, setSystemTestBrowserHelper] = useState()

  const calculateEnabled = useCallback(() => {
    const initialUrl = globalThis.location?.href
    let enabled = false

    if (initialUrl) {
      const queryString = initialUrl.substring(initialUrl.indexOf("?") + 1, initialUrl.length)
      const queryParams = qs.parse(queryString)

      if (queryParams.systemTest == "true") {
        if (!shared.systemTestBrowserHelper) {
          console.log("Spawn SystemTestBrowserHelper")

          shared.systemTestBrowserHelper = new SystemTestBrowserHelper()
          shared.systemTestBrowserHelper.enableOnBrowser()

          setSystemTestBrowserHelper(shared.systemTestBrowserHelper)
        }

        enabled = true
      }
    }

    shared.enabled = enabled
    setEnabled(enabled)
  }, [])

  const result = useMemo(() => ({
    enabled,
    systemTestBrowserHelper: systemTestBrowserHelper
  }), [enabled, systemTestBrowserHelper])

  const onSystemTestBrowserHelperNavigate = useCallback(({path}) => {
    if (shared.enabled) {
      router.navigate(path)
    }
  }, [])

  useEffect(() => {
    calculateEnabled()
  }, [])

  useEventEmitter(shared.systemTestBrowserHelper?.getEvents(), "navigate", onSystemTestBrowserHelperNavigate)

  useMemo(() => {
    shared.systemTestBrowserHelper?.onInitialize(onInitialize)
  }, [onInitialize, shared.systemTestBrowserHelper])

  const restArgsKeys = Object.keys(restArgs)

  if (restArgsKeys.length > 0) throw new Error(`Unknown arguments given to useSystemTest: ${restArgsKeys.join(", ")}`)

  return result
}
