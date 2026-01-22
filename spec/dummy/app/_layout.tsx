import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { SystemTestFocusedView } from '@/components/system-test-focused-view';
import { SystemTestRootMarker } from '@/components/system-test-root-marker';
import useSystemTest from "system-testing/build/use-system-test.js";

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();
  useSystemTest();

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <SystemTestFocusedView focussed>
        <SystemTestRootMarker />
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
        </Stack>
      </SystemTestFocusedView>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}
