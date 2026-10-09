# 0011: Exercise catalogue format, animated-guide format and Linux guide tooling

**Status:** Proposed, 2026-10-09 (developer; for review). In-app guide playback is **not** decided here (see "Later slice").

## Context
`docs/research/exercise-bank-and-visuals.md` recommends our own catalogue records (§4) and original code-drawn figure guides (§5), with 10 rich examples written in `docs/catalogue/batches/batch-01.md`. Those entries used fields that `packages/schemas` didn't have yet. No validator, loader or guide tooling existed. The catalogue is **Coaching knowledge** (CLAUDE.md rule 10): general content that never says anything about Ben.

## Decision

### Catalogue (`packages/catalogue`)
- **One JSON file per exercise** in `data/exercises/<key>.json`, validated by a strict zod schema (`src/entry-schema.ts`; unknown fields are errors). There are two tiers, `basic` and `rich`. The rich tier includes batch-01's optional additions: `variations` (`key` may be `null`), `uncertain[]`, `sources[].title/note`, `guideBrief.cameraNote`, `keyPositions[].approxAnglesDeg` and `ikHints`. `guideBrief.tempo` is a union of rep tempo `{downMs, holdMs, upMs}` and stride tempo `{stepMs, stepsPerCycle}`.
- **Fixed vocabularies live in TypeScript** (`src/vocab.ts`): muscles mapped to the 11 filter groups, movement patterns, stations and licences. This replaces the research's `data/vocab/*.json`, so there is one typed source instead of a JSON copy to keep in sync.
- **Validation** (`npm run catalogue:validate`, part of `npm run check`): fails on schema errors, a key that doesn't match its file name, duplicate keys, an entry that lists itself as a variation, copied fields without a licensed source, and a muscle listed as both primary and secondary. It **warns** (without failing) on dangling variation keys (55 today, all listed in batch-01 as "not yet written"), a load convention that's unusual for the equipment, and a name or alias shared by two entries.
- **IDs**: `Exercise.id = UUIDv5(key, FIZZ_CATALOGUE_NAMESPACE)`, with namespace `b8068a51-2a26-44d1-811c-44ad2dc3c8ce`, which is fixed forever. The SHA-1 is pure TypeScript (Hermes has no `node:crypto`) and is tested against `node:crypto` and Python's `uuid5`. Keys are never reused or renamed; a rename keeps the key and gains an alias.
- **Loader**: `bundledCatalogue()` reads a generated static-import list (`src/generated/exercise-files.ts`, written by `npm run catalogue:index`; the validator fails when it's stale), so Metro bundles every entry. Entries are re-validated at load time. A bad entry is skipped and reported, and never crashes launch. `toExerciseRow(entry, at)` builds the `Exercise` row. **Seeding these rows into SQLite and into a Coaching-knowledge namespace is app work and not done here** (ADR 0009 notes the shared `exercises` table).

### Additive schema changes (`packages/schemas`)
- `Exercise` gains optional `secondaryMuscles`, `catalogueKey` (nullable), `family` and `mechanic`. Old rows still validate and no SQL migration is needed (JSON documents).
- `EquipmentKindSchema` (the kinds an exercise can use) gains `kettlebell`, `sled`, `erg`, `medicine_ball`, `sandbag` and `band`. **No gym-profile instance schema exists for them.** An exercise that only uses them is logged without equipment feasibility (no snapping and no max) until an equipment slice adds instances. The Smith machine, EZ bar and trap bar are still undecided (research §4.4).
- **`distance` is deliberately not added to `MeasurementSchema`.** It lives in a separate `CatalogueMeasurementSchema`. Sets can't record a distance yet: `SetValues` has no distance field, the reducer would accept a set with neither reps nor duration, and progression has no rule for it. A distance exercise (`sled-push`) therefore has **no loggable `Exercise` row**: `toExerciseRow` returns `distance_not_loggable`. The two enums merge once distance logging is built. This differs from research §4.4 and is flagged for the PM.

### Guide format v1 (`guides/<key>/guide.json`, `src/figure/guide-schema.ts`)
This is research §5.3, with these additions and changes found while building:
- `projection` (`armNear/Far`, `forearmNear/Far`, `legNear/Far`, 0.2–1) shortens limbs that point partly at the camera. A back-squat grip is the case that needs it: seen from the side, the forearm is foreshortened more than the upper arm, and without that the elbow can't sit behind the bar. The projected angle of a shortened limb has no meaningful sign, so ROM checks it as a fold magnitude (`outOfPlane`).
- Ease `smooth`: a monotone cubic through neighbouring keyframes (continuous velocity, no overshoot, zero velocity at holds and turning points). The per-segment sine eases jolt at mid-movement keyframes such as `Halfway`.
- Foot IK has `planted`, `pivot` (`ankle` or `ball`), `soleDeg` and `prop` (a leg-press plate). A planted foot with no new `x` rides a scrolling floor, so the sled push can be checked in the ground frame. Toes bend at the ball of the foot. Hand IK has `prop` and `bend`. Front-view bars take `gripHalfWidth`.
- Prop anchors are `fixed`, `keyframed`, a trunk `segment`, or a `hand`. Props: `barbell`, `dumbbell`, `bench` (with incline), `cable_stack` (the stack lifts as the cable lengthens), `leg_press` and `push_sled`.
- The rig `adult-v1` is TypeScript (`src/figure/rig.ts`), not `_rig/adult-v1.json`, because the app needs it as code. Templates (`extends`) are deferred, and only `null` is accepted.
- `meta.json` is written by `guide:check` (exercise, format, rig, frames, size, attribution, review and check status). It isn't shipped. `npm run check` runs `guide:check --all --verify`, which fails on a stale meta.json.

### Tooling (dev-only, runs on Linux)
- Everything in `src/figure` is pure TypeScript: interpolation, two-bone IK, pose, props, SVG strings and checks. There are no React or native imports, so the same code can feed the app later.
- Scripts run on Node 22's built-in type stripping, plus a 30-line resolve hook (`scripts/ts-hooks.ts`) for extensionless imports and JSON. This adds no `tsx` or bundler dependency.
- `@resvg/resvg-js` **2.6.2** (MPL-2.0, prebuilt binaries, no browser) is a pinned devDependency of `@fizz/catalogue`. It is never bundled into the app.
- `npm run guide:render <id>` writes `preview.png`: key frames plus 6 in-betweens, in Direction D dark and light, with labels under the frames (never inside them). It is committed for review, about 160 KB. `--frames` dumps every 30 fps frame to the gitignored `.frames/` folder.
- `npm run guide:check <id>|--all` runs the research §5.6 checks: schema, exercise/folder/view match, keyframe order, ROM, planted feet (≤ 0.005 H, ground frame), bar drift, floor and bench/seat penetration, hand contact (≤ 0.005 H), loop continuity, duration 2–6 s, ≤ 8 KB, captions and summary, and key-position labels equal to the brief's.
- **Colours** are aliases of existing tokens and never `accent`: near body `text.secondary`, far limbs and machine frames `border.control`, pads `bg.raised`, implements `text.primary`, floor/trace/cable `text.tertiary`, canvas `bg.surface`. The Linux renderer uses a Direction D mirror, and a test fails if the mirror drifts from `apps/mobile/src/theme/tokens.ts`.

## Later slice: in-app playback (needs Ben's provisional OK)
Playing guides in the app needs native modules: `@shopify/react-native-skia` 2.6.2, `react-native-reanimated` 4.5.1 and `react-native-worklets` 0.10.1 (SDK 57 bundled versions; about 6 MB on iOS; a new GitHub Actions `.ipa` build; no entitlements). The fallback is `react-native-svg` 15.15.4 with a JS-driven frame index. **Nothing here adds them.** This is recorded in `provisional-2026-10-09.md` for Ben, and it needs its own ADR plus a real-iPhone test (smoothness, battery during rest, legibility at 240 pt, Reduce Motion and VoiceOver).

## Still open
- Segment lengths follow the Drillis & Contini fractions as reproduced in Winter. **They were not re-checked against the book** (research §10 item 5).
- ROM limits apply to projected 2D angles and are wider than anatomical limits. They catch hyperextension and broken spines, not subtle form faults: Ben's review is still the gate.
- Only `barbell-back-squat` is authored. The other props (bench, cable stack, leg press, push sled, dumbbell and the front-view bar) are exercised by synthetic test guides and a visual sanity render, not yet against their briefs.
- Research brief changes 1–6 (narrow brief §157, the motion exception, the Credits screen, etc.) still need Ben's approval.
- The `exercise-guide-maker` agent definition says "one accent for the moving limb or bar path". This conflicts with research §5.5 and this ADR (never accent). The agent file should be corrected.

## Consequences
- `npm run check` now also validates the catalogue and every guide.
- Adding an exercise means adding a JSON file, running `npm run catalogue:index`, and passing `catalogue:validate`. Adding a guide means writing `guide.json`, then running `guide:render` (and looking at the result) and `guide:check`.
