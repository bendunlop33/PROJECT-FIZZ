# 0015: Guide motion — one seamless movement per phase

**Status:** Proposed, 2026-10-09 (developer, for review). The engine and checks are built and tested on Linux; **not yet seen on an iPhone**. No guide uses the new phase timing yet: the guide-maker migrates the guides (plan §4), and every pose change there is Ben's call. Ben judges the minimum-jerk feel on the phone.

## Context
Ben, on the animated guides: "why does it look like the joints don't operate smoothly in one seamless motion". Measuring every guide (`npm run guide:motion`, below) found four causes:

1. **Pops.** A projection factor set on only some keys was held at the keys that left it out and snapped at the next one (overhead-press elbow 0.087 H in one frame, pulldown 0.079 H).
2. **Two pushes per phase.** ADR 0011's `smooth` ease gave each mid key ("Halfway") the mean of its two neighbouring secants, so the speed dipped at the key and rose again, with an acceleration step at every key (5 of 9 rep guides had two speed humps in a phase).
3. **Lurches at stops.** A cubic with zero end slope still has its largest acceleration at a hold edge or turnaround: the figure dropped into the bottom, froze and lurched out (acceleration jumps of 60–100% of the phase peak at every hold edge).
4. **Joints out of step.** Root, pelvis and limbs were eased independently, so knees reversed (squat 0.013 H) and pairs of joints reached half-way at different times (row 216 ms apart).

## Decision

### Projection channels at every key
Every resolved key emits all eight projection channels with the values `pose.ts` already used (`effectiveProjection`: a missing arm or leg is 1, a forearm follows its arm, a shank its leg). They now interpolate instead of snapping. Key poses are bit-identical (checked against all 10 guides).

### Channel mode (default): C2 spline slopes
`motion: "channels"` (or no `motion`) keeps per-channel interpolation, but `smooth` is now a **C2 cubic spline** in moving time (holds removed): velocity *and* acceleration are continuous through free mid keys. Slopes stay 0 at holds, turning points, flat or missing sides and ping-pong ends. A Fritsch–Carlson guard (0 on a sign disagreement, at most 3× the smaller secant) keeps every segment inside its key values (`splineSlopes` in `math.ts`). `monotoneSlope` stays for the body-width profiles, so the silhouette doesn't change. Slopes are cached per guide and channel, so a frame is one Hermite per channel; bake cost is unchanged (median of 9 rounds: 452–473 ms against 488–542 ms for all 10 cycles in Node).

### Phase mode (opt-in): one minimum-jerk progress per phase
`motion: "phases"` on the guide, `pass: true` on mid keys (inherited through `sameAs`; an explicit `false` overrides). Keys without `pass` are **stops**. The stretch from one stop's hold end A to the next stop's time B is one movement: progress `u = 10τ³ − 15τ⁴ + 6τ⁵`, τ = (t − A)/(B − A), shared by every channel, and each channel is a C2 spline **in u** through the phase's keys (natural ends, same guard). So:
- velocity and acceleration are **zero at every stop** (holds, turnarounds, the loop seam) and continuous everywhere else, and the figure eases out of a hold instead of lurching;
- all channels move on one clock, so they can't drift out of step between keys;
- pass keys keep their **authored `t`**: `poseAt(k.t)` is the key pose, and the Reduce Motion stills, `keyFrameStops` and work phases are unchanged.

Schema rules (format stays `schemaVersion: 1`; every existing file is valid): pass keys only with `motion: "phases"`; the first and last keys are stops; a pass key has no hold; eases are absent or `smooth`; the floor doesn't scroll; IK modes (target present, prop, contact, bend, pivot, planted) change only at stops.

**Timing the pass keys.** Point speed is a single centred bell when each key's u equals its chord-length share of the phase in main-point space. The engine doesn't place keys itself (that would move them off their authored times); `npm run guide:motion -- <id> --suggest` prints `t = A + (B − A)·mj⁻¹(share)` per pass key, and a `pass-timing` warning (P1) fires when a key is more than 0.01 cycle off. On the 9 rep guides, phase mode plus the suggested times (no pose changes) gives one speed hump per phase, stop ease near ideal (1st frame 1.2–2.2%, 2nd 4–8% of peak), acceleration jumps of 0.3–0.6% at pass keys and hold edges, and frame steps of about 1× the minimum-jerk ideal. **Don't re-time mid keys without phase mode**: under per-channel interpolation it makes the squat clearly two-humped.

### Stance rule: opt-in, not the default (differs from the plan)
`ground.matchFloorSpeed: true` (scrolling floors only) makes a planted foot leave and land at the floor's speed: at a lift-off or touch-down key the foot's x slope is fixed at −`scrollPerCycle`, so the ankle has no velocity jump (sled today: 0.262 H/s). The plan made this the default together with a new sled stride. Alone it whips the sled's near-straight rear knee (1526 °/s at lift-off), and the stride is Ben's call, so it is **opt-in**: the guide-maker turns it on in the same change as the stride. With the plan's stride it passes every gait metric (contact jump 0, knee step 33%, lift-off knee 107 °/s, toe-off reach 0.94). A foot's x may reach slightly past the contact point under this rule (it meets the floor moving with it); the overshoot metric exempts exactly that.

### `hang` barbell anchor
`{ "kind": "hang", "x": …, "elbowDeg": … }` (side-view barbells only, no `props.<id>` keyframe values). The bar sits at `x`, exactly arm's length below the near shoulder with the elbow bent `elbowDeg` (using the arm's effective projection); the hand IK then solves to that same elbow. A Romanian deadlift's keyframed bar drifted 0.0027 H against the shoulder between keys, and at 99% arm reach IK turned that into elbow swings (4.7–5.5° reversals, 10 direction changes per cycle). On a scratch copy of the RDL with `{ x: 0.035, elbowDeg: 13 }` (today's key elbows are 13.1–13.4°) the elbow holds 13.00° all cycle, bar drift is 0 and every guide check passes. Out of reach, the bar sits level with the shoulder and `hand-contact` fails.

### Drawing seams (no new draw-op kinds; SVG and Skia draw the same ops)
- **Hip seam.** A leg drawn over the trunk now emits its outline (M/L contour stroke, S-tier halo) *before* the trunk, so the trunk fill hides the part inside the pelvis and the thigh joins the hip without a line. The outline outside the trunk stays. Back-view guides already drew legs first and are unchanged.
- **Shoulder and elbow seams.** Arm segments are stroked as open paths without their proximal cap (`openSegmentOutline`), so no line crosses the shoulder or sits inside the elbow. The arm's edges over the torso are real occlusion edges and keep their line. Hands stay closed.
- **Ghost shade edges.** A limb segment's shade band stops where its edge runs into the limb's other segment (refined by bisection, faded at the cut), instead of painting a shading edge across a bent knee or elbow (up to 40 pt before, none now).
- **Region blink.** Muscle colour and anatomical lines on a foreshortened segment fade between projection 0.6 and 0.4 (`projectionFade`) instead of vanishing at 0.5. A group's level op is split by alpha only while a segment fades (bench: 8 pop events per cycle before, 0 now). The ROM check still uses `UNCHECKED_PROJECTION`.
- These change the look at the hip, shoulder and knee (before/after crops in the review). The designer signs them off and records them in exercise-guides-v2 §3.11 (draw order) and §3.7/§4.4; the spec file isn't changed here.
- SVG/Skia parity (the resvg vs CanvasKit pixel comparison) is unchanged by these: worst 0.1858% of pixels before, 0.1875% after (machine leg press, light). Both are above the spec's 0.01% target; that gap predates this ADR.

### Checks and the measuring tool
- `guide:check` gains **`pose-continuity`** (hard: no point jumps more than 0.002 H at a key, hold end or the loop seam) and **`contact-velocity`** (ankle velocity jump ≤ 0.02 H/s at lift-off and touch-down; hard once `matchFloorSpeed` is on, a warning before). `loop-continuity` also compares the last drawn frame (t = 1 − 1e-6) with t = 0.
- `npm run guide:motion -- <id>|--all [--json] [--compare] [--suggest]` (pure `motion-metrics.ts`) prints the acceptance metrics: C1/C2/C4 (hard: pops, contact jumps, overshoot), M1–M6 (main-point humps, peak position, mid-phase stall, ease at stops, acceleration jumps, 30 fps steps), J1–J3 (joint humps, reversals, pair sync), J4 (lockout whip, warning) and S1–S3 for gait guides. It exits 1 when a hard or quality threshold fails. **It is not part of `npm run check` yet:** 0/10 guides pass today; the quality metrics become a `guide:check` failure once all 10 guides are migrated and pass.

### Rejected
- **Per-channel quintic Hermite** (zero acceleration at holds, spline acceleration at keys): not monotone-safe (the pulldown forearm projection overshoots 1.7% of its range) and it barely moves the 30 fps steps; phase mode covers holds and turnarounds by construction.
- **Automatic chord-length knots in the engine**: pass keys would leave their authored times, so stills, checks and work phases would need a second time system. The `--suggest` tool gives the same result and keeps the file the source of truth.
- Deferred: a per-phase peak skew, a top pause (tempo, Ben's call) and per-channel lag for the head.

## Consequences
- Until a guide is migrated it uses channel mode with C2 slopes: smoother than before almost everywhere (two-hump main points 5 → 2 guides), but the overhead-press shoulder reversal grows from 1.9° to 9.8° because its arm projection turns at Forehead (plan §4.3 has the content fix).
- The guide-maker migrates each guide (plan §4): `motion: "phases"`, `pass` on mid keys, `--suggest` times, and the pose changes marked for Ben. Guides stay `draft` until Ben approves them.
- Minimum-jerk peaks at about 1.9× the mean speed and makes the top of each rep a soft, near-still turnaround. Ben judges that on the phone; a peak skew or a softer profile are the fallbacks.
- ADR 0011's description of `smooth` (a monotone cubic) is superseded by this ADR.
