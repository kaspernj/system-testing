import {useRouter} from "expo-router"
import {useMemo, useState} from "react"
import {Pressable, StyleSheet, Text, TextInput, View} from "react-native"

export default function SignInScreen() {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [notification, setNotification] = useState("")

  const disableSubmit = useMemo(() => email.trim() === "" || password.trim() === "", [email, password])

  return (
    <View style={styles.container}>
      <Pressable onPress={() => router.dismissTo("/")} style={styles.linkButton}>
        <Text style={styles.linkText}>Back</Text>
      </Pressable>

      <Text style={styles.title}>Sign in</Text>
      <Text style={styles.subtitle}>Enter any credentials to trigger the sample notification message.</Text>

      <View style={styles.form}>
        <TextInput
          autoCapitalize="none"
          placeholder="Email"
          value={email}
          onChangeText={setEmail}
          style={styles.input}
          testID="signInEmailInput"
        />
        <TextInput
          secureTextEntry
          placeholder="Password"
          value={password}
          onChangeText={setPassword}
          style={styles.input}
          testID="signInPasswordInput"
        />

        <Pressable
          disabled={disableSubmit}
          onPress={() => setNotification("You were signed in.")}
          style={[styles.button, disableSubmit && styles.buttonDisabled]}
          testID="signInSubmitButton"
        >
          <Text style={styles.buttonText}>Submit</Text>
        </Pressable>
      </View>

      {notification ? (
        <Pressable
          onPress={() => setNotification("")}
          style={styles.notification}
          data-class="notification-message"
          testID="notificationMessage"
        >
          <Text style={styles.notificationText}>{notification}</Text>
          <Text style={styles.notificationHint}>Click to dismiss</Text>
        </Pressable>
      ) : null}
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
  linkButton: {
    alignSelf: "flex-start",
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: "#e5e7eb",
    borderRadius: 6
  },
  linkText: {
    color: "#111827",
    fontWeight: "600"
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: "#111827"
  },
  subtitle: {
    fontSize: 14,
    color: "#4b5563"
  },
  form: {
    gap: 12
  },
  input: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    padding: 12,
    borderRadius: 8,
    backgroundColor: "#fff"
  },
  button: {
    marginTop: 8,
    padding: 12,
    backgroundColor: "#16a34a",
    borderRadius: 8,
    alignItems: "center"
  },
  buttonDisabled: {
    opacity: 0.6
  },
  buttonText: {
    color: "#fff",
    fontWeight: "700"
  },
  notification: {
    marginTop: 16,
    padding: 16,
    backgroundColor: "#ecfeff",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#06b6d4",
    gap: 6
  },
  notificationText: {
    color: "#0f172a",
    fontWeight: "700"
  },
  notificationHint: {
    color: "#334155",
    fontSize: 12
  }
})
