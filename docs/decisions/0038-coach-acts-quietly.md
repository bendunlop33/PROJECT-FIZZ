# 0038: The coach acts quietly: same tools everywhere, lenient "Ben asked", his numbers as typed

**Status:** PROPOSED (developer, 28 Oct 2026, from Ben's complaint the same day). Product rules in CLAUDE.md
still hold; rule 4's wording needs Ben's confirmation (see Consequences).

## Context

Ben, 28 Oct: "It fails to make the changes I want. It gets very caught up in whether I have equipment or barbells
etc. Just doesn't work as you'd expect." His example: "give me a workout which builds up to 95 kg barbell row as
the last set (with sets and weights)". The exercise was already listed; the coach argued instead of filling in sets
and weights.

Causes found in the code:

- `edit_today` was offered only on the workout's own sheet. Today, Progress and Plan open a general turn, so "add a
  set to rows" or "use 30 kg for curls" there only had `propose_workout` (a whole new draft).
- "Ben asked" needed the model's `benQuote` to match his words exactly; a paraphrase became an offer.
- A weight Ben named was capped at 20% above his last (`checkProposedLoad`, the prompt's ceiling) and rounded to the
  rack. 95 kg against a last 70 kg is 36% up: refused, and the model argued.
- `snapLoad` refused a load with no equipment row (FitNotes imports), a mislabelled convention, or an unachievable
  value; one refused op refused the whole edit; `stale` gave the model no version to retry with.
- `find_exercises` told the model to ask about `update_gym`; guard notes ("isn't possible on this rack") went back
  to the model word for word; `update_gym` didn't refresh today's kit, so the next add still failed.
- "Change my plan to 4 days" with no plan in use had no plan tool.

## Decision

1. **Same tools from every entry.** While a workout is live, a general turn (Today, Progress, Plan) has today's
   workout in its context and `edit_today` / `rename_workout`, with offers and Adjust, exactly as the workout's own
   sheet. The thread stays the general thread. With no live workout they are withheld. "Change my plan …" with no
   plan in use and none open goes to `propose_plan` (forced like a build).
2. **"Ben asked" once per turn, leniently.** With the model's claim (`benAsked: true`), Ben's message this turn
   asking for a change is enough: a short answer, a verb of change at a sentence start or after a polite ask, a
   verbless ask ("instead", "heavier please"), or code's own classifier. The quote's wording no longer matters. A
   statement or an opinion question ("should I go heavier?") is still an offer; `benAsked: false` is still an offer;
   a swap, add, removal or move needs words asking for one ("it's too light" asks for loads only, review coach-fail
   S1). Taps, declines and future-scope vetoes are unchanged.
3. **Ben's own numbers are kept as typed** (`namedWeights` reads them from his words only): no 20% ceiling, no
   rounding to the rack, in `edit_today`, `propose_workout` / `propose_plan` and the builder's edit proposal. Only a
   machine's max (the item's range) caps one, with one line, and pain still holds it (rule 9).
   `adjust_pending_targets` carries `loadAsTyped` for those sets (as `edit_planned_set` does since 27 Oct). The
   coach's own loads are still snapped to achievable values and keep the 20% ceiling; ramp sets it fills in before
   his weight are never above it. A new `sets` op lays out an exercise's remaining working sets in order.
4. **Loads fixed quietly.** Rounding and unit notes stay on the record (`Why?`) but are not fed to the model. On
   today's sets a load with no equipment row is kept as given; a mislabelled convention is read in the exercise's
   own. An add or swap to an exercise the gym's profile lacks goes ahead: the gym learns that kind of equipment (its
   own `update_gym` card with Undo) and today's snapshot is refreshed (`Use changes today`, only when it moves no
   target, as Ben's manual learn does); an applied `update_gym` refreshes it too. An op that can't be done is left
   out with one line and the rest applies as one change with one Undo; a stale edit returns the version to retry.
5. **Prompt trimmed.** The equipment and load "never" rules the code enforces became one line ("make the change;
   never argue about equipment or ask whether he has it"); `find_exercises` no longer suggests asking about the
   gym. Honesty (rules 1, 6) and no-diagnosis stay.

Next session's targets keep the strict checks (no equipment row or a wrong convention is still refused there).

## Consequences

- CLAUDE.md rule 4 says loads "must be achievable on the selected gym's real equipment". The 27 Oct clarification
  (CHANGELOG) limits that to the coach's and the rule's suggestions; this ADR treats a weight Ben names through the
  coach as his own entry. **Ben to confirm**, and CLAUDE.md's wording to follow if he agrees.
- Leniency trades a little rule-3 strictness for fewer missed requests: a message with a change verb and a model
  claim now applies even if the model's quote is its own words. The unprompted case (a statement, an opinion
  question) is still an offer.
- Not done here: Today's coach sheet does not edit the builder's *Your workout* draft before Start; that stays the
  builder's own coach (proposal with Apply/Skip), which now keeps Ben's weights as typed. A draft load Ben named can
  still be re-fitted at Start when newer history arrived in between (`recheckDraftLoad`). Kit learning is for the
  live workout only; a build at a gym without the kit still leaves that exercise out.

## Amendment (Ben, 28 Oct 2026): a weight Ben names is there

Ben: "if i name a weight specifically it probably means its there". This confirms the rule-4 reading above: a
weight Ben names (to the coach, or typed in a set) is his own entry, kept as typed, and **the gym learns it**,
quietly, as his own "learn as you train" does:

- A dumbbell the rack doesn't list (31 kg on a 30/32 rack) is added to that gym's rack; a plate total the plates
  can't make gains the lightest standard plate size that makes it (a pair; one on a single horn). Built:
  `add_plate` in `gymLearnFor` (so typing a set learns a plate too), `namedWeightGymEdit` for the coach.
- In `edit_today` the learn is written in the same transaction as the change and stored on its record
  (`learned`); the change's one Undo takes it back. No question and no extra line.
- Never past a machine's max (rule 4); on a pin-loaded stack a named weight between steps or above the top is kept
  as typed and not learned. (Ben's manual typing on a stack still teaches it, per the 27 Oct rule.)
- Future snapping uses the gym as learned. Today's snapshot is not refreshed under the change (as for a typed
  target), so Undo stays exact.
- **Not done yet:** named weights in proposals (`propose_workout`, `propose_plan`, the builder's
  `propose_workout_edit`) are kept as typed but their Apply doesn't yet teach the gym.

Suggested CLAUDE.md rule 4 wording (for Ben / the main session to apply): "A weight Ben names himself is kept as
typed and the gym learns it (Ben, 28 Oct); never past a machine's max."
