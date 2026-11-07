# Review: coach-chat-fixes (build 131: "make me a push session" / "Yes u can add in the app", stuck keyboard)

Branch `claude/coach-chat-fixes` (commits 453a62a, 2f4d2a9) vs `claude/gracious-knuth-joxqpw`.
Reviewer: independent. Date: 13 Oct 2026.

## Verdict: CHANGES NEEDED

Typecheck passes, lint is clean, and `npx vitest run` passes (277 files, 5370 tests, 1 todo).
On a fresh thread, Ben's exact two turns now end in a draft card. Turn 1 offers `propose_workout`, and a text answer is nudged once. Turn 2 "Yes u can add in the app" is a follow-up that builds the plan. Nothing is started or saved without a tap. The keyboard now hides on Send, on a tap on the transcript, with a Done bar, and on drag.

Three things still block:

- The new "no tool" reply filter hides true sentences and puts a false capability line in their place.
- In Ben's **existing** build-131 thread, which he will reopen, no follow-up builds, not even the same "Yes u can add in the app".
- The new prompt tells the coach to offer "Want me to build it in the app?", but "yes" to that offer often isn't honoured. The coach is also told it may not say it can't build, so the turn makes a promise it can't keep.

Method: I ran the real classifier and follow-up functions against about 75 phrasings of my own (temporary probe test, deleted afterwards). Results are quoted below.

---

## Blocking

### B1. The no-tool filter hides honest sentences and shows a false "Say 'Build me a workout'" line (rules 1, 6; "no invented tool claims")
`packages/coach/src/build-ask.ts:134-147`, `packages/coach/src/reply.ts:197-203`

`claimsNoBuildTool` matches any "I can't / don't have … access / tool / add / save … app / workouts / routines" sentence. The reply filter runs on **every** turn kind (workout, summary, general, and build turns after a draft was made). Each hit is hidden and replaced with `Say "Build me a workout" to get a draft.` Probed:

| Coach sentence | Matched | What Ben sees |
|---|---|---|
| "I don't have access to your Apple Health data in the app." | yes | Only the "Build me a workout" line. A true data-availability statement is suppressed (rule 6 and COACH_INSTRUCTIONS "say so when something is not available"). |
| "I can't save it to your workouts for you — open it and tap Save." (right after a draft card) | yes | "Say Build me a workout to get a draft" under a draft he already has. |
| "I can't add exercises to today's workout in the app." (workout turn, no add tool) | yes | A build hint that does nothing in a workout turn (`asksForBuild` is false for `workout`). |
| "I'm not able to create a programme in the app yet." / "I don't have a tool to change your routines." | yes | True statements (programmes are later, §10) replaced by a wrong hint. |

At the same time, the exact bug class still gets through: "I can't build workouts here.", "I can't build a workout from here." and "Unfortunately I can't create workouts for you." all return `false`.

**Fix:**
- Apply the filter only on `general` turns where a build is actually possible (pass `turnKind` and a `buildAvailable` flag into `createReplyFilter`).
- Only replace the sentence when there's no draft card in this turn's ledger.
- Narrow the regex to the workout or session noun ("workout(s)/session(s)/routine(s)" as the object of create, build, add or put), not any "app" or "access" phrase.
- Add the false positives above, and the three missed phrasings, to `build-ask.test.ts`.

### B2. Ben's actual build-131 thread still can't be finished: every follow-up there is withheld
`packages/coach/src/build-ask.ts:88-101` (`buildFollowUpIn`, "only the last coach message")

The device thread is stored as:

1. Ben: request
2. Coach: PLAN
3. Ben: "Yes u can add in the app"
4. Coach: "…I don't have access to a workout-creation tool…"

After updating, Ben reopens that thread and tries again. With that history the probe gives `asksForBuild === false` for all of these: "add it", "Yes u can add in the app", "add the push session to the app", "yes", "please add that push session", "make that push session in the app". The last coach message has no `N × M` plan, and the Ben message before it isn't a build request.

The same failure happens after any single side-question:

- Ben asks "why split squats?"
- Coach: "They load legs with less spine… Want me to build it in the app?"
- Ben: "yes" or "add it". Result: `false`.

So the PM check "Ben's exact conversation now ends in a draft" only holds on a new thread.

**Fix:**
- Look back a bounded window (for example, the last 3 coach messages, or back to the last coach message with an action) for a plan or an earlier Ben build request.
- Stop at any coach message that already produced a draft.
- Add the four-message device thread verbatim as a test (`apps/mobile/test/workout-builder.test.ts`), plus the side-question case.

### B3. The coach is told to offer "Want me to build it in the app?", but "yes" to that offer is not honoured
`packages/coach/src/build.ts:189-192` (`NO_BUILD_TOOL_INSTRUCTIONS`), `packages/coach/src/build-ask.ts:98`

`NO_BUILD_TOOL_INSTRUCTIONS` makes every non-build general turn end a described session with "Want me to build it in the app?". It also forbids saying the app can't. But `buildFollowUpIn` honours an accept only if the same coach message also matches `SETS_BY_REPS` at least twice, or the Ben message before it classified as `build`. Probed failures:

- Coach: "Bench press: 3 sets, 6-8 reps. Overhead press: 3 sets, 8-10 reps. Want me to build it in the app?" Ben: "yes". Result: `null`, because "3 sets, 6-8 reps" doesn't match `build-ask.ts:26`.
- Ben: "Yes but make it 45 mins". Coach: "Sure, 45 minutes works. Want me to build it in the app?" Ben: "yes" / "yes please" / "do it". Result: `null`.

In each case the next turn has no `propose_workout`, and the instructions forbid the coach from saying so. The coach can only stall or pretend, and B1 hides any honest sentence. That is an invented capability claim made by our own prompt.

**Fix:** when `offersToBuild(lastCoachText)` is true, an `accept` or `explicit` follow-up is enough. The coach's own offer is the "clear signal", and the result is still only a draft (BD12, BD15). Widen `SETS_BY_REPS` to "N sets, M(-K) reps" and "N sets of M-K". Test both sequences end to end.

---

## Should fix

### S1. The coach is nudged once, not forced to call `propose_workout`; a second text answer is still shown as the result
`packages/coach/src/turn.ts:529, 552-557`, `packages/coach/src/model-port.ts:26`

The PM asked for "reliably call propose_workout … a forced/required tool choice on a clear build turn if the provider supports it". The Responses API supports `tool_choice: {type: 'function', name: 'propose_workout'}`, and `plan-model-port.ts:144` already passes `tool_choice` through. Instead the turn holds the first `reply`, feeds back `BUILD_NUDGE_LINE`, and if the model writes text again, shows it with "No change made." (asserted in `workout-builder.test.ts`, "turn 1 … nudged once").

Failure: turn 1 can still end exactly as on build 131 (a plan in text), and the nudge costs a full extra round trip under the 20 s / build-timeout cap.

**Fix:** widen `ModelRequest.toolChoice` to accept a named function. On the nudge step, or on step 0 of a clear `build` classification with no draft revision, send `propose_workout` as the forced choice. Keep the nudge line as the reason. Test that the request carries the named tool choice.

### S2. Natural turn-2 phrasings with a change are not treated as follow-ups
`packages/coach/src/build-ask.ts:44-70`

Probed `buildFollowUp` returns `null` for:

- "yes add it to today"
- "Yes but make it 45 mins"
- "add it but drop the calf raises"
- "yes but swap calf raises for leg press"
- "you can add it to the app though" (Ben's own pushback with "though"; `SIGN_OFF` lacks it)
- "the app can do it"
- "it has a workout builder"

The first four are exactly how Ben edits a plan before taking it. The draft flow already supports revisions (BD16), so a `yes/add … but <change>` after a plan should open the build (the model gets Ben's change in his words). "No" and pure questions ("why split squats?") must stay out, and they already do.

### S3. First-turn gate misses common phrasings
`packages/coach/src/request.ts:606-634`

From my 33 first-turn probes, these are **not** build:

- "can you do me a push session"
- "do me a push workout"
- "sort me out a push session"
- "could you knock up a push session"
- "can you create a chest and triceps workout" ("and" splits the clause; `FOCUS` has no triceps/biceps)
- "can you make me today's workout" (yet "plan today's session" works: `BUILD_VERB_WEAK` lacks `today's`)
- "new workout please"
- "set me up a push workout"
- "Can you program me a push day" ("program" hits `BUILD_LATER`)
- "make me a pull workout for next week" (a single session, but "week" hits `BUILD_LATER`)

After B3 is fixed, the offer-then-yes route covers misses in two turns. Still, add `do|sort out|knock up|set up` to the weak verbs, `today's` to the weak path, and arm-muscle words to `FOCUS`. Limit `BUILD_LATER` "week" to "for (the|this|a) week / weeks / weekly", not "next week".

### S4. `NO_BUILD_TOOL_INSTRUCTIONS` forbids true "can't" statements
`packages/coach/src/build.ts:190`

"Never say you or the app cannot add, save or build workouts" applies to every non-build general turn. That includes Ben asking for a 6-week programme or "save it as a routine" (the coach never saves; Ben taps Save), and the rare case where `buildGym` returns `null` (`coach-service.ts:797-802`). Scope the line to single-session drafts: "The app can build one session as a draft when Ben asks; say so instead of saying you can't." Let the coach state real limits such as programmes and saving for him.

### S5. Interactive keyboard dismissal inside a padding `KeyboardAvoidingView` is unverified on device
`apps/mobile/src/coach/sheet-view.ts:24`, `CoachSheetScreen.tsx:446, 482-491`

The composer is not the input accessory. With `keyboardDismissMode: 'interactive'`:

- the keyboard follows the finger only once the drag reaches its top edge, which is above the new Done bar;
- the KAV padding doesn't track the drag, so the composer jumps when the keyboard finally hides.

This is a known RN behaviour, and it may read as "still stuck" to Ben. Tap-outside, Done and Send are reliable, so this isn't blocking. Before closing the bug, verify on the iPhone (modal presentation). If drag-to-dismiss feels wrong, use `'on-drag'`.

---

## Nits

- **N1.** `request.ts:436-437`: `\bu\b → you` and `\bur\b → your` run on every classification, so "U-bar row" becomes "you-bar row". It's harmless today; restrict it to a following space.
- **N2.** `apps/mobile/test/coach-keyboard.test.ts`: the keyboard tests are regex checks on the source text. They break on formatting and don't prove behaviour. Pair them with a device checklist line in the build notes (drag, tap, Done, Send, rotate, VoiceOver).
- **N3.** `CoachSheetScreen.tsx:211`: `Keyboard.dismiss()` on every Send makes quick back-to-back messages slower than in Messages. Consider dismissing only when the reply is a build or card.
- **N4.** `build-ask.test.ts` `EXPLICIT` includes "start it". That now builds a draft (correct: nothing is started), but the test name doesn't say so. Add an assertion that no session starts for that phrasing.
- **N5.** The held first reply on a nudged build turn isn't recorded anywhere (`hiddenLines`/tool log). Add a `tool` log line "Answer in text; asked to build" so `Why?` and the debug log can explain the extra latency.

## Checked and fine

- Rules 2, 3 and 5: a follow-up or nudge only opens `propose_workout`, which writes an `open` draft with `routineId: null`. No session starts and no routine is saved (asserted in `workout-builder.test.ts`). The executor still enforces gym, pain flags and limits. Turn replay (`startTurn` replayed) returns before any of the new logic, so it's idempotent.
- Rule 8: the coach's text is only used to decide whether the tool is offered. Length and focus come from Ben's words only (`buildRequestWords`, test asserts the quote).
- The BD15 fixed line ("save it" with a draft in thread) correctly yields to a newer text plan (`build.test.ts`, new case).
- `buildTurn` (app) and `gateFor` (turn) share `asksForBuild`, so the "not_in_build" withholding from build 131 can't recur from the gate and context disagreeing.
- Negations and reports ("don't make me a push session", "I asked you to make me a push session yesterday", "if I asked you…") still classify as not-build after the conditional-clause change.

## Spec issues

- `docs/design/workout-builder.md` §8.2 treats the build gate as Ben's words only. Build 131 shows that a coach-made offer ("Want me to build it?") also needs to be a first-class trigger, and the spec should say so. It should also define how far back a follow-up may look (B2), and whether a named tool choice is allowed on a clear build turn (S1). Ben should approve that amendment, and it should go in the brief CHANGELOG.
