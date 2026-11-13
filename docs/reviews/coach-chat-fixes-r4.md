# Review r4: coach-chat-fixes (build 131: "make me a push session" / "Yes u can add in the app", stuck keyboard)

Branch `claude/coach-chat-fixes` at 3c319b6 (r3 fixes f6c1865, 3c319b6) vs `claude/gracious-knuth-joxqpw`.
Reviewer: independent. Date: 13 Oct 2026.

## Verdict: CHANGES NEEDED

Checks (run by the reviewer on a clean tree):

- `npm run typecheck`: passes.
- `npm run lint`: clean.
- `npx vitest run --maxWorkers=2`: 277 files, 5654 passed, 1 todo.

What now works:

- **Ben's exact conversation still ends in a draft.** Turn 1 "Can you make me a push session with split squats and calf raises" is a build turn: the text answer is held, nudged, then `propose_workout` is forced by name. Turn 2 "Yes u can add in the app" is `explicit` in all four thread shapes and ends in an `open` draft with `routineId: null` and no active session. Start and Save stay Ben's taps (`apps/mobile/test/workout-builder.test.ts:518`).
- **r3 S1 to S5 are fixed for the phrasings they listed.**
  - S1: hold-offs and unclear pain after an offer never build, and inverted-rule replies are `loose` (offered, not held or forced).
  - S2: pushback and retries after a refusal or the ask line reopen the tool, including in the stored device thread.
  - S3: "yes" after Ben's own unbuilt build request builds.
  - S4: the new offer, no-build and AMRAP/timed detectors work.
  - S5: all 10 first-turn phrasings now build.
- **The r3 B1 prompt fix is right.** `NO_BUILD_TOOL_INSTRUCTIONS` now says the model can't build on this turn and must ask "Want me to build it in the app?". The 12 sentences r3 listed are hidden on a no-tool turn and after a refused build.
- **Keyboard: no code change since r3.** Tap on the conversation, the `Done` bar, Send and Build all dismiss it. Drag is `interactive` (see S6).

**Method.** I ran the real `classifyBenRequest`, `buildFollowUp`, `buildFollowUpIn`, `retriesBuild`, `offersToBuild`, `describesWorkoutPlan`, `claimsNoBuildTool`, `claimsWorkoutBuilt` and `createReplyFilter` against:

- 40 of my own first-turn phrasings, plus 32 more that should not build;
- 58 follow-ups in 4 thread shapes:
  - (A) Ben asked for a build and the coach answered with a text plan;
  - (B) the device thread: plan, "Yes u can add in the app", then the refusal;
  - (C) a plan ending "Want me to build it in the app?";
  - (D) a plan with no offer, after "what should I do today";
- 47 coach sentences.

I also ran two end-to-end turns through `coach.send` using the `workout-builder.test.ts` harness. All probes were temporary files and have been deleted.

Two new blockers come from the r3 fixes themselves. One is in the first-turn widening (f6c1865), the other in the promise backstop (3c319b6).

---

## Blocking

### B1. Asking for help with a sore body part now forces a workout draft (rules 3, 9). Regression in f6c1865.
`packages/coach/src/request.ts:643-645` (`BUILD_SOMETHING`), `:665`; `packages/coach/src/turn.ts:543` (hold and force)

`BUILD_SOMETHING` accepts "give/make/sort me something" plus "today", "tonight" or a focus word as a build request. All of these are now `build` turns:

- "can you give me something for my sore shoulder today"
- "give me something for my back pain today"
- "give me something for my knee today"
- "give me something to stretch my back today"
- "give me something to do for my shoulder today, it hurts"
- "make me something for dinner tonight"
- "make me something to read about push today"

On a build turn, the model's text answer is held and the next step forces `propose_workout`.

**End-to-end** (`coach.send`, `benWithHistory`). Ben sends "can you give me something for my sore shoulder today". The model answers with pain advice. That answer is held, and the turn is forced to call `propose_workout`. The result:

- a `committed` `build_workout` card and one stored draft;
- no words shown;
- `askPain: {bodyPart: 'shoulder'}`.

"sore" reads as `unclear`, so no pain flag is set and the draft can include overhead pressing.

Ben asked about pain and got a workout in its place. This breaks rule 9: pain is asked about first and stops progression for that movement. It also breaks rule 3, because the coach acts on something Ben didn't ask for. It is only a draft, so rules 2 and 5 still hold, but it is written to storage and his question goes unanswered.

**Fix:**

- In `buildIn` (or `classifyBenRequest`), never treat a message as a build when `classifyPainMention(text) !== 'none'`, unless it also has an explicit workout noun ("session", "workout", "day").
- Narrow `BUILD_SOMETHING` to a focus word from `FOCUS_RUN` or a training word ("to train", "for the gym"). "today" or "tonight" alone is not enough.
- Test: each sentence above is not `build`, and in `workout-builder.test.ts` none of them makes a draft.

### B2. The promise backstop hides true, ordinary coach sentences and puts in a non-sequitur (rules 1, 6; minimal copy). Regression in 3c319b6.
`packages/coach/src/build-ask.ts:420-449` (`BUILT_PATTERNS`, `claimsWorkoutBuilt`), `packages/coach/src/reply.ts:226`

`noBuildToolLine` is true on **every** general turn when Ben has a gym (`buildAvailable`). So `claimsWorkoutBuilt` runs on every sentence of every general reply.

Its patterns match a bare pronoun ("it", "that", "this") after "let me", "I'll" or a sentence-initial gerund. They also match "in your workout(s)" with nothing after it. These ordinary sentences are all read as claims:

- "It's in your workout history."
- "That's in your workouts from Tuesday."
- "You can see it in your workouts."
- "Look at your workout history for last week." / "Check your workout log for the last bench."
- "Let me put it another way." / "Let me make this simple." / "I'll make it quick." / "Let me get this straight." / "I'll make that clear." / "I'll get back to it." / "I'll put it simply: rest more."
- "Adding a set this week would help." / "Getting that extra rep is a good sign." / "Making it to the gym three times is great." / "Building it up slowly is the key." / "Making this your top set is smart."
- "Fatigue should show up soon." / "Your PR should show up in History now."

**End-to-end.** Ben asks "where can I see my bench from Tuesday?" and the model replies "It's in your workout history. …". Ben sees:

- `Say "Build me a workout" to get a draft.`
- then the rest of the reply;
- and the note `Nothing changed · 1 line hidden`.

The true answer to his question is hidden. In its place is an instruction about building workouts that has nothing to do with what he asked. This happens on ordinary turns that have nothing to do with building.

**Fix:**

- **Scope the check.** Run `claimsWorkoutBuilt` only on turns where a build is in play:
  - a build or loose-build turn;
  - Ben's words or the last coach message mention the app, a plan or an offer (`buildFollowUpIn` anchor, `describesWorkoutPlan`, `offersToBuild`);
  - or the same reply contains a plan.
- **Tighten the patterns.**
  - A bare pronoun counts only together with a place ("in the app", "in your workouts") or "for you".
  - Drop the sentence-initial gerund pattern unless it has a place.
  - Exclude "history", "log", "from <day>" and "last week" after "workout(s)".
  - Limit the "check your workouts" pattern to "Workouts tab".
- **Show a better replacement.** When a claim is hidden on a no-tool turn, show the ask question "Want me to build it in the app?" (which the existing offer path then accepts) rather than `BUILD_ASK_LINE`.
- **Test it.** Each sentence above stays visible on a no-tool general turn with `buildAvailable`.

---

## Should fix

### S1. The backstop still lets through common done-claims (r3 B1 residue)
`packages/coach/src/build-ask.ts:420-438`

The prompt fix is the main defence and it is now right. The backstop is the guardrail behind it, and these are shown on a no-tool turn with no draft:

- "Here you go, it's saved."
- "It's been added."
- "Okay, adding that now."
- "I've set it up."
- "On it!"
- "Coming right up."
- "Done! Open it from Workouts when you are ready."

Regex enumeration of claims will keep losing to paraphrase, and B2 shows the cost of widening it blindly.

**Fix:** after B2's scoping (so false positives stop mattering off-topic), add these cases:

- "(it's|it has) been (added|saved|built|created)";
- "I've set it up";
- "it's saved";
- "adding (it|that) now";
- "open it from Workouts".

Better, a structural option: on a scoped turn where Ben's words read as wanting it in the app but no tool ran, replace the whole reply with the fixed offer "Want me to build it in the app?".

### S2. "This week" exemption turns weekly-plan asks into a forced single session (f6c1865)
`packages/coach/src/request.ts:653` (`BUILD_LATER`)

These are now `build`:

- "make me a workout plan for this week"
- "make me a workout for each day this week"

Each gets one held-and-forced session. On a build turn the model is never told that multi-week programmes aren't available (that line is only in `NO_BUILD_TOOL_INSTRUCTIONS`). So it can't say so: it must build one session.

**Fix:**

- Keep "this week" as "when" only for a singular noun with no "plan", "each day", "every day" or plural ("workouts", "sessions").
- Add the "programmes aren't available yet" line to `BUILD_RULES`.

### S3. Follow-up and first-turn gaps that still cost Ben a turn

**First turn: 7 of my 40 phrasings miss** (`request.ts`). The coach then offers, and "yes" builds on the next turn.

- "would you be able to make me a push session"
- "any chance you could make me a push session"
- "chuck together a push session for me" (`chuck together` isn't in `BUILD_VERB_STRONG`)
- "knock me up a push sesh" (only "knock up a")
- "Push and legs today please"
- "push and legs today, can you make me something"
- "whats a good push session? can you make one"

**Follow-ups:**

- "i want it in the app" builds in none of A, B or D, and is only `loose` in C.
- "can you not just add it" builds in none of A to D. That is classic pushback after the device refusal.
- **`HOLD_OFF` (`build-ask.ts:177`) swallows a yes.** It matches "lol", "haha" or "maybe" anywhere in the reply, and it runs before the yes-family check. So these build in no shape:
  - "yes lol"
  - "haha yes go on"
  - "yes, maybe add curls"

  Anchor `HOLD_OFF` to replies with no yes-family word, or run it after `buildFollowUp` has returned `accept`.

**Offers the detector misses** (`OFFER_VERB`): "Want me to whip that up in the app?", "I can turn this into a workout for you." (statement with no "if you like") and "Fancy having this in the app?". After these, a plain "yes" builds only if Ben asked for a build earlier (shape A).

### S4. A refused build can't be retried with "try again" on the next turn
`packages/coach/src/build-ask.ts:289` (`answeredAsk` needs `actionIds.length === 0`), and the window loop `break` on `actionIds`.

A refused `propose_workout` stores a `rejected` `build_workout` record, so the coach message has an action ID. On the next turn, "try again", "yes" and "go on then" all return `null`. The model is then told "You cannot build a workout on this turn" and asks again, which costs a turn.

**Fix:** treat a coach message whose only actions are `rejected` or `stale` `build_workout` records like a message with none, for `answeredAsk` and the look-back.

### S5. `loose` turns can show `BUILD_ASK_LINE` while the tool is offered
`packages/coach/src/turn.ts:501` (`buildAsked: buildOffered && !looseBuild`), `packages/coach/src/reply.ts:228`

On a `loose` turn, `buildAsked` is false. If the model writes "I'll set that up" without calling the tool, the filter shows `Say "Build me a workout" to get a draft.` That line is wrong on a turn where the tool was right there.

**Fix:** pass a separate `toolOffered` flag and show the fixed offer question in its place.

### S6. Keyboard drag inside the padding `KeyboardAvoidingView` is still unverified on device (carried from r1 S5, r2 S4, r3 S6)
`apps/mobile/src/coach/sheet-view.ts:24`, `apps/mobile/src/screens/coach/CoachSheetScreen.tsx:482-492`

No change since r3. Tap, `Done` and Send hide the keyboard reliably, so "can't dismiss" is fixed. Drag must be confirmed on Ben's iPhone: no composer jump, and no fight with swipe-to-close. Otherwise switch to `on-drag`.

---

## Nits

- **N1.** `ok thanks` after an offer still builds as `clear` (carried from r3 N1).
- **N2.** In shape A, "try that" is a retry and forces a build. Ben may mean "I'll try that at the gym". Consider requiring "again", "now" or "it again" for a bare "try that" when the anchor is `answeredAsk` rather than a refusal.
- **N3.** "Sorry, that's outside what I can do here." isn't caught by `claimsNoBuildTool`, even as generic.
- **N4.** `CoachSheetScreen.tsx:486`: `onLayout → scrollToEnd` jumps to the bottom on every keyboard show or hide (carried).
- **N5.** `turn.ts`: the nudge log line uses outcome `not_allowed`, which `Why?` shows like a refused tool (carried).
- **N6.** `coach-keyboard.test.ts` uses regex checks on source text. Add a device checklist line: drag, tap, Done, Send, AX3, VoiceOver (carried).
- **N7.** On a refused build, the reply is often fully hidden (`said: []`), so only the rejected card speaks. That's acceptable, but check that the card's copy says why on device.

## Checked and fine

- **Rules 2, 3 and 5 on the build paths.** Every way in only opens `propose_workout`, and the executor writes an `open` draft (`committed` `build_workout` record, idempotent on opId, `landedOpId` guard against a second build in one turn). Nothing is started or saved without Start or Save. A draft in the last coach message ends the look-back, so a second "add it" doesn't duplicate.
- **One decision.** `coach-service.buildTurn` and `runCoachTurn` both call `buildFollowUpIn` on the same stored history, read before Ben's message is appended.
- **Loose turns.** They aren't held or forced (`toolChoice: 'required'`, not named), and they get `OFFER_REPLY_BUILD_INSTRUCTIONS`, which tells the model not to build without a clear yes. Tested.
- **Honest errors.** The held text stands only on `unavailable`. `usage_limit`, `auth_expired`, `not_eligible` and `model_gone` fail the turn with that status.
- **Negatives that never build in any shape:** "no", "thanks", "cool thanks", "perfect", "later", "nah im good", "how heavy for bench?", "what about pull?", "my shoulder hurts", "is it in the app?", and the pain-plus-yes replies ("yes, though my shoulder is sore", "yes but my knee hurts").
- **Rule 8.** Length and focus come from Ben's words, newest first. The coach's text only gates the tool.
- **Keyboard.** The transcript `Pressable` is `accessible={false}`, `handled` keeps buttons working on the first tap, `Done` has a 44 pt target and a label, and `inputAccessoryViewID` reaches `TextInput`.
- **No secrets or new logging of health data** in the diff.

## Spec issues

- **Named `tool_choice` on the plan route is still unproven** (spike S3, ADR 0012, ADR 0020 C0). If the route rejects it, every build turn falls back to the held text plan, and the r3 S3 fix makes "yes" build on turn 2. Add "forced `propose_workout` on the plan route" to the S3 device checklist before calling build 131 fixed (carried).
- **`docs/design/workout-builder.md` §8.2 still defines the build gate as Ben's words only** (carried from r1 to r3). Shipped behaviour needs Ben's approval and a `docs/brief/CHANGELOG.md` entry:
  - the coach's offer as a trigger, and the inverted rule with its `loose` and `clear` strengths;
  - the 3-message window;
  - "yes" after an unbuilt request;
  - pushback and retry phrases;
  - the forced named tool choice;
  - the promise and done-claim backstop.
- **`docs/design/coach-sheet.md` §2.2 and §6 still don't say how the keyboard hides.** Add drag, tap on the conversation, `Done` and Send (carried).
- **Design question for Ben and the PM.** Four rounds of regex widening show the trade-off: every new phrase-family widens false positives (B1, B2, S2). An alternative is to always offer `propose_workout` on general turns with a gym, `loose` (never held or forced) unless Ben's words are a clear build. The model then builds when Ben's words mean it, and promises become true. Rule 3 is kept, because the instructions forbid building without a clear ask and the result is still only a draft. This is a change to §8.2 and needs Ben's approval.
