import type { BuilderOpenTarget } from '../builder/builder-service';
import type { NavigatorScreenParams } from '@react-navigation/native';
import type { CustomExerciseFields, EquipmentKind, RoutineExercise, SetExclusion } from '@fizz/schemas';

import type { CoachEntry } from '../coach/coach-service';
import type { BuilderCoachEntry } from '../coach/builder-sheet-view';

export type ProfileStackParams = {
  ProfileHome: undefined;
  DataBackup: undefined;
  AppStatus: undefined;
  Developer: undefined;
  /** Profile › Voice: spoken cues, coach replies read aloud, voice, speed (Ben, 19 Oct 2026). */
  Voice: undefined;
  /** Profile › Morning reminder: what to train today, at a set time (Ben, 20 Oct 2026). */
  MorningReminder: undefined;
  /** (Ben, 27 Oct; ADR 0035) Profile › Apple Health. */
  AppleHealth: undefined;
  CapabilityProbe: undefined;
  PainFlags: undefined;
  /** Profile › Training details (Ben 13 Oct: D5, D8). */
  TrainingDetails: undefined;
  /** Profile › Split and main lifts (D7, F19). */
  Split: undefined;
  /** Profile › Training › Check-in (Ben, 26 Oct; check-in.md §2.8): when Start asks. */
  CheckInSettings: undefined;
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
  /** `focus: 'reviews'` (Today's Reviews link): scroll to the top, where Reviews are; `n` makes a repeat tap do it again. */
  ProgressHome: { focus?: 'reviews'; n?: number } | undefined;
  /** `group`: the row to open expanded (a body-part group such as `Chest`, or `push` / `pull` / `legs` / `core` / `other`). */
  ProgressMuscles: { group?: string };
  /** Exercise detail inside the Progress tab (slice B, §2.7). */
  ProgressExercise: ExerciseDetailParams;
  /** `Exercise info ›` on Progress exercise detail (exercise-library §9.7): the Library's Exercise detail, in this stack. */
  ProgressExerciseInfo: ExerciseInfoParams;
  /** (Workout builder v3 §6.2) Progress › Reviews › a past week's review in full. */
  ProgressReview: { reviewId: string };
  /** (Progress v3) Coach's changes › `Past weeks ›`: earlier weekly reviews, newest first. */
  ProgressPastWeeks: undefined;
};

/** The Library tab's stack (exercise-library §9, EL10). */
export type LibraryStackParams = {
  /** `segment`: open on it (the picker's `Edit workouts`); `toast`: back from the editor (`Saved Push A` [Undo]). */
  /** `plan`: Today's `Day 2 of 4 ›` (a nonce): Workouts, scrolled to the top where Your plan is (Ben, 19 Oct). */
  LibraryHome: { segment?: LibrarySegment; toast?: LibraryToastParam; plan?: string } | undefined;
  LibraryExercise: ExerciseInfoParams;
  /** Your plan › a day (Ben, 19 Oct): what Start plans here and last time's sets; Start, Edit, Ask coach. */
  LibraryPlanDay: { routineId: string; name?: string };
};

/** (Ben, 22 Oct) Library tabs `Plan | Workouts | Exercises`. */
export type LibrarySegment = 'plan' | 'workouts' | 'exercises';

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
  /** `toast`: a one-off message after returning from the check-in (e.g. Skip workout), or Your workout's Start with a workout in progress. */
  /** `startEmpty`: `Empty workout` on the Workouts list, once per nonce (Today's own start, with its check-in gate). */
  /** `planApplied`: back from the plan builder's Apply: `Plan applied · Undo` once per `key` (Undo at that plan version, rule 5). */
  Today: { toast?: string; startEmpty?: string; planApplied?: PlanAppliedToastParam } | undefined;
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
  /** `checkedIn` (Ben, 23 Oct): back from the workout's own `How are you feeling?`; `key` makes its toast one-off. */
  Workout: { toast?: WorkoutToastParam; checkGym?: { gymId: string; nonce: string }; corrected?: { setId: string; key: string }; checkedIn?: { key: string; toast: WorkoutToastParam } } | undefined;
  /** Pre-workout check-in sheet: before a start, or editing a saved one. */
  /**
   * `repeatOf`: start by repeating that finished workout (routines.md RT4). `nextOf`: its next session, with next targets (audit B2).
   * `routineOf`: start that routine with next targets (premium-feel §2.6).
   */
  CheckIn:
    | { mode: 'start'; gymId: string; repeatOf?: string; nextOf?: string; routineOf?: string; /** (Today v2) Today's session card: the builder draft it committed. */ coachDraftOf?: string; /** That draft's version as committed: pinned in the Start's write (rule 5). */ coachDraftVersion?: number }
    | { mode: 'edit'; checkInId: string }
    /** (Ben, 23 Oct) `How are you feeling?` in the workout, before its first working set: saved and linked to it; every exit returns to it. */
    | { mode: 'workout'; sessionId: string }
    /**
     * Over Your workout (its check-in before Start; first made for the Workout overview, retired 22 Oct):
     * `What's up?` for a score already saved there (`checkInId`), or the whole check-in from the score at AX
     * sizes (null). Every exit returns to the page; nothing starts.
     */
    | { mode: 'overview'; checkInId: string | null; atScore?: boolean };
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
  /**
   * (19 Oct) Ben's own exercise: `＋ New exercise` (`name`: the search text), Edit (`exerciseId`), or
   * the coach card's Edit (`proposalActionId` with the card's `fields`: Save is Add).
   */
  ExerciseForm: { exerciseId?: string; name?: string; proposalActionId?: string; fields?: CustomExerciseFields; /** (Ben, 25 Oct) The Swap / Add sheet's token: a Save hands the new exercise back to it. */ pickFor?: string };
  /** `supersetWith` (19 Oct, `Superset with…`): the row the pick pairs with (an exercise already here is linked; any other is added). */
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
  /** `draft`: the field starts with this text when it's empty (Your plan's `Ask coach to change`: `Change my plan: `); nothing is sent. */
  /** (Ben, 26 Oct) `builder`: Your workout's bar; words go to the builder's `askEdit`, proposals come back as cards (Apply / Skip). */
  Coach: { entry: CoachEntry | BuilderCoachEntry; focus?: boolean; build?: boolean; draft?: string };
  /** Exercise detail over a past workout's Summary or the Workout overview (`History`). */
  ExerciseProgress: ExerciseDetailParams;
  /**
   * The workout builder's first page (workout-builder-v3 §2.2). `dayId`: Today's `Build your own`
   * (Day = the card's day). `draftId`: `‹ Set up` from Your workout (its changes merge into that draft).
   */
  BuilderSetup: { dayId?: string; draftId?: string } | undefined;
  /**
   * Your workout (§2.3): one builder draft. `toast`: a write's toast handed back from Set up (`Rebuilt · Undo`).
   * (22 Oct, Ben: the Workout overview is retired) `open`: what to open when there is no draft yet (a workout,
   * a past workout to do again, a coach chat draft, Up next); the page opens today's draft for it. `back`: the
   * page it came from (`‹ Today`, `‹ Library`), shown instead of `‹ Set up` (§2.3, design review V1).
   */
  BuilderWorkout: { draftId?: string; open?: BuilderOpenTarget; back?: BuilderBack; toast?: BuilderToastParam };
  /**
   * (Plan builder, 23 Oct) Gym goals → Your week → Your plan (Check your lifts first when needed), offline. Opened from
   * Today's `Set up a plan ›` and Library › Plan's `Set up a plan` (`openPlanSetup`). An open plan built before (not
   * applied) opens on Your plan. `fromPlanId` (Ben, 23 Oct: plan length = block 1): `Block done · Start next block ›`
   * on Your plan, the builder starting from that plan's answers.
   */
  /** `fromPlanId`: Start next block (a new plan from that block's answers). `editPlanId`: Edit plan (opens on Your plan). */
  PlanSetup: { fromPlanId?: string; editPlanId?: string } | undefined;
};

/** Your workout's back control when it wasn't opened from Set up: `‹ Today`, `‹ Library`, `‹ Summary`, else `‹ Back`. */
export type BuilderBack = 'Today' | 'Library' | 'Summary' | 'Back';

/** A builder toast handed between the builder's pages (`key`: shown once). */
export interface BuilderToastParam {
  key: string;
  text: string;
  undoOpId: string | null;
  why: string | null;
}

/**
 * Where the workout editor returns to. `SaveSheet`: the Save sheet's `Edit ›`
 * (routines.md §A2.5): back to the screen under the sheet, which shows the result.
 * `PlanDay` (Ben, 23 Oct: one editor): back to Library › Plan › that day, with
 * the `Saved Push A` [Undo] toast handed off in memory (`library-toast.ts`).
 */
export type EditorFrom = 'Library' | 'ExerciseInfo' | 'SaveSheet' | 'PlanDay';

/** `Plan applied · Undo` on Today (plan-builder §3): Undo of that Apply, only while the plan is still at `version`. */
export interface PlanAppliedToastParam {
  key: string;
  planId: string;
  version: number;
}

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
