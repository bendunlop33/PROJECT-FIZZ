# Review: Active workout v3 core slice, logic lens (21 Oct 2026)

Branch `claude/wo-v3-20oct`, `f16d3f5..baf0d54` (5 commits). Spec: `docs/design/workout-table-v3.md` (approved 20 Oct). Lens: rules 2 and 5, superset order and rest placement, rest alerts, force-close, swipe-delete Undo, `+ Set`, round change selecting (never logging), edge cases, test quality. Out of scope (later or other branches): builder pop-up, Swap pop-up, Type picker, drag, superset link/unlink, coach ask bar, untick-restores-rest, time-over Apply.

## Verdict: **CHANGES NEEDED**

Checks run in the worktree: `npm run typecheck` passed. `npm run lint` passed. The targeted vitest files (rounds, table, inline entry/cell, keyboard, set pager, domain table-view) passed: 143 tests. The full suite `npx vitest run --maxWorkers=2` passed: 418 files, 7942 tests, 1 todo. No migrations changed.

What holds up:
- Every write goes through existing versioned commands. Delete uses `delete_set` with `expectedSetVersion` and a fresh opId, then `undo_op` with a derived opId. Untick uses `undo_log` with the deterministic `undo:<id>:<undoCount>`, the same ID as the toast's Undo, so a double tap is idempotent. Corrections are unchanged. Stale writes are refused by the domain and trigger a reload.
- A round change only sends `set_active_set`. `Next round` and the off-round pill only select; nothing logs. On relaunch the round with the stored active set shows (`pickedRound` starts null). Rest alerts, the notification and the Live Activity code paths are untouched; the bar only switches to the SET clock when the rest has ended.
- The superset a → b order comes from the domain's `rounds`, the same `unitsOf` order as `buildExecutionOrder`.

---

## Blocking

### B1. Set numbers disagree between the table and every toast/sheet once an exercise has warm-ups
- `apps/mobile/src/workout/rounds.ts:111` numbers working sets 1..n and skips warm-ups (spec §2). Everything else still uses the domain number from `setDisplayNumbers`, which counts warm-ups (`packages/domain/src/session/order.ts:138-151`):
  - log toast `✓ Set N saved · Undo`: `WorkoutScreen.tsx:797` (`focus.setNumber`)
  - the just-saved line: `WorkoutScreen.tsx:1711`
  - correction toast `Set N updated` with Undo: `WorkoutScreen.tsx:1137`
  - `Set N added`: `WorkoutScreen.tsx:1309-1310`
  - the per-set sheet title: `WorkoutScreen.tsx:1044`
  - menu delete `UNDO_TOAST.deleted(f.setNumber)` / `next.number`: `WorkoutScreen.tsx:907, 985`
  - the rest editor's `Rest after set N`, and the EditSet screen
- **Failure:** Bench has 2 warm-ups and 3 working sets. The pill reads `Set 1 · Log 100 kg × 5`. Ben taps it and the toast says `✓ Set 3 saved · Undo`. When he corrects the row labelled `2`, the toast says `Set 4 updated · Undo`. The Undo toast names a set that doesn't exist in the table, so Ben can't tell what the Undo will revert (rule 2: visible change with Undo). VoiceOver says the same wrong numbers.
- **Fix:** add one domain helper, e.g. `workingSetLabels(exercises, sets): Map<setId, { number: number | null; warmup: boolean; name: 'Set 3' | 'Warm-up' }>`, built on `buildExecutionOrder`. Have both `roundRows` and `FocusView.setNumber` / `justSaved.setNumber` / `ExerciseCardFacts.nextSet.number` / `addSet` use it. Then every toast and sheet uses `stepName`. Test: an exercise with 2 warm-ups where log, correct, add, and delete all name `Set 1`.

### B2. A side companion (`L` then `R`) is numbered as a new set, and every later set shifts by one
- `apps/mobile/src/workout/rounds.ts:108-113` increments `n` for every non-warm-up row. After a single-side log, the domain adds the other side as a paired pending row (`reducer.ts` R4, `pairedWithSetId`), and that row gets its own number. `progressOf` (`rounds.ts:137-140`) also counts it as a separate set.
- **Failure:** Bulgarian split squat, 3 sets. Ben logs set 1 `Left`. The rows read `1L`, `2R`, `3`, `4` with progress `1/4`, and the pill reads `Set 2 · Log …` for the right side of set 1. The overview `Sets` column and the strip's VoiceOver count are wrong too. The test was written to match the bug: `apps/mobile/test/workout-rounds.test.ts:162` asserts `['1L','1R'].map((x,i) => i===0 ? x : '2R')`, which equals `['1L','2R']`.
- **Fix:** expose `pairedWithSetId` (or a `companion: boolean`) on `TableRow`. Give a companion row its head's number and don't count it in `progress`/`doneSets`/`totalSets`. A pair is one prescribed set, as the domain already treats it in `unitsOf`. Rewrite the test to expect `['1L','1R','2','3']` and progress `x/3`.

---

## Should fix

### S1. Fast round changes bounce the page back (a select resolving late resets the pick)
- `WorkoutScreen.tsx:471-474` resets `pickedRound` on every `activeSetId` change, and `goToRound` (`:1079-1090`) fires a select per move. `selecting` is a single boolean, so the first `finally` clears it while a second select is still in flight.
- **Failure:** the open row is in round 2. Ben swipes to 3, then quickly to 4. The select for 3 is in flight, and the one for 4 is refused as stale (quiet, then reload). The select for 3 commits, `activeSetId` changes, and the effect sets `pickedRound = null`. The page jumps back to round 3 after Ben is already looking at 4. The same happens if he swipes 2 → 3 → 1 (a done round): he ends up on 3.
- **Fix:** tag each `goToRound` with a sequence number and keep `pickedRound` unless the change came from that latest request. Better, only reset the pick on log, untick, delete and relaunch, not on a select Ben started. Alternatively serialise selects (drop or queue the stale one and re-issue it for the final pick). Make `selecting` a counter. Add a pure test with two picks where the earlier one resolves last.

### S2. The off-round pill says "Log …" but only selects
- `WorkoutScreen.tsx:2253-2258`: when the shown round has sets to do but isn't current (a select in flight, refused, or `set_not_pending`), the pill keeps `primary.label`. That label is the other round's set, e.g. `Log 100 kg × 6`, but tapping it only runs `goToRound`.
- **Failure:** the select is refused with `write_conflict`. Ben sees `Log 100 kg × 6` under round 4's Lateral raise. He taps it and nothing is logged. Or he believes the bench set was logged when it wasn't. A button that says Log must log the set it names.
- **Fix:** label the pill with the shown round's first pending step, e.g. `stepLabel({ member, stepName, primary: 'Start' })`, or `Go to set 1`. Keep `busy` while selecting. Add a test on the pure label.

### S3. A round change during a running work timer moves the active set off the timed set
- `goToRound` → `selectRow` → `set_active_set`. `handleSetActiveSet` (`packages/domain/src/session/reducer.ts:759-766`) doesn't check `workInterval`, while `undo_log`, `delete_set` and skip do refuse with `work_interval_running`.
- **Failure:** a 45 s plank runs in round 2. Ben swipes the card to glance at round 3, which v3 makes a single accidental horizontal drag. Round 3's set becomes active, and the pill now logs round 3's set while the plank's timer keeps running on another set. The work-end tick then writes a draft to a set that isn't current.
- **Fix:** refuse `set_active_set` in the domain while a live work interval belongs to another set (`work_interval_running`). In `goToRound`, show the round without selecting while the timer runs (the pill shows `offRound`, see S2). Add tests in both places.

### S4. Test gaps on this lens's edge cases
The e2e test (`workout-table.test.ts:372-439`) covers only two plain exercises. These are missing:
- A superset through the real domain: after 3a the open row is 3b with no rest started; after 3b the rest starts; `firstPendingSetId` for a superset with uneven member lengths and a `roundOffset`.
- A swipe-delete of a **done** set, then Undo (audit `deleted` with `before.status === 'completed'`, and the undo-log window ends).
- Relaunch (`h.launch()` again) mid-superset lands `shownRoundIndex` on the right round, after a `goToRound` select too.
- `goToRound` → select → log through the services: the log lands on the shown round's set, and a duplicate `set_active_set`/`delete_set` opId is a no-op.
- `buildRounds` / `whyView` / `loadWords` with lb (`LB` header), per-dumbbell (`KG EACH`), assisted (`ASSIST KG`, `topSet` null), bodyweight (`+KG` / no load column) and cardio rows (no RPE, `valueHeader`). Today only `topSetOf`'s bodyweight/assisted null has domain coverage.
- Many warm-ups: box anchoring with 4 warm-ups, plus B1's numbering.
- The `L`/`R` test fixed per B2.

### S5. `+ Set` copies the last live set of any type, not "the last working set"
- `workout-services.ts:3101` sends `setType: null`, so `handleAddSet` (`reducer.ts:1126`) copies `live.at(-1)`. That can be a `drop`, a skipped set or, on a warm-up-only exercise, a warm-up.
- **Failure:** the plan is top + 2 back-offs + 1 drop. `+ Set` adds another drop set with the drop's reduced load and short rest. Spec §2 says "adds a set like the last working set".
- **Fix:** pass the type of the last non-warm-up set of the exercise, or decide with Ben that copying the last set is intended and update the spec. Add a test. (The toast number in `addSet` is covered by B1.)

---

## Nits

- N1 `rounds.ts:325-327`: `Next round` can go backwards. If no round after the shown one has sets left, it wraps to an earlier round under a "Next" label. Use `Back to round N`, or point it at the current round.
- N2 `WorkoutScreen.tsx:2877`: when the rest set is a warm-up, `restRow?.r.number ?? restRow?.r.row.number` falls back to the domain number, so the toast reads `Rest after set 3`. Use `stepName` (B1).
- N3 `WorkoutScreen.tsx:2265` / `rounds.ts setClockStartMs`: after Resume, the SET clock includes the paused stretch. Subtract `session.pausedMs` accrued since the start point, or restart from the resume time.
- N4 `packages/domain/src/session/table-view.ts:424-425`: `topSetOf` compares `load.value` across units. If an exercise mixes kg and lb sets (a gym switch), `45 lb` beats `40 kg`. Convert with the domain's unit helper before comparing.
- N5 `rounds.ts:549`: overview `current: i === shown`. Spec §4 says "current round bright". When Ben opens the overview from a done round he's browsing, the done round is bright and the round actually in progress isn't marked. Pass both values, or use `r.current`.
- N6 `WorkoutScreen.tsx:876`: an untick refused with `work_interval_running` reads `Can't undo: set 3 changed`. Map that code to `Stop the timer first`.
- N7 `WorkoutScreen.tsx` `whyFor`: after a log the sheet stays open for the next anchor set with no reason (`whyEvent('logged')` clears the panel but not `whyFor`). Close the sheet on `logged`.
- N8 `rounds.ts:212-215` `selectOnShow` always selects the superset's first pending set in a → b order. If Ben had deliberately made 3b current, swiping away and back resets it to 3a. Acceptable, but worth a line in the spec.

---

## Spec issues (for Ben / designer)

1. **Browsing rounds rewrites the current set.** §3 says "Log logs the shown round's current set". The build does this by sending `set_active_set` on every swipe or strip tap, so glancing at round 4 changes the persisted current set. That also changes what the Live Activity, the notification and the coach context treat as "next", and it interacts badly with a running work timer (S3). Alternative: keep the stored current set as it is and let Log on another round send `set_active_set` + `log_set` only when Ben taps it. Ben should choose.
2. **Superset rounds pair warm-ups with working sets.** The domain's `unitsOf` treats each warm-up as a round unit. If 3a has 2 warm-ups, round 1 is `3a W` + `3b set 1` and the rest after the round follows a warm-up. §3's "a → b → a → b" doesn't say whether warm-ups should run before the superset starts. This is pre-existing domain behaviour that v3's round page makes visible. Needs a decision.
3. **§3 "untick" vs the domain.** The spec implies tapping any done ✓ unticks it. The domain only allows the latest log (`not_latest_set`), and the build shows `Only the last set can be unticked`. Rule 2 supports keeping that limit; the spec should say older sets are corrected, not unticked.
