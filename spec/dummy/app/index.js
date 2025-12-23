import {useRouter} from "expo-router"
import {Pressable, StyleSheet, Text, View} from "react-native"

export default function HomeScreen() {
  const router = useRouter()

  return (
    <View style={styles.container} testID="frontpageScreen">
      <Text style={styles.title}>Dummy Expo App</Text>
      <Text style={styles.subtitle}>
        A minimal Expo Router app wired to system-testing. Use the button below to open the sign in flow.
      </Text>

      <Pressable style={styles.button} onPress={() => router.push("/sign-in")} testID="signInButton">
        <Text style={styles.buttonText}>Go to sign in</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    gap: 16,
    justifyContent: "center"
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: "#111827"
  },
  subtitle: {
    fontSize: 16,
    color: "#4b5563"
  },
  button: {
    marginTop: 12,
    padding: 12,
    backgroundColor: "#2563eb",
    borderRadius: 8,
    alignItems: "center"
  },
  buttonText: {
    color: "#fff",
    fontWeight: "600"
  }
})
