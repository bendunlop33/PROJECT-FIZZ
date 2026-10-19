import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { DarkTheme, DefaultTheme, NavigationContainer, useNavigation, useNavigationContainerRef, type Theme as NavTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SymbolView } from 'expo-symbols';
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { WeightUnit } from '@fizz/schemas';

import { recordContainedError, setCurrentScreen } from '../diagnostics/crash-capture';
import { createGuardedLoader } from '../guide/guarded-load';

import { AddGymScreen } from '../screens/AddGymScreen';
import { CapabilityProbeScreen } from '../screens/CapabilityProbeScreen';
import { DataBackupScreen } from '../screens/data/DataBackupScreen';
import { EquipmentEditorScreen } from '../screens/gym/EquipmentEditorScreen';
import { GymDetailScreen } from '../screens/gym/GymDetailScreen';
import { RestoreScreen } from '../screens/data/RestoreScreen';
import { DeleteMyDataScreen } from '../screens/data/DeleteMyDataScreen';
import { ExportScreen } from '../screens/data/ExportScreen';
import { ResetKnowledgeScreen } from '../screens/data/ResetKnowledgeScreen';
import { ImportChooseScreen } from '../screens/import/ImportChooseScreen';
import { ImportedWorkoutScreen } from '../screens/import/ImportedWorkoutScreen';
import { ImportIntroScreen } from '../screens/import/ImportIntroScreen';
import { ImportHistoryScreen } from '../screens/import/ImportHistoryScreen';
import { ImportLayoutCheckScreen } from '../screens/import/ImportLayoutCheckScreen';
import { ImportLayoutQuestionScreen } from '../screens/import/ImportLayoutQuestionScreen';
import { ImportLayoutRoleScreen } from '../screens/import/ImportLayoutRoleScreen';
import { ImportNewLayoutScreen } from '../screens/import/ImportNewLayoutScreen';
import { ImportSentScreen } from '../screens/import/ImportSentScreen';
import { ImportValueChecksScreen } from '../screens/import/ImportValueChecksScreen';
import { SavedLayoutScreen, SavedLayoutsScreen } from '../screens/import/SavedLayoutsScreen';
import { ImportNamesScreen } from '../screens/import/ImportNamesScreen';
import { ImportPreviewScreen } from '../screens/import/ImportPreviewScreen';
import { ImportQuestionScreen } from '../screens/import/ImportQuestionScreen';
import { ImportResultsScreen } from '../screens/import/ImportResultsScreen';
import { ImportRowsScreen } from '../screens/import/ImportRowsScreen';
import { ImportRunScreen } from '../screens/import/ImportRunScreen';
import { PastImportsScreen } from '../screens/import/PastImportsScreen';
import { AppStatusScreen } from '../screens/profile/AppStatusScreen';
import { ChatGptSignInTestScreen } from '../screens/profile/ChatGptSignInTestScreen';
import { CoachConnectionScreen } from '../screens/profile/CoachConnectionScreen';
import { DeveloperScreen } from '../screens/profile/DeveloperScreen';
import { VoiceSettingsScreen } from '../screens/profile/VoiceSettingsScreen';
import { PainFlagsScreen } from '../screens/profile/PainFlagsScreen';
import { SplitScreen } from '../screens/profile/SplitScreen';
import { TrainingDetailsScreen } from '../screens/profile/TrainingDetailsScreen';
import { MemoryScreen } from '../screens/profile/MemoryScreen';
import { PlaybookScreen } from '../screens/profile/PlaybookScreen';
import { PainFlagSheet } from '../screens/workout/PainFlagSheet';
import { ProfileScreen } from '../screens/profile/ProfileScreen';
import { ExerciseInfoScreen } from '../screens/library/ExerciseInfoScreen';
import { PlanDayScreen } from '../screens/library/PlanDayScreen';
import { LibraryScreen } from '../screens/library/LibraryScreen';
import { ExerciseDetailScreen } from '../screens/progress/ExerciseDetailScreen';
import { MusclesScreen } from '../screens/progress/MusclesScreen';
import { ProgressScreen } from '../screens/progress/ProgressScreen';
import { PastWorkoutsScreen } from '../screens/repeat/PastWorkoutsScreen';
import { RecentlyDeletedScreen } from '../screens/repeat/RecentlyDeletedScreen';
import { RepeatScreen } from '../screens/repeat/RepeatScreen';
import { WorkoutEditorScreen } from '../screens/routines/WorkoutEditorScreen';
import { SetupScreen } from '../screens/setup/SetupScreen';
import { TodayScreen } from '../screens/TodayScreen';
import { CheckInScreen } from '../screens/workout/CheckInScreen';
import { EditSetScreen } from '../screens/workout/EditSetScreen';
import { ExercisePickerScreen } from '../screens/workout/ExercisePickerScreen';
import type { HowToScreen } from '../screens/workout/HowToScreen';
import { CoachSheetScreen } from '../screens/coach/CoachSheetScreen';
import { SummaryScreen } from '../screens/workout/SummaryScreen';
import { WorkoutOverviewScreen } from '../screens/workout/WorkoutOverviewScreen';
import { WorkoutScreen } from '../screens/workout/WorkoutScreen';
import type { SetupStep } from '../services/setup';
import { screenAnimation, useTheme } from '../theme';
import { AppText, MessageScreen, PrimaryButton, type SymbolName } from '../ui';
import { initialRootState } from './initial-state';
import type { ImportQuestionKind, LibraryStackParams, ProfileStackParams, ProgressStackParams, RootStackParams, TabParams } from './types';

/**
 * How to is required on first open, not at launch (review S1): it keeps the
 * guide code and its catalogue reads off the cold-start path, which is also the
 * force-close recovery path. Skia itself is loaded later still, behind a guard
 * (`guide/load-player.ts`).
 */
const howToModule = createGuardedLoader(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- deliberate lazy load
  return (require('../screens/workout/HowToScreen') as { HowToScreen: typeof HowToScreen }).HowToScreen;
});

/** How to's module failed to load: say so, never close the app (React Navigation calls `getComponent` while rendering). */
function HowToUnavailable() {
  const navigation = useNavigation();
  return (
    <MessageScreen title="How to couldn’t open" lines={['Something in this build failed to load it. Your workout is untouched.', 'Profile › App status › Last error has the details.']}>
      <PrimaryButton
        label="Done"
        onPress={() => {
          navigation.goBack();
        }}
      />
    </MessageScreen>
  );
}

function loadHowToScreen(): typeof HowToScreen {
  const loaded = howToModule();
  if (loaded.ok) return loaded.value;
  recordContainedError(loaded.error, 'how-to');
  return HowToUnavailable;
}

const RootStack = createNativeStackNavigator<RootStackParams>();
const TabNav = createBottomTabNavigator<TabParams>();
const ProfileStack = createNativeStackNavigator<ProfileStackParams>();
const ProgressStack = createNativeStackNavigator<ProgressStackParams>();
const LibraryStack = createNativeStackNavigator<LibraryStackParams>();

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

function ProgressNavigator() {
  const options = useStackOptions();
  return (
    <ProgressStack.Navigator screenOptions={options}>
      <ProgressStack.Screen name="ProgressHome" component={ProgressScreen} options={{ headerShown: false }} />
      <ProgressStack.Screen name="ProgressMuscles" component={MusclesScreen} options={{ title: 'Muscles' }} />
      <ProgressStack.Screen name="ProgressExercise" component={ExerciseDetailScreen} options={({ route }) => ({ title: route.params.name ?? '' })} />
      <ProgressStack.Screen name="ProgressExerciseInfo" component={ExerciseInfoScreen} options={({ route }) => ({ title: route.params.name ?? '' })} />
    </ProgressStack.Navigator>
  );
}

/** The Library tab (exercise-library §9, EL10): Exercises · Workouts, and Exercise detail (and a plan day) pushed in the same stack. */
function LibraryNavigator() {
  const options = useStackOptions();
  return (
    <LibraryStack.Navigator screenOptions={options}>
      <LibraryStack.Screen name="LibraryHome" component={LibraryScreen} options={{ headerShown: false }} />
      <LibraryStack.Screen name="LibraryExercise" component={ExerciseInfoScreen} options={({ route }) => ({ title: route.params.name ?? '', headerBackTitle: 'Library' })} />
      {/* Your plan › a day (Ben, 19 Oct): the big title is in the page; back reads `Your plan`. */}
      <LibraryStack.Screen name="LibraryPlanDay" component={PlanDayScreen} options={{ title: '', headerBackTitle: 'Your plan' }} />
    </LibraryStack.Navigator>
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
      <ProfileStack.Screen name="TrainingDetails" component={TrainingDetailsScreen} options={{ title: 'Training details' }} />
      <ProfileStack.Screen name="Split" component={SplitScreen} options={{ title: 'Split' }} />
      <ProfileStack.Screen name="Memory" component={MemoryScreen} options={{ title: 'Memory' }} />
      <ProfileStack.Screen name="Playbook" component={PlaybookScreen} options={{ title: 'Playbook' }} />
      <ProfileStack.Screen name="CoachConnection" component={CoachConnectionScreen} options={{ title: 'Coach connection' }} />
      <ProfileStack.Screen name="GymDetail" component={GymDetailScreen} options={{ title: 'Gym' }} />
      <ProfileStack.Screen name="EquipmentEditor" component={EquipmentEditorScreen} options={{ title: 'Equipment' }} />
      <ProfileStack.Screen
        name="Restore"
        component={RestoreScreen}
        options={({ route }) => ({ title: route.params.mode === 'restore' ? 'Restore from a backup' : 'Check a backup' })}
      />
      <ProfileStack.Screen name="Export" component={ExportScreen} options={{ title: 'Export' }} />
      <ProfileStack.Screen name="DeleteMyData" component={DeleteMyDataScreen} options={{ title: 'Delete my data' }} />
      <ProfileStack.Screen name="ResetKnowledge" component={ResetKnowledgeScreen} options={{ title: 'Reset coaching knowledge' }} />
      <ProfileStack.Screen name="ImportIntro" component={ImportIntroScreen} options={{ title: 'Import from FitNotes' }} />
      <ProfileStack.Screen name="ImportPreview" component={ImportPreviewScreen} options={{ title: 'Import preview' }} />
      <ProfileStack.Screen name="ImportNames" component={ImportNamesScreen} options={{ title: 'Check exercise names' }} />
      <ProfileStack.Screen name="ImportChoose" component={ImportChooseScreen} options={({ route }) => ({ title: route.params.mode === 'new' ? 'Add new exercise' : 'Choose exercise' })} />
      <ProfileStack.Screen name="ImportQuestion" component={ImportQuestionScreen} options={({ route }) => ({ title: IMPORT_QUESTION_TITLES[route.params.question] })} />
      <ProfileStack.Screen name="ImportRows" component={ImportRowsScreen} options={{ title: 'Rows' }} />
      <ProfileStack.Screen name="ImportRun" component={ImportRunScreen} options={{ title: 'Import' }} />
      <ProfileStack.Screen name="ImportResults" component={ImportResultsScreen} options={{ title: 'Import results' }} />
      <ProfileStack.Screen name="ImportedWorkout" component={ImportedWorkoutScreen} options={{ title: 'Imported workout' }} />
      <ProfileStack.Screen name="PastImports" component={PastImportsScreen} options={{ title: 'Past imports' }} />
      <ProfileStack.Screen name="ImportHistory" component={ImportHistoryScreen} options={{ title: 'Import history' }} />
      <ProfileStack.Screen name="ImportNewLayout" component={ImportNewLayoutScreen} options={{ title: 'New file layout' }} />
      <ProfileStack.Screen name="ImportSent" component={ImportSentScreen} options={{ title: 'What’s sent', presentation: 'modal' }} />
      <ProfileStack.Screen name="ImportLayoutCheck" component={ImportLayoutCheckScreen} options={{ title: 'Check the layout' }} />
      <ProfileStack.Screen name="ImportLayoutRole" component={ImportLayoutRoleScreen} options={{ title: 'Column' }} />
      <ProfileStack.Screen name="ImportLayoutQuestion" component={ImportLayoutQuestionScreen} options={{ title: 'Question' }} />
      <ProfileStack.Screen name="ImportValueChecks" component={ImportValueChecksScreen} options={{ title: 'Values to check' }} />
      <ProfileStack.Screen name="SavedLayouts" component={SavedLayoutsScreen} options={{ title: 'Saved import layouts' }} />
      <ProfileStack.Screen name="SavedLayout" component={SavedLayoutScreen} options={{ title: 'Saved layout' }} />
      <ProfileStack.Screen name="Voice" component={VoiceSettingsScreen} options={{ title: 'Voice' }} />
      <ProfileStack.Screen name="Developer" component={DeveloperScreen} options={{ title: 'Developer' }} />
      <ProfileStack.Screen name="CapabilityProbe" component={ProbeRoute} options={{ headerShown: false }} />
      <ProfileStack.Screen name="ChatGptSignInTest" component={ChatGptSignInTestScreen} options={{ title: 'ChatGPT sign-in test' }} />
    </ProfileStack.Navigator>
  );
}

const IMPORT_QUESTION_TITLES: Record<ImportQuestionKind, string> = {
  per_hand: 'Dumbbell weights',
  total: 'Barbell weights',
  bodyweight: 'Bodyweight exercise',
  unit: 'Weight unit',
  effort: 'Effort ratings',
  dates: 'Dates already in GymSmarter',
  gym: 'Where were these workouts?',
};

const TAB_ICONS: Record<keyof TabParams, [SymbolName, SymbolName]> = {
  Today: ['sun.max', 'sun.max.fill'],
  Library: ['dumbbell', 'dumbbell.fill'],
  Progress: ['chart.bar', 'chart.bar.fill'],
  Profile: ['person.crop.circle', 'person.crop.circle.fill'],
};

function TabsNavigator() {
  const theme = useTheme();
  return (
    <TabNav.Navigator
      screenOptions={({ route }) =>
        theme.components.barOnCanvas
          ? {
              // D (D-Today mockup): text-only tracked caps on the canvas, a hairline above.
              // The selected tab is also Semibold, never colour alone.
              headerShown: false,
              tabBarActiveTintColor: theme.colors['text.primary'],
              tabBarInactiveTintColor: theme.colors['text.tertiary'],
              tabBarStyle: { backgroundColor: theme.colors['bg.canvas'], borderTopColor: theme.colors['border.divider'], borderTopWidth: theme.dividerWidth },
              tabBarIconStyle: { display: 'none' },
              tabBarIcon: () => null,
              tabBarItemStyle: { justifyContent: 'center' },
              tabBarLabel: ({ focused, color }) => (
                <AppText variant="label" maxFontSizeMultiplier={1.4} style={{ color, fontSize: 11, lineHeight: 14, letterSpacing: 1, textTransform: 'uppercase', fontWeight: focused ? '600' : '400' }}>
                  {route.name}
                </AppText>
              ),
            }
          : {
              headerShown: false,
              tabBarActiveTintColor: theme.colors.accent,
              tabBarInactiveTintColor: theme.colors['text.secondary'],
              tabBarStyle: { backgroundColor: theme.colors['bg.surface'], borderTopColor: theme.colors['border.divider'], borderTopWidth: theme.dividerWidth },
              // The selected tab also changes shape (filled symbol), never colour alone.
              tabBarIcon: ({ focused, color, size }) => <SymbolView name={TAB_ICONS[route.name][focused ? 1 : 0]} tintColor={color} size={size} accessible={false} />,
            }
      }
    >
      <TabNav.Screen name="Today" component={TodayScreen} />
      <TabNav.Screen name="Library" component={LibraryNavigator} />
      <TabNav.Screen name="Progress" component={ProgressNavigator} />
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
  // Crash capture records which screen an error happened on (route name only).
  const navRef = useNavigationContainerRef<RootStackParams>();
  const reportScreen = () => {
    setCurrentScreen(navRef.getCurrentRoute()?.name ?? null);
  };
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
      <NavigationContainer ref={navRef} theme={navTheme} initialState={initialState} onReady={reportScreen} onStateChange={reportScreen}>
        <RootStack.Navigator screenOptions={{ ...options, headerShown: false }}>
          {setupDone ? (
            <>
              <RootStack.Screen name="Tabs" component={TabsNavigator} />
              {/* Slides up; a fade under Reduce Motion (premium-feel §4.2). */}
              <RootStack.Screen name="Workout" component={WorkoutScreen} options={{ presentation: 'fullScreenModal', gestureEnabled: false, ...screenAnimation('Workout', theme.a11y.reduceMotion) }} />
              {/* The page before the first set (workout-overview.md): slides up like Workout; a fade under Reduce Motion. */}
              <RootStack.Screen
                name="WorkoutOverview"
                component={WorkoutOverviewScreen}
                options={{ presentation: 'fullScreenModal', ...screenAnimation('Workout', theme.a11y.reduceMotion) }}
              />
              {/* Swipe-down = "not now": back to where Ben was, nothing started (check-in.md CI3). */}
              <RootStack.Screen
                name="CheckIn"
                component={CheckInScreen}
                options={{ presentation: 'modal', contentStyle: { backgroundColor: theme.colors['bg.surface'] } }}
              />
              <RootStack.Screen name="ExercisePicker" component={ExercisePickerScreen} options={{ presentation: 'modal' }} />
              <RootStack.Screen name="HowTo" getComponent={loadHowToScreen} options={{ presentation: 'modal' }} />
              <RootStack.Screen
                name="EditSet"
                component={EditSetScreen}
                options={{ presentation: 'modal', contentStyle: { backgroundColor: theme.colors['bg.surface'] } }}
              />
              {/* Medium detent; the workout keeps running underneath (active-workout §2.14.4). */}
              <RootStack.Screen
                name="PainFlag"
                component={PainFlagSheet}
                options={{ presentation: 'formSheet', sheetAllowedDetents: [0.55, 1.0], sheetGrabberVisible: true, contentStyle: { backgroundColor: theme.colors['bg.surface'] } }}
              />
              {/* No back navigation into a finished workout; corrections go through Edit (workout-summary §2). */}
              {/* Workout → Summary replaces with a 200 ms fade (motion.screenFade). */}
              <RootStack.Screen name="Summary" component={SummaryScreen} options={{ presentation: 'fullScreenModal', gestureEnabled: false, ...screenAnimation('Summary', theme.a11y.reduceMotion) }} />
              <RootStack.Screen name="AddGym" component={AddGymScreen} options={{ presentation: 'modal' }} />
              <RootStack.Screen name="PastWorkouts" component={PastWorkoutsScreen} options={{ headerShown: true, title: 'Past workouts' }} />
              <RootStack.Screen name="RecentlyDeleted" component={RecentlyDeletedScreen} options={{ headerShown: true, title: 'Recently deleted' }} />
              <RootStack.Screen name="Repeat" component={RepeatScreen} options={{ headerShown: true, title: 'Repeat' }} />
              {/* The Workouts library (routines.md §A2.1); its editor is a sheet over the list or the overview (Cancel / Save). */}
              <RootStack.Screen
                name="WorkoutEditor"
                component={WorkoutEditorScreen}
                options={{ presentation: 'modal', gestureEnabled: false, contentStyle: { backgroundColor: theme.colors['bg.canvas'] }, ...screenAnimation('Workout', theme.a11y.reduceMotion) }}
              />
              {/* A side door, not a step: swipe down closes it and nothing in the workout waits for it (coach-sheet §1). */}
              {/* Exercise detail over a past workout's Summary or the Workout overview (`History`); swipe down or Done closes it. */}
              <RootStack.Screen name="ExerciseProgress" component={ExerciseDetailScreen} options={({ route }) => ({ presentation: 'modal', headerShown: true, title: route.params.name ?? '' })} />
              {/* The editor's `⋯` → `Exercise info` (read-only): over the editor; swipe down or back closes it. */}
              <RootStack.Screen name="ExerciseInfo" component={ExerciseInfoScreen} options={({ route }) => ({ presentation: 'modal', headerShown: true, title: route.params.name ?? '' })} />
              <RootStack.Screen name="Coach" component={CoachSheetScreen} options={{ presentation: 'modal', contentStyle: { backgroundColor: theme.colors['bg.canvas'] } }} />
            </>
          ) : (
            <>
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
              {/* Restore before setup (onboarding OB3); Done relaunches, and restored data with a profile skips setup. */}
              <RootStack.Screen name="WelcomeRestore" options={{ headerShown: true, title: 'Restore from a backup' }}>
                {() => <RestoreScreen mode="restore" fromWelcome />}
              </RootStack.Screen>
            </>
          )}
        </RootStack.Navigator>
      </NavigationContainer>
    </View>
  );
}
