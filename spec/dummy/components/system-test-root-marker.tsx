/**
 * Retained as a no-op for backwards compatibility.
 * On native, the accessibility label for systemTestingComponent is now set
 * directly on SystemTestFocusedView (a real visible container) so that
 * UiAutomator2 can reliably find it in the accessibility tree.
 */
export function SystemTestRootMarker() {
  return null
}
