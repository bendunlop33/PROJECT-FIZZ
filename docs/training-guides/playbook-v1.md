# Coaching playbook v1 (approved)

*This is **Coaching knowledge** under CLAUDE.md rule 10: general rules the coach applies every time. It isn't Ben's personal data and it isn't medical advice. If Ben reports pain or injury, progression on that movement stops and the coach suggests seeing a professional. It never diagnoses (CLAUDE.md rule 9). Compiled by the training researcher on 2026-10-09 from the shortlist in [README.md](README.md) and the fact-checked research files linked below.*

**Status: Approved by Ben 9 Oct 2026.** His reply to the 14-rule shortlist, verbatim:

> "Ok.
> 1 - it should be guided by how often people say they gym per week too, rather than starting from a random number
> 7 - i think this should be driven by a combination of AI and what the gym can offer, as a default rule won't always work best
> stop with hyrox, it should be more adaptable depending on what the goal is / how training is being run"

The approval is recorded in [CHANGELOG 2026-10-09](../brief/CHANGELOG.md) and in the [ADR 0006 amendment](../decisions/0006-coach-led-progression.md).

**Review fixes (9 Oct, after the PM's review).** These make the text match what the app actually does and fill gaps. No approved rule changes meaning, except where a line is marked for Ben.
- **Built-in rule status, stated honestly.** Rule 7-F sets next-session targets when the coach is unavailable. It is also the baseline when the coach is connected but Ben hasn't applied a coach target (for example, he taps `Not now`). That follows CLAUDE.md rule 3, under which future-session changes are always proposals. Whether the coach's target should apply instead is **D21**, for Ben.
- **No added sets from the built-in rule** until Ben decides D2. The coach adds a set only when Ben asks.
- **Rule 1** now says what happens when days, session length or experience aren't set. More days never start lower. 5 and 7 days are defined. A start from history follows his stated days (his sets per lifting day × stated days), and the muscle-goal bonus is at most +2 sets.
- **One endurance switch.** It counts only hard, long or key sessions. Rule 11's lift-first order applies only when lifting is the priority, and rule 13 applies only when endurance is one of Ben's goals.
- **Plan suggestions go out of date** when the goal, days, session length or other training change.
- **New open decisions:** D21 and D22 (rule 5's arithmetic).

**Summary**
1. Rules 2–6 and 8–13 are approved as written. Rules 1 and 7 are revised the way Ben asked. Rule 14 (HYROX) is removed. Three companion rules make his decisions explicit: **G** (targets follow the current goal and how training is run), **T** (mid-session offers compare logged effort with planned effort) and **7-F** (the equipment-aware built-in rule).
2. Weekly sets start from the days a week and session length Ben states, or from his own logged history, within a range set by his goal. If a value isn't set, the coach asks when he asks it to plan, and any assumed value is labelled. Sets grow only when he asks.
3. The AI coach chooses load, reps, sets or a variant. It works from his goal, his history on that equipment and the gym's real increments. The labelled built-in rule (7-F) sets next-session targets when the coach is unavailable, and when no coach target has been applied (D21).
4. Rules 11 and 12 apply only while the endurance switch is on: a hard, long or key endurance-type session is in Ben's plan or logged. Rule 13 also needs endurance to be one of his goals. No rule is sport-specific.
5. Every output still passes the deterministic guardrails. Numbers marked *default* can be edited. Open decisions D1–D22 stay off until Ben decides them.

## What "approved" covers

| Status | Rules |
|---|---|
| Approved as written | 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13. Rule 13's "applies when" now refers to the endurance switch and endurance being one of Ben's goals, instead of "Endurance/HYROX blocks", following "stop with hyrox". |
| Revised and approved | **1** and **7**. The principle is in Ben's words; the method comes from the fact-checked research. |
| Removed | **14**, the HYROX-specific rule built on [concurrent-training.md](concurrent-training.md) C7. C7 stays as library material only. |
| New, from Ben's direction on HYROX | **G**: targets adapt to the goal and to how training is run. |
| Approved with the shortlist | **T**, the mid-session trigger refinement (README conflict 1). The PM read Ben's "Ok." as covering it, and it is recorded in the ADR 0006 amendment. `docs/decisions/provisional-2026-10-09.md` still lists it as open, so it needs Ben's confirmation (see PM notes). |
| Approved through the ADR 0006 amendment | **7-F**, the built-in rule. Its wording follows the amendment, except the amendment's "only runs without the coach", which isn't what happens today (see 7-F and D21). |
| Clarified 9 Oct (review fixes; Ben to see) | Rule 2's sets are **per session**, as in its ACSM source. Rule 11's lift-first order keeps its written condition, "strength as the priority". Rule 13 applies "through endurance phases", which now means the switch is on **and** endurance is one of Ben's goals. |

**Defaults and decisions.** Numbers marked *default* come from the fact-checked research. They only shape what the coach suggests inside an approved rule, and Ben can change any of them. Some proposals would add a new prompt the coach raises itself, change an approved rule, or change how ADR 0006 behaves. Those are listed under **Open decisions** and stay off until Ben decides.

## Playbook rules (approved v1)

| ID | Rule (short form; full text below) | Applies when | Evidence grade | Sources |
|---|---|---|---|---|
| 1 | Weekly sets per muscle group start from Ben's stated days a week and session length, or from his own logged sets per lifting day × his stated days. His goal sets the range. Sets grow by 1–2 only when he asks. In a short week, keep the loads and cut sets. | Any plan or weekly-volume advice | Strong / Moderate / Weak / Practice, split by claim (see 1) | [volume-by-frequency.md](volume-by-frequency.md) V1–V8 |
| 2 | Strength: main lifts mostly at ≥ ~80% 1RM (≈ 1–6 reps at RPE 7–9), 2–3+ sets per lift per session, each lift ≥ 2×/week. | Strength is the main focus, or strength "also matters" | Strong (heavy loads); Moderate (≥ 2×/week, set count) | [evidence-core.md](evidence-core.md) E3; [goal-adaptive.md](goal-adaptive.md) GA2 |
| 3 | Working sets default to RPE 7–9 on compounds. RPE 10 is for planned last sets, AMRAPs or isolation work. | Setting targets | Moderate | E4 |
| 4 | Treat one RPE rating as ± 1 rep. Change *future* targets only on a pattern (≥ 2 sessions), never on one rating. Distrust ratings on sets above 12 reps. | Interpreting logs | Moderate | E5, E13 |
| 5 | Unplanned RPE ≥ 9.5 (planned ≤ 8.5), or reps short by ≥ 2: the coach **offers**, for the remaining sets of that exercise, −5–10% load (≈ 2–4% per RPE point over target, rounded down to an achievable load) or the same load with fewer reps. How the two figures combine is D22. | Mid-session (rule T) | Weak + Practice | E6 |
| 6 | Unplanned RPE ≤ 6 (planned ≥ 8) on a working set: the coach **offers** the next achievable load up (+2–5%) or +1–2 reps. | Mid-session (rule T) | Practice | E7 |
| 7 | The AI coach chooses load, reps, sets or a variant from Ben's goal, his history on this equipment and the selected gym's real increments and min/max. Changes are shown in kg/lb and %. | Ben asks, a rule T signal, the post-workout review, or planning the next session or block | Strong / Moderate / Weak / Practice, split by claim (see 7) | [equipment-aware-progression.md](equipment-aware-progression.md) EQ1–EQ8, EQ10 |
| 7-F | Labelled, equipment-aware double progression. It uses the smallest achievable increment. If that jump is > ~10% or the machine is at its max, it progresses reps instead, up to the rep cap, then holds. It doesn't add sets (D2). | Next-session targets when the coach is unavailable, or when no coach target has been applied (D21) | Weak + Practice | EQ9, E8, ADR 0006 amendment |
| 8 | A stall (2–3 sessions failing the same target): propose a 5–10% reset or a rep-scheme change. One bad session gets a note only. | Next-session targets | Practice | E13 |
| 9 | Rest 2–3 min (up to 5) on heavy compounds and 1–2 min on isolation work. | Rest presets, shortening sessions | Moderate | E10 |
| 10 | Deload when performance drops across ≥ 2 sessions (≈ halve sets, RPE ≤ 7, ~1 week), or every 4–8 weeks if Ben prefers. Always a proposal. | Future plan | Weak + Practice | E11 |
| 11 | Same day with strength as the priority: lift first and keep the endurance part easy. If the day's endurance session is a key one, do it first and cut leg volume. | Daily plan, **only when the endurance switch is on**. The lift-first part only when lifting is the priority (see "Endurance switch") | Moderate | C1 |
| 12 | Keep heavy lower-body lifting and hard or long endurance ≥ 6 h apart (ideally ≥ 24 h). Keep heavy or high-volume leg work out of the 48 h before a key long run, ride or race. Show the trade-off as a proposal; never overwrite the run. | Weekly scheduling, **only when the endurance switch is on** | Moderate | C2, C3 |
| 13 | Keep ≥ 2 heavy strength exposures a week through endurance phases (fewer sets, same heavy loads). | **When the endurance switch is on and endurance is one of Ben's goals** (was "Endurance/HYROX blocks") | Moderate | C5 |
| 14 | **Removed** (HYROX special case). Goal and event handling now sits in rule G. | n/a | n/a | n/a |
| G | Targets follow Ben's confirmed goal and how his training is run. Nothing is sport-specific. Rules 11 and 12 apply only while the endurance switch is on; rule 13 also needs endurance as a goal. | Always | Practice (structure), built on Strong/Moderate profile values | [goal-adaptive.md](goal-adaptive.md) GA1–GA19 |
| T | Mid-session offer triggers compare logged effort with *planned* effort. Warm-ups and planned all-out/AMRAP sets never trigger. "Too easy" never fires above 12 reps. | Every logged working set | Moderate (rating error) + Practice | ADR 0006 amendment; E5–E7 |

## Inputs the coach uses

All of these are **Your data** (CLAUDE.md rule 10). Each is stored with its provenance and date. The coach reads them; it never infers them.

| Input | Where it comes from | Used by | Honesty rule |
|---|---|---|---|
| **Goal**: main focus, optional "also matters" goals, optional named event (what, date, what it demands, whether it's the priority) | Onboarding step 1 and Profile → Goals & schedule ([onboarding.md](../design/onboarding.md), [profile-and-settings.md](../design/profile-and-settings.md) §2.2). The design collects all five main-focus options and the event fields; that layout is D13, **pending Ben's bulk approval** ([open-decisions.md](../design/open-decisions.md) §B) | G, 1, 2, 7 | Confirmed by Ben. Changes go through goal proposals |
| **Days a week** (stated, 1–7; may vary week to week) | Onboarding step 2, Goals & schedule | 1 (budget, split), 2, G | Logged days never overwrite stated days without his confirmation. Not set: see rule 1, "Missing inputs" |
| **Session length** (usual minutes, per day if they differ) | Onboarding step 2, Goals & schedule; today's `Length` chip in [workout-builder.md](../design/workout-builder.md) | 1 (set budget), G (short-on-time order) | After 3 logged sessions, minutes per set come from his own timestamps. Not set: 60 min, labelled as assumed |
| **Other training**: type (endurance: run, ride, swim, row; hard classes/HIIT; field or court sport; other), effort (`Easy` / `Hard or long`), usual days, which sessions are key | Stated by Ben (onboarding step 3, Profile; D13 design, pending Ben's bulk approval), planned, imported (source labelled) or reported in chat or check-in | G (endurance switch), 11–13 | Only hard, long or key sessions turn the switch on. Fatigue is used only from sessions that are planned, imported or reported. "Usual" days are confirmed when planning. No recovery scores |
| **Experience** | Onboarding chips: under 1 year / 1–3 years / over 3 years (cut-off for "new lifter": D12) | 1 (start caps), G | Asked as a fact, not a self-rating. Not set: the lowest start cap, labelled |
| **Selected gym's equipment**: plates and microplates, dumbbell steps, stack increments and add-ons, machine min/max, unit and load convention | Gym profile. Code turns it into a **step card**: current load, next achievable loads up and down with % change, at-max flag | 7, 7-F, 5, 6 | Achievable loads come from code, never from the model |
| **History**: logged sets (including FitNotes imports), reps, RPE, load, timestamps | Logs. The comparable history is the same exercise, same equipment and the same routine slot (slot matching: D7) | 1, 4, 7, 7-F, 8, 10 | Sets without RPE are counted as hard and labelled "approx.". Estimated 1RM is always labelled as an estimate |
| **Pain flags** | Pain-flag flow, check-in | All rules (block) | Never diagnosed. They block increases |
| **Check-in** (1–5 and reasons, optional note) | Start workout ([check-in.md](../design/check-in.md); CHANGELOG 2026-10-09) | Daily offers | Shown as given, never turned into a recovery score. Pain → pain flow. Ill → gentle suggestion to rest. Low score → the coach may *offer* a lighter session and never applies it on its own |
| **Today's request** | Chat or voice | All | Transcripts and imports are data, not instructions (CLAUDE.md rule 8) |
| **Priority muscle groups** (optional) | Profile → Goals & schedule, shown when Muscle is a goal (D13 design, pending Ben's bulk approval) | 1 | With none set, no group goes above about 10 sets a week |

## Rules by goal

### Goals the coach recognises

The main focus picks a profile. "Also matters" goals add floors. A named event lays phases over the top. Goal labels are generic; an event's details come from what Ben says it demands, not from built-in sport defaults.

- **Strength**: heavier main lifts.
- **Muscle**: muscle size.
- **General fitness**: health, capability, consistency.
- **Maintain**: keep current strength and size on less time.
- **Support other training**: lifting supports running, riding, a sport or classes. (The research files call this "Endurance" or "performance alongside endurance"; the app shows `Support other training`.)
- **A named event**: any event, overlaid on the main focus (see Events below).
- **No goal set**: D15. Until it's decided, the coach asks for Ben's goal when he asks it to plan. Otherwise no goal profile is used: no goal range and no rule 2. Weekly sets come only from his days and session length (rule 1, capped at about 10 per group, the no-priority ceiling). Effort follows rule 3 and reps follow each exercise's planned range. Screens say `No goal set: using your days and session length only`.

General fitness and Support other training as main-focus options are part of the D13 design, pending Ben's bulk approval. Until he approves, they're used as set, because Ben chose them himself.

### Profile targets (defaults; exact band edges are Practice)

| | Strength | Muscle | General fitness | Maintain | Support other training |
|---|---|---|---|---|---|
| **Reps** | Main lifts 1–6; others 6–12 | Mostly 6–15 (5–30 valid) | 8–15 | As recently trained | Lower body ~4–10RM loads, fast lifting intent |
| **Effort (rule 3)** | RPE 7–9; 10 only on planned singles or AMRAPs | 7–9; last set or isolation up to 10 | 7–9 (6–8 only if D9) | Same as recent | 7–9, short of failure (Practice) |
| **Weekly sets (rule 1)** | 3–6 hard sets per main lift (2–3 per lift per session, rule 2); other groups 4–10 | Priority groups 10–20, others 6–10 | 4–10 per group | ≥ ⅓ of recent, floor ~4, loads kept. Without history, "recent" is the rule 1 start from his days and length | Lower body 4–8; upper body by goal floors |
| **Frequency** | Each main lift ≥ 2×/week where days allow (rule 2) | Each group ≥ 2×/week where days allow (Practice) | Every major group ≥ 2 days/week | ≥ 1×/week, with ≥ 1 heavy exposure per main lift. (The research's ≥ 2 sessions for lifters about 60+ applies only if Ben tells the coach his age; it isn't asked) | ≥ 2 heavy exposures/week (rule 13; 1×/week only if D8) |
| **Rest (rule 9)** | 2–5 min on main lifts (3–5 on heavy top sets); 1–2 min accessories | 2–3 min compounds; 1–2 min isolation | 1–2 min; circuits allowed except heavy barbell lifts | As the load requires | 2–3 min |
| **Order** | Main lifts first | Priority muscles first | Big compounds first | One heavy set per main lift first | Within the session: heavy lower-body compound first. On shared days, rule 11's key-session part only (no lift-first) |
| **Lever (rule 7)** | Load on main lifts | Reps or load, whichever the equipment allows more finely | Reps first, slow load steps | Hold load | Load at low reps |
| **"Too hard" offer (rule 5)** | Prefer same load, fewer reps | Prefer less load, same reps | Less load | Either | Less load or drop a set |
| **"Too easy" offer (rule 6)** | As approved | As approved | Reps first | As approved (optional wording only if D10) | No extra lower-body sets within 48 h of a key session |
| **Stalls (rule 8)** | Reset or rep-scheme change | Same | Simplify the plan rather than add to it | Only a sustained drop (≥ 2 sessions, reps ≥ 2 lower at the same load) | Hold rather than reset in heavy endurance weeks |
| **Deload (rule 10)** | Reactive, or every 4–8 weeks | Reactive, or every 4–8 weeks | Reactive only | Not planned | Line up with endurance recovery weeks |

Grades: heavy loads for strength and weekly sets driving size are Strong. Order, frequency, the maintenance dose and rest are Moderate. The rule 5 preference by goal is inference from evidence-core §5. Sources: GA2–GA6 in [goal-adaptive.md](goal-adaptive.md); [ACSM 2026 infographic](https://acsm.org/wp-content/uploads/2026/03/Resistance-Training-Position-Stand-infographic.pdf) (re-checked 2026-10-09: "Train all major muscle groups at least 2 days per week"; strength "80% of your one-repetition maximum (1RM) for 2–3 sets per exercise"; hypertrophy "~10 sets per muscle group"; "Choose a routine that fits your schedule").

### "Also matters" floors (defaults, Practice)

- **Strength:** each main lift gets ≥ 1–2 heavy exposures a week (≥ 1 set of 1–6 reps at RPE ≥ 8).
- **Muscle:** ≥ 6 hard sets a week for the groups Ben names.
- **General fitness:** every major group trained ≥ 2×/week.
- **Endurance:** makes rule 13 apply whenever the endurance switch is on. It doesn't turn the switch on by itself. If no endurance sessions are known, the coach asks once when Ben asks it to plan, and assumes nothing.

If a floor and the main profile compete for time, the main profile wins and the coach states the trade-off. Source: GA7 (the 6-set floor is RP's commercial opinion; Spiering 2021 and Bickel 2011 suggest less can maintain in younger adults).

### Named events (any event; no built-in sport defaults)

The coach asks what the event is, when it is, what it demands, and whether it's the priority. Asking is fine because Ben started the conversation. The coach maps the answers to the nearest profile.

| Phase | Timing (default) | What changes |
|---|---|---|
| Build | More than ~8 weeks out | Main-focus profile |
| Specific | ~8–2 weeks out | Practise the event's own movements, loads and standards |
| Taper | Final 1–2 weeks | **Strength-type event:** volume −30–50%, intensity kept at ≥ 85% of estimated 1RM (or slightly reduced); the last 2–7 days light or off (Weak–Moderate, [Travis 2020](https://pmc.ncbi.nlm.nih.gov/articles/PMC7552788/)). **Endurance-type event:** lifting volume −40–60%, loads kept. These figures are borrowed from endurance-training tapers ([Bosquet 2007](https://doi.org/10.1249/mss.0b013e31806010e0); Strong for endurance training, Practice when applied to lifting). |
| After | Event date passed | One easier week. The focus stays the same until Ben changes it. Coach-raised follow-up questions: D11 |

Phase targets apply **only after Ben applies the phase proposal**. A priority event's targets replace the main profile only that way. Phase and taper proposals are offered only when Ben asks the coach to plan those weeks (GA19), never on their own. Library passages specific to an event (for example HYROX in [concurrent-training.md](concurrent-training.md) §5 and [programmes.md](programmes.md)) are used only after Ben names that event, and are labelled as library material.

### How training is run

| Factor | Effect | Rules |
|---|---|---|
| **Days a week** | Sets the split and the weekly starting volume. With 1 lifting day and a Strength focus, the coach says once that each lift can't be trained ≥ 2×/week and offers a full-body day; it doesn't override his stated days. On 5–7 days, the extra days go to accessories, priority muscles or endurance, not to more main-lift sets. | 1, 2, GA9 |
| **Session length** | Sets the set budget. When time is short, keep the goal's priority order and cut sets, not load. Strength: main-lift top sets first. Muscle: priority compounds first. General fitness: one squat or hinge, push, pull and carry/core as a circuit. Maintain: one heavy set per main lift. Support other training: a heavy lower-body compound plus trunk. | 1, GA10 |
| **Other training** | Hard, long or key endurance, class/HIIT and sport sessions turn the endurance switch on (below). Classes count as hard endurance for spacing (≥ 6 h from heavy legs, ideally a different day). Matches are key sessions, with heavy lower body kept ≥ 48 h away and upper body or light legs for 48–72 h after. Anything Ben marks `Easy` changes nothing, whatever its type. Cycling isn't assumed to interfere less than running. | 11–13, GA11, GA15 |
| **Equipment** | Sets the step card and the progression lever. With a Strength focus, a main lift keeps its own movement and equipment (strength is partly specific to the movement trained), so swapping it is a proposal that says so. For other goals, machine, cable, dumbbell and barbell swaps count as equivalent. | 7, 7-F, GA12 |
| **Experience** | Sets the start caps in rule 1. For new lifters (cut-off D12), main lifts at 5–8 reps until technique is steady (Practice). Everyone: lean on reps achieved more than on RPE alone. | 1, GA13 |
| **Named programme** (5/3/1, GZCLP, …) | For the lifts it covers, its sets, reps, %TM, AMRAPs and deload weeks replace the profile defaults. Rule T skips its planned AMRAPs. Guardrails are unchanged. | GA14, P1–P3 |

**Endurance switch (deterministic; the one definition every file uses).** For a given week, the switch is on only if at least one endurance-type session (run, ride, swim, row, class or HIIT, match or sport, or "other") that is **hard or long, or marked key**, is:
- **in the plan:** planned in the next 7 days, or part of Ben's confirmed usual other training; or
- **logged:** imported or reported in the last 7 days.

Effort is what Ben sets (`Easy` / `Hard or long`) or says. Classes or HIIT and matches start as `Hard or long`, and Ben can change that. An entry with no effort set counts only if it's marked key. Easy sessions never turn the switch on. Short form for other files: *"a hard, long or key session in the plan (planned or usual) or logged (imported or reported)"*.

When the switch is off, rules 11–13 are dormant and not mentioned. When it's on:
- **Rule 12** applies.
- **Rule 11:** a key endurance session goes first, with less leg volume. "Lift first, keep the endurance part easy" applies only when **lifting is the priority**: the main focus is Strength, Muscle, General fitness or Maintain, and no priority endurance-type event is in its specific or taper phase. With `Support other training` as the main focus, or such an event in phase, there's no lift-first hint.
- **Rule 13** applies only when **endurance is one of Ben's goals**: `Support other training` as the main focus, `Endurance` under also matters, or a dated event Ben described as mainly endurance, from ~8 weeks out to the date. With fewer than 2 stated lifting days, rule 13's two sessions aren't possible; the coach says so once when planning, and screens don't repeat it every week.

Key sessions are the ones Ben marks. The coach may suggest defaults: with endurance as the main focus, long sessions, intervals, races and matches; otherwise only races and matches. Grade: Practice (switch), Moderate (the rules it turns on). Source: GA15.

### Goal changes

- The coach **never changes a goal itself**. When Ben states a new aim or asks for the next block, the coach offers two things:
  1. A **goal proposal**: before/after of the goal fields and an effective date. Apply saves it to Your data with provenance; Undo restores the previous version.
  2. A separate **plan proposal**: future templates with their scope, Apply and Undo. It is rejected as stale if the goal, setup (days a week, session length, usual days, experience), other training or plan version has changed since it was built.
- Transitions keep a maintenance dose of what Ben is moving away from: ≥ 1 heavy session a week for strength, or ≥ ⅓ of recent sets for muscle. The new emphasis is ramped in over 1–2 weeks (Practice).
- Gaps of up to ~3 weeks don't need "making up", because strength is largely kept that long ([McMaster 2013](https://ro.ecu.edu.au/ecuworks2013/788), Moderate).
- The coach may only *ask* about a goal change on a signal it detects itself (an event date passed, or 3+ weeks of logs not matching the goal) if Ben approves D11.

Source: GA16–GA19.

---

## The rules in full

Each rule below gives its status, its exact text, when it applies, its evidence grade, its sources and its guardrails. Sources were checked on 2026-10-08 (evidence-core, concurrent-training, programmes) and fact-checked on 2026-10-09 (volume-by-frequency, equipment-aware-progression, goal-adaptive). The URLs in each file carry their own check dates.

### Rule 1: Weekly volume comes from how Ben trains (revised and approved)

**Rule.** Weekly hard sets per muscle group start from Ben's stated lifting days a week and usual session length, not from a fixed number.
- **Start:** the number of sessions that train the group × that group's share of each session's set budget. If Ben has ≥ 4 logged weeks in the last 8, start from his own logged sets for that group per lifting day × his stated days.
- **Range:** his goal sets the range (see "Rules by goal").
- **Growth:** sets grow by 1–2 per group, at most every 1–2 weeks, and only when Ben asks. Performance must be holding, time must allow, and no pain flag can be active. Otherwise load or reps progress instead.
- **Short week:** keep the loads, cut sets, and don't make them up later.
- **Lasting change:** a lasting change in days or session length is saved only after Ben confirms it. The rebuilt plan is then a proposal.

**Applies when:** any plan, any weekly-volume advice, a request to plan the week or block, or a stated change in days.

**Evidence grade:**
- **Strong:** more weekly sets give more growth, and frequency mainly spreads volume.
- **Moderate:** strength needs only a few sets per lift; the maintenance dose (about ⅓ of recent volume, loads kept); diminishing returns within a session; time saved by supersets.
- **Weak:** the exact per-session cap; adding sets for growth; starting from habitual volume.
- **Practice:** the time maths, start caps, step size and band edges.

**Sources:**
- [volume-by-frequency.md](volume-by-frequency.md) V1–V8 (fact-checked 2026-10-09).
- [Pelland et al. 2025/26](https://doi.org/10.1007/s40279-025-02344-w) (preprint [SRXIV.460](https://sportrxiv.org/index.php/server/preprint/view/460)).
- [Remmert et al. 2025](https://sportrxiv.org/index.php/server/preprint/view/537). The abstract was re-checked 2026-10-09: per-session thresholds are about 11 fractional sets for hypertrophy and about 2 direct sets for strength, to be "interpreted cautiously". It is a preprint and not peer reviewed.
- [Schoenfeld, Grgic & Krieger 2019](https://doi.org/10.1080/02640414.2018.1555906); [Schoenfeld, Ogborn & Krieger 2017](https://doi.org/10.1080/02640414.2016.1210197).
- [ACSM 2026 infographic](https://acsm.org/wp-content/uploads/2026/03/Resistance-Training-Position-Stand-infographic.pdf); [Baz-Valle 2022](https://pmc.ncbi.nlm.nih.gov/articles/PMC8884877/).
- [Scarpelli 2022](https://pubmed.ncbi.nlm.nih.gov/32108724/); [Enes 2024](https://doi.org/10.1249/MSS.0000000000003317).
- [Bickel 2011](https://pubmed.ncbi.nlm.nih.gov/21131862/); [Spiering 2021](https://pubmed.ncbi.nlm.nih.gov/33629972/).
- [Iversen 2021](https://pmc.ncbi.nlm.nih.gov/articles/PMC8449772/); [Zhang 2025](https://pmc.ncbi.nlm.nih.gov/articles/PMC12011898/).

**Method (defaults):**
1. **Counting.** A hard set is a working set (not a warm-up) at RPE ≥ 6. A set with no RPE counts as hard and is labelled "approx." (D18).
   - **Planning numbers** (the start, goal ranges, growth, caps) count **direct sets**: sets of exercises whose primary muscle is the group.
   - **Logged trends** shown on Progress also count secondary muscles as ½, once per group at the higher weight, judged on a 2–4-week average. They're labelled as including ½ credits and are never compared directly with a planning range.
2. **Session budget.** Budget = h + ⌊(minutes − 10 − 4h) ÷ 3⌋ working sets, where h is the number of heavy main-lift sets planned for the session (about 4 min each). With no heavy sets (h = 0), that's ⌊(minutes − 10) ÷ 3⌋. With accessory supersets, the non-heavy part uses ÷ 2.5; heavy free-weight compounds are never supersetted. After 3 logged sessions, use Ben's own median minutes per set (D17).
   - Default h when no plan exists yet: Strength focus 6 (two main lifts × 3 heavy sets); Maintain 1 per main lift in the session; other goals 0.

   | Session length | Budget, straight sets (h = 0) | With supersets (h = 0) | Strength focus (h = 6) |
   |---|---|---|---|
   | 30 min | 6 | 8 | 5 (6 heavy sets don't fit in 20 min, so h is cut to 5: main-lift sets first) |
   | 45 min | 11 | 14 | 9 |
   | 60 min | 16 | 20 | 14 |
   | 75 min | 21 | 26 | 19 |
   | 90 min | 26 | 32 | 24 |

   Cap: at most ~8 direct (≈ 11 fractional) hard sets per group per session. This is a planning cap, not a proven ceiling. For strength, **2–3 hard sets of each main lift per session** (rule 2; ACSM's "2–3 sets per exercise").
3. **Split.** By stated days: 1–3 days full body; 4 days upper/lower ×2; 5 days upper/lower ×2 plus a fifth day; 6 days upper/lower ×3 (or push/pull/legs ×2); 7 days the 6-day split plus one short day of accessories, priority groups or mobility, with no main-lift sets. Ben's own split overrides these.
   - Slots per session: full body 5; upper 4; lower 3; push, pull or legs 3 each.
   - **Fifth day (5 days):** 3 slots. Priority groups fill them first. Without priority groups, they go to the groups furthest below the top of their goal range. With a Strength focus, they're never main-lift sets.
   - Share per slot = min(8, ⌊budget ÷ slots⌋). Slots may be weighted unequally (for example, chest and back over shoulders and arms), within the session budget and the per-session cap.
4. **Start.**
   - **With history:** his sets for the group per lifting day × his **stated** days a week. That is his logged weekly median of direct sets for the group (last 8 weeks) × stated days ÷ his logged median days a week, rounded down. It's then capped at what fits and at the goal range. When stated and logged days match, it's simply his weekly median. Both numbers are shown, e.g. "Your logs: about 9 a week over 3 days. At your stated 5 days: about 15, trimmed to 10 (Muscle range)". For a muscle goal with stable performance, the start may be up to **+2 sets a week** above that (this replaces ×1.2). If the start is more than 2 sets a week above his logged weekly median, the plan proposal ramps up: the first week is at median + 2, and the full start comes from week 2 (Practice, from the transitions guidance). If his habit exceeds what fits, he's told and offered options.
   - **Without history:** sessions × share, capped at 8 / 12 / 14 for new / intermediate / experienced. The new-lifter cap of 8 is intentional and isn't flagged as a shortfall.
   - **More days never start lower.** A group's start for N days is never below its start for N − 1 days at the same session length. Where the even share doesn't reach that, the upper days weight chest and back over shoulders and arms (e.g. 4 days × 60 min: upper groups 9, not 8).
5. **Goal check.** Trim anything above the goal range. If time keeps the start below the range, explain the trade-off and offer options: longer sessions, supersets, another day, or fewer priority groups. Never cram sets in.

**Missing inputs (defaults; every assumed value is labelled where it's shown).**

| Not set | What happens |
|---|---|
| Days a week, and < 4 logged weeks | No weekly-set number is produced. When Ben asks the coach to plan, it asks how many days a week he lifts and how long sessions usually are, in one message (the D15 pattern). A single workout still builds from its session length. Screens show `Not set: weekly sets need your days a week.` |
| Days a week, with ≥ 4 logged weeks | The split uses his logged median sessions a week, labelled `from your logs (not set by you)`. It's never saved as his stated days |
| Session length | When planning in chat, the coach asks along with the days. Elsewhere, 60 min, labelled `60 min (assumed)` |
| Experience, with no history | The lowest start cap, 8 sets a week per group, labelled `Experience not set: lowest start cap` |
| Goal | See "No goal set" under "Goals the coach recognises" |
6. **Growth.** Only when Ben asks. Whether the coach may also *offer* growth is D1. Add +1–2 sets a week to a priority group, placed in the session where that group has the fewest sets. All of these must hold:
   - performance has held over that group's last 2 sessions;
   - no pain flag is active on its movements;
   - it fits the session budget;
   - it stays within the goal range.

   If performance falls across ≥ 2 sessions, hold, or propose a deload (rule 10).
7. **Week to week.**
   - **Short week:** merged full-body sessions, with each main lift once at its planned load (2–3 hard sets) plus the priority groups. No make-up sets later.
   - **Long week:** spread the same sets across the extra days, or add ≤ +20% to priority groups only.
   - **Plan format:** run the plan as a rotation (A, B, C …) if Ben wants that (D19).

**"Performance holds"** means that, over the group's last 2 sessions in the same routine slot:
- the main exercise is at the same load, with reps no more than 1 lower at the same or lower RPE, or the load went up;
- there is no stall (rule 8) and no repeated unplanned RPE ≥ 9.5;
- Ben hasn't reported soreness that lasted into the next session.

**Example (illustrative):** an intermediate lifter with a muscle goal, 60-minute sessions, no history and **no priority groups** starts at (direct sets per group per week):
- 1 day: 3;
- 2 days: 6;
- 3 days: 9;
- 4 days (upper/lower): upper 9 (the 3-day floor; the even share would give 8), lower 10;
- 5 days: about 10 (upper/lower ×2 plus a fifth day for groups below the top of the range);
- 6 days (upper/lower ×3): 10. The arithmetic gives upper 12 and lower 15, and the goal check trims both to 10, the top of the range for non-priority groups;
- 7 days: 10, as 6 days. The seventh day is a short accessory or mobility day.

With priority groups set, those groups may start up to 12 from 5 days (the intermediate start cap; range 10–20). The other groups stay as above.

With a strength goal on 3 days: each main lift gets 2–3 hard sets at its heavy exposures (rule 2, per session), 3–6 a week in total, e.g. 2 + 2 + 2 or 3 + 3 with a lighter technique day. Other groups 4–10. At 60 min with 6 heavy sets, about 14 working sets fit a session. More worked examples are in [volume-by-frequency.md](volume-by-frequency.md); where they differ (4-day upper 8, 6-day 12, ×1.2 history start, 1–2 strength sets per exposure), this playbook wins.

**Guardrails:**
- Sets are never added to a group whose movements have an active pain flag, and volume isn't shifted elsewhere to work around pain unless Ben asks.
- Future-session changes are proposals with before/after, Apply and Undo, and each stores its reason.
- Ben's stated days, session length and goal never change silently.
- Weekly set counts come from logs only.

### Rule 2: Strength targets (approved)

**Rule.** For strength, main lifts are done mostly at ≥ ~80% 1RM (≈ 1–6 reps at RPE 7–9), with 2–3+ sets, and each lift is trained ≥ 2×/week.

**Clarification (review fixes, 9 Oct; Ben to see):** "2–3+ sets" means per lift **per session**, as in the ACSM source ("80% of your one-repetition maximum (1RM) for 2–3 sets per exercise"). Across the week that gives rule 1's Strength range of 3–6 hard sets per main lift.

**Applies when:** Strength is the main focus. When strength "also matters", only the floor applies: ≥ 1–2 heavy exposures a week.

**Grade:**
- Strong: heavy loads maximise strength.
- Moderate: ≥ 2×/week and the set count.

**Sources:** E3 and GA2; [Currier 2023](https://pmc.ncbi.nlm.nih.gov/articles/PMC10579494/); [Schoenfeld 2017 (load)](https://pubmed.ncbi.nlm.nih.gov/28834797/); [ACSM 2026 infographic](https://acsm.org/wp-content/uploads/2026/03/Resistance-Training-Position-Stand-infographic.pdf).

**Guardrails:**
- %1RM comes from an estimated 1RM, labelled as an estimate.
- Snapping down may land slightly below 80%, which is acceptable.
- If Ben's stated days make ≥ 2×/week impossible, the coach says so once and doesn't change his days.

### Rule 3: Default effort (approved)

**Rule.** Working sets default to RPE 7–9 on compounds. RPE 10 is for planned last sets, AMRAPs or isolation work.

**Applies when:** setting targets.

**Grade:** Moderate.

**Sources:** E4; [Refalo 2023](https://link.springer.com/article/10.1007/s40279-023-01946-6); [Robinson 2024](https://sportrxiv.org/index.php/server/preprint/view/295).

**Guardrails:** none beyond the common set. An RPE 6–8 default for General fitness and new lifters is D9 and isn't in force.

### Rule 4: Reading ratings (approved)

**Rule.** Treat one RPE rating as ± 1 rep. Change *future* targets only on a pattern (≥ 2 sessions), never on one rating. Distrust ratings on sets above 12 reps.

**Applies when:** interpreting logs.

**Grade:** Moderate.

**Sources:** E5, E13; [Halperin 2022](https://pubmed.ncbi.nlm.nih.gov/34542869/).

**Guardrails:** patterns are compared within the same exercise, equipment and routine slot (rule 7 inputs).

**How this fits 7-F (clarification, 9 Oct).** Rule 7-F can progress after one session because it acts on **reps achieved** on every working set, a performance result, not on a rating. Its RPE limit can only hold a progression, never start one. Rule 4 governs changes driven by ratings, and the coach (rule 7) still looks for a pattern over ≥ 2 sessions or one strong signal against the planned RPE.

### Rule 5: "Too hard" offer (approved)

**Rule.** After an unplanned RPE ≥ 9.5 (planned ≤ 8.5), or reps short by ≥ 2, the coach **offers** a change to the remaining sets of that exercise. Either −5–10% load (≈ 2–4% per RPE point over target, rounded down to an achievable load), or the same load with fewer reps.

**Applies when:** mid-session, when rule T fires.

**Grade:** Weak + Practice.

**Sources:** E6; [Mann 2010](https://scholarship.miami.edu/esploro/outputs/journalArticle/THE-EFFECT-OF-AUTOREGULATORY-PROGRESSIVE-RESISTANCE/991031785742302976); [Helms RPE-stop](https://openrepository.aut.ac.nz/items/9d2162b6-4423-4270-96f0-cfb1ee9c8cb0/full).

**The arithmetic (D22, until Ben decides).** The two figures don't agree at one point over plan: 8.5 → 9.5 gives 2–4%, below the 5–10% band. Until Ben decides, the drop is 2–4% per RPE point over the planned RPE, but **at least 5% and at most 10%**, then rounded down to an achievable load. Example: planned 8, logged 10 → 2 points → 4–8%, so 5–8%.

**Guardrails:**
- It's an offer only; nothing changes until Ben accepts. If Ben asked, it applies straight away with Undo.
- Loads round easier.
- If the next lighter load is > 10% lighter, the coach prefers the same load with fewer reps.
- If pain is mentioned, the pain flow replaces this offer.

### Rule 6: "Too easy" offer (approved)

**Rule.** After an unplanned RPE ≤ 6 (planned ≥ 8) on a working set, the coach **offers** the next achievable load up (+2–5%) or +1–2 reps.

**Applies when:** mid-session, when rule T fires.

**Grade:** Practice.

**Sources:** E7.

**Guardrails:**
- If the next achievable step is > 10%, the coach offers reps instead (rule 7).
- No increase of any kind on a movement with a pain flag.
- Switching this off during a taper, or softening it under Maintain, is D10.

### Rule 7: Coach-chosen, equipment-aware progression (revised and approved)

**Rule.** Progression follows Ben's goal and what this gym can actually load.

**When the coach acts.** The AI coach chooses load, reps, sets or a variant only in these cases. It never adjusts constantly or unprompted otherwise.
- **Ben asks**, by voice or text.
- **A rule T signal** mid-session. The coach offers first.
- **The post-workout review:** the one coach call per finished workout (ADR 0006). Its next-session targets are proposals with Apply and Undo; who sets the target when Ben doesn't apply one is D21.
- **Ben asks it to plan** the next session, week or block. Phase and taper proposals are offered only then (GA19).

**What it uses:**
- his goal and how he trains;
- the exercise's planned rep range and RPE;
- the last ≥ 2 sessions of this exercise on the same equipment and routine slot, so heavy and light days aren't mixed;
- the equipment step card from code;
- active pain flags;
- today's request and check-in.

**How changes are shown and applied:**
- Every load change is stated in kg/lb and as a %.
- When the next achievable step is too large, or the machine is at its max, the coach offers a goal-appropriate alternative instead of jumping.
- If Ben asks for a specific achievable load, it is applied with the % shown.
- The labelled built-in rule (7-F) sets next-session targets when the coach is unavailable. Today it's also the baseline when the coach is connected and Ben hasn't applied a coach target (D21). The coach's proposal shows 7-F's target as "before", so Ben always sees both.

**Applies when:** Ben asks for next weights or sets; a rule T signal; the post-workout review; planning the next session or block.

**Grade:**
- **Strong:** ≥ 80% 1RM for maximal strength.
- **Moderate:**
  - Rep progression and load progression build muscle similarly.
  - At the same effort, 1 rep ≈ 2.2–3.2% of the working load.
  - Strength is partly specific to the equipment trained on.
- **Weak:**
  - % step sizes (ACSM 2009's 2–10% rests on one review).
  - The banked-reps check used as a progression rule.
  - Microloading.
- **Practice:** the step card, the lever-by-goal mapping, and offering one option at a time.

**Sources:**
- [equipment-aware-progression.md](equipment-aware-progression.md) EQ1–EQ8 and EQ10 (fact-checked 2026-10-09).
- [Plotkin 2022](https://pmc.ncbi.nlm.nih.gov/articles/PMC9528903/); [Chaves 2024](https://europepmc.org/article/MED/38286426); [Currier 2023](https://pmc.ncbi.nlm.nih.gov/articles/PMC10579494/).
- [Nuzzo 2024](https://pmc.ncbi.nlm.nih.gov/articles/PMC10933212); [Helms 2016](https://openrepository.aut.ac.nz/items/92cefeac-7c32-44f1-bfbc-f48f4a5dd8cf/full).
- [ACSM 2009](https://sfu.ca/~ryand/kin343/ACSMresistance.pdf) p. 690; [Hostler 2001](https://europepmc.org/article/MED/11708713).
- [Haugen 2023](https://doaj.org/article/a7282dba5e674176bde2a8239832d2f7).
- Commercial practice: [MacroFactor 392](https://help.macrofactorapp.com/en/articles/392-why-am-i-being-recommended-very-high-reps); [Contreras](https://bretcontreras.com/wp-content/uploads/10-Rules-of-Progressive-Overload.pdf).

**Coach guidance (defaults, editable):**
1. **Decide whether to progress at all.** Look for a pattern over ≥ 2 sessions in the same routine slot, or one strong signal compared with the *planned* RPE. Don't force progress every session.
2. **Step size.** Normal increases are about 2–10% of the current load: typically 2–5% on main barbell lifts, and the low end for small-muscle work.
3. **Banked reps for steps over 5%.** Take a J% step with J > 5 only when every working set reached at least the bottom of the rep range + ⌈J/2⌉ reps at or below the planned RPE. Otherwise add reps first. Steps ≤ 5% use the normal "top of range" qualification, so fixed-rep schemes such as 5×5 aren't slowed. The "2% per rep" figure is deliberately cautious (D3).
4. **When the step is too big** (> 10%, or it fails step 3 within the rep cap), offer *one* option that fits the goal, and show "+X%":
   - reps up to the cap;
   - microplates or add-ons, if they're in the gym profile (D6);
   - a heavier first set;
   - +1 set, **only when Ben has asked for more sets or volume** (rule 1 growth; offering it unasked is D1). Future sessions get it as a proposal, within rule 1;
   - a unilateral or harder variant, or finer-increment equipment (proposal);
   - the jump at a lower rep target.
5. **The goal picks the lever.**
   - Strength: load on the main lifts.
   - Muscle: reps or load.
   - General fitness: reps first.
   - Maintain: hold the load.
   - Other training alongside doesn't stop progression by itself. Only an endurance-priority phase, or a named event that's close, holds loads and adds no sets.
   - Short sessions never progress by adding sets.
6. **Equipment types.**
   - Compare stack and cable numbers only on the same machine.
   - Assisted machines: the % needs Ben's bodyweight (D5). Without it, move one assistance step and show "% not checked".
   - Weighted bodyweight: smallest step.
   - Bodyweight only: reps up to the cap, then propose a harder variant or added load.
   - At machine max: reps up to the cap, then propose a unilateral version or a substitute.
7. **New gym or machine.** Machine history doesn't transfer. Coach-built workouts and plans leave the load empty with "No history: start light, enter your load." (workout-builder WB2; open-decisions B6, pending Ben). Only if Ben asks the coach directly for a starting load may it give one from his free-weight history: labelled as an estimate, rounded down, and aimed at ≤ RPE 7 in the first session. Applying it to today's sets follows the "Ben asked" path, with Undo. If Ben approves estimates in builder drafts (B6), the same labelling applies there.
8. **After snapping, recompute the %.** If it's 0% or > 10%, switch to reps and say why. Making this a deterministic check is D4.
9. **Mid-session.**
   - "Too easy" with the next step > 10%: offer +1–2 reps rather than load.
   - "Too hard" with the next lighter load > 10% lighter: prefer the same load with fewer reps.
10. **Record** the reason, the lever, J and the evidence used (ADR 0006).

**Guardrails:**
- Loads are always achievable on the selected equipment and never above its max (CLAUDE.md rule 4).
- A pain flag blocks every increase for that movement: load, reps, sets and harder variants.
- Today's sets: apply with Undo when Ben asked; offer first when the coach raised it. Future sessions: proposal with Apply and Undo.
- Stale proposals are rejected.

### Rule 7-F: Built-in rule, "Built-in rule (coach offline)" (approved via ADR 0006 amendment)

**Rule.** The labelled built-in rule runs equipment-aware double progression for next-session targets.
- **When it progresses:** when every prescribed working set in the latest comparable session reached the top of the rep range at or below the RPE limit, the next session uses the **smallest achievable increment** on the selected equipment.
- **When the step is too big:** if that jump is > ~10%, or the machine is at its max, it progresses **reps** instead, up to the rule's rep cap. At the cap it **holds** and explains the step size. It doesn't add sets until Ben decides D2.
- **What it never does:** add sets (until D2), run rule 1's volume growth, change goals or plans, or produce coach-style wording.

**Applies when (stated honestly, 9 Oct):**
- **The coach is unavailable** (not connected, offline, failed or over its limit). Targets are tagged `Built-in rule (coach offline)` or `Built-in rule (coach unavailable)`.
- **The coach is connected but no coach target has been applied** for that exercise: Ben tapped `Not now`, the proposal expired, or the coach agreed. Under CLAUDE.md rule 3, future-session changes are always proposals, so something has to set the target when Ben doesn't apply one; today that's 7-F. Targets are tagged `Built-in rule`, and the summary shows the coach's alternative beside them.
- Whether the coach's target should apply in that second case instead is **D21**. It needs Ben's decision, plus a CLAUDE.md rule 3 and ADR 0006 change if he chooses it.

**Rep caps (provisional built-in defaults by exercise category; D16).** Main barbell lifts 3–6 reps, progress at RPE ≤ 8.5, cap 8. Other compounds 6–10 reps, RPE ≤ 9, cap 12. Accessories 8–12 reps, RPE ≤ 9, cap 15. These are the values in `packages/domain/src/default-rule.ts` (checked 9 Oct).

**Grade:** Weak + Practice. Double progression is common practice; that rep progression works is Moderate (Plotkin 2022). The ~10% threshold is inference.

**Sources:**
- EQ9 and §9 of [equipment-aware-progression.md](equipment-aware-progression.md); E8.
- [ADR 0006 amendment](../decisions/0006-coach-led-progression.md): "uses the smallest achievable increment and progresses reps or sets instead when that jump is too large or hits a machine's max".

**Method:**
1. **Pain flag active:** hold.
2. **Not qualified:** use the existing hold / hold-after-miss / reduce logic. Reduce only after ≥ 2 missed sessions, snapping easier.
3. **Candidate load:** the next achievable load up. J = its % jump.
4. **J ≤ ~10% and below max:** increase, and target the full rep range.
5. **J > ~10%, or at max:** +1 rep per session up to the cap. Then hold ("ceiling"), naming the step and the options: microplates or add-ons in the gym profile, or ask the coach. (Adding one set at the cap is a D2 alternative and is off.)
6. **Assisted machines without a logged bodyweight:** one assistance step, shown as "% not checked".
7. **Explain** with the real step and its % ("Next dumbbell is 12 kg, +20%: adding reps first"), using the label *Built-in rule (coach offline)* or *Built-in rule* (coach connected, no coach target applied).

**Defaults:** the smallest increment, reps first, holding at the cap and the ~10% threshold are defaults. D2 and D3 cover the research alternatives:
- aim for ≈ +2.5% instead of the smallest increment;
- a reps check for steps of 5–10%;
- one set at the rep cap, within rule 1's session budget and goal range;
- one earned bigger jump at the rep cap.

**Guardrails:**
- Pain holds the built-in rule.
- Targets are snapped and kept within min/max.
- Next-session targets show their reason and their % change. The built-in rule doesn't change templates or set counts.
- Today's code doesn't yet enforce the ~10% limit (`maxLoadJump: null`; PM notes). Until it does, the playbook screens show a `This app version` card saying so (coaching-playbook PB15).

### Rule 8: Stalls (approved)

**Rule.** A stall is 2–3 sessions failing the same target. Then propose a 5–10% reset or a rep-scheme change. One bad session gets a note only.

**Applies when:** setting next-session targets.

**Grade:** Practice.

**Sources:** E13; [StrongLifts](https://support.stronglifts.com/article/22-increments); [GZCLP](https://thefitness.wiki/routines/gzclp/).

**Guardrails:**
- Resets are proposals.
- Sessions are compared within the same routine slot.
- Under Maintain, only a sustained drop counts as a stall.

### Rule 9: Rest (approved)

**Rule.** Rest 2–3 min (up to 5) on heavy compounds, and 1–2 min on isolation work.

**Applies when:** setting rest presets and shortening sessions.

**Grade:** Moderate.

**Sources:** E10; [Singer 2024](https://www.frontiersin.org/journals/sports-and-active-living/articles/10.3389/fspor.2024.1429789/text).

**Guardrails:** none beyond the common set. Shorter rest when time is short is fine; expect fewer reps.

### Rule 10: Deloads (approved)

**Rule.** Deload when performance drops across ≥ 2 sessions (≈ halve sets, RPE ≤ 7, ~1 week), or every 4–8 weeks if Ben prefers. Always a proposal.

**Applies when:** planning future sessions.

**Grade:** Weak + Practice.

**Sources:** E11; [Coleman 2024](https://pmc.ncbi.nlm.nih.gov/articles/PMC10809978/); [Bell 2023](https://pmc.ncbi.nlm.nih.gov/articles/PMC10511399/).

**Guardrails:**
- Always a proposal with Apply and Undo.
- A taper replaces a deload in event weeks.

### Rule 11: Same-day order (approved; only when the endurance switch is on)

**Rule.** Same day with strength as the priority: lift first and keep the endurance part easy. If the day's endurance session is a key one, do it first and cut leg volume.

**Applies when:** planning a day that has both, while the endurance switch is on. "Lift first" applies only when lifting is the priority (the rule's own condition; see "Endurance switch"). With `Support other training` as the main focus, or a priority endurance-type event in its specific or taper phase, only the key-session part applies, and nothing tells Ben to lift first.

**Grade:** Moderate.

**Sources:** C1 in [concurrent-training.md](concurrent-training.md); [Eddens 2018](https://link.springer.com/article/10.1007/s40279-017-0784-1); [Murlasits 2018](https://busqueda.bvsalud.org/portal/resource/es/mdl-28783467).

**Guardrails:**
- The coach doesn't write or overwrite the endurance session.
- Fatigue is used only from planned, imported or reported sessions.

### Rule 12: Spacing and protecting key sessions (approved; only when the endurance switch is on)

**Rule.** Keep heavy lower-body lifting and hard or long endurance ≥ 6 h apart (ideally ≥ 24 h). Keep heavy or high-volume leg work out of the 48 h before a key long run, ride or race. Show the trade-off as a proposal; never overwrite the run.

**Applies when:** weekly scheduling while the endurance switch is on. Matches and hard classes count too (see "How training is run").

**Grade:** Moderate.

**Sources:** C2 and C3; [Robineau 2016](https://pubmed.ncbi.nlm.nih.gov/25546450/); [Burt 2023](https://researchonline.jcu.edu.au/77226/); [Silva 2018](https://pubmed.ncbi.nlm.nih.gov/29098658/).

**Guardrails:**
- Schedule changes are proposals.
- Key sessions are the ones Ben marks.
- No inferred fatigue.

### Rule 13: Heavy-strength floor in endurance phases (approved; "applies when" reworded)

**Rule.** Keep ≥ 2 heavy strength exposures a week through endurance phases (fewer sets, same heavy loads).

**Applies when:** the endurance switch is on **and** endurance is one of Ben's goals: `Support other training` as the main focus, `Endurance` under also matters, or a dated event he described as mainly endurance, from ~8 weeks out to the date. This replaces "Endurance/HYROX blocks", following Ben's "stop with hyrox". (Review fix, 9 Oct: the earlier wording, "the switch is on", let one easy jog turn this on under a Muscle focus. The rule's own "through endurance phases" needs endurance to be a goal.)

**Grade:** Moderate.

**Sources:** C5; [Llanos-Lagos 2024](https://repository.essex.ac.uk/37272/).

**Guardrails:** none beyond the common set. With fewer than 2 stated lifting days, two heavy sessions aren't possible. The coach says so once when Ben asks it to plan, and the weekly plan doesn't show the rule 13 line. Lowering the minimum to 1 heavy session a week in a race or competition period is D8. The evidence for that is Weak: [Rønnestad 2010](https://doi.org/10.1007/s00421-010-1622-4) and [2011](https://www.ncbi.nlm.nih.gov/pubmed/21873897), n = 6–7 per group.

### Rule 14: Removed

The HYROX-specific rule is removed, along with the "HYROX or strength?" question. Ben's words: "stop with hyrox, it should be more adaptable depending on what the goal is / how training is being run". HYROX remains only as library material: [concurrent-training.md](concurrent-training.md) C7 and §5, and [programmes.md](programmes.md). The coach uses that material only when Ben names a HYROX race as an event (rule G). It's then an ordinary named event with no built-in defaults.

### Rule G: Targets follow the goal and how training is run (new, from Ben's direction)

**Rule.** Targets follow Ben's confirmed goal and how his training is run. There are no sport-specific special cases.
- **The main focus** sets reps, effort, weekly sets, rest, order, the progression lever and the deload style.
- **"Also matters" goals** add minimum floors.
- **A named event** adds build → specific → taper phases, based on what Ben says it demands. Phase targets apply only after Ben applies the phase proposal.
- **How training is run** then adjusts the targets: days a week, session length, other training, equipment, experience and any named programme.
- **Rules 11 and 12** apply only while the endurance switch is on: a hard, long or key session in the plan (planned or usual) or logged (imported or reported). **Rule 13** also needs endurance to be one of Ben's goals.
- **Goals change only after Ben confirms,** through a goal proposal and a separate plan proposal, each with Apply and Undo.
- **Every reply that uses this context** says in one line which goal and context it used (e.g. "Strength focus, 3 days, long run Saturday → heavy legs Wednesday").

**Applies when:** always.

**Grade:**
- Practice: the structure, the switch and the confirmation flow.
- The profile values carry their own grades: Strong for heavy loads → strength and weekly sets → size; Moderate for order, frequency, maintenance and tapers.

**Sources:**
- [goal-adaptive.md](goal-adaptive.md) GA1–GA19 (fact-checked 2026-10-09).
- [ACSM 2026 deck](https://acsm.org/wp-content/uploads/2026/03/Pronouncement-ppt-deck_resistance-training-ps.pdf): "Individualization is More Important Than Rigid Rules".
- [WHO 2020 via Okely 2021](https://pmc.ncbi.nlm.nih.gov/articles/PMC9219310).
- [Travis 2020](https://pmc.ncbi.nlm.nih.gov/articles/PMC7552788/); [Bosquet 2007](https://doi.org/10.1249/mss.0b013e31806010e0).
- [Sabag 2018](https://pubmed.ncbi.nlm.nih.gov/29658408/).
- [Rønnestad & Mujika 2014](https://doi.org/10.1111/sms.12104).

**Guardrails:**
- Goals and events are Your data with provenance.
- A plan proposal built on an older goal, setup or other-training version is rejected (guardrail 5).
- The coach never infers a goal.

### Rule T: Mid-session offer triggers compare logged with planned effort (approved; ADR 0006 amendment)

**Rule.** The deterministic offer triggers fire only on working sets, and they use the set's planned effort:
- **"Too hard"** (rule 5) fires when logged RPE ≥ 9.5 and the plan was ≤ 8.5, or when reps fell short of target by ≥ 2.
- **"Too easy"** (rule 6) fires when logged RPE ≤ 6 and the plan was ≥ 8.
- **Never triggers:** warm-ups, and planned all-out, AMRAP or "+" sets.
- **Above 12 reps:** "too easy" never fires on sets above 12 reps.

Thresholds stay editable. A trigger only lets the coach offer ("Want me to adjust the remaining sets?"), and nothing changes until Ben accepts. If Ben mentions pain, the pain flow replaces the offer. Where a set has no planned RPE, the original ADR 0006 thresholds apply (RPE ≥ 9.5, or ≤ 6 on a working set), with the same exclusions (D20).

**Applies when:** every logged working set.

**Grade:** Moderate (ratings are off by about 1 rep on average, and worse above 12 reps) + Practice (the thresholds).

**Sources:** [ADR 0006 amendment](../decisions/0006-coach-led-progression.md); E5–E7; [Halperin 2022](https://pubmed.ncbi.nlm.nih.gov/34542869/).

**Guardrails:** no LLM call after every set, and no other unprompted adjustments (ADR 0006).

## Guardrails that apply to every rule

These are deterministic and can't be overridden by the coach or by any rule here.

1. **Achievable loads (CLAUDE.md rule 4):**
   - Every load is snapped to the selected gym's real equipment: plates, microplates or add-ons in the profile, dumbbell steps and stack increments.
   - Loads stay within min/max and are never extrapolated past a machine's max.
   - Reductions and back-offs round easier (down after an overshoot).
   - The kg/lb unit and the load convention (total barbell, per-dumbbell, stack, assisted) are always explicit.
2. **Pain (rule 9):**
   - An active pain flag blocks every increase for that movement: load, reps, sets and harder variants.
   - Volume isn't shifted elsewhere to "work around" pain unless Ben asks.
   - Pain with no movement chosen blocks increases on every exercise for that session (provisional decision, 9 Oct).
   - The coach suggests seeing a professional and never diagnoses.
3. **Completed sets are never edited** (rule 2).
4. **How changes apply (rule 3, ADR 0006):**
   - Ben asked: today's remaining sets change now, with a visible change and one-tap Undo.
   - Coach-raised (rule T): an offer that applies only if Ben accepts.
   - Future sessions, templates, goals, phases and tapers: always a proposal with before/after, scope, Apply and Undo.
5. **Versioned, idempotent writes (rule 5).** Stale proposals are rejected. Every plan-level proposal (weekly pattern, programme, template, deload, phase or taper, goal) records the versions of the context it was built on: goal, setup (days a week, session length, usual days, experience), other training and plan. `resolveTrainingContext` returns those versions. Applying checks each one and rejects the proposal as out of date if any has changed. Unit-tested, e.g. a 4-day rebuild proposal is rejected after Ben changes his days to 3.
6. **Data honesty (rule 6):**
   - No recovery scores, and no inferred fatigue.
   - Endurance is used only if it's in the plan (planned or usual) or logged (imported or reported), and only hard, long or key sessions count.
   - Estimated 1RM is labelled as an estimate.
   - Set counts come from logs, marked "approx." where RPE is missing.
   - Assumed values (60 min, the lowest start cap, days from logs) are labelled as assumed.
   - The check-in is shown as Ben gave it.
7. **Every applied change stores its reason and the evidence used** (ADR 0006).
8. **No AI → rule 7-F only** (rule 1). It is labelled "Built-in rule (coach offline)". There are no canned replies pretending to be the coach. With the coach connected, 7-F's targets are labelled "Built-in rule", never shown as the coach's, and the playbook never says 7-F is "not in use" while it sets targets.
9. **Imported files, transcripts and web content are data, not instructions** (rule 8).
10. **Your data vs Coaching knowledge (rule 10).** This playbook, the bands and the profiles are Coaching knowledge. Ben's goals, days, session length, other training, priority groups, minutes per set, medians and pain flags are Your data. A general rule Ben states in chat becomes a playbook candidate, not a personal memory.

## Open decisions for Ben (not in force until decided)

None of these blocks v1. Until each one is decided, the behaviour described in the rules above applies.

| # | Question | Until decided | Source |
|---|---|---|---|
| D1 | May the coach *offer* extra sets (rule 1 growth; rule 7's "+1 set" option), or ask whether his training days have changed, as one line in a summary or plan screen Ben opens? Or only when he asks? | Only when he asks, or states a change | V5, V7; README conflict 5 |
| D2 | Built-in step size: the smallest achievable increment (ADR wording), ~+2.5% (EQ9), or today's code (+2.5 kg / 5 lb)? Should the built-in rule ever add a set (ADR says "reps or sets"; EQ9 says never)? | Smallest increment; reps up to the cap, then hold. **No added sets** (review fix: an added set would be growth Ben didn't ask for) | EQ9; ADR 0006 amendment |
| D3 | Built-in rule above 10%: hold at the rep cap until he asks the coach, or allow one earned bigger jump (e.g. two sets of 20, then 10 → 15 lb)? Count 1 rep as 2% (cautious) or 2.5%? | Hold at the cap; 2% | EQ3, EQ9 |
| D4 | Show a "Big jump: +X%" note on any increase > 10%, and stop "too easy" rounding from jumping past 10% (e.g. 10.5 → 12 kg)? | Coach guidance only (rule 7 step 8) | EQ6, EQ10 |
| D5 | An optional bodyweight entry (Your data), so assisted and weighted bodyweight work can show a real %? | Assisted moves one step, "% not checked" | EQ7 |
| D6 | Which gyms have microplates or magnetic add-ons? | Only what the gym profile lists | EQ4 |
| D7 | Should heavy and light days of the same lift each progress from their own history (routine-slot matching)? | Recommended yes; needs a developer change | EQ1; PM notes |
| D8 | Rule 13: with `Support other training` as the main focus in a race or competition period, is 1 heavy session a week the minimum? (Weak) | ≥ 2 | GA6, decision 1 |
| D9 | Rule 3: RPE 6–8 for General fitness and new lifters? (Practice) | 7–9 | GA4, GA13 |
| D10 | "Too easy" offers switched off during taper weeks and softened under Maintain? (Changes ADR 0006 behaviour) | Rule 6 as approved | GA5, GA8 |
| D11 | May the coach ask about a goal change on signals it detects (an event date passed; 3+ weeks of logs not matching the goal), in chat or a summary Ben opens, then not again for ≥ 4 weeks if he says no? | Only when Ben raises it or asks for the next block | GA16, GA19 |
| D12 | Who counts as a "new lifter": under ~6 months (V3, ACSM 2009) or under 1 year (onboarding chip)? | Onboarding chip "Under 1 year" | GA13, V3 |
| D13 | Onboarding and Goals & schedule: add General fitness and Support other training (lifting supports other training) as main-focus options, an "Other training" field (type, effort, usual days, key sessions), an event field (date, demand, priority) and optional priority muscle groups? | **Designed and built into the specs** (onboarding §2.7, profile-and-settings §2.2), **pending Ben's bulk approval** (open-decisions §B). Values Ben sets are used; the coach asks in chat for anything missing when planning | GA1; designer |
| D14 | Scope: the coach schedules lifting around endurance but doesn't write endurance plans? | Assumed yes | GA decision 4 |
| D15 | With no goal set, use General fitness defaults, labelled "No goal set: using general defaults" and never saved as his goal? | Ask when Ben asks for a plan. Meanwhile no goal profile: days and session length only ("No goal set" above) | GA decision 6 |
| D16 | Should the built-in rule's default rep ranges change with the goal, or stay set by exercise category? | By category (provisional decisions; values under 7-F) | GA §9 |
| D17 | Time budget: ~3 min per working set, ~4 min per heavy main-lift set and 10 min warm-up; accessory supersets as the default way to fit more in? | As stated; his own times after 3 sessions | V2 |
| D18 | Count sets with no RPE (e.g. FitNotes imports) as hard, labelled "approx."? | As stated | V1 |
| D19 | Run the plan as a rotation (A, B, C in order) rather than fixed weekdays? | Fixed as planned; a rotation if he asks | V7 |
| D20 | With no planned RPE on a set, use the original ADR 0006 thresholds (RPE ≥ 9.5 / ≤ 6), with the same exclusions? | As stated | Rule T |
| D21 | **Who sets next-session targets when the coach is connected but Ben doesn't apply its proposal?** (A) The coach's target applies, with the change visible on the summary and one-tap Undo. This matches "a default rule won't always work best", but CLAUDE.md rule 3 and ADR 0006 say future-session changes are always proposals, so it needs his explicit change to both. (B) The built-in rule (7-F, equipment-aware) stays the baseline, labelled `Built-in rule`, with the coach's alternative shown beside it and `Apply` one tap away. | (B), shown honestly: 7-F's playbook tag reads `In use: when no coach target is applied`, never "not in use" | Review B1; CLAUDE.md rule 3; ADR 0006 |
| D22 | Rule 5's arithmetic: −5–10% and "≈ 2–4% per RPE point" disagree at one point over plan. Is 5% the minimum drop, or is 2–4% fine for one point over? | 2–4% per point, at least 5% and at most 10%, rounded down to an achievable load | Review S2; E6 |

## Notes for PM, designer and developer (not rules)

- **Provisional file inconsistency.** `docs/decisions/provisional-2026-10-09.md` item 4 still lists "the RPE-vs-planned trigger refinement (the current trigger rule stays)" as Ben's to decide. The CHANGELOG and ADR 0006 amendment record it as approved. Ben's only reply was "Ok.", so please confirm with him, then reconcile the file.
- **Wording outside this folder that the review fixes affect (PM-owned; not edited here):**
  - The ADR 0006 amendment says the built-in rule "only runs without the coach", and CHANGELOG 2026-10-09 says it "stays only as the labelled fallback when the coach is unavailable". Neither matches today's behaviour until Ben decides D21.
  - CHANGELOG 2026-10-09 says rules 11–13 apply "when endurance training is in the plan or imported". The single definition is now under "Endurance switch".
  - `.claude/agents/training-researcher.md` still describes Ben's goals as "strength plus endurance/HYROX-style work". That's agent config, so the PM proposes the edit to Ben.
- **Designer follow-ups made in the same pass** are listed in [open-decisions.md](../design/open-decisions.md) ("Playbook v1 follow-ups").
- **Built-in rule code vs rule 7-F** (from equipment-aware-progression.md; this matters whenever 7-F sets a target, coach offline or not):
  - `packages/domain/src/default-rule.ts` sets `maxLoadJump: null` (line 90, confirmed 2026-10-09). The built-in rule can therefore propose +20–25% dumbbell or stack jumps, which conflicts with 7-F's ~10% threshold.
  - `maxLoadJump` is an absolute mass. A % threshold needs a `ProgressionRule` schema change, a new rule version and an ADR.
  - History matching ignores the routine slot, so a light day can be prescribed the heavy day's load (D7).
  - These findings come from reading the code, not running it.
- **"Too easy" rounding.** [coach-adjustments.md](../design/coach-adjustments.md) §2.6 never rounds below the coach's number, so a +5% suggestion can become +20% on coarse dumbbells (D4).
- **Deterministic context.** A pure domain function, `resolveTrainingContext` (contract in [coaching-playbook.md](../design/coaching-playbook.md) §6), returns the active profile, floors, event phase, endurance switch (with whether rule 11's lift-first part and rule 13 apply), key sessions, session budget, any assumed values, and the goal, setup and other-training versions that proposals record (guardrail 5). The coach and the workout builder both read it; the UI doesn't compute it.
- **Onboarding placeholder.** Done: onboarding.md step 1 now uses a neutral example.
- **Library corrections still pending in evidence-core.md:**
  - The E1, E2 and E12 link labelled "Pelland et al." (sportRxiv 537) is Remmert et al. 2025.
  - E2 and Details §1 link PMC6303131 as Schoenfeld 2017. It's Schoenfeld 2019 MSSE; the 2017 meta-analysis is doi 10.1080/02640414.2016.1210197.
  - This playbook cites the corrected sources directly.

## Copyright and availability

Only summaries and short quotes are used here. Paywalled or paid sources:
- ACSM 2026 full text (the free deck and infographic were used);
- Pelland 2025 journal version (the preprint is open);
- NSCA *Essentials*;
- programme books (*5/3/1 Forever*, *Juggernaut Method 2.0*, RP).

Ben can add his own copies to the app library.

## Decisions by Ben, 9 Oct 2026 (evening)
- **D21:** (A), the coach's next-session targets are the default, with reason and one-tap Undo, limited to small changes (load, reps, sets on the same exercises). Structural changes stay proposals and are raised only when Ben asks for variety or something changed. See ADR 0006 amendment 2.
- **D19:** the next workout follows what Ben last trained (rotation by last session), not fixed weekdays.
- **All other open decisions (D1–D18, D20, D22):** the proposed defaults are approved.
