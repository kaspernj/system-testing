import { StyleSheet, Text } from "react-native"

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
      accessibilityLabel="systemTestingComponent"
      accessibilityRole="text"
      accessible
      collapsable={false}
      nativeID="systemTestingComponent"
      style={styles.marker}
      testID="systemTestingComponent"
    >
      System testing root
    </Text>
  )
}
