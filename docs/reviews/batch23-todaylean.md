# Review: Lean Today, Today's options on Your workout, one shared fit (D3, D7 split, D9), track `todaylean`

Branch `claude/todaylean-23oct`, eight commits on `9261625` (790968a, e5fb5e1, 57dfe10, cb98f32, 82e8cf0, 815277e, e46b9a8, 4255d4e). Measured against Ben's decisions D1–D9 (22–23 Oct), CLAUDE.md, `fit-to-time.md` and `workout-builder-v3.md`. The design track's 23 Oct edits to both specs are still uncommitted in the main tree, so I read them there and mark them as proposals where they are. The design review is `docs/reviews/batch23-design.md` on main.

## Verdict: CHANGES NEEDED

The lean card, the Profile split rules and the plumbing for Today's options are solid. Every option change is one versioned write under an op ID, a stale one is refused, and Undo still works once after a relaunch (all tested). Two things block:

- **B1.** The shared fit often cuts far more than it needs to. It drops a whole exercise and never puts it back, so Ben gets a workout 4–8 minutes shorter than the Time he picked, and noticeably less training than fits.
- **B2.** A draft Today's card has already fitted loses its fit record when it opens in Your workout. With D3 this is the main route to Abs, Supersets, Accessories and Main lift. Time there can't bring anything back, the note and Undo are gone, and the Start prompt offers to write Today's Time cuts into the plan.

The D9 carry-over offer isn't built. The builder said so, and the open questions are real (see SP1).

## Checks run by the reviewer (in `/home/user/wt-todaylean`)

- `npm run typecheck`: exit 0.
- `npm run lint`: exit 0, no problems.
- `npm run test`: 475 files, 8,820 passed, 2 todo, exit 0. This matches the builder's report.
- Probes. I ran these as temporary test files and deleted them afterwards, so the tree is clean:
  - **Exhaustive fit comparison.** On the domain fixture's Chest and Legs days, with Supersets on and off, I compared `fitToMinutes` against a brute-force search over every 0 / 2..n set choice per accessory, at shortest rests, with the same pairing and the same limit.
  - **Today's card sweep.** On the real-app fixture, every 5 minutes from 60 down to 15, on Push, Pull and Legs.
  - **Today, Edit, then Your workout.** Time up, Abs on, and the Start prompt after a Today fit.
  - **Today's control against the same option on Your workout.** Accessories Varied, Abs on/off and Supersets on/off.
  - **The workout's `+N min` offer.** From 2 to 300 minutes over.

## Rule check

- **Rule 1 (offline, honest AI):** met. Every change here is local. The lean card never asks the coach for a Mix it up pick, and a test checks that no model call is made.
- **Rule 2 (no silent change, proposals with Undo):** completed sets are untouched. Every option change has Undo. But B2 leads to the old Start prompt listing the fit's cuts as plan changes (`Update Push · bench press in your plan`), so one tap can make a today-only Time cut permanent.
- **Rule 3 (coach offers):** not touched by this track. D2 is on `v5offers`.
- **Rule 4 (achievable loads):** the fit never changes a load, and a test covers per-hand, assisted and stack loads. Pain-flagged exercises are kept out of the pool that Abs on and Accessories add from (`builder-env.ts:271`).
- **Rule 5 (idempotent, versioned):** met for `setTodayOption` (op ID, `expectedVersion`, stale refused, replay writes nothing; tested, including after a force-close).
- **Rule 6 (no invented data):** met. Minutes keep their `~`.
- **Rule 9 (pain):** no change.
- **Minimal copy:** met. `Time · −1 exercise ›`, with the detail behind the tap. `Time changes: …` is used only as the VoiceOver label.

---

## Blocking

### B1. The shared fit drops more than it needs and never re-adds a dropped exercise

**Where:**
- `packages/domain/src/builder/fit.ts:265–288`: the cut loop, then `restoreSets`.
- `fit.ts:327`: `restoreSets` only gives back *sets* taken by a `sets` step. An exercise that was dropped never comes back, even when it fits.

**What goes wrong:** the greedy, one-cut-at-a-time path can dead-end. It keeps an exercise early, then has to drop that whole exercise at the end, and the minutes it frees go unused. Against the brute-force search on the domain fixture, 49 of about 170 fitted minute values lost more training than an achievable fit at the same Time. Examples (FIT_SET_VALUE units):

| Day, Supersets | Time | `fitToMinutes` keeps | An achievable fit keeps |
|---|---|---|---|
| Chest, on | 35 min | bench, pushdown 3, crunch 3 (value 12, **~29 min**) | bench, cable fly 3, pushdown 3, crunch 3 (value 18, ~35 min) |
| Chest, on | 44 min | value 21, ~39 min | value 25, ~43 min |
| Chest, off | 27 min | bench only (value 0, **~21 min**) | bench, crunch 3 (value 7.5, ~27 min) |
| Chest, off | 35 min | bench, incline DB 3 (value 9, ~30 min) | bench, machine press 3, crunch 2 (value 14, ~35 min) |
| Legs, off | 35 min | value 9, ~30 min | value 14, ~35 min |

The real app shows the same gaps on Today's card (`today-session.ts:841` through `assembleTodayDraft`):

- Push, Supersets on, `Time 40`: the card reads `~34 min`. It drops Incline dumbbell press and keeps Triceps pushdown.
- Push, Supersets off, `Time 30`: `~26 min`, `−3 exercises`.

**Failure:** Ben has 35 minutes and sets Time to 35. The card says `−2 exercises` and `~29 min`. Six minutes and a third of the accessory work are thrown away that fit.

This breaks:
- the fit's own contract ("only as far as needed", `fit.ts:10`);
- D9's "the cheapest cut".

The same overshoot reaches the workout's `+N min` offer (S5).

**Why the tests miss it:**
- The sweep (`builder-v3-build.test.ts:256`) checks only that value never *rises* as Time drops.
- "Only as far as needed" (`:228`) checks only that no *set* could come back. It never checks a dropped exercise.

**Fix:**
- Either: after the loop, a restore pass that tries each dropped exercise (at 2 sets, then more) and each cut set, most valuable first, keeping whatever still fits.
- Or: the design track's 23 Oct proposal, an exhaustive search over keep-at-2..n or drop per accessory (at most about 4^6 estimates; cache per card), with ties broken by fewer sets lost, then more of the time used. That is Ben's call (SP2), but either way the overshoot has to go.
- Add a test, for every day shape and minute: no dropped exercise at 2 sets and no cut set can be added back while the workout still fits. Also add a brute-force comparison on the small fixture.

### B2. A draft Today's card already fitted loses its fit in Your workout: Time can't restore it, and Start offers the cuts as plan changes

**Where:**
- `apps/mobile/src/services/today-session.ts:945–957` (`versionOf`): Today writes `setup.minutes` = Today's Time, and no `timeFrom` or `timeFit`.
- `builder-service.ts:1075` (`setupMinutesOf`) and `:1431` (`setTime`): the fitted workout is treated as the original.
- `:1501` (`changeSetup`): `lengthKept` is false, so no refit.
- `:1764` (`startPrompt`): `untimed` has nothing to strip.

**What goes wrong:** this is the previous review's S1/SP6, which the PM resolved on 23 Oct: "for a draft Today's card already fitted, 'the original' is the plan day's full workout". It wasn't built, and D3 now sends every option change through Edit. Probes on the real-app fixture:

1. Push, Today `Time 20`, so the card shows `Time · −3 exercises ›` with only Bench press left. Ben taps `Edit`.
   - Your workout shows `Time 20` with **no note and no Undo**.
   - Ben steps Time to 60. Time reads 60 and the workout is still Bench press only, about 20 min.
   - Back on Today the card reads `Push · edited`, 1 exercise, with **no Time control**, only `Back to plan`. The only way to get the plan's exercises back is `Back to plan`, which also throws away his edits.
2. Today `Time 20`, `Edit`, then `Abs on`. The workout is now about 26 min with `⚠ Over 20 min`. No refit happens, although §2.3a says a control "loads Today's draft for that choice at today's Time".
3. Today `Time 30`, `Edit`, then Start: `startPrompt` lists `Delete Incline dumbbell press`, `Delete Triceps pushdown` (the fit's cuts) and offers `Update Push · bench press in your plan`. One tap writes a 30-minute day into the plan. That is the same failure as the earlier review's B1 ("a today-only cut has become the plan"), now on Today's path.
4. The Abs switch on Your workout reads `off` when Today's fit dropped the abs (`builder-service.ts:1575` reads the workout, not Ben's choice).

**Fix:**
- When Today commits a fitted card, store the fit as Your workout does:
  - `timeFrom` = the plan day's length;
  - `timeFit = { base: <the un-fitted Today draft>, dropped, cut, paired }` from `d.fit.steps`.
- `setTime`, `retimed`, `untimed`, the Time note and its Undo then all work unchanged.
- Add tests:
  - Today Time 20 → Edit → Time 60 gives back the full plan day;
  - the note and Undo show on Your workout;
  - Abs on refits at Today's Time;
  - `startPrompt` lists no Time cut.

### Merge gate (not a code finding)

Don't merge this branch ahead of `v3summary` (D1).

- Before this branch, Ben could turn Abs off on Today's card and Start went straight in.
- Now any option change makes the card `Edited`, and Start shows the old `Use these changes for` prompt that D1 removes. Probe 3 above shows that prompt carrying Time cuts.

The builder flagged the prompt. The B2 interaction is new.

---

## Should fix

### S1. Today's options on Your workout go stale after Undo, an edit or a Time change

- **Where:** `BuilderWorkoutScreen.tsx:222–262`. `undo`, `edit` and `setTime` never refresh `todayOpts`. Only `reload` (`:164`) and `setTodayOption` (`:279`) do.
- **Failure:** Ben taps `Abs on`, then the toast's `Undo`. The ab exercise goes, but the switch still reads on. His next tap sends `on: false`, which changes nothing (replayed). It takes a second tap to add abs. The same happens with `Accessories` after Undo, and with the Abs switch after he swipes the ab exercise away.
- **Fix:** return the options in `BuilderSnapshot`, worked out from the same draft, so every write refreshes them. Or refetch after every write and Undo.

### S2. An option on Your workout doesn't give what Today's same control gives

- **Where:** `builder-service.ts` `setTodayOption`, which goes through Set up's `mergeSetupChange`. `merge.ts:61`, `:128` (`applyAccessoryStyleTo`).
- **Failure, from the probes on Push at 60 min:**
  - `Accessories: Varied` on Today adds one exercise in 3rd place. On Your workout it adds a different exercise in 4th place.
  - `Supersets on` on Today pairs and refills the time to about 50 min. On Your workout it pairs to about 44 min and leaves 16 min of the plan's length unused.
  - Abs on/off matched.
- **Spec:** §2.3a acceptance (4), a 23 Oct design-track proposal: "the rows after any control change equal what Today would draft for that choice at that Time, with Ben's edits on top".
- **Fix:** build the option's draft with Today's `assembleTodayDraft` at the draft's Time, then replay Ben's edits. Or get Ben to accept merge semantics (SP5). At minimum, refit at Time after the merge (needs B2).

### S3. The options sit at the bottom of Your workout

- **Where:** `BuilderWorkoutScreen.tsx:792`, after `Add exercise`.
- **Failure:** on a 6-exercise day, Ben scrolls past the whole table to reach Abs or Supersets. These were one tap on Today's card before D3.
- **Spec:** §2.3a puts them in a compact table under the title.
- **Fix:** move the block above the coach line and the table.

### S4. An edited lean card loses Time

- **Where:** `TodaySession.tsx:602` and `today-session.ts:828`.
- **Failure:** D3 lists "an inline Time control (with the fit note)" as one of the lean card's four parts, and the spec says "Time refits around it". With D3, any option change makes the card edited, so Today's Time disappears after one tap on Your workout.
- **Fix:** keep Time on the edited card, driving `builder.setTime` on that draft. This needs B2 so it has a fit record.

### S5. The workout's `+N min` offer changed its approved order, and its test was weakened

- **Where:** `packages/domain/src/session/time-fit-today.ts:279` (the shared cut) and `test/time-fit-today.test.ts:293–298`.
- **Failure:** Ben approved workout-table-v3 §5 on 20 Oct ("shorter rests → RPE 9 → fewer sets → drop an exercise"). The CHANGELOG (2026-10-21) adds that the fit "stops at half of the remaining sets' length". Now:
  - The first cut can be a whole exercise. At 8 min over it skips Lateral raise and saves 13 min.
  - The test that held the half floor (`afterMinutes ≥ before/2 − 1`) became `afterMinutes > 0`.
  - The probe at 300 min over: target 17, result 14, so below the floor. At 16 over the status reads `over` even though the result is under target.
  - The report doesn't mention the change.
- **Fix:** either keep §5's order for `timeFitOffer` (a ladder option on the shared fit) and restore the floor assertion, or put the change to Ben and record it in the CHANGELOG. B1's fix also removes the overshoot here.

### S6. Supersets on Your workout reflects the draft, not Ben's choice

- **Where:** `today-session.ts:949`. `supersets` is stored as "the draft has a pair". With Supersets on but nothing pairable, Your workout shows `Supersets off`, and its Time fit then never pairs.
- **Fix:** store `controls.supersets`.

---

## Nits

- **N1.** Toast copy (`builder-service.ts:317–328`):
  - a main-lift change says `Rebuilt`, where the spec has `Main lift: Incline`;
  - `Accessories varied` should be `Accessories: Varied`.
- **N2.** Much of `today-lean-23oct.test.ts` asserts source text (`toContain('const mixShown = !view.lean;')`, `:134–145`, `:191–193`, `:376–389`). It breaks on renames and proves nothing about behaviour. Prefer the screen-rule functions or a render test.
- **N3.** No-plan Today's `Edit` also passes `back: 'Today'`, so Your workout shows Accessories, Abs and Supersets under the no-plan card's own controls. The spec shows them only from Today with a plan.
- **N4.** `fitCarryOver` (`fit.ts:308`) returns only the group that lost most. The design track now routes each cut muscle to its own next day. Align it when the offer is built.
- **N5.** Today's Time choice lives only in screen state until Edit or Start, so a force-close loses it. This predates the branch and is low stakes, but Time is now the only control on the card.

## Not built

- **D9 carry-over offer.** Only the pure `fitCarryOver` exists. Nothing offers it, applies it or undoes it. The builder disclosed this and gave reasons (SP1). Ben's D9 includes it, so the decision stays open until it ships.

## Spec issues (for Ben and the designer)

- **SP1. How a carry-over lands.** The builder's questions stand: where it waits before a draft exists and what version it's checked against, when it's written (today's fit isn't saved until Start), which day is "next" for arms or abs, what the next day's own Time fit may do to it, and when it expires. The design track's 23 Oct proposal settles some of this (an offer, per muscle, at most 4 in all) but not landing or expiry. It overlaps D8's waiting change (design review SP5).
- **SP2. Fit optimality.** D9's wording ("the cheapest cut by training lost per minute") reads as a greedy cut. The design track's 23 Oct proposal is "the least training lost overall". B1 has to be fixed either way, but Ben should pick one: exhaustive (nested results aren't guaranteed, as the builder noted) or greedy with a re-add pass.
- **SP3. `↻ Mix it up`.** Ben approved it on 20 Oct. It is now gone from Today with a plan and isn't on Your workout. D3 doesn't name it, and the design track lists it as pending (Q-R6).
- **SP4. Time range.** Today is specified as 20–120 and Your workout as 15–180, for the same stepper. The app uses 15–180 for both.
- **SP5. What an option change does.** The spec wants Today's draft for that choice at Today's Time, with Ben's edits replayed. The app uses Set up's merge, which keeps edits. Decide which.
- **SP6. Mid-workout `+N min`.** Does it follow the 22 Oct revision too (S5)?
- **SP7. No-plan Today.** D7's "remove the duplicate chip row" assumes the spec's Profile-split day row, which the app doesn't have yet. There is no duplicate in the app.
- **SP8. Spec baseline.** The 23 Oct spec text this review cites is uncommitted in the main tree. It should be committed before the fix round so builder and reviewer read the same thing.

## Tests

Covered well:
- options as versioned, idempotent writes with Undo, including after a relaunch;
- Accessories style merge, including Ben-edited sets kept;
- Main lift following back to Today;
- the Profile `Set by your plan` views;
- fit value weights;
- the Supersets-off rule;
- monotonic value as Time drops.

Missing:
- dropped exercises re-added when they fit (B1);
- Today fit → Edit → Your workout Time, note, Undo and Start prompt (B2);
- options refreshing after Undo (S1);
- option parity with Today (S2);
- the half floor of the `+N min` offer (S5, weakened).
