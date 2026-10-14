VERDICT: CHANGES NEEDED

# Review: mid-workout coach tools, rename, FitNotes history as a basis (claude/coach-midworkout)

Reviewer: independent reviewer agent, 14 Oct 2026.
Scope: `claude/gracious-knuth-joxqpw...claude/coach-midworkout` at `ab4c9e0` (commits `8580b84`, `ab4c9e0`).
Checked against CLAUDE.md rules 2, 3, 5 and 8, `docs/design/coach-adjustments.md` (CA1, WT-D4 in active-workout.md),
the 13 Oct "Build from chat: offer the tool" CHANGELOG precedent, and the build-151 task: Ben's live-workout message
"can you repopulate the weights based on my maximum working weight recently?", the rename request, and the
"not a verified like-for-like basis" wording.

What works: Ben's exact message now gets `adjust_pending_sets` offered, the gate counts it as a request, and the call
applies at once with a card and one-tap Undo. Done sets stay untouched, loads are snapped, and a stale base version is
refused. An unprompted call is never run: it becomes the `adjust_today` offer, and the new thread row accepts it.
`rename_workout` is versioned, idempotent (replay test) and undoable. The "never compared / like for like" wording is
gone from every prompt and tool text, and `IMPORTED_NOTE` presents FitNotes history as Ben's own. Migration 17 is a
faithful rebuild of 14's table with the new kind.

The blocking problem: the new broad "Ben asked" test has no sense of scope, so a request about *next time* is applied
to *today*.

## Checks run

- `npm run typecheck`: exit 0.
- `npx eslint .`: exit 0.
- `npx vitest run --maxWorkers=2`: exit 0. 318 files, 6513 passed, 1 todo.
- `npm run check:migrations`: "Migrations OK: 1 to 17". No other branch claims migration 17.
- Probe tests run from the session scratchpad (not committed). They used the branch's own `turn-fixtures`,
  `ScriptedCoachModel` and executors, with real SQLite in memory. Results are quoted below.

## Blocking

### B1. A future-scoped request ("make bench heavier next time") is applied to today's sets at once (rule 2 scope, rule 3)

`packages/coach/src/turn.ts:258` (`todayChangeAsked`, `adjust_pending_sets` case), `turn.ts:228` (`setWords`),
`packages/coach/src/request.ts:979` (`TODAY_SET_WORDS`), `turn.ts:292` (`LIVE_WORKOUT_INSTRUCTIONS`).

`mentionsTodaysSets` matches "heavier", "weights", "sets" and similar words with no regard to scope.
`todayChangeAsked('adjust_pending_sets', …)` then returns true. The `add_exercise_today` case does have a future-scope
guard (`!isStructuralRequest(r) && !requestHas(r, 'add_plan')`, review B2), but it only works when the regex
classifier recognises the scope. The adjust case has no guard at all.

Failure scenario (probe, live workout, model calls `adjust_pending_sets`):
`"Make bench heavier next time"` gives classifier `null`, `mentionsTodaysSets` true, and `todayChangeAsked` true for
both adjust **and add**. The result is card `committed` and session version 7 → 8: today's pending bench sets are
raised. The probe saw this turn offer only `get_active_session, get_recent_actions, adjust_pending_sets,
rename_workout, suggest_memory, reply`, so no future-scope tool. (`set_next_session_targets` is summary-only, and
`propose_next_workout_change` opens only on `add_plan`/structural.) Meanwhile `LIVE_WORKOUT_INSTRUCTIONS` says "When
Ben asks for one of these, call the tool; never say you lack a tool". The prompt therefore pushes the model to call
the one change tool it has, and code applies a change Ben asked for *next time* to *today*, unasked. Undo exists, but
rule 3 says a change Ben didn't ask for is an offer, and rule 2 says scope (today-only vs future) must be explicit.
Before this branch the classifier returned null, so the tool was withheld.

The CHANGELOG line "An add scoped to next time or the routine is never applied to today (review B2)" is also not true
for this wording: `todayChangeAsked('add_exercise_today', …)` returns true here too.

Fix:
- In `todayChangeAsked`, treat words with a future scope as "not asked for today" for both `adjust_pending_sets` and
  `add_exercise_today`. Future scope includes "next time / next session / next week / from now on / every … day /
  routine / template / permanently / going forward". Reuse whatever future-scope lexicon `classifyBenRequest`
  already has for `add_plan`/structural, and widen it. The call then becomes the offer card or a refusal line ("That
  would change today; next time's targets are set on the Summary"), never an immediate write.
- Add one line to `LIVE_WORKOUT_INSTRUCTIONS`: these tools change *today only*. A next-time or routine change is not
  one of them.
- Test: in a live workout, "make bench heavier next time" with a scripted `adjust_pending_sets` call gives no
  committed card and an unchanged session version. Do the same for "add curls next push day" with `add_exercise_today`.

## Should fix

### S1. Accepting an "adjust" offer authorises any today-tool, including rename and add (rule 3)

`packages/coach/src/turn.ts:255` (`if (gate.acceptedOffer) return true;` for every tool), `registry.ts:424`.

The offer is always `adjust_today`, and the thread button says `Adjust`. On the accepting turn, all three
today-tools are offered live and `todayChangeAsked` passes them all. Probe: the coach offers "Set 2 looked hard. Want
me to adjust?", Ben says "yes", and the model calls `rename_workout`. The result is `committed`, "Renamed workout:
Hard day.", and the workout name is changed. The same path lets an accepted load offer add an exercise. Ben accepted
a load adjustment, not a rename or an extra exercise.

Fix: an accepted `adjust_today` offer counts only for `adjust_pending_sets`, as `needMet` already says for the
non-live case ("An accepted offer only counts for today's sets (CA1)"). When an unprompted *rename* or *add* is
converted (`turn.ts:723`), either don't make it an `adjust_today` offer, or record which tool was offered (a new offer
kind, or the tool name on the message) and accept only that tool. Test the accept-then-rename case.

### S2. No backstop for a phantom rename, and a rename request isn't "Ben asked" for the no-change line

`packages/coach/src/claims.ts:1070` (`rename_workout` has no facts), `turn.ts:229` (`benAskedForChange` doesn't include
`asksToRename`).

Probe: Ben says "Change name of workout to Chest day" and the model replies "I've renamed the workout to Chest day."
without calling the tool. The sentence is shown (claim check `keep: true`) and the turn note is `null`, so there's no
"No change made." and no card: a phantom change on screen. ("Done, your workout is now called Chest day." is caught,
but "I've renamed…" and "Renamed it." are not.) The structural no-change line exists exactly so that it doesn't depend
on phrase lists. It isn't triggered because `benAskedForChange` ignores rename words.

Fix: add `asksToRename(words)` (live workout) to `benAskedForChange`. Teach the claim parser that "rename(d)/name(d)
… to X / now called X" is a change claim backed only by a committed `rename_workout` whose `after` matches. Test both.

### S3. The "no tool" failure mode is prompt-only; nothing deterministic stops "I don't have a tool to …"

`packages/coach/src/turn.ts:292`, `packages/coach/src/reply.ts:223` (the build-131 `claimsNoBuildTool` precedent).

The task asked that the coach *never* say it lacks a tool when one exists. The branch fixes the root cause (the tool
is now offered) and adds an instruction. The exact build-151 sentence, "I don't have a tool to repopulate them directly
here.", still passes the reply filter unchanged (probe: `keep: true`). Build 131 solved the same problem for builds
with a deterministic hide-and-replace (`claimsNoBuildTool` + `NO_BUILD_TOOL_DETAIL`).

Fix: when a today-tool was offered this turn and none was called, hide sentences that claim no tool or ability to
change today's sets, rename or add. Show them in `Why?` as "The coach can change today's sets." and add one short line
in their place ("Want me to adjust?" makes it an `adjust_today` offer). Test with the build-151 reply text.

### S4. Rename of "today's plan" (before Start) is not built, though the task asked for it

`packages/coach/src/rename.ts:314` (refuses anything not `active`), `registry.ts` (`turnKinds: ['workout']`).

The task said "live session or today's plan name". The CHANGELOG says plainly that this is not built, which is
honest. A rename asked from the Today entry (general turn) still gets no tool, so it can hit the same "no tool" reply
this slice is meant to remove. An open-ended live workout is also refused until Finish (audit B1). Ben's build-151
workout was named by a draft ("Chest, abs, triceps · 60 min"), so his case works. Either build the pre-start rename
(the draft/plan name, versioned, with Undo), or have Ben confirm the deferral. This is listed under Spec issues too.

### S5. `add_exercise_today` is offered on every live turn, but the addable list goes only with "add"-type words

`apps/mobile/src/coach/coach-service.ts:998`, `packages/coach/src/request.ts:1001` (`mentionsAdding`).

"Can I also do some curls?", "chuck on some face pulls" and "let's do dips too" don't match `mentionsAdding`. The tool
is offered with no IDs to choose from, while the instructions say "call the tool; never say you lack a tool". The
model either invents an `exerciseId` (refused card) or says it can't, which is the build-151 failure again for adds.
Fix: when the add list isn't sent, don't offer `add_exercise_today` (and leave it out of `LIVE_WORKOUT_INSTRUCTIONS`).
Alternatively, send a short capped list (as the build path does with 60 entries). Add a test with a non-"add"
phrasing.

### S6. Informational questions count as "Ben asked", so a coach-raised change applies without an offer

`packages/coach/src/request.ts:979`. Probe: "What weight did I do on bench last week?" and "How many sets have I got
left?" give a scripted `adjust_pending_sets` call → `committed`, version 8, no offer. The CHANGELOG records the
trade-off only for "should I drop the weight?". Pure questions about the past or status ("what/how many/did I/was
it") aren't requests to change anything. Excluding a leading wh-question about past or status would keep Ben's
build-151 wording, which is a "can you …" request. This follows the task's word list literally, so see also Spec
issue 1. It also adds "No change made." under ordinary answers ("You have 4 sets left.") because
`benAskedForChange` is now true.

## Nits

- N1. `asksToRename` false positives: "call it a day", "call it quits on bench" and "what should I name this
  workout?" all count as rename requests (probe). This is low risk because the model still has to call the tool, but
  "call it a day" near the end of a workout is common. Exclude `call it (a day|quits)` and questions.
- N2. `sheet-view.ts:386`: the `Adjust` row stays on the thread's last message after the workout is finished or
  discarded. A tap sends `accept_offer` and gets a stale card. Hide the row when the thread's workout isn't active.
  This in-thread button is also new UI not in `coach-sheet.md`/`coach-adjustments.md`. Add it to the spec (and note
  WT-D4: the offer shows no numbers before `Adjust`).
- N3. `OFFER_INSTEAD_LINE` (`turn.ts:271`) asks the model to "say briefly what you would change". The probe shows
  numeric "I'd set … to 102.5 kg" sentences pass the filter, but the numbers aren't snapped yet and may differ from
  what `Adjust` later applies. That conflicts with WT-D4 ("the coach offer shows no numbers before Adjust"). Ask for
  the reason only.
- N4. `rename.ts:308`: a refused rename with no active workout records `sessionId` as the nil UUID. A null/absent
  session in the record would be cleaner than a fake ID.
- N5. No in-place migration-17 test (rows copied, `rename_workout` accepted, 16's kinds still accepted). Other tests
  cover it indirectly through 12→17. A direct test like those for 12 and 15 would make it explicit.
- N6. `get_training_overview` still returns `trend: 'not comparable'` for every exercise whose history is only FitNotes.
  The tool text now steers loads to `get_recent_training`, but a "How am I doing?" answer may still talk about FitNotes
  sets as not comparable. Consider `trend: null` with "app sets only" in the description, rather than a word the model
  echoes.

## Spec issues

1. **The broad "any message mentioning weights/sets/reps/… is a request" rule erodes rule 3.** CLAUDE.md rule 3 says
   that when the coach raises a change on its own it offers first. Under the task's rule, "I did 100 kg last time",
   "my shoulder hurts on the heavy sets" or "how many sets left?" make any change the coach chooses apply at once
   (with Undo). The task text explicitly asked for this, so it isn't a code defect, but Ben should confirm it knowingly.
   The CHANGELOG lists one example. It should list the question and statement cases too. A narrower rule (imperative or
   "can you …" requests plus the old classifier) would still cover the build-151 message.
2. **Scope is missing from the request rule.** The task's word list ("heavier", "lighter", "target", "based on")
   doesn't separate today from next time. B1 is the code consequence, but the CHANGELOG entry should say these tools
   are today-only and that future-scoped wording is never counted.
3. **"Rename today's plan" is in the task but deferred.** The CHANGELOG records it as not built. It needs Ben's call
   (S4).
4. The CHANGELOG entry is correctly marked "pending Ben's confirmation". The "Rule 3 is still decided by code"
   paragraph overstates the add guard ("An add scoped to next time … is never applied to today"). Correct it after B1.
