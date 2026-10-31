# Catalogue expansion: Must (28 entries)

Written 2026-10-23 by the exercise-researcher agent. Scope: the 28 rows of "Must (28)" in `docs/research/exercise-catalogue-expansion.md` (Ben approved adding them, 23 Oct 2026). The Should and Could rows are other batches.

All entries are **Coaching knowledge**, rich tier, `review: draft`, `provenance.source: fizz`, own words, nothing copied. Sources were checked 2026-10-23; where a page couldn't be fetched (ExRx, NSCA), the source's `note` says it was seen only through a search summary. No guides yet. Prehab entries (cable external rotation, band pull-apart, lateral band walk) make no injury or condition claims (rule 9).

## Entries

| Key | Name | Equipment · convention | Pattern |
|---|---|---|---|
| `machine-ab-crunch` | Ab crunch machine | weight stack · stack | core |
| `bodyweight-crunch` | Crunch | bodyweight · bodyweight | core |
| `bodyweight-decline-crunch` | Decline crunch | bodyweight · bodyweight, decline bench | core |
| `bodyweight-decline-sit-up` | Decline sit-up | bodyweight · bodyweight, decline bench | core |
| `bodyweight-reverse-crunch` | Reverse crunch | bodyweight · bodyweight | core |
| `bodyweight-captains-chair-knee-raise` | Captain's chair knee raise | bodyweight · bodyweight, dip station | core |
| `bodyweight-lying-leg-raise` | Lying leg raise | bodyweight · bodyweight | core |
| `bodyweight-bicycle-crunch` | Bicycle crunch | bodyweight · bodyweight | core |
| `bodyweight-russian-twist` | Russian twist | bodyweight (or medicine ball) · bodyweight | core |
| `dumbbell-side-bend` | Dumbbell side bend | dumbbell or kettlebell · per hand ×1, unilateral | core |
| `dumbbell-suitcase-carry` | Suitcase carry | dumbbell or kettlebell · per hand ×1, unilateral, distance | carry |
| `bodyweight-bird-dog` | Bird dog | bodyweight · bodyweight | core |
| `bodyweight-mountain-climber` | Mountain climber | bodyweight · bodyweight, duration | conditioning |
| `machine-incline-chest-press` | Incline chest press machine | weight stack or plate-loaded · stack | horizontal push |
| `smith-machine-incline-press` | Smith machine incline press | Smith machine · added, incline bench | horizontal push |
| `barbell-t-bar-row` | T-bar row | barbell (landmine) or plate-loaded · added | horizontal pull |
| `barbell-rack-pull` | Rack pull | barbell · total, rack | hinge |
| `dumbbell-front-raise` | Dumbbell front raise | dumbbells · per hand (count not set) | vertical push |
| `barbell-upright-row` | Upright row | EZ bar or barbell · total | vertical pull |
| `cable-rear-delt-fly` | Cable rear-delt fly | weight stack · stack, cable column | horizontal pull |
| `ez-bar-preacher-curl` | Preacher curl | EZ bar or barbell · total, preacher bench | arms |
| `machine-preacher-curl` | Machine preacher curl | weight stack or plate-loaded · stack | arms |
| `machine-seated-dip` | Seated dip machine | weight stack or plate-loaded · stack | vertical push |
| `machine-leg-press-calf-raise` | Leg-press calf raise | plate-loaded or stack · added | calves |
| `bodyweight-single-leg-calf-raise` | Single-leg calf raise | bodyweight (optional dumbbell) · bodyweight, unilateral | calves |
| `cable-external-rotation` | Cable external rotation | weight stack · stack, cable column, unilateral | horizontal pull |
| `band-pull-apart` | Band pull-apart | band · bodyweight (no load) | horizontal pull |
| `band-lateral-walk` | Lateral band walk | band · bodyweight (no load) | lunge |

## Vocabulary mappings (nearest existing value)

The expansion research's open vocabulary questions (Q1–Q3) aren't decided, so nothing new was added to `vocab.ts` or `@fizz/schemas`.

- **`hip_flexors`** (decline sit-up, captain's chair knee raise, lying leg raise, reverse crunch, bicycle crunch, mountain climber): left out, not mapped to another muscle. Each entry says so in `uncertain`. Decline sit-up is the most affected: ExRx files it under the hip flexors.
- **`rotator_cuff`** (cable external rotation): mapped to `rear_delts`, which overstates the deltoid's share. For the cable rear-delt fly and band pull-apart, the cuff is left out (rear delts are already primary).
- **Quadratus lumborum** (side bend, suitcase carry): covered by `core`. **Hip stabilisers** (suitcase carry): `abductors`.
- **Patterns.** There's no isolation, raise, rotation or prehab pattern. Front raise uses `vertical_push` (like Lateral raise); upright row `vertical_pull` (like the shrugs); cable rear-delt fly, band pull-apart and cable external rotation `horizontal_pull` (like Face pull and the rear-delt flies); lateral band walk `lunge` (like Hip abduction machine); mountain climber `conditioning` (like Burpee and Bear crawl).
- **Equipment.** Mini-band and long band → `band`, logged with no load (like Band triceps pushdown). Landmine → `barbell` + `added` (like Landmine press), plus `plate_loaded_machine` because FitNotes' "T-Bar Row" also means the lever machine. Mat work → `bodyweight_station`.
- **Stations.** Decline/ab bench and preacher bench → `specific_machine` (not checked by the domain). Captain's chair → `dip_station`. The decline bench press (Should batch) now uses `specific_machine` too, so decline benches are consistent.

## Decisions worth a look

- **FitNotes defaults now matched by alias:** `Crunch`, `Crunch Machine`, `Decline Crunch`, `EZ-Bar Preacher Curl`, `Front Dumbbell Raise`, `Rack Pull`, `Seated Machine Curl` (machine preacher curl, uncertain), `T-Bar Row`. `Dumbbell Preacher Curl` and `Incline Hammer Strength Chest Press` are deliberately not aliases (different load conventions).
- **Name clashes avoided (Q6):** "Air bike" stays the fan bike; plain "Knee raise" stays Hanging knee raise; only "Roman chair knee raise" goes to the captain's chair; plain "Side bend" and "Ab machine" are not aliases.
- **"Dip machine" / "Triceps dip machine"** now match the weight-stack seated dip, never the assisted dip.
- **Front raise has no `implements`:** two dumbbells, alternating, or one held in both hands are all common, so an import asks.
- **Single-leg calf raise** is bodyweight with a held dumbbell logged as added (like a weighted dip), not per dumbbell.
- **Linked existing variations:** `barbell-standing-calf-raise` now links "Single-leg calf raise" and "Leg-press calf raise" to the new keys. `cable-external-rotation` and `dumbbell-side-bend` link to the Should batch's `band-external-rotation` and `cable-side-bend`.
- **Domain table:** `CATALOGUE_STATIONS` in `packages/domain/src/stations.ts` gained `barbell-rack-pull: ['rack']` and `smith-machine-incline-press: ['incline_bench']` (the stations test requires it to match the catalogue).

## Validation status

Not run by this agent: it had no shell. Checked by hand: no cue over 60 characters, no alias shared with any other entry (including the Should batch's new files), no trailing commas or missing commas, every variation key either exists or is null. Before merging, run `npm run catalogue:index`, then `npm run catalogue:validate`, then the tests. Expected follow-ups:

- `packages/catalogue/test/playback.test.ts` asserts 144 bundled entries; it needs the new total.
- App import tests that assume these names have no exact match will change: `apps/mobile/test/fitnotes-import-views.test.ts` ("Triceps Dip Machine" and "Dip Machine" expected `no_match`; "Front Dumbbell Raise" expected a `check` by words) and possibly `fitnotes-import-defaults.test.ts` (which FitNotes defaults match and which are asked per dumbbell).
- No new load-convention warning is expected: T-bar row lists `plate_loaded_machine`, for which `added` is usual, and the band, Russian twist and single-leg calf raise entries each list a kind for which their convention is usual.
