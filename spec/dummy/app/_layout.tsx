import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { SystemTestFocusedView } from '@/components/system-test-focused-view';
import { SystemTestRootMarker } from '@/components/system-test-root-marker';
import useSystemTestExpo from "system-testing/build/use-system-test-expo.js";

export const unstable_settings = {
  anchor: '(tabs)',
};

const systemTestEnabled = process.env.EXPO_PUBLIC_SYSTEM_TEST === 'true' || undefined
const systemTestHost = process.env.EXPO_PUBLIC_SYSTEM_TEST_HOST || undefined

export default function RootLayout() {
  const colorScheme = useColorScheme();
  useSystemTestExpo({enabled: systemTestEnabled, host: systemTestHost});

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
