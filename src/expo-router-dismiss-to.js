/** @typedef {{canGoBack: () => boolean}} ExpoNavigationState */
/** @typedef {{current: ExpoNavigationState | null | undefined}} ExpoNavigationContainerRef */
/** @typedef {{dismissAll: () => void, dismissTo: (path: string) => void}} ExpoRouter */

/**
 * Resets an Expo Router stack to a target path for a system-test run.
 * @param {object} args
 * @param {ExpoNavigationContainerRef} args.navigationContainerRef
 * @param {string} args.path
 * @param {ExpoRouter} args.router
 * @returns {void}
 */
export function dismissExpoRouterToPath({navigationContainerRef, path, router}) {
  // Pop every other screen off the Stack so previously-visited routes
  // unmount instead of accumulating in DOM with display:none. Without this,
  // react-native-web's global PressResponder gets confused by stale
  // Pressables that share the same testID as the visible one and Selenium
  // clicks fail to fire onPress.
  const navigation = navigationContainerRef.current

  if (navigation && navigation.canGoBack()) {
    router.dismissAll()
  }

  router.dismissTo(path)
}
