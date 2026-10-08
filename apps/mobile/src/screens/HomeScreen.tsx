import { convertMass, roundToStep } from '@fizz/domain';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { reportMeta } from '../app-info';

interface Props {
  onOpenProbe: () => void;
}

/** App shell placeholder until the Today screen (docs/design/today.md) is built. */
export function HomeScreen({ onOpenProbe }: Props) {
  // Proves Metro bundles the TypeScript-source workspace packages.
  const lb = convertMass({ value: 100, unit: 'kg' }, 'lb');
  const meta = reportMeta();
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Fizz</Text>
      <Text style={styles.body}>App shell. Logging screens come next.</Text>
      <Text style={styles.small}>
        Domain package check: 100 kg = {roundToStep(lb.value, 0.01)} lb
      </Text>
      <Text style={styles.small}>
        {meta.installedBundleId} · {meta.appVersion} ({meta.buildNumber})
      </Text>
      <Pressable accessibilityRole="button" style={styles.devButton} onPress={onOpenProbe}>
        <Text style={styles.devButtonText}>Developer: capability probe</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 12, justifyContent: 'center' },
  title: { fontSize: 34, fontWeight: '700' },
  body: { fontSize: 17 },
  small: { fontSize: 13, color: '#555' },
  devButton: { marginTop: 32, padding: 14, borderRadius: 10, borderWidth: 1, borderColor: '#888' },
  devButtonText: { fontSize: 15, textAlign: 'center' },
});
