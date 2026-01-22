import { Platform, StyleSheet, View } from "react-native"

const styles = StyleSheet.create({
  marker: {
    height: 1,
    left: 0,
    opacity: 0,
    position: "absolute",
    top: 0,
    width: 1,
  },
})

export function SystemTestRootMarker() {
  return (
    <View
      accessibilityLabel={Platform.OS === "web" ? undefined : "systemTestingComponent"}
      accessible
      collapsable={false}
      nativeID={Platform.OS === "web" ? undefined : "systemTestingComponent"}
      pointerEvents="none"
      style={styles.marker}
      testID={Platform.OS === "web" ? undefined : "systemTestingComponent"}
    />
  )
}
