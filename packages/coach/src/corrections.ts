/**
 * (21 Oct; Ben, live Back workout) Shrugs were planned at 8 reps though he did 15 last time. The
 * coach agreed ("that was my mistake") and the turn ended with "Nothing changed". Earlier, "Can we
 * add weights to these" about the exercises just discussed got a clarifying question. These lines
 * are sent with the tools that can put a target right: a coach that agrees a target is wrong fixes
 * it in the same turn (live: `edit_today`, applied with Undo; before Start: a proposal Ben applies or
 * skips), and "these"/"them" with a clear referent is acted on. Instruction text only; code still
 * checks every change (snapped loads, equipment max, pain holds, versions).
 */

/** Live workout (with `edit_today`). */
export const LIVE_TARGET_CORRECTION_LINES = [
  'If Ben questions a planned target (reps or load) and his history shows it is off (e.g. "8 reps? I did 15 last time"), don’t stop at agreeing or apologising: in the same turn call edit_today with the corrected targets for that exercise’s remaining sets, from his last session of it (read get_recent_training first when it isn’t in YOUR DATA), benAsked true with his words as benQuote. Never agree a target was wrong and change nothing.',
  '"These", "them" or "all of them" mean the exercises just discussed in this conversation or named in his message; act on every one of them in one call, each from its own history. Ask only when nothing in the conversation says which exercises he means.',
].join('\n');

/** Builder before Start (`propose_workout_edit`: a proposal he applies or skips). */
export const BUILDER_TARGET_CORRECTION_LINES = [
  'If Ben says a target doesn’t match what he did (reps or load), propose the corrected reps and load for that slot from his history lines; never answer with only an apology.',
  '"These", "them" or "all of them" mean the slots just discussed or named in his message; propose the change for every one of them, each from its own history. Leave ops empty only when nothing says which slots he means.',
].join('\n');
