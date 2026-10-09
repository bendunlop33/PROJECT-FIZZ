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
