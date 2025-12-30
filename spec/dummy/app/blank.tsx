import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';

export default function BlankScreen() {

  return (
    <ThemedView
      style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}
    >
      <ThemedText dataSet={{ testid: 'blankText' }} type="title">
        System testing blank page
      </ThemedText>
    </ThemedView>
  );
}
