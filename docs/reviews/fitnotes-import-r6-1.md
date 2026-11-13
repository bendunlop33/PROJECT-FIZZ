VERDICT: CHANGES NEEDED

# Review round 6.1: FitNotes import (build step 3), adversarial check of the PM decision

**Verdict: CHANGES NEEDED.** One blocking finding.

The round 6 fixes hold:
- **B1:** `Add new` now gives one exercise per equipment, and imports never change a stored exercise.
- **B2 and B3:** Smith and assist words now work both ways.
- **S1:** a stale rebuild now replays only the answers Ben gave in that preview.
- **S2:** the plates-only value is now shown.
- **S3:** mixed-sign values are now handled within one file.

In 8 full runs (501 names), nothing stored differs from the file without a source. The one exception is a path the round 6 Smith fix should also have covered:
- **B1.** `Add new` → Barbell on a name that says `EZ Bar` or `Trap Bar` gets the **Olympic** bar under "Plates only". So `EZ Bar Upright Row 30 kg` is stored as 50 kg.
- The name's own word is source (c) and names a different bar. Ben has no way to give that exercise its real bar weight.

Reviewed: `525ff94..dd1aed0` on `claude/fitnotes-import`, 7 commits (`88f3d3c`, `3ae0047`, `48578ce`, `256859d`, `7156327`, `bb143a7`, `dd1aed0`).

Specs read:
- CLAUDE.md;
- the PM decision (load-affecting properties only from (a) an exact name or alias, (b) Ben's explicit answer still in effect, or (c) an explicit word);
- `docs/design/data-import-export.md` checks 16–27;
- the brief's scenario 6, §10 and §12;
- ADR 0016 (differences 28–31, "still open after round 6");
- review round 6.

## What I ran

| Check | Result |
|---|---|
| `npm run check` | Exit 0. Typecheck and lint are clean. 89 test files and 1,225 tests pass. Catalogue: 135 valid, 0 errors, 1 warning (the landmine press, older than this branch). Guides: 10/10 |
| Probe B (real catalogue, real SQLite, through `AppServices`; deleted) | A file with **501 names**: FitNotes' 97 defaults plus 404 variants (Smith, Smith + Barbell, assisted, assisted + machine, Gravitron, one-arm, two-arm, alternating and alternate-grip names, DB/BB/EZ/trap/hex names, Hevy-style `X (Equipment)` names, generic names, machine, cable, kettlebell and bodyweight names). **8 runs:** kg and lb × `each`/`both` × `total`/`plates_only`. In each run every `Check` is accepted, and every `No match` is answered `Add new` by the name's word. Every stored set is compared with the file using my own reading of (a), (b) and (c) |
| Probe C (deleted) | Seven scenarios: `Add new` barbell for EZ and trap names (alone and in a group); `Choose…` and `Add new` stack for assisted names; mixed-sign assistance across two imports; a Smith name chosen as a free-barbell exercise; a stale rebuild after an undo; two `Add new` answers for one name with different equipment |
| Probe A (deleted) | Every catalogue name and alias checked against its own entry for Smith, assist, equipment and count contradictions |
| Diff grep for `console.*`, secrets and `eval` | None found |

**Probe B results (each of the 8 runs):**
- 442 sets stored.
- Units: kg files stored kg and lb files stored lb, with no conversion.
- Every value shown on the dumbbell and barbell screens equals the stored value.
- Nothing was pre-selected: neither group question, any per-exercise row, nor any bodyweight question.
- **Halved under `both`: 40.** Each has (a) or (c).
- **Bar added under `plates_only`: 94.** Each has (a), (c) or my `Add new` Barbell answer.
  - **The 5 EZ and trap names answered `Add new` Barbell got the Olympic 20 kg / 45 lb bar (B1).**
- **Assistance: 32.** Each has an assist word or an exact name, or comes from my `Add new` assisted answer.
- No assist-named set was stored as a load.
- No Smith name was mapped to a non-Smith exercise.

**Probe A:** no catalogue name or alias contradicts its entry on Smith, assist or count. The only alias issue left is the generic aliases (SP1).

## Round 6 findings: status

| # | Status | Evidence |
|---|---|---|
| B1 `Add new` equipment survives Undo | **Fixed** | `customExerciseIdFor(owner, key, kind)` and `saveImportExercise` insert only (`packages/persistence/src/imports.ts`). In probe C6, both `Pull Up Machine` exercises (stack and assisted) exist side by side, and each import reads its own. The six-step path, the mirror case and the dumbbell → barbell case are tested (`fitnotes-import-views.test.ts:610`) |
| B2 Smith + Barbell | **Fixed** | `kindFits` (`match.ts:313`) and `barNamed`. In probe B, no Smith name maps to a free barbell exercise. In probe C4, a Smith name chosen as a barbell row is asked on its own with nothing selected |
| B3 Assisted + Machine | **Fixed for suggestions.** See S1 below for `Choose…` and `Add new` | `match.ts:316` |
| S1 Stale rebuild | **Fixed** | `import-service.ts:687-688`. Tested at `fitnotes-import-views.test.ts:715` |
| S2 Lone barbell conversion | **Fixed** | Probe C1b shows `Imported as 50 kg (30 + 20 kg bar)` |
| S3 Mixed signs | **Fixed within one file. Open across imports (S2 below)** | `plan.ts:758-776` |
| N2, N3, N4 | Fixed | N3: `Alternate Grip Dumbbell Row` is no longer halved (probe B) |
| Bug the developer found: "Kept as written" detail never shown | Fixed | `ImportPreviewScreen.tsx:169` |

## Blocking

### B1. `Add new` → Barbell on an EZ-bar or trap-bar name adds the Olympic bar under "Plates only"

**Where:**
- `packages/domain/src/import/plan.ts:470`: `bar: answer.equipment === 'barbell' ? 'barbell' : 'none'`. The bar is always the Olympic bar.
- `plan.ts:473`: `barKnown` is false only for Smith names. EZ and trap names go straight to the group answer.

**Failure path (probe C1 and C1b, and probe B in kg and lb):**
1. The file has `EZ Bar Upright Row 30 kg` and `Trap Bar Jump Squat 60 kg`. Both are `No match`.
2. `Add new` offers one bar kind, `Barbell`, and Ben picks it, because these are barbell exercises.
3. He answers "Plates only" on the barbell screen.
4. The sets are stored as **50 kg** and **80 kg total**: 20 kg Olympic bar each. In lb, 628 → 673, a 45 lb bar.

Other names that do the same:
- `Upright Row (EZ Bar)`;
- `EZ Bar Close Grip Press`;
- `Trap Bar Farmers Walk`.

The conversion is shown, as `30 kg → 50 kg (plates + 20 kg bar)`. But the only bar-weight field on that screen is the Olympic bar's. So Ben can't enter the EZ bar's real weight (about 7–12 kg) or the trap bar's (about 25–30 kg). His only escape is to call the plates "Total", which is also wrong.

**Why it blocks:**
- The name's explicit word (`EZ Bar`, `Trap Bar`) is source (c), and it names a bar the app already models (`ez_bar` and `trap_bar` have their own weights).
- The importer replaces that bar with the Olympic one. The 20 kg / 45 lb difference has no source.
- This is the same defect class as round 6 B2. The round 6 fix special-cased Smith in `resolveName` instead of reading the bar from the name. That is the per-name approach the PM decision asked to stop.

**Fix:** in `resolveName`, take the bar of an `Add new` Barbell exercise from the name's own bar word:
- `ez_bar` or `trap_bar` when `equipmentInName` says so, with its weight asked through the existing per-bar field;
- `barbell` only when the name says barbell, or says no bar kind at all;
- any other case, including Smith, is asked on its own.

Alternatively, offer `EZ bar` and `Trap bar` as `Add new` kinds, and refuse `Barbell` for a name whose bar word disagrees.

**Tests to add:** these 5 names, `Add new` Barbell, under "Plates only", in kg and lb. Each must get its own bar's weight, or be asked. It must never get 20 kg / 45 lb.

## Should fix

### S1. An assisted name mapped to a stack exercise by `Choose…` or `Add new` → Weight stack is stored as a load, with no question

**Where:**
- `kindFits` (`match.ts:313-316`) guards suggestions only.
- `barNamed` asks when Ben's chosen exercise contradicts a Smith word (probe C4). Nothing does the same for an assist word.

**Effect (probe C2):**
- `Assisted Shoulder Press Machine 40` → `Choose…` Machine shoulder press: stored as **40 kg stack**.
- `Assisted Lat Pull Machine 35` → `Add new` Weight stack: stored as **35 kg stack**.
- A negative value is unreadable. A positive one is stored as a load, although the name says the number is help.
- The "Kept as written" line gives no detail for these exercises, because they aren't assistance exercises.

The developer lists this as open. Ben's choice is (b) for the exercise's identity. The name's word is (c) for the sign, and the two disagree.

**Fix:** do what the Smith case does. When the chosen or new exercise's convention is `stack` or `added` and the name has an assist word, ask the bodyweight-style question "How do these values read?", with nothing pre-selected. Alternatively, show the conflict on the names screen.

### S2. The round 6 S3 mixed-sign rule depends on whether the earlier dates are skipped as duplicates

**Where:** `plan.ts:758-776` computes each assisted exercise's range over `live` (`plan.ts:719`). `live` leaves out dates skipped as already imported.

**Effect (probe C3):**
- Import A has `Assisted Dip −30` (1 Sep).
- A later export of the same history adds `Assisted Dip 10` (20 Sep).
- Importing it skips 1 Sep, so the range is only `[10, 10]`. The 10 is stored as **10 kg assistance**, with `mixed: false`.
- The same rows in one file give `unreadable` for the 10.
- So the same data gets different stored values depending on import order. Re-importing a fresh full export is the normal FitNotes workflow.

**Fix:** compute `assistRange` over every strength row of the name in the file, including skipped dates, because the file is the evidence of how Ben writes the sign. Alternatively, also read the original values of earlier jobs' rows. Test both import orders.

## Nits

- **N1.** Replay in a stale rebuild (`import-service.ts:688`) skips the checks that `answer()` makes: "That exercise isn't in the list" and "That gym isn't one of yours". No screen can delete a gym or an exercise today, so this can't happen yet. A future delete could let a replayed answer point at something that's gone. Re-run those checks during replay, and drop failures visibly.
- **N2.** `addNewExerciseId` (`plan.ts:417`) reuses a legacy one-per-name exercise when its equipment matches. A legacy exercise that the round 5 code had already rewritten keeps its rewritten equipment. There is no real data yet, so this matters only if a test build was used for real. Record it in the ADR.
- **N3.** Two custom exercises can share a name (probe C6: `Pull Up Machine` as Weight stack and as Assisted machine). `Choose…` tells them apart only by subtitle. This needs the designer (the developer lists it as open).
- **N4.** A name over 120 characters isn't recognised as import-made (`isImportMadeExercise`, `plan.ts:405`), because the key is taken from the truncated name. The developer lists this as open. The fix is to key on the stored ID's source key, or to keep the full key on the exercise.

## Tests

**Good:**
- Every round 6 fix has a test that fails on the old code (per the fix report).
- `fitnotes-import-defaults.test.ts:241-265` runs the reviewer's Smith + Barbell and Assisted + Machine names end to end in kg and lb.
- B1's six-step path, its mirror case and the dumbbell → barbell case run on SQLite through the service.

**Missing:**
- B1: EZ and trap names with `Add new` Barbell.
- S1: `Choose…` or `Add new` stack for an assisted name.
- S2: mixed-sign assistance across two imports.

## Spec issues

- **SP1 (still open, for the PM).** Generic catalogue aliases count as source (a), so they decide the dumbbell count and the bar:
  - `Shrug(s)`, `Chest fly`, `Bicep(s) curl`, `Lateral raise`, `Lat raise`, `Rear delt fly`, `Walking lunge(s)`, `Incline curl`, `Pullover`, `Farmer's walk`, `TGU` and others map to dumbbell pair or single entries;
  - `Bent over row`, `OHP`, `Military press`, `RDL`, `CGBP`, `Pause squat` and others map to the barbell;
  - `Skullcrusher` and `Lying triceps extension` map to the EZ bar.
  - Probe A lists 106 such aliases.
  - The PM decision's letter allows this, but it leaves the guessing in the catalogue. **Recommendation:** for load-affecting properties, (a) should count only a name or alias that states the equipment, or the catalogue should mark generic aliases as "suggest only".
- **SP2. `Add new` offers only one bar kind.** The spec's `Add new` equipment list (`CustomExerciseKindSchema`) has `barbell` but no `ez_bar` or `trap_bar`, although the app models both bars. This is the root of B1. The designer should decide whether `Add new` offers the bar kinds, or whether the bar is read from the name.
- **SP3. Whether Ben's `Choose…` overrides a contradicting word** (S1) needs a PM rule. Today the code asks for Smith and doesn't ask for assisted.
- **Still open from earlier rounds:**
  - ADR 0016 is still "Proposed";
  - the Smith bar weight (r2 SP3);
  - check 17's sign-off on pre-filled answers (r5 SP3);
  - checks 16 and 27 on Ben's real export and iPhone (nothing has run on a device).
