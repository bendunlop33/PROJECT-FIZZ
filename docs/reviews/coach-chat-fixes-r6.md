# Review r6: coach-chat-fixes (build 131: offer the build tool, force only on an explicit ask)

Branch `claude/coach-chat-fixes` at ee9851e (r5 fixes) vs `claude/gracious-knuth-joxqpw`.
Reviewer: independent. Date: 13 Oct 2026.

## Verdict: CHANGES NEEDED

Checks (run by the reviewer):

- `npm run typecheck`: passes.
- `npm run lint`: clean.
- `npx vitest run --maxWorkers=2`: 277 files, 5853 passed, 1 todo.

Most of r5 is fixed:

- **r5 B1.** The offered instructions no longer say "Never give loads" or "one short sentence". The build rules are scoped to "Only if you call `propose_workout`".
- **r5 S1.** "back and biceps", "chest and back" and "hard push" sessions are now forced.
- **r5 S2.** `usableFirst` ranks what Ben named and his focus first.
- **r5 S3.** "i want it in the app" and "can you not just add it" are `clear` follow-ups.

Two problems block it, both from the r5 B2 fix in `claimsWorkoutBuilt`:

- **B1.** Once any open coach draft exists in the thread, the backstop stops checking almost every false "it's built" claim, including on turns where Ben has just asked for a **new** workout.
- **B2.** The new "everywhere" patterns (`APP_PLACE`, `SESSION_SUBJECT`) still hide ordinary history sentences on every general turn. The base branch shows these sentences.

**Method.** I ran the real functions against these inputs:

- Functions: `forcesBuild`, `classifyBenRequest`, `classifyPainMention`, `buildPainMention`, `multiWeekScope`, `buildFollowUpIn`, `claimsWorkoutBuilt` and `createReplyFilter`.
- Build phrasings: 41, of which 34 were forced. Of the 7 not forced, "what should I do today" is correct and the other 6 are under S2.
- Must-not-force turns: 25 (pain, advice, history, multi-week), plus 10 extra pain-plus-focus mixes.
- Follow-ups: 40, each in 5 thread shapes:
  - (A) Ben asked, the coach answered with a text plan;
  - (B) the build-131 device thread with the refusal;
  - (C) a plan ending in the offer;
  - (D) a plan with no offer;
  - (E) a history answer.
- Coach sentences: 45, each with `inPlay` and `draftExists` off and on.
- Filter runs: 50 sentences through `createReplyFilter`. Each was compared with `noBuildToolLine: false`, which is the base-branch behaviour, to separate this branch's hiding from the older structural change-claim filter.

All probe files were temporary and have been deleted.

**The original bug** (turn 1 "Can you make me a push session with split squats and calf raises", then turn 2 "Yes u can add in the app"):

- Turn 1 is `forcesBuild` true, so the text answer is held and `propose_workout` is named.
- Turn 2 is a `clear` follow-up in shapes A and B. It gets `BUILD_INSTRUCTIONS` and is offered the tool, not forced (as the PM decision says).
- `apps/mobile/test/workout-builder.test.ts:518` ends in an `open` draft card. Turn 2 still depends on the model choosing the tool (see Spec issues).

---

## Blocking

### B1. Any open draft in the thread turns the "claimed but not built" backstop off, including on build turns (rules 1, 6; PM item 3; regression in ee9851e)
`packages/coach/src/build-ask.ts:548` (`if (opts.draftExists === true) return NEW_WORKOUT_CLAIMS…`), `:473` (`NEW_INDEFINITE`), `packages/coach/src/turn.ts:515` (`draftExists: req.draftInThread === true || req.draftInContext === true`)

`draftInThread` is true whenever the thread holds any committed, still-open coach draft (`coach-service.ts:783-794`). From then on, `claimsWorkoutBuilt` only hides first-person claims about a workout with an indefinite article ("I've built you **a** pull session"). It does this whether or not a build is in play this turn and whether or not a draft was saved this turn.

I ran each of these through `createReplyFilter` with `buildAsked: true`, `toolOffered: true`, `draftExists: true` and nothing built this turn. All are **shown**:

- "Your pull session is ready in the Workouts tab."
- "Your pull session is in the app now."
- "It's ready in your Workouts tab."
- "You'll find it in Workouts."

Without `draftExists`, all four are hidden. The test at `build-ask.test.ts:1005-1013` writes this behaviour in as intended, including "I've added it to your workouts." with `buildAsked: true`.

**Failure scenario.** This is the build-131 thread, one turn later:

1. Turn 2 builds the push draft.
2. Turn 3, Ben: "what would a pull session look like?" The coach replies with a text plan.
3. Turn 4, Ben: "add it". This is a `clear` follow-up, so the tool is offered but not forced.
4. The model doesn't call the tool and replies "Done, your pull session is ready in the Workouts tab."
5. There is no card and no hidden line. Ben opens Workouts and finds only the push draft.

This is exactly the original "claimed but not built" bug. The same thing happens when a forced call is refused: the "Not built" card sits beside "It's ready in your Workouts tab."

**Fix:**

- Apply the `draftExists` narrowing only when **no build is in play** this turn (`buildAsked` false). On those turns, "Your push session is ready in Workouts" really does refer to the existing draft.
- On a build-in-play turn with no draft saved this turn, use the full `EXPLICIT_CLAIMS` and `IN_PLAY_CLAIMS` as before.
- Tests:
  - every sentence above is hidden with `buildAsked: true`, `draftExists: true` and no committed `build_workout` this turn, both with no call and with a rejected call;
  - an end-to-end test in `workout-builder.test.ts`: build a push draft, then a text pull plan, then "add it", with a stub model that replies without calling the tool. No "ready in Workouts" sentence may be shown.

### B2. Everywhere-claims still hide history sentences on every general turn (rules 1, 6; PM item 3; r5 B2 not fully fixed)
`packages/coach/src/build-ask.ts:465-467` (`APP_PLACE`), `:494`, `:496` (`SESSION_SUBJECT` + `APP_PLACE`)

`SESSION_SUBJECT` is not anchored to a "new workout" reading. Because the regex isn't anchored, "Last week's", "Tuesday's" and "Thursday's" just fall outside the match. `APP_PLACE`'s history lookahead only checks the word straight after "app" or "workouts", so "in the app under History" and "in the app's History tab" get past it.

On an ordinary non-build general turn with no draft, these are **shown on the base branch and hidden on this branch**:

| Coach sentence | Ben asked | With the tool | Without the tool |
|---|---|---|---|
| "Last week's pull session is in your workouts." | "did my pull session last week save?" | dropped, `1 line hidden` | replaced by "Want me to build it in the app?" |
| "Tuesday's leg session is in your workouts list." | "where's Tuesday's workout?" | dropped | replaced |
| "Your last session is saved in the app under History." | "did my last session save?" | dropped | replaced |
| "Your session is in the app's History tab." | "where do I find my session?" | dropped | replaced |

"Thursday's session is saved in the app.", "Your workouts are saved in the app." and "Your routine is set up in the app with four exercises." are also matched by `claimsWorkoutBuilt`. The older change-claim filter already hides them on the base branch (see S1), so only the "Want me to build it in the app?" replacement is new there.

The PM decision says never to hide history or advice. These are the plainest history answers there are.

**Fix:**

- Explicit (no build in play) noun-subject claims should need a new-workout subject. That means one of:
  - a determiner from `NEW_INDEFINITE`;
  - "your/the" plus a focus with no past-time modifier.

  Reject a subject preceded by a possessive day or time ("last week's", "<weekday>'s", "yesterday's", "last", "previous", "finished") or followed by "History".
- Extend the `APP_PLACE` negative lookahead to cover `[^.?!]{0,25}\bhistory\b` (the `NOT_HISTORY` already used in `IN_PLAY_CLAIMS`).
- Alternatively, move both noun-subject everywhere patterns to `IN_PLAY_CLAIMS`. Off build turns, a first-person promise or done verb is enough. This is the simplest option, and it matches PM item 3's "explicit done/promise claim".
- Test every row above through `createReplyFilter`. Compare with `noBuildToolLine: false` (identical output) for `toolOffered` true and false.

---

## Should fix

### S1. PM item 3's "r4 B2 examples must pass through unchanged" isn't met end to end (older filter; spec conflict)
`packages/coach/src/claims.ts:1235` (`checkReplyClaims`, unchanged on this branch), `packages/coach/src/reply.ts:244-247`

`claimsWorkoutBuilt` now passes every r4 and r5 B2 sentence. But the structural change-claim rule (PM decision 10 Oct: a change may only be described in a sentence that cites its token) hides 13 of them on every general turn, on the base branch too:

- "It's in your workout history."
- "That's in your workouts from Tuesday."
- "Let me make this simple."
- "I'll make it quick."
- "I'll make that clear."
- "Adding a set this week would help."
- "Making it to the gym three times is great."
- "Building it up slowly is the key."
- "Making this your top set is smart."
- "Yes, your session has been saved."
- "Your workout's saved in History."
- "The session is made up of five exercises."
- "Today's session is sorted: bench first."

The branch tests (`build-ask.test.ts:993-1003`) compare against the plain filter, so they pass, but Ben still doesn't see these sentences. This isn't caused by this branch, but r4 and r5 counted these examples as fixed. Either:

- put the out-of-scope finding to the PM and Ben (see Spec issues), or
- teach `checkReplyClaims` that a sentence with no number, no exercise name and no load or set word isn't a change claim.

### S2. Plainly explicit build requests are neither forced nor `inPlay`
`packages/coach/src/request.ts` (`classifyBenRequest` build kinds), `packages/coach/src/build-ask.ts:573`

These are not `build`, so they aren't forced. They get the 60-entry list, no BD13 build timeout and no in-play done-claim backstop:

- "would you be able to make me a push session"
- "chuck together a push session for me"
- "whip me up a leg session" (while "build me something quick" *is* forced)
- "help me plan todays workout"
- "make me something for today"
- "Push and legs today please"

The first three are the PM's own "make me a … session" shape. The model may still build, so it isn't blocking.

**Fix:**

- Allow "(would|could) you be able to", "chuck/throw/whip (me) (up|together)" before a focus and session noun.
- Add a test row for each phrasing.

### S3. `buildPainMention` removes body parts Ben may be guarding, so these turns are forced with no pain question (rule 9)
`packages/coach/src/request.ts:654-655` (`FOCUS_BEFORE_NOUN`, `FOCUS_LIST_END`), `packages/coach/src/build-ask.ts:558-563`, `packages/coach/src/turn.ts:467`

`classifyPainMention` reads these as `unclear`, but after `withoutFocusRuns` they are `none`. So they are forced and the pain ask is dropped:

- "make me a session avoiding back and shoulders"
- "make me a back session, back and shoulder"

"Avoiding" and a trailing bare body-part list are how people mention a niggle. Rule 9 says when in doubt, ask.

**Fix:**

- Strip a focus list only when it comes straight before a session noun, or straight after "session,"/"workout,".
- Never strip after "avoid/avoiding/without/except/not/no/around/easy on".
- Add both phrasings as not-forced tests.

### S4. Keyboard drag on device is still unverified (carried from r1 to r5)
`apps/mobile/src/coach/sheet-view.ts`, `apps/mobile/src/screens/coach/CoachSheetScreen.tsx`

Not changed, as the PM asked. Confirm on Ben's iPhone before build 131 is called fixed.

---

## Nits

- **N1.** Carried from r5 N1. `docs/brief/CHANGELOG.md:196` still says "Measured" for an estimate. `OFFERED_BUILD_INSTRUCTIONS` is now 1,454 characters (about 360 tokens), not "about 300". §8.2a also still says the cap keeps "Ben's draft and routine exercises first", but it now ranks named and focus exercises first (`usableFirst`).
- **N2.** The CHANGELOG and §8.2a say forcing needs `classifyPainMention` to be `none`. The code uses `buildPainMention`, which also accepts `effort` and focus-only `unclear`. Update the docs, or record it as a PM-approved variation.
- **N3.** Carried from r5 N2. When the model builds on an offered-only turn, the BD13 whole-build timeout still isn't applied (`apps/mobile/src/coach/coach-service.ts:999`).
- **N4.** Carried from r5 N3. "make me a push session, go easy on my shoulder" is still forced with no pain question.
- **N5.** These ordinary non-build messages are pain `unclear` in `classifyPainMention`, which predates this branch:
  - "Push and legs today please"
  - "how many sets should I do for chest?"

  The `turn.ts:467` override covers only `build`-kind words, so these may still get a pain question. Consider applying `buildPainMention`-style focus stripping to any message with no pain vocabulary.
- **N6.** Carried: r4 N4 (`scrollToEnd` on every keyboard change), N5 (nudge logged as `not_allowed`), N6 (source-regex keyboard tests), N7 (a fully hidden reply after a refused build).

## Checked and fine

- **PM item 1.**
  - `propose_workout` is offered on every general words turn with a gym (`registry.ts:396`).
  - The tool description (`registry.ts:249`) and `OFFERED_BUILD_INSTRUCTIONS` say to use it only for an ask or an agreement, and never for pain, advice, history or multi-week plans.
  - The result is still only an `open` draft; Start and Save stay Ben's taps (BD12, BD15).
  - The list is capped at 60 when the tool is offered and 200 when a build is in play.
- **PM item 2.** Forced only by `forcesBuild`. All 34 forced phrasings are `build` and have no pain. These are all not forced:
  - 17 pain-plus-build mixes, e.g. "my shoulder hurts, can you make me a push session", "make me a push session, I tweaked my back yesterday", "make me a pull session, sore back and biceps";
  - 4 advice and history questions;
  - 8 multi-week requests, e.g. "make me a 12 week programme", "build me a weekly plan", "plan my week", "make me a push session every monday for 6 weeks".

  `BUILD_SOMETHING` is narrowed.
- **PM item 3, with no draft in the thread.**
  - The short done-claims "It's saved", "It's been added", "I've set it up", "On it!" and "Coming right up" are hidden when a build is in play.
  - "Want me to build it in the app?" appears only when the tool wasn't offered. With the tool, the claim is just dropped.
  - "Once your workout is done, stretch your hips." and "After the session is done, eat some protein." are now shown.
- **PM item 4.** The multi-week line is in `BUILD_INSTRUCTIONS`, `OFFERED_BUILD_INSTRUCTIONS` and `OFFER_REPLY_BUILD_INSTRUCTIONS`.
- **PM item 5.**
  - In shapes A to C, these build: "yes lol", "haha yes go on", "yes, maybe add curls", "go on then", "aye".
  - In every shape, these don't: "lol", "haha", "maybe later", "ok thanks", "cool", "thanks mate", "no thanks", "not now".
  - Pain follow-ups never count: "my shoulder is sore though", "yes but my shoulder hurts".
  - "try again" after a refusal is `clear` (B). After an offer only, it is `loose` (C).
  - In a history thread (E), no follow-up was matched.
- **r5 B1.** A "what weight for bench?" turn gets no load ban or brevity rule (`build-ask.test.ts` and `workout-builder.test.ts`).
- **Rules 2 and 5.** The executor, idempotency (`coachDraftIdFor(opId)`) and stale-version paths are unchanged. Nothing applies to completed sets.
- **Rule 8.** Length, focus and ranking come only from Ben's words (`buildWordsNewestFirst`). The coach's text only gates.
- **Security and privacy.** No secrets and no new logging of health data.

## Spec issues

- **The structural change-claim rule (10 Oct) conflicts with PM item 3's "never hide history/advice sentences"** (S1). It hides many plain history and advice sentences on every turn. The PM and Ben should decide whether that rule should only look at sentences with change content (numbers, sets, loads, exercise names).
- **Carried from r5.** Turn 2 of the original bug ("Yes u can add in the app") is never forced under the PM rule, so on device it depends on the model choosing the tool. If spike S3 (a named `tool_choice` on the plan route) fails, turn 1 also falls back to the held text. Ben should know this when he confirms. Two options:
  - add "a `clear` follow-up anchored to Ben's own unbuilt build request is forced", or
  - put "forced `propose_workout` on the plan route" on the S3 device checklist.
- **The PM decision is still "pending Ben's confirmation"** in `docs/brief/CHANGELOG.md` and `docs/design/workout-builder.md` §8.2a. Build 131 shouldn't be called fixed until Ben confirms.
- **Carried.** `docs/design/coach-sheet.md` §2.2 and §6 still don't say how the keyboard is dismissed.
