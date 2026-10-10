# 0017: Guide motion, round 2 — continuous turns, knee drive, frame cadence

**Status:** Proposed, 2026-10-10 (developer, for review). Built and tested on Linux; **not yet seen on an iPhone**. Supersedes ADR 0015 only where stated (turning pass keys; J4 alone is not enough). The plan is the round-2 motion plan (S1–S8); this ADR records what is built so far and what is still open.

## Context
After ADR 0015, Ben's "the joints don't operate smoothly in one seamless motion" still had measurable causes: an acceleration step where a channel turns back at a pass key (overhead-press pelvis 69% of its phase peak, split-squat root.x 28–29%), the squat knee snapping straight in the last frames (the hip's minimum-jerk slow-down magnified by IK near a straight knee: M8 44%, J5 3.67×), and app playback holding some frames for 1–3 refreshes (rounding put every frame change exactly on a vsync; the bench's 2550 ms is 76.5 frames).

## Decision

### E5: acceleration stays continuous through a turning pass key (built)
In phase mode a channel that turns (or goes flat) at a pass key keeps slope 0 there, and now keeps acceleration continuous too: `phaseTurnSlopes` (math.ts) is the minimum-curvature cubic with the fixed slopes, C2 at every interior knot the monotone guard leaves room for (a clipped knot is reported as a kink). Projection channels are excluded (a rounder projection turn pulls the overhead-press shoulder into a 5.9° reversal). Phases without a stopped pass key keep `splineSlopes`, bit for bit. **Supersedes** ADR 0015's "turning keys decouple both sides".

### E6: knee drive, opt-in (built; no guide uses it yet)
`"drive": { "joint": "kneeNear", "solves": "root.y" }` (schemaVersion stays 1) for `motion: "phases"` side views whose near foot is planted on the floor at every key. Per phase the near-knee flexion at each key is a C2 spline in the phase's minimum-jerk progress (E5 rules); the hip height is solved in closed form so the leg's IK gives that flexion (`drive.ts`; `pose.ts` `drivenStateAt`). root.x and the pelvis keep their own splines. Key poses are bit-identical, stops keep zero velocity and acceleration, planted feet don't move. Metrics and checks sample `drivenStateAt`/`poseAt`, never bare `stateAt`.
- New hard checks: **D1** (guide:motion) a pass key's flexion within 0.5° of its phase's stop-to-stop line in u, the best measured shape; `--suggest` prints the pass-key root.y that puts it there. **drive-miss** (guide:motion D2 and the guide:check `drive` item): no frame without a solution.
- On the committed squat with drive on and the pass keys on the line: M7v 1.57×, M8 12%, J5 1.07×, J3 97 ms / 13.6%, but the bar starts late and finishes early (bar M3 4%). The squat needs re-authoring with the plan's solver (S4, guide-maker). **If no squat passes every gate, revert E6** (no unused format field) and take the plan's option B (a softer standing knee).

### Metrics (built; guide:motion, not in `npm run check` yet)
M7v (velocity-vector frame step ≤ 2.5× the minimum-jerk ideal), M8 (the same step near stops ≤ 25% of peak; catches the lockout snap J4 misses), J5 (IK knee/elbow angular-acceleration step ≤ 2×), J6 (reach of a moving undriven IK limb ≤ 0.99, warning), C6 (seam velocity ≤ 0.02 H/s, hard, also in guide:check). Gait guides report M7v, M8 and J5 as warnings. Per-guide declared excursions (overhead-press pelvis lean-back, 6°) and allowances live in `MOTION_CONFIG` with their reason and are printed in every report; hard limits can't be relaxed.

### V5: playback cadence (built)
- `frameIndexAt(elapsed, duration, count, loop, dtMs)` samples half a refresh ahead (dt capped at 50 ms) and rounds down, so every frame change falls half a refresh from a vsync. A ping-pong shows 0…n−1 forwards and n…1 back, one interval each. The player passes `timeSincePreviousFrame`.
- `guide:check` **duration-grid** (hard): `durationMs × 30 / 1000` is whole. The bench goes 2550 → 2600 ms (2% slower; key t values are normalised, poses unchanged). Tempo note for Ben.
- A seeded cadence simulation (every guide duration, 60/120 Hz, 0–200 µs jitter) finds zero off-cadence frames; the old clock fails the same simulation.

### Not built yet (plan order)
- **V4** one outline per limb (knee/elbow crease): waits for the uncommitted muscle-definition work (`draw.ts`, `regions.ts`, `muscle-map.ts`, `style.ts`) to be committed; designer sign-off.
- **V6** 60 fps bake for the M/L tier: after a device check on Ben's iPhone (first frame ≤ 1.0 s, full bake ≤ 2.5 s, no memory warning).
- **V7** the scratch review page rebuild (outside the repo).
- **Pose changes** (S4 squat, S5 overhead-press soft knee, split-squat front shin, pulldown option): guide-maker, Ben approves.
- **S8**: add `guide:motion -- --all` to `npm run check` once all 10 guides pass; this ADR then replaces ADR 0015's "not part of npm run check yet".

## Consequences
- Guides with no turning pass key and no `drive` sample exactly as before; key poses are unchanged everywhere. `guide:motion -- --all`: 6/10 pass (squat, overhead press, pulldown, split squat fail on the issues the plan's S4/S5 address).
- Playback holds every baked frame for the same number of refreshes on a steady display; confirming it needs a slow-motion screen recording on the phone.
