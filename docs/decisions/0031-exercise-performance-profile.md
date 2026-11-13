# 0031: One exercise performance profile feeds every target

**Status:** PROPOSED by the training researcher on 21 Oct 2026, revised the same day after review (CHANGES NEEDED; see "Review log"). For PM and developer review. Nothing is built. The behaviour rules it implements are the candidates HT1–HT19 in [history-targets.md](../training-guides/history-targets.md), which need Ben's approval first (approval order: conflict 13 there). The structure (one pure reader, one checker, a basis on every set) is useful even before then. Renumber on merge if another branch took 0031. File references are to branch `claude/builder-loads-21oct`.

Relates to:
- ADR 0006: coach-led progression, the built-in rule and amendment 2 (D21).
- ADR 0022 / 0025: pre-start and coach drafts.
- Playbook rule 7 and D7 (heavy and light days progress from their own history; approved as default 9 Oct). HT1 changes the wording of both; Ben must approve that explicitly.

## Context

Ben, 21 Oct 2026: "how are you going to ensure to properly use history to guide workout weights etc when building?" His refinement: "last session should be starting point subject to type of session, if it's main lift etc like a coach would do."

Three read-only audits of `claude/builder-loads-21oct` (HEAD `9ce15c2`) found:

- **Seven history readers**: `comparableSessions` in `progression.ts` and in `substitutes.ts`, `loadReferences` in `builder-loads.ts`, `lastComparableSession` in `active-view.ts`, `ruleBasis`/`referenceLoad` in `target-provenance.ts`, lift-target / weekly e1RM, and `nextSessionBases`; plus `lastTopText`, `typicalReps`, `today-session.ts` `lastOf` and `persistence/sessions.ts` `listFinishedWithExercise`. They differ in equipment matching, window (all history, 3 sessions in 180 days, 90 days, 16 weeks), set types (working only vs pooled top + back-off + working + drop) and e1RM formula (RIR-adjusted Epley ≤ 12, plain Epley ≤ 10, same-effort Epley).
- **About 25 places decide or show a pending weight, reps, set count, RPE or warm-up**, with at least four definitions of "last time". One plan day can show different loads on Today, in the plan preview and at Start. Summary uses `prescribed` set counts while Start uses `done`.
- **Not recorded:** set role, session type, planned target reps/RPE/sets, plan week or deload, aliases at read time. The existing `TargetBasisSchema` (`packages/schemas/src/session.ts:171–200`) records the reference session and sets but not how the target was derived.
- **Coach numbers are checked against history in one route only** (`checkProposedLoad`). Next-session targets, `edit_today`, `add_exercise_today` loads, the builder's coach target and `mixPick` (`refs: () => null`) have no history bound.
- **Rule 9 risks:** the builder's coach target skips D21's pain and stale checks; with a pain flag and no history, the builder still plans coach, plan or e1RM loads.

## Decision (proposed)

### 1. One pure profile per exercise, in `packages/domain/src/profile/`

```ts
type SetRole = 'top' | 'backoff' | 'working' | 'unknown';   // 'unknown' derived at read time; warmup/drop never enter
type SlotRole = 'main' | 'secondary' | 'accessory' | 'unknown';

interface ExposureSet {
  setId: string; version: number; role: SetRole; side: SetSide | null;      // L/R count as one set (HT19)
  load: Load;                       // value + unit + LoadConvention, converted; original kept as provenance
  values: { reps?: number; durationS?: number; distanceM?: number };       // mirrors SetValuesSchema
  rpe: number | null; rir: number | null;
  planned: { reps: RepRange | null; durationS?: number; distanceM?: number; rpe: number | null } | null; // null = legacy/import
}

interface Exposure {                // one exercise block in one finished session; never written back
  sessionId: string; atUtc: string; tz: string;
  exerciseId: string;               // resolved identity (aliases, imports, same-movement IDs listed separately)
  equipmentClass: EquipmentClassKey;// imports: catalogue default kit (HT2); machine imports flagged estOnly
  estOnly: boolean;
  slotRole: SlotRole; dayTag: 'heavy' | 'volume' | null;
  plannedSets: { top: number; backoff: number; working: number } | null;
  partial: boolean;                 // fit-to-time, ended early, skipped sets → not a set-count reference (HT10)
  deload: boolean;                  // recorded at logging for new sessions; never inferred for old ones
  painHeld: boolean;                // DERIVED at read time from flag timestamps (HT13)
  source: 'app' | 'import';
}

interface ExerciseProfile {         // per exercise + equipment class; only facts that don't depend on the slot
  exerciseId: string; equipmentClass: EquipmentClassKey; unit: Unit; convention: LoadConvention;
  exposures: Exposure[];            // newest first, HT13 exclusions applied
  gap: { days: number | null; usualSpacingDays: number | null; returning: boolean }; // R1, any role/zone (HT5)
  pain: { active: boolean; movementIds: string[]; mostRecent: Exposure | null };     // HT12, pain-held included
  lastDeloadAtUtc: string | null;
  profileVersion: string;           // hash of inputs
}

interface SlotSpec {                // everything a path must pass; same SlotSpec → same result (HT17)
  exerciseId: string; slotRole: SlotRole;
  repRange: RepRange | null;        // from slot / plan / template / Ben; never from history (HT1)
  fixedRange?: RepRange; personalCap?: number;   // HT9, Your data stored on the slot
  targetRpe: number | null; sets: number | null; dayTag: 'heavy' | 'volume' | 'deload' | null;
  gym: GymEquipmentRef; benOverride?: Partial<Targets>; coach?: CoachNumbers; plan?: PlanNumbers;
  savedWorkout?: SavedSlotValues;   // WL7: saved reps/sets/RPE win
}

interface ReferencePick {           // computed inside targetsFor, per (set role, zone)
  path: 'same_role_zone' | 'same_zone_other_role' | 'e1rm_translation' | 'no_load' | 'start_light';
  exposure: Exposure | null; setIds: string[];
  e1rmEst: number | null;           // HT4, `est.`
  pattern: number | null;           // HT9 P, non-main slots only
  referenceAgeDays: number | null;
}

declare function buildExerciseProfile(history: HistoryExposureInput[], ctx: ProfileCtx): ExerciseProfile;
declare function targetsFor(profile: ExerciseProfile, slot: SlotSpec, rules: PlaybookParams, now: string):
  { sets: Array<PlannedSetTarget & { basis: TargetBasis }>; warmups: WarmupSet[] };   // basis per set
declare function checkAgainstProfile(proposed: ProposedNumbers, profile: ExerciseProfile, slot: SlotSpec,
  requestedBy: 'ben' | 'coach'):
  { verdict: 'apply' | 'offer' | 'refuse'; snapped: PlannedSetTarget[]; builtIn: PlannedSetTarget[];
    reasons: string[]; profileVersion: string };                                        // HT14
```

- **Pure functions.** No I/O; `now` is passed in. One rounding policy: down for estimates, reductions and pain; nearest for qualified steps (EQ6).
- **Built-in rule.** `calculateNextTargets` (7-F) becomes `targetsFor` without `coach`. Playbook parameters stay in `default-rule.ts`.
- **Conventions.** `targetsFor` and `checkAgainstProfile` branch on `LoadConvention` (HT18): e1RM translation only for `total`/`per_hand`; assistance steps; reps-only for `bodyweight`; reps-to-cap at equipment max.

### 2. Basis: extend the existing schema, don't add a second one

- Keep `TargetBasisSchema` and `TargetBasisSetSchema` (with set `version`, `imported`). Add an optional `derivation` object: `role`, `plannedZone`, `path` (HT3 a–e), `decision` (`step | repeat | hold_gap | hold_pain | hold_drift | reps_first | reset_proposal | deload | at_max`), `stepPct`, `translation { e1rm, cushionRpe }`, `adjustments` (`gap | pain | deload | rpe_drift | snap_down | max | unit_conversion | gym_switch`), `profileVersion`, `ruleIds`.
- Extend `TargetSourceSchema` (`plan | rule | repeat | coach`) with `ben` and `start_light`. No separate `TargetBasis` type in domain.
- Stored **per planned set** when planned (`builder/codec.ts` `draftLoadOf` currently stores `basis: null`; this is where it must be saved). `Why?` renders it; it never recomputes. If `profileVersion` has changed, `Why?` adds one line that the target was planned before a newer session.

### 3. Record what history is missing (persistence, versioned)

- **New on every logged set:** planned target reps (or duration/distance) and planned RPE at logging time; slot role. Set role stays `setType`.
- **New on every session block:** planned set count by role, day tag, deload flag, plan day/week, and `partial` (fit-to-time, ended early, skipped sets).
- **No rewrite of finished rows** (rule 2). Legacy and imported rows are never migrated to `unknown`: role `unknown` is derived at read time from missing fields and `source = import`; pain-held and return status are derived from flag timestamps. `import/plan.ts:1034`, which marks imported sets as `working`, keeps doing so for storage; the reader treats imported `working` as `unknown`.
- **Imports' equipment class:** the catalogue's default kit for the exercise; machine/cable imports are `estOnly` (HT2).
- **Aliases:** `listExerciseHistory` reads by resolved identity (FitNotes customs mapped at import; catalogue same-movement IDs only where the catalogue says "same exercise"). Pain holds use the wider same-movement set (HT12).

### 4. Every path calls the profile

Each path reads `buildExerciseProfile` + `targetsFor`, or `checkAgainstProfile` for coach numbers, and exposes the `SlotSpec` it used (for the agreement test).

**Domain:**
- `calculateNextTargets` / `decidePrimary` / `builderFormatOtherLoad` (`progression.ts`); `nextTargetsFor`, `plannedSetsFromTargets` (sets `rpe: null` today) (`next-target.ts`).
- `builderLoad`, `ruleAnchorOf` (`builder/loads.ts`); `setRowsFor`, `warmupsFor`, `recalcLoad`, `reloadSlotLoads` (`builder/set-rows.ts`); `slotRepRange` (`builder/reps.ts`); `builder/codec.ts` `draftLoadOf`.
- `rep-range.ts` `personalRepRange` / `aimReps` (replaced by the HT9 fixed range).
- `target-provenance.ts` `ruleTargetProvenance`; the view fallback `ruleTargetRpe`.
- `checkProposedLoad`, `bandFor`, `recheckDraftLoad`, `recheckBuilderProposal` (`builder-loads.ts`).
- `checkWorkoutProposal`, `recheckDraftSlot`, `planCoachDraft` (`coach-draft.ts`); `planFirstLoads` (`coach-plan.ts`), including `structureChangedAtUtc`, which currently turns it off.
- `substituteTargets` / `addTargets` / `substituteRow` (`substitutes.ts`); `planRoutineStart` / `withRuleLoads` (`routines.ts`).
- `validateNextSessionTargets` / `withCoachTargets` / `classifyNextSessionChange` (`coach/next-session.ts`); `validateTodayAdjustment` (`coach/adjust.ts`); `evaluateSessionAdjustment` (basis only).
- `validateTodayFit` / `time-fit-today.ts`; `nextTargetsForBlock` / `secondaryMainLifts` (`gym-switch.ts`); `buildWorkoutSummary`.
- `checkCoachAdd` (`coach-add.ts`); `planCoachEdit` (`coach-edit.ts`); `acceptEditOffer` (today rechecks pain only; must recheck everything and the version).
- Prefill and the `Last` line (`session/view.ts`, `active-view.ts`); `lift-targets.ts` and the weekly stalled check (e1RM only); `review/weekly.ts:518` and `review/template-sets.ts`.
- `import/plan.ts` (read-side mapping only, see §3).

**App:**
- `builder-env.ts` `computeLoad` and `today-session.ts` `loadInputs` become one call (the `POOL_EXACT` fallback goes); `today-session.ts` `lastOf` (`Why?` "last time") and `mixPick` (its load guard gets real references).
- `whyWeight` / `ruleLine` (read the stored basis); `coachWorld` history lines.
- `workout-services.ts`: `startOnce` (all branches incl. `repeatOf`), `routineStart` / `nextTargetsOf`, `planFor`, previews (`resolveUpNext`, `splitDayPlan`, `overviewDryRun`, `nextSession.preview`, library `preview` / `planned` / `planAhead`), `todayForDraft`, swap and add candidates, `explainTarget`.
- `plan-services.ts` `planDay`; `week-services.ts` `withPlannedLoads` / `keepLoads`.
- `builder-service.ts` `specsOf` and the plan update that sets `targetLoad: null`; `coach-plan.ts` `templateOf`; `routines.ts:595` (coach set count); `coach-service.ts` `applyRuleRequest`.
- `workout-edit-service.ts` `builderPlan` (keeps `slot.main` on swap, writes a basis); `rest-alerts.ts` / cue controller (one reps/duration representation).
- `persistence/sessions.ts` `listFinishedWithExercise` (returns the §3 fields).

**Coach package:**
- `build.ts` `loadReferenceView`; `coach/context.ts` `builtInNext`; `next-time-view.ts`.
- `builder/edit-ops.ts` (`withWorkingLoad` stops collapsing back-offs); `builder/load-guard.ts` (thin wrapper); `builder/review.ts` (notes checked at their own reps); `builder/nudge.ts` (per-lift drift); `builder/weekly.ts`; `builder/setup.ts` (decides the main role; becomes the one stored definition); `builder/requests.ts` `builderWorkoutView` (stops hiding back-offs); `builder/proposal.ts`.
- `edit-today.ts`; `add-exercise.ts`; `executors.ts` `set_next_session_targets` (top and back-off kept separate).
- `training-read.ts` / `training-view.ts`: `get_recent_training` marks comparable sessions; `get_progression_targets` uses today's gym and comparable IDs.
- `numbers.ts` / claims: only numbers tied to exercise + set role + reps through a tool are checked and can apply; free text never applies.
- `corrections.ts` wording ("from his last session of it" → "from his last comparable session").

**Deleted once callers have moved:** the other readers, `lastTopText`, `typicalReps`, `ruleAnchorFromPlan`; the duplicated `SlotLoadInput` assembly; the four pain-hold computations and `returnCut`; the two extra e1RM formulas and three first-time-ceiling inputs; three definitions of a secondary main lift; two of three warm-up generators (WU rules decide); the source-kind-only builder provenance; the 20% `LOAD_CHOICE_LINE` prompt ceiling (if Ben approves HT14).

### 5. Coach checks and stale proposals

`checkAgainstProfile` runs on every coach number on every path, compared with the **built-in target** (HT14):
- `requestedBy: 'ben'` → `apply` (rule 3: immediate with % and Undo; in the builder before Start, a proposal with Apply/Skip), unless refused.
- `requestedBy: 'coach'` (and the D21 default) → `apply` when small (one step or ≤ 5% on a main lift, ±10% elsewhere, reps ± 2, sets ± 1; HT18 for assisted and bodyweight), otherwise `offer` / proposal with before/after and the reference.
- `refuse`: any increase on a pain-flagged movement (incl. same-movement IDs), above the equipment max (HT18 reps-to-cap instead), or a convention mismatch.
- **Rule 5:** every offer and proposal records `profileVersion` and the targets' versions. Apply (`acceptEditOffer`, proposal apply, `recheckBuilderProposal`) recomputes and **rejects** if either changed. The builder's coach-target read goes through the same D21 checks as Start (used, stale, pain flags, today's pain).

### 6. Tests

**Scenario tests:** examples A–G in history-targets.md §3, plus: 12s then 5s; a missed set (planned 5, got 2) → repeat, then reset proposal; heavy squat every 3 weeks + volume weekly → heavy day not returning; a builder main lift after its history moved; lb history in a kg gym; a FitNotes alias; an imported machine row (`est.` only); a pain flag with no history; a pain flag with 100 → 80 history (target ≤ 80); a coach target from a volume day used on a heavy day; a fit-to-time session (set count unchanged next time); assisted pull-up, bodyweight push-up, plank, per-side lunge; a stack step that would pass the machine max.

**Property tests** (seeded generators unless a property library is already pinned):
- **Agreement:** the same `SlotSpec`, history and `now` give the same result on every §4 path (each path exposes its `SlotSpec`). Saved-workout values and Ben's overrides are inputs, not disagreements.
- **No unexplained drop:** for the same role and planned reps on `total`/`per_hand`, the target never drops below the reference unless the basis records gap, pain, deload, rule 5/8, Ben's override, zone translation, snap down, equipment max, unit conversion or gym switch.
- **No silent jump:** for `total`/`per_hand`/`stack`/`added`, a non-Ben target never exceeds the built-in target by more than the HT14 small band; for `assistance`, never more than one step less assistance; for `bodyweight`, never more than + 2 reps.
- **Fixed range:** a non-main slot's planned reps stay within its fixed range (plus banked reps up to the personal cap) unless Ben or the plan changed it. Not applied to cross-zone translations.
- **Pain:** with an active flag, no target exceeds the most recent exposure's load, reps or sets; with a flag and no history, no load.
- **Guardrails:** every load achievable on the selected gym, within min/max, explicit unit and convention.
- **Basis:** every planned set has a basis; `setIds` exist in history and are comparable (HT1/HT2).
- **Stale:** applying an offer after a new finished session or correction is rejected.

### 7. On-device consistency check (flag only)

- A pure `auditTargets(plan, profiles)` runs when a workout is built or started, and on Summary "Next time". It flags a target outside the HT14 small band of the built-in target without a recorded reason, or (non-main slots) reps outside the fixed range. Thresholds are HT14's, nothing separate. Cross-path disagreement is checked in tests and shadow mode, not on device (only one path runs at a time).
- It never changes a number.
- Flags go to a local diagnostics table (Your data, in backup, removed by Delete), shown on a developer screen and as a `Why?` line. No marker in the main UI.
- Nothing leaves the device; no AI call. Ben can export the table to report a bug.

### 8. Rollout

1. Schema fields (§3), recorded from now on; read paths unchanged. No rewrite of old rows.
2. `buildExerciseProfile` / `targetsFor` / `checkAgainstProfile` with §6 tests; no callers.
3. **Shadow mode:** builder, Today, Start and Summary compute old and new targets; differences logged to §7's table for about a week of real workouts.
4. Switch builder and Today (one `SlotLoadInput`), then Start, saved workouts, plan days and previews, then Summary and the built-in rule.
5. Coach paths: checks first (`edit_today`, add, next session, builder target, `acceptEditOffer`), then the views.
6. Delete the old readers. Each step gets its own review (`docs/reviews/`).

The rule 9 fixes (builder coach target's checks; no loads with a flag and no history; pain hold never above the in-pain load) should not wait for this ADR.

## Consequences

- One definition of "last comparable", one e1RM, one pain hold, one basis per set. Paths can't drift apart without a failing agreement test.
- Ben's targets change where old code mixed zones or roles, drifted rep ranges, used `done` set counts or ignored gaps. Shadow mode shows him the differences first.
- Profiles are rebuilt from full history: cache per exercise + class, keyed by `historyVersion`; invalidate on finish, correction, import, delete or flag change.

## Risks

- **Ben may approve only some HT rules.** The structure stands; parameters live in playbook params.
- **Legacy and imported history has no plan, role or zone.** Achieved-rep matching can still mix roles for old data; labelled, and improves as sessions are logged.
- **e1RM translations are uncertain** (about ±2.5 reps at 80% 1RM; Nuzzo 2024). Mitigated by the 1-RPE cushion, rounding down, first-exposure-only use and `total`/`per_hand` only.
- **Large change** (about 40 paths). Mitigated by shadow mode, the order above and one path per review.
- **Nagging.** The consistency check only flags, never prompts Ben.

## Review log

- 21 Oct 2026, review CHANGES NEEDED. Applied here: per-set basis extending the existing schema; per-reference fields moved to `ReferencePick` (12); `profileVersion` on offers/proposals with reject-on-apply (13); missing paths added (15); testable invariants (16); read-time derivation instead of migration (17); §7 flag moved off the main UI and aligned with HT14 (20); three audits (21). Partly rejected: `gap` stays on the profile, because under R1 it doesn't depend on the chosen reference (finding 12). Behaviour fixes (1–11, 14, 18–19) are in history-targets.md.
