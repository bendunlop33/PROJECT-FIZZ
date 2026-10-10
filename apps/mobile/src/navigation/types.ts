import type { NavigatorScreenParams } from '@react-navigation/native';
import type { EquipmentKind } from '@fizz/schemas';

import type { CoachEntry } from '../coach/coach-service';

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
  /** Profile → Coach connection (ai-connection.md, ADR 0019 C5). */
  CoachConnection: undefined;
  /** FitNotes import (data-import-export §2.5): intro, file pick and file errors. */
  ImportIntro: undefined;
  /** The preview (§2.5 step 3). The draft lives in the import service until commit. */
  ImportPreview: { draftId: string };
  /** Check exercise names (§2.5 step 3a). */
  ImportNames: { draftId: string };
  /** `Choose…` an exercise, or `Add new` (equipment type) for one source name. */
  ImportChoose: { draftId: string; key: string; name: string; mode: 'choose' | 'new' };
  /** One question screen (§2.5 steps 3b–3c). */
  ImportQuestion: { draftId: string; question: ImportQuestionKind; key?: string };
  /** One preview workout (§2.5 step 3d) or one `Will be skipped` list. */
  ImportRows: { draftId: string; date?: string; skip?: ImportSkipKey };
  /** Confirm, back up, import (§2.5 step 4), or continue a paused import. */
  ImportRun: { draftId: string; mappingVersion: number; workouts: number } | { jobId: string };
  /** Results of one import, with Undo (§2.5 step 5). */
  ImportResults: { jobId: string };
  /** One imported workout's sets, each with its source file, row and original values (check 24). */
  ImportedWorkout: { jobId: string; date: string };
  PastImports: undefined;
};

export type ImportQuestionKind = 'per_hand' | 'total' | 'bodyweight' | 'unit' | 'effort' | 'dates' | 'gym';
export type ImportSkipKey = 'cardio' | 'unsupported' | 'unreadable' | 'date_exists' | 'duplicate' | 'exercise';

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
  /**
   * `repeatOf`: start by repeating that finished workout (routines.md RT4). `nextOf`: its next session, with next targets (audit B2).
   * `routineOf`: start that routine with next targets (premium-feel §2.6).
   */
  CheckIn: { mode: 'start'; gymId: string; repeatOf?: string; nextOf?: string; routineOf?: string } | { mode: 'edit'; checkInId: string };
  ExercisePicker: { sessionId: string };
  /** How to (ADR 0013): guide, cues and mistakes for a catalogue exercise. Opened only when it has a how-to. */
  HowTo: { catalogueKey: string; name: string };
  EditSet: { sessionId: string; setId: string };
  /** `back`: opened from history (Progress), so Done goes back there rather than to Today. */
  /** `justFinished`: reached by Finish itself; any other visit (Today, Progress) is static. */
  Summary: { sessionId: string; back?: boolean; justFinished?: boolean };
  AddGym: undefined;
  /** `Start from a past workout` list. */
  PastWorkouts: undefined;
  /** Repeat a finished workout (routines.md §2.4). */
  Repeat: { sessionId: string };
  /**
   * The coach sheet (coach-sheet.md, ADR 0019 C6). Opened only by Ben (Ask,
   * workout `⋯` → Ask the coach, Adjust → Type…, Summary → Ask about this
   * workout); never by a trigger, timer or reply. `focus`: the field gets focus.
   */
  Coach: { entry: CoachEntry; focus?: boolean };
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
