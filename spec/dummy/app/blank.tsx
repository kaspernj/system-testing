import {useState} from "react"
import {Pressable} from "react-native"

import {ThemedText} from "@/components/themed-text"
import {ThemedView} from "@/components/themed-view"

export default function BlankScreen() {
  const [pressed, setPressed] = useState(false)

  return (
    <ThemedView
      style={{flex: 1, alignItems: "center", justifyContent: "center", padding: 24}}
    >
      <ThemedText
        testID="blankText"
        type="title"
      >
        System testing blank page
      </ThemedText>

      <Pressable
        onPress={() => setPressed(true)}
        testID="blankPressButton"
      >
        <ThemedText testID="blankPressButtonText">
          Press me
        </ThemedText>
      </Pressable>

      <ThemedText testID={pressed ? "blankPressStatePressed" : "blankPressStateIdle"}>
        {pressed ? "Pressed" : "Idle"}
      </ThemedText>
    </ThemedView>
  )
}
