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
      // @ts-ignore dataSet is supported at runtime for React Native Web
      dataSet={{ testid: 'systemTestingComponent', focussed: isFocussed ? 'true' : 'false' }}
    >
      {children}
    </View>
  );
}
