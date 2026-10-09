# Catalogue batch 02: basic-tier entries

Written 2026-10-09 by the exercise-researcher agent. Scope:
- The rest of the research §7 list (111 items, minus the 10 batch-01 entries) = **101**.
- The batch-01 substitution and variation keys that aren't in that list = **22**.

**123 new basic-tier entries.** The catalogue now has 133 files (10 rich, 123 basic).

All entries are **Coaching knowledge** and say nothing about Ben. Every entry has `review: { status: "draft", benApprovedOn: null }`, `provenance.source: "fizz"`, empty `crossCheckedWith` and empty `copiedFields`. All text is our own, and no wger or RepDB record was copied, so no CREDITS entry is needed. Names and aliases are facts (common gym names, including UK and US forms such as Press-up / Push-up and Selectorised / Selectorized).

## Validation status (read this first)

This agent session had **no shell tool**, so `npm run catalogue:index` and `npm run catalogue:validate` **were not run**. Instead:
- **Index.** `packages/catalogue/src/generated/exercise-files.ts` was rewritten by hand to exactly match `indexSource()`: JS default sort order, where `-` sorts before `.`, so `bodyweight-burpee-broad-jump.json` comes before `bodyweight-burpee.json`. It covers 133 imports, `e0`–`e132`. **Run `npm run catalogue:index` anyway.** If it changes the file, the hand version was off, and the regenerated one is correct.
- **Structure.** All 123 new files match one multiline pattern covering the whole entry:
  - key format and every enum: pattern, mechanic, equipment, station, convention, measurement, laterality;
  - family snake_case, field order, the provenance block and the review block.
- **Fields.** All 133 files use only fixed-list muscles, and every top-level `key` matches its file name.
- **Manual checks.** No primary muscle repeats as secondary. No alias equals its own name (case-insensitive). No name or alias is shared between entries (case-insensitive), so there should be no shared-alias warnings.
- **Expected `catalogue:validate` result:** 133 files, 133 valid (10 rich, 123 basic), **0 errors**, **1 warning** (`barbell-landmine-press`: `added is unusual for barbell`, deliberate, see below), **0 dangling keys** (all 55 batch-01 keys now exist), **9 notes** (distance entries not loggable yet).

## Impact on other packages (for the developer; not touched here)

`packages/catalogue/test/starter-ids.test.ts` **will fail** with this batch. It compares the starter list in `packages/domain/src/starter-exercises.ts` with the catalogue:
1. `matched` (30 starters) must equal the number of non-distance catalogue entries (now 124). Once the catalogue is larger than the starter list, this can't hold. The test or the starter list needs to change, for example by deriving the starter list from the catalogue.
2. Field mismatches between starter rows and catalogue rows. Keys match for all 30 starters, so IDs are stable:
   - `family`: the starter has none, the catalogue has one. Affects `barbell-incline-bench-press` (bench_press), `barbell-hip-thrust` (hip_thrust), `dumbbell-bench-press` and `dumbbell-incline-bench-press` (bench_press), `dumbbell-seated-shoulder-press` (overhead_press), `dumbbell-romanian-deadlift` (romanian_deadlift), `dumbbell-goblet-squat` (goblet_squat), `dumbbell-curl` (curl), `dumbbell-lateral-raise` (lateral_raise), `cable-seated-row` (row), `cable-face-pull` (face_pull), `machine-leg-extension` (leg_extension), `machine-seated-leg-curl` (leg_curl), `machine-assisted-pull-up` and `bodyweight-pull-up` (pull_up), `machine-assisted-dip` and `bodyweight-dip` (dip), `bodyweight-push-up` (push_up).
   - `movementPattern`: the starter uses values outside the catalogue vocabulary. `dumbbell-lateral-raise` (`shoulder_abduction` → `vertical_push`), `machine-leg-extension` (`knee_extension` → `squat`), `machine-seated-leg-curl` (`knee_flexion` → `hinge`).
   - `name`: `machine-seated-leg-curl` is "Seated leg curl", because a lying leg curl now exists. "Leg curl" is kept as an alias.
   - `compatibleEquipment`: `bodyweight-push-up` is `[]` in the starter, but the catalogue requires at least one kind (`bodyweight_station`).
   - The default-rule category doesn't change for any starter: incline bench stays `main_barbell`, and hip thrust stays `compound`.

## Entries written (all in `packages/catalogue/data/exercises/`)

Abbreviations: B = bilateral, U = unilateral; reps / dur / **dist** (distance: catalogue-only, not loggable yet).

| Key | Name | Pattern | Equipment · convention | Meas. | Side |
|---|---|---|---|---|---|
| barbell-deadlift | Deadlift | hinge | barbell · total | reps | B |
| barbell-front-squat | Front squat | squat | barbell · total | reps | B |
| barbell-incline-bench-press | Incline bench press | horizontal_push | barbell · total | reps | B |
| barbell-bent-over-row | Barbell row | horizontal_pull | barbell · total | reps | B |
| barbell-hip-thrust | Hip thrust | hinge | barbell · total | reps | B |
| trap-bar-deadlift | Trap-bar deadlift | hinge | barbell · total | reps | B |
| barbell-close-grip-bench-press | Close-grip bench press | horizontal_push | barbell · total | reps | B |
| barbell-sumo-deadlift | Sumo deadlift | hinge | barbell · total | reps | B |
| barbell-pendlay-row | Pendlay row | horizontal_pull | barbell · total | reps | B |
| barbell-push-press | Push press | vertical_push | barbell · total | reps | B |
| barbell-good-morning | Good morning | hinge | barbell · total | reps | B |
| barbell-curl | Barbell curl | arms | barbell · total | reps | B |
| ez-bar-curl | EZ-bar curl | arms | barbell · total | reps | B |
| ez-bar-skull-crusher | Skull crusher | arms | barbell · total | reps | B |
| barbell-box-squat | Box squat | squat | barbell · total | reps | B |
| barbell-landmine-press | Landmine press | vertical_push | barbell · **added** | reps | U |
| barbell-paused-back-squat | Paused back squat | squat | barbell · total | reps | B |
| barbell-deficit-romanian-deadlift | Deficit Romanian deadlift | hinge | barbell · total | reps | B |
| barbell-paused-bench-press | Paused bench press | horizontal_push | barbell · total | reps | B |
| barbell-seated-overhead-press | Seated overhead press | vertical_push | barbell · total | reps | B |
| barbell-bulgarian-split-squat | Barbell Bulgarian split squat | lunge | barbell · total | reps | U |
| dumbbell-bench-press | Dumbbell bench press | horizontal_push | dumbbells · per_hand | reps | B |
| dumbbell-incline-bench-press | Incline dumbbell press | horizontal_push | dumbbells · per_hand | reps | B |
| dumbbell-seated-shoulder-press | Dumbbell shoulder press | vertical_push | dumbbells · per_hand | reps | B |
| dumbbell-standing-shoulder-press | Standing dumbbell shoulder press | vertical_push | dumbbells · per_hand | reps | B |
| dumbbell-lateral-raise | Lateral raise | vertical_push | dumbbells · per_hand | reps | B |
| dumbbell-curl | Dumbbell curl | arms | dumbbells · per_hand | reps | B |
| dumbbell-hammer-curl | Hammer curl | arms | dumbbells · per_hand | reps | B |
| dumbbell-goblet-squat | Goblet squat | squat | dumbbells · per_hand | reps | B |
| dumbbell-walking-lunge | Dumbbell walking lunge | lunge | dumbbells · per_hand | reps | B |
| dumbbell-romanian-deadlift | Dumbbell Romanian deadlift | hinge | dumbbells · per_hand | reps | B |
| dumbbell-chest-supported-row | Chest-supported dumbbell row | horizontal_pull | dumbbells · per_hand | reps | B |
| dumbbell-step-up | Dumbbell step-up | lunge | dumbbells · per_hand | reps | U |
| dumbbell-fly | Dumbbell fly | horizontal_push | dumbbells · per_hand | reps | B |
| dumbbell-rear-delt-fly | Dumbbell rear-delt fly | horizontal_pull | dumbbells · per_hand | reps | B |
| dumbbell-incline-curl | Incline dumbbell curl | arms | dumbbells · per_hand | reps | B |
| dumbbell-overhead-triceps-extension | Dumbbell overhead triceps extension | arms | dumbbells · per_hand | reps | B |
| dumbbell-arnold-press | Arnold press | vertical_push | dumbbells · per_hand | reps | B |
| dumbbell-reverse-lunge | Dumbbell reverse lunge | lunge | dumbbells · per_hand | reps | U |
| dumbbell-single-leg-romanian-deadlift | Single-leg Romanian deadlift | hinge | dumbbells · per_hand | reps | U |
| dumbbell-shrug | Dumbbell shrug | vertical_pull | dumbbells · per_hand | reps | B |
| dumbbell-pullover | Dumbbell pullover | vertical_pull | dumbbells · per_hand | reps | B |
| dumbbell-three-point-row | Three-point dumbbell row | horizontal_pull | dumbbells · per_hand | reps | U |
| dumbbell-triceps-kickback | Dumbbell triceps kickback | arms | dumbbells · per_hand | reps | U |
| cable-seated-row | Seated cable row | horizontal_pull | weight_stack · stack | reps | B |
| cable-face-pull | Face pull | horizontal_pull | weight_stack · stack | reps | B |
| cable-fly | Cable fly | horizontal_push | weight_stack · stack | reps | B |
| cable-lateral-raise | Cable lateral raise | vertical_push | weight_stack · stack | reps | U |
| cable-curl | Cable curl | arms | weight_stack · stack | reps | B |
| cable-overhead-triceps-extension | Overhead cable triceps extension | arms | weight_stack · stack | reps | B |
| cable-straight-arm-pulldown | Straight-arm pulldown | vertical_pull | weight_stack · stack | reps | B |
| cable-crunch | Cable crunch | core | weight_stack · stack | reps | B |
| cable-pallof-press | Pallof press | core | weight_stack · stack | reps | U |
| cable-woodchop | Cable woodchop | core | weight_stack · stack | reps | U |
| cable-single-arm-row | Single-arm cable row | horizontal_pull | weight_stack · stack | reps | U |
| cable-pull-through | Cable pull-through | hinge | weight_stack · stack | reps | B |
| cable-glute-kickback | Cable glute kickback | hinge | weight_stack · stack | reps | U |
| cable-single-arm-pulldown | Single-arm pulldown | vertical_pull | weight_stack · stack | reps | U |
| cable-neutral-grip-pulldown | Neutral-grip pulldown | vertical_pull | weight_stack · stack | reps | B |
| cable-rope-triceps-pushdown | Rope triceps pushdown | arms | weight_stack · stack | reps | B |
| band-triceps-pushdown | Band triceps pushdown | arms | band · bodyweight | reps | B |
| machine-leg-extension | Leg extension | squat | weight_stack · stack | reps | B |
| machine-seated-leg-curl | Seated leg curl | hinge | weight_stack · stack | reps | B |
| machine-lying-leg-curl | Lying leg curl | hinge | weight_stack · stack | reps | B |
| machine-chest-press | Chest press machine | horizontal_push | weight_stack, plate_loaded_machine · stack | reps | B |
| machine-hack-squat | Hack squat | squat | plate_loaded_machine · added | reps | B |
| machine-assisted-pull-up | Assisted pull-up | vertical_pull | assisted_stack · assistance | reps | B |
| machine-assisted-dip | Assisted dip | vertical_push | assisted_stack · assistance | reps | B |
| machine-shoulder-press | Machine shoulder press | vertical_push | weight_stack, plate_loaded_machine · stack | reps | B |
| machine-pec-deck | Pec deck | horizontal_push | weight_stack · stack | reps | B |
| machine-reverse-pec-deck | Reverse pec deck | horizontal_pull | weight_stack · stack | reps | B |
| machine-chest-supported-row | Chest-supported machine row | horizontal_pull | weight_stack, plate_loaded_machine · stack | reps | B |
| machine-standing-calf-raise | Standing calf raise | calves | weight_stack, plate_loaded_machine · stack | reps | B |
| machine-seated-calf-raise | Seated calf raise | calves | plate_loaded_machine, weight_stack · added | reps | B |
| machine-hip-abduction | Hip abduction machine | lunge | weight_stack · stack | reps | B |
| machine-hip-adduction | Hip adduction machine | lunge | weight_stack · stack | reps | B |
| machine-seated-leg-press | Seated leg press | squat | weight_stack · stack | reps | B |
| machine-single-leg-press | Single-leg press | squat | plate_loaded_machine · added | reps | U |
| smith-machine-squat | Smith machine squat | squat | plate_loaded_machine · added | reps | B |
| smith-machine-bench-press | Smith machine bench press | horizontal_push | plate_loaded_machine · added | reps | B |
| smith-machine-bulgarian-split-squat | Smith machine Bulgarian split squat | lunge | plate_loaded_machine · added | reps | U |
| bodyweight-pull-up | Pull-up | vertical_pull | bodyweight_station · bodyweight | reps | B |
| bodyweight-chin-up | Chin-up | vertical_pull | bodyweight_station · bodyweight | reps | B |
| bodyweight-push-up | Push-up | horizontal_push | bodyweight_station · bodyweight | reps | B |
| bodyweight-diamond-push-up | Diamond push-up | horizontal_push | bodyweight_station · bodyweight | reps | B |
| bodyweight-dip | Dip | vertical_push | bodyweight_station · bodyweight | reps | B |
| bodyweight-plank | Plank | core | bodyweight_station · bodyweight | dur | B |
| bodyweight-side-plank | Side plank | core | bodyweight_station · bodyweight | dur | U |
| bodyweight-copenhagen-plank | Copenhagen plank | core | bodyweight_station · bodyweight | dur | U |
| bodyweight-hanging-knee-raise | Hanging knee raise | core | bodyweight_station · bodyweight | reps | B |
| bodyweight-hanging-leg-raise | Hanging leg raise | core | bodyweight_station · bodyweight | reps | B |
| bodyweight-inverted-row | Inverted row | horizontal_pull | bodyweight_station · bodyweight | reps | B |
| bodyweight-ab-wheel-rollout | Ab-wheel rollout | core | bodyweight_station · bodyweight | reps | B |
| bodyweight-dead-bug | Dead bug | core | bodyweight_station · bodyweight | reps | B |
| bodyweight-glute-bridge | Glute bridge | hinge | bodyweight_station · bodyweight | reps | B |
| bodyweight-45-degree-back-extension | 45° back extension | hinge | bodyweight_station · bodyweight | reps | B |
| bodyweight-nordic-curl | Nordic curl | hinge | bodyweight_station · bodyweight | reps | B |
| bodyweight-squat | Bodyweight squat | squat | bodyweight_station · bodyweight | reps | B |
| bodyweight-split-squat | Split squat | lunge | bodyweight_station · bodyweight | reps | U |
| bodyweight-bulgarian-split-squat | Bodyweight Bulgarian split squat | lunge | bodyweight_station · bodyweight | reps | U |
| bodyweight-wall-drive | Wall drive | conditioning | bodyweight_station · bodyweight | dur | B |
| bodyweight-burpee-broad-jump | Burpee broad jump | conditioning | bodyweight_station · bodyweight | **dist** | B |
| bodyweight-box-jump | Box jump | conditioning | bodyweight_station · bodyweight | reps | B |
| bodyweight-burpee | Burpee | conditioning | bodyweight_station · bodyweight | reps | B |
| bodyweight-bear-crawl | Bear crawl | conditioning | bodyweight_station · bodyweight | dur | B |
| dowel-hip-hinge | Dowel hip hinge | hinge | bodyweight_station · bodyweight | reps | B |
| kettlebell-swing | Kettlebell swing | hinge | kettlebell · total | reps | B |
| kettlebell-goblet-squat | Kettlebell goblet squat | squat | kettlebell · total | reps | B |
| kettlebell-deadlift | Kettlebell deadlift | hinge | kettlebell · total | reps | B |
| kettlebell-clean | Kettlebell clean | hinge | kettlebell · per_hand | reps | U |
| kettlebell-press | Kettlebell press | vertical_push | kettlebell · per_hand | reps | U |
| kettlebell-snatch | Kettlebell snatch | hinge | kettlebell · per_hand | reps | U |
| kettlebell-turkish-get-up | Turkish get-up | core | kettlebell · per_hand | reps | U |
| kettlebell-front-rack-carry | Kettlebell front-rack carry | carry | kettlebell · per_hand | **dist** | B |
| farmers-carry | Farmer's carry | carry | kettlebell, dumbbells · per_hand | **dist** | B |
| sled-pull | Sled pull | conditioning | sled · added | **dist** | B |
| ski-erg | Ski erg | conditioning | erg · bodyweight | **dist** | B |
| rowing-erg | Rowing machine | conditioning | erg · bodyweight | **dist** | B |
| wall-ball | Wall ball | conditioning | medicine_ball · total | reps | B |
| sandbag-lunge | Sandbag lunge | lunge | sandbag · total | **dist** | B |
| air-bike | Air bike | conditioning | erg · bodyweight | dur | B |
| battle-ropes | Battle ropes | conditioning | bodyweight_station · bodyweight | dur | B |
| treadmill-run | Treadmill run | conditioning | erg · bodyweight | **dist** | B |

## Conventions used

- **Keys** start with the implement: `barbell-`, `dumbbell-`, `cable-`, `machine-`, `bodyweight-`, `kettlebell-`, `band-`, `ez-bar-`, `trap-bar-`, `smith-machine-`, `dowel-`. HYROX and conditioning keys use their plain names (`sled-pull`, `ski-erg`, `rowing-erg`, `wall-ball`, `farmers-carry`, `sandbag-lunge`, `air-bike`, `battle-ropes`, `treadmill-run`), matching batch-01's `sled-push`. Every key the starter list uses (`packages/domain/src/starter-exercises.ts`) was kept, so IDs stay stable.
- **Families** group variants for substitutions and guide templates, regardless of equipment: `row`, `bench_press`, `overhead_press`, `deadlift`, `romanian_deadlift`, `split_squat`, `curl`, `triceps_extension`, `triceps_pushdown`, `chest_fly`, `lateral_raise`, `rear_delt_fly`, `leg_curl`, `calf_raise`, `plank`, `carry`, `sled`, `burpee`, and so on. **The default progression rule depends on family** (`MAIN_FAMILIES` in `packages/domain/src/default-rule.ts`). These barbell entries are in a main family and so get the `main_barbell` rule: front squat, box squat, paused squat, incline / close-grip / paused bench, seated OHP, push press, Pendlay row, barbell row, sumo and trap-bar deadlift. The landmine press was given its own family (`landmine_press`) so it gets the `compound` rule, not the main-lift rule.
- **Kettlebells:** two hands on one bell (swing, goblet squat, KB deadlift) use `total`. One bell per hand (clean, press, snatch, get-up, carries) uses `per_hand`.
- **Mechanic** follows the joints that move. Static core holds (plank, side plank, Copenhagen, dead bug) and hanging raises are `isolation`. The hip thrust, glute bridge and back extension are `compound`, matching the starter list's hip thrust.
- **Default rest** values are starting points, not evidence-graded: 180 s for the heaviest barbell lifts, 120–150 s for other barbell and big machine lifts, 90 s for other compounds, 60 s for isolation, 45 s for light core work, and 120 s for HYROX distance stations. They match the starter list wherever a starter exists.
- **Generic aliases point to one variant.** Each was given to the most common gym meaning, so FitNotes-style generic names map somewhere sensible. Ben may want to remap them:
  - "Chest press" → machine; "Calf raise" → standing machine; "Leg curl" → seated machine.
  - "Shrug" → dumbbell; "Pullover" → dumbbell; "Step-up", "Reverse lunge" and "Walking lunge" → dumbbell versions.
  - "Split squat" → bodyweight; "Incline bench" → barbell.
- **Weighted variants are not aliases.** "Weighted pull-up", "Weighted chin-up" and "Weighted dip" were left out on purpose. Their load convention (`added`) differs from the bodyweight default, and EL3 says conventions shouldn't be mixed in one history. Ben may want separate keys for them.
- **Trade names used as aliases** (search terms only, never the entry name): SkiErg, RowErg, Assault bike, Echo bike, Airdyne, Gravitron. Batch-01 set the precedent with "Prowler push".

## Marked uncertain

The basic tier has no `uncertain` field (the zod schema is strict), so uncertainty is recorded here.

| Key(s) | Field | Why |
|---|---|---|
| dumbbell-lateral-raise, cable-lateral-raise | `movementPattern` = vertical_push | The fixed list has no shoulder-isolation pattern. vertical_push is the closest fit, and it is the conservative choice for EL6 pain blocking, because pain on an overhead press then also blocks raises. |
| machine-leg-extension | `movementPattern` = squat | No knee-extension pattern in the list. Knee-dominant, so squat. |
| machine-seated-leg-curl, machine-lying-leg-curl, bodyweight-nordic-curl | `movementPattern` = hinge | No knee-flexion pattern in the list. Grouped with the hamstring hinge. |
| machine-hip-abduction, machine-hip-adduction | `movementPattern` = lunge | No pattern fits. "Lunge / single leg" is the nearest filter chip. |
| dumbbell-shrug, dumbbell-pullover, cable-straight-arm-pulldown | `movementPattern` = vertical_pull | Shrug in particular is a weak fit. |
| cable-glute-kickback | `movementPattern` = hinge | Hip extension, so hinge. |
| kettlebell-turkish-get-up | `movementPattern` = core | Could equally be conditioning. |
| wall-ball, bodyweight-burpee, bodyweight-box-jump, bodyweight-bear-crawl, battle-ropes, bodyweight-wall-drive | `movementPattern` = conditioning | Tagged by how they're usually trained, not by joint action. |
| smith-machine-squat, smith-machine-bench-press, smith-machine-bulgarian-split-squat | `compatibleEquipment` = plate_loaded_machine, convention `added` | Research §4.4 still hasn't decided whether the Smith machine is a barbell instance or its own kind. Bar weight varies and is often counterbalanced, so "plates added" is the honest default. If it becomes a barbell instance, change to `barbell` · `total`. |
| ez-bar-curl, ez-bar-skull-crusher, trap-bar-deadlift | `compatibleEquipment` = barbell (`total`) | Also open in §4.4. Works if the gym profile lists the EZ bar or trap bar as a barbell with its own bar weight. |
| barbell-landmine-press | `defaultLoadConvention` = added; `laterality` = unilateral | Half the bar rests on the floor, so "total on the bar" isn't meaningful. `added` is a valid barbell choice (exercise-library §2.6) but triggers the validator's "unusual" warning. Single-arm is the common form, but two-hand versions exist too. |
| dumbbell-walking-lunge (B), sandbag-lunge (B), dumbbell-reverse-lunge (U) | `laterality` | Walking lunges alternate legs and are usually counted as total steps or reps. Reverse lunges are often prescribed per leg. Ben's FitNotes history should decide. |
| dumbbell-triceps-kickback, cable-lateral-raise, cable-pallof-press, cable-woodchop | `laterality` = unilateral | Usually done one side at a time, but two-arm versions exist. |
| dumbbell-overhead-triceps-extension | `defaultLoadConvention` = per_hand | Usually one dumbbell held in both hands, so the logged value is that one dumbbell. The UI label "each" could mislead. |
| sled-pull, ski-erg, rowing-erg, bodyweight-burpee-broad-jump, farmers-carry, sandbag-lunge, kettlebell-front-rack-carry, treadmill-run | `measurement` = distance | Follows research §4.4 and the HYROX race format: 1000 m ski and row, 50 m sled, 80 m BBJ, 200 m farmers, 100 m lunges. These entries **can't be logged until distance logging exists**. Ergs are also commonly logged by time or calories, and calories aren't in the schema. |
| air-bike, battle-ropes, bodyweight-bear-crawl, bodyweight-wall-drive | `measurement` = duration | Usually timed. Bear crawl is also done for distance. |
| battle-ropes, bodyweight-ab-wheel-rollout, dowel-hip-hinge, bodyweight-box-jump, dumbbell-step-up | `compatibleEquipment` / `requiresStation` | No equipment kind exists for ropes, an ab wheel, a dowel or a plyo box, so `bodyweight_station` with no station (or `bench` for the step-up) is used. |
| treadmill-run | `compatibleEquipment` = erg | A treadmill isn't strictly an erg. No treadmill kind exists. |
| cable-seated-row | `requiresStation` = cable_column | Many gyms have a dedicated low-row station rather than a cable column. |
| bodyweight-inverted-row | `requiresStation` = rack | A Smith bar, rings or a suspension trainer also work. |
| dumbbell-seated-shoulder-press, barbell-seated-overhead-press | `requiresStation` includes incline_bench | Read as "adjustable bench set upright". |
| machine-chest-press, machine-shoulder-press, machine-chest-supported-row, machine-standing-calf-raise, machine-seated-calf-raise | `compatibleEquipment` (stack and plate-loaded) | Both versions are common. The default convention follows the more common type: stack, except the seated calf raise, which uses `added`. |
| machine-seated-leg-curl | `name` | "Seated leg curl", not the starter's "Leg curl". See the developer section. |
| all conditioning entries (sled-pull, ski-erg, rowing-erg, air-bike, wall-ball, burpees, battle-ropes, bear crawl, treadmill-run, wall drive) | `secondaryMuscles` | Reasoned from the movement, not measured or sourced. |
| all 123 | `primaryMuscles` / `secondaryMuscles`, `defaultRestS` | Standard coaching classifications, written without a per-entry source check (basic entries carry no `sources`). Treat them as drafts for Ben's skim. |

## Sources and access

Basic entries carry no `sources` field (strict schema). Most of the content is common gym nomenclature and standard muscle classification, written from general coaching knowledge and checked against the batch-01 conventions. One external check was made on 2026-10-09: HYROX station formats (distances and reps), seen through search listings of the PUMA HYROX weights-and-distances article (https://eu.puma.com/de/en/articles/hyrox-weights-repetitions-distance-division) and the Red Bull HYROX station guide (https://www.redbull.com/gb-en/hyrox-exercise-stations-guide). They were used only to choose distance versus reps; no race standards are stored in the entries. No wger snapshot exists yet, so `crossCheckedWith` is empty everywhere. Cross-check against wger when the basic-catalogue snapshot is taken.

## Flags for the PM

1. The `catalogue:index` and `catalogue:validate` scripts were not run (no shell in this session). Run both, then `npm test` in `packages/catalogue`.
2. `starter-ids.test.ts` will fail until the developer updates the starter list or the test (see above). That's in `packages/domain`, outside this agent's scope.
3. The movement-pattern vocabulary has no slots for single-joint shoulder, knee, hip-abduction or hip-adduction work, or for shrugs. Adding `shoulder_isolation`, `knee_extension`, `knee_flexion` and `hip_abduction_adduction` (or similar) would remove most of the pattern uncertainty above. That's a vocab and spec change for Ben and the designer.
4. Equipment kinds have no box, ab wheel, ropes or treadmill. They aren't needed for load feasibility, but a gym filter can't hide these exercises when the kit is missing.
