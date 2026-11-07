VERDICT: CHANGES NEEDED

# Review: guide fixes (B1 trace, B2 bake cost, S2 redraw, S4 legend, sled push round 4)

Reviewer: independent `reviewer` agent, 10 Oct 2026.
Scope: `c289f6a..40f8467` (9 commits) on `claude/gracious-knuth-joxqpw`. Fixes for `docs/reviews/guides-motion-and-definition.md` B1/B2 and guides v2 review S2/S4.
Base for comparisons: `3d9649a`.

## Summary

- Most of the fixes hold up when checked independently:
  - B1 (pulldown trace) is fixed.
  - The figure maths is byte-identical.
  - The bake is about 2.3× cheaper without a JIT.
  - `frame.value` is assigned only when the index changes.
  - The sled knee now extends in one sweep.
  - The standalone legend no longer shows `Not shown`.
- **One blocker.** The new "play on the baked prefix" logic (B2 fix 4) freezes the animation for about 170 ms right after it starts. This happens on every uncached bake at the bake speeds measured here. The cause is that `canPlayPrefix` treats frames as playable the moment they are baked, but the player only receives them every 200 ms. A committed test pins the setting that causes the stall.
- G14 (full bake ≤ 1.5 s) is **not shown to be met**. The no-JIT proxy puts the worst guide at 1.42–1.65 s, before any Skia parse or record time. The developer already says this needs a device number. That is honest, but it means B2 stays open until there is one.

## What I ran

| Check | Result |
|---|---|
| `npm run check` (typecheck, lint, vitest, catalogue:validate, `guide:check --all --verify`, `guide:motion --all`) | Exit 0. 98 files and 1332 tests pass. 133/133 catalogue files valid (1 known warning). 10/10 guides pass `guide:check`. 10/10 pass `guide:motion`; the sled J5 gait warning is 2.20×. |
| **B1.** Pulldown, static trace. Every key position plus every playback time; 115/240/348 pt; Increase Contrast on and off; definition off and neutral (1080 frames). Point-in-polygon test of every trace sample against every `nearBody`/`farBody` fill. | No trace sample falls inside a body fill that is drawn *before* the trace (0 of 1080 frames). Every covering fill, head and trunk included, comes after it. At each key position 41 of 92 trace samples stay visible, all above the head. The preview PNG agrees. |
| **Byte-identity.** `bakeFrame` op JSON, hashed per guide over all playback frames × 3 tiers × definition × Increase Contrast × pulse, HEAD vs `3d9649a`. Also SVG `pathData(…,2)` and `(…,5)` text. | Only `sled-push` (pose change, expected) and `cable-lat-pulldown` static (trace order, expected) differ. Path text is identical on all 9 other guides. |
| Path-text memo (`paths.ts` WeakMap keyed by contour array) vs a fresh copy of every contour, 122 334 path ops | 0 mismatches. No op mutates its contours after it is built. |
| **Bake timing**, my own harness. Rolldown bundle, `node --jitless`, every guide × every playback frame, 348 pt, entry muscles, definition `neutral`, `bakeFrame` plus `pathDataScaled(…,10000)`. Two HEAD runs and one base run, run one after another. | HEAD: **15.1 / 14.5 ms/frame** (figure 11.2/10.7 + text 3.9/3.7), 47.5 KB of text per frame. Base: **34.6 ms/frame** (24.9 + 9.7), 74.9 KB. That is 2.3–2.4× cheaper, which agrees with the report's 2.2×. **Per guide, max: pulldown 1.65 s and 1.42 s** (1.50 s and 1.29 s without the 8 held frames). The report gave the max as 1.41 s (RDL); RDL measured 1.18–1.20 s here. |
| **Sled push knee.** Geometric hip–knee–ankle angle per frame, both legs, with 2400 samples per cycle and on the 63 playback frames; reversals at a 1e-6 °/s threshold. | Near knee: flexes from toe-off (t 0) to t 0.317, then extends with no reversal until toe-off. In stance (0.5 to 1.0) the extension speed has one peak (66.7 °/s at t .877), rising from 15.6 °/s at touch-down. Far knee: the mirror image, turning to flexion at exactly t 0.500 (toe-off); it did so at t 0.524–0.539 at base. There is no extension after toe-off on either leg. Note that the extension *across* swing and stance has two speed peaks (59 °/s late in swing, 67 °/s in stance). That is a plausible gait, but Ben should look at it in G11. |
| **S2.** `GuidePlayer.tsx:229–232` | `frame.value` is set only when the index changes. The only other write is the reset effect (`:248`), which runs once per replay. Correct. |
| Prefix playback, discrete-event simulation using the real `runSliced` + `canPlayPrefix`, the 200 ms publish throttle and 8 ms budget, 10–30 ms per frame, 84 and 63 frames | See B1 below. |

## Blocking

**B1. Playback on the baked prefix freezes for about 170 ms just after it starts (G14: "no dropped frames during playback").**
- **Where:** `apps/mobile/src/guide/GuidePlayer.tsx:112–121` and `apps/mobile/src/guide/sliced.ts:90–98`.
  - The first `onProgress` runs after one slice, when 2 frames are ready.
  - `canPlayPrefix` passes at any cost up to about 50 ms per frame, so the player gets `pictures.slice(0, 2)` and the clock starts.
  - The next prefix can't be handed over for another `PREFIX_PUBLISH_MS = 200` ms, plus a React render and a new derived-value mapper.
  - The clock reaches frame 2 at about 67 ms, then holds frame 1 (`AnimatedArt`, `:139`) until that hand-over.
- **Failure scenario:** Ben opens How to › Squat for the first time, or after changing size, scheme, Increase Contrast or definition (the cache holds 4 bakes). The figure moves one frame, freezes for about 0.17 s, then jumps 5–6 frames.
  - Simulated with the real `runSliced`/`canPlayPrefix`, the throttle, and 10, 15 or 20 ms per frame (the no-JIT proxy is 14.5–15 ms): 5–6 frames are late and the longest freeze is 167 ms. This leaves out render latency, which can only make it longer.
  - Only the slow case (30 ms per frame) has no freeze, because it starts later.
  - Before this change, playback waited for the full bake and never stalled.
- **Why it happens:** the proof in `canPlayPrefix` ("frame j is ready after (j − ready + 1) × msPerFrame") assumes the player can use a frame as soon as it is baked. A frame is actually usable only at the next publish.
- **Also wrong:**
  - Each later hand-over is gated by `canPlayPrefix` again (`:118`). If the running average rate gets worse after playback has started, frames that are already baked are never handed over, and the player stays frozen until `onDone`.
  - The test at `apps/mobile/test/guide-playback.test.ts:639` asserts that playback starts at `ready: 1`, which pins the setting that stalls.
- **Fix:**
  1. Make the publish latency part of the condition: start only when `margin × ready × frameIntervalMs ≥ PREFIX_PUBLISH_MS + a render allowance (for example 100 ms)`. Alternatively, publish on every slice until the clock is safely ahead.
  2. Once a prefix is playable, always publish the longer prefix without re-checking.
  3. Add a test that drives `runSliced`, the publish throttle and `frameIndexAt` together and asserts that no frame is shown late at 10–25 ms per frame.

## Should fix

**S1. G14 is not met on the proxy, and the report's maximum doesn't reproduce.**
- My two HEAD runs put the pulldown at 1.65 s and 1.42 s of JS per guide, against the 1.5 s budget. Skipping held frames gives 1.50 s and 1.29 s. Skia path parsing and picture recording come on top of this.
- The developer's "max 1.41 s (RDL)" is within run-to-run noise of one run, but the pulldown (90 ops a frame, the heaviest) is the guide at risk.
- The improvement is real and well done. Whether B2 is closed now depends on the iPhone number, as ADR 0014 now says.
- **Fix:**
  - Record per-guide maximums from several runs in ADR 0014, and name the pulldown as the guide to time on device.
  - Measure `MakeFromSVGString` and `createPicture` on the device run too.
- Each frame task (about 15 ms no-JIT) still overruns the 8 ms slice of spec line 914 about 2×. This is carried over and is not new.

## Nits

- **N1.** `GuidePlayer.tsx:56–57` still says "the animation plays once every frame is ready". The test name `guide-playback.test.ts:218` ("with every frame baked") is stale in the same way.
- **N2.** `msPerFrame` (`GuidePlayer.tsx:117`) divides by tasks run, not frames ready. Today no guide shows an overlay in `animated` mode, so the two counts match. A future animated trace would add cheap sample tasks and make the estimate optimistic. Use `(now − started) / max(1, ready + 1)`.
- **N3.** Held-frame reuse (`heldFrames`) assumes that nothing but the pose moves during a hold (ground scroll is excluded). The every-guide ops test covers today's guides. Any future time-driven prop animation must also opt out.
- **N4.** In the back view, the trace is drawn before the near-arm halos (`draw.ts:703–705`). Where the arms cross it, the halos cut small gaps into the dashes above the head. This is acceptable, but it should be on the G11 sheet.
- **N5.** These items from the previous review are not addressed and not mentioned in the fix report:
  - S3: definition pop warnings on the OHP and pulldown are still in `guide:check`.
  - S4: the D11 SVG↔Skia gradient harness is not committed.
  - S5: the OHP front-delt sliver. This one is acknowledged and deferred to G11.

## Spec issues

- **Two bake budgets (still open).** §12 G14 and line 914 say a full bake ≤ 1.5 s with the first frame at once. ADR 0017 V6 says full bake ≤ 2.5 s and first frame ≤ 1.0 s. Ben or the designer needs to pick one.
- **Prefix playback isn't in the spec.** §8 and G14 describe a poster followed by playback, and say nothing about starting on a partial bake or what to show if the clock overtakes the bake. If prefix playback stays, the spec should state the rule: never start unless the prefix covers the hand-over latency, and never show a held frame mid-motion. G14 can then be tested against it.
- G14 says "full bake ≤ 1.5 s". With prefix playback, the user-visible measure is the time to first motion and stall-free playback. The spec could measure that directly instead.

## Not checked

- On-device behaviour on Ben's iPhone: Hermes timing, Skia parse cost, the S2 redraw saving and the prefix hand-over latency. None of this can be measured off device.
- The visual quality of the re-posed sled push beyond joint angles. It is still `draft`, for Ben's G11 pass.
