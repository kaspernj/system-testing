/** @typedef {{addListener: (eventName: "state", callback: () => void) => () => void, canGoBack: () => boolean}} ExpoNavigationState */
/** @typedef {{current: ExpoNavigationState | null | undefined}} ExpoNavigationContainerRef */
/** @typedef {{canDismiss: () => boolean, dismissAll: () => void, dismissTo: (path: string) => void, navigate: (path: string) => void}} ExpoRouter */
/** @typedef {{current: ExpoRouter}} ExpoRouterRef */

/**
 * Builds a one-shot listener for the next committed React Navigation state.
 * @param {ExpoNavigationState} navigation
 * @returns {{promise: Promise<void>, unsubscribe: () => void}}
 */
function waitForNavigationStateChange(navigation) {
  let unsubscribe = () => {}
  /** @type {Promise<void>} */
  const promise = new Promise((resolve) => {
    unsubscribe = navigation.addListener("state", () => {
      unsubscribe()
      resolve()
    })
  })

  return {promise, unsubscribe}
}

/**
 * Resets an Expo Router stack to a target path for a system-test run.
 * @param {object} args
 * @param {ExpoNavigationContainerRef} args.navigationContainerRef
 * @param {string} args.path
 * @param {ExpoRouterRef} args.routerRef
 * @returns {Promise<void>}
 */
export async function dismissExpoRouterToPath({navigationContainerRef, path, routerRef}) {
  // Pop every other screen off the Stack so previously-visited routes
  // unmount instead of accumulating in DOM with display:none. Without this,
  // react-native-web's global PressResponder gets confused by stale
  // Pressables that share the same testID as the visible one and Selenium
  // clicks fail to fire onPress.
  const navigation = navigationContainerRef.current
  const router = routerRef.current

  if (navigation && router.canDismiss()) {
    const stateChange = waitForNavigationStateChange(navigation)

    try {
      router.dismissAll()
      await stateChange.promise
    } catch (error) {
      stateChange.unsubscribe()
      throw error
    }
  }

  routerRef.current.dismissTo(path)
}
