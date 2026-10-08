import { convertMass, roundToStep } from '@fizz/domain';
import { StyleSheet, Text, View } from 'react-native';

/** App shell placeholder until the Today screen (docs/design/today.md) is built. */
export function HomeScreen() {
  // Proves Metro bundles the TypeScript-source workspace packages.
  const lb = convertMass({ value: 100, unit: 'kg' }, 'lb');
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Fizz</Text>
      <Text style={styles.body}>App shell. Logging screens come next.</Text>
      <Text style={styles.small}>
        Domain package check: 100 kg = {roundToStep(lb.value, 0.01)} lb
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 12, justifyContent: 'center' },
  title: { fontSize: 34, fontWeight: '700' },
  body: { fontSize: 17 },
  small: { fontSize: 13, color: '#555' },
});
