# 0031: One exercise performance profile feeds every target

**Status:** PROPOSED by the training researcher on 21 Oct 2026, for PM and developer review. Nothing is built. The behaviour rules it implements are the candidates HT1–HT17 in [history-targets.md](../training-guides/history-targets.md), which need Ben's approval first. The structure (one pure reader, one checker, basis on every target) is useful even before then. Renumber on merge if another branch took 0031.

Relates to:
- ADR 0006: coach-led progression, the built-in rule and amendment 2 (D21).
- ADR 0022 / 0025: pre-start and coach drafts.
- Playbook rule 7 and D7 (heavy and light days progress from their own history; approved as default 9 Oct).

## Context

Ben, 21 Oct 2026: "how are you going to ensure to properly use history to guide workout weights etc when building?" His refinement: "last session should be starting point subject to type of session, if it's main lift etc like a coach would do."

Two read-only audits of `claude/builder-loads-21oct` (HEAD `9ce15c2`) found the following.

- **Seven history readers.** These are `comparableSessions` in `progression.ts` and in `substitutes.ts`, `loadReferences` in `builder-loads.ts`, `lastComparableSession` in `active-view.ts`, `ruleBasis`/`referenceLoad` in `target-provenance.ts`, lift-target / weekly e1RM, and `nextSessionBases`. Two more helpers do similar work: `lastTopText` and `typicalReps`. They differ in four ways:
  - **Equipment matching:** same item, comparable ids, same kind or bar mass, or exact instance.
  - **Window:** all history, 3 sessions within 180 days, 90 days, or 16 weeks.
  - **Set types:** working only, or pooled top + back-off + working + drop.
  - **e1RM formula:** RIR-adjusted Epley up to 12 reps, plain Epley up to 10, or same-effort Epley.
- **About 25 places decide or show a pending weight, reps, set count, RPE or warm-up**, through at least four different definitions of "last time". The same plan day can show different loads on the Today card, in the plan-day preview and at Start.
- **What history does not record:** set role (main, secondary, accessory), session type or rep zone, planned target reps and RPE, plan week or deload, or exercise aliases at read time.
- **Coach numbers are checked against history in only one route** (v2 build/plan, `checkProposedLoad`). Next-session targets, the live `edit_today`, `add_exercise_today` loads and the builder's coach target have no history bound.
- **Two rule 9 risks:**
  - The builder's coach target skips D21's pain and stale checks.
  - With a pain flag and no history, the builder still plans coach, plan or e1RM loads.

## Decision (proposed)

### 1. One pure profile per exercise, in `packages/domain/src/profile/`

```ts
type SetRole = 'top' | 'backoff' | 'working' | 'unknown';           // warmup/drop never enter
type SlotRole = 'main' | 'secondary' | 'accessory' | 'unknown';
type SessionKind = 'normal' | 'deload' | 'return' | 'pain_held';

interface Exposure {                       // one exercise block in one finished session
  sessionId: string; atUtc: string; tz: string; daysAgo: number;
  exerciseId: string;                      // resolved identity (aliases, imports)
  equipmentClass: EquipmentClassKey;       // HT2
  slotRole: SlotRole; kind: SessionKind; dayTag: 'heavy' | 'volume' | null;
  sets: Array<{ setId: string; role: SetRole; load: Load /* value+unit+convention, converted, original kept */;
                reps: number; rpe: number | null; targetReps: RepRange | null; targetRpe: number | null }>;
  source: 'app' | 'import'; historyVersion: string;
}

interface ExerciseProfile {
  exerciseId: string; equipmentClass: EquipmentClassKey; unit: Unit; convention: LoadConvention;
  exposures: Exposure[];                   // comparable class only, newest first, HT13 exclusions applied
  pattern: { typicalTopReps: number | null; sessions: number };     // HT9 P
  e1rmEst: { value: number; fromSetId: string; approx: boolean } | null;  // HT4, labelled est.
  gapDays: number | null; staleness: 'normal' | 'returning' | 'estimate_only' | 'too_old' | 'none'; // HT5
  rpeDrift: 'harder' | 'easier' | null;    // HT11, needs 2 exposures
  pain: { active: boolean; heldLoad: Load | null; heldReps: number | null; heldSets: number | null }; // HT12
  lastDeloadAtUtc: string | null;
  profileVersion: string;                  // hash of inputs; used for stale checks
}

interface SlotSpec { exerciseId: string; slotRole: SlotRole; repRange: RepRange | null;
  targetRpe: number | null; sets: number | null; dayTag: 'heavy' | 'volume' | 'deload' | null;
  gym: GymEquipmentRef; benOverride?: Partial<Targets>; coach?: CoachNumbers; plan?: PlanNumbers }

interface TargetBasis {                    // stored on every planned set (HT15)
  path: 'same_role_zone' | 'same_zone_other_role' | 'e1rm_translation' | 'no_load' | 'start_light';
  referenceSessionId: string | null; referenceSetIds: string[]; referenceAtUtc: string | null;
  translation: { e1rm: number; cushionRpe: number } | null;
  decision: 'step' | 'repeat' | 'hold_gap' | 'hold_pain' | 'deload' | 'reset_proposal' | 'reps_first';
  stepPct: number | null; source: 'ben' | 'coach' | 'plan' | 'profile' | 'start_light';
  adjustments: Array<'gap' | 'pain' | 'deload' | 'rpe_drift' | 'snap_down' | 'max'>;
  profileVersion: string; ruleIds: string[];   // e.g. ['HT1','HT7']
}

declare function buildExerciseProfile(history: HistoryExposureInput[], ctx: ProfileCtx): ExerciseProfile;
declare function targetsFor(profile: ExerciseProfile, slot: SlotSpec, rules: PlaybookParams):
  { sets: PlannedSetTarget[]; basis: TargetBasis; warmups: WarmupSet[] /* WU rules, from final W and R */ };
declare function checkAgainstProfile(proposed: ProposedNumbers, profile: ExerciseProfile, slot: SlotSpec):
  { verdict: 'small' | 'ask' | 'refuse'; snapped: PlannedSetTarget[]; reasons: string[] };   // HT14
```

- **Pure functions.** No I/O and no clock reads (the caller passes `now`). One rounding policy: snapped down for estimates, reductions and pain; nearest for qualified steps (EQ6).
- **Built-in rule.** `calculateNextTargets` (7-F) becomes `targetsFor` with `coach` absent. The playbook parameters (`default-rule.ts`) stay where they are.

### 2. Record what history is missing (persistence, versioned)

- **New fields on every logged set:**
  - set role (already `setType`; keep it);
  - the planned target reps and RPE at the time of logging;
  - the slot role.
- **New fields on every session block:** the day tag, `kind` (deload, return or pain-held) and the plan day or week.
- **Migration and legacy rows:** one migration. Legacy and imported rows get `unknown` and are never back-filled by guesswork (rule 6).
- **Aliases:** `listExerciseHistory` reads by resolved identity, so FitNotes customs mapped at import, and catalogue same-movement IDs only where the catalogue says "same exercise", count as one exercise.

### 3. Every path calls the profile (from the audits)

Each path below reads `buildExerciseProfile` and `targetsFor`, or `checkAgainstProfile` for coach numbers.

**Domain:**
- `calculateNextTargets` / `decidePrimary` / `builderFormatOtherLoad` (`progression.ts`).
- `nextTargetsFor` (`next-target.ts`).
- `builderLoad`, `ruleAnchorOf` (`builder/loads.ts`).
- `setRowsFor`, `warmupsFor`, `recalcLoad`, `reloadSlotLoads` (`builder/set-rows.ts`).
- `slotRepRange` (`builder/reps.ts`).
- `checkProposedLoad`, `bandFor`, `recheckDraftLoad` (`builder-loads.ts`).
- `checkWorkoutProposal`, `recheckDraftSlot`, `planCoachDraft` (`coach-draft.ts`).
- `planFirstLoads` (`coach-plan.ts`).
- `substituteTargets` / `addTargets` / `substituteRow` (`substitutes.ts`).
- `planRoutineStart` / `withRuleLoads` (`routines.ts`).
- `validateNextSessionTargets` / `withCoachTargets` (`coach/next-session.ts`).
- `validateTodayAdjustment` (`coach/adjust.ts`).
- `evaluateSessionAdjustment` (keeps today's-load logic; reads the profile only for the basis).
- `validateTodayFit` / `time-fit-today.ts` (added exercises).
- `nextTargetsForBlock` / `secondaryMainLifts` (`gym-switch.ts`).
- `buildWorkoutSummary`.
- `checkCoachAdd` (`coach-add.ts`).
- `planCoachEdit` (`coach-edit.ts`).
- Prefill and the `Last` line (`session/view.ts`, `active-view.ts`).
- `lift-targets.ts` and the weekly stalled check (e1RM only).

**App:**
- `builder-env.ts` `computeLoad` and `today-session.ts` `loadInputs`. These become one call, so the `POOL_EXACT` no-history fallback is gone.
- `whyWeight`/`ruleLine` (they read the stored basis).
- `coachWorld` history lines.
- In `workout-services.ts`: `startOnce` (all branches, including `repeatOf`), `routineStart`/`nextTargetsOf`, `planFor`, the previews (`resolveUpNext`, `splitDayPlan`, `overviewDryRun`, `nextSession.preview`, library `preview`/`planned`/`planAhead`), `todayForDraft`, swap and add candidates, `explainTarget`.
- `plan-services.ts` `planDay`; `week-services.ts` `withPlannedLoads` / `keepLoads`.
- `workout-edit-service.ts` `builderPlan`, which keeps `slot.main` on swap and writes a basis.
- `rest-alerts.ts` / cue controller (one reps representation).

**Coach package:**
- `build.ts` `loadReferenceView` (one rendering of the profile).
- `builder/edit-ops.ts` (`withWorkingLoad` stops collapsing back-offs) and `builder/load-guard.ts`, which becomes a thin wrapper.
- `builder/review.ts` target notes, checked at the note's own reps.
- `builder/nudge.ts`: per-lift drift instead of the cross-role average.
- `edit-today.ts`; `add-exercise.ts`.
- `executors.ts` `set_next_session_targets`, which keeps top and back-off as separate targets.
- `training-read.ts` / `training-view.ts`: `get_recent_training` marks which sessions are comparable, and `get_progression_targets` uses today's gym and comparable IDs.
- `numbers.ts` / claims: a recommended number in a reply goes through `checkAgainstProfile`.
- `corrections.ts` wording ("from his last session of it" → "from his last comparable session").

**Deleted once callers have moved:**
- the other six readers, `lastTopText`, `typicalReps`, `ruleAnchorFromPlan`;
- the duplicated `SlotLoadInput` assembly;
- the four pain-hold computations and `returnCut`;
- the two extra e1RM formulas and three first-time-ceiling inputs;
- three definitions of a secondary main lift (`main` becomes a stored slot role);
- two of the three warm-up generators (the WU rules decide which one survives);
- the source-kind-only builder provenance.

### 4. Basis and `Why?`

- Every planned set stores a `TargetBasis` when it is planned. `Why?` renders it; it never recomputes it from current history.
- If history has changed since then (`profileVersion` differs), `Why?` says the target was planned before the newer session.
- Builder rows, mid-workout adds and swaps, `repeatOf` and week merges stop writing "Not recorded".

### 5. Coach checks

`checkAgainstProfile` runs on every coach number on every path (HT14):
- `small`: applies per rule 3 / D21.
- `ask`: an offer or proposal with before/after and the reference.
- `refuse`: any increase on a pain-flagged movement, a load above the equipment max, or a convention mismatch.

Ben's explicit number is honoured after snapping and the pain check. The builder's coach-target read goes through the same D21 validity checks as Start (used, stale, pain flags and today's pain).

### 6. Tests

**Scenario tests:** the six worked examples in history-targets.md §3, plus the audits' cases:
- 12s then 5s;
- a builder main lift after its history moved;
- a lb history in a kg gym;
- a FitNotes alias;
- a pain flag with no history;
- the coach target from a volume day used on a heavy day.

**Property tests** (generated histories; use a property library only if one is already pinned, otherwise seeded generators):
- **Agreement:** for identical inputs, every entry path in §3 yields the same load, reps, set count and RPE per set.
- **No unexplained drop:** for the same role and reps, the target load is never below the last comparable load unless the basis records gap, pain, deload, rule 5/8, Ben's override or rep-zone translation.
- **No silent jump:** the target never exceeds the reference + 10% (or the HT4 estimate at target RPE) unless Ben set it.
- **Pattern:** an accessory's target reps stay within P ± 2 unless the plan or Ben changed them.
- **Pain:** with an active flag, no target is above the held load, reps or sets. With a flag and no history, the target has no load.
- **Guardrails:** every load is achievable on the selected gym, within min/max, in an explicit unit and convention.
- **Basis:** `basis.referenceSetIds` exist in history and are comparable (HT1/HT2).

### 7. On-device consistency check (flag only)

- **What it does.** A pure `auditTargets(plan, profiles)` runs when a workout is built or started, and on Summary "Next time". It flags any target that is:
  - > 10% above or > 15% below the profile's expectation without a recorded reason;
  - reps outside P ± 3;
  - sets ± 2 from the last comparable count;
  - from different paths that disagree.
- **What it never does.** It never changes a number.
- **Where flags go.** Flags go to a local diagnostics table (Your data, included in backup, removed by Delete), behind an info tap on the target and on a developer screen.
- **Privacy.** Nothing leaves the device and no AI call is made. Ben can export the table himself to report a bug.

### 8. Rollout

1. Schema fields and migration (§2), recording from now on; read paths unchanged.
2. `buildExerciseProfile` / `targetsFor` / `checkAgainstProfile` with the §6 tests; no callers yet.
3. **Shadow mode.** Builder, Today, Start and Summary compute both old and new targets, and §7 logs the differences on Ben's phone for about a week of real workouts.
4. Switch the builder and Today card (one `SlotLoadInput`), then Start, saved workouts, plan days and previews, then Summary and the built-in rule.
5. Coach paths: checks first (`edit_today`, add, next session, builder target), then the views.
6. Delete the old readers (§3). Each step gets its own review (`docs/reviews/`).

The two rule 9 fixes (the builder coach target's checks; no loads with a flag and no history) should not wait for this ADR. They are guardrail bugs.

## Consequences

- One definition of "last comparable", one e1RM, one pain hold and one basis. Paths can't drift apart again without a failing agreement test.
- Ben's targets will change where the old code mixed zones or roles (12s copied into 6s, back-offs from top sets, accessories drifting to 8–12, gaps ignored). Shadow mode shows him the differences before the switch.
- Profiles are rebuilt from the full history, which needs decoding. Cache them per exercise, keyed by `historyVersion`, and invalidate the cache on any finish, correction, import or delete.

## Risks

- **Ben may not approve the HT rules, or only some of them.** The profile structure still stands, and the parameters live in playbook params, not code branches.
- **Legacy and imported history has no role or zone tags.** Matching on zone only can still mix roles for old data. This is labelled and improves as new sessions are logged.
- **e1RM translations are uncertain** (about ±2.5 reps at 80% 1RM, more at lighter loads; Nuzzo 2024). This is mitigated by the 1-RPE cushion, rounding down, and a translated target serving only the first exposure.
- **The change is large** (about 25 paths). Mitigated by shadow mode, the order above, and one path per review.
- **Over-correction.** The consistency check could become a nag. It only flags, behind a tap, and never prompts Ben.
