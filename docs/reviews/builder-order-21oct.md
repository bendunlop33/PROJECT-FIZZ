# Review: builder order and pairing (claude/builder-order-21oct, 39b91f3..HEAD)

Reviewer, 21 Oct 2026. Ben's report: "Why is it suggesting superset on main lift rows. Also why is main lift not first" (Build B, Back day, Supersets on).

## Verdict: CHANGES NEEDED

The core fix is right. On a fresh build, the main lift is first and alone, heavy compounds lead and are never auto-paired, and Set up now opens a Back day with Barbell row. The property sweep backs this up. But one path the sweep doesn't cover, raising a group count on Set up (the merge path), still puts heavy compounds after the isolations. With no main lift it puts Barbell row behind the 45° back extension, which is the exact symptom Ben reported. That one is blocking.

## Validation (run by the reviewer)

- `npm run typecheck`: clean.
- `NODE_OPTIONS=--max-old-space-size=6144 npm run lint`: clean.
- `npm run check:migrations`: "Migrations OK: 1 to 32, none reserved or empty."
- Full suite `npx vitest run --maxWorkers=2`: 454 files, 8480 passed, 1 todo. The developer reported 453 files and 8493 passed; the counts differ, but nothing failed.
- Temporary probe tests (deleted afterwards) ran against the real catalogue with the starter-row facts. They covered every day mix and Other session (Full body, Upper, Push), Main lift none and default, the Set up merges, fit grow, and Legs at 30, 60 and 90 min. I also ran the old `today-session` merge test against the new code.

## Blocking

### B1. Raising a group count on Set up appends the new exercise at the end, so heavy compounds land after isolations (and after abs)

`packages/domain/src/builder/merge.ts:66-71` (`mergeSetupChange`, `group_added`)

The new slot goes before the first all-Abs block, or at the end. It ignores the §3.4 bands and the new heavy-first rule. Two more problems make it worse:
- The all-Abs test misses abs that are already paired (`Band triceps pushdown + Ab-wheel rollout`), so the new exercise lands after abs.
- `fit.ts` `insertAfterGroup` got band-aware insertion in this branch, but this sibling path didn't.

Reproduced (starter facts, no history, Supersets on, Back 1 → 4):

```
Main lift none:      45° back extension | Barbell curl + Ab-wheel rollout | Assisted pull-up | Barbell row(H) | Barbell seal row(H)
Main lift Row:       Barbell row* | Barbell curl + Ab-wheel rollout | 45° back extension | Assisted pull-up | Barbell seal row(H)
Chest, Main none:    Assisted dip | Band triceps pushdown + Ab-wheel rollout | Bench press(H) | Cable fly | Chest press machine(H)
```

- **Failure scenario:** Ben opens Set up (Main lift none on a Custom day, or he picks None), taps Back +.
  - Barbell row shows 4th, behind the back extension and after the curl + abs pair. This is "main lift not first" again.
  - With a main lift set, compounds still land after the triceps/abs pair, which breaks rule (c) and "abs last".
- **Fix:** insert with the same band rule as `fit.ts` `insertAfterGroup`. Export it, or move `orderRank` into `arrange.ts` and share it. Treat any block containing abs as the abs band.
- **Tests to add to `builder-order-pairing.test.ts`:**
  - A merge sweep: each day × main set/unset × every group +1…+3 and −1, with Supersets on/off, asserting `expectRules(..., { order: true })`.
  - Set the Abs count to 0 first, so the paired-abs case is covered.

## Should fix

### S1. Coach `swap` keeps a builder pair even when the new exercise is heavy; coach `add` ignores the bands

`packages/coach/src/builder/edit-ops.ts:200-217` (`swap`, via `replaceSlot`, keeps `auto: true`) and `:152-157` (`endIndex`)

- **Swap:** "Swap the back extension for barbell rows" turns the auto pair `45° back extension + Dumbbell curl` into `Barbell row + Dumbbell curl`. That is a builder-made superset holding a heavy lift: the pattern Ben complained about, now coming from the coach. §3.5 advice is silent, because heavy + light is still "allowed".
- **Add:** an add with no `afterSlotKey` puts a heavy compound after every isolation.
- The developer summary says the coach paths "all go through the same domain functions". They don't.
- **Fix:**
  - Run `splitInvalidAutoPairs` after the swap and add ops (Today's Mix it up already does this).
  - Make `endIndex` band-aware, using the shared rank from B1.
  - Add an `applyBuilderEdits` test for both.

### S2. The coach's Set up default main lift disagrees with Set up for a plan day whose template has no main lift

`apps/mobile/src/builder/builder-service.ts:1372` vs `:782`

- `initialSetup` keeps `null` when `templateFor(day, null)` exists, so that template opens.
- `coachSetupContext` always falls back to `defaultMainOf`, and `fill_setup` uses `mainLifts[0]` on a day change (`packages/coach/src/builder/setup.ts:114,124`). So "Set up chest day" through the coach (or offline by code) picks Bench and builds a fresh workout. Picking the same day by tapping opens Ben's template.
- `setupFacts` (`:797`) also lists the default first while the row shows None.
- **Fix:** one helper `setupMainFor(day)` (profile → template-with-no-main ⇒ null → `defaultMainOf`), used by all three. Add a service test with a no-main template day.

### S3. The tests skip the paths where order and pairing actually broke

- The sweep covers `buildFromSetup` and `assembleTodayDraft`.
- It doesn't cover:
  - Set up group merges (B1). Only a Supersets toggle is tested, with `order: false`.
  - Length merges that grow.
  - Coach edit ops (S1).
  - The Other sessions Full body and Upper (`BUILDER_DAY_MIXES` has no Full body, Upper or Arms).
- The fixture's loads are a constant 60 kg stack, so "heaviest by known load" is only covered by the single synthetic unit test.
- **Fix:** extend the sweep as noted in B1 and S1, and add `TODAY_OTHER_SESSIONS` plus an arms-only mix.

### S4. Mix it up can still break band order (known, flagged by the developer)

`packages/domain/src/today-v2/session.ts:233`

A same-role swap can put a heavy compound after a lighter one. With no main lift it can also swap out the leading heavy compound. Pairing stays safe (`splitInvalidAutoPairs`). Now that Set up defaults a main lift, this mostly affects Custom days and an explicit None. One way to fix it is to have Mix it up only swap within the same heavy/light band. Ben should decide.

## Nits

- **N1.** `BUILDER_DEFAULT_MAIN_LIFTS.Back` lists `'barbell-row'` (`packages/domain/src/builder/main-lift.ts:15`), which isn't a catalogue key; it only appears as a legacy starter key. Either note why it's there (legacy rows) or drop it.
- **N2.** Superset connector on Your workout (`BuilderWorkoutScreen.tsx:462`): it is an absolutely positioned line, 34 pt high. Now that the works line wraps, a row can be taller than that, and the line may stop short of the next row. Check on device. The wrap itself is fine and matches the Today strip rule. The source-check test is weak but acceptable.
- **N3.** Ben's Push plan-day card changes order (seen in the adjusted `today-session.test.ts`). It was `Bench | Incline dumbbell press (planned) | Incline bench press (time fill)`. It is now `Bench | Incline bench press | Incline dumbbell press`: a filled-in heavy lift moves ahead of an exercise Ben planned. This follows the new rule (b)/(c), but Ben should see it.
- **N4.** `initialSetup` now calls `envFor` up to three times per open (`:776`, `:782`, `:784`). That's fine for now; reuse the env if Set up feels slow on the phone.

## Product rules check

- No completed-set, persistence, migration, provider or credential changes.
- Writes and proposals are unchanged.
- No AI-status, invented-data or privacy impact.
- Rule 9: `defaultBuilderMainLift` reads the env pool, which already drops pain-flagged exercises (`builder-env.ts:243`).
- Rule 4: the pool is limited to this gym's equipment, so the default main lift is only ever a lift this gym can do.

## Spec issues (for Ben)

1. **Pairing rule.** §3.5 (`docs/design/workout-builder-v3.md:593`) allows a heavy lift with a light one. The code now never auto-pairs a heavy lift. Ben's own pairs and coach-requested `superset` ops still follow §3.5. The spec text and a `docs/brief/CHANGELOG.md` entry need Ben's approval.
2. **"Heavy" list (§3.5 [Proposal]).** It includes leg press, Bulgarian split squat, hip thrust and RDL. Under the new rule, a Legs day with Supersets on pairs almost nothing: in a 30–90 min probe, only the abs pair formed. That makes workouts longer and gets them trimmed sooner. Ben may want "heavy" narrowed (e.g. barbell/trap bar only) now that it blocks all pairing.
3. **Order.** §3.4 doesn't say "heavy compounds before other compounds" or "heaviest first when there's no main lift". Add both if Ben approves.
4. **Default main lift.** Set up's default for a day with no plan day (`BUILDER_DEFAULT_MAIN_LIFTS`, ahead of history) isn't in the spec. It needs Ben's confirmation and a §2.2 line.
