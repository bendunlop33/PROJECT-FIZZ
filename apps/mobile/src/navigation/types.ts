import type { NavigatorScreenParams } from '@react-navigation/native';

export type ProfileStackParams = {
  ProfileHome: undefined;
  DataBackup: undefined;
  AppStatus: undefined;
  Developer: undefined;
  CapabilityProbe: undefined;
  /** Spike S1 (Developer). */
  ChatGptSignInTest: undefined;
};

export type TabParams = {
  /** `toast`: a one-off message after returning from the check-in (e.g. Skip workout). */
  Today: { toast?: string } | undefined;
  Progress: undefined;
  Profile: NavigatorScreenParams<ProfileStackParams> | undefined;
};

export type RootStackParams = {
  Setup: undefined;
  Tabs: NavigatorScreenParams<TabParams> | undefined;
  /** Active workout (set, rest). `toast` after a start with a check-in (check-in.md §2.6). */
  Workout: { toast?: WorkoutToastParam } | undefined;
  /** Pre-workout check-in sheet: before a start, or editing a saved one. */
  CheckIn: { mode: 'start'; gymId: string } | { mode: 'edit'; checkInId: string };
  ExercisePicker: { sessionId: string };
  EditSet: { sessionId: string; setId: string };
  Summary: { sessionId: string };
  AddGym: undefined;
};

export type WorkoutToastParam =
  | { kind: 'check_in'; text: string; checkInId: string }
  | { kind: 'pain'; text: string; flagIds: string[] }
  | { kind: 'info'; text: string };

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace ReactNavigation {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface RootParamList extends RootStackParams {}
  }
}
