import useSystemTest from "./use-system-test.js"

/**
 * React Native integration point for system testing without Expo Router.
 * Supply runtime-specific navigation callbacks.
 * @param {object} options
 * @param {import("./system-test-browser-helper.js").default} [options.browserHelper]
 * @param {(args: {path: string}) => void} [options.onDismissTo]
 * @param {function() : void} [options.onFirstInitialize]
 * @param {function() : void} [options.onInitialize]
 * @param {(args: {path: string}) => void} [options.onNavigate]
 * @returns {{enabled: boolean, systemTestBrowserHelper: import("./system-test-browser-helper.js").default | null}}
 */
export default function useSystemTestReactNative({browserHelper, onDismissTo, onFirstInitialize, onInitialize, onNavigate, ...restArgs} = {browserHelper: undefined, onDismissTo: undefined, onFirstInitialize: undefined, onInitialize: undefined, onNavigate: undefined}) {
  const restArgsKeys = Object.keys(restArgs)

  if (restArgsKeys.length > 0) {
    throw new Error(`Unknown arguments given to useSystemTestReactNative: ${restArgsKeys.join(", ")}`)
  }

  return useSystemTest({browserHelper, onDismissTo, onFirstInitialize, onInitialize, onNavigate})
}
