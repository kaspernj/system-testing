import { useIsFocused } from '@react-navigation/native';
import { Platform, View, type ViewProps } from 'react-native';

type SystemTestFocusedViewProps = ViewProps & {
  focussed?: boolean;
};

const isNative = Platform.OS !== 'web';

export function SystemTestFocusedView({
  children,
  style,
  focussed,
  ...rest
}: SystemTestFocusedViewProps) {
  const isFocused = useIsFocused();
  const isFocussed = focussed ?? isFocused;

  return (
    <View
      {...rest}
      accessibilityLabel={isNative ? 'systemTestingComponent' : undefined}
      style={[{ flex: 1 }, style]}
      testID="systemTestingComponent"
      nativeID={Platform.OS === 'web' ? 'systemTestingComponent' : undefined}
      collapsable={false}
      // @ts-ignore dataSet is supported at runtime for React Native Web
      dataSet={{ focussed: isFocussed ? 'true' : 'false' }}
    >
      {children}
    </View>
  );
}
