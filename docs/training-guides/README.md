# Training guides

Research the coach can draw on: an evidence-graded **library**, plus **candidate** rules for the coaching playbook. Nothing here is in the playbook until Ben approves it. Not medical advice. Pain or injury → stop progressing that movement and see a professional (CLAUDE.md rule 9).

Evidence grades: **Strong** = consistent meta-analyses. **Moderate** = several trials. **Weak** = single studies or mechanistic reasoning. **Practice** = coaching convention without direct evidence.

## Index

| File | Topic | Last checked |
|---|---|---|
| [evidence-core.md](evidence-core.md) | Volume, load/rep ranges, proximity to failure and RPE reliability, progression methods, mid-session load drops, rest, deloads, frequency | 2026-10-08 |
| [concurrent-training.md](concurrent-training.md) | Strength + endurance interference, session order and spacing, protecting long runs/rides, HYROX | 2026-10-08 |
| [programmes.md](programmes.md) | 5/3/1 (+BBB, hybrid), RP, Juggernaut, GZCL, Starting Strength, StrongLifts, PPL, upper/lower, HYROX programmes | 2026-10-08 |

## Shortlist for Ben to approve (combined, 14 rules)

These are the most useful rules from the three files. IDs link back to the detailed tables and sources.

| # | Candidate rule | Applies when | Grade | From |
|---|---|---|---|---|
| 1 | Hypertrophy: 10–20 hard sets per muscle per week. Start near 10 and add 1–2/week only while performance holds. Count only working sets at RPE ≥ 6, synergists as ½. | Muscle-gain focus, weekly volume advice | Strong (upper bound Moderate) | E1, E2 |
| 2 | Strength: main lifts mostly ≥ ~80% 1RM (≈ 1–6 reps at RPE 7–9), 2–3+ sets, each lift ≥ 2×/week. | Strength focus | Strong | E3 |
| 3 | Default working sets to RPE 7–9 on compounds. RPE 10 is for planned last sets, AMRAPs or isolation work. | Setting targets | Moderate | E4 |
| 4 | Treat one RPE as ± 1 rep. Change *future* targets only on a pattern (≥ 2 sessions), never on one rating. Distrust ratings on sets > 12 reps. | Interpreting logs | Moderate | E5, E13 |
| 5 | Unplanned RPE ≥ 9.5 (planned ≤ 8.5) or reps short by ≥ 2 → coach **offers** for the remaining sets of that exercise: −5–10% load (≈ 2–4% per RPE point over target, rounded down to achievable), or same load with fewer reps. | Mid-session (ADR 0006 trigger) | Weak + Practice | E6 |
| 6 | Unplanned RPE ≤ 6 (planned ≥ 8) on a working set → coach **offers** next achievable load up (+2–5%) or +1–2 reps. | Mid-session | Practice | E7 |
| 7 | Offline fallback is double progression. When all working sets hit the top of the rep range at ≤ target RPE, add the smallest achievable increment. If that jump is > ~10% or hits machine max, progress reps/sets instead. | No AI / "built-in rule" | Moderate + Practice | E8 |
| 8 | A stall (2–3 sessions failing the same target) → propose a 5–10% reset or a rep-scheme change. One bad session → note only. | Next-session targets | Practice | E13 |
| 9 | Rest 2–3 min (up to 5) on heavy compounds; 1–2 min on isolation work. | Rest presets, shortening sessions | Moderate | E10 |
| 10 | Deload when performance drops across ≥ 2 sessions (≈ halve sets, RPE ≤ 7, ~1 week), or every 4–8 weeks if Ben prefers. Always a proposal. | Future plan | Weak + Practice | E11 |
| 11 | Same day, strength priority: lift first, keep the endurance part easy. Key endurance session that day: do it first and cut leg volume. | Daily plan | Moderate | C1 |
| 12 | Keep heavy lower-body lifting and hard/long endurance ≥ 6 h apart (ideally ≥ 24 h), and keep heavy/high-volume leg work out of the 48 h before a key long run/ride/race. Show the trade-off as a proposal; never overwrite the run. | Weekly scheduling (brief scenario 3) | Moderate | C2, C3 |
| 13 | Keep ≥ 2 heavy strength exposures per week through endurance phases (fewer sets, same heavy loads). | Endurance/HYROX blocks | Moderate | C5 |
| 14 | HYROX goal: endurance-first (running is ~60% of race time), 1–2 strength sessions, 1 station/compromised-run session. Practise sled and wall balls to standard. Ask Ben whether HYROX or strength is the primary goal. | HYROX race on the calendar | Weak + Practice | C7 |

### Conflicts and decisions for Ben

1. **Refine ADR 0006 trigger (proposed):** compare logged RPE against the *planned* RPE, and skip the trigger for warm-ups and planned AMRAP/"+" sets. Without this, the coach would offer to cut load after sets that were meant to be RPE 10. It also probably shouldn't fire "too easy" on sets > 12 reps, where ratings are unreliable. *Brief/ADR change, so Ben's approval and a CHANGELOG/ADR entry are needed.*
2. **No guardrail overrides proposed.** Every load rule passes through achievable-load snapping (round **down** after an overshoot), equipment min/max, the pain block, completed-set immutability and version checks.
3. **Data honesty:** concurrent rules about fatigue apply only to imported or Ben-reported endurance sessions. No inferred recovery scores (rule 6). Strength and endurance load stay as separate metrics (brief §3).
4. **Sleds (HYROX):** plate-loaded sled resistance isn't comparable across surfaces. Log it as plates loaded, not as an equivalent load (brief §4). Flag for the designer.

## Paid material Ben may want to add to the library

*5/3/1 Forever* (Wendler), *Juggernaut Method 2.0* (C. W. Smith), RP books/app, *The Hybrid Athlete* (A. Viada), *Starting Strength* (Rippetoe), ACSM 2026 position stand full text (MSSE, paywalled when checked). Only summaries are held here.
