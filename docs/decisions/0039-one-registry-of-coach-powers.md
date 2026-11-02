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
| `set_exercise_preference` (2 Nov) | – | builder plan + like/dislike words (at once, Undo; swap as a proposal) |
| `propose_rebalance` (2 Nov) | – | plan + muscle/balance words (proposal) |
| `set_next_session_targets` | post-workout review only | unchanged (not a chat) |
| `propose_workout_fix` (2 Nov: a past workout's date, a duplicate, a Health pairing) | – | words (proposal) |

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

## Amendment (30 Oct 2026, Ben's build 486 report)

From a live workout's chat Ben asked to swap leg press and leg extension across his plan and got `Want me to change
this week?` three times ("Yes" and "full plan" ran nothing). Decision 6's replacement assumed every hidden "can't"
sentence was about the week, and no tool changed the plan's days one exercise at a time.

- **`propose_plan_swap`** joins the registry with target `planInUse` (no word gate): one exercise out (`remove`) and one
  in (`add`) in every plan day where it appears, always a proposal (structural, rule 3) with each day's change, Apply
  and Undo. Apply is the day sheet's `plans.editDayEveryWeek` per day (versioned, op IDs derived from the proposal),
  Undo each day's routine revert. `Today too` on the card is a separate today change with Undo.
- **Decision 6 amended:** the replacement offer matches what Ben asked (`threadPlanScope`): `Want me to change your
  plan?` when his words aim at the plan and the plan tool is offered; `Want me to change this week?` only when this week
  is the target (or his words name none and the sentence is about the week). With no plan in use, a "can't change your
  plan" sentence is true and kept.
- **An offer answered:** "Yes" (or a short scope answer) to the coach's own `Want me to …?` is read with the words that
  led to it, and the coach is told to act in this turn.
- **Not preferred:** YOUR DATA carries `notPreferred` (Any preferences on the plan in use) and the plan days' exercises.
  The plan swap's checks never put a not-preferred exercise in (turned round when the coach had it the wrong way, else
  refused with one line on a `Not changed` card).
- Migration 40 adds `propose_plan_swap` to `coach_actions` (rows kept). Not yet run on Ben's iPhone.

## Amendment (31 Oct 2026, Ben's build 493 report): time limits that fit the work, the plan-wide add, solution-first

Ben's Today chat sent "Change my plan: does the plan train enough biceps throughout?" three times and got `No answer in
time. Nothing changed.` each time; his live Pull B chat asked "Can we just add them in after the raises. Can u fix the
plan too?" and got the same. Root causes, from the code (timeouts stored no detail of which timer fired, so the device's
turns can't say more):

- "Change my plan: …" reads as a change to the plan in use, so the turn **forced `propose_plan`**: rewrite every day of
  the plan, at high effort, with the text answer held and a nudge. A reasoning model sends no stream events while it
  thinks; the step's **20 s first-event / 20 s stall** windows cut it off (the 60 s build cap bounded the rest).
- The live two-part ask also forced the whole-plan rewrite (high effort, 60 s cap), and "add them in after the raises"
  didn't read as a change to today, so the quick part waited behind the slow one. No tool could add an exercise across
  the plan (`propose_plan_swap` only swaps).

Decisions:

1. **Time limits (constants in `turn.ts`, `coachTurnTiming`):** live workout 30 s for a simple edit
   (`COACH_WORKOUT_TIMEOUT_MS`), 90 s when his words are about the plan or ask two things
   (`COACH_WORKOUT_PLAN_TIMEOUT_MS`), 60 s for a build; any other chat 120 s about the plan (`COACH_PLAN_TIMEOUT_MS`),
   60 s for a workout build, else no whole-turn cap. Every step: 20 s to the first event and between events, **60 s at
   high effort** (`COACH_HIGH_EFFORT_EVENT_MS`). A timeout keeps which timer fired (`failure.code`: `first_event`,
   `stall`, `turn_cap`).
2. **One lighter retry:** after a timeout (not Stop, nothing of the reply shown), the turn retries once at low effort
   with no forcing, its own 25 s budget (`COACH_LIGHT_RETRY_MS`) and two steps, and the answer carries `Short answer (ran
   out of time).` (rule 1). A second timeout fails the turn: never three silent failures, never a third request.
3. **Targeted plan asks:** with a plan in use and its targeted tools here, a question about the plan or a targeted change
   is answered with a targeted proposal; only a rebuild (days, split, a new plan) forces `propose_plan`. Plan-level steps
   run at high effort; the sheet shows `Thinking… 0:42` (`thinking` progress).
4. **Quick part first:** a live ask for today's change and a plan change (`twoPart`) makes today's change first (forced
   `edit_today`, low effort, applied with Undo since he asked), then the plan proposal. A plan part that fails or times
   out after a full answer never fails the turn: today's card and the answer stand.
5. **`propose_plan_add`** joins the registry with target `planInUse` (every chat with a plan): one exercise into the named
   plan days, every week, straight after a named exercise where the day has it, else at the end; the coach's sets and
   reps; a load only when Ben named it this turn (kept as typed; the gym learns it on Apply), else the workout plans it
   from his history and equipment. Never a not-preferred exercise or one held for pain; never a second copy in a day.
   Its record is a `propose_plan_swap` with `op: 'add'` (no new `coach_actions` kind, **no migration**); the same card,
   Apply (`plans.editDayEveryWeek` per day) and Undo (routine revert).
6. **Asked:** "Can u fix the plan too?", "sort my plan as well", "add curls to my plan" count as asked for a plan
   proposal (`asksPlanFix`); an answer without a plan card is held once and the coach asked for the proposal (or the same
   answer when nothing needs changing). "Add them in after the raises" counts as a change to today.
7. **Solution-first:** the instructions say a gap comes with its fix as a card. A reply that ends by asking "Want me to …?"
   about a fix, with no card, gets one more step to make that card (an offer or a proposal, rule 3 unchanged); the
   answer is then shown without the question. If that step fails, the full answer stands.
8. **Hidden lines:** a true restatement of this turn's saved change is still hidden (its card says it) but no longer
   counted in `N lines hidden`. Explanations of a proposal ("Curls go after the raises on both pull days") are kept.

Not yet run on Ben's iPhone: real reasoning latencies on the ChatGPT-plan route are still unmeasured, so the 60 s and
90/120 s figures are estimates to check against `failure.code` on his next timeouts.

## Amendment (1 Nov 2026, Ben's build 500 report): plan work without a visible time limit, smaller plan turns, no-op edits, plan-day edits

Build 500 had the 31 Oct changes and still failed from a live Push B chat: a plan question ended `Short answer (ran out of
time)`; "Let's stick to 100 … Going forwards plan B should be slightly different?" got a `Couldn't apply … kept sets 4–5
as planned.. Nothing changed.` card, then `Thinking… 0:15` that kept running. Ben: "Still running out of time which I
don't want for changing plans." Causes, from the code: neither message read as plan work (no plan noun: "Push B should
be different", "shoulder-led", "pre-fatigued"), so the first got the 30 s live cap and the short-answer retry; "the
shoulders I just trained" read as an unclear pain mention, which turned the two-part reading off; the plan turn carried
the whole-plan build view and build tools (about 97,000 characters on the fixture) at high effort; and a restatement of
today's target was recorded as a failure.

Decisions (amending 31 Oct decisions 1–3):

1. **Plan work** (`coachTurnTiming`: his words are about the plan or ask today's change and a plan change): no visible
   limit. `COACH_PLAN_WORK_CAP_MS` (5 min) as a safety cap, `COACH_PLAN_EVENT_MS` (3 min) to the first event and between
   events on every plan step, and **no lighter retry** (`lightRetryMs: 0`, and the turn never retries plan work). A real
   failure is one honest line with Try again. The turn already belongs to the service (28 Oct running-turn store), so Ben
   can close the sheet; time in the background still doesn't count. The 90 s and 120 s constants are gone.
2. **Quick work stays quick:** a simple live edit keeps 30 s and the one short retry; today's part of a two-part ask runs
   first with the 20 s windows (`stepTiming`), the plan part after it with the long ones.
3. **Effort:** plan work (targeted or the whole-plan proposal) is **medium**; high only when Ben asks for the deep version
   (`asksDeepAnalysis`) or the coach calls `think_harder`. Workout builds stay high. The sheet shows `Thinking…` with its
   timer on plan steps too.
4. **Smaller plan turns:** a targeted plan turn (plan in use, a plan tool here, not a rebuild or a workout build) leaves
   out `propose_workout`, `propose_plan`, `ask_build_question`, `propose_exercise`, `propose_workout_edit`, `fill_setup`,
   `rename_workout` and `log_activity` (withheld as `plan_work`), and the context drops the build view, the addable list
   (unless he asks to add) and exercise cues (`planWorkContext`). It keeps the plan days (now with each exercise's sets,
   reps, target RPE and main mark), this week, the last 7 days, recent lifts, training details, preferences, pain flags
   and memories. Measured with `requestChars` (about 4 characters a token): about 97,000 → under 60,000 on the Push B
   fixture. This narrows "one registry" for one turn shape only; every power is still there on any other turn.
5. **Reading his words:** "Push B should be (slightly) different", "should the plan change", "reorder Push B", and order
   fatigue with a plan day ("pre-fatigued", "shoulder-led", "just trained", "comes after") count as plan work and as asked
   for a plan proposal (`asksPlanDayChange`, `planLevelAsk`). "Let's stick to 100" counts as today's change. A muscle named
   as what a lift trained ("the shoulders I just trained") is no pain question (`classifyPainMention`); any pain, vague or
   effort word still is (rule 9).
6. **No-op edits:** when every set asked for already has that target, `validateTodayAdjustment` says `already`
   (`alreadyLine`: `Already 100 kg`, `Already 225 lb × 5`, `Already 22.5 kg each`); `edit_today` saves it `rejected` with
   `noop` (nothing written) and the card reads `No change · Already 100 kg.`; the coach is told it is not a failure.
   Refused lines drop the failure's own full stop before `. Nothing changed.`
7. **`propose_plan_day_edit`** joins the registry (target `planInUse`, every chat): one plan day, every week, its order
   (every exercise once) and per exercise working sets, reps, target RPE and main mark; a load only when Ben named it this
   turn. Checked by `planDayEditPreview` (order lists the day exactly, exercises in the day, never splits a superset,
   something changes) and the pain check (never more work on a flagged movement). Recorded as `propose_plan_swap` with
   `op: 'day_edit'` and `dayEdit` (**no migration**); the same card (`Push B` and one line per change), Apply (one
   versioned `plans.editDayRowsEveryWeek` write, op ID from the proposal, `Out of date` if the day changed) and Undo
   (routine revert). Its tool line tells the coach to fix an ordering problem with a card: reorder, make the later lift
   secondary (main false, fewer sets, lower RPE) or swap.

Not yet run on Ben's iPhone.

## Amendment (2 Nov 2026, Ben approved coach tools for past workouts)

- **`propose_workout_fix`** joins the registry in every chat, opened only by Ben's words about fixing a past workout
  (`asksPastWorkoutFix`, gate `pastWorkoutWords`, like `update_gym`'s gym words), so an ordinary turn carries neither the
  tool nor its prompt line. Ops: `move` (date or times), `delete` (a duplicate or wrong workout), `pair` (a Health workout
  with an app workout, or with the planned run that day), `unpair`. Always a proposal (`fix_workout` record) with before →
  after, Apply and Undo (rule 2); Apply writes a second, committed record with the change in one coach-store transaction,
  through the existing writes (Summary's Edit times `update_session_timing` + `shift`, History's soft delete, the day
  sheet's link changes via the shared `changeLinkIn`), on the versions proposed; stale is refused (rule 5). Undo is the
  coach store's undo of that record (times back, Restore, Unpair / Pair back).
- **Reads:** `get_recent_sessions` with a date lists each workout's ID and times and that day's Health workouts with their
  pairing state, so the coach names the right one.
- **Not built:** merging two app workouts (the store has none; the coach proposes deleting the duplicate), and pairing a
  Health run by hand (a run pairs with the planned run on its own when it is the only one that day).
- **Never list** now reads `Delete or change a past workout without your Apply`; `Delete or rewrite a set, an import or a
  check-in`. Migration 43 adds `fix_workout` to `coach_actions`. Not yet run on Ben's iPhone.
## Amendment (2 Nov 2026, Ben's approval the same day): exercise likes and dislikes, and Rebalance, from every chat

On 1 Nov Ben told the coach to remove leg extension as a preference and his plan didn't change: no tool could set one.
The preferences are the plan builder's **Any preferences** (Plan setup › Edit plan; the plan in use's answers: question
picks, `likes`, `never`), read by the builder, the plan swap and Rebalance. They are not in Profile (Ben to say whether
he wants a Profile entry to them).

1. **`set_exercise_preference`** (target `exercisePrefs`: a builder plan in use and Ben's own like/dislike words this turn,
   `asksExercisePreference`): not preferred, preferred, or none, on the plan's answers (`pbSetExercisePreference`; a
   question whose pick holds it goes back to No preference, nothing else changes). His stated preference, so it applies
   at once with Undo (rule 3); the call is never run on words that don't state it. One versioned write of the plan
   document with its record (`exercise_pref`, rule 5); every builder version's answers carry it, so an Undo of a later
   plan edit can't bring the old preference back. Undo only while the preferences are as it left them.
2. **The swap on the same card:** when a newly not-preferred exercise is in the plan, the record carries a
   `propose_plan_swap` proposal (the 30 Oct engine and card: each day's change, Apply, Undo, `Today too`; a day changed
   since is `Out of date`). The substitute: the coach's `swapTo` from get_substitutions when it is usable here, not
   pain-flagged, not itself not preferred and leads with the same muscle group; else the app's pick (his pick on that
   question, then the catalogue's substitutes, the builder's other options for that slot, the movement family), with the
   same checks. Already not preferred (set on Plan setup): nothing is written; the swap is its own card. Plan setup's
   `In your plan · Replace` uses the same pick (now also same-muscle).
3. **`propose_rebalance`** (target `rebalanceOpen`: Rebalance can run on the plan in use and his words are about muscles or
   balance, `asksMuscleBalance`): the record is Plan › Muscles' Rebalance card from the **same engine and service**
   (`planMuscles.rebalance`), lines, bars, day lengths and Why? as the screen shows them; the coach card draws the
   screen's own body (`RebalanceBody`). Per-line skip, Apply (`planMuscles.apply` on the version the coach read, op ID
   from the record, refused when the plan moved on) and Undo (only while that Apply is the plan's last edit); the card's
   state is read from the plan's op IDs, so it survives a restart. No focus input: the engine fills every gap in order,
   and the ranges are the approved V1/V4 ones (FQ/VC/ST candidates not used). Nothing to propose: one line, no card.
4. **Turn size:** both tools, their prompt lines and descriptions load only on the words that need them, so plan turns
   don't grow (1 Nov `planWorkContext` unchanged). `propose_rebalance` counts as a plan card for the plan-part nudge.
5. **Migration 42** adds `set_exercise_preference` and `propose_rebalance` to `coach_actions` (rows kept, as 41 did).

## Amendment (2 Nov 2026, Ben's build 513 report): cardio first as a setting, plan adds at a place with minutes, partial asks said once

Ben asked for "bike for 8 minutes first on leg days, rowing for 4 minutes first on other days". The coach offered
incomplete `propose_plan_add` cards again and again, then said its tools couldn't set a timed warm-up or place a new
exercise first.

1. **`update_warmup_prefs` gains `general`** (nullable, optional for older calls): per kind of day (`legs`, `other`,
   `all`) a cardio exercise (name or catalogueId) and minutes (0 turns that day's off). It is a standing setting on the
   training profile (`warmups.general`), so it survives plan edits, a re-applied plan and a new plan, and every workout
   Ben starts gets it first. The turn reads Ben's words (`asksForGeneralWarmup`: a cardio word, minutes, first/before,
   and a kind of day or every day); applied at once with Undo when he asked, never on the coach's own idea. Its tool
   line routes "X minutes of bike before every leg day" here and keeps "add a bike to today" a today edit. Recorded as
   the existing `update_warmup_prefs` kind (**no migration**: the record's `before`/`after` are the profile's JSON).
2. **`propose_plan_add` gains a place and timed targets:** `position` (`first`, `last`, `before` with `before`,
   `after`), `minutes` and `distanceM` for cardio or timed work, and `dayType` (`legs`, `other`, `all`) to add to every
   day of a kind in one proposal (leg days by the same rule as the setting). `days` may be empty when `dayType` is
   given. The record (`propose_plan_swap`, `op: 'add'`) carries `position`, `beforeId`/`beforeName`, `durationS`,
   `distanceM` and each day's `first`/`beforeRowId`; Apply passes them to `plans.editDayEveryWeek` (one versioned write
   per day, a day changed since refuses all and puts back anything written). **No migration.**
3. **Partial asks:** `PARTIAL_ASK_LINE` in the instructions: check the tools cover the whole ask, say what they can't
   in one line in the first reply, make the part they can once, and put the missing part in `notIncluded`
   (`propose_plan_add`), which the card shows as `Partial · not included: …`. Never the same partial proposal again.

Not yet run on Ben's iPhone.
