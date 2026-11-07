# Review: Your plan in Library › Workouts (planview-19oct)

Branch `claude/planview-19oct`, commits `753a596..71b2686` on top of merge-base `0b8401d`.
Checked against the brief to the developer: Ben's 19 Oct request and the approved mockup.
The mockup (`PLAN-MOCK.local.html`) was deleted before review, as instructed, so it was
compared through the brief's description of it. There is no `docs/design/` spec (see Spec issues).

**Verdict: CHANGES NEEDED** (1 blocking)

## What I ran

- `npm run typecheck`: clean. `npm run lint`: clean.
- Targeted: the 7 changed/new test files, 106 passed.
- Full suite `--maxWorkers=2`: 358 files, 7102 passed, 1 todo, exit 0.
- Probe (temporary test, removed): `asksForPlan` / `revisesPlan` on the prefilled drafts (B1).

## What is right

- States: ✓ done this week, numbered ring for Up next, plain ring to do. `Next` uses the same `next.preview(gym)` resolver as Today, so they can't disagree. Wrap-around (✓ plus Next) is handled.
- Week: `planWeekStartMs` = max(Monday 00:00 in Ben's tz, Apply). Progress's consistency card now calls the same `planDaysDoneThisWeek`, and both the Sunday 23:30 and Monday 00:30 boundaries are tested.
- Numbers come only from logged data. `Planned sets done` uses `plannedVsDone` on finished sessions, so added sets don't count. The tile hides at 0 planned, and the value is capped at 100%. `Targets hit` comes from `exerciseTargetHistory`. `est.` appears only on estimated loads. There is no score or projection, and nothing is called "missed".
- Loads come from the real Start dry run at the selected gym (snapped and bounded). Per-hand shows `each`, assisted shows `Assist`, and the unit appears only when last time's unit differs.
- End plan / Undo: `endPlan` and `undoEndPlan` are pure. They check op IDs and versions, and refuse when another plan is applied or a day has changed since. The write is one transaction (`endOrResume`) that throws `Conflict` and rolls back. Rotation places are restored via `rotationAtUtc`. The coach card shows `Ended`. The tests cover a force-close.
- Migration 22: a table rebuild like 20. No FKs or triggers point at `plan_drafts`, and every status is carried over.
- The goal line leaves out parts that aren't set. With no goal it shows `Set goal`, and both `Edit` and `Set goal` open Training details.
- The lift-target box was not built. The copy is minimal.
- Accessibility labels are on day rows (name, day N of M, next, when), stat tiles, the goal link, the Today link (`link` role) and plan-day rows (`est.` is read as "estimated load").
- No logging or secrets were added.

## Blocking

**B1. "Ask coach to change" leads to a coach that can't see or change the plan.**
`apps/mobile/src/screens/library/YourPlanBlock.tsx:121`, `apps/mobile/src/screens/library/PlanDayScreen.tsx:80`, `apps/mobile/src/coach/coach-service.ts:891,1293-1296`.
- The prefilled text `Change my plan: …` is sent to the general thread.
- `asksForPlan` is false for every draft I tried, e.g. "Change my plan: swap squats for leg press" and "Change Pull in my plan: replace rows with cable rows".
- `revisesPlan` is true, but it only matters when `threadOpenPlan` finds an **open** plan. That function requires `planIsOpen`, i.e. `status === 'open'`, and an applied plan is never open.
- So `planWanted` is false, there is no `build_plan` turn, and the applied plan is not in the coach's context at all (`planView.current` is only filled for a plan request).

Failure: Ben taps `Ask coach to change` and types "swap squats for leg press". The coach answers without knowing the plan, and it can't produce a new version or a proposal for it. That is a dead end on one of the block's two main actions.

Fix: when a plan is applied, pass it as `planRequest.plan` (or a `plan_in_use` context entry) for general turns that `revisesPlan`. Any change must still come back as a proposal (Apply/Undo, rule 2). Also add an app test: apply → Ask coach to change → a revision turn sees the plan's days. If this belongs to a separate coach slice, hide or disable the button until then rather than ship a dead end.

## Should fix

**S1. Today's `Day N of M ›` may not reach the block when a plan day is open in the Library stack (unverified).**
`apps/mobile/src/navigation/actions.ts:86`.
- `POP_TO Tabs` passes nested params `Library › LibraryHome`.
- Under React Navigation 7.5, a nested navigate to a route already lower in the stack may update its params without popping `LibraryPlanDay` off the top, or may push a second `LibraryHome`.
- Scenario: Ben opens a plan day, switches to Today, taps `Day 2 of 4 ›`, and lands back on the plan day instead of the top of the block.
- No test covers this.
- Fix: dispatch a reset of the Library stack to `[LibraryHome]` (or `popTo`), and check it on the device.

**S2. The plan day shows no exercises, with no reason, when there is no gym or the dry run fails.**
`apps/mobile/src/services/plan-services.ts:366,376`, `PlanDayScreen.tsx:43`.
- `planned: false` is returned but never rendered.
- With no gym set up, or a day that can't start at this gym, the screen shows only the header and `Start`.
- Fix: show a one-word status (e.g. `No gym` / `Can't start here`), or fall back to the routine's own sets × reps without loads.

**S3. The plan day's lines can differ from what Start opens.**
`apps/mobile/src/services/workout-services.ts:3877` runs the dry run without `todayEdits`. Today's Up next (`:3903`) and the overview do apply them. If Ben edited today's workout, the plan day shows the old sets or loads, and Today and the overview show the new ones. Fix: use the same edited preview path (`todayFor` + `todayEdits`) as `next.preview`.

**S4. After the toast is gone, End plan can't be reversed.**
`YourPlanBlock.tsx:57`.
- Undo only lives in the toast and is lost on a force-close or when the toast times out.
- After that, the coach card reads `Ended` with no action, and nothing else in the app brings the plan back.
- Rule 2 is met for the moment of the change, but a mistaken End can't be recovered later.
- Fix (PM/Ben): add an `Use again` action on an ended plan's card (the same `resume` write), or confirm with Ben that this is intended.

**S5. A failed overview read silently hides the block.**
`apps/mobile/src/screens/routines/WorkoutsScreen.tsx:65` uses `.catch(() => null)`. A storage error looks the same as "no plan": the plan's days drop back into the full list and the block disappears with no status. Fix: tell `error` apart from `null` and show the usual one-line `Couldn't load` with Try again.

**S6. The planned line misdescribes top-set/back-off and mixed schemes.**
`packages/domain/src/progress/plan-overview.ts:215,298-299`.
- `isPrescribed` counts a `top` set, while load and reps are each the most common value.
- So a 1 top set at 95 plus 3 back-offs at 85 reads `4 × 6–8 · 85 kg`.
- Fix: exclude `top` from the count and show it separately (e.g. `95 kg top, 3 × 6–8 · 85 kg`), or fall back to `4 sets` when the sets differ. Add a test.

## Nits

- N1. The Undo tap (`YourPlanBlock.tsx:59`) makes a new op ID on every tap. A fast double tap gets "Out of date. Nothing changed." after it actually succeeded. Keep one op ID per toast.
- N2. `PLAN_OVERVIEW_COPY.resumed` ("Plan back in use") is defined but never shown. Either use it or remove it.
- N3. `YourPlanBlock.tsx:160,190` hard-code `fontSize` 11/12 on the `Next` tag and the ring number, so they ignore Dynamic Type.
- N4. The plan name (`YourPlanBlock.tsx:78`) isn't a header. Only the `YOUR PLAN` row is, and VoiceOver's header rotor would land better on the name.
- N5. The in-page `End this plan?` confirm doesn't move VoiceOver focus or announce itself.
- N6. `Last …` on the plan day is formatted in the session's tz, while the block uses the profile tz. That's harmless now, but it's inconsistent.
- N7. `overview()` runs a full Up next dry run on every Library › Workouts load. Watch the load time on the device.
- N8. `est.` only shows with no history. A load that is estimated even though history exists (if that path can happen) isn't labelled.

## Tests

The edge cases are well covered: weeks and boundaries, Apply mid-week, ended/superseded/open plans, no goal, added sets, kg/lb/per-hand/assisted/cardio, End retry/stale/force-close, and Undo when another plan was applied or a day changed. Gaps:
- B1: no test that the prefilled coach turn reaches the plan.
- S1: no navigation test with a plan day on the stack.
- S2: no test of the no-gym plan day.
- S6: no top-set test.

None of the screens has been rendered on a simulator or the device.

## Spec issues

- SP1. There is no `docs/design/` spec for Your plan or the plan day; only a mockup existed, and it was deleted. The review can't check mockup details (spacing, exact labels, `Start` vs `Start Pull`). A designer should record the approved layout.
- SP2. Ending a plan applied with `Replace my workouts` leaves the rotation empty, because End doesn't restore what Replace took out. Ben should decide whether End restores the previous rotation (developer Q1).
- SP3. `Targets hit` shows on every exercise, not only the main lift as in the mockup (developer Q3). Ben should decide.
- SP4. "Ask coach to change" assumes the coach can revise an applied plan, which the plans slice doesn't support (see B1). The spec should say whether that belongs here or in a coach slice.
