# Review: Guides v2 (figure v2, muscle focus, How to v2)

**Verdict: CHANGES NEEDED.** There is one blocker (B1), and it is small to fix. The lat pulldown, now drawn from behind, draws its dashed bar path over the back of the head and neck. That depicts the behind-the-neck path the entry forbids. Six should-fix items follow. The most important are bake time (S1, likely to miss the G14 budget on Hermes) and redraw cost (S2). The rest of the slice is careful and well tested: the S1 isolation from the last review is intact, the legend rule is implemented and tested exactly, overrides can't add an unlisted muscle, and nothing touches Your data.

Reviewed on branch `claude/gracious-knuth-joxqpw`, commits `e399b8a..45e6059` (15 commits). Spec: `docs/design/exercise-guides-v2.md`, ADR 0014, design-system §2.3 and §9.57–9.59, exercise-library §8, CLAUDE.md rules.

## Checks run

| Check | Result |
|---|---|
| `npm run check` (typecheck, lint, vitest, `catalogue:validate`, `guide:check --all --verify`) | Pass. 80 files, 1017 tests. 133 catalogue files valid (1 known warning). 10/10 guides pass. Every focus table matches §4.5 |
| Scratch prebuild: `git archive HEAD` into the scratchpad, node_modules symlinked, `npx expo prebuild --platform ios --no-install --clean` | OK (only the known `CFBundleDisplayName` notice) |
| `check:entitlements` on that prebuild | `Entitlement check: OK (no forbidden keys)`. Scratch copy deleted afterwards |
| `npm run guide:render -- <id> --frames` for pulldown, squat, split squat, bench, RDL and OHP | Previews were byte-identical to the committed PNGs (`git status` clean). I inspected the key frames, frames and S-tier thumbnail sheets |
| Node-only imports in `packages/catalogue/src` and `apps/mobile/src/guide` | None. No `node:*`, `fs`, `path`, `Buffer`, `process` or `import.meta`. No Hermes-risky APIs (`structuredClone`, `findLast`, `Object.groupBy`, `toSorted`, `Intl`, `.at()`) |
| Per-frame JS cost, v1 (`9c40fbf`) vs v2 (HEAD), all 10 guides × every baked frame, bundled with rolldown | JIT: v2 ops 1.50 + pathData 2.83 = **4.3 ms/frame**; v1 0.37 + 0.54 = 0.9 ms/frame. `node --jitless` (closest proxy for Hermes): v2 6.6 + 8.0 = **14.7 ms/frame**; v1 1.3 + 0.7 = 2.0 ms/frame (see S1) |
| Visible muscle area (resvg masks, each listed muscle alone, key positions, 240 px) | Every muscle in `drawn` has visible pixels (grip included), so the legend never claims a colour that isn't on screen. Primary muscles under the §4.7 1.5% floor: OHP `front_delts` ≈1.0%, row `upper_back` ≈0.9% (see S5) |

---

## Blockers

**B1. Lat pulldown from behind: the static bar-path trace is drawn over the head and neck, so the Key positions view shows the bar passing behind the head.**
- **Where:**
  - `packages/catalogue/src/figure/draw.ts:338–340`. The trace is emitted after every body group, whatever `seenFrom` is. From behind, the bar is on the far side of the body, and `draw.ts` already draws the bar itself under the trunk (§3.11), but its path is drawn on top.
  - `apps/mobile/src/guide/bake.ts:147–155`. The `steps` bake adds the trace to every key position.
  - `cable-lat-pulldown/guide.json` `overlays: [{ of: "bar", showIn: ["static"] }]`.
- **Failure path:** Ben opens How to › Lat pulldown and taps `Key positions`. The same happens by default if Reduce Motion is on, and on the review sheet he will use to decide B3. Positions 1–3 show a dashed vertical line from the bar, down through the back of the head and the neck, to the shoulder line. That is exactly what the entry's `guideBrief.doNotShow` forbids ("Bar behind the neck", "Bar touching the head"), and it is fault #1 on the same screen ("Don't pull the bar behind your neck"). A guide must "show nothing unsafe" (guide-maker brief). Here the art contradicts the `What not to do` card directly under it.
- **Fix:**
  1. For `seenFrom: "back"`, emit the trace with the mid props, before the trunk, so the body hides it exactly as it hides the bar. Alternatively, drop static overlays for back-view guides.
  2. Add a test that in a back view the trace op comes before the trunk `nearBody` fill.
  3. Re-render the pulldown preview.
  4. When B3 goes to Ben, add a note: at the bottom the visible bar ends come out right at the top-of-shoulder line (frame 43), so even without the trace a quick glance can read as "bar resting on the traps". A front-view render next to it on the review page would let him compare.

## Should fix

**S1. The v2 bake costs about 7× the v1 bake per frame. On Hermes it will likely miss the G14 budget (≤ 1.5 s per guide), and every bake task overruns the 8 ms slice.**
- **Measurements** (table above). Every frame now builds about 55 KB of SVG path text (v1 about 13 KB), which `Skia.Path.MakeFromSVGString` then parses again for each op (`bake.ts:81`, `draw-plan.ts:77`). About 45% of that text is repeated: the halo, the contour stroke and the fill of each body group pass the same `contours` array, so the same Catmull-Rom path is built and parsed three times (25 KB of 55 KB per squat frame).
- **Estimate for the device:**
  - ADR 0013 put the v1 bake on Hermes at "a few hundred milliseconds". At 7× that is roughly 1.5–2.5 s per guide, before Skia parses the ~5 MB of path text.
  - One frame task is about 15 ms jitless. `runSliced` can't split a task (`sliced.ts:56`), so each slice runs about twice its budget.
  - `frames` exist only once the whole bake is done (`GuidePlayer.tsx:176`). Ben looks at a still poster for the whole bake, on every open with a new size, scheme or Increase Contrast setting.
- **Fix** (any of these):
  1. Memoise path data per `contours` identity within a frame, or build the `SkPath` once and reuse it for halo, contour and fill.
  2. Use 4 decimals instead of 5 for the unit-size Skia path text.
  3. Lower region and band sample counts. Trunk-chain regions use up to 44 samples per side before smoothing, and the Catmull-Rom smoothing doesn't need that many.
  4. Start the clock on the baked prefix (old review N1) instead of waiting for `done`.
  5. Measure on the iPhone (G14) before the build goes to Ben, and record the number in ADR 0014. It currently says "unmeasured".

**S2. The canvas redraws at display rate, not at 30 fps, and each redraw now costs much more.**
- **Where:** `GuidePlayer.tsx:194` assigns `frame.value` on every display frame, even when the index hasn't changed. Reanimated's mutable setter has no equality check (`react-native-reanimated/src/mutables.ts`, `_value` setter). So the derived picture and Skia's mapper (`Container.native.ts` `startMapper`) re-run and redraw on every tick: 60 or 120 Hz for a picture that changes 30 times a second.
- **Impact:** v1 had the same pattern, but its pictures were simple. A v2 picture redraws ~35–70 ops per tick: about 1,100 anti-aliased cubic spans and 5–18 gradient fills (the pulldown has 18). That is a G14 (dropped frames) and G15 (battery during rest) risk.
- **Fix:** `const i = frameIndexAt(...); if (i !== frame.value) frame.value = i;`.

**S3. The §2.1 fold check (A12) very likely fails on both phones.**
- **Where:** `HowToScreen.tsx:97, 134`; spec §2.1, §12.2 #12.
- **Arithmetic** (look D, 390 × 844, default text):
  - Sheet header: 68 pt. Scroll top padding: 16 pt.
  - Player card: border and padding 34, `Draft guide` tag 28, canvas 348, controls 44, three 12 pt gaps, squat legend ≈148 pt (2 + 3 + 1 lines at 22 pt, 296 pt text width). Total ≈ 638 pt.
  - So `What not to do` starts about 742 pt below the top of the sheet. The heading is roughly at the fold, and the first item (≈793 pt) is below a page sheet's ≈784 pt.
  - On a 375 × 667 SE, the card ends about 90 pt below the fold, so the whole card is off screen.
- **Note:** the spec's "player card ends at about 630 pt" leaves out the header and the sheet offset (see Spec issues).
- **Fix:** confirm on device. If it fails, pick one:
  - (a) cap the in-card canvas, e.g. at 300 pt, and keep the larger view for `Full screen`;
  - (b) shorten the card legend, e.g. plain names only, with terms in VoiceOver;
  - (c) change A12 with Ben.

**S4. When the player fails, the standalone legend still shows `Not shown from this side:` with no figure on screen.**
- **Where:** `apps/mobile/src/guide/how-to.ts:188` copies every legend line, and `apps/mobile/test/guide-isolation.test.ts:122` pins `['most', 'also', 'notShown']`.
- **Failure path:** Skia fails to load or a bake throws, and How to shows the cues with "The animated guide couldn't be shown". The squat legend then still says `Not shown from this side: inner thighs`. There is no "side" on screen, and every listed muscle is uncoloured, so the line breaks the rule it exists for ("Not shown names the uncoloured ones").
  - The no-guide and guide-unreadable paths already drop the line, because `muscleFocusFor(entry, null)` has no view.
- **Fix:** filter out `kind === 'notShown'` in `standaloneLegend`, and update the test.

**S5. Two primary muscles are barely visible, and the check that would flag them isn't built.**
- **Measurements:** OHP `front_delts` (its only strong muscle) peaks at about 1.0% of the near-body area across the key positions. Row `upper_back` peaks at about 0.9%. Both are under the §4.7 1.5% warning floor. That visible-area check is listed as not built (ADR 0014), so `guide:check` passes them silently.
- **Impact:** at 240 pt the OHP's strong colour is a patch of about 5 × 6 pt on the shoulder. That risks A21 ("front shoulders on the overhead press") and G11 ("say where the strong colour is without reading").
- **Fix:** tune with `focus.adjust` (±0.25 on `s`/`d`), or build the §4.7 mask check (the resvg route above takes about 40 lines). At minimum, list both guides for Ben's G11 pass.

**S6. The SVG↔Skia match (acceptance A9) isn't a test in the repo, and the recorded numbers don't meet it as written.**
- **Where:** ADR 0014 "Consequences". A9 asks for ≤ 0.01% of pixels. The ADR reports 0.0069% at a 25% per-channel threshold, but 0.25% at 10%, and the run is a one-off script outside the repo, as it was for v1.
  - v2 adds gradients, multi-contour paths and `rgba()` stop parsing on the Skia side. RN Skia's `CSSColorParser` silently turns an unparsable colour into black, and `MakeFromSVGString` returning null silently drops an op. A regression there would be invisible to every committed test, which only check the plan, not the pixels.
- **Fix:** commit the CanvasKit harness as a vitest. `canvaskit-wasm` is already installed via Skia. Run it on 3 frames × 10 guides × 2 schemes, with the threshold stated in A9.

## Nits

- **N1. The poster shown while baking pulses.** `bake.ts:143` records frame 0 with `optsAt(first)`, so during the bake the poster shows strong at 0.80, not the steady 1.0 that §4.9 asks for ("no emphasis … in the poster"). Use `steady` for that first task.
- **N2. The ◐ swatch ignores Increase Contrast.** `MuscleFocusLegend.tsx:22` always uses `MUSCLE_OPACITY.soft` (0.45). Under Increase Contrast the canvas uses 0.60, so the swatch no longer matches the figure.
- **N3. Opacity stacks during the pulse.** `draw.ts:271–279` draws soft, then strong, as separate ops. During the pulse, strong is 0.80 over soft at 0.36, so overlaps such as `chest` + `upper_chest` read darker, against §4.3's "never stacked opacity". This only happens below 1.0. Subtract the strong regions from the soft path, or accept it and amend §4.3.
- **N4. `focus.side` is silently ignored on side views.** `regions.ts:131` always colours near limbs in a side view. `focus.side: "far"` is then ignored, yet `resolveFocus` still reports those muscles as `drawn` (swatch on, no colour). `guide:check` should reject `side` ≠ `near` on side views, and reject `lat`/`med` surfaces in `focus.add` on side views.
- **N5. `focus.adjust` only changes the first mapped region** (`muscle-map.ts:251`). Calves (front), grip, core (front/back) and traps (back) have more than one, and nothing says the others are ignored. Document it or apply it to all.
- **N6. A new `frames` array on every render.** When the pulse is on, `GuidePlayer.tsx:176` builds a new array on each render (`slice`). `AnimatedArt`'s `useDerivedValue` deps then change, and the ~90-picture array is re-copied to the UI runtime on every parent re-render. Wrap it in `useMemo`.
- **N7. An empty footer still takes space.** `HowToScreen.tsx:134` always passes a `MuscleFocusLegend` element, so when the entry is unreadable an empty padded `View` plus a 12 pt gap still renders (`GuidePlayer.tsx:322`). Pass `footer` only when `view.legend.length > 0`.
- **N8. ● swatch for a soft-drawn muscle.** `muscles.ts:143` shows ● on `Feel it most` when the only drawn primary is `grip`, which is always drawn soft. No current guide hits this.
- **N9. Glute colour sits above the leg's shading.** In side views `regionOps('pelvis')` runs after the near leg (`draw.ts:333`), so glute and abductor colour sits above the leg's shading and contour lines. §3.7 says "Shading sits above the muscle colour". It's visual only, and the renders look fine.
- **N10. The A6 test is looser than A6.** The region-inside test (`figure-v2.test.ts:285`) allows points up to half the inset outside the outline, and checks polygon vertices, not the smoothed curves that are drawn.
- **N11. Carried over from the last review (N8).** No ESLint `no-restricted-imports` rule keeps `node:*`/`fs`/`path` out of `packages/*/src`. Today that holds only by inspection.
- **N12. Process.** `95c4f05` edits `.claude/agents/exercise-guide-maker.md`, while ADR 0014 says "Agent configuration is left to the product manager". The product manager should confirm it was their change. The content itself is right.

## Verified OK

- **S1 isolation (last review) is intact:**
  - How to is still `getComponent`-lazy.
  - `GuidePlayer`/`bake.ts` are the only Skia, Reanimated and worklets importers (test-pinned), and the player is required through the guarded loader.
  - `bake.ts` makes no Skia call at module load (`unitBounds()` is now a function). New Skia calls (`Shader.MakeLinearGradient`, `Point`, `TileMode`) all happen inside tasks.
  - The legend renders inside `GuideBoundary` (as `footer`), so a player failure takes it down and `howToLayout` shows the standalone copy. `MuscleFocusLegend` and `@fizz/catalogue/figure` are pure, with no Skia.
  - `muscle-map.ts` now evaluates at launch through `how-to.ts`. It is pure regex parsing that returns null rather than throwing, and costs microseconds.
- **Pulse rules:**
  - `musclePulseOn` is off under Reduce Motion (including the opt-in `Play animation`), under Increase Contrast, without a work phase, and without muscles. Stills bake steady.
  - A paused frame is held as baked. The Finished state swaps to a separately baked steady poster.
  - The cache key includes size, muscles, pulse and Increase Contrast. Dark ↔ light re-bakes, because `muscle` and `shade` are in the style values.
  - All 10 guides `loop: "cycle"`, so no ping-pong plays the emphasis backwards.
- **Legend rule:** `resolveFocus` keeps every listed muscle in `strong`/`soft`. `notShown` holds the hidden or unmappable ones in listed order. The swatch shows only if a muscle on that line is drawn. Text and VoiceOver wording match §5.3 and §10, and all of this is tested on the squat, the split squat (hidden `core`) and the pulldown (`Not shown from behind: front of upper arms`). The measured visible area confirms every `drawn` muscle really is coloured.
- **Overrides:**
  - `hide`/`adjust`/`add` can only affect listed muscles at runtime, because the loop runs over the entry's lists. `guide:check` fails on unlisted ones, on adjusts over ±0.25 and on unreadable regions (tested).
  - The region map matches §4.5 row by row, except the pulldown lats (see Spec issues).
  - An unreadable entry means no colour, no "Highlighted muscles" sentence, no legend and no card.
- **Colour:** the only non-neutral paint is `guide.muscle`. It is never `accent` or a status colour in either look or scheme (tested). Contrast floors are tested in both looks, both schemes and with and without Increase Contrast. Gradients reach Skia as `rgba()`, which RN Skia's `CSSColorParser` accepts (spaces are stripped).
- **How to:**
  - The header shows the name only. `What not to do` sits directly under the player, with no status colour, in catalogue order. `Common mistakes` is gone.
  - The xmarks and swatches are hidden from VoiceOver, and each legend line is one element. The canvas label ends "Highlighted muscles are listed below." only when something is coloured.
  - `Draft guide` shows on all 10 guides.
  - There are no canvas gestures.
- **CLAUDE.md rules:**
  - Rule 1: everything is bundled, offline, with no AI.
  - Rule 6: the muscles come only from the sourced catalogue entry. There are no scores or percentages, and "pain"/"injury" appear only under Safety.
  - Rule 9: the violet was chosen so it can't read as pain.
  - Rule 10: How to reads and writes nothing about Ben, and the muscle data stays in `@fizz/catalogue`.
  - No `console.*`, network calls or secrets in the diff.
- **Guide content** (rendered frames): squat, split squat, RDL, bench, OHP, row, pushdown, leg press and sled push show the intended muscles in plausible places, with a neutral spine on the RDL bottom and the row. The rear foot rests on the pad. No overlaps or unsafe poses apart from B1. The thumbnails (S tier) still read.

---

## Spec issues

- **§3.11 back-view draw order doesn't place the static trace.** It lists "bar-path trace" only in the side-view order (step 10, above the body). That is the root of B1. Add "back view: trace with the mid props, under the trunk".
- **§2.1 fold estimate.** "The player card ends at about 630 pt" can't hold once the 68 pt header, the sheet offset and a 3-line legend are counted (S3). A12 needs either a smaller in-card canvas or a revised target. Ben's call.
- **§4.5 lats, back-view row is stale.** The table says `trunk.face 1.5–2.8 ±c0.6 w0.3>0.5`. §4.10 "As drawn" and the code say `±c0.3>0.6`, and the code uses `1.3–2.88` and `w0.25>0.5`. Update the table so the "A test can be read against the spec line by line" claim holds.
- **§8 no-player states.** "Legend lines without swatches" doesn't say whether the `Not shown` line stays. It shouldn't when no figure is on screen (S4).
- **§12.1 #9** gives no per-channel threshold. Measured at 10%, the ADR's own numbers fail it (S6).
- **§4.3 "never stacked opacity"** conflicts with separate soft and strong ops during the pulse (N3). Either require a knockout or relax the line.
- **Status lines out of date.**
  - The v2 spec's status line doesn't list Differentiate Without Color as unbuilt. The app always passes `false` (ADR 0014), but G16 and the §8 state table expect it.
  - exercise-library.md line 7 and design-system.md line 22 still say guides v2 is "specified, not built". design-system §9.57 already says "built except Full screen".
- **CLAUDE.md "Stack"** (carried over) still doesn't list Skia, Reanimated or worklets. Needs Ben's approval to edit.
