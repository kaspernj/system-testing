import { useIsFocused } from '@react-navigation/native';
import { View, type ViewProps } from 'react-native';

type SystemTestFocusedViewProps = ViewProps & {
  focussed?: boolean;
};

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
      style={[{ flex: 1 }, style]}
      testID="systemTestingComponent"
      accessibilityLabel="systemTestingComponent"
      // @ts-ignore dataSet is supported at runtime for React Native Web
      dataSet={{ focussed: isFocussed ? 'true' : 'false' }}
    >
      {children}
    </View>
  );
}
