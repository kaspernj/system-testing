import { StyleSheet, Text } from "react-native"

const styles = StyleSheet.create({
  marker: {
    height: 1,
    opacity: 0,
    position: "absolute",
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
