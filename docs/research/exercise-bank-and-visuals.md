# Exercise bank and visual guides

Checked 2026-10-09. Researcher agent. No accounts, sign-ups or trials were used. Labels: **[Doc]** = official page, licence text or API response; **[Reports]** = user or third-party reports; **[Inference]** = my reasoning, not proven.

Scope, as updated by the coordinator on 2026-10-09:
- A **big basic catalogue** of about 250–400 entries (name, aliases, equipment, load convention, muscles, pattern), seeded from an openly licensed dataset where the licence allows.
- **Rich entries** (cues, safety notes, guide brief and an animated guide) start with **10 examples** and grow later to about 100–150.
- Two downstream agents: `exercise-researcher` writes `packages/catalogue/data/exercises/<id>.json`, and `exercise-guide-maker` makes original animated guides in `packages/catalogue/guides/<id>/`.
- Ben has overridden EL8 ("no exercise videos").

## Summary

1. **Don't use free-exercise-db, ExerciseDB or its forks, or any GIF reseller.** free-exercise-db says it is public domain, but its instruction text matches bodybuilding.com word for word. ExerciseDB-style GIF sets have no clear owner, and one dataset marks its media "© Gym visual". The only usable open source is **wger** (CC BY-SA, licence and author recorded per exercise, about 919 exercises), but its vocabulary is thin: no "machine" equipment and 15 muscles.
2. **Basic catalogue: build our own records, cross-checked against wger.** Names, aliases, muscles and equipment are facts we have to map to our own vocabularies anyway. Copy wger names and aliases only where they add coverage, and keep the licence and author on each record.
3. **Visuals, ranked:** (1) **our own animated figures**, drawn from keyframe JSON by a pure TypeScript rig and rendered in-app with `@shopify/react-native-skia` 2.6.2 (bundled with Expo SDK 57; adds about 6 MB on iOS). The same code renders PNG frames on Linux for automatic checks. (2) Paid RepDB Standard ($499 one-off) only if Ben wants speed over a consistent style. (3) wger/Everkinetic CC BY-SA line drawings: dated and inconsistent. (4) AI-generated video: last, because it gets form and equipment wrong and the clips don't match each other.
4. **Start with 10 guides that test the rig** (squat, RDL, bench, overhead press, one-arm DB row, lat pulldown front view, cable pushdown, leg press, Bulgarian split squat, sled push), then add about 110 more in priority batches. Estimate: 4–6 agent-days for tooling plus the first 10 guides, then about 30–45 minutes of agent time per guide. [Inference]
5. **Proposed brief changes (Ben to approve):** narrow brief §157 ("defer large exercise-media libraries"), add a design-system motion exception for guides, and extend the schema (`secondaryMuscles`, aliases, catalogue key, new equipment kinds, a `distance` measurement). Adding Skia and Reanimated needs an ADR.

## Recommendations

1. **Data sources:** do not use **free-exercise-db / wrkout exercises.json** (text taken from bodybuilding.com, §1.2), **ExerciseDB / exercisedb-api / hasaneyldrm / Kaggle "gym exercise" CSVs** (media ownership unclear or held by a commercial owner), or **Gymvisual resellers**. The `exercise-researcher` must never open them.
2. **Seed the basic catalogue** with our own normalised records (schema in §4). Use a one-off **wger snapshot** (public read API, no account) as a coverage checklist and a source of names and aliases. Copy only records whose licence is CC0, CC BY 4.0 or CC BY-SA 3.0/4.0, and store `licence`, `author` and `sourceId` in each record's `provenance`. Add an **About → Credits** line for wger (CC BY-SA). Don't import wger descriptions or images.
3. **RepDB free tier** (637 exercises, attribution, bespoke licence) is an optional second cross-check for *data only*, and only if Ben accepts its terms: no republishing, keep the repo private, and its images must never go into generative tools. Not needed for v1.
4. **Visual approach for v1:** our own **2D planar figure rig** (side view and front view), with keyframes in JSON, angle interpolation plus analytic 2-bone IK, and props (barbell, dumbbell, bench, cable, machine sled, floor sled). It is drawn with **Skia + Reanimated**, and the same pure TypeScript produces SVG/PNG on Linux via `@resvg/resvg-js` for contact sheets and automatic checks. Colours come only from existing tokens, never the accent.
5. **Accessibility and motion:** guides play only where Ben opens them (Exercise detail, or a guide sheet from the exercise `⋯` menu). They stop after 3 loops and always have Pause (WCAG 2.2.2). With Reduce Motion on, they show a static strip of key frames with captions. VoiceOver reads a text summary and the captions.
6. **Accuracy gate:** every guide passes `guide:check` (§5.6). The `exercise-researcher` cites its sources for cues, and **Ben approves each guide** before it shows as anything but `Draft`. Cues say how to do the movement. Safety notes say when to stop. Neither diagnoses (rule 9).
7. **Don't buy anything now.** If Ben later wants a faster, larger visual library, RepDB Standard ($499 one-off, animated WebP, about 513 animations) is the only paid option I found with a clear licence. It needs his explicit approval, and it doesn't cover HYROX stations.
8. **ADR needed** before any code: native dependencies (`@shopify/react-native-skia` 2.6.2, `react-native-reanimated` 4.5.1, `react-native-worklets` 0.10.1, versions as bundled with SDK 57) and the catalogue file format.

---

## 1. Exercise data sources

### 1.1 Comparison

| Source | Size | Fields | Licence (data / media) | Usable for us? |
|---|---|---|---|---|
| **wger** (wger.de API) | 919 exercises (`/api/v2/exerciseinfo` count), 3,386 name translations, 379 images, 78 videos [Doc] | category, primary `muscles`, `muscles_secondary`, `equipment`, translations with `aliases`, `variation_group`, per-record `license`, `license_author`, `author_history`, images with `is_ai_generated` [Doc] | Code AGPL-3.0+. Initial exercise data CC BY-SA 3.0, newer records CC BY-SA 4.0 (licence id 2). Images and videos carry a licence per file (e.g. CC BY-SA 3 by Everkinetic) [Doc] | **Yes**, with attribution and share-alike on the derived data file. Quality is uneven: user-contributed names such as "1 Leg Box Squat" and "3008 Abdominal Crunch", only 12 equipment kinds with **no machine kind**, and 15 muscles [Doc] |
| **RepDB free tier** (github.com/RepDB/exercise-dataset) | 637 exercises [Doc] | names, descriptions, instructions and tips (EN/DE/ES), category, force_type, mechanic, difficulty, equipment (e.g. `assisted_pullup_machine`, `dip_machine`), body_part, primary/secondary muscles, `is_unilateral`, `is_bodyweight`, MET, images [Doc] | Bespoke "free tier (attribution)" licence: personal and commercial in-app use allowed. Credit "Exercise data by RepDB (repdb.co)" required. **No republishing as a dataset, repo or API. No use of images as input to generative models.** Static 512 px flat WebP images (start and peak) [Doc] | **Possible, not needed.** Structure is good, but the licence is bespoke. Its claim of original images is the vendor's word. HYROX stations aren't shown [Doc / Inference] |
| **free-exercise-db** (yuhonas) | "800+" exercises, 2 JPGs each [Doc] | name, force, level, mechanic, equipment, primary/secondary muscles, instructions, category, images [Doc] | Labelled Unlicense (public domain), but derived from wrkout/exercises.json, which names no source [Doc] | **No.** The instructions match bodybuilding.com word for word (§1.2). Issue #13 ("images has copyright?") is still open with no maintainer reply [Doc] |
| **ExerciseDB / exercisedb-api** (AscendAPI; formerly RapidAPI) | claims 11,000+ exercises, 5,000+ GIFs [Doc] | name, equipments, bodyParts, target/secondary muscles, instructions, tips, variations, video and image URLs [Doc] | Repo is AGPL-3.0, but nothing covers who owns the media. Separate terms of use. Commercial GIF sets are sold on Gumroad for $300 [Doc] | **No.** Media ownership unclear. A developer on Reddit couldn't confirm where the GIFs came from [Reports] |
| **hasaneyldrm/exercises-dataset** | 1,324 exercises, GIFs [Doc, search listing] | muscles, equipment, instructions in 6 languages | Media marked "© Gym visual" [Doc, search listing] | **No** (commercial media) |
| **Kaggle "Gym Exercise Dataset" (CC0), Gigasheet sample** | ~2,500 rows, CSV [Doc, search listing] | name, description, muscles, equipment, ratings | Labelled CC0 by the uploader | **No.** The structure (ratings, "body only") looks like the same bodybuilding.com material [Inference, not verified] |
| **Everkinetic** (via wger, opentraining, Wikimedia Commons) | ~100–200 line drawings, start and end (count not verified) | images only | CC BY-SA 3.0 Unported, author Everkinetic, 2010 [Doc] | Images are usable with attribution and share-alike, but dated and visually inconsistent with our style |
| **Liftosaur** (open source) | ~200+ exercises | — | Repo AGPL-3.0. The repo says nothing about the licence of its exercise images or data [Doc] | **No** (unknown licence for the assets) |

### 1.2 Why free-exercise-db fails the provenance check

- Its README says it restructured wrkout/exercises.json by Ollie Jennings. That repo says it is "public domain" but names no source [Doc].
- Its record "Barbell Bench Press - Medium Grip" uses the same title and instruction wording ("From the starting position, breathe in and begin coming down slowly until the bar touches your middle chest… Tip: Ideally, lowering the weight should take about twice as long as raising it") as bodybuilding.com/exercises/barbell-bench-press-medium-grip [Doc, both checked 2026-10-09].
- Its "Barbell Squat" opens "This exercise is best performed inside a squat rack for safety purposes", the first bullet of bodybuilding.com's Barbell Full Squat page [Doc].
- **Conclusion [Inference, strong]:** the text, and very likely the paired start and end JPGs, come from a commercial site. A public-domain label from a third party doesn't give rights it didn't have. Treat it as scraped and don't use it, even for a private app, because the repo history would keep the copied material.

### 1.3 What the basic catalogue needs, and where it comes from

| Field (our schema) | wger has it? | Our approach |
|---|---|---|
| name | yes (uneven) | Author our own clean name. Keep the wger name as an alias where it differs |
| aliases | sometimes | Author them (RDL, BB bench, OHP, etc.). Add wger aliases only where the licence allows |
| movementPattern | **no** | Author from our fixed list (exercise-library §2.3) |
| primaryMuscles / secondaryMuscles | yes (15 muscles) | Map to our vocabulary (§4.3). Author the rest |
| compatibleEquipment | partly (no machines) | Author from our `EquipmentKind` (with the §4.4 additions) |
| defaultLoadConvention, measurement, laterality | **no** | Author (exercise-library §2.6 table) |
| instructions | yes (uneven, CC BY-SA) | **Don't import.** Rich entries get our own cues |

[Inference] wger adds little beyond a coverage checklist and some aliases. Facts such as "bench press, chest, barbell" aren't creative expression, but the EU has a database right, so we copy *records* only from correctly licensed sources and keep provenance. That is the conservative route.

## 2. User evidence on exercise demos

- Hevy markets "free high-quality videos" and says the library has 400+ exercises. Its help centre calls each demo a "demonstration animation" [Doc, via search snippets; the help-centre page returned 403 when fetched directly].
- A long-time user says the demos helped as a beginner who would otherwise be "googling every workout" [Reports, Substack].
- An r/Hevy post questions Hevy's chest-supported row demo (elbows wide, grip toward the feet) and asks why it differs from other videos [Reports]. **Implication [Inference]:** users treat demos as authoritative, so a wrong demo does harm. Our guides need sources and Ben's approval.
- Fitbod reviews praise its demo videos but call them "brief" and say they "don't go deep on form coaching" [Reports, Indie Hackers 2026 review; Garage Gym Reviews].
- Complaints are more often about **library coverage** (missing variants) than demo quality [Reports, AI-generated feedback summary of unknown sample size; weak]. This supports the coordinator's split: a big basic catalogue and a small set of rich entries.
- No reliable evidence turned up on AI-generated exercise images in apps. ASICS (2023) reported that AI fitness imagery shows unrealistic bodies [Reports].

## 3. Visual options, ranked

| Rank | Option | Licence | Consistency and style | Accuracy | Offline / size | Effort / cost |
|---|---|---|---|---|---|---|
| **1** | **Our own parametric 2D figure** (keyframe JSON → pure TS rig → Skia in-app; resvg on Linux) | Ours. No third-party rights [Inference] | One rig and palette for every guide. Uses our tokens, no accent. Clean silhouettes suit the dark, calm style [Inference] | Checked by code (§5.6) and approved by Ben. Limited to clear side or front views; no 3D rotation in v1 | ~2–6 KB JSON per guide, so 150 guides ≈ ≤1 MB. Skia adds ~6 MB to the iOS app [Doc: Shopify estimate] | Tooling 3–5 agent-days, then ~30–45 min per guide [Inference]. Free |
| 2 | **Paid RepDB Standard** | One-off commercial licence; no redistribution of raw files [Doc] | One consistent character, 960 px transparent animated WebP [Doc]; not our style | Vendor says illustrated by them; unverified | Animated WebP probably 0.2–1 MB each, so 30–150 MB [Inference; not measured] | **$499** one-off (female character +$99) [Doc]. Needs Ben's approval. No HYROX stations shown |
| 3 | **Open images** (wger/Everkinetic CC BY-SA, RepDB free static) | CC BY-SA 3.0/4.0 per file (share-alike if we adapt them) / RepDB bespoke [Doc] | Mixed authors and styles. Everkinetic line drawings date from 2010; wger has only 379 images for 919 exercises [Doc] | Generally fine, unchecked | Small PNGs | Low effort, but patchy coverage and an inconsistent look |
| 4 | Other paid libraries (WorkoutLabs, Gymvisual, Muscle & Motion, ExerciseDB Gumroad) | WorkoutLabs: $15–25 per illustration, or $1,200/yr / $3,500+ perpetual for 679 exercises, animations extra [Doc]. Gymvisual: $0.90 per GIF after 10 items, licence page not checked [Doc]. Muscle & Motion: quote only [Doc]. ExerciseDB: $300, provenance doubts [Doc / Reports] | Each has its own house style | Varies | GIF/MP4 sizes are large | Money plus licence checks. Resellers of Gymvisual GIFs have reportedly drawn legal notices [Reports, single unverified Reddit post] |
| 5 | **AI-generated images or video** | US Copyright Office (29 Jan 2025): prompt-only outputs generally aren't copyrightable [Doc via law-firm summaries]. Use is set by each tool's terms, which need an account we may not create | Poor consistency across 100+ clips (character, camera, lighting) [Inference] | Known problems with hands, bar paths and equipment; can't be checked by code [Inference] | Video is MBs per clip | Paid accounts plus heavy manual curation. **Not recommended** |

Rive and Lottie: both render well (Skia can play Lottie through Skottie [Doc]; `lottie-react-native` ~7.3.8 is bundled with SDK 57 [Doc]). But they are authored in GUI editors (After Effects, Rive), which agents on Linux can't use. Our own JSON could be exported to Lottie later if that's ever useful. [Inference]

## 4. Catalogue schema (for `exercise-researcher`)

### 4.1 Files

```
packages/catalogue/
  data/exercises/<id>.json          one file per exercise (basic or rich)
  data/vocab/muscles.json           fixed muscle list → filter group
  data/vocab/movement-patterns.json fixed list (exercise-library §2.3)
  data/vocab/equipment-kinds.json   mirrors packages/schemas EquipmentKind
  data/sources/wger-2026-10-09.json raw snapshot used for seeding (provenance only)
  CREDITS.md                        wger (CC BY-SA) credit text shown in About
  guides/<id>/...                   see §5
  scripts/                          import-wger, validate-catalogue, guide-render, guide-check
```

`<id>` is a stable kebab-case **key** (`barbell-back-squat`). `ExerciseSchema.id` must be a UUID, so the app derives it as **UUIDv5(key, FIZZ_CATALOGUE_NAMESPACE)**. The UUID is deterministic and never changes for a key [Inference: a design choice for the developer to confirm in the ADR]. Keys are never reused or renamed. A renamed exercise keeps its key and gains an alias.

### 4.2 Entry format

Basic tier (all ~250–400 entries):

```json
{
  "schemaVersion": 1,
  "key": "barbell-back-squat",
  "tier": "basic",
  "name": "Back squat",
  "aliases": ["Barbell squat", "BB squat", "High-bar squat"],
  "family": "squat",
  "movementPattern": "squat",
  "mechanic": "compound",
  "primaryMuscles": ["quads", "glutes"],
  "secondaryMuscles": ["adductors", "hamstrings", "spinal_erectors", "core"],
  "compatibleEquipment": ["barbell"],
  "requiresStation": ["rack"],
  "defaultLoadConvention": "total",
  "measurement": "reps",
  "laterality": "bilateral",
  "defaultRestS": 180,
  "provenance": {
    "source": "fizz",
    "crossCheckedWith": [{ "source": "wger", "sourceId": "uuid…", "licence": "CC-BY-SA-4.0", "author": "…" }],
    "copiedFields": [],
    "retrievedOn": "2026-10-09"
  }
}
```

- `copiedFields` lists any field text taken from a licensed source (e.g. `["aliases[1]"]`). If it is non-empty, the source's licence and author must be present and CREDITS.md must cover them.
- `family` groups variants (`squat`, `bench_press`, `row`, `sled`) for substitutions and guide templates.
- `requiresStation` (optional): `rack`, `bench`, `incline_bench`, `pullup_bar`, `dip_station`, `cable_column`, `specific_machine`, `sled_track`, `wall_target`. It is used by `getCompatibleExercises` [Inference].

Rich tier adds:

```json
{
  "tier": "rich",
  "cues": {
    "setup":     ["Bar on upper back, not neck", "Feet about shoulder width"],
    "execution": ["Brace, then sit down between your hips", "Knees track over toes", "Drive up through the whole foot"],
    "faults":    ["Heels lifting", "Chest collapsing at the bottom"]
  },
  "safety": {
    "notes":  ["Set safety arms just below your lowest depth"],
    "stopIf": ["Sharp or pinching pain", "Pain that changes how you move"]
  },
  "guideBrief": {
    "view": "side",
    "keyPositions": [
      { "label": "Start",  "describe": "Standing tall, knees and hips extended, bar over mid-foot" },
      { "label": "Bottom", "describe": "Hip crease just below knee; shins and torso roughly parallel; heels down" }
    ],
    "barPath": "vertical over mid-foot, drift ≤ 3% of height",
    "tempo": { "downMs": 1400, "holdMs": 200, "upMs": 1000 },
    "props": ["barbell_loaded", "rack_optional"],
    "emphasise": ["mid-foot balance"],
    "doNotShow": ["extreme depth", "bounce", "spotter"]
  },
  "sources": [{ "url": "https://…", "checkedOn": "2026-10-09", "supports": "cues.execution[1]" }],
  "review": { "status": "draft", "benApprovedOn": null }
}
```

Copy rules (match the design system): cues are imperative, at most 60 characters, 2–4 per group, in plain words. `safety.stopIf` never names a condition or diagnoses (rule 9). `review.status` is one of `draft | checked | approved`. The app labels anything below `approved` as `Draft guide`.

### 4.3 Vocabularies

- **Movement pattern** (exercise-library §2.3): `horizontal_push, vertical_push, horizontal_pull, vertical_pull, squat, hinge, lunge, carry, core, arms, calves, conditioning`.
- **Muscles** (each maps to one of the 11 filter groups in §2.3): `chest, upper_chest→Chest; lats, upper_back, traps, spinal_erectors→Back; front_delts, side_delts, rear_delts→Shoulders; biceps, brachialis→Biceps; triceps→Triceps; quads→Quads; hamstrings→Hamstrings; glutes, adductors, abductors→Glutes; calves→Calves; abs, obliques, core→Core; forearms, grip→Forearms`. Fix this list before seeding. It is small enough that `Muscle` filter chips stay readable [Inference].

### 4.4 Schema gaps in `packages/schemas/src/exercise.ts` (developer and ADR)

| Gap | Proposal |
|---|---|
| No `secondaryMuscles` | `secondaryMuscles: string[]` (max 20), same vocabulary |
| Aliases | Keep the brief §6 `ExerciseAlias` entity; the catalogue loader writes `aliases[]` into it with `source: 'catalogue'` |
| No stable key | `catalogueKey: string \| null` (null for custom), plus `family`, `mechanic` |
| `EquipmentKind` lacks HYROX and conditioning kit | Add `kettlebell`, `sled`, `erg` (ski, row, bike), `medicine_ball`, `sandbag`, `band`. Decide whether Smith machine, EZ bar and trap bar are `barbell` instances with their own bar weight (gym-editor) or separate kinds |
| `Measurement` lacks distance | Add `distance` (sled 50 m, farmer's carry 200 m, ski/row 1000 m), and possibly `calories` for bikes. Check against concurrent-training C7 and the sled `added` convention (EL7) |
| Rich content | `ExerciseGuideRef { status, guideVersion, view }`, plus cues and safety stored as catalogue content (Coaching knowledge domain, design-system §7.2), not in `Exercise` rows |

## 5. Visual guide system (for `exercise-guide-maker`)

### 5.1 Approach

- A **2D planar rig** in two projections: `side` (sagittal: squats, hinges, presses, rows, lunges, sled) and `front` (frontal: pulldowns, pull-ups, lateral raises, flyes).
- Each guide uses one view. There is no 3D in v1 [Inference: much simpler to author and check; enough for the first 10 and most of the 120].
- Segments are rounded capsules: head (circle), neck, thorax, pelvis, and upper arm, forearm, hand, thigh, shank and foot × near/far.
- Segment lengths are fractions of standing height H, taken from standard anthropometric tables (Drillis & Contini, as reproduced in Winter's *Biomechanics and Motor Control of Human Movement*). The developer must check the exact ratios against Winter; I couldn't fetch the table today [Inference].
- Lengths are fixed: animation interpolates **joint angles**, so limbs never stretch.
- Keyframes give root position and joint angles, optionally with **IK targets** (hands on a bar point, feet planted). An analytic 2-bone IK solves the arm or leg, so bar paths and foot contacts are exact.

### 5.2 Files per guide

```
packages/catalogue/guides/<id>/
  guide.json        authored (the only file the app ships)
  preview.png       generated contact sheet of key frames, committed for review (not shipped)
  check.json        generated by guide:check (gitignored, or a CI artefact)
packages/catalogue/guides/_rig/adult-v1.json       segment lengths, widths, joint limits
packages/catalogue/guides/_templates/<family>.json reusable guides with parameters (bench angle, grip, implement)
```

### 5.3 `guide.json` format (v1)

```json
{
  "schemaVersion": 1,
  "exerciseKey": "barbell-back-squat",
  "extends": null,
  "rig": "adult-v1",
  "view": "side",
  "facing": "right",
  "units": "bodyHeight",
  "durationMs": 3000,
  "loop": "cycle",
  "ground": { "y": 0, "scrollPerCycle": 0 },
  "props": [
    { "id": "bar", "type": "barbell", "plates": "large", "attach": { "segment": "thorax", "at": 0.9 } }
  ],
  "keyframes": [
    { "t": 0.00, "label": "Start", "caption": "Stand tall, brace",
      "root": { "x": 0, "y": 0.53, "pelvisDeg": 5 },
      "joints": { "lumbar": 0, "thoracic": 0, "neck": 0,
                  "shoulderNear": -150, "elbowNear": 110, "shoulderFar": -150, "elbowFar": 110 },
      "ik": { "footNear": { "x": 0.02, "y": 0, "planted": true },
              "footFar":  { "x": -0.02, "y": 0, "planted": true } },
      "ease": "inOutSine" },
    { "t": 0.47, "label": "Bottom", "caption": "Hips just below knees, heels down",
      "root": { "x": -0.08, "y": 0.31, "pelvisDeg": 35 },
      "joints": { "lumbar": 5, "thoracic": 0, "neck": -10 },
      "ik": { "footNear": { "planted": true }, "footFar": { "planted": true } },
      "holdMs": 200, "ease": "inOutSine" },
    { "t": 1.00, "label": "Start", "sameAs": 0 }
  ],
  "overlays": [{ "type": "path", "of": "bar", "showIn": ["static"] }],
  "checks": { "barDriftMax": 0.03, "planted": ["footNear", "footFar"], "romProfile": "adult-default" },
  "a11y": { "summary": "Side view. Bar on upper back. Squat down until hips are just below knees, then stand up." },
  "review": { "status": "draft", "renderedWith": "fizz-figure@0.1.0" }
}
```

- Coordinates: origin on the floor midway between the feet, y up, `units: bodyHeight` (H = 1.0).
- Angles are in degrees, flexion positive, relative to the parent segment.
- `t` is normalised 0–1. `sameAs` closes the loop exactly.
- `loop: "cycle" | "pingpong"`. `ground.scrollPerCycle` makes the floor scroll for locomotion (sled push, walking lunge) while the figure stays centred.
- Props: `barbell`, `dumbbell`, `kettlebell`, `bench` (angle), `cable` (anchor point → hand), `machine_sled` (leg press: carriage on a rail), `floor_sled`, `pulldown_bar`, `wall_target`, `erg`. Each is drawn as simple flat shapes.

### 5.4 Shared code

- `packages/catalogue/src/figure/` holds pure, unit-tested TypeScript with no React or native imports: `loadGuide`, `poseAt(guide, tNorm) → Pose` (joint positions plus props), `solveTwoBoneIk`, `renderSvg(pose, style) → string`.
- The app (`apps/mobile`) has `ExerciseGuide`, a Skia `Canvas`. It precomputes a pose per frame at 30 fps on mount (90 frames for 3 s; tiny), then a Reanimated shared value steps the frame. Skia `Path`s are built from the pose in `useDerivedValue` [Inference: avoids running the full rig maths on the UI thread]. Fallback if the ADR rejects Skia: `react-native-svg` 15.15.4 (also bundled) with a 30 fps JS-driven frame index.
- Versions are those bundled with SDK 57: `@shopify/react-native-skia` 2.6.2 (MIT; peers react ≥19, react-native ≥0.78, reanimated ≥3.19.1), `react-native-reanimated` 4.5.1, `react-native-worklets` 0.10.1 [Doc]. All are native modules, so they need a new GitHub Actions `.ipa` build and stay free-provisionable (no entitlements) [Inference].

### 5.5 Style (design-system tokens, no new colours, never `accent`)

| Element | Token |
|---|---|
| Canvas | `bg.surface` (or `bg.raised` inside cards), square, `radius.md` |
| Near-side body | `text.secondary` (#A9B4C2 dark / #4A5666 light) |
| Far-side limbs (drawn behind) | `border.control` (≥3:1 non-text contrast on surface [Doc: design-system contrast table]) |
| Implement (bar, dumbbell, sled) | `text.primary` |
| Static bar-path trace, floor line | `text.tertiary`, dashed |
| Captions | `type.callout`, numbered `1 Start · 2 Bottom` |

Working muscles are *not* colour-highlighted in v1. The muscle list in text carries that meaning (principle 3, one accent).

### 5.6 Linux tooling and checks (`exercise-guide-maker` runs these)

- `pnpm --filter @fizz/catalogue guide:render <id>` uses the same `renderSvg` to write SVG frames. `@resvg/resvg-js` (MPL-2.0, prebuilt Linux x64 binary, no browser) turns them into PNGs and a `preview.png` contact sheet of the labelled key frames plus 6 in-between frames [Doc for resvg-js]. Optional: `ffmpeg` or `gifski` for a local review GIF, never shipped.
- `guide:check <id>|--all` fails the build when:
  1. `guide.json` fails the zod schema.
  2. A joint goes outside the `romProfile` limits (no knee or elbow hyperextension, etc.).
  3. A planted foot moves more than 0.005 H.
  4. The bar path drifts more than `barDriftMax`.
  5. Any segment goes through the floor or bench.
  6. The hand loses contact with the implement.
  7. The loop is discontinuous (first pose ≠ last pose).
  8. `durationMs` is outside 2–6 s.
  9. The file is over 8 KB.
  10. `a11y.summary` or any keyframe caption is missing.
  11. The rich entry's `guideBrief.keyPositions` labels don't match the guide's keyframe labels.
- Snapshot tests: key-frame PNG hashes in CI catch accidental rig changes.
- **Human gate:** Ben views `preview.png` (or the in-app `Draft guide`) and approves it. `review.status: approved` is set only from Ben's message, relayed by the PM.

### 5.7 Motion and accessibility rules

- Guides appear only in Exercise detail (`Guide` section) and in a `How to` sheet from the active-workout exercise `⋯`. They never appear in rows, pickers or the Log card.
- Autoplay stops after 3 cycles, then holds on the first key frame with `Replay`. `Pause` is always visible (WCAG 2.2.2 requires pause for auto-moving content longer than 5 s [Doc]).
- With Reduce Motion on (`AccessibilityInfo.isReduceMotionEnabled` / `reduceMotionChanged` [Doc]), there is no autoplay. Ben sees a static strip of the key frames with captions and an optional `Play` button.
- VoiceOver gets `a11y.summary`, then the captions as a list. The canvas itself is one image element.
- Offline: everything is bundled. No network fetch, ever.

## 6. The first 10 rich examples (chosen to test the rig)

| # | Exercise (key) | View | What it proves |
|---|---|---|---|
| 1 | Back squat (`barbell-back-squat`) | side | Planted-foot IK, hip/knee coordination, vertical bar path over mid-foot |
| 2 | Romanian deadlift (`barbell-romanian-deadlift`) | side | Hinge with near-straight knees; bar stays against the thighs; spine angle held |
| 3 | Bench press (`barbell-bench-press`) | side | Lying pose on a bench prop; shoulder–elbow path; bar touch point |
| 4 | Overhead press (`barbell-overhead-press`) | side | Bar path around the head; head-back-then-through motion; lockout |
| 5 | One-arm dumbbell row (`dumbbell-one-arm-row`) | side | Unilateral; hand and knee supported on a bench; near versus far limb drawing |
| 6 | Lat pulldown (`cable-lat-pulldown`) | **front** | Front rig; seated machine; cable plus bar prop |
| 7 | Cable triceps pushdown (`cable-triceps-pushdown`) | side | Cable line attached to the hand; elbow pinned while the forearm moves |
| 8 | Leg press (`machine-leg-press`) | side | Plate-loaded machine carriage on a rail; inclined seat; feet fixed to the moving plate |
| 9 | Bulgarian split squat (`dumbbell-bulgarian-split-squat`) | side | Split stance; rear foot on a bench; dumbbells hang from the hands |
| 10 | Sled push (`sled-push`) | side | Locomotion with a scrolling floor; leaning stride; floor-sled prop (HYROX) |

If all 10 pass `guide:check` and Ben approves 8 or more without a rig change, the approach is proven. If 3 or more need rig changes, revisit (e.g. a 3D rig). [Inference: a suggested exit criterion]

## 7. Rich-tier expansion list (~120; **top 40 marked ★**, the 10 examples marked ①)

**Barbell (20):**
- ① Back squat ★, ① Romanian deadlift ★, Deadlift (conventional) ★, ① Bench press ★, ① Overhead press ★
- Front squat ★, Incline bench press ★, Bent-over row ★, Hip thrust ★, Trap-bar deadlift ★
- Close-grip bench press, Sumo deadlift, Pendlay row, Push press, Good morning
- Barbell curl, EZ-bar curl, EZ-bar skull crusher, Box squat, Landmine press

**Dumbbell (22):**
- ① One-arm dumbbell row ★, ① Bulgarian split squat ★, DB bench press ★, Incline DB press ★, DB shoulder press ★
- DB lateral raise ★, DB curl ★, Hammer curl ★, Goblet squat ★, DB walking lunge ★, DB Romanian deadlift ★
- Chest-supported DB row, DB step-up, DB fly, DB rear-delt fly, Incline DB curl
- DB overhead triceps extension, Arnold press, DB reverse lunge, Single-leg DB RDL, DB shrug, DB pullover

**Cable (15):**
- ① Lat pulldown ★, ① Triceps pushdown ★, Seated cable row ★, Face pull ★, Cable fly ★
- Cable lateral raise, Cable curl, Overhead cable triceps extension, Straight-arm pulldown, Cable crunch
- Pallof press, Cable woodchop, Single-arm cable row, Cable pull-through, Cable glute kickback

**Machine (17):**
- ① Leg press ★, Leg extension ★, Seated leg curl ★, Chest press machine ★, Hack squat ★, Assisted pull-up ★
- Lying leg curl, Shoulder press machine, Pec deck, Reverse pec deck, Chest-supported machine row
- Smith machine squat, Standing calf raise, Seated calf raise, Hip abduction, Hip adduction, Assisted dip

**Bodyweight (15):**
- Pull-up ★, Chin-up ★, Push-up ★, Dip ★, Plank ★, Hanging knee raise ★
- Inverted row, Side plank, Hanging leg raise, Ab-wheel rollout, Dead bug, Glute bridge
- 45° back extension, Nordic curl, Copenhagen plank

**Kettlebell (8):**
- Kettlebell swing ★
- KB goblet squat (shares the goblet template), KB deadlift, KB clean, KB press, KB snatch, Turkish get-up, KB front-rack carry

**HYROX / conditioning (14):**
- ① Sled push ★, Sled pull ★, SkiErg ★, Rowing erg ★, Wall ball ★, Burpee broad jump ★, Farmer's carry ★, Sandbag lunge ★
- Air/assault bike, Box jump, Burpee, Battle ropes, Bear crawl, Treadmill run (logging only, no guide needed)

Total: 111, plus about 10 variants Ben names → ~120. The ★ count is 41; drop one when the first batch is planned. The ★ items follow Ben's likely programmes (5/3/1 or upper/lower plus HYROX, programmes.md) [Inference]. *(Note 2026-10-09: HYROX is no longer a special case in the approved playbook. Rank guide priority by Ben's actual routines and stated goal and other training, not by HYROX. The conditioning exercises stay in the catalogue as ordinary exercises.)*

Batches: examples (10) → remaining ★ (31) → the rest by Ben's actual usage after the FitNotes import. Templates cut effort: incline DB press is the bench template with `bench.angleDeg: 30` and a dumbbell implement. About 35 templates cover the ~120 guides [Inference].

## 8. Basic catalogue coverage plan (~300 entries)

| Category | Target | Built as |
|---|---|---|
| Barbell (incl. EZ, trap bar, Smith) | 60 | families × stance, grip, bench angle |
| Dumbbell | 60 | as above, plus unilateral variants |
| Cable | 40 | attachment × angle |
| Machine (stack and plate-loaded) | 50 | common commercial machines by generic name only (no brand names) |
| Bodyweight and assisted | 35 | progressions (e.g. push-up → deficit push-up) |
| Kettlebell | 20 | — |
| HYROX / conditioning / carries | 25 | stations at race standards, ergs, carries, plyometrics |
| **Total** | **~290** | room up to 400 as Ben's FitNotes names reveal gaps |

The FitNotes import (build step 3) will surface Ben's own exercise names. Map them as aliases rather than creating near-duplicates.

## 9. Effort estimate [Inference]

| Work | Who | Estimate |
|---|---|---|
| ADR (Skia/Reanimated, catalogue format), schema changes §4.4, zod schemas for entry and guide | developer | 1 day |
| `figure` lib (rig, FK, IK, interpolation, SVG), render and check scripts, CI | developer | 2–3 days |
| `ExerciseGuide` Skia component plus Reduce Motion and VoiceOver; device test | developer | 1–2 days, plus a real-iPhone check |
| Basic catalogue ~290 entries (wger snapshot, normalise, author missing) | exercise-researcher | ~1–2 days in 3 batches; Ben skims the list (~1 h) |
| 10 rich entries (cues, safety, guide brief, sources) | exercise-researcher | ~0.5 day |
| 10 guides including iteration | exercise-guide-maker | ~1–2 days |
| Each further guide (template reuse) | exercise-guide-maker | 30–45 min, plus ~2 min of Ben's review |

## 10. Unknowns needing a real test

1. Skia plus Reanimated in our GitHub Actions `.ipa` build: build time and the actual size added (Shopify says ~6 MB; measure it).
2. Frame smoothness and battery with a guide open during rest on Ben's iPhone, especially with Live Activity and audio running.
3. Whether side and front 2D views read clearly at 240 pt in gym lighting, and whether Ben finds silhouettes "premium" enough. Show him `preview.png` for examples 1, 6 and 10 first.
4. Whether wger's per-record licence fields are complete for the records we'd copy. Spot-check 20.
5. Exact anthropometric ratios (verify against Winter's table) and whether a single body type is acceptable to Ben.

## Proposed brief changes

These need Ben's approval. Record them in `docs/brief/CHANGELOG.md`, plus an ADR for the stack.

1. **Brief §157 "Defer … large exercise-media libraries"** → "Defer third-party, filmed and AI-generated exercise media. In scope: original, code-rendered animated guides for a curated subset (start 10, grow to ~100–150), shown only where opened, with a static Reduce Motion version." (Ben has already overridden EL8; this brings the brief in line.)
2. **exercise-library.md EL8** → replace it with "Rich catalogue entries show an original animated guide and cues; basic entries show none" (designer to add a `Guide` section to §2.4 and a `How to` item to the active-workout `⋯`).
3. **design-system principle 5 ("Motion stays quiet… at most 200 ms")**: add an explicit exception for `ExerciseGuide` (user-opened, at most 3 autoplay loops, Pause, static under Reduce Motion), plus the figure colour aliases in §5.5. No new colour values.
4. **Brief §6 `Exercise` / schemas:** add `secondaryMuscles`, `catalogueKey`, `family`, `mechanic`; extend `EquipmentKind` (kettlebell, sled, erg, medicine ball, sandbag, band); add a `distance` measurement. Developer ADR.
5. **Stack (CLAUDE.md "Stack" and ADR):** add `@shopify/react-native-skia` 2.6.2, `react-native-reanimated` 4.5.1 and `react-native-worklets` 0.10.1. Note that CLAUDE.md lists `packages/catalogue` but not its `data/` and `guides/` folders or Linux render tooling (`@resvg/resvg-js`, dev-only).
6. **New requirement:** an About → Credits screen with the wger CC BY-SA attribution (and RepDB's, if it is ever used). Keep the repo **private** (already the case per ADR 0004) if any bespoke-licence data is added.

## Sources (all checked 2026-10-09)

- free-exercise-db: https://github.com/yuhonas/free-exercise-db ; issue #13 https://github.com/yuhonas/free-exercise-db/issues/13 ; data https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json
- wrkout exercises.json: https://github.com/wrkout/exercises.json
- bodybuilding.com matching pages: https://bodybuilding.com/exercises/barbell-bench-press-medium-grip ; https://bodybuilding.com/fun/Barbell+Full+Squat
- wger docs (licences): https://wger.readthedocs.io/en/latest/ ; API: https://wger.de/api/v2/license/?format=json , https://wger.de/api/v2/exerciseinfo/?format=json&limit=1 , https://wger.de/api/v2/exerciseimage/?format=json&limit=3 , https://wger.de/api/v2/video/?format=json&limit=2 , https://wger.de/api/v2/equipment/?format=json , https://wger.de/api/v2/muscle/?format=json , https://wger.de/api/v2/exercise-translation/?format=json&language=2&limit=1
- CC BY-SA 4.0 deed: https://creativecommons.org/licenses/by-sa/4.0/deed.en
- RepDB: https://github.com/RepDB/exercise-dataset ; https://raw.githubusercontent.com/RepDB/exercise-dataset/main/LICENSE-DATA.md ; https://repdb.co/
- ExerciseDB: https://github.com/ExerciseDB/exercisedb-api ; https://oss.exercisedb.dev/ ; https://exercisedb.gumroad.com/l/exercisedb
- hasaneyldrm dataset: https://github.com/hasaneyldrm/exercises-dataset
- Kaggle gym dataset: https://www.kaggle.com/datasets/niharika41298/gym-exercise-data
- Everkinetic: https://github.com/everkinetic/data ; https://github.com/chaosbastler/opentraining-exercises ; https://commons.wikimedia.org/wiki/File:Biceps-curl-1.gif
- Liftosaur: https://github.com/astashov/liftosaur
- Reddit GIF-licensing thread (snapshot): https://reddit.sentinel-team.org/posts/1tnjhg2/snapshots/2026-05-25T20%3A18%3A25.2497Z
- WorkoutLabs licensing: https://workoutlabs.com/exercise-illustrations-licensing/ ; Gymvisual: http://gymvisual.com/ ; Muscle & Motion: https://www.muscleandmotion.com/?p=24035
- Hevy: https://apps.apple.com/il/app/id1458862350 ; https://help.hevyapp.com/hc/en-us/articles/35688251991575 (403 when fetched; via search snippet) ; https://jonathanroseland.substack.com/p/this-workout-app-is-a-gamechanger ; https://redlib.groet-infra.nl/r/Hevy/new ; https://www.onclarity.com/leaderboard/insight/hevy
- Fitbod reviews: https://www.indiehackers.com/post/fitbod-app-review-2026-honest-take-after-real-testing-45d5f07a1b ; https://www.garagegymreviews.com/equipment/fitbod
- ASICS AI imagery: https://news-emea.asics.com/archive/asics-calls-out-ai-for--exercise-airbrushing--and-offers-ai-training-programme-to-teach-ai-the-trans/s/e94ca12a-9d3d-4112-af80-24e65f5633ac
- US Copyright Office AI report Part 2 (summaries): https://www.hoganlovells.com/en/publications/us-copyright-office-issues-report-on-copyrightability-of-ai-assisted-and-generated-works ; https://content.govdelivery.com/accounts/USLOCCOPYRIGHT/bulletins/3ceae5f
- Expo SDK 57 bundled versions: https://raw.githubusercontent.com/expo/expo/sdk-57/packages/expo/bundledNativeModules.json ; Skia in Expo: https://docs.expo.dev/versions/latest/sdk/skia/ ; Lottie in Expo: https://docs.expo.dev/versions/latest/sdk/lottie
- Skia peer dependencies: https://registry.npmjs.org/@shopify/react-native-skia/2.6.2 ; size estimate (Shopify installation docs, via mirror): https://mintlify.com/shopify/react-native-skia/getting-started/installation ; Skottie: https://docs.skia.org/docs/user/modules/skottie/
- resvg-js: https://github.com/thx/resvg-js
- React Native AccessibilityInfo: https://reactnative.dev/docs/accessibilityinfo ; WCAG 2.2.2: https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html
- Anthropometrics (not verified today): https://nbviewer.org/github/demotu/BMC/blob/master/notebooks/BodySegmentParameters.ipynb
