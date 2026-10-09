import type { NavigatorScreenParams } from '@react-navigation/native';
import type { EquipmentKind } from '@fizz/schemas';

export type ProfileStackParams = {
  ProfileHome: undefined;
  DataBackup: undefined;
  AppStatus: undefined;
  Developer: undefined;
  CapabilityProbe: undefined;
  PainFlags: undefined;
  /** Restore from a backup, or Check a backup (data-import-export §2.3–2.4). */
  Restore: { mode: 'restore' | 'check' };
  GymDetail: { gymId: string };
  /** `equipmentId` is chosen once per visit (a new item's ID too), so Save is idempotent. */
  EquipmentEditor: { gymId: string; equipmentId: string; kind: EquipmentKind; isNew: boolean };
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
  /** Welcome › Restore from a backup, before any setup (onboarding OB3, check 10). */
  WelcomeRestore: undefined;
  Tabs: NavigatorScreenParams<TabParams> | undefined;
  /** Active workout (set, rest). `toast` after a start with a check-in (check-in.md §2.6). */
  Workout: { toast?: WorkoutToastParam } | undefined;
  /** Pre-workout check-in sheet: before a start, or editing a saved one. */
  /** `repeatOf`: start by repeating that finished workout (routines.md RT4). */
  CheckIn: { mode: 'start'; gymId: string; repeatOf?: string } | { mode: 'edit'; checkInId: string };
  ExercisePicker: { sessionId: string };
  EditSet: { sessionId: string; setId: string };
  Summary: { sessionId: string };
  AddGym: undefined;
  /** `Start from a past workout` list. */
  PastWorkouts: undefined;
  /** Repeat a finished workout (routines.md §2.4). */
  Repeat: { sessionId: string };
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
