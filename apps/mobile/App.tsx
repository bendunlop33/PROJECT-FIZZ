import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { CapabilityProbeScreen } from './src/screens/CapabilityProbeScreen';
import { HomeScreen } from './src/screens/HomeScreen';

type Route = 'home' | 'probe';

export default function App() {
  const [route, setRoute] = useState<Route>('home');
  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.root}>
      <StatusBar style="auto" />
      {route === 'home' ? (
        <HomeScreen
          onOpenProbe={() => {
            setRoute('probe');
          }}
        />
      ) : (
        <CapabilityProbeScreen
          onBack={() => {
            setRoute('home');
          }}
        />
      )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: '#fff' } });
