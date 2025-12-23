import {StyleSheet, Text, View} from "react-native"

export default function BlankScreen() {
  return (
    <View style={styles.container}>
      <Text testID="blankText" style={styles.title}>
        System Testing Blank Screen
      </Text>
      <Text style={styles.subtitle}>Used as a reset target before each test run.</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 12
  },
  title: {
    fontSize: 20,
    fontWeight: "600"
  },
  subtitle: {
    fontSize: 14,
    color: "#4b5563",
    textAlign: "center"
  }
})
