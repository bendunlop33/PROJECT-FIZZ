# Catalogue batch 01: the 10 rich examples

Written 2026-10-09 by the exercise-researcher agent. Scope: the 10 rich-tier examples chosen in `docs/research/exercise-bank-and-visuals.md` §6. All entries are **Coaching knowledge** (design-system §7.2) and contain nothing about Ben. Every entry has `review.status: "draft"`; the app labels them `Draft guide` until Ben approves.

## Entries written

All in `packages/catalogue/data/exercises/`. Keys match research §6 exactly.

| Key | Name | Pattern | Equipment / load | Sides | View | Sources (fetched + extra) |
|---|---|---|---|---|---|---|
| `barbell-back-squat` | Back squat | squat | barbell · `total` | bilateral | side | 2 |
| `barbell-romanian-deadlift` | Romanian deadlift | hinge | barbell · `total` | bilateral | side | 2 + 1 search listing |
| `barbell-bench-press` | Bench press | horizontal_push | barbell · `total` | bilateral | side | 3 |
| `barbell-overhead-press` | Overhead press | vertical_push | barbell · `total` | bilateral | side | 4 |
| `dumbbell-one-arm-row` | One-arm dumbbell row | horizontal_pull | dumbbells · `per_hand` | unilateral | side | 2 |
| `cable-lat-pulldown` | Lat pulldown | vertical_pull | weight_stack · `stack` | bilateral | **front** | 2 + 1 search listing |
| `cable-triceps-pushdown` | Triceps pushdown | arms | weight_stack · `stack` | bilateral | side | 2 |
| `machine-leg-press` | Leg press | squat | plate_loaded_machine · `added` | bilateral | side | 2 |
| `dumbbell-bulgarian-split-squat` | Bulgarian split squat | lunge | dumbbells · `per_hand` | unilateral | side | 2 |
| `sled-push` | Sled push | conditioning | sled · `added` | bilateral | side (scrolling floor) | 3 |

## Schema conformance (for the developer's validator)

Entries follow research §4.2 (basic + rich tiers), the §4.3 vocabularies and the copy rules: every cue group has **4 items**, each **≤ 60 characters** (checked), imperative cues and short fault phrases. Muscles use only the §4.3 list and movement patterns only the §4.3 list. `requiresStation` uses only the §4.2 values.

**Additions beyond the §4.2 example.** They are optional and could become optional fields in the zod schema. Please accept, rename or fold them in:

| Field | Why |
|---|---|
| `variations { regressions[], progressions[], substitutions[] }`, each `{ key: string \| null, name, reason }` | The agent brief requires regressions, progressions and 3–5 substitutions with reasons. `key: null` marks a variation with no catalogue entry (e.g. "Lighter sled or shorter lengths"). |
| `uncertain[] { field, note }` | The brief asks for uncertain items to be marked; this keeps the marking machine-readable. |
| `sources[].title`, `sources[].note` | Citation text, and a note when a source was abstract-only, commercial or seen only through a search listing. |
| `guideBrief.cameraNote` | Camera height, facing, near/far limb assignment, framing. |
| `guideBrief.keyPositions[].approxAnglesDeg` | Joint-angle drawing targets (convention below). |
| `guideBrief.ikHints[]` (pulldown, split squat, sled) | Contact constraints that are better solved by IK than given as angles. |
| `guideBrief.tempo { stepMs, stepsPerCycle }` (sled only) | Locomotion doesn't fit `downMs/holdMs/upMs`. Suggest making tempo a union: rep tempo or stride tempo. |

**Depends on the proposed §4.4 schema changes (won't validate against today's `packages/schemas`):**
- `sled-push`: `measurement: "distance"` and `compatibleEquipment: ["sled"]`.
- Every entry: `secondaryMuscles`, `family`, `mechanic`, `key` (catalogue key) and `requiresStation` are §4.4 proposals. `measurement`, `laterality`, `compatibleEquipment` and `defaultLoadConvention` otherwise use today's enums.

**`requiresStation` semantics:** I read the array as "all of these are needed". Bench press uses `["bench", "rack"]`, meaning a bench with uprights or a bench in a rack. Lat pulldown and leg press use `specific_machine`; pushdown uses `cable_column`.

**Provenance:** all text is our own. `copiedFields` is empty and `crossCheckedWith` is empty, because no wger snapshot exists yet (`data/sources/wger-…json`). So no CREDITS entry is needed for this batch. Cross-check against wger when the basic-catalogue snapshot is taken. A spot query found wger translation 111 "Squats" (exercise 615), but the API response didn't show a licence field, so I didn't record it.

## Conventions used in `guideBrief`

**Angles (`approxAnglesDeg`)** are approximate drawing targets, not form standards or measured data. They are in degrees, 0 = straight or neutral, flexion positive (matching `guide.json`):
- `trunkLeanFromVertical`: line from hip to shoulder, forward lean positive (negative = leaning back).
- `hipFlexion`: angle between the trunk line and the thigh; 0 = in line, as when standing. Negative = extension.
- `kneeFlexion`, `elbowFlexion`: 0 = straight.
- `ankleDorsiflexion`: shin forward of perpendicular to the sole.
- `shoulderFlexion` (side view): upper arm relative to the trunk; 0 = hanging alongside the trunk, 90 = perpendicular in front, 180 = overhead, negative = behind the trunk.
- `shoulderAbduction` (front view): 0 = arm at side, 180 = overhead.
- Prefixes `near`/`far` (side view) and `front`/`rear` (split stance) name the limb.

The sagittal angles were checked for geometric consistency: knee ≈ thigh tilt + shin tilt, and hip ≈ thigh tilt + trunk lean.

**Tempo:** `downMs`/`upMs` give the direction the load or hands move, not eccentric or concentric. For a pushdown and a pulldown "down" is the lifting phase; for a squat it is the lowering phase. All rep tempos give a 2.55–3.0 s cycle, inside the `guide:check` 2–6 s rule. The sled cycle is 2 × 1050 ms = 2.1 s.

**Key-position labels** (they must match the guide keyframe labels, `guide:check` rule 11):
- Squat, split squat: Start / Halfway / Bottom
- RDL: Start / Knee level / Bottom
- Bench: Start / Halfway / Chest touch
- OHP: Start / Forehead / Lockout
- Row: Start / Halfway / Top
- Pulldown: Start / Halfway / Bottom
- Pushdown: Start / Halfway / Bottom
- Leg press: Start / Halfway / Bottom
- Sled: Near-leg drive / Switch / Far-leg drive

## Safety approach

- Spotter or safeties are covered where relevant: squat (safety arms, practise bailing), bench (safety arms or spotter, never heavy alone, thumbs around the bar), OHP (rack safeties for heavy sets), leg press (catches and stops).
- Every entry has the same pain line ("stop this exercise and get it checked by a physio or doctor") and generic `stopIf` items. Sled push adds "Chest pain, faintness or unusual breathlessness". No entry names a condition or diagnoses (rule 9).
- `added` entries (leg press, sled) state that plates added aren't the true resistance and aren't comparable between machines (brief §4, EL7, C7).

## Marked uncertain

| Key | Field | Why |
|---|---|---|
| all 10 | `guideBrief.keyPositions[*].approxAnglesDeg` | Worked out from the sources' positional descriptions, not measured |
| `barbell-back-squat` | `safety.notes[0-2]` | Safety-arm and spotter advice is standard practice; not in the cited sources |
| `barbell-bench-press` | `guideBrief.barPath` | Horizontal bar travel (4–8% of height) is an estimate |
| `dumbbell-one-arm-row` | `cues.setup[3]` | ACE and Catalyst differ on the shoulder-blade position at the start |
| `cable-lat-pulldown` | `keyPositions[2]` angles | Front-view projection; use IK instead |
| `cable-lat-pulldown` | `cues.setup[3]` | Upright versus slight lean back: sources differ, no angle given |
| `cable-triceps-pushdown` | `variations.substitutions[0]` | Whether rope and bar pushdowns are separate entries is Ben's call |
| `machine-leg-press` | angles, `safety.notes[0-1]`, `compatibleEquipment` | Seat geometry and safety catches vary by machine; stack leg press kept as a separate key |
| `dumbbell-bulgarian-split-squat` | `guideBrief.ikHints` | Rear leg given as IK targets because it depends on bench height |
| `sled-push` | `measurement`, `compatibleEquipment` | Proposed §4.4 enum values |
| `sled-push` | `secondaryMuscles` | Little research on sled pushing; reasoned, not measured |
| `sled-push` | `guideBrief.tempo` | New stride shape; step rate slowed for readability; step length estimated |
| `sled-push` | `cues.setup[1-2]` | Hand and arm position varies (forearms on poles versus straight arms) |

## Sources and access

All checked 2026-10-09. No instructions or images were copied; cues are our own wording.

- **Fetched in full or at page level:** ACE Exercise Library (back squat, chest press, standing shoulder press, single-arm row, triceps pushdowns, seated leg press), Myer et al. 2014 (PMC), Andersen et al. 2021 (PMC), Mackey & Riemann 2021 (PMC), Noteboom et al. 2024 (Frontiers), Catalyst Athletics (RDL article, single-arm DB row), NASM Bulgarian split squat, Human Kinetics overhead-press excerpt, Barbell Logic, Mike Reinold, ACE triceps study, Centr HYROX sled-push guide, HYROX Rulebook Single 26/27 (PDF §8.2).
- **Abstract only:** Saeterbakken & Fimland 2013 (BISp), Lusk et al. 2010 (Penn State repository), Escamilla et al. 2001 (SPONET), Cahill et al. 2019 (LIDA), Jumbelic 2007 (Europe PMC).
- **Blocked (403), seen only through search listings, used only as extra support:** NSCA Kinetic Select RDL, Mayo Clinic lat pull-down video. ExRx returned 403 for every page and isn't cited.
- **Commercial:** Centr supplies HYROX race sleds; Barbell Logic is a coaching business. Both are used for practical cues only.

## Catalogue keys referenced but not yet written

These substitution and variation keys don't exist yet. They should be created in the basic-catalogue batches, or renamed here to match:

`bodyweight-squat`, `dumbbell-goblet-squat`, `barbell-box-squat`, `barbell-paused-back-squat`, `barbell-front-squat`, `machine-hack-squat`, `smith-machine-squat`, `dumbbell-romanian-deadlift`, `cable-pull-through`, `dowel-hip-hinge`, `barbell-deficit-romanian-deadlift`, `dumbbell-single-leg-romanian-deadlift`, `bodyweight-45-degree-back-extension`, `machine-seated-leg-curl`, `bodyweight-push-up`, `machine-chest-press`, `barbell-paused-bench-press`, `barbell-close-grip-bench-press`, `dumbbell-bench-press`, `smith-machine-bench-press`, `barbell-incline-bench-press`, `dumbbell-seated-shoulder-press`, `dumbbell-standing-shoulder-press`, `machine-shoulder-press`, `barbell-landmine-press`, `barbell-push-press`, `barbell-seated-overhead-press`, `dumbbell-chest-supported-row`, `machine-chest-supported-row`, `dumbbell-three-point-row`, `barbell-bent-over-row`, `cable-single-arm-row`, `cable-seated-row`, `cable-single-arm-pulldown`, `machine-assisted-pull-up`, `bodyweight-pull-up`, `cable-neutral-grip-pulldown`, `cable-straight-arm-pulldown`, `band-triceps-pushdown`, `cable-overhead-triceps-extension`, `bodyweight-diamond-push-up`, `cable-rope-triceps-pushdown`, `dumbbell-overhead-triceps-extension`, `ez-bar-skull-crusher`, `dumbbell-triceps-kickback`, `machine-seated-leg-press`, `machine-single-leg-press`, `bodyweight-split-squat`, `bodyweight-bulgarian-split-squat`, `barbell-bulgarian-split-squat`, `dumbbell-reverse-lunge`, `dumbbell-step-up`, `dumbbell-walking-lunge`, `smith-machine-bulgarian-split-squat`, `bodyweight-wall-drive`.

The `smith-machine-` prefix depends on the open §4.4 question of whether the Smith machine is a barbell instance or its own kind.

## Flags for the PM

1. The agent prompt cites "CLAUDE.md rule 10: the catalogue is Coaching knowledge", but CLAUDE.md lists only rules 1–9. The Coaching-knowledge rule lives in design-system §7.2 and exercise-library.md. I followed it, but CLAUDE.md and the agent definition disagree.
2. No validator exists yet. JSON syntax and cue lengths were checked by inspection and pattern search, not by a zod run.
3. Default rest values (60–180 s) are sensible defaults for compound versus isolation lifts, not evidence-graded. The playbook or Ben may override them.
