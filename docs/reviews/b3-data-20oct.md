# Review: builder v3 S1 data (schemas, migration 30, plan-day provenance, reviews)

Branch `claude/b3-data-20oct`, diff `02a796a..630d636`, 3 commits. Spec:
`docs/design/workout-builder-v3.md` §3, §4, §6.1, §6.2, §8 S1, §9 answers.

**Verdict: CHANGES NEEDED**

## What I ran

- `npm run typecheck`: clean. `npm run lint`: clean. `npm run check:migrations`: "Migrations OK: 1 to 30".
- `vitest run packages/schemas packages/persistence packages/domain`: 174 files, 3261 tests passed.
- `vitest run apps packages/coach packages/providers packages/catalogue`: 4 timeouts under load
  (morning-reminder, today-edits x2, workout-builder). The 3 files pass on their own (117/117).
- I ran a throwaway repro of `planUpNext` against a plan that repeats a split day, then deleted it (B1).
- Collision check: no other local branch adds a `0030` migration. `claude/b3-rules-20oct` (S2) has its own
  `VariationOp` type (S2 below). `claude/b3-muscles-20oct` owns `BuilderGroup` and Q13, as this branch says.

Checked and fine: Q7 rest limits (0–60 s before a drop, 30–360 s otherwise; 0:15 before a drop validates and
1:01 fails); `maxSuperset` 4 (a 5-member superset fails); max 3 drops per slot, with drops counted in the 10 sets;
`maxRestS` 300 → 360 with the coach clamp test updated; zero slots allowed on an open builder version, and
`startWorkoutDraftIn` refusing an empty current version; the builder-version invariants (`setup` present,
`turnId 'manual'`, `rawArgs ''`); one open builder draft per (owner, plan, split day, main lift, date) held by a
partial unique index and resumed through `exists`; versioned, idempotent and tombstoned variations, with the
Q10 limit checked in the write and on Undo; variations surviving plan Undo and End; reviews with facts separate
from coach text, one `current` per subject, `est_max.estimate: true` (rule 6), and an offline/not-connected
status with no text (rule 1); new tables classified as Your data and covered by backup, export and Delete
(rule 10); migration in place keeping every row; a schema-29 backup restoring and migrating; old drafts,
routines and memories parsing. Coach drafts never write drop sets or rests under 30 s, so the new per-slot
rest refinement can't make a stored draft unreadable. Rule 2 (completed sets) is untouched.

## Blocking

**B1. A plan day keyed by (planId, splitDayId) merges a split day that the plan uses twice. This breaks Up next
now, and the frozen unique index will refuse templates later.**
`packages/domain/src/session/coach-plan.ts:538` (`planDayOf`), `:616–621` (`planUpNext`),
`packages/domain/src/session/plan-adapt.ts:106,111` (`ownPlanDay`, `sameDayIds`),
`packages/persistence/src/schema/0030-plan-day-templates.ts:30` (`routines_plan_day`).
Plans can repeat a split day: `PlanDayDraftSchema.splitDayId` isn't unique per plan, and Push/Pull/Legs/Push or
Upper/Lower ×2 are ordinary 4-day plans.
- *Existing data, today:* plan days `[push1, pull, legs, push2]`, all pre-v3 with `createdFromPlan.splitDayId`.
  Ben finishes push2 (an old-style session, by routine). Before this branch `planUpNext` returned push1. Now it
  returns **pull**, because `planDayOf(push1)` equals `planDayOf(push2)` and the skip loop jumps over it (I
  reproduced this). After that the cycle is legs → push2 → pull, so push1 never comes up again.
- *v3 sessions:* a session started as `{planId, splitDayId:'push'}` from the push2 template is matched to push1 by
  `findIndex`, the first match, so it is credited to the wrong day. With `planKey` wired (the developer's
  "left for app wiring"), `planDaysByDue`/`sameDayIds` mark push1 and push2 done together.
- *Templates:* the unique index on (owner, planId, splitDayId, mainLift) refuses a second Push · bench template
  for day 4. Apply writing `planDay` per main lift (§4.2) would then fail with `duplicate_template` or a UNIQUE
  error. This migration becomes frozen once released, so this has to be fixed before merge.
- *Fix:* identify a plan day by its slot in the plan, not only its split day. Add `dayIndex` (the plan day's index,
  already in `createdFromPlan.dayIndex` and `applied.made[].dayIndex`) to `RoutinePlanDaySchema`,
  `SessionPlanDaySchema`, `FinishedRefRow.planDay`, `PlanDayRef`/`PlanDueDay.planKey`, the index expression and
  `planDayTemplateKey`. Keep `splitDayId` as the variation key (§4.3: variations are shared across plans by split
  day and main lift, which is still right). In `planUpNext`, match on the session's `templateRoutineId` or day index
  before falling back. Add tests: a repeated split day in pre-v3 and v3 forms for `planUpNext` and `planDaysByDue`;
  two Push · bench templates on days 0 and 3 save. See also Spec issue SP1.

**B2. Day notes aren't covered by the S1 backup acceptance check.**
`packages/persistence/test/plan-day-templates.test.ts:394` (`populate`).
§8 S1 says: "a backup round-trip keeps templates, variations **and day notes**". `populate` writes no memory with
`dayNote`, so the round trip, export and Delete tests never touch the new field. `MemorySchema` is strict about
`hiddenOn` (max 14) and `reviewId`. If a restore or the memories write path dropped or rejected `dayNote`, nothing
would catch it.
*Fix:* add a `dayNote` memory (with `hiddenOn` and `reviewId`) to `populate`, and check it in the backup round
trip, `exportDomain('your_data')` (and its absence from `coaching_knowledge`), and Delete my data.

## Should fix

**S1. Q2 says Today opens the last-used template, but `planUpNext` always returns the first template of the next day.**
`coach-plan.ts:618–621`. After Back, `planUpNext` returns `Chest · bench` (first in day order) even when
Ben's last Chest session was `Chest · incline`. The data for the right answer is missing too:
`listFinishedRefs` (`sessions.ts:53`) returns `variationId` but not `templateRoutineId` or `mainLiftExerciseId`.
*Fix:* add `templateRoutineId` and `mainLiftExerciseId` to `FinishedRefRow.planDay`. When the next plan day has
several templates, pick the one named by the newest session for that plan day. Test it.

**S2. Two different `VariationOp` shapes on parallel streams.**
`packages/schemas/src/plan-day.ts:24` stores `add_slot.slot` as a full `RoutineExercise`. S2
(`claude/b3-rules-20oct`, `packages/domain/src/builder/variation.ts`) defines its own
`VariationOp` with `slot: { exerciseId, workingSets? }` and a "S1 owns VariationOp" merge note.
*Fix:* agree on one shape before either merges. The domain should import the schema type. If the stored slot stays
a `RoutineExercise`, `applyVariation` maps it.

**S3. A template written for a pre-v3 plan routine's derived key isn't checked for duplicates.**
`packages/persistence/src/documents.ts:273` (`saveRoutineTemplateIn`) and the index only see rows with `planDay`.
Suppose a pre-v3 plan routine derives to (P, chest, bench) and S5 saves a new template with
`planDay {P, chest, bench}`. Both are live and both appear in `planRoutines`, against "unique per (planId,
splitDayId, mainLift)" (§4.2).
*Fix:* in `saveRoutineTemplateIn`, also refuse when a live routine with `createdFromPlan.planId = P`, the same
split day (and, after B1, the same day index) and no `planDay` derives to the same main lift. Return its ID so the
caller can update that routine (adding `planDay`) instead of creating a second one. Test with a schema-29 plan.

**S4. Templates added to a plan after Apply aren't removed by plan Undo or End.**
`planRoutines` now lists templates with `planDay.planId = plan.id` that aren't in `applied.made` (for example, a
new main lift saved from the builder). `undoPlanApply` and `endPlan` only touch `applied.made`, so after Undo
these templates stay live and in the library, linked to a plan that is no longer applied. §4.2 says "Plan
Undo/End deletes only templates it made".
*Fix (S5 can do it, but decide now):* either append each added template to `applied.made` in the same write, or
make Undo/End also handle live routines with `planDay.planId = plan.id`. Add a test.

**S5. Re-recording a review that ran offline returns `unchanged`, so the coach never fills it in.**
`packages/persistence/src/plan-days.ts:151`. If a weekly review was recorded with `coach: offline` and Ben
reopens online with the same inputs, `record` returns `unchanged`, and §6.1 "Not run → Not reviewed" stays that
way unless the caller knows to use `update`.
*Fix:* return `unchanged` only when the current review's coach status is `reviewed` or `silent`. Otherwise let the
caller re-run, or return a distinct `retry_coach` status. Document this on `record`, and test offline → online
with the same hash.

**S6. A restore's loss count leaves out reviews.**
`packages/persistence/src/backup/replace.ts:42` adds `plan_day_variations` but not `reviews`, so a restore that
replaces weekly and block reviews doesn't count them in "otherRecords". The developer summary says the counts
include them.
*Fix:* add `reviews` (and update the doc comment), or record why reviews are left out.

**S7. Some S1 limits aren't enforced in the draft schema.**
`packages/schemas/src/workout-draft.ts:228,265`. `maxWarmups` 4 isn't checked per slot: 5 warm-ups plus 10 working
sets still fits the array max of 15. `minSuperset` 2 isn't checked either, so a one-member `supersetGroup` validates.
*Fix:* count warm-ups in the slot `superRefine`. Check superset groups for 2–4 members on builder versions
(if needed, leave older coach drafts alone the same way the drop-set check does). Add tests.

## Nits

- **N1.** `DayNoteScopeSchema.hiddenOn` is `.max(14)` (`coach.ts:1263`). A note Ben hides on every Chest day for
  15 weeks fails to save. Have the writer drop dates older than the note's useful window, or raise the cap.
  Either way, document who trims it.
- **N2.** `@fizz/schemas` now exports `ReviewSchema`/`Review`, and `@fizz/catalogue` already exports a different
  `ReviewSchema` (`entry-schema.ts:56`). Rename this one to `TrainingReviewSchema` (or similar) to avoid import
  mix-ups.
- **N3.** `startWorkoutDraftIn` (`workout-drafts.ts:150`) still ignores the draft's version. Builder edits now bump
  the version in place (§4.4), so S5's atomic Start should pass and check `expectedVersion` (rule 5).
- **N4.** `planRoutineForSplitDay` (`coach-plan.ts:637`) still credits only by routine, so a `Today only` start
  with a `templateRoutineId` doesn't count toward "least recently done". Credit it by
  `planDay.templateRoutineId` too.
- **N5.** The empty-plan refusal in `startWorkoutDraftIn` returns the same `false` as "expired or closed". S5 will
  want a distinct reason, so the UI doesn't show "Out of date" for an empty workout.

## Spec issues

- **SP1 (B1).** §4.2 and §4.3 key templates and Up next by (planId, splitDayId [, main lift]). This assumes a plan
  uses each split day at most once, which plan drafts don't enforce. The spec should key plan days by
  (planId, day index) and keep (splitDayId, main lift) only for variations. Ben needs to confirm that variations
  are shared across a plan's repeated days.
- **SP2.** §4.8 says migration 0030 rebuilds `coach_actions` for `fill_setup`, `propose_workout_edit` and
  `review_workout`. This branch uses 0030 for the data model and leaves the rebuild to the coach slice, which will
  need 0031. Update §4.8 so the next stream doesn't plan around 0030.
- **SP3.** §4.4 gives the builder draft key as including the main lift, but the task brief said "one open draft per
  plan day + local date". The code follows the spec. Changing the main lift on Set up therefore opens a different
  draft rather than rebuilding the same one. Confirm this matches §2.3 "a new main lift builds a new workout with
  Undo" (Undo across two draft rows isn't modelled).
- **SP4.** The developer made two choices the spec doesn't cover, and Ben should confirm them: one live
  variation name per (split day, main lift), and up to 4 templates per plan day (`PLAN_LIMITS.maxTemplatesPerDay`).
- **SP5.** The task said `origin: 'manual'`, and §4.4 says `'builder'`. The code uses `'builder'`, matching the
  spec. No change needed, but the task wording was wrong.
