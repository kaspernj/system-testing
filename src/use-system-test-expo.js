import {useRouter} from "expo-router"
import useSystemTest from "./use-system-test.js"

/**
 * Expo Router integration for system testing.
 * @param {object} options
 * @param {import("./system-test-browser-helper.js").default} [options.browserHelper]
 * @param {function() : void} [options.onFirstInitialize]
 * @param {function() : void} [options.onInitialize]
 * @returns {{enabled: boolean, systemTestBrowserHelper: import("./system-test-browser-helper.js").default | null}}
 */
export default function useSystemTestExpo({browserHelper, onFirstInitialize, onInitialize, ...restArgs} = {browserHelper: undefined, onFirstInitialize: undefined, onInitialize: undefined}) {
  const router = useRouter()
  const restArgsKeys = Object.keys(restArgs)

  if (restArgsKeys.length > 0) {
    throw new Error(`Unknown arguments given to useSystemTestExpo: ${restArgsKeys.join(", ")}`)
  }

  return useSystemTest({
    browserHelper,
    onDismissTo: ({path}) => {
      try {
        router.dismissTo(path)
      } catch (error) {
        console.error(`Failed to dismiss to path "${path}": ${error instanceof Error ? error.message : error}`)
      }
    },
    onFirstInitialize,
    onInitialize,
    onNavigate: ({path}) => {
      router.navigate(path)
    }
  })
}
