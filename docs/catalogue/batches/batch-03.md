# Catalogue batch 03: FitNotes import names

Written 2026-10-11 by the exercise-researcher agent (branch `claude/import-names`). Scope: the names a real FitNotes (Android, B2) export gave `No match` or a wrong suggestion for, and FitNotes' own default names that are unambiguous (ADR 0016, "Still open after review round 5": catalogue owner). Only exercise **names** from the brief were used; no rows or values from Ben's file are in the repo.

All entries are **Coaching knowledge**, `review: draft`, `provenance.source: fizz`, own words, nothing copied.

## New entries (rich tier)

The PM asked for "basic tier, with cues/safety". The schema's basic tier is strict and refuses `cues`, `safety` and `sources`, so these are **rich** entries (cues, safety, variations, guide brief, sources). They have no animated guide yet; the app shows their text cues.

| Key | Name | Equipment · convention | Notes |
|---|---|---|---|
| `barbell-shrug` | Barbell shrug | barbell · total | Matches FitNotes `Barbell Shrug` exactly. `BB shrug` deliberately not an alias (an r6.2 test uses `BB Shrug` as an unknown barbell name). |
| `barbell-standing-calf-raise` | Standing barbell calf raise | barbell · total, rack | `Barbell calf raise` (FitNotes default) is **not** an alias: it doesn't say standing or seated. It is a `Check` suggesting this entry (review import-names S3). |
| `barbell-seal-row` | Barbell seal row | barbell · total, bench | Plain `Seal row` is **not** an alias: it names the barbell and the dumbbell versions. A FitNotes `Seal Row` is now a `Check` suggesting this entry; Ben confirms. `Chest-supported barbell row` and `Prone barbell row` are **not** aliases either: both also name a face-down row on an incline bench (review import-names-r2 S1). Needs a bench tall enough for the plates (no station value for that; uncertain). |
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
| Seated Machine Fly | `machine-pec-deck` (FitNotes has `Rear Delt Machine Fly` separately) |
| Rear Delt Machine Fly | `machine-reverse-pec-deck` |
| Rear delt dumbbell fly | `dumbbell-rear-delt-fly` (pair: halved by "Both together") |
| Straight-Arm Cable Pushdown | `cable-straight-arm-pulldown` (was suggested as the triceps pushdown; review r5 N2) |

**Removed after review (import-names B1, S2, S3; import-names-r2 S1):**
- `Cable crossovers` → `cable-fly`. A FitNotes `Cable Crossovers` filed outside Chest may be a reverse or rear-delt crossover. It is now a `Check` under Chest and `No match · <category>` under another category; Ben chooses.
- `Rear delt dumbell fly` (misspelt). A misspelling is one person's naming (Your data): Ben's answer is remembered as his own alias. The name is now a `Check` and its dumbbell count is asked.
- `Barbell calf raise`, `Barbell calf raises` → `barbell-standing-calf-raise`. They don't say standing or seated.
- `Chest-supported barbell row`, `Prone barbell row` → `barbell-seal-row` (review import-names-r2 S1). Both also name a face-down row on an incline bench, with a different torso angle and range. The convention is total either way, but the exercise identity is Ben's call. Both are now a `Check`, never matched: both currently suggest `barbell-bent-over-row` (the matcher's best word overlap); Ben chooses the seal row, an incline row or a new exercise.

**Rejected:** `Lower Back Extensions`. It can be the 45° back extension (bodyweight), a 90° Roman-chair extension, or a seated lower-back machine on a stack, and the convention differs (added weight vs stack). It stays a `Check` (45° back extension) for Ben to confirm.

**Not changed:** `Lat Cable Pull` (could be a pulldown or a straight-arm pull; stays a Check), `Barbell Leg Curls` → Barbell curl (a matcher problem: no catalogue entry is a barbell leg curl; the suggestion is wrong and Ben must choose).

## Validation status

Run and committed on `claude/import-names` after review import-names: `npm run catalogue:index` (no diff beyond the alias changes), `npm run catalogue:validate` (139 files, 139 valid, 0 errors; the one warning is the older `barbell-landmine-press` one), typecheck, lint and vitest all pass.
