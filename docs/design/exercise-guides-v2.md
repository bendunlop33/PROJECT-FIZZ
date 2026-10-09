# Exercise guides v2: detailed figure, muscle focus, what not to do

Status: v0.1 draft, 9 Oct 2026. **Mostly built** (9 Oct 2026, [ADR 0014](../decisions/0014-guides-v2-muscle-highlight-and-figure-drawing.md)): render quality, figure v2, muscle focus, What not to do and the How to order. **Not built yet:** Full screen (§2.2), the visible-area warning (§4.7) and the rack prop. **Specified, not built:** muscle definition for every group (§4.11, Ben's request of 9 Oct 2026; Ben picks the mode, B8). The `camera: "back"` field (§4.8) is built as `seenFrom`, because `camera` already holds the fixed camera. The lat pulldown is drawn from behind (§4.10) as a **provisional** product-manager call; Ben confirms or rejects it (B3). It changes the How to screen in [exercise-library.md](exercise-library.md) §8, the figure drawing in `packages/catalogue/src/figure/`, and design-system principle 5, §2.3 and §9.57–9.60. Builds on [ADR 0011](../decisions/0011-exercise-catalogue-and-guide-tooling.md) (guide format, rig, Linux tooling) and [ADR 0013](../decisions/0013-in-app-guide-playback.md) (Skia playback). Research: [exercise-bank-and-visuals.md](../research/exercise-bank-and-visuals.md) §5.

**Why.** Ben reviewed the 10 animated guides on 9 Oct 2026:

> "i like the animations but i think they could be more detailed showing different bits of the body which it should focus on e.g. muscle groups you should feel it in the most. Include what NOT to do as text too. can we render it higher quality / more detailed?"

That gives three changes and one clarification:

1. **A more detailed figure.** An anatomical silhouette replaces the capsule limbs. Equipment gets more detail too (§3).
2. **Muscle focus.** The muscles the exercise works are coloured on the figure, taken from the catalogue (§4). **This breaks the neutral-only rule for guides** (research §5.5, design-system principle 5). The exception is **for the muscle highlight only, per Ben's request of 9 Oct 2026** (relayed by the product manager). Everything else in a guide stays neutral, and the guide still never uses `accent` or a status colour.
3. **What not to do, as text.** A block near the player, built from the catalogue's `cues.faults` (§5).
4. **"Higher quality"** is mostly a question of detail and shape, because guides are already vector art. Two render problems are real, though: the review sheet was drawn at 1× and the outlines are polygons. Both are fixed in §7.

Everything stays **Coaching knowledge** (rule 10). It is bundled, works offline and with no AI (rule 1), and invents nothing: the muscles come from the sourced catalogue entry, never from a model (rule 6).

---

## 0. Key decisions

| # | Decision | Section |
|---|---|---|
| GV1 | Segments get **profiles**: widths at stations along each segment, front and back separately, as fractions of H. Outlines are smooth curves, and each limb plus the trunk reads as one body | §3.2–3.5 |
| GV2 | **One muscle-highlight hue, violet**: `color.guide.muscle` = `#7A4AF0` dark / `#9B7BF7` light, the same in every look. It isn't the accent, isn't a status colour, and isn't red or orange (on a body, those read as pain, rule 9) | §4.2 |
| GV3 | **Strong** = primary muscles (opacity 1.0). **Soft** = secondary muscles (same hue at 0.45). The text always lists the muscles, so colour is never the only signal | §4.3 |
| GV4 | **Regions come from one map** (muscle → segment, surface, extent) for side, front and back views. A muscle the view can't show is listed as `Not shown from this side` | §4.5–4.7 |
| GV5 | Highlights sit on **near-side limbs and the trunk** only. Unilateral guides highlight the working limb only (`focus.side`) | §4.6 |
| GV6 | **Working-phase emphasis** (recommended, Ben to confirm): strong regions go from 0.80 to 1.0 opacity during the loaded phase. There is no pulse under Reduce Motion, in stills, or when paused | §4.9 |
| GV7 | **`What not to do`** card directly under the player. The catalogue faults are rewritten as `Don't …` instructions. It replaces `Common mistakes` | §5 |
| GV8 | **`Feel it most:` / `Also works:`** lines sit in the player card and act as the legend. They replace the header's `Main muscles:` line | §5.3 |
| GV9 | **Wrong-form ghost frame: not now.** Revisit only if Ben asks after using v2 | §6 |
| GV10 | **Level of detail by canvas size** (S < 160pt, M/L ≥ 160pt), stroke floors in points, smooth Bézier outlines, review renders at 3×, and a `Full screen` view with a portrait canvas | §3.10, §7 |
| GV11 | **Proposed:** lat pulldown redrawn **from behind** (`camera: "back"`), because its main muscles are on the back | §4.10 |
| GV12 | **Muscle definition:** every muscle group the view can show gets one faint, calm shape, separated by grooves of plain body tone, not lines. Strong > soft > faint always. Recommended faint paint is a **tinted neutral** (`guide.definition`), with violet tint as the option for Ben to compare (B8). M/L tier only | §4.11 |

---

## 1. Purpose

**Question:** "What does this movement look like, where should I feel it, and what should I not do?"

**Primary action:** none to commit. How to stays read-only reference (exercise-library.md §8.1). `Done` returns Ben to exactly where he was. The guide never adds a tap to the logging loop: it opens only from `How to` in the exercise `⋯` menu, the picker `ⓘ` or Exercise detail.

---

## 2. Layout

### 2.1 How to, v2 (iPhone 390 × 844, default text size)

Order, top to bottom: header · **player card** (tag + `Full screen`, canvas, play controls, muscle legend) · **`What not to do` card** · `Key positions` · `Setup` · `How to do it` · `Safety` (only if exercise-library.md §8.9 P1 is approved).

```
┌────────────────────────────────────────┐
│ Back squat                    ✕ Done   │ header: name only (muscles moved
├────────────────────────────────────────┤ into the player card)
│ ┌────────────────────────────────────┐ │ player card (bg.surface, radius.lg)
│ │ [Draft guide]       ⤢ Full screen  │ │ Tag left; text button right, 44pt
│ │┌──────────────────────────────────┐│ │
│ ││                                  ││ │ canvas: fills the card's width
│ ││        ◯                         ││ │ (no inner padding), square,
│ ││       ╱█▌  ← bar dot             ││ │ max 400pt. Figure in neutral tones;
│ ││      ▐██▌                        ││ │ violet on quads + glutes (strong),
│ ││      ▐▓▓▙▄                       ││ │ softer violet on hamstrings,
│ ││       ▀▓▓▓▙                      ││ │ lower back and core.
│ ││          ▐▌                      ││ │ No text in the art
│ ││  - - - -▟▙- - - - - - - - - - -  ││ │
│ │└──────────────────────────────────┘│ │
│ │ [ ❚❚ Pause    ] [ ▥ Key positions ]│ │ SecondaryButtons (wrap at AX)
│ │ ● Feel it most: Front of thighs    │ │ MuscleFocusLegend (§5.3)
│ │   (quads), glutes                  │ │ ● = strong swatch
│ │ ◐ Also works: back of thighs       │ │ ◐ = soft swatch
│ │   (hamstrings), lower back (spinal │ │
│ │   erectors), core                  │ │
│ │ Not shown from this side: inner    │ │ text.secondary
│ │   thighs                           │ │
│ └────────────────────────────────────┘ │
│ ┌────────────────────────────────────┐ │ AvoidList card (§5.1)
│ │ What not to do                     │ │ type.headline
│ │ ✕ Don't let your heels or toes lift│ │ type.body, text.primary
│ │ ✕ Don't let your knees cave inward │ │ xmark, text.secondary
│ │ ✕ Don't let your hips rise faster  │ │
│ │   than your chest                  │ │
│ │ ✕ Don't let your lower back round  │ │
│ │   at the bottom                    │ │
│ └────────────────────────────────────┘ │
│ Key positions                          │ unchanged (§8.3)
│ 1 Start                                │
│ Stand tall and brace, bar over mid-foot│
│ ...                                    │
│ Setup                                  │
│ How to do it                           │
│ Safety  (P1, if approved)              │
└────────────────────────────────────────┘
```

**Why this order, not the built order** (header muscles → player → key positions → setup → how to → common mistakes):

- **Feel it moves into the player card.** It is the legend for the colours on the canvas, so it belongs next to them. The header line becomes a duplicate and goes.
- **`What not to do` moves up from last place to second.** Ben asked for it explicitly. Faults are also the quickest thing to check mid-rest ("am I letting my heels lift?"), and a 2–4 line card is cheap to read. Setup and step-by-step cues are read once, before the first set, so they can sit lower.
- **Fold check:** on a 390 × 844 phone, the `What not to do` heading and its first two items are visible without scrolling. On a 375 × 667 SE they are visible down to the first item. (The player card ends at about 630pt on the 390 phone and about 580pt on the SE; see acceptance check A12.)
- **Canvas fills the card width.** The player card loses its inner padding around the canvas: about 350pt on a 390 phone instead of 318. Controls and the legend keep `space.4` padding.

No guide, rich cues only: no player card. The legend lines appear without swatches as the first block under the header, followed by `What not to do` and then the rest.

### 2.2 Full screen (new; from `⤢ Full screen`)

The canvas becomes **portrait** and the camera refits to the whole cycle at that aspect. A standing figure in a square canvas wastes its sides, so this makes a squat about 1.6× larger than in the card. Resolution isn't the limit here. Size on screen is.

```
┌────────────────────────────────────────┐
│ Back squat                    ✕ Done   │ fullScreen modal, bg.canvas
│ ┌────────────────────────────────────┐ │
│ │                                    │ │ canvas: screen width − 2 × space.4,
│ │              ◯                     │ │ height = everything left above
│ │             ╱█▌                    │ │ the controls (≥ 1:1, ≤ 3:4 w:h)
│ │            ▐██▌                    │ │ camera = fitCamera(guide, aspect),
│ │            ▐▓▓▙▄                   │ │ margin 4%
│ │             ▀▓▓▓▙                  │ │
│ │                ▐▌                  │ │ L detail tier
│ │  - - - - - - -▟▙- - - - - - - - -  │ │
│ └────────────────────────────────────┘ │
│ ● Feel it most: Front of thighs        │ legend: strong line only + soft line,
│   (quads), glutes                      │ no "Not shown" line (it's on How to)
│ ◐ Also works: back of thighs, …        │ one line each, tail … at default size
│ [ ❚❚ Pause      ] [ ▥ Key positions  ] │ same controls; above home indicator
└────────────────────────────────────────┘
```

- Portrait only. It opens with the same player state (current frame, pass count, playing or paused, or the key position shown) and passes it back on close.
- At AX1+ the legend lines wrap and the canvas shrinks. It never goes under 280pt tall.
- `What not to do` isn't shown here. This view is for looking at the movement, and the card is one swipe away.

---

## 3. Figure drawing v2

### 3.1 Rules that don't change

- **Original art**, drawn in code from the shared rig. No traced photos, no third-party art or styles, no AI images.
- **No face, hair, ears, fingers or text** in the art. Anatomy is shown as silhouette, soft shading, a few contour lines and, when muscle definition is on, faint muscle-group shapes (§4.11). It is never an anatomical chart: no labels, no fibre lines and no outline around each muscle.
- **Lengths don't change.** The rig `adult-v1` keeps every length, joint and IK rule, so every existing `guide.json` stays valid. Only the drawing changes. `review.renderedWith` becomes `fizz-figure@0.2.0`. All 10 guides are re-rendered and go back to Ben as drafts.
- **Pure TypeScript.** `frameOps` still produces every shape. The SVG and Skia renderers draw the same ops, and the existing pixel-match test between them still applies.

### 3.2 Segment frame and profile model

Every body segment has a local frame:

- `J0` is the proximal joint and `J1` the distal joint (for trunk segments: bottom and top). `u` is the unit vector `J0 → J1`, `L` is the drawn length (after `projection`), and `s ∈ [0,1]` runs along the segment. Some segments extend a little past their joints (`s < 0` or `s > 1`), for the deltoid cap and the buttocks.
- **Side view:** `n` is the **anterior normal**. For limbs, `n = perpCcw(u)`; for trunk segments and the neck, `n = perpCw(u)`. Either way, in a standing figure facing right, `n` points to the front (+x). Poses are built facing right and mirrored at projection, as now.
- **Front/back views:** `n` is the **lateral normal** (pointing away from the midline) for the limb's side. Trunk segments are symmetric about the midline.

A **profile** is a list of stations `(s, front, back)` in H:

- **Side view:** `front` is the half-depth from the axis to the anterior edge, and `back` is the half-depth to the posterior edge.
- **Front and back views:** `front` is the half-width on the lateral side, and `back` is the half-width on the medial side. Trunk segments use one half-width each side.

Between stations, widths are interpolated with the existing monotone cubic (`smooth` ease maths), so there are no kinks. The edge points are `E⁺(s) = J0 + s·L·u + front(s)·n` and `E⁻(s) = J0 + s·L·u − back(s)·n`. The closed outline runs along `E⁺` from the first station to the last, then a round end cap (a semicircle through the mean half-width), back along `E⁻`, and a round start cap. It is drawn as a **smooth closed path** (centripetal Catmull-Rom converted to cubic Béziers, §7.2), never a polyline.

```
        s=0 (J0)                         s=1 (J1)
 front  ╭──╮╭────────bulge──────╮
  E⁺ ── │  ╰╯                    ╰──────────╮
 axis ──●──────────────────────────────────●── u →
  E⁻ ── │  ╭──╮                  ╭──────────╯
 back   ╰──╯  ╰───bulge──────────╯
        widths at stations, H units, front and back separately
```

**Far-side limbs** (side view) use the same profiles scaled by **0.96**, which is a slight perspective cue on top of the darker `farBody` tone.

**Collision checks** (`guide:check` floor, bench and seat penetration) test the v2 outline, so what's drawn is what's checked. The tolerance stays at 0.005 H. Expect a few guides to need re-authoring, such as glutes on the bench press bench and the leg-press seat.

### 3.3 Side-view profiles (H units; starting values)

These are drawing proportions, not anthropometric data. They are tuned to read as an athletic adult at 240pt. The guide-maker may adjust any value by up to ±15% while tuning on renders. A bigger change comes back to this table.

**Thigh** (hip → knee, 0.245): quads at the front, hamstrings at the back.

| s | 0 | 0.15 | 0.40 | 0.65 | 0.85 | 1.0 |
|---|---|---|---|---|---|---|
| front | 0.046 | 0.050 | 0.049 | 0.043 | 0.035 | 0.031 |
| back | 0.050 | 0.048 | 0.043 | 0.036 | 0.030 | 0.029 |

**Shank** (knee → ankle, 0.246): a flat shin and a calf bulge behind.

| s | 0 | 0.12 | 0.28 | 0.50 | 0.75 | 1.0 |
|---|---|---|---|---|---|---|
| front | 0.029 | 0.026 | 0.024 | 0.021 | 0.018 | 0.017 |
| back | 0.029 | 0.038 | 0.041 | 0.031 | 0.021 | 0.019 |

**Upper arm** (shoulder → elbow, 0.186): the deltoid cap starts **above** the joint, at s = −0.12.

| s | −0.12 | 0 | 0.20 | 0.45 | 0.65 | 0.88 | 1.0 |
|---|---|---|---|---|---|---|---|
| front | 0.010 | 0.029 | 0.028 | 0.025 | 0.026 | 0.021 | 0.019 |
| back | 0.012 | 0.030 | 0.029 | 0.028 | 0.024 | 0.021 | 0.021 |

**Forearm** (elbow → wrist, 0.146): fuller near the elbow, tapering to the wrist.

| s | 0 | 0.22 | 0.50 | 0.80 | 1.0 |
|---|---|---|---|---|---|
| front | 0.020 | 0.023 | 0.020 | 0.016 | 0.014 |
| back | 0.020 | 0.021 | 0.018 | 0.015 | 0.013 |

**Pelvis** (hip joint → lumbar base, 0.07): it extends **below** the hip joint to s = −0.7 for the buttocks.

| s | −0.70 | −0.35 | 0 | 0.40 | 0.80 | 1.0 |
|---|---|---|---|---|---|---|
| front | 0.028 | 0.040 | 0.046 | 0.052 | 0.052 | 0.052 |
| back | 0.040 | 0.062 | 0.068 | 0.066 | 0.058 | 0.054 |

**Lumbar** (0.10): a slight inward curve at the lower back.

| s | 0 | 0.5 | 1.0 |
|---|---|---|---|
| front | 0.052 | 0.056 | 0.058 |
| back | 0.054 | 0.047 | 0.052 |

**Thorax** (0.14, top = C7 − 0.025 as now): chest at the front, shoulder blades at the back, sloping into the neck at the top.

| s | 0 | 0.30 | 0.60 | 0.80 | 0.92 | 1.0 |
|---|---|---|---|---|---|---|
| front | 0.058 | 0.064 | 0.070 | 0.066 | 0.056 | 0.040 |
| back | 0.052 | 0.060 | 0.066 | 0.064 | 0.052 | 0.034 |

**Neck** (C7 → neck top, 0.058): front 0.024 → 0.022; back 0.030 at s = 0 (trapezius) → 0.024.

### 3.4 Front- and back-view profiles (half-widths, H units)

| Segment | s stations | lateral | medial |
|---|---|---|---|
| Thigh | 0 · 0.15 · 0.45 · 0.75 · 0.92 · 1.0 | .050 · .054 · .046 · .038 · .032 · .030 | .040 · .046 · .040 · .033 · .031 · .029 |
| Shank | 0 · 0.20 · 0.50 · 0.80 · 1.0 | .029 · .030 · .024 · .018 · .016 | .029 · .033 · .025 · .018 · .016 |
| Upper arm | −0.10 · 0 · 0.30 · 0.60 · 1.0 | .014 · .028 · .026 · .023 · .020 | .010 · .020 · .022 · .022 · .019 |
| Forearm | 0 · 0.25 · 0.60 · 1.0 | .022 · .024 · .019 · .015 | .021 · .022 · .017 · .014 |

Trunk (half-width from the midline, the same both sides). This replaces the current front-view torso polygon:

| Segment | s → half-width |
|---|---|
| Pelvis | −0.6 → .100 · 0 → .105 · 0.6 → .098 · 1.0 → .088 |
| Lumbar | 0 → .088 · 0.5 → .082 (waist) · 1.0 → .090 |
| Thorax | 0 → .092 · 0.4 → .100 · 0.75 → .108 (under the armpit) · 0.90 → .100 · 1.0 → .040 (neck base; s 0.90–1.0 is the trapezius slope) |
| Neck | .028 throughout |

### 3.5 Trunk, head, hands, feet

- **Trunk as one shape.** In the side view, pelvis, lumbar and thorax are drawn as **one smooth closed outline**. The front edge runs through every front station of the three segments in world coordinates, then the back edge returns through every back station. The spine bends without seams. The neck joins with a smooth fillet of 0.01 H.
- **Head:** an ellipse in place of the circle, with the same centre. Side view: 0.056 front-to-back × 0.063 tall, tilted with the neck. Front view: 0.050 × 0.063. No features.
- **Fist** (grip contact): a rounded box from the wrist to the knuckles (0.058 long, 0.036 thick at s = 0.4, corner radius 0.010), with a thumb capsule (radius 0.007) on the front side from s = 0.3 to 0.7. Front view: 0.040 wide across the bar.
- **Flat hand** (palm contact): a tapered slab, wrist to fingertips 0.095, 0.014 thick at the wrist and 0.008 at the fingertips, with the thumb tucked as above. No fingers drawn.
- **Foot as a training shoe** (gym default). In the foot frame (origin at the ankle, +u toward the toes, +v up), the outline runs through: heel bottom (−0.046, −0.039) · sole to ball (0.085, −0.039) · toe tip (0.113, −0.031) · toe top (0.108, −0.022) · ball top (0.085, −0.018) · instep (0.040, −0.002) · front of ankle (0.014, 0.014) · Achilles (−0.030, 0.010) · back of heel (−0.052, −0.020). Toes still bend at the ball. A **sole band** (0.008 thick, `shade` paint at 0.35) runs along the bottom edge. Front view: a trapezoid, 0.030 half-width at the ankle and 0.045 at the forefoot, 0.039 tall, with rounded toes.

### 3.6 Depth and separation

| Overlap | v1 (now) | v2 at M/L tier |
|---|---|---|
| Near limb over a far limb or a prop | `background` halo | Same halo (`STROKE.halo`), so near limbs stand clear of the far side and the equipment |
| Near limb over its own trunk, or over the other near limb | `background` halo, which draws a gap line at the hip and shoulder | **No gap.** The near-limb halos are drawn *before* the trunk fill (new layer `nearHalo`), so the trunk paints over them. The limb then shows its **contour line** (§3.8), so the body reads as one figure with clear edges |
| Far limbs | `farBody` flat | `farBody` flat, widths × 0.96, no shading, no contours, no muscle colour |

At the **S tier** (thumbnails), v1 separation stays: halos everywhere and no contour lines. At that size a gap line reads better than a hairline.

### 3.7 Soft shading (M/L tier; on by default, Ben to confirm on the v2 previews)

- Light comes from above and slightly in front of the figure, along the world vector `ℓ = normalise(0.35, 1)` (in the facing-right frame).
- Each near limb segment gets a **shade band** on each edge, and the trunk gets one band per edge along the whole trunk chain (§4.4), so its shading runs through the waist without a step at each joint. The band is 40% of the local half-width deep, with a linear gradient from `shade` at the edge to transparent at the band's inner edge. The gradient runs along the segment normal. Each band fades to the edge over the first and last 20% of its length, so it never ends square at a joint (a visible seam on the first v2 renders).
- Band opacity at the edge is `0.26 × clamp(0.2 − dot(nₑ, ℓ), 0, 1)`, where `nₑ` is that edge's outward normal. This is continuous, so a limb rotating through the horizontal never pops from one side to the other.
- Front/back views: both lateral edges get bands at 0.18. There is no top-down band.
- Shading sits **above** the muscle colour (§3.11), so highlighted muscles keep their volume.
- If gradients prove costly on device, the fallback is two flat bands at 0.16 and 0.08 opacity (25% and 40% deep).

### 3.8 Contour and anatomical lines (M/L tier)

- **Outline contour:** every near limb group and the trunk is stroked along its outline. `shade` paint, opacity 0.5, width `STROKE.contour` (0.0035 H, floor 0.75pt), round joins.
- **Anatomical lines:** short open curves defined in segment coordinates, so they move with the pose. `shade` paint, opacity 0.35, width `STROKE.hair` (floor 0.75pt), round caps. At most 8 per figure. Each is given as (segment, start `(s, depth)`, mid, end), where depth runs from 0 at the front edge to 1 at the back edge in the side view:

| Line | Side view | Front view (`camera: front`) | Back view (`camera: back`) |
|---|---|---|---|
| Deltoid lower border | upperArm (0.38, 0) → (0.45, 0.5) → (0.32, 1) | upperArm, lateral edge s 0.35 → medial s 0.25 | same as front |
| Chest lower border | thorax (0.45, 0) → (0.55, 0.3) → (0.62, 0.5) | thorax, curve each side from the midline s 0.50 to the edge s 0.62 | — |
| Shoulder blade | thorax (0.85, 0.65) → (0.70, 0.62) → (0.55, 0.7) | — | thorax, a "V" each side: s 0.88 at 0.4 half-width → s 0.55 at 0.2 |
| Spine groove | — | — | lumbar and thorax midline, s 0 → thorax s 0.85 |
| Abs midline | — | lumbar and thorax midline, lumbar s 0 → thorax s 0.40 | — |
| Glute fold | pelvis (−0.60, 0.95) → (−0.65, 0.7) → (−0.55, 0.55) | — | pelvis s −0.60, from the midline to 0.8 half-width |
| Kneecap | thigh s 0.97 → shank s 0.05, front, arc 0.012 deep | thigh s 0.95 → shank s 0.05, oval 0.022 × 0.03 | — |
| Calf border | shank (0.15, 0.85) → (0.40, 0.75) → (0.62, 1) | — | shank, centre line s 0.10 → 0.45 |
| Iliac crest | pelvis (0.60, 0.15) → (0.65, 0.5) → (0.55, 0.85) | — | — |
| Collarbone | — | thorax s 0.96, from the neck to the shoulder | — |

### 3.9 Equipment detail (M/L tier; the S tier keeps the v1 shapes)

| Prop | v2 detail |
|---|---|
| **Barbell, side (plate face)** | Behind the body as now, at the same opacities. Outer rim band from r × 0.86 to r (`frameFill` at 0.85, `frame` edge stroke). Inner face `frameFill` at 0.6 with a `frame` hair ring. (Was an `implement` edge at 0.7: the brightest line on the canvas, it ringed the head in the squat and press frames and pulled the eye off the figure.) Rubber hub r 0.045 (`frame`). Sleeve r 0.025 (`implement`). Bar-end dot r 0.019 in front, as now. For `plates: large`, a second rim arc offset (0.006, −0.006) at 0.3 opacity suggests stacked plates |
| **Barbell, front (plates edge-on)** | Each plate is a profile polygon, 0.038 thick at the rim and 0.024 at the hub, with the rim lip in the outer 10% of the radius. A collar (0.014 × 0.05) on the inside. The sleeve continues 0.03 past the plates. A hair gap in `background` between plates |
| **Dumbbell** | End view: `implement` disc, rim ring at 0.8 r (`background`, hair), hub at 0.45 r as now. Side view: heads are rounded rectangles (corner radius 0.006) with two hair plate lines in `background` |
| **Bench** | Pad: rounded rectangle (corner radius 0.015), 0.05 thick, `frameFill` with a `frame` edge, and an upholstery seam (hair) at 40% depth. A board strip under the pad (`frame`, 0.008). Legs are tapered uprights (0.018 → 0.014 wide) with rubber feet (0.06 × 0.012). Incline benches get a hinge bracket (circle, r 0.012) at the pivot |
| **Cable stack** | Column outline as now. The stack is **individual plates**: 0.022 tall, with `background` hair gaps, a thicker top plate, two guide rods (`frame`, hair) from the top plate to the column top, and a selector pin (`implement` dot, r 0.005) on the 6th plate. Pulley: wheel r 0.022, groove ring r 0.012, axle dot, and a bracket line to the column |
| **Leg press** | Carriage plate edge in `implement` as now. Seat and back pads get the bench pad treatment. A side handle (capsule, `implement`) at the front of the seat. The plate horn shows the barbell plate-face detail at 0.8 scale |
| **Push sled** | Runners (skids) under the body, with an upturned front tip. Grip sleeves on the poles (0.022 thick for 0.06 around the hands). Stacked plates get rim edges |
| **Rack (new, optional prop, for the squat)** | Two uprights behind the figure (`frame`, layer `back`, 0.5 opacity) with **safety arms** at a set height (`frame`, 0.012 thick). It supports the existing safety note ("Squat inside a rack with the safety arms set…"). Guide-maker's call per guide |

### 3.10 Level of detail by canvas size

Frames are recorded per **detail tier**, and the bake cache key gains the tier. Stroke floors are in points at the drawn size, so a hairline never falls below about one device pixel at 3×.

| Tier | Canvas (shorter side) | Draws | Stroke floors |
|---|---|---|---|
| **S** | < 160pt (3-up thumbnails, review strips) | v2 silhouettes (profiles, hands, feet), muscle colour (strong and soft), v1 halos, v1 prop shapes. No muscle definition (§4.11.5) | halo 1.25pt · edge 1.0pt · hair 0.75pt |
| **M/L** | ≥ 160pt (player 200–400pt, full screen) | Everything: silhouettes, muscle definition (§4.11), muscle colour, shading, contour and anatomical lines, equipment detail, v2 separation (§3.6) | halo 1.0pt · edge 0.75pt · contour 0.75pt · hair 0.75pt |

There are two tiers on purpose: one simple cut, and every in-app player size gets full detail. The bake for the M/L tier is used for every size in that range. Skia pictures are vector, so they scale without loss.

### 3.11 Draw order (side view, back to front)

1. Floor (dashed `trace`)
2. `back` layer props (plate faces, rack, stack column)
3. Far limbs (`farBody`, ×0.96, with halos)
4. `mid` props (bench, cable, seats)
5. **`nearHalo`**: halos of the near limbs (new layer)
6. Trunk, neck and head fill (`nearBody`) → trunk muscle regions **except the pelvis** → trunk shading → trunk contour and anatomical lines
7. Near leg: fill → muscle regions → shading → contours
8. **Pelvis regions** (glutes, abductors). They are drawn after the near leg, so the thigh doesn't cut the glute region in half
9. Near arm: fill → muscle regions → shading → contours
10. Bar-path trace (static, as now)
11. `front` props (bar dot, dumbbells, handles)

Front view: floor → back props → mid props → trunk (fill, regions, shading, lines) → both legs → both arms → front props.

Back view (`seenFrom: "back"`): floor → back props → **both legs** → mid props → trunk → both arms → front props. From behind, the buttocks and the seat are nearer the camera than the legs, so the legs go first. A front-view barbell is drawn with the mid props in a back view: it is held in front of the body, so the head and trunk hide its middle and the hands grip over it.

**Muscle definition (§4.11.6).** In every order above, a group's faint shapes go straight after its fill and before its muscle regions, and each muscle-region op sits on a `nearBody` underlay of its own path. In the side view, the faint glutes go with the pelvis regions (step 8).

---

## 4. Muscle focus ("Feel it here")

### 4.1 Source and rules

- **The source is the catalogue entry only:** `primaryMuscles` gives **strong** and `secondaryMuscles` gives **soft**. The guide never adds a muscle the entry doesn't list (§4.8). No model output, no Ben data.
- **The text always lists the muscles** (§5.3). The highlight adds to the text and never replaces it (principle 3).
- The highlight appears **only in the guide canvas** on How to and in Full screen. It never appears in rows, filters, Progress or anywhere else. No other screen gains muscle colour.

### 4.2 Colour: one dedicated hue

| Token | Dark | Light | Notes |
|---|---|---|---|
| `color.guide.muscle` | `#7A4AF0` | `#9B7BF7` | **New colour value** (the one exception to "guides use aliases only"). The same values in every look (A Navy, D Premium) |
| `color.guide.shade` | alias `bg.canvas` | alias `text.primary` | The darkest neutral in each scheme, used for shading and contours |

**Why violet:** every other hue is taken or carries a meaning.

| Hue | Already means | Problem |
|---|---|---|
| Blue | `accent` in look A | Reserved for the primary action and the active set |
| Porcelain / near-black | `accent` in look D | Neutral, so it wouldn't read as a highlight |
| Green | `status.done` | Would say "done" or "good" |
| Amber / orange | `status.warning`, pain markers | On a body it would say "pain here" (rule 9) |
| Red / coral | `status.danger` | Reads as injury, which is worse than amber |
| **Violet** | Nothing | Free in both looks and distinct from everything above |

**Contrast** (hand-calculated with the WCAG relative-luminance formula; re-check in a tool, and `test/figure-style.test.ts` asserts the floors):

| Pair | Dark (D / A) | Light (D / A) | Floor |
|---|---|---|---|
| strong muscle on canvas (`bg.surface`) | ~3.5:1 / ~3.2:1 | ~3.2:1 / ~3.2:1 | ≥ 3:1 |
| strong muscle against near body | ~2.3:1 / ~2.5:1 | ~2.5:1 / ~2.3:1 | ≥ 2:1, plus a large hue difference (the body is neutral grey) |
| soft muscle (0.45 over the body) against near body | ~1.5:1 | ~1.5:1 | ≥ 1.4:1 |

**3:1 against the body isn't possible on both sides.** A highlight dark enough to be 3:1 against the light body in dark mode looks like a bruise. The highlight isn't the only carrier of meaning, so WCAG 1.4.11 doesn't require it, and the floors above keep it clearly visible. A **0.0035 H inset** keeps every muscle region just inside the silhouette, so the figure's outer edge always stays in body tone at the body's full contrast (> 7:1).

### 4.3 Strong and soft

| Level | From | Steady opacity | During the working phase (§4.9) | Under Increase Contrast |
|---|---|---|---|---|
| **Strong** | `primaryMuscles` | 1.0 | 0.80 → 1.0 | 1.0 steady |
| **Soft** | `secondaryMuscles` | 0.45 | 0.36 → 0.50 | 0.60 steady |

- Where regions overlap (e.g. `chest` strong and `upper_chest` soft), the higher level wins. Each pixel gets one muscle paint, never stacked opacity: regions of one level are merged into one path per segment before filling, and each level's path is drawn over an opaque `nearBody` underlay of the same path (§4.11.6). The underlay also stops strong at 0.80 stacking on soft during the pulse (review N3).
- `grip` is **capped at soft** even when it's primary. Hands are small and sit on the implement, so a strong hand would pull the eye to the bar.
- **Differentiate Without Color** (iOS setting): strong regions also get a 1pt `text.primary` outline at 0.6 opacity. The legend text is unchanged.

### 4.4 Region geometry

A region belongs to one segment and is built from that segment's own profile (§3.2), so it is inside the outline by construction. No clip path is needed.

- **Edge band** `segment.front | segment.back` (side view), or `segment.lat | segment.med` (front/back views), over `s0–s1` with depth `d` (0–1). The outer curve is the edge inset by 0.0035 H. The inner curve sits `d × halfWidth(s) × τ(s)` in from the edge, where `τ(s) = sin(π·(s − s0)/(s1 − s0))^0.6`, so the band tapers to the edge at both ends like a muscle belly.
- **Face lens** `segment.face` over `s0–s1`, centred at `c` with width `w`. `c` runs from −1 to +1 across the segment: −1 is the back edge and +1 the front edge in the side view; −1 is medial and +1 lateral on front/back limbs; −1 is the figure's right edge and +1 its left edge on the trunk. `w` is a fraction of the local full width. The half-width is `w × width(s)/2 × τ(s)`. **`±c` means a mirrored pair** (left and right, trunk only).
- **Whole segment** `hand.full`: the hand outline inset by 0.0035 H.
- **Trunk chain** `trunk.…`: pelvis, lumbar and thorax read as one segment, with `s` = segment index + local s (pelvis −0.7…1, lumbar 1…2, thorax 2…3). It uses the trunk outline's own frames, so a muscle that spans the trunk is **one** smooth shape. Per-segment bands each taper to nothing at the joints, so a muscle drawn as one band per segment showed as a row of beads (product-manager review of the v2 renders, 9 Oct 2026).
- Each curve is sampled at 12 points, then drawn as a smooth closed path.
- A region on a segment drawn with `projection` < 0.5 in a frame (pointing at the camera) isn't drawn in that frame.

### 4.5 Region map

Notation: `segment.surface s0–s1 d` (edge band) or `segment.face s0–s1 c w` (lens); `trunk` is the trunk chain (§4.4). `—` means not shown in that view; the muscle is then listed as text only (§4.7). Side view = near-side limbs plus the trunk. Front view = figure facing the camera. Back view = figure facing away (§4.10).

| Muscle | Side view | Front view | Back view |
|---|---|---|---|
| `abductors` | pelvis.face 0–0.95 c−0.05 w0.5 (joins the glutes, so the hip reads as one mass) | pelvis.lat 0–0.9 d0.35 | pelvis.lat 0.1–1.0 d0.4 |
| `abs` | trunk.front 0.3–2.35 d0.45 | trunk.face 0.4–2.4 c0 w0.42 | — |
| `adductors` | — (the inner thigh faces away from the camera) | thigh.med 0.02–0.55 d0.55 | thigh.med 0.02–0.45 d0.5 |
| `biceps` | upperArm.front 0.30–0.88 d0.6 | upperArm.face 0.30–0.88 c−0.1 w0.6 | — |
| `brachialis` | upperArm.face 0.60–0.95 c+0.35 w0.35 | upperArm.lat 0.60–0.95 d0.3 | — |
| `calves` | shank.back 0.08–0.62 d0.7 | shank.med 0.10–0.50 d0.3 + shank.lat 0.10–0.45 d0.25 | shank.face 0.05–0.65 c0 w0.85 |
| `chest` | thorax.front 0.42–0.86 d0.55 | thorax.face 0.50–0.88 ±c0.45 w0.55 | — |
| `core` | trunk.front 0.4–2.4 d0.75: one deep band for abs and obliques together (two overlapping soft shapes read as blotches) | = `abs` + `obliques` | = `spinal_erectors` + `obliques` |
| `forearms` | forearm.face 0–0.65 c0 w0.8 | forearm.face 0–0.6 c0 w0.8 | forearm.face 0–0.6 c0 w0.8 |
| `front_delts` | upperArm.front −0.10–0.35 d0.7 | upperArm.face −0.10–0.35 c−0.3 w0.6 | — |
| `glutes` | pelvis.back −0.65–0.75 d0.7 | — | pelvis.face −0.65–0.8 ±c0.45 w0.6 |
| `grip` (soft max) | hand.full + forearm.front 0–0.45 d0.5 | hand.full + forearm.face 0–0.4 c0 w0.6 | hand.full + forearm.face 0–0.4 c0 w0.6 |
| `hamstrings` | thigh.back 0.08–0.88 d0.65 | — | thigh.face 0.10–0.88 c0 w0.7 |
| `lats` | trunk.back 1.45–2.78 d0.5 | thorax.lat 0.25–0.80 d0.25 (the "wings" beside the chest) | trunk.face 1.3–2.88 ±c0.3>0.6 w0.25>0.5 (a wing each side, sweeping from the waist out to the armpit; as built, review of 9 Oct 2026) |
| `obliques` | trunk.face 0.6–2.3 c+0.1 w0.5 | trunk.lat 0.8–2.25 d0.35 | trunk.lat 0.8–2.25 d0.25 |
| `quads` | thigh.front 0.05–0.92 d0.75 | thigh.face 0.05–0.90 c+0.1 w0.7 | — |
| `rear_delts` | upperArm.back −0.10–0.35 d0.7 | — | upperArm.face −0.10–0.35 c+0.3 w0.6 |
| `side_delts` | upperArm.face −0.12–0.40 c0 w0.7 | upperArm.lat −0.12–0.35 d0.6 | upperArm.lat −0.12–0.35 d0.6 |
| `spinal_erectors` | trunk.back 0.6–2.4 d0.4 | — | trunk.face 0.6–2.4 ±c0.2 w0.22 |
| `traps` | thorax.back 0.72–1 d0.55 (the slope into the neck; a separate neck piece pinched off into a second bead) | thorax.face 0.90–1.0 ±c0.55 w0.5 (the slope from the neck to the shoulder) | thorax.face 0.55–1.0 c0 w0.7, narrowing to w0.3 at s 0.55 + neck.face 0–0.5 c0 w0.6 |
| `triceps` | upperArm.back 0.12–0.85 d0.7 | — | upperArm.face 0.10–0.85 c0 w0.75 |
| `upper_back` | thorax.back 0.58–0.95 d0.45 | — | thorax.face 0.55–0.95 c0 w0.5 |
| `upper_chest` | thorax.front 0.70–0.92 d0.45 | thorax.face 0.72–0.92 ±c0.45 w0.5 | — |

**Why `trunk` and single shapes** (9 Oct 2026, after the first v2 renders): soft trunk muscles drawn one band or lens per segment showed as several separate blotches across the torso. Each muscle that spans the trunk is now one shape, and side-view `core` is one band. Strong limb regions (quads, glutes) were already one shape each and are unchanged.

The head, the neck (apart from `traps` in the back view) and the feet are never coloured. Values are starting points, with the same ±15% tuning freedom as §3.3. The map lives in one typed constant (`MUSCLE_REGION_MAP`) next to the profiles, keyed by the `Muscle` vocabulary in `src/vocab.ts`. A test fails if a vocabulary muscle has no row.

**Coverage of the 10 existing guides** (what the text will list as not shown):

| Guide | View | Not shown |
|---|---|---|
| Back squat, Romanian deadlift, leg press | side | inner thighs (adductors) |
| Bulgarian split squat | side | inner thighs (adductors); core too, because the guide hides it (`focus.hide`: the hanging arm covers the front of the trunk) |
| Lat pulldown | back (provisional, B3) | front of upper arms. (From the front it would be upper back, back of shoulders) |
| Bench press, overhead press, one-arm row, triceps pushdown, sled push | side | nothing |

### 4.6 Which limbs are coloured

- **Side view:** near-side limbs and the trunk only. Far limbs stay flat `farBody`. Colour on both would be noise, and the far limb is mostly hidden.
- **Front and back views:** both sides (`focus.side: "both"`, the default for these views).
- **Unilateral exercises:** only the **working** side. Guides already put the working limb near (the split-squat front leg, the one-arm-row pulling arm), so the side-view default `focus.side: "near"` is right. Front/back unilateral guides set `"near"` or `"far"`. Trunk regions are drawn once, whatever the side.
- `guide:check` warns when `laterality: unilateral` and a front/back-view guide has no `focus.side`.

### 4.7 Muscles that can't be shown

A muscle whose map cell is `—` in the guide's view (or that a guide hides, §4.8) is **not drawn**. **Every muscle the entry lists always stays in its text list** (`Feel it most` = primary, `Also works` = secondary), drawn or not. The legend also adds one line naming the listed muscles that aren't coloured, `Not shown from this side: inner thighs.` (wording by view, §10), so a hidden or undrawable muscle appears twice: in its list and on the `Not shown` line. A line's swatch shows only when at least one muscle on it is drawn (§5.3). A muscle is never drawn on a surface the camera can't see.

`guide:check` also measures what is actually visible: it renders a mask of each region at every key frame, after occlusion by later layers. It **warns** when a primary muscle's visible area is under 1.5% of the figure's area in every key frame. That way a region hidden behind an arm all cycle is caught and the guide-maker can hide or adjust it.

### 4.8 Per-guide overrides (`guide.json`, optional, format stays v1)

```json
"camera": "back",
"focus": {
  "side": "near",
  "workPhase": [{ "from": 0.53, "to": 1.0 }],
  "hide": ["adductors"],
  "adjust": { "glutes": { "s": [-0.6, 0.6] } },
  "add": [{ "muscle": "lats", "region": "thorax.back 0.10–0.70 d0.5" }]
}
```

| Field | Meaning | Validation |
|---|---|---|
| `camera` | Front-view guides only: `"front"` (default, facing the camera) or `"back"` (facing away). Same pose maths; only the drawing and the region map change | Rejected on side-view guides |
| `focus.side` | `"near"` · `"far"` · `"both"` | Defaults: side → `near`; front/back → `both` |
| `focus.workPhase` | Ranges of normalised `t` when the target muscles are loaded (lifting the weight). Drives §4.9 | Inside 0–1, ordered, not overlapping. Omitted means no emphasis |
| `focus.hide` | Don't draw these muscles in this guide. They stay in their `Feel it most` / `Also works` list and are also named on the `Not shown` line (§4.7) | Must be listed in the entry's primary or secondary muscles |
| `focus.adjust` | Change the extent (`s`), depth (`d`), centre (`c`) or width (`w`) of a mapped region | Same muscle rule; at most ±0.25 on any number |
| `focus.add` | Draw a region the map leaves out in this view, with explicit geometry | **Only muscles the entry already lists**, so the figure can never show a muscle the text doesn't name |

`guide:check` prints a focus table for each guide (muscle, level, drawn or not shown, visible area at each key position), and `meta.json` records it for review.

### 4.9 Working-phase emphasis (recommended; Ben to confirm on device)

- During `focus.workPhase` (e.g. standing up out of the squat, or pulling the bar down), strong regions rise from 0.80 to 1.0 opacity and soft regions from 0.36 to 0.50. The ramps take 120 ms of guide time (smoothstep). Outside the phase, they sit at the low value.
- It is **baked into the frames**, so it costs nothing at playback and stays in step with the motion.
- At most one rise per rep (2–6 s), with a small luminance change: far from anything WCAG 2.3.1 cares about. It's an emphasis, not a flash.
- **No emphasis (steady values) when:** Reduce Motion is on (including Ben's opt-in `Play animation` under Reduce Motion), in the key-position stills, in the poster and Finished frame, under Increase Contrast, and for guides with no `workPhase` (e.g. sled push, which works continuously). When Ben pauses, the frame is held exactly as it was.
- **Why recommend it:** it links the colour to the effort ("you feel it here as you stand up"), which is what Ben asked for, and it only appears while the figure is already moving. **The alternative** is steady colour throughout (set `guide.musclePulse` to off). Choose this if the device test (G13) finds it distracting.

Suggested `workPhase` for the existing guides: squat, leg press and split squat: from the end of the Bottom hold to the end. Romanian deadlift: from Bottom to the end. Bench press: from the end of the Chest-touch hold to the end. Overhead press, row and pulldown: from Start to the top or bottom position (the pull or press). Triceps pushdown: from Start to the bottom lockout. Sled push: none.

### 4.10 Proposed: back view for the lat pulldown (Ben to confirm)

The pulldown's primary muscle is `lats`, and its secondaries are `upper_back`, `rear_delts`, `biceps` and `brachialis`. From the front, only thin lat "wings" beside the chest show, and the upper back can't be shown at all. From **behind** (`camera: "back"`), the lats are the largest region on the figure, and the upper back and rear shoulders show too. Only the arm flexors drop to text.

What changes when drawn from behind: the spine groove and shoulder-blade lines (§3.8). The machine column sits *behind* the figure in the picture (layer `back`). The bar is drawn in front of the head at the top and behind the torso at the bottom, where only the bar ends either side show. The cable runs from the bar centre up past the head. `cameraNote` and `a11y.summary` are updated ("Back view…"). The ROM and contact checks are unchanged (same 2D projection).

If Ben prefers the front view, the guide keeps `camera: "front"` and the text lists upper back and rear shoulders under `Not shown from the front`.

**As drawn (9 Oct 2026, provisional):** `seenFrom: "back"`. The lats are one wing each side (`trunk.face … ±c0.3>0.6`, sweeping from the waist out to the armpit), with the upper back and rear shoulders soft. The thigh pad sits behind the body. The bottom bar position is the upper chest (0.588 H, just below the top of the shoulders), so from behind the upper back hides the bar and only its ends show; at neck height it could read as a behind-the-neck pull, which the brief forbids. At the bottom the upper arm (0.83) and forearm (0.68) are foreshortened, because the elbows go back and the hands sit forward at the chest; in-plane arms would fold the elbows down to the waist. To go back to the front view, drop `seenFrom`; the rest of the pose (bar to the upper chest, foreshortened arms at the bottom) is right from the front too.

### 4.11 Muscle definition (all groups) (specified, not built; Ben picks the mode, B8)

> Ben, 9 Oct 2026, on the v2 guides: "can we add more definition to the actual muscle groups so you can see it even when they are not being used (faint colour)"

Today only the muscles the entry lists are drawn. The rest of the near body is one flat tone, so the triceps pushdown is a grey figure with one violet patch, and nothing says "these are shoulders, this is the chest". This section adds **one faint, always-visible shape for every muscle group the view can show**. The figure then reads as a body with muscles, and the coloured groups read as "these ones" against the rest.

**Question:** "Where are the muscles on this body, and which of them is this exercise about?" **Primary action:** none. It is part of the drawing (§1).

#### 4.11.1 Three levels, one paint per pixel

| Level | Muscles | Paint (recommended mode) | Means |
|---|---|---|---|
| **Strong** | the entry's `primaryMuscles` | `guide.muscle` at 1.0 | `Feel it most` |
| **Soft** | the entry's `secondaryMuscles` | `guide.muscle` at 0.45 | `Also works` |
| **Faint** | every other definition group the view can show (§4.11.3) | `guide.definition` (neutral) | Anatomy only: "a muscle is here" |
| Body | grooves between groups, joints, head, neck, hands, feet, shin, far-side limbs | `guide.nearBody` / `guide.farBody` | — |

- **Faint makes no claim about effort.** It never means "not used" or "works a little". The catalogue lists the main muscles, others may still brace or steady, and the app doesn't know how much (rule 6). Copy calls them "other muscles", never "inactive", "unused" or "resting" (§4.11.8).
- **The order never changes:** strong > soft > faint, in every state, look and scheme. The tests assert it (§4.11.11).
- **One paint per pixel.** Faint, soft and strong never stack (§4.11.6).

#### 4.11.2 Neutral or tint

One draw option, `definition`, with three values (§4.11.9):

| Mode | Faint paint | Dark scheme | Light scheme |
|---|---|---|---|
| **`neutral`** (recommended) | `color.guide.definition` = alias of `text.primary` | 0.25 over the body: a little **lighter** | 0.18 over the body: a little **darker** |
| `tint` (Ben's literal ask, for comparison) | `color.guide.muscle` | 0.18: a little darker, violet | 0.18: a little lighter, violet |
| `off` | none | today's drawing | today's drawing |

`neutral` is a **tinted neutral**: the look's own `text.primary`, warm in Premium (D) and cool in Navy (A), never violet. It always moves the body tone **away from the canvas**, lighter on the dark canvas and darker on the light one. The violet always moves it **toward the canvas** (the dark-mode violet is darker than the body, the light-mode violet lighter). So faint and violet go in opposite directions in both schemes and can't be mistaken for each other.

**Contrast.** Hand-calculated with the WCAG relative-luminance formula from the composites in design-system §2.3. Re-check in a tool; `guide-style.test.ts` asserts the floors.

| Pair | Dark D / A | Light D / A | Floor (test) |
|---|---|---|---|
| strong vs body (unchanged) | 2.33 / 2.46 | 2.48 / 2.34 | ≥ 2.0 |
| soft vs body (unchanged) | 1.51 / 1.53 | 1.51 / 1.48 | ≥ 1.4 |
| **faint vs body**, neutral | 1.19 / 1.19 | 1.19 / 1.21 | 1.12–1.25 |
| **faint vs body**, tint | 1.18 / 1.18 | 1.18 / 1.17 | 1.12–1.25 |
| **soft vs faint**, neutral | 1.80 / 1.82 | 1.80 / 1.78 | ≥ 1.6 |
| **soft vs faint**, tint | 1.28 / 1.29 | 1.28 / 1.26 | ≥ 1.25 |
| strong vs faint, neutral | 2.79 / 2.92 | 2.96 / 2.81 | ≥ 2.5 |
| strong vs faint, tint | 1.98 / 2.08 | 2.10 / 1.99 | ≥ 1.9 |
| soft at its pulse low (0.36) vs faint, neutral | 1.66 / 1.66 | 1.65 / 1.64 | ≥ 1.5 |
| soft at its pulse low (0.36) vs faint, tint | 1.18 / 1.19 | 1.17 / 1.16 | (why tint keeps soft steady) |

A faint step of about 1.19:1 is a little more than the step from `bg.surface` to `bg.raised` (about 1.13:1 in Navy dark), which is how a card stands off the screen. It is clearly visible on a large shape and still quiet.

**Recommendation: `neutral`.**

1. **The hierarchy rests on two cues, not one.** Neutral faint differs from soft in hue *and* in the direction of lightness (about 1.8:1 apart). Tint faint differs only in the amount of the same violet (about 1.28:1 apart), which is the weakest cue at 240pt, in gym light and in a glance between sets.
2. **Violet keeps one meaning.** Three strengths of one hue read as an amount scale, so faint violet would say "works a little". The catalogue doesn't say that (rule 6). Neutral says "a muscle is here", and violet still says only "this exercise works it".
3. **Nothing else has to change.** The legend, the work-phase pulse, Increase Contrast and Differentiate Without Color all work as now. Tint needs an extra legend line, has to drop the soft pulse (at its low point, soft would sit only about 1.17:1 from faint) and has to fall back to neutral under Increase Contrast and Differentiate Without Color.
4. **It suits both looks.** The faint tone carries the look's own warmth (D) or coolness (A), so violet stays the only hue that means anything.

Ben asked for "faint colour", and `neutral` is a faint tone rather than a colour. The review page shows all three modes side by side (§4.11.9), and Ben picks (B8). If he picks `tint`, it is built exactly as specified here, rules included.

#### 4.11.3 Groups and geometry (`DEFINITION_MAP`)

A definition group is a muscle group a gym-goer would point to, drawn as **one calm shape** (a mirrored pair on the trunk; one per limb in front and back views). Not every vocabulary muscle gets a group. Sub-parts (`upper_chest`, `brachialis`) and composites (`core`, `grip`) would overlap their parent and put two tones on one muscle, which is the mottled look fixed on 9 Oct (§4.5).

The notation and geometry are §4.4's. `= §4.5` means the same region the highlight uses. Other values are trimmed or deepened so that groups sit side by side with a narrow groove, instead of overlapping or leaving wide stripes of body tone. They are starting values, with the same ±15% tuning freedom as §3.3.

| Group | Replaced by (§4.11.5) | Side view | Front view | Back view |
|---|---|---|---|---|
| `chest` | chest, upper_chest | = §4.5 `chest` | thorax.face 0.55–0.85 ±c0.5 w0.42 (leaves a breastbone groove) | — |
| `abs` | abs, core | = §4.5 `abs` | = §4.5 `abs` | — |
| `obliques` | obliques, core | trunk.face 0.65–2.05 c+0.05 w0.4 | trunk.lat 1.05–2.2 d0.35 | = §4.5 `obliques` |
| `lowerBack` | spinal_erectors; back view also core | trunk.back 0.85–1.9 d0.38 | — | trunk.face 0.85–1.9 ±c0.24 w0.2 (leaves a spine groove) |
| `lats` | lats | trunk.back 1.98–2.56 d0.55 | thorax.lat 0.30–0.58 d0.25 | trunk.face 1.95–2.72 ±c0.42>0.62 w0.3>0.45 |
| `upperBack` | upper_back, traps | thorax.back 0.64–1.0 d0.45 (shoulder blade and trap slope) | = §4.5 `traps` (the slope only) | = §4.5 `traps` |
| `glutes` | glutes, abductors | = §4.5 `glutes` | — | pelvis.face −0.65–0.8 ±c0.5 w0.48 (leaves the cleft) |
| `outerHip` | abductors | — (part of `glutes`) | = §4.5 `abductors` | — (part of `glutes`) |
| `deltoid` | front_delts, side_delts, rear_delts | upperArm.face −0.12–0.32 c0 w0.9 | upperArm.face −0.10–0.32 c0 w0.9 | upperArm.face −0.10–0.32 c0 w0.9 |
| `frontArm` | biceps, brachialis | upperArm.front 0.38–0.88 d0.75 | upperArm.face 0.38–0.88 c−0.1 w0.6 | — |
| `triceps` | triceps | upperArm.back 0.36–0.86 d0.8 | — | upperArm.face 0.36–0.86 c0 w0.75 |
| `forearm` | forearms, grip | = §4.5 `forearms` | = §4.5 `forearms` | = §4.5 `forearms` |
| `quads` | quads | thigh.front 0.05–0.92 d0.9 | thigh.face 0.05–0.90 c+0.15 w0.62 | — |
| `hamstrings` | hamstrings | thigh.back 0.08–0.88 d0.85 | — | thigh.face 0.10–0.88 c+0.1 w0.62 |
| `adductors` | adductors | — | thigh.med 0.02–0.55 d0.4 | thigh.med 0.02–0.45 d0.3 |
| `calves` | calves | = §4.5 `calves` | = §4.5 `calves` (two edge bands) | = §4.5 `calves` |

That is 14 groups from the side, 12 from the front and 11 from behind. Every one of the 23 vocabulary muscles appears in some `Replaced by` list. The head, the neck (apart from the back-view trap shape, as in §4.5), hands, feet and the front of the shin stay body tone. No vocabulary muscle sits there, and a plain shin reads as bone, which is right.

Side view, facing right (schematic, not to scale):

```
  back edge ◄──────────────────────────────► front edge
                       ╭──╮
                       ╰┬┬╯            head, neck: body tone
  thorax   ░upper back░ ┊            ┊ ░chest░
           ░lats░░░░░░░ ┊            ┊
  lumbar   ░lower back░ ┊ ░obliques░ ┊ ░abs░
  pelvis   ░glutes░░░░░ ┊            ┊ ░abs░
  thigh    ░hamstrings░ ┊            ┊ ░quads░
  shank    ░calves░░░░░ ┊            ┊  shin: body tone
  upper arm ░triceps░ ┊ ░deltoid cap (top)░ ┊ ░front of arm░
  forearm   ░forearm░
  ░ faint shape     ┊ groove: plain body tone, ≥ 0.006 H
```

Rules (tested, §4.11.11):

- **Grooves, no overlaps, within a body group.** Within one body group (the trunk, one leg, one arm), two faint shapes never overlap, and at their closest point they are at least `guide.definitionGroove` apart. That is 0.006 H, about 1.2pt on a 240pt canvas. The test floor is 0.004 H at every key frame of every guide. Shapes in *different* body groups may overlap: draw order puts the nearer one in front (the glute over the top of the hamstrings, an arm over the trunk), and faint fills are opaque, so nothing stacks.
- Shapes stay inside the silhouette by `guide.muscleInset`, like muscle regions.
- `DEFINITION_MAP` is one typed constant beside `MUSCLE_REGION_MAP`, written in the same notation and parsed by the same `parseRegion`, so the table can be checked against the code line by line.

#### 4.11.4 Separation: grooves, not lines

**Decision: no new separation lines.** Neighbouring groups are separated by a **groove**, a narrow strip of plain body tone built into the geometry (§4.11.3). Why:

- Outlining every muscle is what turns a figure into an anatomical chart (§3.1). A groove reads as form, like the shadow between two muscles.
- Differentiate Without Color marks strong regions with an outline (§4.3). If every group had a line, that cue would be lost.
- Strokes have point floors (0.75pt), so lines weigh relatively more at 240pt than at 400pt, and many hairlines on a moving figure shimmer. A groove is a gap between fills, so it scales with the figure.
- The existing anatomical lines (§3.8: deltoid border, chest border, shoulder blade, glute fold, kneecap, calf border, iliac crest, spine, abs midline, collarbone) already fall on group boundaries. They stay as they are, at most 8, drawn above the faint shapes.

If the device check (G18) finds that groups run together, widen the grooves (trim `s` ranges or depths) before considering lines.

#### 4.11.5 Which groups are faint

- **Replaced by colour.** A group isn't drawn faint when any muscle in its `Replaced by` list is coloured in this view. The coloured region takes its place, so a group is either faint or coloured, never both. For example, the bench press colours `front_delts`, so the deltoid cap shows only the front-delt colour, not faint plus violet on one small shape.
- **Hidden means hidden.** A group is also skipped when the guide hides a muscle in its list (`focus.hide`). The `Not shown` line names that muscle, so a faint shape there would contradict the text. The split squat hides `core`, so it has no faint abs or obliques.
- **Muscles a view can't show** have no group in that view (the `—` cells), so faint never contradicts `Not shown from this side`.
- **Which limbs.** Side view: near limbs and the trunk (§4.6). Far limbs stay flat `farBody`. Front and back views: **both sides**, whatever `focus.side` says. Definition is anatomy, so a unilateral front-view guide shows the resting side faint and the working side coloured.
- **Foreshortening.** The §4.4 projection rule applies: a segment pointing at the camera (projection < 0.5) gets no shape. `guide:check` warns when a faint shape appears or disappears mid-cycle, so the guide-maker can see any pop.
- **Detail tier: M/L only** (≥ 160pt, the card and Full screen). The S tier (115pt thumbnails) draws **no** definition. At that size a 0.006 H groove is about 0.6pt, so the groups would merge into a faint blur around the strong colour, and a thumbnail's job is the pose plus the strong colour. Thumbnails stay exactly as they are. `definitionCompact` (review only) draws them anyway, so Ben can compare.

What the 10 existing guides show (side view unless noted; "coloured" means strong or soft, as today):

| Guide | Coloured groups | Faint groups |
|---|---|---|
| Back squat | quads, glutes, hamstrings, lowerBack, abs + obliques (core) | chest, lats, upperBack, deltoid, frontArm, triceps, forearm, calves |
| Romanian deadlift | hamstrings, glutes, lowerBack, upperBack, forearm (grip) | chest, abs, obliques, lats, deltoid, frontArm, triceps, quads, calves |
| Leg press | quads, glutes, hamstrings | chest, abs, obliques, lowerBack, lats, upperBack, deltoid, frontArm, triceps, forearm, calves |
| Bulgarian split squat | quads, glutes, hamstrings, forearm (grip). Abs and obliques skipped (core hidden) | chest, lowerBack, lats, upperBack, deltoid, frontArm, triceps, calves |
| Bench press | chest, deltoid (front delts), triceps | abs, obliques, lowerBack, lats, upperBack, glutes, frontArm, forearm, quads, hamstrings, calves |
| Overhead press | deltoid, triceps, chest (upper chest only), upperBack (traps), abs + obliques (core) | lowerBack, lats, glutes, frontArm, forearm, quads, hamstrings, calves |
| One-arm row | lats, upperBack, deltoid (rear delts), frontArm, forearm (grip) | chest, abs, obliques, lowerBack, glutes, triceps, quads, hamstrings, calves |
| Triceps pushdown | triceps | chest, abs, obliques, lowerBack, lats, upperBack, glutes, deltoid, frontArm, forearm, quads, hamstrings, calves |
| Sled push | quads, glutes, calves, hamstrings, abs + obliques (core), triceps | chest, lowerBack, lats, upperBack, deltoid, frontArm, forearm |
| Lat pulldown (back view) | lats, upperBack, deltoid (rear delts) | lowerBack, obliques, glutes, triceps, forearm, calves; hamstrings and adductors only in frames where the thigh isn't pointing at the camera |

The triceps pushdown is the stress case: one strong group among 13 faint ones.

#### 4.11.6 Drawing: one paint per pixel

- **The faint fill is opaque.** `guideStyleFromTokens` pre-composites the faint paint over `nearBody` (`compositeOver(paint, opacity, nearBody)`), and the op is drawn at opacity 1. Faint shapes from different ops can overlap without a darker sliver.
- **Muscle regions get an underlay.** Each muscle-region op (soft, then strong) is drawn over an opaque `nearBody` fill of its own path. Where a coloured region overlaps a faint neighbour, the colour sits on plain body, exactly as it does today. This also stops strong at 0.80 stacking on soft during the pulse (review N3), so §4.3's "never stacked opacity" now holds in every frame.
- **Order inside each body group:** contour → fill → **faint shapes (one op)** → soft (underlay, region) → strong (underlay, region) → shading → anatomical lines. Side-view glutes follow the pelvis regions (§3.11 step 8): faint glutes first, then the pelvis highlights. Shading still sits on top, so faint groups keep the figure's volume.
- **Budget:** at most one faint op per region group (6) and one underlay per region op. Today's 32–73 ops per frame grow by fewer than 20, inside the 220 limit.
- Faint ops are fills only, never stroked.

#### 4.11.7 States and settings

| State or setting | Faint shapes | Muscle colour |
|---|---|---|
| Playing, inside or outside the work phase | Steady. Faint never pulses: it's anatomy, not effort | `neutral`: as §4.9 (strong 0.80 → 1.0, soft 0.36 → 0.50). `tint`: strong pulses, **soft stays at 0.45** |
| Paused, Finished, Key positions, poster | Steady, as drawn | As §8 |
| Reduce Motion (stills, opt-in `Play animation`) | Steady. Nothing changes, because faint never moves on its own | As §8 |
| Increase Contrast | `neutral` unchanged. `tint` draws as `neutral`, and the tint legend line goes | Soft 0.60 steady, so the gap to faint widens |
| Differentiate Without Color | `neutral` unchanged. `tint` draws as `neutral`. Faint shapes never get an outline, so the outline stays a strong-only cue | Strong regions outlined (§4.3) |
| Dark ↔ light, look A ↔ D | Re-bake. The composite follows the live tokens | As §8 |
| Entry lists no muscles, or entry unreadable | `neutral`: every group faint (the figure's own anatomy; no legend, as §8). `tint`: none (no violet without the entry) | None |
| S tier (thumbnails) | None (`definitionCompact` for review only) | As now |
| Full screen | As the card (M/L tier) | As the card |
| Far-side limbs (side view) | None | None |
| `off` | None. Frames are identical to today's | As now |
| Workout resting or paused, offline, AI unavailable | No change | No change |

#### 4.11.8 Legend and copy

- **`neutral`: no legend change.** Faint shapes carry no exercise-specific meaning, like the contour lines, so the legend keeps explaining the one coded thing, the violet. The canvas VoiceOver label is unchanged ("Highlighted muscles are listed below.").
- **`tint` only:** one line after `Also works:` and before `Not shown…`, reading `Faint violet: other muscles, for reference`. It uses `type.callout` in `text.secondary`, with **no swatch** (a third violet swatch would be one more amount to compare). VoiceOver reads "Faint violet: other muscles, for reference." The line shows only while tint is actually drawn: not under Increase Contrast or Differentiate Without Color, and not without the entry.
- **Words not to use** for faint groups (adds to §10): "inactive", "not used", "unused", "resting", "off", "a little", or any percentage or ranking.
- **Review page:** control label `Muscle definition`, segments `Off` · `Neutral (recommended)` · `Violet tint`. `(recommended)` goes once Ben decides B8.

How to card, `neutral` (390pt phone; the triceps pushdown, the stress case):

```
┌────────────────────────────────────────┐
│ Triceps pushdown              ✕ Done   │
├────────────────────────────────────────┤
│ ┌────────────────────────────────────┐ │
│ │ [Draft guide]       ⤢ Full screen  │ │
│ │┌──────────────────────────────────┐│ │
│ ││   ║                              ││ │ cable column
│ ││   ║         ◯                    ││ │ head: body tone
│ ││   ║        ░░▌                   ││ │ deltoid, upper back: faint ░
│ ││   ╟──────╮ ░█▌                   ││ │ triceps: strong █
│ ││   ║      ▐░░▌                    ││ │ chest, abs, obliques, lats,
│ ││   ║       ░░▌                    ││ │ lower back: faint ░
│ ││   ║      ▐░░░▌                   ││ │ glutes, quads, hamstrings:
│ ││   ║       ░ ░                    ││ │ faint ░; calves faint ░
│ ││ - - - - -▟▙▟▙- - - - - - - - - - ││ │
│ │└──────────────────────────────────┘│ │
│ │ [ ❚❚ Pause    ] [ ▥ Key positions ]│ │
│ │ ● Feel it most: Back of upper arms │ │ legend unchanged
│ │   (triceps)                        │ │
│ └────────────────────────────────────┘ │
│ ┌────────────────────────────────────┐ │
│ │ What not to do                     │ │
```

`tint` adds one legend line:

```
│ │ ● Feel it most: Back of upper arms │ │
│ │   (triceps)                        │ │
│ │ Faint violet: other muscles, for   │ │ text.secondary, no swatch
│ │   reference                        │ │
```

#### 4.11.9 Draw option, app setting and review page

```ts
type MuscleDefinition = 'off' | 'neutral' | 'tint';

interface FrameOpsOptions {
  // …existing options
  /** Faint shapes for every muscle group the view can show (§4.11). Default 'off'. */
  definition?: MuscleDefinition;
  /** Review only: draw definition at the S tier too. Default false. */
  definitionCompact?: boolean;
}
```

- **`effectiveDefinition(mode, { tier, definitionCompact, increaseContrast, differentiateWithoutColor, hasMuscles })` → `MuscleDefinition`** is the one place the §4.11.5 and §4.11.7 rules live: `tint` becomes `neutral` under Increase Contrast or Differentiate Without Color, `tint` becomes `off` without the entry, and anything becomes `off` at the S tier unless `definitionCompact` is set. `frameOps` and the legend both use it.
- **`frameOps` defaults to `'off'`,** so existing callers, tests and the SVG/Skia match are unchanged until a caller opts in.
- **App:** `MUSCLE_DEFINITION` in `apps/mobile/src/guide/player-model.ts`, beside `MUSCLE_PULSE`, set to `'neutral'` (recommended) until Ben decides B8. There is no in-app setting, as with the pulse. The bake cache key gains the effective mode.
- **`guide:render`:** `--definition=off|neutral|tint` (default: the app's value) for `preview.png` and `--frames`, and `--definition-compact` for the thumbnail sheet. It always writes **`preview-definition.png`**: the key positions at 240pt in three pairs of rows (off, neutral and tint, each dark and light) at 3×, plus the first key position at 400pt in each mode. The 10 guides are re-rendered and stay `Draft`.
- **Web review page:** a segmented control `Muscle definition: Off · Neutral (recommended) · Violet tint` that applies to every guide on the page, plus a `Thumbnails too` checkbox (`definitionCompact`). It changes only the review render, never the app.

#### 4.11.10 Data needed

All pure, in `@fizz/catalogue` `src/figure/` and `apps/mobile/src/guide/`. Nothing reads or writes Ben's data (Coaching knowledge only, rule 10).

| Function / constant | Contract |
|---|---|
| `DEFINITION_GROUPS` | The 16 group ids in §4.11.3 |
| `DEFINITION_MAP` | `Record<DefinitionGroup, { replacedBy: Muscle[]; side, front, back: RegionSpec[] \| null }>`, parsed with `parseRegion`. A test fails on an unparsable cell or a vocabulary muscle missing from every `replacedBy` |
| `definitionGroupsFor(view, focus \| null, hidden)` → `DefinitionGroup[]` | The faint groups after the replace and hide rules (§4.11.5). Unit-tested against the §4.11.5 table |
| `definitionShapes(body, groups)` → `{ group: RegionGroup; contour: Vec[] }[]` | Per-frame geometry, using the §4.4 builders. Near side only in a side view, both sides otherwise. Projection rule applies |
| `effectiveDefinition(...)` | §4.11.9 |
| `DEFINITION_OPACITY` | `{ neutral: { dark: 0.25, light: 0.18 }, tint: { dark: 0.18, light: 0.18 } }` (design-system `guide.definitionOpacity`, `guide.definitionTintOpacity`) |
| `DEFINITION_GROOVE` | 0.006 H target, 0.004 H test floor (`guide.definitionGroove`) |
| `guideStyleFromTokens(tokens, scheme)` | Adds two opaque, derived paints: `faintNeutral` = `compositeOver(definition, 0.25 \| 0.18, nearBody)` and `faintTint` = `compositeOver(muscle, 0.18, nearBody)` |
| `frameOps(pose, {…, definition, definitionCompact})` | Faint op and underlays per §4.11.6 |
| `buildHowToView(...)` | `focus` gains `definitionNote: string \| null` (the tint line, or null) |
| `guide:check` | Groove and overlap check, pop warning, and the faint group list per guide in `meta.json` |

#### 4.11.11 Acceptance checks

Code and tests:

- **D1.** `DEFINITION_MAP` matches §4.11.3, including the `—` cells. Every cell parses, and each of the 23 vocabulary muscles is in at least one `replacedBy` list.
- **D2.** At every key frame of the 10 guides, every faint shape lies inside its segment outline with the 0.0035 H inset. Within each body group, no two faint shapes overlap, and their closest distance is ≥ 0.004 H.
- **D3.** `definitionGroupsFor` gives the §4.11.5 table for the 10 guides. The triceps pushdown has 13 faint groups and only `triceps` coloured. The split squat has no faint `abs` or `obliques`.
- **D4.** The contrast floors in §4.11.2 hold for both modes, both looks and both schemes. Direction: the neutral faint composite is further from `bg.surface` in luminance than the body, and both violet composites are nearer to it.
- **D5.** With `definition: 'off'`, every frame's SVG is byte-identical to today's, for all 10 guides.
- **D6.** One paint per pixel: in `neutral` and `tint` renders, pixels inside coloured regions match the `off` render within 1 per channel. Where faint shapes from different body groups overlap, the pixel equals the faint composite (no darker sliver).
- **D7.** Faint ops have the same paint and opacity in every frame. In `tint`, soft opacity is 0.45 in every frame, and strong still pulses.
- **D8.** Under Increase Contrast or Differentiate Without Color, `tint` renders identically to `neutral`. With no entry, `tint` draws no faint shapes and `neutral` draws every group.
- **D9.** Side views draw no faint shape on far limbs. Front and back views draw both sides whatever `focus.side` says.
- **D10.** The S tier draws no faint shapes unless `definitionCompact` is set, so `preview-thumbs.png` is unchanged.
- **D11.** No frame exceeds 220 ops with definition on. The SVG vs Skia match holds with definition on, at the §12.1 #9 thresholds. No faint op has a stroke.

How to screen:

- **D12.** `neutral`: the legend and canvas label are unchanged. `tint`: `Faint violet: other muscles, for reference` appears after `Also works`, with no swatch, and VoiceOver reads it. It is absent under Increase Contrast and Differentiate Without Color.
- **D13.** No copy on How to says "inactive", "not used", "unused" or "resting".

Review page (Ben and the reviewer):

- **D14.** `preview-definition.png` exists for all 10 guides, and the review-page control switches every guide between `Off`, `Neutral` and `Violet tint`.
- **D15.** At 240pt in both schemes, each figure reads as a body with muscle groups: shoulders, chest, arms, abs, back, glutes, thighs and calves can be told apart. Strong > soft > faint is obvious without reading the legend, in both modes.
- **D16.** Nothing looks mottled. Each faint group is one smooth shape, the grooves are even and quiet, and no shape flickers or pops during playback.
- **D17.** On the triceps pushdown, the eye lands on the triceps first.

On Ben's iPhone: **G18** (§12.4).

---

## 5. What not to do, and Feel it in

### 5.1 `What not to do` card (`AvoidList`)

- **Placement:** a card directly below the player card (§2.1). Without a guide, it comes after the muscle lines.
- **Content:** the entry's `cues.faults`, in catalogue order (most important first), all of them (the catalogue rules allow 2–4). Each row: `xmark` icon (`text.secondary`, decorative for VoiceOver) + text in `type.body`, `text.primary`, wrapping, never truncated.
- **Heading: `What not to do`**, using Ben's own words. Not `Avoid`: with lines that start with "Don't", "Avoid: Don't…" reads as a double negative.
- **No status colour.** It's reference, not a warning state (`status.warning` means pain or a problem now). Prominence comes from its position and the card frame.
- **Replaces `Common mistakes`**, which used the same data. Nothing is shown twice.
- Without faults in the entry, there is no card.

### 5.2 Catalogue copy change (for `exercise-researcher`)

**Yes: rephrase `cues.faults` as `Don't …` instructions.** A noun phrase ("Heels or toes lifting") describes a fault. An instruction tells Ben what to do with it, reads the same in the How to card as it would if the coach quoted it, and matches the imperative style of the other cues.

Rules:

- Start with `Don't`, in the second person ("your"). Name the visible error. At most 60 characters. 2–4 items, **most important first**: index 0 is the top fault, which a later wrong-form frame (§6) would use.
- Plain words. No diagnosis, no blame ("lazy", "bad"), no "never", and nothing alarming. Fixes belong in `execution`, not here.
- When reordering, update the indexes in `sources[].supports` (e.g. `cues.faults[0-3]`) to match.
- Until an entry is rewritten, the card shows its faults as they are. Under the heading `What not to do`, a noun phrase still reads correctly.

Examples from current entries:

| Entry | Now | Rewritten |
|---|---|---|
| Back squat | Heels or toes lifting | Don't let your heels or toes lift |
| Back squat | Hips rising faster than the chest | Don't let your hips rise faster than your chest |
| Lat pulldown | Pulling the bar behind the neck | Don't pull the bar behind your neck |
| One-arm row | Twisting the torso to lift the weight | Don't twist your torso to lift the weight |
| Romanian deadlift | Lower back rounding to reach lower | Don't round your lower back to reach lower |
| Bench press | Bouncing the bar off the chest | Don't bounce the bar off your chest |
| Triceps pushdown | Letting the stack yank the hands up | Don't let the stack yank your hands up |

### 5.3 `Feel it most:` / `Also works:` (`MuscleFocusLegend`)

Lives in the player card under the controls (§2.1).

| Line | Content | Swatch (decorative) |
|---|---|---|
| `Feel it most:` | Primary muscles, plain names | ● filled circle 12pt in `guide.muscle`, shown when at least one listed muscle is drawn |
| `Also works:` | Secondary muscles; the line is absent when there are none | ◐ 12pt circle, `guide.muscle` at 0.45 fill with a 1pt `guide.muscle` ring, so it differs from ● in shape as well as tone |
| `Not shown from this side:` (or `…from the front:` / `…from behind:`) | Short names of listed muscles not drawn (§4.7); they also stay on their own line above | none; `text.secondary` |

Text: `type.callout`, label word in `text.primary` semibold, list in `text.primary`, wrapping. The first item is capitalised and the rest are lowercase, joined with `, `.

**Plain names** (a typed table in `@fizz/catalogue`, `musclePlainLabel`). The plain words come first and the gym term follows in brackets, unless they're the same word. Muscles that share a plain phrase are merged (`front of upper arms (biceps, brachialis)`).

| id | In lists | Short (Not shown line) |
|---|---|---|
| `abductors` | outer hips (abductors) | outer hips |
| `abs` | abs | abs |
| `adductors` | inner thighs (adductors) | inner thighs |
| `biceps` | front of upper arms (biceps) | front of upper arms |
| `brachialis` | front of upper arms (brachialis) | front of upper arms |
| `calves` | calves | calves |
| `chest` | chest | chest |
| `core` | core | core |
| `forearms` | forearms | forearms |
| `front_delts` | front of shoulders (front delts) | front of shoulders |
| `glutes` | glutes | glutes |
| `grip` | grip | grip |
| `hamstrings` | back of thighs (hamstrings) | back of thighs |
| `lats` | sides of upper back (lats) | sides of upper back |
| `obliques` | sides of waist (obliques) | sides of waist |
| `quads` | front of thighs (quads) | front of thighs |
| `rear_delts` | back of shoulders (rear delts) | back of shoulders |
| `side_delts` | side of shoulders (side delts) | side of shoulders |
| `spinal_erectors` | lower back (spinal erectors) | lower back |
| `traps` | top of shoulders (traps) | top of shoulders |
| `triceps` | back of upper arms (triceps) | back of upper arms |
| `upper_back` | upper back | upper back |
| `upper_chest` | upper chest | upper chest |

The Muscle **filter** chips (exercise-library §2.3) keep their group words (`Quads`, `Back`…). This table is for How to only.

---

## 6. Wrong-form ghost frame (proposal only): **not now**

**Recommendation: no in v2.** Revisit only if Ben asks for it after a couple of weeks of using v2 on his phone.

Reasons:

- **A wrong pose can be learned at a glance.** In a thumbnail or a quick look between sets, the eye takes in shapes, not captions. Every catalogue entry's `guideBrief.doNotShow` currently forbids drawing exactly these faults (rounded lower back, knees caving in…). The research made that call on purpose (users treat demos as authoritative, research §2).
- **It doubles authoring and review.** Each ghost is a second pose that Ben must approve. The ROM checks exist to *block* bad spines, so they would need sanctioned exceptions.
- **The text already does the job.** `What not to do` sits right under the player, and Ben asked for "what NOT to do **as text**".
- **Many top faults can't be seen in the guide's view.** Knees caving in and torso twisting can't be shown in a side view.

**If Ben wants it later, design it like this:** only for a top fault (`cues.faults[0]`) that is visible in the guide's view and clearly different from correct form (Romanian deadlift back rounding, bench hips lifting, overhead-press lean-back). Show it **only in the Key positions view**, as one extra still after the last position, labelled in app text `✕ Not like this: Don't round your lower back to reach lower`. Never in the animation, never autoplayed, never in a thumbnail. Draw the wrong pose as a dashed `farBody` outline with no fill and no muscle colour, beside a faint copy of the correct key position. It needs a per-entry `wrongForm` exception to `doNotShow` that Ben approves.

---

## 7. Quality and rendering

### 7.1 What "higher quality" means here

Guides are vector: Skia replays recorded pictures at the device's scale, so **resolution isn't the problem** in the app. What Ben saw was:

1. **The review sheet was 1×.** `guide:render` draws each frame at 240 px (`PX = 240`). On a phone, a 240pt canvas is 720 px at 3×. The review page showed a third of the app's sharpness. **This is the biggest fix and the cheapest one.**
2. **Shape.** Capsule limbs, a circle head and blocky feet read as a pictogram. That's §3.
3. **Polygon outlines.** `capsuleOutline` uses 10 steps per end cap. Joined polylines show facets at 300pt and above.
4. **Flat fill.** No volume (§3.7) and no inner structure (§3.8).

### 7.2 Render changes

| Change | Detail |
|---|---|
| **Smooth paths** | `DrawOp` `path` gains `smooth: true`: the renderers emit cubic Béziers (centripetal Catmull-Rom through the points; SVG `C`, Skia `cubicTo`). All body outlines, regions and pads use it |
| **Gradient fill** | `DrawOp` `path` gains an optional `gradient {from, to, stops[{at, paint, opacity}]}` for shading (§3.7). resvg supports `linearGradient`; Skia uses `LinearGradient`. The pixel-match test covers it |
| **Anti-aliasing** | Every Skia paint sets `antiAlias: true` explicitly. The player draws the recorded `SkPicture` straight onto the canvas at device scale, **never** through an image snapshot or offscreen bitmap (check `bake.ts`/`GuidePlayer.tsx`). resvg keeps `shape-rendering` at its default (geometric precision) |
| **Joins and caps** | Round joins and round caps on every stroke except the floor (butt, as now). No mitres |
| **Stroke floors** | Strokes are `max(STROKE.x × k, floor)`, with floors per tier (§3.10). New `STROKE.contour = 0.0035` |
| **Per-frame intensity** | `frameOps(pose, {…, focus, intensity, tier})`. Muscle paint opacity = level × intensity (§4.9) |
| **Paints** | `Paint` gains `muscle` and `shade`. `GUIDE_PAINT_TOKENS` maps them to `guide.muscle` and `guide.shade` (§4.2). `accent` and `status.*` are still never paints |
| **Camera aspect** | `fitCamera(prepared, aspect = 1, margin = 0.06)` for Full screen (margin 0.04). It's precomputed into `src/generated/guide-files.ts` for 1:1 and for 9:16 as a starting point; other aspects are fitted on open (one sample pass, off the UI thread) |
| **Bake cache** | The key gains `tier`, `focusHash`, `steady` (stills vs animation) and `aspect`. The cache stays at 4 entries per session; Full screen adds at most 1 |
| **Performance budget** | Per frame at M/L tier: ≤ 220 ops. Full bake of a 90-frame guide on Ben's iPhone: ≤ 1.5 s, in ≤ 8 ms slices as now, with the poster frame first. Measured in G14 |
| **Review renderer** | `guide:render` writes `preview.png` at **3×** (each frame 720 px), dark and light, plus `preview-thumbs.png`: the key positions at S tier, 115pt @3× (the 3-up size on a 375 phone). `--frames` writes 30 fps frames at 2× of 400pt. The web review page shows each guide at ≥ 400 CSS px wide, with frames rendered for the screen's `devicePixelRatio`, and offers a single-guide large view |

### 7.3 Larger player

- Card canvas: fills the card's width, max **400pt** (was 360pt with inner padding). 350pt on a 390 phone, 390pt on a 430 phone.
- Full screen with a portrait canvas (§2.2). This is the real gain for standing exercises.
- The minimum stays at 200pt. Legibility is checked at 240pt (G5) and at 115pt for thumbnails.

---

## 8. States

v1 states (exercise-library.md §8.4) all still apply. Additions and changes:

| State | Shows |
|---|---|
| Entry has primary and secondary muscles, all drawable | Strong and soft regions; legend with ● and ◐ lines; no `Not shown` line |
| Some listed muscles not drawable in this view, or hidden by the guide | They aren't drawn but stay in their `Feel it most` / `Also works` list; `Not shown from this side: …` line names them too |
| No listed muscle drawable | No colour on the figure; legend lines **without swatches**, plus the `Not shown` line |
| Entry lists no muscles (custom or incomplete) | No legend and no colour |
| No guide, rich cues only | Legend lines without swatches under the header; `What not to do` card; the rest of the cues |
| Guide unreadable, entry readable | v1 notice; legend lines without swatches; `What not to do`; cues |
| Entry unreadable, guide readable | Figure with **no muscle colour** (no source of truth); v1 P7 notice; no legend, no card |
| Faults empty | No `What not to do` card |
| Faults not yet rewritten | Shown as written, under `What not to do` |
| Playing, inside the work phase | Strong regions at 1.0, soft at 0.50 |
| Playing, outside the work phase | Strong at 0.80, soft at 0.36 |
| Paused | The frame held exactly, including its intensity |
| Finished (after 3 passes) | Steady poster frame (key position 1, steady colour) with `Replay` |
| Key positions view | Steady colour (1.0 / 0.45) |
| Reduce Motion on | Key positions view, steady colour. Opt-in `Play animation` plays **without** emphasis |
| Increase Contrast on | Steady colour (1.0 / 0.60), contour opacity 0.7 |
| Differentiate Without Color on | Strong regions get a 1pt `text.primary` outline at 0.6 |
| Dark ↔ light switch | Recolours live (re-bake). Muscle hue switches between the dark and light values |
| Full screen open | §2.2, same player state; off-screen rules apply (the How to player underneath is covered, so it's paused) |
| Full screen + Reduce Motion | Key positions view, at full-screen size |
| Workout resting / paused, offline, AI unavailable | No change (v1). Rest alerts fire as usual |

Transitions added to §8.4's diagram:

```
How to ─⤢ Full screen─► Full screen (same frame, state, pass count)
Full screen ─Done / swipe down─► How to (state handed back)
Playing ─enter workPhase─► emphasis up (baked) ─leave─► emphasis down (baked)
any ─Reduce Motion on─► Key positions, steady colour
```

---

## 9. Interactions

- **`⤢ Full screen`**: a text button with a leading icon (`arrow.up.left.and.arrow.down.right`), `type.label` in `accent`. The icon is its tappable affordance, which look D needs because its accent is close to body text (`linkAffordance: 'chevron'`). It is a link-style control outside the canvas, so `accent` is allowed here. 44 × 44 hit area, at the top right of the player card, on the same row as the `Draft guide` tag. Opens §2.2 as a `fullScreen` modal. Hidden when there is no guide.
- **Full screen:** `Done` (top right, `xmark` + word) or swipe down to close. The controls behave as on How to. There are still **no gestures on the canvas**: no pinch, tap or scrub, so a sweaty brush can't change anything.
- **Legend and `What not to do`:** static text, not tappable. Swatches are decorative.
- **Keyboard:** none. **Voice:** none. The guide stays silent and doesn't touch the audio session. The coach may quote `What not to do` lines and muscle names (they're the same catalogue text) but must not claim to show the figure.
- **Haptics:** none. **Undo:** nothing to undo, because nothing changes data.
- **VoiceOver order:** header → `Draft guide` → `Full screen` → canvas (one image) → play control → `Key positions` → legend lines (each one element) → `What not to do` heading → each item → Key positions → Setup → How to do it → Safety.

---

## 10. Copy

All reference text (Coaching knowledge). No loads, targets or actuals appear on these screens.

| Element | Text |
|---|---|
| Full screen button | `Full screen` (icon-led text button, `accent`; VoiceOver: "Full screen guide"); close `Done` |
| Legend, strong | `Feel it most:` + list, e.g. `Feel it most: Front of thighs (quads), glutes` |
| Legend, soft | `Also works:` + list, e.g. `Also works: Back of thighs (hamstrings), lower back (spinal erectors), core` |
| Not shown | `Not shown from this side: inner thighs` · `Not shown from the front: upper back, back of shoulders` · `Not shown from behind: front of upper arms` |
| Avoid card | Heading `What not to do`; items from `cues.faults`, e.g. `Don't let your heels or toes lift` |
| Canvas VoiceOver label | `Exercise guide for Back squat. <a11y.summary> Highlighted muscles are listed below.` (P4 wording plus one sentence. The list itself isn't repeated, because it's the next element) |
| Legend VoiceOver | "Feel it most: front of thighs, quads, and glutes." · "Also works: …" · "Not shown from this side: inner thighs." Swatches are hidden |
| Avoid VoiceOver | Heading "What not to do"; each item read as written ("Don't let your heels or toes lift") |
| Full screen VoiceOver canvas | Same label as the card canvas |

Words not to use: "activate", "target zone", "burn", "pump", any percentage or score for a muscle, "inactive", "unused", "not used" or "resting" for a faint muscle group (§4.11.8), "pain" or "injury" on this screen (Safety's `Stop the set if:` excepted), and "correct/incorrect form" (say "Don't …").

Spoken cues: none. The guide is silent.

---

## 11. Data needed

All pure, in `@fizz/catalogue` (`src/figure/`, `src/muscles.ts`) and `apps/mobile/src/guide/`. No session, history, gym, coach or provider function is called. Opening How to reads and writes nothing about Ben.

| Function / constant | Contract |
|---|---|
| `ADULT_V1_PROFILES` | Side and front/back profiles (§3.3–3.4), typed per segment |
| `MUSCLE_REGION_MAP` | §4.5, keyed by `Muscle`; a test requires one row per vocabulary muscle |
| `ANATOMY_LINES` | §3.8 |
| `muscleFocusFor(entry, guide \| null)` → `MuscleFocus` | `{strong: Muscle[], soft: Muscle[], drawn: Muscle[], notShown: Muscle[], side, workPhase}`. Applies `grip` capping, `core` expansion, overrides and validation. Pure; unit-tested on the 10 entries |
| `musclePlainLabel(m)`, `muscleShortLabel(m)`, `formatMuscleList(ms)` | §5.3 table and merge rule |
| `buildHowToView(...)` (extended) | `HowToView` gains `focus: MuscleFocusView \| null` (`{most, also, notShown, swatches: boolean}`), `avoid: string[]` (replaces `mistakes`) and `fullScreenAvailable` |
| `regionShapes(pose, focus, view, camera)` → `Shape[]` | §4.4 geometry, per frame |
| `workIntensityAt(prepared, t)` → 0–1 | §4.9 ramps; 1 when steady |
| `frameOps(pose, {px, camera, trace, tier, focus, intensity})` | §3.11 order, §7.2 ops |
| `fitCamera(prepared, aspect, margin)` | §7.2 |
| `guideStyleFromTokens(theme)` | Adds `muscle` (the `guide.muscle` value for the scheme) and `shade` |
| `guide:check` | Adds focus validation (§4.8), visible-area warnings (§4.7), v2 collision outlines, and the focus table in `meta.json` |
| `guide:render` | 3× preview, thumbnail sheet, `--frames` at 2× (§7.2) |

---

## 12. Acceptance checks

Muscle definition has its own checks, D1–D17 in §4.11.11, plus G18 below.

### 12.1 Code and tests (developer and reviewer)

1. Every one of the 23 vocabulary muscles has a `MUSCLE_REGION_MAP` row for side, front and back (a region or an explicit `—`). The test fails on a missing muscle.
2. For each of the 10 rich entries, `muscleFocusFor` gives strong = `primaryMuscles` and soft = `secondaryMuscles`, every listed muscle included whether drawn or hidden (§4.7), with `notShown` matching the §4.5 coverage table plus any `focus.hide` muscles, in listed order (`adductors` for squat, Romanian deadlift and leg press; `adductors, core` for the split squat, whose guide hides `core`). A hidden secondary muscle stays under `Also works` and is also on the `Not shown` line.
3. A `focus.add` or `focus.hide` naming a muscle the entry doesn't list fails `guide:check`.
4. No guide pixel uses `accent` or any `status.*` value, in either look or scheme. The only non-neutral paint is `guide.muscle` (extends the existing `GUIDE_PAINT_TOKENS` test).
5. Contrast floors (§4.2) hold for both looks and schemes: strong on canvas ≥ 3:1, strong vs near body ≥ 2:1, soft composite vs near body ≥ 1.4:1.
6. Muscle regions lie inside their segment outline with the 0.0035 H inset, at every frame of every guide (geometry test).
7. Side-view guides colour no far-side limb. The split squat colours only the front (near) leg's thigh and shank regions.
8. With Reduce Motion, in key-position stills, under Increase Contrast and for guides without `workPhase`, muscle opacity is constant across frames (1.0 / 0.45, or 0.60 for soft under Increase Contrast).
9. SVG and Skia renders still match to within 0.01% of pixels for all 10 guides, both schemes, M/L tier, including gradients and smooth paths.
10. `guide:check --all` passes with v2 outlines (re-authoring where needed). Each guide's file stays ≤ 8 KB.
11. At the M/L tier, no frame of any guide exceeds 220 draw ops.

### 12.2 How to screen

12. On a 390 × 844 phone at default text size, the `What not to do` heading and its first two items are visible without scrolling. On 375 × 667, the heading and first item are.
13. The header no longer shows `Main muscles:`. The legend shows `Feel it most:` (and `Also works:` when there are secondaries) with plain names. For lat pulldown seen from behind, it shows `Not shown from behind: front of upper arms` (in the front view it would be `Not shown from the front: upper back, back of shoulders`).
14. `Common mistakes` is gone, and the same faults appear once, under `What not to do`, in catalogue order.
15. At AX3 on 375pt, legend lines and `What not to do` items wrap with no truncation; the canvas stays ≥ 200pt; the controls stack.
16. `Full screen` opens a portrait canvas in which the squat figure is visibly larger (≥ 1.4× the card's figure height). Closing returns to How to on the same frame and playing/paused state.
17. VoiceOver reads the canvas once (with "Highlighted muscles are listed below."), then the legend lines, then `What not to do` and its items. No swatch or `xmark` is announced.
18. No canvas gesture does anything, on How to or in Full screen.

### 12.3 Review page (Ben and the reviewer)

19. Previews are rendered at 3×. At full size, outlines are smooth curves with no visible facets.
20. Each guide looks like a person (shoulders, chest, glutes, thighs and calves have shape) while staying clean: no face, no text, no fingers.
21. Coloured regions sit on the right muscles in every key position: quads and glutes on the squat, hamstrings and glutes on the Romanian deadlift, chest on the bench press, front shoulders on the overhead press, lats and upper back on the row, triceps on the pushdown.
22. The thumbnail sheet (115pt @3×) still reads: pose, implement and strong muscle colour are recognisable, and nothing becomes mush.
23. Dark and light both look calm. The violet reads as "muscle", not as an error, pain or a button.
24. Equipment detail (plate rims, bench pads, stack plates and pin) is visible, but the figure still reads first.

### 12.4 On Ben's iPhone (extends device-tests/guide-playback.md)

- **G11 Legibility:** at 240pt, 350pt and in Full screen, in bright gym light and in a dim room, Ben can say where the strong colour is without reading the text.
- **G12 Highlight hue:** in both schemes, violet doesn't look like a warning, a link or a selected state. If it does, try `#6E56CF` / `#8E7CF0` before changing the hue.
- **G13 Emphasis:** over 3 passes, the work-phase emphasis is noticeable but not distracting. If Ben finds it distracting, set it to steady.
- **G14 Bake time:** first frame at once; full bake ≤ 1.5 s per guide; no dropped frames during playback.
- **G15 Battery:** 5 minutes on How to during a rest uses no more than v1 did (same off-screen pause rules).
- **G16 Accessibility:** VoiceOver order per §9; Reduce Motion, Increase Contrast and Differentiate Without Color behave per §8.
- **G17 Rest unaffected:** with How to or Full screen open mid-rest, the rest alert arrives on time, as in G4.
- **G18 Muscle definition (§4.11):** at 240pt, 350pt and in Full screen, in bright gym light and in a dim room, Ben can make out the muscle groups and still finds the strong colour first. He compares `neutral` and `tint` (and `off`) on the triceps pushdown and the squat, and picks B8. If the groups run together, widen the grooves before adding lines (§4.11.4).

---

## 13. Decisions for Ben

| # | Question | Recommendation |
|---|---|---|
| B1 | Highlight colour: violet (`#7A4AF0` / `#9B7BF7`) | Yes. Every other hue already means something in the app, and red or orange on a body reads as pain |
| B2 | Work-phase emphasis (subtle opacity rise while lifting) | Yes, subtle. Off under Reduce Motion. Revert to steady if G13 finds it distracting |
| B3 | Redraw the lat pulldown from behind | Yes. The main muscles are on the back |
| B4 | Rewrite catalogue faults as `Don't …` and use the heading `What not to do` | Yes |
| B5 | Soft shading on the figure | Yes, if the v2 previews look calm to him. It can be switched off without other changes |
| B6 | Wrong-form ghost frame | Not now (§6) |
| B7 | Optional rack with safety arms in the squat guide | Guide-maker's call. Show it in the preview and let Ben choose |
| B8 | Muscle definition for every group (§4.11): `neutral` (a faint tone of the body), `tint` (faint violet, his literal ask) or `off` | `neutral`. It keeps strong > soft > faint apart by hue and by lightness, and violet keeps one meaning ("this exercise works it"). Faint violet would read as "works a little", which the catalogue doesn't claim. Compare all three on the review page and on device (G18) |

---

## 14. Build slices and hand-offs

Thin slices. Each one renders previews for Ben to review. **Don't start until the developer has finished the current apps/mobile review fixes.**

1. **Render quality (developer, catalogue only):** 3× `guide:render`, thumbnail sheet, smooth paths, stroke floors, tiers. No art change yet, so it's a quick win Ben can see.
2. **Silhouettes (developer, then guide-maker):** profiles, trunk as one shape, hands, feet, head, v2 separation; `guide:check` on v2 outlines; re-tune guides.
3. **Muscle focus (developer):** map, regions, `muscleFocusFor`, tokens, legend in How to, `focus` schema. **Exercise-researcher in parallel:** rewrite `cues.faults` for the 10 rich entries (§5.2).
4. **Avoid card and order (developer):** §2.1 layout, `What not to do`, header change.
5. **Shading, contours and equipment detail (developer, then guide-maker).**
6. **Full screen (developer).**
7. **Pulldown from behind (guide-maker),** if B3 is approved.
8. **Muscle definition (developer, then guide-maker):** `DEFINITION_MAP`, `effectiveDefinition`, the faint paints, the underlays (which also fix review N3), the `definition` option, `preview-definition.png` and the review-page control (§4.11). The guide-maker then tunes grooves on the renders. The app ships `MUSCLE_DEFINITION = 'neutral'` until Ben decides B8.

Agent notes:

- `exercise-guide-maker`: its definition still says "one accent for the moving limb or bar path" (flagged in ADR 0011). It should now say: neutral aliases plus `guide.muscle` for muscle regions only, never `accent`.
- Research §5.5 ("Working muscles are not colour-highlighted in v1") and ADR 0011's colour line are superseded for the muscle highlight only, by this spec and Ben's 9 Oct request. The developer should note this in an ADR 0013 amendment, or a short new ADR, when slice 3 lands, because it changes a recorded rule.
