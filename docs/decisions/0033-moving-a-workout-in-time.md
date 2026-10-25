# 0033: Moving a workout in time, and past logs

**Status:** ACCEPTED by the developer on 25 Oct 2026 for Ben's request (25 Oct: "I should be able to freely edit
times, e.g. if I want to import a workout historically from the day before or beyond"). For PM and reviewer review.
Renumber on merge if another branch took 0033.

## Context

Since 19 Oct the start could move at most a day back and never past the first logged set; set times never moved.
A workout entered a day or more late, or dated wrongly, couldn't be put on its day. ADR 0003 S5 and review R1 made
pauses append-only and unclipped (stored exactly as recorded).

## Decision

1. `update_session_timing` and `finish` take `shift: true`: the new start moves the whole workout by one offset
   (set `completedAt`, the open and closed pauses, rest and work timers and rests kept for an untick, `Finish by`,
   gym changes, a removed exercise's time). Edit times (audits, processed operations, last activity, feel, `Count
   it`, deletion) stay. The end follows, or is the one given. Nothing that has happened may land in the future;
   the start may not be before 2000. A live workout can't move while it runs (a past log can).
2. Audit: the start's timing entry gains `shiftMs`. Recorded times stay recoverable (time now − later shifts).
   Logged values and set versions never change (rule 2); the session version bumps (rule 5).
3. `WorkoutSession.pastLog = { enteredAt }`: a workout entered after the fact. The reducer gives its ticked sets
   placeholder times in tick order (start + 1 s each), starts no rest and refuses Pause and work timers; the
   domain leaves it out of pace and the Live Activity. Starts take `pastStart` on every path; the deload mark is
   read for that date; today's pre-start drafts aren't touched; coach next targets aren't marked used.
4. Migration 37 (renumbered at merge: 36 is the history summaries, ADR 0032): `sessions.past_log`, `timing_audit.shift_ms`. The `session_pauses` no-update trigger is replaced
   by one that allows only a move (same session, ordinal and length to the millisecond). The write path moves a
   stored pause only by the sum of `shiftMs` of the timing entries appended in the same save; anything else is
   still a `HistoryRewriteError`.

## Consequences

- Pauses are no longer strictly immutable rows; their lengths and order are. Every move is in the timing audit.
- Everything that reads "latest" already ordered by `started_at_utc`; tests now pin that a past log never becomes
  last time. The Summary reads an older workout as of its date.
- Moving the start no longer keeps the sets where they were (the 19 Oct "forgot Start" case). Open for Ben:
  `docs/design/log-past-workout.md` Q-PL1.
