import {Stack} from "expo-router"
import {View} from "react-native"
import {SafeAreaProvider} from "react-native-safe-area-context"
import useSystemTest from "system-testing/src/use-system-test.js"

export default function RootLayout() {
  const {enabled} = useSystemTest({
    onInitialize: () => {
      console.log("System test browser helper initialized")
    }
  })

  return (
    <SafeAreaProvider>
      <View
        style={{flex: 1, backgroundColor: "#f4f6fb"}}
        data-testid="systemTestingComponent"
        data-focussed={enabled ? "true" : "false"}
      >
        <Stack screenOptions={{contentStyle: {backgroundColor: "transparent"}}} />
      </View>
    </SafeAreaProvider>
  )
}
