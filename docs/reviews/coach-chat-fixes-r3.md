# Review r3: coach-chat-fixes (build 131: "make me a push session" / "Yes u can add in the app", stuck keyboard)

Branch `claude/coach-chat-fixes` at 36998bf (r2 fixes) vs `claude/gracious-knuth-joxqpw`.
Reviewer: independent. Date: 13 Oct 2026.

## Verdict: CHANGES NEEDED

Checks (run by the reviewer on a clean tree):

- `npm run typecheck`: passes.
- `npm run lint`: clean.
- `npx vitest run` (default suite): 277 files, 5522 passed, 1 todo.

What now works:

- **Ben's exact conversation ends in a draft.** Turn 1 "Can you make me a push session …" (with or without "split squats and calf raises", "sess", "sesh", "u") is a build turn. A text answer is held, the model is nudged, and the next step forces `propose_workout` by name. Turn 2 "Yes u can add in the app" builds both in a fresh thread and in his stored build-131 thread (plan, then refusal). The draft is `open` with `routineId: null`, no session is active, and Start and Save stay Ben's taps (`workout-builder.test.ts`, "build 131" block).
- **r2 B1 and B2 are fixed for the phrasings they named.** That includes "go on then", "aye", "👍", "yes, 45 mins", "yes without dips", "in the app please", "add a push workout to the app" and "put a push session in the app for me".
- **r2 S1, S2 and N1 are fixed.**
  - "ok thanks", "cool" and "thanks mate" after a refusal do nothing.
  - A forced step that fails with `usage_limit`, `auth_expired`, `not_eligible` or `model_gone` fails the turn with that status.
  - "log it" no longer builds.
- **The keyboard hides** on a drag (`interactive`), on a tap on the conversation, with the `Done` bar, and on Send or Build.

Method: I ran the real `classifyBenRequest`, `buildFollowUp`, `buildFollowUpIn`, `asksForBuild`, `acceptsBuildOffer`, `offersToBuild`, `describesWorkoutPlan`, `claimsNoBuildTool` and `createReplyFilter` against 50 first-turn phrasings, 60 follow-ups in 4 thread shapes, 20 replies to an offer and 25 coach sentences. The probes were temporary test files, now deleted. The thread shapes were:

- (A) Ben asked for a build and the coach answered with a text plan;
- (B) the device thread: plan, "Yes u can add in the app", then the refusal;
- (C) a text plan ending "Want me to build it in the app?";
- (D) a text plan with no offer.

One blocker remains. On a turn without the build tool, the prompt says the app can build and forbids "can't", but the backstop doesn't catch the promises and done-claims that this pushes the model toward.

---

## Blocking

### B1. On a no-tool turn the coach can still promise or claim a workout that never appears (rules 1, 6)
`packages/coach/src/build.ts:190-194` (`NO_BUILD_TOOL_INSTRUCTIONS`), `packages/coach/src/reply.ts:208-217`, `packages/coach/src/claims.ts` (claim patterns)

On every general turn with a gym, `NO_BUILD_TOOL_INSTRUCTIONS` tells the model:

- "The app can build one workout session as a draft when Ben asks for one."
- "Do not say you or the app cannot build a workout session."

That includes turns where `propose_workout` is not in the tool list. When Ben's words ask for a build but the gate misses them (S1 to S4 below), the model has been told the app can do it, that Ben asked, and that it may not say no. It has no tool to call.

I ran these model sentences through `createReplyFilter` with `noBuildToolLine: true` and an empty ledger, which is a turn that made no draft. They are **shown** to Ben:

- "Okay, I'll set that up for you."
- "Let me put that in the app."
- "I'll get that into your workouts."
- "It's ready in your workouts."
- "You should see it in the app shortly."

No draft card follows. This is the same false capability claim as build 131, inverted: "I can't" became "I have". r2 B1 already listed "Okay, I'll set that up for you." as passing, and it still passes.

The same gap opens on a build turn where `propose_workout` was called but refused by the executor (for example, no usable exercises). The model's next reply can say "It's ready in your workouts."

**Concrete path.** In Ben's stored build-131 thread (plan, then refusal), Ben types "try again" or "yes you can". Neither opens the tool (S2). The model gets `NO_BUILD_TOOL_INSTRUCTIONS`, replies "Sure, I'll set that up for you.", and Ben sees that with nothing in the thread.

**Fix:**

- **Make the prompt match the turn.** When `propose_workout` isn't offered, say plainly: "You can't build on this turn. If Ben wants this session in the app, ask: 'Want me to build it in the app?'. Never say it is being or has been built." Keep "Do not say the app cannot build workouts", but let the model say it can't do it *from this message*.
- **Widen the backstop.** When no `build_workout` record exists this turn, hide promise and done-claims about a workout or the app. Cover "I'll set (that|it) up", "let me (put|add|build|save) …", "I'll get (it|that) into …", "(it's|it is) (ready|in|saved) in your workouts|the app", "you'll see it in the app" and "check your Workouts tab". Show `BUILD_ASK_LINE` or the existing `Nothing changed` note in their place.
- **Test it.** For each sentence above, a no-tool general turn with `buildAvailable` must not show it. So must a build turn whose `propose_workout` was refused.

---

## Should fix

### S1. After an offer, non-answers force a draft: "maybe", "I'll think about it", "brb", "one sec", "lol", "my shoulder feels a bit tight"
`packages/coach/src/build-ask.ts:179-185` (`acceptsBuildOffer`), `packages/coach/src/turn.ts:538-581` (hold, nudge, force)

`acceptsBuildOffer` treats as a yes any reply of 15 words or fewer that isn't a question, a refusal, a remark, a `pain` mention or thanks alone. A follow-up then makes the turn a build turn, which **holds the model's text answer and forces `propose_workout` by name**. So the model can't decline even when it reads Ben's words correctly.

These all build a draft after "Want me to build it in the app?" (probe, `asksForBuild === true`):

- "maybe"
- "I will think about it"
- "brb"
- "one sec"
- "lol"
- "I'm going at 6"
- "I am off to the gym now"
- "my shoulder feels a bit tight" (`classifyPainMention` → `unclear`; the turn also asks about pain)

It's only a draft, so rules 2 and 5 hold. But it is the coach acting when Ben didn't agree (rule 3: "doesn't apply until Ben accepts"). Building a pressing session in the same turn that asks "is that pain?" is the wrong order (rule 9).

**Fix:**

- Add "maybe", "think about it", "not sure", "brb", "one sec", "lol" and `unclear` pain to the refusal and hold set.
- Better: on a follow-up that came only from the inverted rule (not `explicit` or `accept`), offer the tool but don't hold or force. The model then decides from the words.

### S2. Pushback and retry after a refusal or the ask line don't open the tool
`packages/coach/src/build-ask.ts:82-83` (`PUSHBACK`), `:212-217` (`followsUp`)

In the device thread (B) and after `BUILD_ASK_LINE`, these return `null` and the turn has no tool:

- "yes you can"
- "you can"
- "you can though"
- "yes it can"
- "the app does have a builder"
- "there is a workout builder"
- "use the workout builder"
- "you do have a tool"
- "you do have access"
- "try again"
- "can you try again"
- "just try"
- "yes try"
- "check again"
- "make a draft"

These are how anyone answers "I don't have access to a workout-creation tool". Ben's own turn 2 was pushback of exactly this kind. With B1 still open, each one is a chance for a false promise.

**Fix:** when the last coach message `claimsNoBuildTool(…, {generic: true})` or is `BUILD_ASK_LINE`, treat as `explicit`:

- bare pushback (`(yes|yeah)? (you|it|the app) (can|does|do)( though)?`);
- "there is / it has / you have a (workout )?builder|tool|access";
- retries (`(can you |just |please )?(try|check) again`, `yes try`, `make a draft`).

Add them to `build-ask.test.ts` for thread (B).

### S3. When turn 1 still ends in text, "yes" or "go on then" on turn 2 does nothing
`packages/coach/src/build-ask.ts:212-217`, `packages/coach/src/build.ts:176-183` (`BUILD_INSTRUCTIONS`)

Turn 1 ends in the held text plan in three cases:

- the forced step is rejected (`unavailable`);
- the route ignores the named `tool_choice`;
- the model replies again under force (the first `workout-builder.test.ts` "build 131" case).

`BUILD_INSTRUCTIONS` doesn't ask for an offer, so that plan has none. On turn 2 in thread (A), "yes", "go on then", "ok do it" and "that would be great thanks" are all `accept`. `followsUp` honours `accept` only after an offer or a refusal, so none of them builds.

Named `tool_choice` on the plan route is unproven (spike S3, see Spec issues), so this may be the common path on Ben's phone. Ben asked for a build and the coach failed to make one. A plain yes next is consent.

**Fix:**

- In `followsUp`, also honour `accept` when the anchor is Ben's own build request (`asked`) that the coach answered without a draft.
- Or, when the held text stands, append the fixed offer "Want me to build it in the app?" (code, not model), so the existing offer path applies.
- Test: build turn → held text stands → "yes" → draft card.

### S4. Detector gaps the model's paraphrase walks through
`packages/coach/src/build-ask.ts:40-46` (`OFFER_VERB`), `:297-320` (`CANT_BUILD`, `NO_BUILD_TOOL`, `GENERIC_NO_BUILD`)

- **`offersToBuild` misses** "Should I build that for you?" (`should I` with no `to`), "Do you want this as a workout in the app?" and "Want it in the app?". A "yes" after any of these is not honoured (only `explicit` works).
- **`claimsNoBuildTool` misses** these, all shown on a build-asked turn:
  - "I can only describe workouts here, not add them."
  - "I can plan your session, but adding it to the app isn't something I can do."
  - "That's not something I can do from this chat."
  - "Unfortunately I can't save sessions." (`BUILD_VERBS` has no `save` or `store`)
  - "You'll need to add it in the app yourself."
- **`describesWorkoutPlan` misses** AMRAP and timed lines ("Dips — 3 × AMRAP", "Plank 3 × 45 s").

Each needs a test case, then a wider pattern.

### S5. First-turn misses in British and casual phrasing
`packages/coach/src/request.ts:605-641` (`BUILD_VERB_*`, `BUILD_LATER`)

`classifyBenRequest` doesn't return `build` for:

- "can you programme me a push session" (British spelling: `programme` hits `BUILD_LATER`; only `program me` is exempt)
- "Could you make me a pull workout for this week" and "make me a 45 min push session at the gym this week" (`(?<!next )week` only exempts "next week")
- "build me a workout based on what I did last week"
- "build me something for today"
- "make me something for push today"
- "what should I do today? build me something"
- "need a quick 30 min workout"
- "can you sort me a push session" ("sort me out" works; "sort me" doesn't)
- "push day today, can you sort it"
- "yo build me a chest and tris workout" (a leading filler word breaks the `^` anchor)

These cost a turn rather than ending in nothing, because the coach offers. But that offer turn is where B1 bites.

**Fix:**

- Exempt `programme me|us`.
- Treat `this week` and `last week` as when, not how long.
- Accept `something` as a build noun after a strong verb with `for today` or a focus word.
- Strip `yo|hey|ok|right|so` before the build patterns.

### S6. Keyboard drag inside the padding `KeyboardAvoidingView` is still unverified on device (carried from r1 S5, r2 S4)
`apps/mobile/src/coach/sheet-view.ts:24`, `apps/mobile/src/screens/coach/CoachSheetScreen.tsx:446, 482-492`

`interactive` dismiss in a modal sheet with KAV `padding` can:

- jump the composer when the keyboard hides;
- fight the sheet's own swipe-to-close.

Tap, `Done` and Send are reliable, so the "can't hide it" bug is fixed. Before closing the bug, confirm drag on Ben's iPhone, or switch to `on-drag`.

---

## Nits

- **N1.** `build-ask.ts` `AFTER_OFFER` (tested): "ok thanks" after an offer builds. That's how many people sign off. r2 S1 asked for thanks to need a yes-family word. Consider treating `ack + thanks` as a sign-off.
- **N2.** `CoachSheetScreen.tsx:486`: `onLayout → scrollToEnd` jumps to the bottom on every keyboard show and hide, even while Ben is reading older messages (carried from r2 N2).
- **N3.** `turn.ts:578`: the nudge log line uses outcome `not_allowed`, which `Why?` shows like a refused tool (carried from r2 N6).
- **N4.** `apps/mobile/test/coach-keyboard.test.ts` uses regex checks on source text (carried). Add a device checklist line: drag, tap, Done, Send, AX3, VoiceOver.
- **N5.** On a build turn the first reply is never streamed (`holdReply`). Every build turn now waits for 2 or 3 model steps before any text appears. That's acceptable, but measure it in the S3 spike, and show the pending build card early so the sheet isn't blank.
- **N6.** A tap on the header or the status row doesn't hide the keyboard. Only the transcript does. That's fine for the reported bug.

## Checked and fine

- **Rules 2, 3, 5.**
  - Every way in only opens `propose_workout`, which writes an `open` draft. Nothing is started or saved without Start or Save.
  - A coach message with `actionIds` ends the follow-up look-back, so a second "add it" doesn't make a duplicate draft.
  - The BD15 fixed line yields only when a newer text plan exists. Turn replay returns before any of this.
- **Forcing.** Step 0 is `required`, and the nudge step is `{type:'function', name:'propose_workout'}`. The provider's `ToolChoice` type and `ALLOWED_FIELDS` pass it through (`packages/providers/src/openai/responses.ts:39, 72, 84`). The held text is never streamed before a build was tried.
- **Honest errors (r2 S2).** The held text stands only on `unavailable`. Other errors fail the turn with their status, and tests cover all four.
- **One decision.** `coach-service.buildTurn` and `runCoachTurn` both call `buildFollowUpIn` on the same stored thread, read before Ben's message is appended, so the tool list and the executor can't disagree.
- **Rule 8.** Length and focus come from Ben's own words, newest first. The coach's text only gates the tool and is passed as conversation, not instruction.
- **Negatives.** These never build, after an offer or otherwise: "no", "no thanks", "don't add it", "not now", "later", "maybe later", "what about pull tomorrow?", "thanks, how heavy for bench?", "perfect", "make the session easier", "add curls to my workout", "put my session in the app", "can I do a push session today?" and "can you make me an upper lower split".
- **Keyboard.**
  - The transcript `Pressable` is `accessible={false}`, so VoiceOver reaches the children.
  - `handled` keeps buttons working on the first tap.
  - `Done` has a 44 pt target and a label.
  - `TextField` spreads `inputAccessoryViewID` through to `TextInput`.

## Spec issues

- **Named `tool_choice` on the plan route is unproven.** That is spike S3 (ADR 0012, ADR 0020 C0, `docs/research/ai-import.md` F1). The build-131 fix depends on it. If the route rejects it, every build turn falls back to the held text plan (S3). Add "forced `propose_workout` on the plan route" to the S3 device checklist before calling build 131 fixed. The PM's alternative is still worth a design decision: a deterministic draft from the coach's text plan.
- `docs/design/workout-builder.md` §8.2 still defines the build gate as Ben's words only (carried from r1 and r2). Shipped behaviour that needs Ben's approval and a `docs/brief/CHANGELOG.md` entry:
  - the coach's offer as a trigger, and the inverted "anything but no" rule after it;
  - the 3-message follow-up window;
  - the forced named tool choice, and the prompt line forbidding "can't build".
- `docs/design/coach-sheet.md` §2.2 / §6 still doesn't say how the keyboard hides. Add drag, tap on the conversation, `Done` and Send (carried from r2).
