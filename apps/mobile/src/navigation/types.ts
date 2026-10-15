import type { NavigatorScreenParams } from '@react-navigation/native';
import type { EquipmentKind, RoutineExercise, SetExclusion } from '@fizz/schemas';

import type { CoachEntry } from '../coach/coach-service';

export type ProfileStackParams = {
  ProfileHome: undefined;
  DataBackup: undefined;
  AppStatus: undefined;
  Developer: undefined;
  CapabilityProbe: undefined;
  PainFlags: undefined;
  /** Profile › Training details (Ben 13 Oct: D5, D8). */
  TrainingDetails: undefined;
  /** Profile › Split and main lifts (D7, F19). */
  Split: undefined;
  /** Profile → Coach → Memory (coach-memory §2.1). */
  Memory: undefined;
  /** Profile → Coach → Playbook: chat rules to review (coaching-playbook §2.1). */
  Playbook: undefined;
  /** Restore from a backup, or Check a backup (data-import-export §2.3–2.4). */
  Restore: { mode: 'restore' | 'check' };
  /** Export, Delete my data, Reset coaching knowledge (data-import-export §2.6, §2.7). */
  Export: undefined;
  DeleteMyData: undefined;
  ResetKnowledge: undefined;
  GymDetail: { gymId: string };
  /** `equipmentId` is chosen once per visit (a new item's ID too), so Save is idempotent. */
  EquipmentEditor: { gymId: string; equipmentId: string; kind: EquipmentKind; isNew: boolean };
  /** Spike S1 (Developer). */
  ChatGptSignInTest: undefined;
  /** Profile → Coach connection (ai-connection.md, ADR 0020 C5). */
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
  /** Import from any app (data-import-export §9.2.1): what reads offline, what needs the coach, `Choose file`. */
  ImportHistory: undefined;
  /** New file layout: consent, Needs the coach, Reading the layout and its results (§9.2.2, §9.2.4). */
  ImportNewLayout: { layoutId: string };
  /** What's sent (§9.2.3): the literal request text and the column switches. */
  ImportSent: { layoutId: string };
  /** Check the layout, or Changed columns (§9.2.5, §9.2.7). */
  ImportLayoutCheck: { layoutId: string; /** The role sheet's `"Reps" → Not imported`, shown once as a toast with [Undo]. */ moved?: string };
  /** The column role sheet (§9.2.5). */
  ImportLayoutRole: { layoutId: string; column: number };
  /** One layout question (§9.2.5): what the file is, unit, date order, a notation, a marker, a new column. */
  ImportLayoutQuestion: { layoutId: string; kind: 'record_kind' | 'unit' | 'date_order' | 'notation' | 'marker' | 'new_column'; column?: number; token?: string };
  /** Values to check on the preview (§9.2.6, AI13). */
  ImportValueChecks: { draftId: string };
  /** Saved import layouts (§9.2.9). */
  SavedLayouts: undefined;
  SavedLayout: { id: string };
};

/** The Progress tab's stack (progress.md §2.1, slice A). */
export type ProgressStackParams = {
  ProgressHome: undefined;
  /** `group`: the row to open expanded (a body-part group such as `Chest`, or `push` / `pull` / `legs` / `core` / `other`). */
  ProgressMuscles: { group?: string };
  /** Exercise detail inside the Progress tab (slice B, §2.7). */
  ProgressExercise: ExerciseDetailParams;
  /** `Exercise info ›` on Progress exercise detail (exercise-library §9.7): the Library's Exercise detail, in this stack. */
  ProgressExerciseInfo: ExerciseInfoParams;
};

/** The Library tab's stack (exercise-library §9, EL10). */
export type LibraryStackParams = {
  /** `segment`: open on it (the picker's `Edit workouts`); `toast`: back from the editor (`Saved Push A` [Undo]). */
  LibraryHome: { segment?: LibrarySegment; toast?: LibraryToastParam } | undefined;
  LibraryExercise: ExerciseInfoParams;
};

export type LibrarySegment = 'exercises' | 'workouts';

/** Exercise detail (exercise-library §9.4). `readOnly`: opened from the editor's `⋯`; `Add to a workout` is hidden. */
export interface ExerciseInfoParams {
  exerciseId: string;
  /** Shown in the header while loading. */
  name?: string;
  readOnly?: boolean;
}

/**
 * Exercise detail (progress.md §2.7). `sessionId`: open on the series with
 * that workout and select its point (a home record, a past workout's
 * Summary). `equipmentId`: prefer that equipment's series (Workout overview).
 */
export interface ExerciseDetailParams {
  exerciseId: string;
  sessionId?: string;
  /** With `sessionId`: the Summary row tapped. */
  sessionExerciseId?: string;
  equipmentId?: string;
  /** Else a series at this gym (Workout overview `History`). */
  gymId?: string;
  /** Shown in the header while loading. */
  name?: string;
}

export type ImportQuestionKind = 'per_hand' | 'total' | 'bodyweight' | 'unit' | 'effort' | 'dates' | 'gym';
export type ImportSkipKey = 'cardio' | 'unsupported' | 'unreadable' | 'date_exists' | 'duplicate' | 'exercise' | 'not_a_set' | 'value_to_check';

export type TabParams = {
  /**
   * `toast`: a one-off message after returning from the check-in (e.g. Skip workout).
   * `undoRoutine`: the toast offers Undo for a routine deleted from the Workout overview.
   */
  /** `startEmpty`: `Empty workout` on the Workouts list, once per nonce (Today's own start, with its check-in gate). */
  /** `undoDraft`: a coach draft discarded from its overview (workout-builder §6.2): the toast's Undo restores it. */
  Today: { toast?: string; undoRoutine?: { id: string; version: number }; undoDraft?: { id: string; version: number }; startEmpty?: string } | undefined;
  Library: NavigatorScreenParams<LibraryStackParams> | undefined;
  Progress: NavigatorScreenParams<ProgressStackParams> | undefined;
  Profile: NavigatorScreenParams<ProfileStackParams> | undefined;
};

export type RootStackParams = {
  Setup: undefined;
  /** Welcome › Restore from a backup, before any setup (onboarding OB3, check 10). */
  WelcomeRestore: undefined;
  Tabs: NavigatorScreenParams<TabParams> | undefined;
  /** Active workout (set, rest). `toast` after a start with a check-in (check-in.md §2.6). */
  /** `checkGym`: open the gym card for that gym (`[Use changes today]`, gym-editor §4.9); `nonce` makes it one-off. */
  /** `corrected`: a logged set's numbers were corrected; the coach offer check runs on it again (build 108 F4). */
  Workout: { toast?: WorkoutToastParam; checkGym?: { gymId: string; nonce: string }; corrected?: { setId: string; key: string } } | undefined;
  /** Pre-workout check-in sheet: before a start, or editing a saved one. */
  /**
   * `repeatOf`: start by repeating that finished workout (routines.md RT4). `nextOf`: its next session, with next targets (audit B2).
   * `routineOf`: start that routine with next targets (premium-feel §2.6).
   */
  CheckIn:
    | { mode: 'start'; gymId: string; repeatOf?: string; nextOf?: string; routineOf?: string }
    | { mode: 'edit'; checkInId: string }
    /**
     * Over the Workout overview (workout-overview §2.2): `What's up?` for a
     * score already saved there (`checkInId`), or the whole check-in from the
     * score at AX sizes (null). Every exit returns to the overview; nothing starts.
     */
    | { mode: 'overview'; checkInId: string | null; atScore?: boolean };
  /**
   * The one page before the first set (workout-overview.md): Up next, or a
   * routine from the list. Creates nothing until Start.
   */
  /** Up next, a routine, or a session type picked from its history (session-picker §7). */
  WorkoutOverview: { target: { kind: 'next' } | { kind: 'routine'; routineId: string } | { kind: 'session'; sourceSessionId: string } | { kind: 'coach_draft'; draftId: string }; toast?: LibraryToastParam };
  /**
   * The workout editor (§A2.3): a stored workout, or `New workout` (null).
   * `from`: where `Save` returns with its toast. `selectName`: a fresh copy
   * from `Duplicate` (the name is selected). `copyToast`: that copy's
   * `Saved Push A copy` [Undo] toast, handed back on `Cancel` (review S1).
   */
  /**
   * `from: 'Library'`: Library › Workouts; `'ExerciseInfo'`: `Add to a
   * workout` → `New workout` on Exercise detail (Save goes back there).
   * `draft`: a new workout's starting exercises (that exercise with the
   * sheet's shape); nothing is saved until `Save`.
   * `saveAs`: the Save sheet's `Edit ›` (routines.md §A2.5, WL-A18): `draft`
   * is the unsaved copy and `Save` creates the workout with the sheet's opId
   * (`save-edit-handoff.ts` holds the request and takes the result back).
   */
  WorkoutEditor: { routineId: string | null; from: EditorFrom; selectName?: boolean; copyToast?: LibraryToastParam; draft?: { name: string; exercises: RoutineExercise[] }; saveAs?: string };
  /** Exercise detail over the workout editor (`⋯` → `Exercise info`), read-only. */
  ExerciseInfo: ExerciseInfoParams;
  ExercisePicker: { sessionId: string };
  /** How to (ADR 0013): guide, cues and mistakes for a catalogue exercise. Opened only when it has a how-to. */
  HowTo: { catalogueKey: string; name: string };
  EditSet: { sessionId: string; setId: string };
  /** `back`: opened from history (Progress), so Done goes back there rather than to Today. */
  /** `justFinished`: reached by Finish itself; any other visit (Today, Progress) is static. */
  /** `editTimes`: open straight into the time correction and go back when it closes (Progress `Edit times`, progress.md §2.3). */
  Summary: { sessionId: string; back?: boolean; justFinished?: boolean; editTimes?: boolean };
  /**
   * Pain flag sheet (active-workout §2.14.4). From a set card, the workout
   * exercise makes `Before` / `Since` use its equipment.
   */
  PainFlag: { flagId: string; sessionId?: string; sessionExerciseId?: string };
  AddGym: undefined;
  /** `Start from a past workout` list. */
  PastWorkouts: undefined;
  /** Recently deleted (delete-workouts §2.5): from Past workouts' footer and Data & backup. */
  RecentlyDeleted: undefined;
  /** Repeat a finished workout (routines.md §2.4). */
  Repeat: { sessionId: string };
  /**
   * The coach sheet (coach-sheet.md, ADR 0020 C6). Opened only by Ben (Ask,
   * workout `⋯` → Ask the coach, Adjust → Type…, Summary → Ask about this
   * workout); never by a trigger, timer or reply. `focus`: the field gets focus.
   */
  /** `build`: open with the Build card (workout-builder §3, `Build with coach`). */
  Coach: { entry: CoachEntry; focus?: boolean; build?: boolean };
  /** Exercise detail over a past workout's Summary or the Workout overview (`History`). */
  ExerciseProgress: ExerciseDetailParams;
};

/**
 * Where the workout editor returns to. `SaveSheet`: the Save sheet's `Edit ›`
 * (routines.md §A2.5): back to the screen under the sheet, which shows the result.
 */
export type EditorFrom = 'WorkoutOverview' | 'Library' | 'ExerciseInfo' | 'SaveSheet';

/** A library toast handed back to the screen below (`key`: shown once). */
export interface LibraryToastParam {
  key: string;
  text: string;
  /** `revert`: an editor save's Undo record; `delete`: Undo of a new workout (a tombstone). */
  undo: { kind: 'revert'; actionId: string } | { kind: 'delete'; routineId: string; version: number } | null;
}

export type WorkoutToastParam =
  | { kind: 'check_in'; text: string; checkInId: string }
  /** `Pain noted` [Undo]: the flags just set, at the version that set them; Undo retracts them (review B2). */
  | { kind: 'pain'; text: string; flags: { id: string; version: number }[] }
  | { kind: 'info'; text: string }
  /**
   * Back from the correction sheet after the exclusion chips changed
   * (active-workout §2.13): `Set 2: spotted · not counted for records`
   * [Undo]. `key` is the save's opId, so each save shows once.
   */
  | {
      kind: 'exclusion';
      key: string;
      text: string;
      undo: { sessionId: string; setId: string; setVersion: number; previous: SetExclusion[]; painFlags: { id: string; version: number }[] };
    }
  /**
   * Back from the correction sheet after `Delete set` or a value change
   * (copy D4): `Set 2 deleted` [Undo] → `undo_op` on `targetOpId`, which is
   * also the key, so each shows once.
   */
  | { kind: 'undo_op'; text: string; targetOpId: string };

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace ReactNavigation {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface RootParamList extends RootStackParams {}
  }
}
