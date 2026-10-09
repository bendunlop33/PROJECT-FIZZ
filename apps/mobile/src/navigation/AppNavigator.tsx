import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { DarkTheme, DefaultTheme, NavigationContainer, type Theme as NavTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SymbolView } from 'expo-symbols';
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { WeightUnit } from '@fizz/schemas';

import { AddGymScreen } from '../screens/AddGymScreen';
import { CapabilityProbeScreen } from '../screens/CapabilityProbeScreen';
import { DataBackupScreen } from '../screens/data/DataBackupScreen';
import { AppStatusScreen } from '../screens/profile/AppStatusScreen';
import { DeveloperScreen } from '../screens/profile/DeveloperScreen';
import { PainFlagsScreen } from '../screens/profile/PainFlagsScreen';
import { ProfileScreen } from '../screens/profile/ProfileScreen';
import { ProgressScreen } from '../screens/ProgressScreen';
import { SetupScreen } from '../screens/setup/SetupScreen';
import { TodayScreen } from '../screens/TodayScreen';
import { CheckInScreen } from '../screens/workout/CheckInScreen';
import { EditSetScreen } from '../screens/workout/EditSetScreen';
import { ExercisePickerScreen } from '../screens/workout/ExercisePickerScreen';
import { SummaryScreen } from '../screens/workout/SummaryScreen';
import { WorkoutScreen } from '../screens/workout/WorkoutScreen';
import type { SetupStep } from '../services/setup';
import { useTheme } from '../theme';
import type { SymbolName } from '../ui';
import { initialRootState } from './initial-state';
import type { ProfileStackParams, RootStackParams, TabParams } from './types';

const RootStack = createNativeStackNavigator<RootStackParams>();
const TabNav = createBottomTabNavigator<TabParams>();
const ProfileStack = createNativeStackNavigator<ProfileStackParams>();

function useStackOptions() {
  const theme = useTheme();
  return {
    headerStyle: { backgroundColor: theme.colors['bg.canvas'] },
    headerTintColor: theme.colors.accent,
    headerTitleStyle: { color: theme.colors['text.primary'] },
    headerShadowVisible: false,
    contentStyle: { backgroundColor: theme.colors['bg.canvas'] },
  } as const;
}

function ProbeRoute({ navigation }: { navigation: { goBack: () => void } }) {
  // Developer spike screen; keeps its own light styling and Back button.
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
      <CapabilityProbeScreen onBack={navigation.goBack} />
    </SafeAreaView>
  );
}

function ProfileNavigator() {
  const options = useStackOptions();
  return (
    <ProfileStack.Navigator screenOptions={options}>
      <ProfileStack.Screen name="ProfileHome" component={ProfileScreen} options={{ title: 'Profile', headerLargeTitle: true }} />
      <ProfileStack.Screen name="DataBackup" component={DataBackupScreen} options={{ title: 'Data & backup' }} />
      <ProfileStack.Screen name="AppStatus" component={AppStatusScreen} options={{ title: 'App status' }} />
      <ProfileStack.Screen name="PainFlags" component={PainFlagsScreen} options={{ title: 'Pain flags' }} />
      <ProfileStack.Screen name="Developer" component={DeveloperScreen} options={{ title: 'Developer' }} />
      <ProfileStack.Screen name="CapabilityProbe" component={ProbeRoute} options={{ headerShown: false }} />
    </ProfileStack.Navigator>
  );
}

const TAB_ICONS: Record<keyof TabParams, [SymbolName, SymbolName]> = {
  Today: ['sun.max', 'sun.max.fill'],
  Progress: ['chart.bar', 'chart.bar.fill'],
  Profile: ['person.crop.circle', 'person.crop.circle.fill'],
};

function TabsNavigator() {
  const theme = useTheme();
  return (
    <TabNav.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: theme.colors.accent,
        tabBarInactiveTintColor: theme.colors['text.secondary'],
        tabBarStyle: { backgroundColor: theme.colors['bg.surface'], borderTopColor: theme.colors['border.divider'], borderTopWidth: theme.dividerWidth },
        // The selected tab also changes shape (filled symbol), never colour alone.
        tabBarIcon: ({ focused, color, size }) => <SymbolView name={TAB_ICONS[route.name][focused ? 1 : 0]} tintColor={color} size={size} accessible={false} />,
      })}
    >
      <TabNav.Screen name="Today" component={TodayScreen} />
      <TabNav.Screen name="Progress" component={ProgressScreen} />
      <TabNav.Screen name="Profile" component={ProfileNavigator} />
    </TabNav.Navigator>
  );
}

export interface AppNavigatorProps {
  setupStep: SetupStep;
  setupUnit: WeightUnit | null;
  /** Cold start with an unfinished workout under 6 h old opens straight into it (flow P6). */
  openWorkout: boolean;
}

export function AppNavigator({ setupStep, setupUnit, openWorkout }: AppNavigatorProps) {
  const theme = useTheme();
  const options = useStackOptions();
  const [setupDone, setSetupDone] = useState(setupStep === 'done');
  // Computed once: the launch stack (review S5). Later changes navigate normally.
  const [initialState] = useState(() => initialRootState(setupStep === 'done', openWorkout));
  const navTheme = useMemo<NavTheme>(() => {
    const base = theme.scheme === 'dark' ? DarkTheme : DefaultTheme;
    return {
      ...base,
      dark: theme.scheme === 'dark',
      colors: {
        ...base.colors,
        primary: theme.colors.accent,
        background: theme.colors['bg.canvas'],
        card: theme.colors['bg.surface'],
        text: theme.colors['text.primary'],
        border: theme.colors['border.divider'],
        notification: theme.colors['status.danger'],
      },
    };
  }, [theme]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors['bg.canvas'] }}>
      <NavigationContainer theme={navTheme} initialState={initialState}>
        <RootStack.Navigator screenOptions={{ ...options, headerShown: false }}>
          {setupDone ? (
            <>
              <RootStack.Screen name="Tabs" component={TabsNavigator} />
              <RootStack.Screen name="Workout" component={WorkoutScreen} options={{ presentation: 'fullScreenModal', gestureEnabled: false }} />
              {/* Swipe-down = "not now": back to where Ben was, nothing started (check-in.md CI3). */}
              <RootStack.Screen
                name="CheckIn"
                component={CheckInScreen}
                options={{ presentation: 'formSheet', sheetAllowedDetents: [0.55, 1.0], sheetGrabberVisible: true, contentStyle: { backgroundColor: theme.colors['bg.surface'] } }}
              />
              <RootStack.Screen name="ExercisePicker" component={ExercisePickerScreen} options={{ presentation: 'modal' }} />
              <RootStack.Screen
                name="EditSet"
                component={EditSetScreen}
                options={{ presentation: 'formSheet', sheetAllowedDetents: [0.7, 1.0], sheetGrabberVisible: true, contentStyle: { backgroundColor: theme.colors['bg.surface'] } }}
              />
              {/* No back navigation into a finished workout; corrections go through Edit (workout-summary §2). */}
              <RootStack.Screen name="Summary" component={SummaryScreen} options={{ presentation: 'fullScreenModal', gestureEnabled: false }} />
              <RootStack.Screen name="AddGym" component={AddGymScreen} options={{ presentation: 'modal' }} />
            </>
          ) : (
            <RootStack.Screen name="Setup">
              {() => (
                <SetupScreen
                  initialStep={setupStep === 'done' ? 'welcome' : setupStep}
                  initialUnit={setupUnit}
                  onDone={() => {
                    setSetupDone(true);
                  }}
                />
              )}
            </RootStack.Screen>
          )}
        </RootStack.Navigator>
      </NavigationContainer>
    </View>
  );
}
