# Review r5: coach-chat-fixes (build 131: offer the build tool, force only on an explicit ask)

Branch `claude/coach-chat-fixes` at 9f46b6e (r4 fixes effe4c6, docs 9f46b6e) vs `claude/gracious-knuth-joxqpw`.
Reviewer: independent. Date: 13 Oct 2026.

## Verdict: CHANGES NEEDED

Checks (run by the reviewer):

- `npm run typecheck`: passes.
- `npm run lint`: clean.
- `npx vitest run --maxWorkers=2`: 277 files, 5803 passed, 1 todo.

The PM direction is implemented, and most of r4 is fixed:

- `propose_workout` is offered on every general turn in Ben's words when he has a gym.
- It is held and forced only by `forcesBuild`.
- `BUILD_SOMETHING` is narrowed.
- Weekly plans are not forced.
- Refused builds can be retried.
- "yes lol" builds and "ok thanks" doesn't.
- Every r4 B2 sentence now passes through.

Two problems block it, and both come from the new design itself:

- **B1.** The build-turn rules now go to every general turn, so every general turn tells the coach never to give loads.
- **B2.** The claim backstop still runs on every general turn, and it hides ordinary advice and history sentences, including true statements about a draft that already exists.

**Method.** I ran the real `forcesBuild`, `classifyBenRequest`, `multiWeekScope`, `buildFollowUpIn`, `claimsWorkoutBuilt`, `claimsNoBuildTool` and `createReplyFilter` against:

- 40 build phrasings and 24 phrasings that must not be forced (pain, advice, history, weekly plans);
- 30 follow-ups in 5 thread shapes:
  - (A) Ben asked, the coach answered with a text plan;
  - (B) the build-131 device thread with the refusal;
  - (C) a plan ending in the offer;
  - (D) a plan with no offer;
  - (R) a refused `build_workout` record;
- 62 coach sentences, each with `inPlay` off and on, plus 5 full replies through the filter.

All probe files were temporary and have been deleted. I also read the end-to-end tests in `apps/mobile/test/workout-builder.test.ts`.

**The original bug.**

- Turn 1, "Can you make me a push session with split squats and calf raises", is `forcesBuild` true. The text answer is held, then `propose_workout` is named.
- Turn 2, "Yes u can add in the app", is a `clear` follow-up in shapes A, B and R. It gets `BUILD_INSTRUCTIONS` with the tool offered, but it is **not forced**, as the PM decision requires.
- The test at `workout-builder.test.ts:518` ends in an `open` draft with `routineId: null` and no session. It uses a stub model that calls the tool on turn 2. On device, turn 2 depends on the model choosing the tool (see Spec issues).

---

## Blocking

### B1. Every general turn now tells the coach "Never give loads, weights or minutes" and "reply in one short sentence" (rule 3; regression in effe4c6)
`packages/coach/src/build.ts:206-213` (`BUILD_RULES`), `:228-232` (`OFFERED_BUILD_INSTRUCTIONS` spreads `...BUILD_RULES`), `packages/coach/src/turn.ts:485-486`

`OFFERED_BUILD_INSTRUCTIONS` is now the default for every general turn with a gym. It includes all of `BUILD_RULES`, and those rules were written for a turn that is building a draft:

- "Never give loads, weights or minutes: the app plans loads from his history and fits the length."
- "Never say the workout was saved, scheduled or started … Then reply in one short sentence."
- "Give targetRpe for every exercise. Stay within build.setBudget working sets."

None of these is scoped to "when you call `propose_workout`". `workout-builder.test.ts` confirms that "how is my bench going?" gets them: it asserts that these instructions contain "Multi-week programmes and weekly plans are not available yet", which is part of `BUILD_RULES`.

**Failure scenario.**

1. Ben asks the Today coach "what weight should I use on bench next time?" or "what did I squat last week?".
2. The model gets `COACH_INSTRUCTIONS`, which says loads must come from his equipment, and then "Never give loads, weights or minutes".
3. It refuses or dodges the number, or answers in one short sentence.

This breaks rule 3: the coach chooses weights when Ben asks. It also changes every general answer, not just build turns. No test covers what a non-build general turn's instructions must *not* contain.

**Fix:**

- Split `BUILD_RULES` into two parts:
  - rules about the call ("in `propose_workout`, never give loads or minutes; targetRpe; setBudget");
  - rules about the reply after a build.
- Write `OFFERED_BUILD_INSTRUCTIONS` so both apply only "if you call `propose_workout`". For example: "When you call `propose_workout`: no loads or minutes in the call; …".
- Keep the multi-week line unconditional.
- Test: the instructions for "how heavy for bench?" do not contain "Never give loads" or "one short sentence", and do contain the offered-tool usage line.

### B2. The claim backstop still hides advice, history and true draft sentences on every general turn (rules 1, 6; PM item 3; r4 B2 not fully fixed)
`packages/coach/src/build-ask.ts:472`, `:474`, `:476` (`EXPLICIT_CLAIMS` built on `NOUN_SUBJECT` + `DONE_STATE`); `packages/coach/src/reply.ts:234-235`

`EXPLICIT_CLAIMS` runs on every turn that can build, which is now every general turn with a gym. In `WORKOUT_OBJECT`, the determiners and focus words before the noun are optional (`{0,3}`), so any "… workout/session is done/saved/sorted/made/ready/set up" matches. That includes a bare "session is done" in the middle of an advice sentence. The `draftSaved` check only looks at `this_turn`, so a draft built on an earlier turn doesn't count.

Hidden on a non-build general turn (each verified through `createReplyFilter`):

| Coach sentence | Context | Ben sees |
|---|---|---|
| "Once your workout is done, stretch your hips." | advice | dropped, plus `Nothing changed · 1 line hidden` |
| "After the session is done, eat some protein." | advice | dropped |
| "Yes, your session has been saved." | Ben asks "did my workout save?" after finishing | dropped |
| "Your workout's saved in History." | history | dropped |
| "Your routines are set up for push, pull and legs." | history | dropped |
| "The session is made up of five exercises." | describing a routine | dropped |
| "Today's session is sorted: bench first." | advice | dropped |
| "Your push session is ready in Workouts." | **true**: draft built last turn, Ben asks "where is it?" | dropped |

When the tool isn't offered, `Want me to build it in the app?` is shown in their place, which is a non-sequitur.

The PM decision says to run the backstop only when the reply makes an explicit claim that a workout was built, added or saved **in the app**, and never to hide history or advice. Line 474 needs no place at all, and lines 472 and 476 accept "Workouts" even when the draft already exists.

**Fix:**

- Move line 474 (noun subject + done state, no place) into `IN_PLAY_CLAIMS`.
- Keep explicit-everywhere only for:
  - first-person promise or done verbs with a new-workout object ("I'll build you…", "I've added it to your workouts");
  - "… ready/added/saved **in the app / Workouts tab**".
- Exclude "is done" and "made up of" from `DONE_STATE` when nothing follows except a clause ("Once … is done,"). Simplest: drop `done` and `made` from the no-place form.
- Skip the backstop entirely when `draftInThread` (or `draftInContext`) is true and the sentence refers to "it", "your session" or "the draft". That draft really is in Workouts.
- Tests: every row above stays visible on a non-build general turn, and on the turn after a built draft, with `toolOffered` true and false.

---

## Should fix

### S1. `forcesBuild` rejects ordinary build requests whose classifier result is `effort`, or `unclear` from a muscle-group pair
`packages/coach/src/build-ask.ts:522-523`; classifier `packages/domain/src/coach/pain-words.ts:394`

`classifyPainMention` returns:

- `effort` for "make me a **hard** push session";
- `unclear` for:
  - "make me a back and biceps session"
  - "make me a pull session, back and biceps"
  - "make me a chest and back workout"
  - "make me a shoulders and arms session"
  - "make me a glutes and hamstrings session"

So none of these is forced, even though each is `build`, while "make me a back session" is forced. Ben's own split (CHANGELOG 12 Oct) is "Back (incl. biceps)", so "back and biceps" is his normal wording.

They still get the tool offered, so the model may build. The `unclear` cases also set `askPain`, which asks Ben about pain he never mentioned. That classifier behaviour predates this branch, but this diff now gates forcing on it.

**Fix:**

- Treat `effort` like `none` in `forcesBuild`.
- For `unclear`, force when the body part is only a training focus. Either fix the classifier for "X and Y" muscle-group pairs before a workout noun, or check `painBodyPart` against `FOCUS_RUN` words.
- Add tests for all six phrasings.

### S2. Offered-only turns get an alphabetically truncated exercise list, so a build the model chooses to make is skewed
`apps/mobile/src/coach/coach-service.ts:855`, `:878-881`; `packages/coach/src/build.ts:89-110`

When Ben's words aren't a regex build, `inPlay` is false and `build.usable` is capped at 60. The cap keeps the draft's and routines' exercises first, then fills the rest alphabetically. Examples of such words:

- "would you be able to make me a push session"
- "chuck together a push session for me"
- "help me plan todays workout"
- "Push and legs today please"

The design now relies on the model building on exactly these turns. Exercises Ben names ("split squats", "calf raises") or that fit the parsed focus can be missing, so the draft is built from whatever starts with A to F plus his routines. The executor accepts any doable exercise, but the instructions say "only catalogueIds from build.usable".

**Fix:**

- In `capUsable`, rank exercises named in Ben's words and those matching the parsed focus ahead of the alphabetical fill.
- Or, when the model calls `propose_workout` on an offered-only turn, accept any doable exercise and say so in the instructions.
- Test with "would you be able to make me a push session with split squats" against a pool of more than 60 exercises.

### S3. r4 S3 follow-ups still return no follow-up (mitigated, not fixed)
`packages/coach/src/build-ask.ts` (`followsUp`)

- "i want it in the app" is `null` in A, B, D and R, and `loose` in C.
- "can you not just add it" is `null` in every shape.

With the tool now offered, the model can still build from them, but they get the generic offered instructions rather than the build ones. Cheap fix: add `i want it in the app` to `PLACE_ONLY`/`FOLLOW`, and "(can|could) you not just add" to `PUSHBACK`.

### S4. Keyboard drag on device is still unverified (carried from r1 to r4)
`apps/mobile/src/coach/sheet-view.ts:24`, `apps/mobile/src/screens/coach/CoachSheetScreen.tsx`

No change, as the PM asked. This must be confirmed on Ben's iPhone before build 131 is called fixed.

---

## Nits

- **N1.** The changelog and §8.2a say the ~2.7k-token cost was "Measured", but it's an estimate (character count ÷ 4). Say "estimated", or measure one real request.
- **N2.** When the model builds on an offered-only turn, the BD13 whole-build timeout isn't applied (`coach-service.ts`, `build?.inPlay === true`). Apply the build cap once a `propose_workout` call starts, or accept the gap and note it in §8.2a.
- **N3.** "make me a push session, go easy on my shoulder" is `none`, so it's forced. That's arguably fine (no pain stated), but consider "go easy on my <part>" as `unclear`.
- **N4.** "yeah maybe tomorrow", "yes, after dinner" and "sure, one sec" after an offer are `loose`. They're offered, not forced, with the offer-reply instructions, so this is acceptable. A test would pin it.
- **N5.** r4 N7 (a fully hidden reply after a refused build) wasn't addressed. Check the rejected card copy on device.
- **N6.** Carried: r4 N4 (`scrollToEnd` on every keyboard change), N5 (nudge logged as `not_allowed`), N6 (source-regex keyboard tests).

## Checked and fine

- **r4 B1.** All seven pain or "something" sentences are not forced, are not `build`, and give no draft in the end-to-end tests. `askPain` is still set.
- **r4 B2.** All 19 listed sentences pass through with `inPlay` off and on, except "You can see it in your workouts." when a build is in play, which is acceptable.
- **r4 S1.** All seven done-claims are hidden when `inPlay`. "Sorry, that's outside what I can do here." is now a generic refusal (N3).
- **r4 S2.** Weekly plans and programmes are `multiWeekScope`, never forced, and every build prompt carries the not-available line.
- **r4 S4.** A `rejected` or `stale` `build_workout` no longer ends the look-back. "try again", "yes" and "add it" after a refusal are `clear`. Tested end to end.
- **r4 S5.** A turn with the tool drops a false promise and turns "can't build" into the offer. A turn without it shows the offer once.
- **r4 S3 hold-off.** "yes lol", "haha yes go on" and "yes, maybe add curls" are `clear`. "lol", "haha" and "maybe later" are `null`.
- **N1, N2.** "ok thanks" is `null` in every shape. A bare "try that" is a retry only after a refusal.
- **Rules 2 and 5.** Every path still only writes an `open` draft (`committed` `build_workout`, idempotent on opId, `landedOpId`). Start and Save stay Ben's taps (WB20, `sessions.active()` null).
- **Rule 6.** No invented data in the new prompts.
- **Rule 8.** Length and focus still come from Ben's words. The coach's text only gates.
- **Rule 9.** Pain words never force, and pain plus yes is never a follow-up.
- **Honest AI status.** The held text stands only on `unavailable`. Other errors fail with their status.
- **Security and privacy.** No secrets and no new logging of health data.

## Spec issues

- **Turn 2 of the original bug is model-dependent by design.** Under the PM rule, "Yes u can add in the app" is never forced. If the route rejects a named `tool_choice` on turn 1 (spike S3 still unproven, ADR 0012, ADR 0020 C0), Ben gets the held text plan, and turn 2 builds only if the model picks the tool. Ben should know this when he confirms the decision. Options:
  - (a) add "forced `propose_workout` on the plan route" to the S3 device checklist;
  - (b) let a `clear` follow-up anchored to Ben's own unbuilt build request also be forced, since it is as unambiguous as the first ask.
- **The PM decision is recorded as pending Ben's confirmation** in `docs/brief/CHANGELOG.md` and `docs/design/workout-builder.md` §8.2a. Correct, but it is not approved yet. Build 131 shouldn't be called fixed until Ben confirms.
- **`docs/design/coach-sheet.md` §2.2 and §6 still don't say how the keyboard is dismissed** (carried).
