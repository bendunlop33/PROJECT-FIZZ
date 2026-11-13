# Review: gym switch and shared re-snap (`claude/gym-switch`)

**Verdict: CHANGES NEEDED**

Reviewer: independent reviewer agent, 2026-10-10.
Scope: `git log claude/gracious-knuth-joxqpw..HEAD`, 12 commits (637a714 … 62bc7f7), 42 files, about +4.2k lines.
Checked against `docs/design/gym-switch.md` (GS1–GS13, §7 checks 1–26), ADR 0019, CLAUDE.md rules 2–6, 9 and 10, brief §10 ("Switch to a hotel gym mid-session …"), and competitor-landscape #2(g) and #6.

## How this was checked

- `npm run check`: typecheck and lint pass, and so do `catalogue:validate`, `guide:check --all --verify` and `guide:motion --all`. `vitest run` gives 1434 passed and 2 failed, in two runs. Both failures are 5 s **timeouts** in catalogue drawing tests (`figure.test.ts`, `motion-r3.test.ts`, `definition.test.ts`). This branch doesn't touch those files, the machine's load average was about 10 from other agents running at the same time, and the same files pass when run alone (50/50). They don't count against this branch, but they make `npm run check` flaky (see N8).
- I read every domain, schema, persistence, service and screen change.
- I ran throwaway probe tests (deleted afterwards, not committed) against the real reducer and fixtures to confirm B1, B2 and M1 below.

What is good: one pure `snapPlanToGym` is now the only path for Start, Repeat, the switch, `[Use changes today]` and `Add set` after a switch, and it has a seeded property test. Completed sets keep their row and equipment (GS6), and their `planned` and `actual` are never rewritten. `change_gym` is opId-idempotent and bound to a plan fingerprint, so a stale card can't apply (rule 5). Undo is exact and survives a relaunch, because `before` is stored in `gymChanges`. Pain holds loads in the switch modes (rule 9). Repeat B1 is closed through the shared path. Persistence round-trips schema 4, including backups from older schemas. Nothing calls the coach or the network. No secrets and no logging of health data were added.

## Blocking

### B1. Repeat and "Start next session" of a switched workout duplicate the split exercise, and next-session doubles its sets
`packages/domain/src/session/repeat.ts:80` (`for (const sx of sorted)`) and `:108` (`input.targets?.get(sx.exerciseId)`).

Continuation rows (GS6) mean that an exercise done at two gyms is two `session_exercises` rows. `startWorkoutFromSession` still builds one routine exercise per **row**:

- **Repeat.** Failure path: Incline DB press, set 1 logged at Main (32.5 kg each), switch to Hotel, sets 2–3 logged at 20 kg each, Finish, then Repeat at Main. The new workout has **two** Incline DB press exercises, `[32.5]` and `[20, 20]` (confirmed by probe). This is the case `summary.ts` and `active-view.ts` already merge with `partRootOf`; Repeat doesn't.
- **Start next session.** `targets` is keyed by exercise ID, so **each** part receives the full target list. With 3 built-in-rule targets of 35 kg each, the new workout has **6** sets of 35 kg each (probe: `[[35,35,35],[35,35,35]]`). Ben's next session silently doubles an exercise's volume, which breaks the deterministic-targets promise (rule 3).
- `Past workouts` lists the name twice for the same reason (`apps/mobile/src/services/workout-services.ts:792`).

Fix: in `startWorkoutFromSession`, group source rows by `partRootOf` into one routine exercise per block. Copy all of the block's done sets in execution order. The source equipment for the fit is the **last** part's item, or each set's own item if parts are kept per set. Apply `targets` once per block. Dedupe names at line 792. Add tests: Repeat and next-session of `finishedAcrossGyms()` give one Incline exercise with 3 sets.

### B2. The Summary labels a whole split exercise with the first part's unit and convention (kg/lb mislabel of completed sets)
`packages/domain/src/session/summary.ts:202` and `:209–215`.

Each part's results are rendered with `compact: true`, which drops the unit (`display.ts:108`). The header's `unitNote` is taken only from `first`. Failure path, confirmed by probe: Incline DB press, 1 set at Main (kg dumbbells), switched to a gym whose dumbbells are in lb, 1 set logged at 70 lb each. The Summary reads `2 sets (kg each) | 32.5×9 (Main Gym) · 70×10 (US Hotel)`, which presents 70 **lb** as 70 **kg** each. The same happens when GS3 step 4 maps plate-loaded to a stack (`(kg stack)` versus plates). CLAUDE.md says kg/lb and convention are always explicit, and the brief's summary must not misstate logged work.

Fix: when the parts' `unit` or `loadConvention` differ, put the unit and convention on each part's text (for example `32.5×9 kg each (Main Gym) · 70×10 lb each (US Hotel)`) and drop the shared `unitNote`. Otherwise keep today's text. Add a test with a kg→lb switch.

### B3. With 5 or more change lines, the review sheet has no Out of date or write-error state, so `Switch` fails silently
`apps/mobile/src/screens/workout/GymSwitch.tsx:227–271` (`reviewSheetView` in `apps/mobile/src/workout/gym-switch-card.ts:95`), and `WorkoutScreen.tsx:1178`.

With 5 or more change lines, `Switch` exists **only** on the sheet (§2.4, check 21). The sheet doesn't read `isProposalStale` or `card.status === 'error'`:

- If the workout changed while the sheet is open, for example a rest-end tick or a draft save, `Switch` reaches the reducer, gets `stale_version`, and the card behind the modal turns Out of date. The sheet stays open with an enabled `Switch` that does nothing on every tap, and nothing tells Ben why.
- On `write_failed` the sheet never shows `Couldn't switch gym. Nothing changed.` or `Try again`.

This breaks the spec §3.1 states table (Write error, Out of date) and the project's "never a silent failure" rule.

Fix: drive the sheet from `switchCardView` (or a shared state function). If stale, show `Out of date…` with `Check again` and `Dismiss` and hide `Switch`. If there's an error, show the warning line and `Try again` (same opId). Close the sheet when the card is dismissed. Add tests in `apps/mobile/test/gym-switch.test.ts`.

## Should fix (not blocking)

### M1. The reducer doesn't enforce rule 4 for slots with no equipment, though ADR 0019 says it does
`packages/domain/src/session/gym-switch.ts:521–536`.

A slot with `equipmentId: null` passes with any load in the slot's unit and convention, even when the row had equipment. Probe: a `change_gym` that sets Bench press to `equipmentId: null` with `100 kg total` on every set is **accepted** (`ok: true`). The service always builds slots from `snapPlanToGym`, so this isn't reachable from the app today. But ADR 0019 says "The reducer re-checks rule 4 itself", and a future coach or tool path could use it.

Fix: if `slot.equipmentId === null` and the row (or the set's `snap.intendedOn`) had equipment, require `load === null`. Also reject a slot item whose `kind` isn't in the exercise's compatible kinds. Add a reducer test.

### M2. The Log guard starts only after `reload()`, so Log stays live with the old label while the switch commits
`apps/mobile/src/screens/workout/WorkoutScreen.tsx:501–528`.

`labelBefore` is read, the command awaits, then `reload()` awaits, and only then is `setGuard(true)` set. During that window the screen still shows the pre-switch target. A Log tap logs the old values on a set that now belongs to the Hotel row. Check 14 assumes the guard covers the moment the label changes.

Fix: set the guard (or disable Log) from `applying` until the reloaded view is shown, then keep it for `valueChangeGuard` only if the label changed.

### M3. Unsaved in-screen edits aren't re-checked against the new equipment
`WorkoutScreen.tsx:520`.

The screen drops `edits` only if the set is in `proposal.draftsToReplace`, which was computed when the card opened. If Ben edits the load after the card opened (edits don't make it stale, GS7), the reducer replaces the stored draft (`entry.draftsReplaced`), but the screen keeps `edits`. The 300 ms save effect then writes the unfit draft back, and Log shows a load the new gym can't make (GS12).

Fix: after apply, read `r.aggregate.session.gymChanges.at(-1).draftsReplaced` (the reducer's own result) and clear `edits` for those sets.

### M4. After a force-close the open card doesn't come back (spec §3.2 "Restored after force-close, card open")
The ADR documents this, because there's no proposal store yet, and the switch itself is atomic, so no data is at risk. Track it with the coach proposals store (build step 4) rather than leaving it open-ended. Listed so it isn't lost.

## Nits

- **N1.** The stale card shows only the first change line (`gym-switch-card.ts:59`, `lines.slice(0, 1)`). The spec's stale variant keeps the suggested lines in `text.secondary`.
- **N2.** The review sheet's `Not now` only closes the sheet (`GymSwitch.tsx:265`). The card stays open, which differs from `Not now` on the card. Decide whether that's intended, and label it `Close` if so.
- **N3.** `currentGymEquipment` (`equipment-snapshot.ts:45`) unions every snapshot entry for the current gym, including items deleted from that gym's profile between an earlier visit and a switch back. `propose` uses the fresh list, but `Add exercise`, `Add set` and steppers use the union. Prefer the latest appended snapshot for the current gym.
- **N4.** `RepeatScreen` reuses one `startOp` across gym changes on the chip. If a failed or ambiguous start at gym A is retried at gym B with the same opId, it could return A's session. Make a new opId when the chosen gym changes.
- **N5.** `GymChangeSchema` is capped at 50 entries (`schemas/src/session.ts`). A 51st change would make the aggregate fail validation, so every save would fail. That's unlikely, but refuse a change past the cap with a clear message instead.
- **N6.** In `parseGymCommand`, the bare words "no" and "yes" are global (`gym-command.ts:38–39`). When voice is wired, scope them to "a gym card is open", so they can't intercept other voice flows.
- **N7.** Undo restores the pre-switch draft and drops a draft Ben saved after the switch, inside the 8 s window. That matches "restores drafts exactly", but a toast mention would avoid surprise.
- **N8.** Catalogue drawing tests time out at 5 s under parallel load (pre-existing, not this branch). Give them an explicit timeout so `npm run check` is reliable while several agents run at once.

## Tests

The edge-case coverage is strong: the property test (400 cases, all modes, kg and lb, assisted, empty gyms), stale, duplicate and superseded, unilateral and timed exclusions, drafts, SP1, B1, pain hold on switch back, Undo refusal, persistence round-trip, and old-backup restore. Missing:

- Repeat and next-session from a switched workout (B1).
- A Summary with mixed units or conventions across parts (B2).
- Review-sheet stale and error states (B3).
- Reducer rejection of a null-equipment slot with a load (M1).
- The Log tap during `applying` (M2).
- An edit made after the card opened (M3).
- A double switch (Main → Hotel → Home → Main) to confirm continuation chains and `gymRouteIds`.

## Spec issues (for the designer / Ben, not the developer)

1. **§6.1 rule 1 keeps an unchecked load for an unpinned equipped exercise.** A slot whose `sourceEquipment` is null stays `none_needed` and keeps its load ("loads not checked"). For a routine exercise with no pinned item but equipped kinds (barbell bench with `equipmentId: null`), that means a load target that was never checked against the gym, the same rule-4 gap the spec closes elsewhere. Proposal: when the exercise's compatible kinds need equipment, map by kind (GS3 steps 3–4) even with no source.
2. **The spec doesn't say how continuation rows behave outside the workout screen and Summary.** Repeat, Start next session, Past workouts, export and progression history all read rows, and B1 comes from this gap. Add a line to §6.5 and §8: "every reader that treats a row as an exercise groups by `continuesFromId` first".
3. **§3.2 "Restored after force-close, card open" depends on a proposal store that won't exist until build step 4.** Either mark it deferred in the spec or schedule the store. ADR 0019 already records the deviation.
4. **GS-S3 meaning changed in the build** (absent `equipmentVersion` = latest entry, not "the only one"). That's a reasonable change, recorded in the ADR. Update the spec table so the two agree.
