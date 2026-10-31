# Review: guide motion (ADR 0015, ADR 0017 rounds 2 to 4) and muscle definition (guides v2 §4.11)

**Verdict: CHANGES NEEDED.** There are two blockers.

- **B1** is carried over from the guides v2 review: the lat pulldown's static bar-path trace is still drawn over the head and neck. It was never fixed and isn't tracked anywhere.
- **B2:** the per-frame bake now costs about 3× what it did at `45e6059`. Measured without a JIT (the closest proxy for Hermes), a 90-frame guide needs roughly 3 s of JS before playback can start. G14's budget is 1.5 s.

The motion work itself is careful. The spline and KKT maths is right, the guard is a sufficient monotonicity condition, and key poses are exact. Phase timing, E5 turns and the E7 leg drive are well tested, including a 1000-case random property test. All 10 guides pass `guide:motion` inside `npm run check`, and the previews are fresh.

Reviewed on branch `claude/gracious-knuth-joxqpw`, `45e6059..HEAD` (114 commits). Scope is the guide motion and muscle-definition commits: `packages/catalogue/src/figure/*`, `scripts/guide-*.ts`, `guides/*`, `apps/mobile/src/guide/*` and their tests. The FitNotes import, core-finish and screen commits in the same range have their own reviews and were not re-reviewed. The uncommitted `docs/design/*` edits in the working tree were not reviewed either. Spec: `docs/design/exercise-guides-v2.md` §3, §4.11, §12 (G14, G18, D1–D16); ADR 0013, 0014, 0015, 0017; CLAUDE.md.

## Checks run

| Check | Result |
|---|---|
| `npm run check` (typecheck, lint, vitest, `catalogue:validate`, `guide:check --all --verify`, `guide:motion --all`) | **Pass** (exit 0). 98 files, 1317 tests. 133 catalogue files valid (1 known warning). 10/10 guides pass `guide:check`; warnings: OHP `definition` + `target-legible`, pulldown `definition`. 10/10 pass `guide:motion`; warnings: J6 reach on the squat, bench, OHP and RDL; sled J5 3.02× |
| `guide:render` for sled-push, back squat and lat pulldown, run in a scratch worktree at HEAD | Byte-identical to the committed PNGs |
| Per-frame bake cost: every guide × every playback frame, `bakeFrame` at 348 pt with the entry's muscles, plus `pathData(…, 5)`, bundled with rolldown | See B2. HEAD, neutral: **60.3 ops/frame (max 90, pulldown)**, ≤ 30 gradient ops. JIT: 4.9 + 3.9 ms/frame. `--jitless`: **23.9 + 9.3 = 33.2 ms/frame**, about 2.8 s per 84-frame guide. Base `45e6059` under `--jitless` on the same machine: 4.4 + 6.4 = 10.7 ms/frame (42.6 ops). Definition `off` at HEAD: 17.4 + 7.7 = 25.1 ms/frame |
| Jitless CPU profile of the HEAD bake (inclusive) | `pathData` 25%, `softenOver` (arm edges over the trunk, point-to-polygon distance per stroke point) 18%, body `widthsAt`/`profileAt` 19%, `definitionShapes` 13%, `shadeBands` 11%, `overlapsAny`/`polygonsWithin` 4% |
| Draw order of the pulldown trace (`bakeFrame` with the static trace at each key position) | Trace op at index 90–92, after the last `nearBody` fill (82–83), at x = 0 through the head (B1) |
| Node-only or Hermes-risky APIs in `packages/catalogue/src` and `apps/mobile/src/guide` | None. Spread `Math.hypot(...r)` in `minCurvatureSlopes` is fine (n ≤ 16) |

---

## Blockers

**B1. Lat pulldown from behind: the Key positions trace still runs over the back of the head (guides v2 review B1, open).**
- **Where:** `packages/catalogue/src/figure/draw.ts:707–710`. The trace is pushed after `emitLayer('body')`/`emitLayer('near')` for every view, including `seenFrom: "back"` (`legsFirst`, `draw.ts:682`). It reaches the app through `apps/mobile/src/guide/bake.ts:141–155` (steps bake). `cable-lat-pulldown/guide.json:51` still has `showIn: ["static"]`.
- **Failure path:** Ben opens How to › Lat pulldown with Reduce Motion on, or taps `Key positions`. Each position shows a dashed vertical bar path from y 0.97 down to 0.59 drawn over the back of the head and neck: the behind-the-neck path that `guideBrief.doNotShow` and the first `What not to do` item forbid. The guides v2 review raised this as its only blocker. None of the 114 commits since touch it, and no ADR, open-decisions entry or test records it as deferred.
- **Fix:** as the guides v2 review said. For back views, emit the trace with the mid props (before the trunk), or drop static overlays on back-view guides. Add a test that the trace op comes before the trunk `nearBody` fill when `seenFrom === 'back'`. Re-render the pulldown.

**B2. The bake is now about 3× the cost it was at `45e6059`. Every guide is likely to miss G14 (full bake ≤ 1.5 s) by about 2×, and each bake task blocks the JS thread for about 4 slices.**
- **Where:** `packages/catalogue/src/figure/draw.ts`.
  - `openStrokeOps` → `softenOver` (`:614–618`) runs a point-to-polygon distance for every arm-stroke point against every trunk contour, each frame.
  - `definitionShapes` and `overlapsAny` (`:559–582`).
  - Round-4 crease and fillet fills and the shade bands.
- Also `apps/mobile/src/guide/bake.ts:83`. It still rebuilds `opPathData` and Skia re-parses it for each op, at about 75 KB of SVG text per frame (was about 53 KB), about 6.3 MB per guide.
- **Measurements:** jitless, 33 ms/frame against 10.7 ms at the base on the same machine; about 2.8 s of figure maths per guide before Skia parses any path text. With definition `off` it is still 25 ms/frame, so round 3/4 drawing accounts for most of the growth, not only §4.11.
  - `runSliced` can't split a task (`sliced.ts:56`), so each 33 ms task overruns the 8 ms slice about 4×.
  - `frames` exists only when the bake is `done` (`GuidePlayer.tsx:180`). Ben looks at a still poster for the whole bake, and again on every new size, scheme, Increase Contrast or definition mode (cache of 4).
- **Why blocking:** G14 is the spec's only performance gate. ADR 0014 still lists bake time as "unmeasured". ADR 0017 adds a 60 fps bake (V6) with a *different* budget (≤ 2.5 s, see Spec issues). The guides v2 review already flagged the v2 bake as at risk (its S1), and this round tripled it without a measurement.
- **Fix:** any of these, then measure on the iPhone and record the number in ADR 0014/0017.
  1. Cache `softenOver`'s distance per point with a bounding-box reject before `pointSegmentDistance`, or soften by segment rather than by point.
  2. Memoise `groupContours`/`pathData` per contour within a frame; halo, contour and fill share them.
  3. Use 4 decimals for unit-size Skia path text (`draw-plan.ts:77`).
  4. Start the clock on the baked prefix instead of waiting for `done`.
  5. Lower the region and band sample counts.

  A device number under 1.5 s on Ben's iPhone also clears this.

## Should fix

**S1. The canvas still redraws at display rate (guides v2 review S2, open). Each redraw is now about 60–90 ops, with up to 30 gradient fills.**
- `apps/mobile/src/guide/GuidePlayer.tsx:198` assigns `frame.value` on every tick, and Reanimated's setter has no equality check. At 120 Hz the 30 fps picture is redrawn 4× per frame, which is a battery and dropped-frame risk (G14, G15) that grows with this round's op count.
- **Fix:** `const i = frameIndexAt(...); if (i !== frame.value) frame.value = i;`. The V5 cadence logic is unaffected.

**S2. When the player fails, the standalone legend still shows `Not shown from this side:` (guides v2 review S4, open). A new test now pins the wrong behaviour.**
- `apps/mobile/src/guide/how-to.ts:218` filters out only `definition` lines. `apps/mobile/test/guide-definition.test.ts:148` and `guide-isolation.test.ts:122` expect `['most','also','notShown']` with no figure on screen.
- **Fix:** also drop `notShown` in `standaloneLegend` and update both tests.

**S3. D16 ("no shape flickers or pops") is unverified, and `guide:check` warns about pops on two guides.**
- OHP warns `fold or fade away mid-cycle (check for a pop): forearm, frontArm (armNear)`, and the pulldown warns the same for both forearms (`meta.json` warnings `definition`).
- These are warnings only, so `npm run check` passes. No frame-strip review of those spans is recorded.
- **Fix:** add the OHP and pulldown frames around the flagged times to the G18 review sheet. Alternatively, make the faint-shape fade (like `projectionFade`) a test with a per-frame area-step limit.

**S4. The SVG↔Skia match with gradient definition ops (D11) isn't a committed test (guides v2 review S6, open).**
- Every faint shape is now a gradient op with `rgba()` stops (round 4). An unparsable stop turns black in RN Skia, and a null `MakeFromSVGString` silently drops an op. The committed tests check only the plan (`603ae7a`).
- **Fix:** commit the CanvasKit vs resvg harness on 3 frames × 10 guides × 2 schemes with definition `neutral`.

**S5. The OHP's only strong muscle is a 4 pt² sliver at `Forehead`** (`target-legible` warning: Start 10, Forehead 4, Lockout 12 pt² at 115 pt; floor 10). The check passes on the best key, but the guides v2 review S5 concern (front delts barely visible) stands. List it for G11.

## Nits

- **N1.** `HowToView.definitionNote` (`how-to.ts:106, 184`) is computed but never read. Remove it, or use it for the canvas label.
- **N2.** `packages/catalogue/src/figure/index.ts:24` re-exports `motion-metrics.ts` (1229 lines of tooling) into the app bundle. Through `how-to.ts` it is evaluated on the launch path. It's pure, with no top-level work beyond `MOTION_CONFIG`, but it is dead weight in the app. A `@fizz/catalogue/figure/tooling` entry would keep it out.
- **N3.** The `MotionConfig.allowance` doc (`motion-metrics.ts:51–53`) says an allowance is "a decision of Ben's recorded as config". The pulldown allowance is explicitly "the default until Ben picks". Say "pending Ben" in its `why`, so the report doesn't read as approved.
- **N4.** ADR 0017 "Not built yet" still says V4 waits for the uncommitted muscle-definition work. That work is committed, and round 4 (`4153145`) built the crease and fillet fills. Update the status.
- **N5.** The ◐ swatch still ignores Increase Contrast (guides v2 review N2): `MuscleFocusLegend.tsx:25` always uses `MUSCLE_OPACITY.soft`.
- **N6.** The look-ahead in `frameIndexAt` (`clock.ts:46`) can show frame 0 half a refresh early on the last tick of a pass. It's harmless, because the clock resets to 0 there, but a test comment would stop someone "fixing" it.
- **N7.** The row's Start dumbbell overlaps the bench pad (ADR 0017 says the overlap is real and leaves it to Ben). Keep it on the review sheet so it isn't lost.

## Verified OK

- **Interpolation maths:**
  - `minCurvatureSlopes`: the Hessian (8/h, 4/h) and the right-hand side 12d/h match ∫P''² for a Hermite cubic. Dependent constraints are dropped by Gram–Schmidt, so the KKT system can't be singular.
  - The guard caps each knot at 3× the smaller neighbouring secant, so every segment satisfies Fritsch–Carlson's α, β ≤ 3 box, which is sufficient for monotonicity.
  - Phase-mode Hermites use slopes in u and span in u. Zero velocity and acceleration at stops follow from u'(t) = u''(t) = 0.
  - `minimumJerkInverse` is a 60-step bisection.
- **Drive (E6/E7):**
  - `applyDrive` returns the authored state at key times, holds and outside phases.
  - `hipFromLeg` uses the same bend sign as `nearShinAndKnee`.
  - `pose-continuity` (0.002 H) passes on the squat, so FK at the keys matches the authored root.
  - The tests cover planted feet, seam and holds, and drive-miss.
- **Tests:** property tests (1000 random phases, never out of range, C2 except at reported kinks); bit-identical keys on every guide; seam C6; schema rejections; and metric fail cases (injected step, whip, undeclared excursion). The edge cases are tested, not just the happy path.
- **Playback cadence (V5):** forward 0…n−1 and back n…1 in a ping-pong, one interval each. Cycle indices are clamped. The `duration-grid` check is hard, and the bench is 2600 ms.
- **Skia isolation:**
  - The only new Skia surface is the existing `bake.ts` path (gradients inside tasks).
  - `player-model.ts` and `how-to.ts` import only pure `@fizz/catalogue/figure`.
  - The isolation tests pass.
- **Reduce Motion / Increase Contrast:**
  - Faint shapes are steady in every frame, and the pulse stays off under Reduce Motion and Increase Contrast.
  - `tint` falls back to `neutral` under Increase Contrast and Differentiate Without Color; `effectiveDefinition` is the one rule, and the bake cache key and the legend both use it.
  - The tint line is absent without the player.
  - No definition is drawn at the S tier.
  - Differentiate Without Color is hard-coded false, as documented.
- **Guide content (rendered key frames):**
  - Squat: front-loaded descent, heels down.
  - Bench: lower-chest touch, vertical forearm, elbow above the pad.
  - OHP: head through at lockout, lean-back declared at 6°.
  - RDL: neutral spine, 15 → 20° soft knee.
  - Row: pulls to the hip.
  - Sled: back to the round-3 stance.
  - All 10 guides stay `reviewStatus: "draft"`, and every pose change is marked for Ben.
  - Apart from B1, nothing unsafe is shown.
- **CLAUDE.md rules:**
  - Rule 1: everything is bundled and offline.
  - Rule 6: no invented data; the muscles come from the sourced entry.
  - Rule 9: the violet doesn't read as pain.
  - Rule 10: guides and definition stay in Coaching knowledge (`@fizz/catalogue`) and read nothing about Ben.
  - No secrets, network calls or `console.*` in the diff.

---

## Spec issues

- **Two bake budgets.** exercise-guides-v2 §12 G14 (and line 914) says full bake ≤ 1.5 s per guide. ADR 0017 V6 says "full bake ≤ 2.5 s" and "first frame ≤ 1.0 s", where G14 says the first frame shows at once. Ben or the designer should pick one before B2 is measured against it.
- **§4.11.6 budget line** ("today's 32–73 ops per frame grow by fewer than 20") no longer holds as a description: the pulldown is at 89–90 ops (base max 70), mostly from round 4's crease, fillet and lat-fan ops. It is still far inside 220. Update the number, or make "≤ 220" the only rule.
- **§3.11 back-view draw order** still doesn't place the static trace (the root of B1, raised in the guides v2 review).
- **D16 is a visual criterion with no gate.** `guide:check` reports "check for a pop" as a warning, but nothing requires someone to look (S3). Say who signs it off (G18).
