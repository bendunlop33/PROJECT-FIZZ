# Exercise catalogue expansion: what to add next

Researcher, 22 Oct 2026; reviewed and corrected the same day (see "Review notes"). Research only: nothing has been added to the catalogue. Ben decides what goes in.

## Summary

1. I propose **175 new exercises**: **28 Must**, **65 Should** and **82 Could**. That would take the catalogue from 144 to about 319, close to the ~290–400 plan in `exercise-bank-and-visuals.md` §8.
2. The biggest gaps are **abs**, **common machines and accessories**, and **prehab and runner work**. On abs, the catalogue has bracing work and hanging raises but no crunch, sit-up, reverse crunch, ab machine, captain's chair, side bend, Russian twist or suitcase carry. The machines and accessories missing include the ab crunch machine, preacher curl, front raise, upright row, T-bar row, dip machine and Smith incline. Prehab and runner work is mostly absent: rotator cuff, band work, single-leg calf raise, tibialis raise, plyometrics.
3. Many of the "nuanced" PT variations should be **tags on a set**, not new exercises. These are Paused, Tempo, 1½ reps, Negative, Partial, Deficit or Elevated, Offset, Grip, Stance and Attachment. Only equipment, set-up or load-counting changes get their own entry.
4. **Before any entries can be written, several vocabulary and schema decisions are needed:**
   - New muscle words: `hip_flexors`, `rotator_cuff`, `serratus`, `tibialis`, `neck`.
   - Movement patterns `power` and `mobility`.
   - Equipment kinds for landmine, mini-band, Swiss ball, suspension trainer and GHD.
   - A load convention for plate-loaded iso-lateral machines and landmines.
5. **Proposed brief change:** add set modifiers to the logging data model. See "Proposed brief changes" below.

## Recommendations

1. **Approve batch 1 = the 28 Must entries.** About 40% of them are abs. These are what a UK gym-goer or PT expects to find, and what Ben's FitNotes history will most likely contain.
2. **Run the FitNotes import preview before writing the Should and Could entries** (brief build step 3). Ben's own exercise names should decide which Should and Could items are worth adding. Names that mean an existing exercise become aliases, not near-duplicates (`exercise-bank-and-visuals.md` §8).
3. **Adopt the modifier model (section 4)** instead of adding "Tempo squat", "Spoto press", "1½ goblet squat" and similar as separate entries. This needs a developer ADR. Modified sets must keep their own records line and never feed the base lift's estimated 1RM (rule 6).
4. **Decide the vocabulary gaps (section 5, Q1–Q3) before writing entries.** Otherwise leg raises get tagged as "abs only" and cuff work as "rear delts", which overstates what they train (rule 6).
5. **Write prehab entries as training exercises only, with no injury or condition claims** (rule 9). A 2024 meta-analysis of runner prevention programmes found no overall injury reduction, though a post hoc subgroup of three supervised programmes did better ([WU]). Strength training in general does reduce sports injuries ([LAU]).

## 1. How this was researched

- **Sources.** Exercise databases and app libraries:
  - JEFIT top-12 lists by muscle and equipment [J]
  - StrengthLog directory [S]
  - ExRx [E] (blocked direct fetch; search snippets only)
  - Hevy [H]
  - Fitbod [F]
  - ACE library [A]
  - PureGym equipment page [P]

  Also coach and trainer sources (NASM, NSCA, BarBend, Cressey, Gentilcore) and research papers where they exist. All were checked 22 Oct 2026.
- **Library sizes for context.**
  - Hevy: 400+ [H]
  - JEFIT: about 1,270 on its web database [J]
  - Fitbod: 1,000–1,600 [F]
  - wger: 932 [W]
  - Strong does not publish a figure.
- **Duplicate check.** I compared every proposal against all 144 entry names and their `aliases` fields. These were dropped or reworded because they already exist:
  - "Kneeling ab-wheel rollout", "Single-arm cable lateral raise", "Wide-grip lat pulldown", "V-bar/close-grip pulldown", "Cable crossover", "Static lunge", "Close-grip push-up", "Alternating dumbbell curl", "Prowler push" and "Cable pullover" are all aliases of existing entries.
  - "Bent-knee calf raise" is an alias of Seated calf raise.
  - "Lying triceps extension" is an alias of Skull crusher, so the dumbbell version below is named "Dumbbell skull crusher".
  - "Low row" is an alias of Seated cable row, so the machine is named "Plate-loaded low row".
- **Evidence labels.** "Commonness" and priority are **my judgement** (inference), based on how often each exercise appears across the libraries above. They are not measured data. Evidence for injury or performance claims is weak for most prehab and core work, as section 3 and the notes say.

## 2. Proposed additions (ranked)

**Priority key**
- **Must**: commonly expected in UK commercial gyms or programmed by most PTs.
- **Should**: common PT or accessory work.
- **Could**: niche, depends on the gym's kit, or mainly useful for import mapping.

**Muscle words** use the catalogue vocabulary. A `*` marks a word not yet in the vocabulary (Q1). **Load** is the default convention where it isn't obvious.

### Must (28)

| # | Name | Group | Equipment | Primary muscles | Why |
|---|---|---|---|---|---|
| 1 | Ab crunch machine | Core | Selectorised machine (stack) | abs, obliques | In almost every UK chain [P]. JEFIT top machine core pick [J]. Stack-loaded, so it progresses cleanly (rule 4). |
| 2 | Crunch | Core | Mat, optional plate | abs | Baseline in every app [J][S][H]. Needed for FitNotes name mapping. |
| 3 | Decline crunch | Core | Decline or ab bench, optional plate | abs | JEFIT top-3 core exercise [J]. Progress by bench angle or a plate. |
| 4 | Decline sit-up | Core | Decline bench | abs, hip_flexors* | Very common. ExRx files it under hip flexors [E]. Keep flexion volume moderate [CS]. |
| 5 | Reverse crunch | Core | Mat or bench | abs | Teaches tucking the pelvis under (posterior tilt). Step before hanging leg raises [A][REI]. |
| 6 | Captain's chair knee raise | Core | Captain's chair / dip station | abs, hip_flexors* | In almost every gym and easier on grip than hanging. Different station from Hanging knee raise, so its own entry. Top-ranked in an ACE study, though only a press release [ACE01]. |
| 7 | Lying leg raise | Core | Mat or flat bench | abs, hip_flexors* | JEFIT #2 core exercise [J]. Regression for Hanging leg raise. |
| 8 | Bicycle crunch | Core | Mat | obliques, abs | JEFIT #1 core exercise, listed there as "Air Bike" (an import name clash, see Q6) [J]. Top in ACE 2001 [ACE01]. |
| 9 | Russian twist | Core | Optional plate, dumbbell or med ball | obliques, abs | Widely logged. Coaches dispute combined flexion and rotation [LM], so use cautious cues and offer Pallof press or Landmine rotation as swaps. |
| 10 | Dumbbell side bend | Core | Dumbbell (per_hand, unilateral) | obliques | JEFIT #1 dumbbell core exercise [J]. The simplest loaded oblique exercise. |
| 11 | Suitcase carry | Core | One dumbbell or kettlebell (per_hand, unilateral; time or distance) | obliques, core, grip | The clearest exercise for resisting side-bending; a PT staple [NSCA][NFPT]. One implement changes load counting, so it is an entry, not an Offset tag on Farmer's carry. |
| 12 | Bird dog | Core | Mat | core, spinal_erectors, glutes | One of McGill's "Big 3" [HC]. Common PT warm-up [A]. |
| 13 | Mountain climber | Conditioning | None (timed) | core, front_delts, hip_flexors* | Class and circuit staple [NASM]. |
| 14 | Incline chest press machine | Chest | Machine (stack or plate) | upper_chest, front_delts, triceps | Standard in larger gyms. The upper-chest option when the incline bench is taken [J][E]. |
| 15 | Smith machine incline press | Chest | Smith machine (added) | upper_chest, front_delts, triceps | Very common UK hypertrophy staple [J][S][E]. Smith bar weight varies by gym, so record it per gym and never assume it. |
| 16 | T-bar row (landmine) | Back | Barbell in landmine + V-handle | lats, upper_back | Landmines are in most UK gyms. JEFIT #3 barbell back exercise [J][S]. Load convention needs deciding (Q3). |
| 17 | Rack pull | Back | Barbell + rack pins or blocks | upper_back, traps, spinal_erectors, glutes | Common PT deadlift variant [J][S]. Record pull height as a modifier, not separate entries. |
| 18 | Dumbbell front raise | Shoulders | Dumbbells | front_delts | In every app [J][S]. |
| 19 | Upright row | Shoulders | EZ bar or barbell | side_delts, traps | JEFIT #3 barbell shoulder exercise [J][E]. |
| 20 | Cable rear-delt fly | Shoulders | Cable crossover | rear_delts, upper_back | A staple alongside face pulls, with constant tension [S][BW]. |
| 21 | Preacher curl | Arms | EZ bar + preacher bench | biceps, brachialis | JEFIT #2 barbell biceps exercise; preacher benches are everywhere [J][S]. |
| 22 | Machine preacher curl | Arms | Machine (stack) | biceps, brachialis | JEFIT #1 machine biceps exercise [J][E]. |
| 23 | Seated dip machine | Arms | Machine (stack) | triceps | JEFIT #1 machine triceps exercise ("Machine Dip") [J]. |
| 24 | Leg-press calf raise | Legs | Leg press | calves | Very common when there's no calf machine. ExRx calls it the "sled calf press" [S][E]. Already named as an unlinked variation in Standing barbell calf raise. |
| 25 | Single-leg calf raise | Legs | Step, optional dumbbell (unilateral) | calves | Core runner exercise. Single-leg heel raises to fatigue are a standard calf test with published norms [HL]. |
| 26 | Cable external rotation | Prehab | Cable + D-handle | rotator_cuff*, rear_delts | The standard rotator-cuff exercise [REI][E]. Stack-loaded, so it suits the feasible-load rules. |
| 27 | Band pull-apart | Prehab | Long band (no load recorded) | rear_delts, upper_back | The most common upper-back warm-up [S]. |
| 28 | Lateral band walk | Prehab | Mini-band | abductors, glutes | Common PT warm-up. A small EMG study found a band at the ankles or feet works the glute med more than at the knees [PB]. Record band position as a modifier. |

### Should (65)

| Name | Group | Equipment | Primary muscles | Why |
|---|---|---|---|---|
| Oblique crunch | Core | Mat | obliques | JEFIT top-6 core exercise [J]. |
| Hollow body hold | Core | Mat (timed) | abs, hip_flexors* | Gymnastics foundation. A common prerequisite for the dragon flag [SL]. |
| Side plank hip dip | Core | Mat | obliques, abductors | Dynamic progression of Side plank [PG]. |
| Landmine rotation | Core | Landmine (added) | obliques, abs | Loaded, controlled rotation ("landmine 180s") [MS][FB]. |
| Cable side bend | Core | Low cable (stack) | obliques | Stack version of the side bend [J]. |
| V-up | Core | Mat | abs, hip_flexors* | PT circuit staple [S]. |
| Renegade row | Core | Two hex dumbbells (per_hand) | core, lats, upper_back | A loaded row from a plank that resists rotation [TM]. Hex dumbbells and a wide stance belong in the safety notes. |
| McGill curl-up | Core | Mat | abs | One of McGill's "Big 3". Low-range alternative to the crunch [HC]. |
| Toes-to-bar | Core | Pull-up bar | abs, hip_flexors*, lats | Progression from Hanging leg raise. Strict, not kipping. |
| Body saw | Core | Sliders or suspension straps | abs, core | Anti-extension progression beyond the plank [FV]. |
| Decline bench press | Chest | Barbell, decline bench | chest, triceps | JEFIT #3 barbell chest exercise [J]. Moved from Must: decline benches are less common in UK chains, and it adds little for Ben over flat and incline pressing (inference). |
| Incline dumbbell fly | Chest | Dumbbells, incline bench | upper_chest | JEFIT top dumbbell chest exercise [J]. |
| Plate-loaded chest press | Chest | Iso-lateral plate machine | chest, triceps | Common in UK gyms [E]. Load convention to decide (Q3). |
| Single-arm dumbbell bench press | Chest | One dumbbell (unilateral) | chest, triceps, obliques | PTs use it deliberately for rotation control. |
| Dumbbell floor press | Chest | Dumbbells, floor | chest, triceps | No spotter or bench needed; good for hotels and home [S]. |
| Pin press | Chest | Barbell, rack pins, bench | chest, triceps | Pressing from a dead stop for lockout strength [PIN]. |
| Incline push-up | Chest | Bench or bar | chest, triceps | Regression for Push-up. |
| Decline push-up | Chest | Bench (feet up) | upper_chest, front_delts, triceps | Push-up progression. |
| Chest-supported T-bar row machine | Back | Plate-loaded machine | lats, upper_back, rear_delts | Very common UK row machine [E][LF]. |
| Reverse-grip lat pulldown | Back | Cable + straight bar | lats, biceps | A real change of emphasis; JEFIT ranks it separately [J]. Kept as an entry to mirror the existing Pull-up / Chin-up split. |
| Neutral-grip pull-up | Back | Parallel handles | lats, biceps, brachialis | Needs a different station from Pull-up. |
| Meadows row | Back | Landmine, one arm | lats, upper_back, rear_delts | Distinct set-up; heavy grip demand [MR]. |
| Plate-loaded high row | Back | Iso-lateral plate machine | lats, upper_back | Common plate-loaded back machine [E]. |
| Back extension machine | Back | Seated machine (stack) | spinal_erectors | Common in selectorised ranges [J]. The 45° bench version already exists, and "Back extension" is its alias, so import must not auto-match this name to it. |
| Dead hang | Back | Pull-up bar (timed) | grip | Grip and shoulder position. Commonly programmed. The lats are stretched, not trained. |
| Machine lateral raise | Shoulders | Machine (stack) | side_delts | Common selectorised machine [S][E]. |
| Smith machine shoulder press | Shoulders | Smith machine (added) | front_delts, triceps | Common [S]. |
| Reverse curl | Arms | EZ bar or barbell, overhand grip | forearms, brachialis | Shifts work to the forearm (brachioradialis) [S]. The catalogue has no forearm exercises yet. |
| Bayesian cable curl | Arms | Cable, facing away (unilateral) | biceps | PT favourite for training the biceps in a stretched position. I couldn't read the 2025 trial's results [BAY], so the evidence is uncertain. |
| Dumbbell skull crusher | Arms | Dumbbells, flat bench | triceps | JEFIT top dumbbell triceps exercise [J]. Named to avoid the existing "Lying triceps extension" alias. |
| EZ-bar overhead triceps extension | Arms | EZ bar | triceps | Overhead triceps work grew the long head more than arm-by-side work (21 mostly untrained adults) [MAEO]. |
| Wrist curl | Arms | Dumbbell or barbell, bench | forearms | Standard forearm exercise [S][FB2]. |
| Reverse wrist curl | Arms | Dumbbell or barbell, bench | forearms | Balances the wrist curl. |
| Bench dip | Arms | Bench | triceps | Hotel and home staple. |
| Barbell reverse lunge | Legs | Barbell | quads, glutes | JEFIT #2 barbell leg exercise is a lunge [J]. |
| Dumbbell forward lunge | Legs | Dumbbells | quads, glutes | Only reverse and walking lunges exist so far [J]. |
| Smith machine calf raise | Legs | Smith machine (added) | calves | Common substitute calf station. Already named as an unlinked variation in Standing barbell calf raise. |
| Single-leg leg extension | Legs | Leg extension (stack, unilateral) | quads | Fixes left-right differences. Follows the Single-leg press precedent. |
| Single-leg leg curl | Legs | Lying or seated leg curl (stack, unilateral) | hamstrings | As above. |
| Landmine squat | Legs | Landmine (added) | quads, glutes | Front-loaded and easy to learn [S]. |
| Lateral lunge | Legs | Bodyweight or goblet dumbbell | adductors, quads, glutes | PT staple for side-to-side movement [S]. |
| Wall sit | Legs | Wall (timed) | quads | Simple isometric. |
| Step-down | Legs | Box or step | quads, abductors | Common physio knee-control exercise. No outcome evidence found, so uncertain. |
| Tibialis raise | Legs | Wall, tib bar or slant board | tibialis* | Popular with runners. A 2025 meta-analysis found neuromuscular training programmes helped prevent shin splints (MTSS), but it does not isolate tibialis raises [MTSS], so make no claims for this exercise. |
| Reverse Nordic | Legs | Pad, kneeling | quads | Common knee-dominant eccentric in PT and football programmes. |
| Pin squat | Legs | Barbell + rack safeties | quads, glutes | Squatting up from a dead stop [NFPT2]. |
| Hip thrust machine | Glutes | Plate or stack machine | glutes | Increasingly standard in UK gyms. Much quicker to set up than a barbell hip thrust [E]. |
| Smith machine hip thrust | Glutes | Smith machine (added) | glutes | Common [S]. |
| Barbell glute bridge | Glutes | Barbell, floor | glutes | Floor version of the hip thrust. |
| Single-leg glute bridge | Glutes | None or added load (unilateral) | glutes, hamstrings | Unilateral progression of Glute bridge. |
| Cable hip abduction | Glutes | Cable + ankle cuff (stack) | abductors | For when the machine is busy [S]. |
| Band external rotation | Prehab | Long band | rotator_cuff* | Warm-up and travel version of cable external rotation [PT]. |
| Side-lying dumbbell external rotation | Prehab | Light dumbbell, bench or floor | rotator_cuff* | High cuff activity in EMG work [REI]. |
| Incline Y-raise | Prehab | Light dumbbells, incline bench | traps, rear_delts, upper_back | Lower-trap-biased exercise from the Cools set [COOLS]. Primary paper not checked, so uncertain. |
| Scapular pull-up | Prehab | Pull-up bar | lats, traps | Lead-in to and regression for pull-ups. |
| Clamshell | Prehab | Mat, optional mini-band | abductors, glutes | Recommended for isolated glute-med work [DIS]. |
| Side-lying hip abduction | Prehab | Mat, optional ankle weight | abductors | Highest glute-med EMG of the 12 exercises tested [DIS]. |
| Jump rope | Conditioning | Rope (timed) | calves | Very common warm-up and conditioning. |
| Medicine ball slam | Conditioning | Slam ball | lats, abs | Common commercial-gym conditioning exercise. |
| Medicine ball rotational throw | Conditioning | Med ball + solid wall (per side) | obliques, glutes | Rotational power [SF]. Needs wall space, so uncertain in some gyms. |
| Pogo jumps | Conditioning | None (contacts or time) | calves | Basic runner plyometric. Plyometrics plus strength training improves running economy (tentative) [DB]. |
| Broad jump | Conditioning | None | glutes, quads | Horizontal power; simple self-test. |
| Squat jump | Conditioning | None, optional dumbbells | quads, glutes | Basic vertical jump. |
| Lateral bound | Conditioning | None | glutes, abductors, quads | Single-leg sideways power and landing control for runners. |
| Dumbbell thruster | Conditioning | Dumbbells | quads, glutes, front_delts | Common in HYROX-style and class sessions [S]. |

### Could (82)

The "Why" column is kept short. Most of these are gym-specific, advanced, or mainly useful for import mapping.

| Name | Group | Equipment | Primary muscles | Why |
|---|---|---|---|---|
| Stir the pot | Core | Swiss ball | abs, obliques | Anti-extension progression [CR]. No Swiss-ball equipment kind yet. |
| Dragon flag | Core | Flat bench | abs | Advanced; use negative and tuck progressions [SL]. |
| Windscreen wipers | Core | Pull-up bar or floor | obliques, abs | Advanced. Add the US alias "windshield wipers". |
| L-sit | Core | Dip bars or parallettes (timed) | abs, hip_flexors* | Isometric skill. |
| Flutter kicks | Core | Mat | abs, hip_flexors* | Class staple; mainly for import mapping. |
| Suitcase deadlift | Core | One dumbbell, kettlebell or barbell | obliques, glutes | One-sided deadlift; coaching sources only [DR]. |
| 45° side bend | Core | 45° back-extension bench | obliques | Reuses an existing station [FVS]. Don't call it "Roman chair side bend" (Q6). |
| Swiss ball crunch | Core | Stability ball | abs | Longer range of motion. Ball availability varies. |
| Rotary torso machine | Core | Machine (stack) | obliques | Some UK gyms only. Add for logging, not to recommend. |
| Plank shoulder taps | Core | Mat | core, obliques | Plank progression [NASM]. |
| Hollow rock | Core | Mat | abs | Dynamic version of the hollow hold. |
| Kettlebell windmill | Core | Kettlebell | obliques, glutes | Advanced kettlebell skill; the shoulder stabilises rather than lifts. |
| Barbell floor press | Chest | Barbell, rack | chest, triceps | Lockout work. |
| Decline dumbbell press | Chest | Dumbbells, decline bench | chest | Less common [J]. |
| Cable chest press | Chest | Cables (stack) | chest | Standing press. |
| Plate-loaded low row | Back | Iso-lateral plate machine | upper_back, lats | Common [E]. Load convention (Q3). |
| Plate-loaded pulldown | Back | Iso-lateral plate machine | lats | Load convention (Q3). |
| Smith machine row | Back | Smith machine | upper_back | [J] |
| Suspension row | Back | TRX or rings | upper_back, lats | Hevy lists suspension equipment [H]. |
| Reverse hyperextension | Back | Reverse hyper machine | glutes, hamstrings | Rare in commercial gyms [E]. "Hyperextension" is an alias of 45° back extension, so import must not auto-match. |
| Machine pullover | Back | Machine (stack) | lats | Older gyms only; uncertain. |
| Cable front raise | Shoulders | Cable | front_delts | [J] |
| Cable upright row | Shoulders | Cable | side_delts, traps | [J] |
| Cable Y-raise | Shoulders | Cable | side_delts, traps | Trending with PTs; app coverage uncertain. |
| Pike push-up | Shoulders | None | front_delts, triceps | Bodyweight pressing progression. |
| Overhead carry | Shoulders | Kettlebell or dumbbell | front_delts, core | Shoulder stability while walking. |
| Bottoms-up kettlebell press | Shoulders | Kettlebell | front_delts, grip | Shoulder and grip control. |
| Machine shrug | Shoulders | Machine | traps | [J]. Already named as an unlinked variation in Barbell shrug. |
| Kettlebell halo | Shoulders | Kettlebell | front_delts, core | Warm-up and mobility. |
| Cable triceps kickback | Arms | Cable | triceps | Cable version of an existing exercise. |
| Cross-body cable triceps extension | Arms | Cable | triceps | Trending [S]. |
| Machine triceps extension | Arms | Machine (stack) | triceps | [S][E] |
| Spider curl | Arms | Dumbbells or EZ bar, incline bench | biceps | [J][S] |
| Zottman curl | Arms | Dumbbells | biceps, forearms | [S] |
| Cross-body hammer curl | Arms | Dumbbell | brachialis, forearms | [J] |
| Wrist roller | Arms | Wrist roller | forearms, grip | Forearm finisher. |
| Plate pinch | Arms | Plates (timed) | grip | Per-hand grip work. |
| Belt squat | Legs | Belt squat machine | quads, glutes | Squat with very little spinal load [BS]. Not in every gym. |
| Pendulum squat | Legs | Plate-loaded machine | quads | "Bodybuilding" gyms only; no good source found. |
| Glute-ham raise | Legs | GHD | hamstrings, glutes | Progression from the Nordic curl; GHD availability is low. |
| Standing leg curl machine | Legs | Machine (stack, unilateral) | hamstrings | Third leg-curl format [J]. |
| Standing cable leg curl | Legs | Cable + ankle cuff | hamstrings | [J] |
| Cossack squat | Legs | Bodyweight or goblet | adductors, quads | Mobility and strength [S]. |
| Single-leg box squat | Legs | Box or bench | quads, glutes | Pistol progression for runners. |
| Sissy squat | Legs | None or sissy bench | quads | Niche. |
| Spanish squat | Legs | Strap round a rack upright | quads | Widely used by physios. No direct evidence [RIO], so no condition claims. |
| Zercher squat | Legs | Barbell | quads, upper_back | [S] |
| Smith machine Romanian deadlift | Legs | Smith machine | hamstrings, glutes | [J][S] |
| Smith machine reverse lunge | Legs | Smith machine | quads, glutes | [S] |
| Glute kickback machine | Glutes | Machine (stack) | glutes | The cable version already exists [S], and "Glute kickback" is its alias, so import must not auto-match. |
| Frog pump | Glutes | None or dumbbell | glutes | High-rep filler. |
| Hip airplane | Glutes | None | glutes, abductors | Balance and hip control; evidence uncertain. |
| Single-leg hip thrust | Glutes | Bench | glutes | Unilateral hip thrust. |
| Cable hip adduction | Glutes | Cable + ankle cuff | adductors | For when the machine is busy. |
| Multi-hip machine | Glutes | Machine | glutes, abductors, adductors | Older gyms. |
| Adductor squeeze | Prehab | Ball or roller (timed) | adductors | Common physio groin isometric. |
| 90/90 external rotation | Prehab | Cable or band | rotator_cuff* | Rotation strength with the arm raised. |
| Cable internal rotation | Prehab | Cable | rotator_cuff* | Partner to external rotation. |
| Prone T-raise | Prehab | Light dumbbells, incline bench | traps, rear_delts | Pair with the incline Y-raise [COOLS]. |
| Push-up plus | Prehab | Floor | serratus* | Classic serratus exercise; EMG support not checked. |
| Wall slide | Prehab | Wall, optional band | serratus*, traps | Physio favourite for overhead shoulder control. |
| Neck isometrics (4-way) | Prehab | Hand resistance (timed) | neck* | Neck training helped office workers' neck pain [AND]. Gym-use evidence is C. Needs extra review. |
| Plate neck flexion and extension | Prehab | Plate on a towel, bench | neck* | As above; strict technique notes needed. |
| Medicine ball chest pass | Conditioning | Med ball + wall | chest, triceps | Upper-body power. |
| Single-leg hop | Conditioning | None | calves, quads | Plyometric progression. |
| A-skip / B-skip | Conditioning | Space (distance) | calves, hamstrings | Running drills; fits Ben's running. |
| Drop jump | Conditioning | Box | calves, quads | Advanced. Only after landings are solid. |
| Snap-down | Conditioning | None | quads, glutes | Landing drill; the regression for every jump. |
| Devil press | Conditioning | Dumbbells | full body (quads, chest, front_delts) | HYROX and class staple. |
| Backwards sled drag | Conditioning | Sled + straps | quads | Low-impact quad work. |
| Sandbag carry | Conditioning | Sandbag | core, grip | HYROX-relevant; extends Sandbag lunge. |
| Jumping jacks | Conditioning | None | calves | Warm-up and class staple. |
| Kettlebell clean and press | Conditioning | Kettlebell | front_delts, glutes | Combines two existing entries. |
| Power clean | Conditioning | Barbell | glutes, quads, traps | In Hevy and StrengthLog [S]. Low priority for Ben. |
| World's greatest stretch | Mobility | None | (mobility) | Common warm-up. Stretching alone doesn't prevent injury [LAU]. |
| Hip 90/90 switches | Mobility | None | (mobility) | Hip rotation range. |
| Couch stretch | Mobility | Bench or wall | (mobility) | Hip flexor and quad length. |
| Half-kneeling hip flexor stretch | Mobility | None | (mobility) | Classic runner stretch. |
| Open book | Mobility | None | (mobility) | Upper-back rotation. |
| Cat-cow | Mobility | None | (mobility) | Spine warm-up. |
| Deep squat hold | Mobility | None (timed) | (mobility) | Squat range. |
| Knee-to-wall ankle mobilisation | Mobility | Wall | (mobility) | Ankle range drill and self-test. |

**Not proposed:**
- Jefferson curl: loaded spinal flexion that coaches dispute.
- Overcoming isometrics and the isometric mid-thigh pull: force can't be measured, so they would invent data (rule 6).
- Board press: needs a partner.
- GHD sit-up: GHDs are rare in UK gyms.
- Power Wheel pike: needs foot straps, which UK gyms rarely have.

**Moved to modifiers or aliases (not new entries):**

| Former proposal | Becomes | Why |
|---|---|---|
| Deficit deadlift (Should) | Deadlift + Elevation: Deficit | Same bar and station; the doc's own rule makes deficit a tag. Deficit Romanian deadlift stays as-is only to keep existing history. |
| Larsen press (Could) | Bench press + Stance: feet up | Stance change on the same bench and bar. |
| Underhand barbell row / "Yates row" (Could) | Barbell row + Grip: underhand | Grip change on the same bar. |
| Snatch-grip Romanian deadlift (Could) | Romanian deadlift + Grip: wide | Grip-width change on the same bar. |
| Stiff-leg deadlift (Could) | Alias of Romanian deadlift (Q5), unless Ben's FitNotes history logs both separately | Its dumbbell form is already an RDL alias; a separate barbell entry would split records for what most gyms treat as the same lift. |
| Flexed-arm hang (Could) | Chin-up + Isometric hold (top) | The modifier table already lists "chin-up top hold". |
| Dumbbell sumo squat (Could) | Goblet squat + Stance: wide | Same single dumbbell held in front; only the stance changes. |

## 3. Abs and core by function

Bold = proposed (priority in brackets). Plain = already in the catalogue. *Italic* = better as a variation or modifier of an existing entry.

| Function | What it trains | Exercises |
|---|---|---|
| **Flexion** (crunching) | Rectus abdominis size and strength; the main tools for visible abs [CS] | Cable crunch; **Ab crunch machine (Must)**; **Crunch (Must)**; **Decline crunch (Must)**; **Decline sit-up (Must)**; **Reverse crunch (Must)**; **Bicycle crunch (Must)**; **Oblique crunch (Should)**; **V-up (Should)**; **McGill curl-up (Should)**; **Swiss ball crunch (Could)**; *Standing cable crunch* |
| **Hip flexion** (raises) | Mostly hip flexors, with the abs holding the pelvis | Hanging knee raise; Hanging leg raise; **Captain's chair knee raise (Must)**; **Lying leg raise (Must)**; **Toes-to-bar (Should)**; **L-sit (Could)**; **Flutter kicks (Could)**; **Mountain climber (Must)**; *Captain's chair straight-leg raise* |
| **Anti-extension** (resisting arching) | Bracing for squats, deadlifts and overhead work | Plank; Dead bug; Ab-wheel rollout; **Hollow body hold (Should)**; **Body saw (Should)**; **Hollow rock (Could)**; **Stir the pot (Could)**; **Dragon flag (Could)**; **Plank shoulder taps (Could)**; *Weighted plank, RKC plank, long-lever plank; barbell and standing rollout; banded or weighted dead bug* |
| **Anti-rotation** (resisting twisting) | Trunk control under one-sided load; running posture (coaching consensus, weak evidence [BS2]) | Pallof press; Bear crawl; **Bird dog (Must)**; **Renegade row (Should)**; *Half-kneeling, tall-kneeling, split-stance and overhead Pallof (stance modifiers)* |
| **Rotation** (controlled twisting) | Obliques and rotational power | Cable woodchop; **Landmine rotation (Should)**; **Russian twist (Must, cautious cues)**; **Medicine ball rotational throw (Should)**; **Rotary torso machine (Could)**; **Windscreen wipers (Could)**; *High-to-low and low-to-high chops, half-kneeling chop and lift* |
| **Side-bending** | Loadable oblique work | **Dumbbell side bend (Must)**; **Cable side bend (Should)**; **45° side bend (Could)**; **Kettlebell windmill (Could)** |
| **Anti-side-bending** (resisting leaning) | Obliques and quadratus lumborum; carries over to single-leg running stance (inference) | Side plank; Copenhagen plank; Farmer's carry; Kettlebell front-rack carry; Turkish get-up; **Suitcase carry (Must)**; **Side plank hip dip (Should)**; **Suitcase deadlift (Could)**; *Star side plank; short-lever Copenhagen* |

The evidence is weak, and the catalogue text should say so:
- EMG studies rank the rollout, bicycle crunch and captain's chair highly [ESC][ACE01]. But muscle activity does not equal growth, and ACE 2001 is only a press release.
- Core training does not reliably improve running performance [BS2].
- Moderate flexion volume is reasonable for healthy lifters [CS].

## 4. Modifier model: tags vs their own entries

**Rule.** A variant gets **its own entry** if any of these is true:
- It needs different equipment or a different station (pins, boxes, landmine, Smith machine, specific machine, handle). This matters for gym feasibility (rule 4).
- It logs load differently.
- The body set-up changes, so the guide needs redrawing.
- PTs programme it on purpose for a different muscle emphasis.

Otherwise it is a **modifier tag** on the planned or logged set. This matches what competitors push users into: Fitbod tells users to create custom exercises for grip or stance changes [FBH], and Hevy users make custom "Paused Squat" entries or add notes [H]. A structured tag avoids that clutter.

**Proposed modifiers.** Short chip text in the UI, with explanations only behind an info tap:

| Modifier | Chip | Examples it replaces |
|---|---|---|
| Pause (position, seconds) | Paused 2s | Spoto press, paused deadlift, peak-squeeze rows |
| Tempo (down, bottom hold, up, top hold) | 3-1-1-0 | Tempo squat, slow eccentrics |
| 1½ reps | 1½ | 1½ goblet squat, 1½ split squat |
| Eccentric only | Negative | Negative chin-up, negative dip |
| Range (lengthened partial, top half, bottom half) | Partial | Half squat, lengthened-partial leg extension |
| Elevation (what, height) | Elevated / Deficit | Deficit deadlift, deficit reverse lunge, heels-elevated goblet squat, front-foot-elevated split squat |
| Offset (one implement or uneven loads) | Offset | Offset reverse lunge, one-sided goblet squat |
| Alternating (reps per side) | Alt | Alternating dumbbell curl or press |
| Grip (width and orientation) | Wide / Close / Under | Wide-grip bench, snatch-grip RDL, underhand (Yates) row |
| Stance (half-kneeling, tall-kneeling, split, feet-up, wide) | Half-kneel | Half-kneeling Pallof, half-kneeling landmine press, Larsen press, dumbbell sumo squat |
| Foot position | High feet | Leg press and hack squat foot placement |
| Attachment and pulley height | Rope / Low | Cable rows, pulldowns, cable fly angles |
| Accommodating resistance (bands or chains, label only) | Bands | Banded squat. Never invent band tension in kg (rule 6). |
| Band assist (label) | Band-assist | Band-assisted pull-up |
| Isometric hold (position, seconds) | Hold 5s | Split-squat bottom hold, chin-up top hold (flexed-arm hang) |
| Pull height | Below knee | Rack pull height |

**How the model works:**
- **Records.** Modifiers that change how much you can lift (pause, tempo, 1½ reps, negative, range, elevation, bands, assist, offset, pull height) get **their own records line** and never feed the base lift's estimated 1RM or progression comparisons. They still count towards weekly muscle volume.
- **Allowed modifiers per entry.** Each catalogue entry lists which modifiers it allows, so no one can attach a grip tag to a leg press. Named presets such as "Spoto press", "Anderson squat", "Larsen press" or "Yates row" become search aliases that resolve to base exercise + modifier.
- **Rules 3 and 9.** Adding or removing a load-affecting modifier on future sessions is a **proposal** (Apply/Undo). A pain flag applies to the movement whatever its modifiers.
- **Guides.** No new animations are needed: tempo and pause retime the existing guide.
- **Existing entries.** Keep Paused back squat, Paused bench press, Deficit Romanian deadlift and Box squat as they are, so no history moves.
- **Not modifiers.** Drop sets, rest-pause, myo-reps and lengthened partials after failure are **set types**, not modifiers.

**Evidence for the common modifiers (all modest):**
- Tempo: rep durations of roughly 0.5–8 s give similar growth [TEMPO].
- Lengthened partials: about equal to full range in trained lifters, with a small edge in beginners [WOLF].
- 1½ reps: no direct study found (coaching convention only).
- Isometrics: gains are mostly specific to the joint angle trained [ORAN].

## 5. Open questions for Ben

1. **Muscle words.** Add `hip_flexors`, `rotator_cuff`, `serratus`, `tibialis` and `neck` to the vocabulary? Without them, leg raises read as "abs only" and cuff work as "rear delts". `hip_flexors` is already used in `packages/domain` `first-run.ts` but not in the catalogue list.
2. **New patterns and equipment.** Add `power` (jumps, throws) and `mobility` movement patterns? Add equipment kinds for landmine, mini-band, Swiss ball, suspension trainer, slant board and GHD?
3. **Plate-loaded iso-lateral machines and landmines.** How should their loads be logged? My suggestion is `added` (plates loaded, per side stated) with no estimated 1RM, because the real resistance isn't the plate weight. This needs a developer ADR.
4. **Modifier model.** Approve tags (section 4) instead of separate entries for paused, tempo, 1½, negative, partial, deficit, grip, stance and attachment variants? Should grip, attachment and foot position split records, or only the load-affecting ones?
5. **Near-duplicates.** The review recommends "Stiff-leg deadlift" (barbell) as an alias of Romanian deadlift by default (its dumbbell form already is). Should "Kettlebell single-leg RDL" and "Single-arm kettlebell swing" be aliases or entries?
6. **Name clashes for FitNotes import.**
   - JEFIT and ExRx use "Air bike" for the **bicycle crunch**, while ours is the fan bike.
   - UK gyms often call the captain's chair a "Roman chair", which is already an alias of 45° back extension.
   - "Knee raise" is an alias of Hanging knee raise but is also how people log the captain's chair version.
   - "Back extension", "Hyperextension", "Glute kickback" and "Rear delt fly" are existing aliases that collide with proposed machine or cable entries.
   - Should import matching ask Ben to confirm all of these?
7. **Mobility drills.** Include them at all (8 Could entries)? They would be excluded from volume and progression counts.
8. **Neck work.** Include it (2 Could entries, with extra review), or leave it out?
9. **Batch order.** Approve the 28 Must entries now, and decide on Should and Could after the FitNotes import shows which names you actually use?

## Proposed brief changes

These need Ben's approval. Record them in `docs/brief/CHANGELOG.md`, with an ADR for the schema.

1. **Brief §6 data model.** Add an optional `modifiers` list (a discriminated union) to planned and logged sets and to routine exercise defaults. Records and progression compare like with like (section 4). This extends the brief; it doesn't contradict it.
2. **Catalogue vocabulary (Q1–Q3).** Add the new muscle words, `power` and `mobility` patterns, and equipment kinds. Also decide the plate-loaded and landmine load convention.

## Review notes

Reviewer pass, 22 Oct 2026. Checked against all 144 catalogue names, aliases and listed variations, and `packages/catalogue/src/muscles.ts`.

**Duplicates and trivial variants (7 removed from the tables, all Could except one Should):**
- Moved to the modifier model: Deficit deadlift (Should), Larsen press, Underhand barbell row, Snatch-grip Romanian deadlift, Flexed-arm hang, Dumbbell sumo squat. Each is the same bar or station with a grip, stance, elevation or hold change, which the section 4 rule makes a tag. Grip and Stance modifier rows were widened to cover them.
- Stiff-leg deadlift: moved to an alias of Romanian deadlift by default (Q5).
- Kept as entries after checking: Captain's chair knee raise (different station from Hanging knee raise), Suitcase carry and Suitcase deadlift (one implement changes load counting), Reverse-grip lat pulldown (mirrors the Pull-up / Chin-up split; borderline). Noted that Leg-press calf raise, Smith machine calf raise and Machine shrug already appear as unlinked variations in existing entries, and flagged four alias collisions for import (Q6).

**Muscles corrected:**
- Rack pull: hamstrings replaced by traps and spinal_erectors (an above-knee pull is mostly upper back, traps and erectors).
- Plate-loaded high row: traps → upper_back.
- Dead hang: lats removed (stretched, not trained); grip only.
- Kettlebell windmill: side_delts → glutes.
- Lateral bound and Dumbbell thruster: added quads and glutes respectively.

**Priority:** Decline bench press moved from Must to Should (less common in UK chains, low value for Ben next to flat and incline pressing; inference). Counts are now 28 Must, 65 Should, 82 Could (175 total).

**Source spot-check (6):**
- [J] JEFIT core list: confirmed. Ranks Air Bike #1, Leg Raise #2, Decline Crunch #3, Hanging Leg Raise #4, Oblique Crunch #5, Crunch as bonus.
- [REI] Reinold 2004: citation confirmed (J Orthop Sports Phys Ther 34(7):385–94). Side-lying ER as the top exercise is supported only by a secondary source in this check.
- [HL] Hébert-Losier 2017: confirmed (566 adults, excellent reliability, published norms). It is an original study, not a review.
- [MAEO] Maeo 2023: confirmed. Note the 21 participants were mostly untrained; wording updated.
- [MTSS] 2025 meta-analysis: exists, but the original wording ("no evidence it prevents shin pain") misrepresented it. It found neuromuscular training effective for prevention. Tibialis raise note rewritten.
- [WU] Wu 2024: exists; no overall reduction, but supervised programmes did better in a post hoc analysis. Recommendation 5 reworded.
- [P] PureGym equipment page: returned HTTP 502 twice on 22 Oct 2026, so the "ab crunch machine in almost every UK chain" claim is **unverified** in this pass.

## Sources (all checked 22 Oct 2026)

- [J] JEFIT: https://www.jefit.com/exercises ; https://www.jefit.com/wp/exercise-tips/most-popular-jefit-exercise-for-major-muscle-groups/ ; https://www.jefit.com/blog/6-most-popular-jefit-strength-machine-exercises ; https://www.jefit.com/blog/get-ripped-with-these-popular-jefit-core-exercises
- [S] StrengthLog directory: https://www.strengthlog.com/exercise-directory/
- [E] ExRx (search snippets; direct fetch blocked): https://exrx.net/Lists/ExList/WaistWt ; https://exrx.net/WeightExercises/HipFlexors/WtDeclineSitup ; https://exrx.net/WeightExercises/PectoralSternal/LVChestPressH ; https://exrx.net/WeightExercises/BackGeneral/LVTBarRow ; https://exrx.net/WeightExercises/BackGeneral/LVSeatedHighRow ; https://exrx.net/WeightExercises/Brachialis/LVPreacherCurl ; https://exrx.net/WeightExercises/DeltoidLateral/LVLateralRaise ; https://exrx.net/WeightExercises/GluteusMaximus/LVHipThrustPL ; https://exrx.net/WeightExercises/GluteusMaximus/LVReverseHyperextension ; https://exrx.net/Kinesiology/CalfExercises ; https://exrx.net/WeightExercises/PectoralClavicular/SMInclineBenchPress ; https://exrx.net/WeightExercises/DeltoidLateral/BBUprightRow ; https://exrx.net/WeightExercises/Infraspinatus/CBStandingExternalRotation
- [H] Hevy: https://help.hevyapp.com/hc/en-us/articles/35688251991575-Hevy-Exercise-Library-400-Exercises-and-Custom-Exercises ; https://www.hevyapp.com/exercises/ ; https://www.hevyapp.com/compound-isolation-abs-exercises/
- [F] Fitbod: https://fitbod.me/about-fitbod-exercises ; [FBH] https://help.fitbod.me/hc/en-us/articles/28062570249623 ; [FB] https://fitbod.me/exercises/landmine-core-rotation ; [FB2] https://fitbod.me/workouts/forearms-workouts-to-build-strength
- [W] wger: https://wger.de/api/v2/exerciseinfo/?format=json&limit=1
- [P] PureGym equipment: https://one.puregym.com/equipment (HTTP 502 on re-check, 22 Oct 2026)
- [A] ACE library: https://www.acefitness.org/resources/everyone/exercise-library/76/reverse-crunch/ ; https://www.acefitness.org/resources/everyone/exercise-library/14/bird-dog/
- [ACE01] ACE 2001 ab study (press release): https://www.acefitness.org/about-ace/press-room/press-releases/246/american-council-on-exercise-ace-sponsored-study-reveals-best-and-worst-abdominal-exercises/
- [ESC] Escamilla 2010: https://pubmed.ncbi.nlm.nih.gov/20436242/ ; [REI-core] https://mikereinold.com/core-stability-abdominal-exercises/
- [CS] Contreras & Schoenfeld 2011: https://bretcontreras.com/wp-content/uploads/To-Crunch-or-Not-to-Crunch-An-Evidence-Based-Examination-of-Spinal-Flexion-Exercises-Their-Potential-Risks-and-Their-Applicability-to-Program-Design.pdf
- [HC] Harvard Health, McGill Big 3: https://www.health.harvard.edu/staying-healthy/three-moves-for-better-spine-health
- [BS2] Core training meta-analysis: https://www.termedia.pl/Core-training-and-performance-a-systematic-review-with-meta-analysis,78,49398,1,1.html
- [LM] Les Mills: https://www.lesmills.com/uk/articles/the-ab-exercise-to-avoid
- [NASM] https://www.nasm.org/resource-center/blog/training/best-abs-exercises
- [NSCA] Loaded carries: https://www.nsca.com/education/articles/nsca-coach/increase-hip-and-trunk-stability-with-loaded-carries/ ; [NFPT] https://nfpt.com/suitcase-carries-how-to-do/
- [DR] https://davidwilliamrosales.com/2018/07/17/essentials-of-abdominal-training-for-sport-part-3-antilateral-flexion/
- [SL] StrengthLog dragon flag: https://www.strengthlog.com/dragon-flag/
- [PG] Prehab Guys: https://theprehabguys.com/vimeo-video/star-side-plank-hip-dip/
- [MS] https://www.muscleandstrength.com/exercises/landmine-rotation
- [TM] Renegade row: https://themanual.com/fitness/how-to-do-the-renegade-row
- [FV] Body saw: https://fitnessvolt.com/body-saw/ ; [FVS] https://fitnessvolt.com/strength-standards/muscle/abdominals/
- [CR] Cressey, stir the pot: https://ericcressey.com/5-lose-fat-gain-muscle-get-strong-move-better-53/
- [BW] BarBend cable exercises: https://barbend.com/best-cable-exercises/
- [PIN] BarBend pin press: https://barbend.com/news/pin-press-guide/ ; [NFPT2] https://nfpt.com/10-best-exercises-to-build-a-better-squat/
- [MR] Meadows row: https://powerliftingtechnique.com/meadows-row/
- [LF] Plate-loaded T-bar row reference: https://www.lifefitness.com/en-gb/catalog/strength-training/plate-loaded/iso-lateral-t-bar-row
- [BS] Belt squat: https://simplifaster.com/articles/mastering-belt-squat-exercise/
- [MAEO] Maeo 2023 overhead triceps: https://pubmed.ncbi.nlm.nih.gov/35819335/
- [BAY] Bayesian vs preacher cable curl 2025: https://pubmed.ncbi.nlm.nih.gov/40082069/
- [TEMPO] https://www.strongerbyscience.com/?p=62408 ; https://biolayne.com/reps/issue-40/does-eccentric-speed-impact-your-gains/
- [WOLF] https://doaj.org/article/99e86b317bec40f5abc2f0008358737e ; https://peerj.com/articles/18904
- [ORAN] Oranchuk 2019: https://openrepository.aut.ac.nz/items/1a37e689-0027-4a12-9815-07ff2818b768/full
- [REI] Reinold 2004 external rotation EMG: https://pubmed.ncbi.nlm.nih.gov/15296366/
- [COOLS] Lower-trap exercises (secondary citation): https://ijspt.scholasticahq.com/article/74969
- [PT] Physitrack band external rotation: https://www.physitrack.com/exercise-library/how-to-perform-the-external-rotation-band-exercise
- [DIS] DiStefano 2009 summary: https://brookbushinstitute.com/article/gluteal-muscle-activation-during-common-therapeutic-exercises
- [PB] Band placement EMG: https://pubmed.ncbi.nlm.nih.gov/22464817/
- [HL] Hébert-Losier 2017 heel-rise norms: https://pubmed.ncbi.nlm.nih.gov/28886865/
- [MTSS] MTSS prevention meta-analysis 2025: https://pubmed.ncbi.nlm.nih.gov/40633262/
- [RIO] Rio 2015: https://bjsm.bmj.com/content/49/19/1277.abstract
- [AND] Andersen neck/shoulder training: https://search.pedro.org.au/search-results/record-detail/32942
- [LAU] Lauersen 2014: https://bjsm.bmj.com/content/48/11/871
- [WU] Wu 2024 runners: https://pmc.ncbi.nlm.nih.gov/articles/PMC11127851/
- [DB] Plyometrics and running economy: https://hrcak.srce.hr/clanak/447258
- [SF] Med ball rotational throw: https://simplifaster.com/articles/donatucci-medicine-ball-rotational-throw/

Repo files checked: all 144 `packages/catalogue/data/exercises/*.json` names, aliases and variations; `packages/catalogue/src/muscles.ts`, `vocab.ts`, `entry-schema.ts`; `packages/schemas/src/common.ts`; `docs/research/exercise-bank-and-visuals.md` §8.
