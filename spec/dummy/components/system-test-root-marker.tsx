import { Platform, StyleSheet, Text } from "react-native"

const styles = StyleSheet.create({
  marker: {
    color: "transparent",
    height: 1,
    position: "absolute",
    fontSize: 1,
    lineHeight: 1,
    width: 1,
  },
})

export function SystemTestRootMarker() {
  return (
    <Text
      accessibilityLabel={Platform.OS === "web" ? undefined : "systemTestingComponent"}
      accessibilityRole="text"
      accessible
      collapsable={false}
      nativeID={Platform.OS === "web" ? undefined : "systemTestingComponent"}
      style={styles.marker}
      testID={Platform.OS === "web" ? undefined : "systemTestingComponent"}
    >
      System testing root
    </Text>
  )
}
