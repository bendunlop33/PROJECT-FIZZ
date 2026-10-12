# 0006: Coach-led progression with deterministic guardrails

**Status:** Accepted by Ben, 2026-10-08

## Context
Ben doesn't want fixed progression rules setting his numbers. He wants the coach (ChatGPT) to reflect on how a set went and give him the best weights and sets, but only when he asks or when it clearly should. Example: he logs RPE 10.

## Decision
- **When the coach is invoked:**
  - **(a)** Ben asks, by voice or text ("that was a grind", "too easy, what next?").
  - **(b)** A deterministic trigger fires and the coach *offers* help. Triggers are cheap checks in `packages/domain`: RPE ≥ 9.5, reps short of target by at least 2, or RPE ≤ 6 on a working set. The thresholds are editable.
  - There are no other unprompted adjustments and no LLM call after every set.
- **How changes apply:**
  - Today's remaining sets, when Ben asked: apply immediately, with the change visible and one-tap Undo.
  - Coach-raised (trigger): a one-line offer ("Want me to adjust the remaining sets?"). Nothing changes until Ben accepts.
  - Future sessions and templates: always a proposal with before/after, Apply and Undo.
- **Guardrails** (deterministic, cannot be overridden by the model):
  - Suggested loads are snapped to achievable loads on the session's equipment, within min/max.
  - Pain flags block increases for that movement.
  - Completed sets are never edited.
  - Stale suggestions are rejected (version checks).
  - Every applied change stores the coach's reason and the evidence it used.
- **Fallback:** with no AI available, the existing `calculateNextTargets` rules provide next-session targets. The UI labels them "Built-in rule (coach offline)".

## Consequences
- The progression engine built in step 1 is kept, as the fallback and as the source of feasibility checks.
- CLAUDE.md rule 3 is rewritten.
- The coach becomes central, which raises the priority of the ChatGPT-plan sign-in spike (S1) and the personal-key fallback.
- The designs need updating: the summary "Next time" section, rest-card offers, Undo banners, and the source labels "Coach" vs "Built-in rule".

## Amendment, 2026-10-09 (approved by Ben with playbook v1)
- **Trigger compares against the plan.** The deterministic offer triggers use the set's *planned* effort: "too hard" fires on logged RPE ≥ 9.5 when the plan was ≤ 8.5 (or reps short by ≥ 2); "too easy" fires on logged RPE ≤ 6 when the plan was ≥ 8. Warm-ups and planned all-out/AMRAP sets never trigger, and "too easy" never fires on sets above 12 reps. Thresholds stay editable.
- **Progression is coach-chosen and equipment-aware.** When the coach is available it picks load, reps and sets from the selected gym's real equipment and Ben's history (playbook v1 rule 7). The built-in rule (playbook v1 rule 7-F) keeps its `Built-in rule` label and sets next-session targets when the coach is unavailable or no coach target has been applied (who wins when the coach is connected but Ben doesn't tap Apply is open decision D21). It uses the smallest achievable increment, and when that jump is over ~10% or hits a machine's max it progresses reps up to the cap and then holds; it never adds sets on its own (D2).

## Amendment 2, 2026-10-09 (Ben, decision D21)
- **The coach's next-session targets are the default.** After a workout, the coach's small adjustments (load, reps or sets on the same exercises) apply to the next session without a tap, shown on the Summary with their reason and one-tap Undo. The built-in rule (7-F) is the labelled fallback only when the coach is unavailable or produced no target. Every guardrail still applies (achievable loads, machine min/max, pain blocks, completed sets never edited, version checks).
- **Small changes only.** The coach keeps the workout's structure. Swapping, adding or removing exercises, changing order, split or templates stay proposals with Apply/Undo, and are raised only when Ben asks (for example for variety) or something has changed (goal, schedule, equipment, pain).
- CLAUDE.md rule 3 is rewritten to match.

## Amendment 3, 2026-10-11 (Ben: "Offers follow the target RPE"; built-in fallback for today's sets)
Ben: "The recommendation rule to adjust should be based on what target RPE was, which should be driven by AI coach recommendation to optimise sets or override from human. Hitting 10 RPE is not bad if that was the plan." Also his build 108 report that the coach "didn't change sets for the set or session". Recorded in `docs/brief/CHANGELOG.md` (2026-10-11 entries).
- **The built-in fallback covers today's remaining sets too** (CLAUDE.md rule 3 as written: "With no AI available, the simple built-in progression rules are the labelled fallback"). This resolves the scope gap in the original Fallback line, which only named next-session targets. With the coach not reachable (not signed in, unavailable, or `Offline`), a trigger shows the built-in rule's concrete change as an **offer** tagged `Rule`; nothing changes until Ben taps `Adjust`, which applies it to that exercise's remaining sets through the same versioned, idempotent write as the coach's, with `Why?` and one-tap Undo. Ben's own `Too hard` / `Too easy` with no coach applies the rule's change at once (he asked). No AI call on any of these paths. Spec: `docs/design/coach-adjustments.md` CA5, CA6, §4.8.
- **Every working set carries a target RPE.** In order: Ben's own override (for a set, an exercise or today, from the exercise `⋯` menu; stored on the workout as Your data, versioned), the coach's recommendation (today's adjustments and next-session targets), the routine's RPE/RIR, else the built-in rule's rep-range profile value (`default-rule.ts`: main barbell 8.5, compound 9, isolation 9; never above the playbook's RPE 9 default ceiling). Shown on the target line as `@ RPE 8`.
- **Triggers are deviation-based** (replaces the fixed numbers in Decision (b) and Amendment 1):
  - "Harder than planned": logged effort ≥ target + 1.5, or reps below the range minimum (any rep below a range's floor; a single-number target short by ≥ 2) unless logged effort is clearly below target (≤ target − 1). No effort logged still counts as a miss.
  - "Easier than planned": logged effort ≤ target − 2 on a set of ≤ 12 reps whose reps weren't short.
  - A target of RPE 10 never triggers "too hard"; following approved rule T ("planned all-out sets never trigger"), it doesn't trigger "too easy" either. Warm-up and drop sets never trigger.
  - The fixed thresholds (RPE ≥ 9.5 / ≤ 6, D20) apply only to a set with no target at all.
- **Change size** (playbook rule 5/6, D22): too hard asks ≈ 2% lighter per RPE point over target (the low end of rule 5's 2–4%), at least 5% and at most 10%, rounded down to an achievable load; if that is more than 10% lighter or there is none, the same load with fewer reps. Too easy: the next achievable step up if ≤ 5%, else +1 rep; never with a pain flag. Bounded by equipment min/max in every unit and convention.
- **Coach-set target RPE and CA8.** The coach may set a target RPE on today's pending sets (a raise counts as an increase, so pain flags and a lighter session block it) and on next-session targets. Because CA8 keeps effort targets unchanged for "small" changes, a next-session target RPE that differs from the last target is "bigger" (a proposal with Apply). Ben's own override is never replaced by the coach and survives the coach's Undo.
