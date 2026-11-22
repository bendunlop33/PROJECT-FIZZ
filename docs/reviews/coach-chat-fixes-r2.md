# Review r2: coach-chat-fixes (build 131: "make me a push session" / "Yes u can add in the app", stuck keyboard)

Branch `claude/coach-chat-fixes` at 2c47737 (r1 fixes) vs `claude/gracious-knuth-joxqpw`.
Reviewer: independent. Date: 13 Oct 2026.

## Verdict: CHANGES NEEDED

Checks:

- `npm run typecheck` passes.
- `npm run lint` is clean.
- `npx vitest run` (default suite) passes: 277 files, 5416 tests, 1 todo.

The r1 blockers are fixed for the phrasings they named:

- **Ben's exact conversation now ends in a draft.** This holds on a fresh thread and in his stored build-131 thread (plan, refusal, then any of "Yes u can add in the app", "yes", "add it"). The draft is `open` with `routineId: null`. No session starts and nothing is saved until he taps Start or Save.
- **The model is pushed to the tool.** On a build turn, a text answer is held, the model is nudged, and the next step forces `propose_workout` by name.
- **The no-tool filter is scoped.** It runs only on general turns where a build is possible and no draft was made, and only on workout or session nouns.
- **The keyboard hides** on drag, on a tap on the transcript, with a `Done` bar, and on Send or Build.

Method: I ran the real `classifyBenRequest`, `buildFollowUp`, `buildFollowUpIn`, `asksForBuild`, `claimsNoBuildTool`, `offersToBuild` and `createReplyFilter` against about 130 phrasings of my own, using temporary probe tests that are now deleted.

Two blockers remain. Both are the same failure the build-131 bug report describes: Ben asks for the session in the app in plain words and gets a text plan or a stall.

---

## Blocking

### B1. Common replies to the coach's own "Want me to build it in the app?" still don't open the tool, and the prompt forbids the coach from saying so
`packages/coach/src/build-ask.ts:52` (`ACCEPT_WORD`), `:92-107` (`buildFollowUp`), `:162-165`; `packages/coach/src/build.ts:190-194` (`NO_BUILD_TOOL_INSTRUCTIONS`)

`NO_BUILD_TOOL_INSTRUCTIONS` makes every described session end with "Want me to build it in the app?". That offer is now the main fallback for every first-turn miss (see B2). It also tells the model "Do not say you or the app cannot build a workout session." The follow-up parser, though, only accepts a fixed word list.

**Probe setup:**

- Ben: "what should I do for push today"
- Coach: "Bench press 3 × 6–8, overhead press 3 × 8–10, dips 3 × 8–12. Want me to build it in the app?"

**Then Ben replies. Result is `asksForBuild === false` (no `propose_workout`) for:**

- "go on then"
- "sure thing"
- "sounds great"
- "that'd be great"
- "yes that would be great"
- "yeah why not"
- "why not"
- "aye"
- "y"
- "deal"
- "Yes please 👍"
- "👍"
- "yes, 45 mins"
- "yes but 45 mins"
- "yes without dips"
- "yes and add some biceps"
- "yes in the app"
- "in the app please"

"go on then" fails everywhere, because `then` isn't stripped after an accept word. "yes but 45 mins" fails because `CHANGE_TAIL` needs "make it". "yes without dips" and "yes and add …" fail because only a "but" tail is read as a change.

**What Ben sees.** The turn has no tool, and the model was told it may not say it can't. So it either promises or claims.

- With `noBuildToolLine: true`, I ran these model sentences through the reply filter. "Done, I've built it in the app.", "Great, building it now." and "It's in your workouts now." are hidden, and Ben sees an empty reply with `Nothing changed · 1 line hidden`.
- "Okay, I'll set that up for you." passes and is shown. That is an invented capability claim (rules 1, 6).

This is the r1 B3 class again, now for the phrasings a British user is most likely to type after an offer.

**Fix:**

- When the last coach message `offersToBuild`, invert the rule. Any reply that isn't a question and isn't a refusal opens `propose_workout`. Refusals include "no", "not now", "later", "don't", "nah" and "maybe later". The words go to the model as Ben's change, and the result is still only a draft (BD12, BD15).
- Keep the fixed accept list only for the "no offer, but a plan was described" path.
- Strip `SIGN_OFF` after accept words ("go on then", "yes mate").
- Read a bare length or exclusion after a yes ("yes, 45 mins", "yes without dips") as a change.
- Add all of the above to `build-ask.test.ts`. Add one end-to-end case ("go on then" after an offer → draft card) in `workout-builder.test.ts`.

### B2. "Add a push workout to the app", in Ben's own words, is not a build request on a first turn
`packages/coach/src/request.ts:606-640` (`BUILD_VERB_WEAK`, `BUILD_DIRECT`, `buildIn`)

Ben's words on build 131 were "add in the app". As a first message, all of these return `classifyBenRequest(...)` without `build`:

- "Can you add a push session to my workouts"
- "add a push workout to the app"
- "put a push session in the app for me"

These are the clearest possible requests for a draft. Instead, the turn has no tool. The coach writes the session as text and ends with "Want me to build it in the app?". That is the build-131 symptom ("the coach replied with a plain-text session") on the most literal phrasing, and it costs Ben a second turn. If he then says "go on then", B1 means he gets nothing.

Other first-turn misses from the probe, which are lower priority once B1 is fixed:

- "make me something for push today"
- "I want to do push today, can you build it"
- "Can you do a push session for me" ("do" needs "me" or "us" straight after)
- "Can you make me a push sess" (the thread title's own truncation; `sesh` is expanded, `sess` is not)

**Fix:**

- Accept `(add|put|save|load|stick) (a|an|new|another) … <BUILD_NOUN> (to|in|into) (the app|my workouts|my routines)` as `build`, and the same with a "can you" prefix.
- A determiner is still required, so "add curls to my workout" (an exercise add) and "put my session in the app" (records) stay out.
- Add these phrasings, and their near-misses, to the diagnosis table in `build-ask.test.ts`.

---

## Should fix

### S1. Sign-offs build a draft after a refusal, and "thanks" builds after an offer
`packages/coach/src/build-ask.ts:52, 162-165`

`ACCEPT_WORD` includes thanks, cheers, cool, nice, perfect, great, lovely, ok, k, mate and coach. An `accept` counts when the last coach message offered **or** said it couldn't build.

In Ben's stored build-131 thread (plan, then refusal), these all open `propose_workout` and make a draft card:

- "ok thanks"
- "thanks mate"
- "cool"
- "nice"
- "perfect"

Each of these is how someone signs off after "I can't put it into the app". In a fresh thread, a bare "thanks" after "Want me to build it in the app?" also builds.

It's only a draft, so nothing is applied. But it is the coach acting when Ben didn't ask (rule 3, "raised only when Ben asks"). It also leaves an unwanted open draft in the thread.

**Fix:**

- After a refusal, require an explicit follow-up or a yes-family word ("yes", "yeah", "yep", "sure", "ok go", "do it").
- After an offer, drop pure thanks or praise words ("thanks", "cool", "nice", "perfect") unless a yes-family word comes with them.
- Test "ok thanks" in the device thread → no build.

### S2. The held-reply fallback hides account and usage errors
`packages/coach/src/turn.ts:550-559`

If the forced `propose_workout` step fails with any error other than cancelled, timeout or network, the held text answer is shown and the turn is `completed`. That includes `usage_limit`, `auth_expired`, `not_eligible` and `model_gone`. Ben sees the plan with no `Usage limit reached.` or `Signed out.` line, so the AI status on that turn isn't honest (rule 1). The fallback exists only for a route that rejects a named `tool_choice`, which surfaces as `unavailable` (bad request).

**Fix:**

- Apply the fallback only when `why === 'unavailable'`.
- Otherwise surface the error with the held text, or without it.
- Add a test where the forced step returns `usage_limit` → status `failed` with `usage_limit`.

### S3. Detector gaps that let the old failure through in other words
`packages/coach/src/build-ask.ts:29, 36, 210-239`

These all come from the probe:

- **`claimsNoBuildTool` misses** "I can't do that in the app.", "I don't have a way to save workouts in the app." and "I don't have a tool for that." On a build-possible general turn, these are the same false claim as build 131.
- **`offersToBuild` misses** "I can build it in the app if you like." and "Want me to set that up?". The coach is told the exact wording, but it paraphrases, and a "yes" after the paraphrase is then not honoured.
- **`describesWorkoutPlan` misses** "Bench press for 6-8 reps, 3 sets. Dips for 8-12 reps, 3 sets." (reps before sets).

Add each one as a test case, then widen the patterns.

### S4. Keyboard drag-to-dismiss inside the padding `KeyboardAvoidingView` is still unverified on device (carried from r1 S5)
`apps/mobile/src/coach/sheet-view.ts:24`, `apps/mobile/src/screens/coach/CoachSheetScreen.tsx:446, 482-492`

- With `interactive`, the keyboard follows the finger only once the drag reaches its top edge, which is now above the `Done` bar.
- The KAV padding doesn't track the drag, so the composer jumps when the keyboard hides.

Tap-outside, `Done` and Send are reliable, which is enough to stop the "can't hide it" bug. Before closing the bug, confirm on Ben's iPhone in the modal presentation. If drag feels wrong, switch to `on-drag`.

---

## Nits

- **N1.** `build-ask.ts:54`: after any plan, a bare "log it", "start it", "make", "do" or "get" builds a draft. "log it" after a plan most likely means "I did it". It's harmless because it's only a draft, but it's surprising. Drop `log`, and require an object for `make`, `do` and `get`.
- **N2.** `CoachSheetScreen.tsx:486`: `onLayout → scrollToEnd` moves Ben to the bottom every time the keyboard shows or hides, even while he is reading older messages. Only scroll when he was already near the end.
- **N3.** `build-ask.ts:242`: on a build turn where the model refused twice (`workout-builder.test.ts`, "review B2" turn 2), Ben has just asked, and the reply is `Say "Build me a workout" to get a draft.`. On a turn where `propose_workout` was offered, show `Try again` instead, using the existing retry affordance.
- **N4.** `CoachSheetScreen.tsx:211`: `Keyboard.dismiss()` on every Send (carried from r1 N3).
- **N5.** `apps/mobile/test/coach-keyboard.test.ts` uses regex checks on the source text (carried from r1 N2). Add a device checklist line: drag, tap, Done, Send, AX3, VoiceOver.
- **N6.** `turn.ts:576`: the nudge log line uses outcome `not_allowed`, which `Why?` shows like a refused tool. A distinct outcome (or plain text) would explain the extra latency without implying something was blocked.

## Checked and fine

- **Ben's exact conversation.**
  - Turn 1: "Can you make me a push session with split squats and calf raises" is now `build`. `split squats` no longer hits `BUILD_LATER`.
  - Turn 2 in a fresh thread: "Yes u can add in the app" is an explicit follow-up and builds.
  - Device thread (plan, then refusal): the r1 B2 phrasings and bare "yes" all build.
  - Length and focus come from Ben's words, newest first (rule 8). The coach's text only gates the tool.
- **Forcing.** Step 0 uses `required`, and the nudge step uses `{type:'function', name:'propose_workout'}`. The provider passes `tool_choice` through (`plan-model-port.ts:144`, `responses.ts` `ToolChoice`). The held text is never streamed before a build was tried. Tests assert both `toolChoice` values.
- **Rules 2, 3 and 5.** Every route in only opens `propose_workout`, which writes an `open` draft. Tests assert no active session and `routineId: null`. A coach message that saved something ends the follow-up look-back, so "add it" twice doesn't make a second draft. The BD15 fixed line yields only when a newer text plan exists. Turn replay returns before any of this.
- **Invented claims.** "Done, I've built it", "It's in your workouts now" and "I've added the push session to the app" are hidden by the existing claim check when no draft card was made.
- **The no-tool filter (r1 B1).** Health-data, programme, saving and add-exercise limits are no longer replaced. The line is shown at most once.
- **Negatives and questions.** "no", "no thanks", "don't add it", "not now", "add it later", "maybe later", "yes but why split squats?", "why split squats?" and "can I do lunges instead" never build.
- **Keyboard.** The transcript `Pressable` is `accessible={false}`, so VoiceOver still reaches the children. Buttons inside it win the responder, and `handled` keeps them working on the first tap. `Done` has a 44 pt target and a label.

## Spec issues

- `docs/design/workout-builder.md` §8.2 still defines the build gate as Ben's words only. The r1 spec note isn't actioned: no design or CHANGELOG change is on the branch. Three behaviours shipped here need Ben's approval and a CHANGELOG entry:
  - the coach's offer as a trigger;
  - the 3-message follow-up window;
  - the forced named tool choice, plus the prompt line forbidding "can't build".
- `docs/design/coach-sheet.md` §2.2 / §6 say Return adds a line and `Send` sits above the keyboard, but don't say how the keyboard hides. Add the four ways shipped here (drag, tap on the conversation, `Done`, Send) so the next change doesn't regress it.
