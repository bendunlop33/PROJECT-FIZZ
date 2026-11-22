VERDICT: CHANGES NEEDED

# Review round 6.2: FitNotes import (build step 3), adversarial check of the PM decision

**Verdict: CHANGES NEEDED.** One blocking finding.

The round 6.1 fixes work for the names they were written for:
- **B1:** `EZ Bar …`, `Trap Bar …` and `Hex Bar …` names now get their own bar.
- **S1:** an assisted name chosen as a stack exercise is asked.
- **S2:** the mixed-sign rule reads the whole file.
- **N1 and N4:** fixed.

But B1 was fixed again by listing words, which the PM decision asked to stop. An `Add new` → Barbell answer still puts the **Olympic bar** under "Plates only" on any name whose bar word isn't in `EQUIPMENT_WORDS`. Some of those names say the EZ or trap bar in another spelling: `E-Z Bar Curl`, `Hex Deadlift`, `Trap Deadlift`. Others say a bar the app doesn't model: safety squat bar, cambered, Swiss or football bar, log, axle. Ben can't change the reading for one exercise.

Reviewed: `91ab1c7..13384e4` on `claude/fitnotes-import`, 4 commits (`38564be`, `63362a8`, `e514539`, `13384e4`).

Specs read:
- CLAUDE.md;
- the PM decision (load-affecting properties only from (a) an exact name or alias, (b) Ben's explicit answer still in effect, or (c) an explicit word in the name; anything else asked with nothing selected, and the conversion shown);
- `docs/design/data-import-export.md` checks 16–27;
- the brief's scenario 6, §10 and §12;
- ADR 0016 (differences 32–34, "still open after round 6.1");
- review rounds 6 and 6.1.

## What I ran

| Check | Result |
|---|---|
| `npm run check` | Exit 0. Typecheck and lint are clean. 90 test files and 1,233 tests pass. Catalogue: 135 valid, 0 errors, 1 warning (the landmine press, older than this branch). Guides: 10/10 |
| Probe (real catalogue, SQLite, through `AppServices`; deleted) | P1: `newBarFromName` on 25 names. P1b: four specialty-bar names, `Add new` Barbell + "Plates only", committed in kg. P2: an S1 answer, then the name re-mapped. P4: an S1 name with mixed signs, answered `split`. P5: an S1 name whose values are all 0. P6: a per-exercise "Plates only" kept after re-mapping from the EZ-bar curl to the barbell curl |
| Diff grep for `console.*`, secrets and `eval` | None found |

## Round 6.1 findings: status

| # | Status | Evidence |
|---|---|---|
| B1 EZ/trap names via `Add new` Barbell | **Fixed for `EZ`, `EZ Bar`, `Trap Bar` and `Hex Bar`. Still open for other spellings and other bars (B1 below)** | `newBarFromName` (`plan.ts:443`). The tests are in `fitnotes-import-r6-1.test.ts:56`, in kg and lb. A later import's exact match reads the new exercise's `ez_bar`/`trap_bar` equipment |
| S1 Assisted name → stack exercise | **Fixed** | `withAssistWord` (`plan.ts:463`). Probe P4: −20 and 40 with `split` are stored as 20 kg of assistance and 40 kg on the stack, and nothing is selected first. The copy is wrong for `split` (N1 below) |
| S2 Mixed signs across imports | **Fixed within the file.** The stored-rows gap is recorded in the ADR | `fileRange` over `strength` (`plan.ts:784-797`). Tested in both import orders |
| N1 Replay checks | **Fixed, but silently** | `import-service.ts:688-695`. A dropped answer reopens its question without saying why (N3 below). There's no end-to-end test, because nothing in the app can delete an exercise or gym yet |
| N4 Long names | **Fixed** | `addNewExerciseId(ctx, nameKey(stored), …)`. There's a domain test |
| N2 | Recorded in ADR 0016 | |

## Blocking

### B1. `Add new` → Barbell still adds the Olympic bar under "Plates only" to names that say a different bar

**Where:**
- `packages/domain/src/import/plan.ts:443-453`, `newBarFromName`: `if (named === null) return { bar: 'barbell', known: true }`.
- `packages/domain/src/import/match.ts:197-198`: the only bar words recognised are `ez ?bar|ez` and `(trap|hex) ?bar`.
- `packages/domain/test/import-plan.test.ts:396` asserts `Log Press` → `{ bar: 'barbell', known: true }`.

**Probe P1:** each of these returns `{ bar: 'barbell', known: true }`, so the group answer reads it with the Olympic bar:
- `E-Z Bar Curl`, `Curl Bar Curl`: the EZ bar under another spelling;
- `Hex Deadlift`, `Trap Deadlift`: the trap bar without "bar";
- `Safety Squat Bar Squat`, `SSB Squat`, `Cambered Bar Bench Press`, `Swiss Bar Press`, `Football Bar Press`, `Multi Grip Bar Press`, `Buffalo Bar Squat`, `Axle Press`, `Log Press`, `Yoke Walk`, `Landmine Press`.

**Failure path (probe P1b, real SQLite, kg):**
1. The file has `Safety Squat Bar Squat 60`, `Cambered Bar Bench Press 60`, `Log Press 60` and `Hex Deadlift 60` (kg). Each is `No match`.
2. Ben answers `Add new` → Barbell, the only bar kind offered, for each one.
3. He answers "Plates only" for the group.
4. All four are stored as **80 kg total**: `[["Safety Squat Bar Squat",{"value":80,"unit":"kg","convention":"total"}], …]`.
5. `totalOptions(...).ask` is empty. No row lets Ben read one of these exercises differently.
6. The new exercises are saved with `compatibleEquipment: ['barbell']`, so later logging of `Hex Deadlift` uses the Olympic bar too.

The same code path runs in lb, which adds 45 lb. I checked lb at the function level only.

**Why it blocks:**
- `E-Z Bar`, `Hex` and `Trap` are explicit words (source (c)) for bars the app models, so this is round 6.1's B1 under another spelling.
- For the specialty bars, the 20 kg / 45 lb has no source. Ben said "a barbell exercise" because `Barbell` is the only bar kind `Add new` offers (SP2). He didn't say "the 20 kg Olympic bar". The name says a different bar.
- The conversion is shown (`imported: 80, barWeight: 20`), but Ben can't correct it.
- The fix is again a list of words (`EZ`, `Trap Bar`, `Hex Bar`). The PM decision asked for a rule that doesn't depend on which spellings someone thought of.

**Fix (the rule, not more words):** the group answer reads an `Add new` barbell exercise only when the name explicitly names the Olympic bar (`Barbell`, `BB`, `Olympic`), or names `EZ`/`trap`/`hex` as today. Ask every other name on its own row, with nothing selected, including names with no bar word. This is the rule `Choose…` already uses (`barNamed`, `match.ts:447`: no word, so it's asked).

A weaker alternative: ask any name that has a `bar` token outside `barbell`, or `hex`, `trap`, `log`, `axle`, `yoke`, `landmine` or `ssb`. That is still a list.

Either way, also:
- offer per-exercise "Total" on known rows, so Ben always has a way out;
- change the `Log Press` assertion;
- add these names, end to end in kg and lb.

## Should fix

None beyond B1.

## Nits

- **N1. The `split` option is mislabelled for an S1 stack exercise.**
  - Where: `apps/mobile/src/import/views.ts:860`. The label is "Negative = assistance, positive = added", and the detail says "40 as 40 added".
  - For a `loadAs: 'stack'` question, the positive values are stored as **stack** (probe P4: `{"value":40,"convention":"stack"}`). So the conversion shown before commit names the wrong convention.
  - Fix: use `loadAs` in the label and detail, as the first option already does ("positive = on the stack").
- **N2. An S1 name whose values are all 0 is stored as a 0 kg stack load, without a question.**
  - Where: `plan.ts:903`, "Not asked (every value 0)" → `set(ex.loadAs, …)`.
  - Probe P5: `Assisted Lat Pull Machine 0` mapped to `Add new` Weight stack is stored as `{"value":0,"convention":"stack"}`.
  - On an assisted machine, 0 means no assistance, i.e. full bodyweight. On a stack, it means nothing lifted. The name's word and Ben's choice disagree here too.
  - Fix: store it as `bodyweight` with no load, as a plain bodyweight exercise is, or ask.
- **N3. Dropped replay answers aren't explained.** `import-service.ts:690-695` drops an answer whose exercise or gym is gone, and the preview comes back `stale`. But nothing says which question reopened or why. Review r6.1 asked for "drop failures visibly". Add a line such as "`X` was mapped to an exercise that no longer exists". Untestable end to end until something can delete an exercise or gym.
- **N4. An answer keeps its value, but its label changes when Ben re-maps the name.** In probe P2, Ben answered "Weight on the stack" for an S1 name, then re-mapped it to `Add new` → Bodyweight station. The answer was then shown as **"Weight added to bodyweight", already selected**, and the preview was ready. The stored value (35, positive load) is the same in both readings, so I don't count this as a wrong load. But under the PM rule a question Ben never saw is answered for him. Probe P6 shows the same for a per-exercise "Plates only" kept from the EZ-bar curl to the barbell curl. That one is correct, because "plates only" doesn't depend on the bar. Consider clearing a name's `bodyweight` answer when its mapping changes the question's `loadAs`.
- **N5.** A test build that imported an EZ or trap name through round 6's code made `customExerciseIdFor(owner, key, 'barbell')` with `['barbell']` equipment. Round 6.1 reuses that ID and, because inserts never overwrite, keeps the Olympic bar on the exercise while the plan reads `ez_bar`. This matters only if a test build was used for real data (like r6.1 N2). Record it in ADR 0016.

## Tests

**Good:**
- Every r6.1 fix has an end-to-end test on SQLite in kg and lb. Five of them fail on the old code, according to the fix report.
- S2 is tested in both import orders.
- The domain tests cover the two-bar-kind and bar-plus-other-equipment cases.

**Missing:**
- B1: names that say a bar in another spelling or without "bar" (`E-Z Bar`, `Hex Deadlift`, `Trap Deadlift`), and specialty bars, with `Add new` Barbell.
- N1: an S1 `split` label test.
- N2: an all-zero S1 name.
- A test that a re-mapped name doesn't carry an answer to a question with a different meaning (N4).

## Spec issues

- **SP1 (still open, for the PM).** 106 generic catalogue aliases (`Shrugs`, `OHP`, `RDL`, `Skullcrusher` and others) count as source (a), so they decide the dumbbell count and the bar.
- **SP2 (still open, for the designer). This is now the root of B1.** `Add new` offers one bar kind, `Barbell`, and the app models only three bars (r2 N7, SP3). For Ben, choosing `Barbell` currently means "the 20 kg Olympic bar".
  - Either `Add new` offers `EZ bar`, `Trap bar` and "Other bar (weight asked)",
  - or the PM rules that `Add new` Barbell never fixes the bar by itself (the fix above).
- **SP3 (still open, for the PM).** Whether Ben's `Choose…` overrides a word in the name that contradicts it. The code now asks for Smith and assisted, which is the conservative reading.
- **Still open from earlier rounds:**
  - ADR 0016 is still "Proposed";
  - the Smith bar weight (r2 SP3);
  - check 17's sign-off on pre-filled answers (r5 SP3);
  - checks 16 and 27 on Ben's real export and iPhone. Nothing has run on a device or on real data.
