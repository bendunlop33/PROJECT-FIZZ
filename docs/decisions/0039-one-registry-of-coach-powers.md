# 0039: One registry of coach powers: the entry point sets what the coach sees first, never what it can do

**Status:** PROPOSED (developer, 29 Oct 2026, from Ben's request the same day). Product rules in CLAUDE.md still
hold; two readings need Ben's confirmation (see Consequences).

## Context

Ben, 29 Oct: "Can we make the coach across chats have broader and more homogenous edit rights?" From Today (chip
`Sees: Today`) he said he was achy after legs Monday, pull Tuesday and push Wednesday. The coach suggested a rest
day and not cramming the week, then said: "I don't have a weekly-plan editing tool available in this chat."

ADR 0038 gave every entry `edit_today` while a workout is live. The rest still depended on the turn kind (Today,
Plan, Progress and a Summary's thread are `general`; the live workout's sheet is `workout`), on the builder having
its own one-tool coach, and on word gates that hid tools: `propose_week` opened only on "plan my week around …" words
or code's "more days than gym days" signal, so Ben's Today chat had no week tool at all.

Two more reports the same day folded in here:

- "The mic [on Today] listens but doesn't do anything": Today's bar awaited the builder's Set up model call before
  opening anything, with no progress shown and a dropped (`void`) promise.
- "Why does it get confused with my split?": the coach got the profile's split (Chest, Legs, Shoulders, Back, Full
  body) and the plan in use (Push A … Legs B) side by side and tried to reconcile them.

## Decision

1. **One registry.** Every chat gets the same tools given the same state. A tool is offered only while what it acts
   on exists (`TOOL_TARGET` in `packages/coach/src/registry.ts`): a live workout, this week's days, a plan in use, a
   Your workout draft before Start, today's Set up, the Lift targets setting. Tools gated by Ben's own words keep
   that gate (memory, playbook, pain, logging or correcting a set, a gym's kit, a build or plan request, a structural
   next-workout change), and it is the same in every chat. The post-workout review (an input, not a chat) keeps its
   closed list. The entry only sets the context it opens on (`Sees:`), the thread, and a live workout's light start.
2. **This week, at once when he asks.** `propose_week` is in every chat with a week. Code reads Ben's words (rest
   today, skip, move, spread out, "don't cram", "plan my week around …"): asked → saved and applied at once through
   the same versioned Apply as his tap (`week-at-once:<action>` op), Undo on the card; not asked → a proposal he
   applies (rule 3). A stale week is never changed (rule 5). Not CC10's structural kind: next week is his plan.
3. **Pause/resume** is offered while a plan is in use; it runs only on his pause or resume words, else nothing runs.
4. **The builder's powers in every chat.** `propose_workout_edit` (a Your workout draft before Start: the builder's
   own edit coach makes the change from Ben's words; always a proposal with Apply / Skip, Undo after Apply) and
   `fill_setup` (today's Set up from his words; Undo on Set up). Your workout's bar opens the same thread sheet with
   that draft in context; the separate builder sheet is retired. Records survive a restart: migration 39 adds both
   kinds to `coach_actions`.
5. **Context follows the tools.** YOUR DATA carries this week (days left and done), the live workout, Your workout
   (`builderDraft`), and the plan's pause state wherever their tools are offered. A finished workout's thread with
   another workout live has the live one in context (same tools), the finished one named (`Opened from`).
6. **No "not in this chat".** The prompt says every chat has the same tools; a sentence saying the week or plan
   can't be changed here is hidden where `propose_week` is offered, with one `Want me to change this week?`.
7. **One split.** While a plan is in use (paused too) its days are the split everywhere the coach reads one
   (training details, a build's day, a plan's `splitDays`, the Build card, the last days); the profile's split is
   not sent. A paused plan shows no week to reshape. Profile already showed `Set by your plan` (D7).
8. **Today's bar** opens the coach sheet with the words sent as Ben's message at once; the turn shows running there
   and a failure is the sheet's line. The coach fills Set up (`fill_setup`) or builds, as he asks.

## Tool × entry point

Entries: **T** Today, Plan (opens Today's thread), Progress, an exercise chart; **S** a finished workout's thread
(Summary); **W** the live workout's sheet; **B** Your workout's bar (builder, before Start). "live", "week", "plan",
"draft", "setup" = only while that target exists; "words" = only on Ben's own words.

| Tool | Before (T / S / W / B) | After (every chat) |
|---|---|---|
| `edit_today`, `rename_workout`, offers/Adjust | live / – / ✓ / – | live |
| `log_set`, `correct_set` | – / – / words / – | live + words |
| `think_harder` | – / – / ✓ / – | light start (W) |
| `propose_workout`, `ask_build_question` | ✓ / ✓ / – / – | ✓ (question on a build) |
| `propose_workout_edit` | – / – / – / ✓ (own coach) | draft (proposal) |
| `fill_setup` | Today's bar, Set up's bar (not a chat) | setup (no live workout) + words |
| `propose_plan` (incl. plan edits) | words / words / – / – | words or plan in context |
| `pause_plan` (pause/resume) | pause words / pause words / – / – | plan (runs only on his words) |
| `propose_next_workout_change` | words or signal (T, S, W) / – | words or signal |
| `propose_week` (move/skip/merge this week) | week words or signal / same / – / – | week (at once when asked) |
| `log_activity` | ✓ / ✓ / – / – | ✓ |
| `update_gym` | gym words (T, S, W) / – | gym words |
| `set_lift_target` | setting on (T, S, W) / – | setting on |
| memory, `set_pain_flag`, playbook | words (T, S, W) / – | words |
| `find_exercises`, `propose_exercise` | T, S, W / – | ✓ |
| reads (`get_*`) | ✓ (B: history reads only) | ✓ |
| `set_next_session_targets` | post-workout review only | unchanged (not a chat) |

## Consequences

- **Ben to confirm (rule 3):** a change to *this week* he asks for now applies at once with Undo, like today's sets
  (20 Oct had it always a proposal). Structural future changes (template, split, future weeks) stay proposals.
- **Ben to confirm:** Today's bar no longer opens Set up directly; the coach fills it (`fill_setup`, with an `Open
  Set up` card) or builds, from the same message. Pain words go to the coach as before.
- A draft change from any chat is two model calls (the coach, then the builder's edit coach on his words), so the
  builder sheet answers a little slower than its old one-call sheet. Your workout's inline bar still uses the
  builder's coach directly.
- One week change per week stays the week service's rule: a second ask while one is applied is refused as stale
  (Undo first). Moving a Set days plan day to another weekday is still Library's `Move day`, not the coach.
- Builder Set up's day chips still list body-part days (the builder's own design), not the plan's days.
- Migration 39 rebuilds `coach_actions` (rows kept). Not yet run on Ben's iPhone.
