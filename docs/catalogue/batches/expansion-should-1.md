# Catalogue expansion: Should, part 1 (33 entries)

Written 2026-10-23 by the exercise-researcher agent. Scope: the first 33 rows of "Should (65)" in `docs/research/exercise-catalogue-expansion.md` (Ben approved adding them, 23 Oct 2026). The Must batch and the last 32 Should rows are other batches.

All entries are **Coaching knowledge**, rich tier, `review: draft`, `provenance.source: fizz`, own words, nothing copied. Sources were checked 2026-10-23; where a page couldn't be fetched, the source's `note` says it was seen only through a search summary. No guides yet.

## Entries

| Key | Name | Equipment · convention | Pattern |
|---|---|---|---|
| `bodyweight-oblique-crunch` | Oblique crunch | bodyweight · bodyweight, unilateral | core |
| `bodyweight-hollow-body-hold` | Hollow body hold | bodyweight · bodyweight, duration | core |
| `bodyweight-side-plank-hip-dip` | Side plank hip dip | bodyweight · bodyweight, unilateral | core |
| `barbell-landmine-rotation` | Landmine rotation | barbell · added | core |
| `cable-side-bend` | Cable side bend | weight stack · stack, cable column, unilateral | core |
| `bodyweight-v-up` | V-up | bodyweight · bodyweight | core |
| `dumbbell-renegade-row` | Renegade row | dumbbells · per hand ×2 | core |
| `bodyweight-mcgill-curl-up` | McGill curl-up | bodyweight · bodyweight | core |
| `bodyweight-toes-to-bar` | Toes-to-bar | bodyweight · bodyweight, pull-up bar | core |
| `bodyweight-body-saw` | Body saw | bodyweight · bodyweight | core |
| `barbell-decline-bench-press` | Decline bench press | barbell · total, bench | horizontal push |
| `dumbbell-incline-fly` | Incline dumbbell fly | dumbbells · per hand ×2, incline bench | horizontal push |
| `machine-plate-loaded-chest-press` | Plate-loaded chest press | plate-loaded machine · added | horizontal push |
| `dumbbell-single-arm-bench-press` | Single-arm dumbbell bench press | dumbbells · per hand ×1, unilateral, bench | horizontal push |
| `dumbbell-floor-press` | Dumbbell floor press | dumbbells · per hand ×2 | horizontal push |
| `barbell-pin-press` | Pin press | barbell · total, rack + bench | horizontal push |
| `bodyweight-incline-push-up` | Incline push-up | bodyweight · bodyweight | horizontal push |
| `bodyweight-decline-push-up` | Decline push-up | bodyweight · bodyweight | horizontal push |
| `machine-chest-supported-t-bar-row` | Chest-supported T-bar row machine | plate-loaded machine · added | horizontal pull |
| `cable-reverse-grip-lat-pulldown` | Reverse-grip lat pulldown | weight stack · stack | vertical pull |
| `bodyweight-neutral-grip-pull-up` | Neutral-grip pull-up | bodyweight · bodyweight, pull-up bar | vertical pull |
| `barbell-meadows-row` | Meadows row | barbell · added, unilateral | horizontal pull |
| `machine-plate-loaded-high-row` | Plate-loaded high row | plate-loaded machine · added | vertical pull |
| `machine-back-extension` | Back extension machine | weight stack · stack | hinge |
| `bodyweight-dead-hang` | Dead hang | bodyweight · bodyweight, duration, pull-up bar | vertical pull |
| `machine-lateral-raise` | Machine lateral raise | weight stack · stack | vertical push |
| `smith-machine-shoulder-press` | Smith machine shoulder press | Smith machine · added, bench | vertical push |
| `barbell-reverse-curl` | Reverse curl | barbell or EZ bar · total | arms |
| `cable-bayesian-curl` | Bayesian cable curl | weight stack · stack, unilateral | arms |
| `dumbbell-skull-crusher` | Dumbbell skull crusher | dumbbells · per hand ×2, bench | arms |
| `ez-bar-overhead-triceps-extension` | EZ-bar overhead triceps extension | EZ bar · total | arms |
| `barbell-wrist-curl` | Barbell wrist curl | barbell or EZ bar · total, bench | arms |
| `barbell-reverse-wrist-curl` | Barbell reverse wrist curl | barbell or EZ bar · total, bench | arms |

## Vocabulary mappings (nearest existing value)

The expansion research's open vocabulary questions (Q1–Q3) aren't decided, so nothing new was added to `vocab.ts` or `@fizz/schemas`.

- **`hip_flexors`** (hollow body hold, V-up, toes-to-bar): left out, not mapped to another muscle. Each entry says so in `uncertain`.
- **Brachioradialis** (reverse curl): filed under `forearms`.
- **Landmine** (landmine rotation, Meadows row): `barbell` + `added`, matching Landmine press. No station is listed because there's no landmine station value. Expect the same "added is unusual for barbell" warning that Landmine press already gets.
- **Plate-loaded iso-lateral machines** (chest press, T-bar row machine, high row): `plate_loaded_machine` + `added`, like the leg press. Whether the number is per side or total is not recorded yet (Q3).
- **Sliders** (body saw): `bodyweight_station`.
- **Decline bench** (decline bench press): station `specific_machine`, matching the decline crunch and sit-up (there's no decline-bench value, and a flat bench isn't a substitute).
- **Parallel handles** (neutral-grip pull-up): station `pullup_bar`.
- **Patterns.** Dead hang uses `vertical_pull` (there's no hang or isometric pattern). The high row uses `vertical_pull`, though it's diagonal. The renegade row uses `core`, though it's also a horizontal pull. Machine lateral raise uses `vertical_push`, following Lateral raise. Back extension machine uses `hinge`.

## Decisions worth a look

- **Wrist curls are barbell entries.** A barbell logs one unambiguous total; the dumbbell versions are variations with no entry yet.
- **Back extension machine aliases.** `Back extension`, `Hyperextension` and `Lower back extension(s)` are deliberately not aliases (batch-03).
- **Overlapping existing entries.** `machine-chest-press` and `machine-chest-supported-row` also list `plate_loaded_machine` but default to `stack`. Ben may want them narrowed to stack machines so histories don't mix, as was done for the leg press. Not changed here.
- **No growth claims.** The Bayesian curl's one trial found no difference from the preacher curl. The overhead-triceps trial (Maeo 2023) used cable extensions in mostly untrained adults.

## Validation status

Not run by this agent: it had no shell. Before merging, run `npm run catalogue:index`, then `npm run catalogue:validate`.
