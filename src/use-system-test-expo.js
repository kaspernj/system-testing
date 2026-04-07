import {useRouter} from "expo-router"
import useSystemTest from "./use-system-test.js"

/**
 * Expo Router integration for system testing.
 * @param {object} options
 * @param {import("./system-test-browser-helper.js").default} [options.browserHelper]
 * @param {boolean} [options.enabled] Override the auto-detected enabled state.
 * @param {string} [options.host] Override the system test host for WebSocket connections.
 * @param {function() : void} [options.onFirstInitialize]
 * @param {function() : void} [options.onInitialize]
 * @param {function() : void} [options.onTeardown]
 * @returns {{enabled: boolean, systemTestBrowserHelper: import("./system-test-browser-helper.js").default | null}}
 */
export default function useSystemTestExpo({browserHelper, enabled, host, onFirstInitialize, onInitialize, onTeardown, ...restArgs} = {browserHelper: undefined, enabled: undefined, host: undefined, onFirstInitialize: undefined, onInitialize: undefined, onTeardown: undefined}) {
  const router = useRouter()
  const restArgsKeys = Object.keys(restArgs)

  if (restArgsKeys.length > 0) {
    throw new Error(`Unknown arguments given to useSystemTestExpo: ${restArgsKeys.join(", ")}`)
  }

  return useSystemTest({
    browserHelper,
    enabled,
    host,
    onDismissTo: ({path}) => {
      try {
        router.dismissTo(path)
      } catch (error) {
        console.error(`Failed to dismiss to path "${path}": ${error instanceof Error ? error.message : error}`)
      }
    },
    onFirstInitialize,
    onInitialize,
    onTeardown,
    onNavigate: ({path}) => {
      router.navigate(path)
    }
  })
}
