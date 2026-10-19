# 0027: Coach v3: the model reads intent, code checks it

**Status:** Approved by Ben, 18 Oct 2026, after build 156. **Built: slice 1** (intent by the model, verified; build length, focus and gym from the tool's arguments; the add list on every live turn; the last logged set in context). Later slices are listed under "Still to build". **Not working yet:** nothing here has run on Ben's iPhone or against the real plan route. Builds on [ADR 0020](0020-coach-v1.md) and [ADR 0025](0025-coach-built-workout-drafts.md).

## Context

Two reports from Ben's iPhone, 18 Oct 2026:

- **"Can't properly create based on constraints I give."** He asked for a shoulder workout in his hotel gym, dumbbells only, then said "make it 40". The card stayed `Workout · 60 min · Main gym`, and the coach said the tool had no duration setting. Cause: length, focus and gym came only from code's word-matching. "make it 40" has no time word, "shoulder" isn't a parsed focus, and the gym was always the gym in context.
- **"Not adjusting during workout."** He tapped `Too easy`. The coach asked "Was that about the 40 kg overhead-press warm-up, or a working set?". He answered "Working set", and nothing changed. Cause: the coach couldn't see which set was logged last, and "Working set" matched no request pattern, so the call became an offer.

Ben asked "Why isn't the coach more dynamic like AI would be?". He agreed to these points:
- The model decides what he meant.
- Unprompted changes are still offered and wait for his yes.
- Numbers are verified.
- Mid-workout, the coach should judge when it needs to think harder, or whether a lighter model will do.

## Decision

1. **Intent by the model, checked by code** (`packages/coach/src/intent.ts`).
   - Today-change calls (`adjust_pending_sets`, `add_exercise_today`, `rename_workout`) carry `benAsked` and `benQuote`.
   - A call applies at once with Undo when:
     - Ben tapped (a chip, or `Adjust` on an offer). This counts for today's sets only.
     - Or the model says he asked, and its quote is his own words from this turn's message. The quote must be whole words, in order, and at least two words or his whole message.
   - `benAsked: false` makes the call an offer.
   - When there's no claim, or the quote can't be found in his message, the old word lists decide. They are now only the fallback.
   - Words scoped to a later session stay a hard veto. Stale versions, snapping, equipment bounds, pain holds and done-set protection are unchanged.
2. **The last logged set is in context.** `workout.lastLogged` and `workout.lastWorkingSet` give the exercise, warm-up or working, load, reps and RPE. They appear in YOUR DATA and in `get_active_session`.
   - `Too easy` / `Too hard` is about the last working set. The coach is told never to ask which set.
   - After warm-ups only (for the tapped exercise, or for the whole workout), a tap is offered, never applied.
3. **`propose_workout` takes `minutes`, `focus` and `gymName`.** The executor checks each one:
   - **Minutes.** A length Ben stated outright wins: the Build card chip, or a time word in his newest message. If his newest message has exactly one bare number and it differs from the model's, his number wins. Minutes are stepped to 5 and kept within 15–180.
   - **Focus.** The Build card's focus chip wins over the model's.
   - **Gym.** `gymName` must match a saved gym, and the draft is checked against that gym's equipment. An unknown name is refused, and the refusal lists his saved gyms.
   - **Context gym.** The build context is planned at the saved gym Ben's words named, newest message first and including earlier messages in the thread. Otherwise it is the draft's own gym, otherwise the gym in context.
   - **Draft card.** The card shows the gym the draft was built at.
4. **The add list goes on every live-workout turn** with no word gate. It is capped at 60 entries, with the exercises Ben named first.

## Still to build (approved in the same plan)

- One general `edit_today` tool (swap, add, remove, move, set count, set targets) as one composite versioned change with one Undo. Offers are stored as proposed records and applied without re-running the model.
- History reads: records (e1RM labelled est.), recent sessions, a gym summary. A cap on reads and a cache.
- Numbers allowed in replies when they're checked against the facts the coach was given. Unverified sentences are dropped.
- Reasoning effort per turn kind, probed per route. An optional lighter mid-workout model, and a "think harder" step.
- Tone and length limits.

## Consequences

- The fallback word lists can't block a request the model understood and quoted. A model that makes a quote up gets an offer, not a change.
- Every live turn carries about 60 add entries, roughly 1.8k more input tokens.
- Opening a draft built at another gym still plans it at the current gym until Ben switches gym on the overview. This is an open item.
