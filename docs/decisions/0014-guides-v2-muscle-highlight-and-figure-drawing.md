# 0014: Guides v2 — muscle highlight colour and the contoured figure drawing

**Status:** Accepted for the muscle highlight (Ben's request of 9 Oct 2026, relayed by the product manager). Built and checked on Linux, 9 Oct 2026; **not yet seen on an iPhone** (device checks G11–G17 in [exercise-guides-v2.md](../design/exercise-guides-v2.md) §12.4). Ben still decides B1–B5 and B7 there. Every guide stays `Draft`.

## Context
Ben reviewed the 10 animated guides on 9 Oct 2026 and asked for more detailed figures that show the muscles you should feel it in most, "what NOT to do" as text, and higher quality. [ADR 0011](0011-exercise-catalogue-and-guide-tooling.md) and research §5.5 had made guides **neutral-only** ("working muscles are not colour-highlighted in v1"). [ADR 0013](0013-in-app-guide-playback.md) restated that guide colours are aliases of six neutral tokens and never `accent`. The designer specified the change in [exercise-guides-v2.md](../design/exercise-guides-v2.md).

## Decision

### Muscle highlight: one exception to the neutral-only rule
- **One new colour value**, `color.guide.muscle` = `#7A4AF0` dark / `#9B7BF7` light, the same in looks A and D (`GUIDE_MUSCLE_COLOR`). It is used only for muscle regions inside the guide canvas and the `MuscleFocusLegend` swatches. It is never `accent`, never a status colour, and never red or orange (on a body those read as pain, rule 9). This supersedes research §5.5 and ADR 0011's colour line **for the muscle highlight only**. Everything else in a guide stays a neutral alias.
- **Strong** = the entry's `primaryMuscles` (opacity 1.0), **soft** = `secondaryMuscles` (0.45; 0.60 under Increase Contrast). `grip` is capped at soft. The muscles come **only from the catalogue entry** (rule 6). A guide can hide, adjust (±0.25) or add regions only for muscles the entry lists, and `guide:check` fails otherwise. An unreadable entry means no colour.
- **Colour is never the only signal.** `Feel it most:` / `Also works:` / `Not shown from this side:` text lists the same muscles. Contrast floors are tested in both looks and schemes (`apps/mobile/test/guide-style.test.ts`): strong on the canvas ≥ 3:1 (measured 3.18–3.49), strong vs the near body ≥ 2:1 (2.33–2.48), soft over the body ≥ 1.4:1 (1.48–1.53). Regions sit 0.0035 H inside the silhouette, so the body's edge keeps its full contrast.
- **Work-phase emphasis** (strong 0.80 → 1.0 while lifting, 120 ms ramps, baked into the frames) is behind `MUSCLE_PULSE` in `apps/mobile/src/guide/player-model.ts`. It is **on**, as the spec recommends, and Ben confirms it on device (B2/G13). It is never shown under Reduce Motion, Increase Contrast, in stills, or for guides without `focus.workPhase`. The Finished state shows a steady poster.
- `color.guide.shade` (the darkest neutral: `bg.canvas` dark, `text.primary` light, always at partial opacity) is an alias, not a new value.

### Figure drawing v2
- **Shared draw ops still drive both renderers.** `frameOps` builds every shape. `renderFrameBody` serialises it to SVG for the previews and the web review page, and the app records the same ops into Skia. The figure code stays pure TypeScript, with no React, DOM or native imports.
- The body is drawn from **segment profiles** (`ADULT_V1_PROFILES`, the spec §3.3–3.4 tables) as smooth closed outlines. Centripetal Catmull-Rom curves become cubic Béziers, and both renderers parse the same `pathData`. The trunk is one outline. The figure has a head ellipse, a fist with a thumb or a flat palm, and a training shoe with a sole band. Far limbs are drawn at 0.96 width.
- **Detail tiers**: below 160 pt (S) the drawing keeps v1 halos and v1 props. At 160 pt and above (M/L) it adds an outline contour (stroked under the fill, so joints show no seams), soft shading gradients, anatomical lines, near-limb halos under the trunk, and equipment detail. Stroke widths have floors in points per tier. `DrawOp` paths gain several contours per op, `smooth` and an optional linear `gradient`.
- **The rig is unchanged.** Lengths, joints, IK and angles are the same, so every `guide.json` is still format v1. The pass/fail collision check still tests joint centrelines. A new **report-only** `outline-contact` line shows where the fuller v2 silhouette meets the floor or a seat (today: split-squat rear foot into the bench by 0.019 H, pulldown trunk into the seat by 0.007 H), so the guide-maker can re-tune.
- **`seenFrom: "front" | "back"`** carries the spec's back view. The spec calls this field `camera`, but `camera` already holds the fixed square camera in format v1. It is rejected on side-view guides. No guide uses `back` yet: the pulldown redraw is B3, and it's the guide-maker's to do.
- `fitCamera` fits the v2 outline with a 0.06 H margin (was 0.08). `guide:render` rasterises at 3× and writes an S-tier thumbnail sheet.

## Consequences
- **SVG vs Skia match.** A headless CanvasKit run of the app's draw plan against resvg, for all 10 guides, both schemes and 3 frames each at 240 px, gives:
  - with a 25% per-channel threshold, worst 0.0069% of pixels differ (v1 on the same method: 0.0017%);
  - with a 10% threshold, worst 0.25% (v1: 0.10%).
  All the differences are anti-aliasing on thin straight strokes (the dashed floor, plate edges) and shift with sub-pixel alignment. None are on the new curves or gradients. ADR 0013's "0.004%" didn't record its threshold.
- **Draw ops per frame**: 32–73 at M/L, under the 220 budget (tested). Bake time on Hermes is unmeasured (G14); see the 10 Oct 2026 bake-cost note below for the Node no-JIT proxy.
- **Differentiate Without Color** can't be read from React Native without a native module, so the app passes `false`. `frameOps` supports it (a 1 pt outline on strong regions).
- **Not built yet:** Full screen (§2.2, §9.60, with a non-square camera); the pixel-mask visible-area warning (§4.7); the optional rack prop (B7); the back-view pulldown (B3).
- The `exercise-guide-maker` agent definition still says "one accent for the moving limb or bar path". It should say: neutral aliases plus `guide.muscle` for muscle regions only, never `accent`. Agent configuration is left to the product manager.
- **Update, 9 Oct 2026 (guide-maker):** the split-squat rear foot now rests on the bench pad (no outline-contact warning) and the pulldown hips sit 0.007 H higher, so no guide reports an outline overlap. The pulldown is drawn from behind (`seenFrom: "back"`) as a provisional call for Ben (B3). Trunk muscles and trunk shading are drawn along the whole trunk chain, so they read as one shape rather than a bead per segment (spec §4.4–4.5).

## Bake cost (10 Oct 2026, guides motion and definition review B2)

Measured in Node 22 with `--jitless` (the closest proxy for Hermes we have off device): every guide × every playback frame at 348 pt, entry muscles, definition `neutral`, `bakeFrame` plus the app's path text, bundled with rolldown. Same machine before and after.

| | ms per frame (figure + path text) | per guide, mean / max | path text per frame |
|---|---|---|---|
| Before (`9b18f8f`) | 22.8 + 8.9 = 31.7 | 2.59 s / 3.18 s (leg press) | 76.7 KB |
| After | 10.5 + 3.7 = 14.2 | 1.16 s / 1.41 s (RDL) | 45.3 KB, and fewer distinct paths to parse |

What changed, all with byte-identical SVG previews except the whole-number app path text: path data memoised per contour array (a limb's halo and fill share it) and built without temporary vectors; profile slopes once per profile; per-segment memo of `frameAt`/`widthsAt`; exact bounding-box rejects in the arm-edge depth test, the fold/shading occluder tests and `polygonsWithin`; app path text in whole 1/10 000 units under one `scale` (integers print ~3× faster than decimals); one parsed `SkPath` per distinct text, kept across adjacent frames (static props parse once); frames inside a hold reuse the hold's picture. The player now starts on the baked prefix when the measured bake rate says it will stay ahead of playback (`canPlayPrefix`), so the still poster no longer lasts the whole bake.

Still open: Skia's own parse and record time is not in these numbers, and the proxy is not Hermes. G14 (full bake ≤ 1.5 s) needs the number from Ben's iPhone before it is called met.

