# Catalogue batch 03: FitNotes import names

Written 2026-10-11 by the exercise-researcher agent (branch `claude/import-names`). Scope: the names a real FitNotes (Android, B2) export gave `No match` or a wrong suggestion for, and FitNotes' own default names that are unambiguous (ADR 0016, "Still open after review round 5": catalogue owner). Only exercise **names** from the brief were used; no rows or values from Ben's file are in the repo.

All entries are **Coaching knowledge**, `review: draft`, `provenance.source: fizz`, own words, nothing copied.

## New entries (rich tier)

The PM asked for "basic tier, with cues/safety". The schema's basic tier is strict and refuses `cues`, `safety` and `sources`, so these are **rich** entries (cues, safety, variations, guide brief, sources). They have no animated guide yet; the app shows their text cues.

| Key | Name | Equipment · convention | Notes |
|---|---|---|---|
| `barbell-shrug` | Barbell shrug | barbell · total | Matches FitNotes `Barbell Shrug` exactly. `BB shrug` deliberately not an alias (an r6.2 test uses `BB Shrug` as an unknown barbell name). |
| `barbell-standing-calf-raise` | Standing barbell calf raise | barbell · total, rack | Alias `Barbell calf raise` (FitNotes default) taken as the standing version; marked uncertain. |
| `barbell-seal-row` | Barbell seal row | barbell · total, bench | Plain `Seal row` is **not** an alias: it names the barbell and the dumbbell versions. A FitNotes `Seal Row` is now a `Check` suggesting this entry; Ben confirms. Needs a bench tall enough for the plates (no station value for that; uncertain). |
| `cable-lat-prayer` | Lat prayer | weight stack · stack, cable column | Own entry, not an alias of `cable-straight-arm-pulldown`: lower pulley, moving torso, usually kneeling, so stack numbers aren't comparable. Aliases `Lat prayers`, `Cable lat prayer`, `Kneeling lat prayer`, `Kneeling cable lat prayer`. Uncertain: Ben may prefer to merge. |

## Aliases added (exact matches for FitNotes names)

| FitNotes name | Entry |
|---|---|
| Flat Barbell Bench Press | `barbell-bench-press` |
| Leg Extension Machine | `machine-leg-extension` |
| Seated Calf Raise Machine | `machine-seated-calf-raise` |
| Lateral Dumbbell Raise | `dumbbell-lateral-raise` (pair: now halved by "Both together", like `Dumbbell lateral raise`) |
| Rope Push Down | `cable-rope-triceps-pushdown` |
| Parallel Bar Triceps Dip, Chest Dips | `bodyweight-dip` (bodyweight: the weight question is still asked) |
| Cable Crossovers | `cable-fly` |
| Seated Machine Fly | `machine-pec-deck` (FitNotes has `Rear Delt Machine Fly` separately) |
| Rear Delt Machine Fly | `machine-reverse-pec-deck` |
| Rear Delt Dumbell Fly (sic), Rear delt dumbbell fly | `dumbbell-rear-delt-fly` |
| Straight-Arm Cable Pushdown | `cable-straight-arm-pulldown` (was suggested as the triceps pushdown; review r5 N2) |

**Rejected:** `Lower Back Extensions`. It can be the 45° back extension (bodyweight), a 90° Roman-chair extension, or a seated lower-back machine on a stack, and the convention differs (added weight vs stack). It stays a `Check` (45° back extension) for Ben to confirm.

**Not changed:** `Lat Cable Pull` (could be a pulldown or a straight-arm pull; stays a Check), `Barbell Leg Curls` → Barbell curl (a matcher problem: no catalogue entry is a barbell leg curl; the suggestion is wrong and Ben must choose).

## Validation status

No shell in this session: `catalogue:index`, `catalogue:validate`, typecheck, lint and vitest were **not run**, and nothing was committed. `src/generated/exercise-files.ts` was rewritten by hand to match `indexSource()` (139 files, `e0`–`e138`). Run `npm run catalogue:index` and check it produces no diff.

Expected `catalogue:validate`: 139 files, 139 valid (14 rich, 125 basic), 0 errors. Tests updated for the new matches: `packages/catalogue/test/playback.test.ts` (139 keys), `apps/mobile/test/fitnotes-import{,-views,-defaults}.test.ts`.
