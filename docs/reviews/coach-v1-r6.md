VERDICT: CHANGES NEEDED

# Review r6: coach v1 (branch `claude/coach`), after the fixes for `coach-v1-r5.md`

Reviewer, 10 Oct 2026. Range: `git log claude/gracious-knuth-joxqpw..HEAD`, 47 commits. The r5 fixes are the 4 commits after `51712d2`: `6e151f6`, `12d85c7`, `2ab7ee6` and `55de9ee` (14 files, +1206/−94). The branch adds no key, secret or `.env` file.

I checked the classifiers and guardrails against CLAUDE.md rules 2, 3, 4, 5 and 9 and against the honesty contract (coach-contract CC3–CC5, CC10, §6.1, check 14; coach-memory CM6). I wrote all the phrasings myself and none of them come from the corpus.

## What I ran

- **`npm run check`.** Typecheck and lint pass. The test run gave 1 failure out of 2594: a 5 s timeout in `packages/catalogue/test/motion-r3.test.ts`, which this branch doesn't touch. Run alone with `--testTimeout=120000`, `motion-r3` and `figure` pass (50 tests). `catalogue:validate` passes (133 valid), as do `guide:check --all --verify` (10/10) and `guide:motion --all` (10/10).
- **Probes.** I wrote 298 new phrasings and placed the probe files in `packages/coach/test/` only while they ran. They are deleted, and nothing except this review is committed. They covered:
  - `classifyBenRequest`: 84 phrasings (50 that should open nothing, 34 that should be requests);
  - `classifyPainMention` and `painBodyPart`: 98 phrasings (68 pain or symptom phrasings, 15 non-pain, 15 mixed with a request);
  - `checkReplyClaims` and `needsNoChangeLine`: 101 phrasings, run against an empty ledger, a live ledger holding the bench change 100 kg × 6–8 → 95 kg × 8 on sets 3–4, an undo that restored only set 4 (set 3 already logged), and a change that was undone;
  - `personalPlaybookText`: 15 phrasings.

## Status of the r5 findings

| r5 | Status |
|---|---|
| B1a old value, convention, delta | **Mostly fixed** for adjust records: "Sets 3 and 4 are 100 now", "95 per side", "95 a hand", "95 lb", "95 for 6 to 8", "Dropped by 10" and "Sets 2 to 4" are now replaced or hidden. Some forms still get through: "N lighter", "down from N", and the undo record (B1). |
| B1b recall with nothing saved | **Much better.** With the fixed line on, 25 of my 33 empty-ledger claims are covered. The 8 that aren't are in B1c. |
| B1c / spec issue 1 | **Done, and on by default.** Two holes remain: a claim phrased as a question, and emoji-only replies (B1c). |
| B2 pain words | **Fixed.** Only 4 of my 68 pain or symptom phrasings are missed ("Saw stars", "Ripped a callus", "Hurty", "Owie"). The new problem is false positives, now that `unclear` blocks increases (S2). |
| B3 remarks and retractions | **The listed rows are fixed.** New forms still open the tool: reported speech, retractions the list doesn't know, and other-day phrasings it doesn't know (B2). |
| B4 same-message pain | **Fixed in the validator, with tests.** It covers only the same message, though (S1). |
| S1 clear requests | Partly fixed: 23 of my 34 clear requests still return `null` (S4). |
| S2 pain false positives | Fixed for the listed rows. |
| S3 playbook | Fixed for the listed rows, but 8 of my 10 new personal phrasings still pass (S3). |
| S4 JWKS on the device | Still open. |

Nothing on this branch writes yet: there is no turn engine, store or coach sheet. Within `validateTodayAdjustment`, rules 2, 4 and 5 hold as r4 and r5 described: completed sets are dropped, loads are snapped and capped, and a stale `baseVersion` returns `stale`.

## Blocking

### B1. With a live change in the turn, false claims are still kept (CC3, CC4, check 14)

`needsNoChangeLine` returns `false` as soon as the turn has a live change (`packages/coach/src/reply.ts:113`). From then on, the claim lists in `claims.ts` are the only check, and they keep the following false sentences.

**B1a. Live adjust ledger.** Bench sets 3–4 went from 100 kg × 6–8 to 95 kg × 8. All of these are **kept**:

| Sentence | What's false |
|---|---|
| "Also sorted your knee." | No pain flag was saved (rule 9: Ben thinks the knee is flagged, so he doesn't flag it, and progression continues) |
| "Sets 3 and 4 are 95, the knee flag stays." | A flag that may not exist |
| "Done, and next Push A will start at 95." | Next-session scope; only today's sets changed |
| "I dropped sets 3 and 4 to 95 and cut set 4." | Set 4 wasn't removed |
| "Sets 3 and 4 are 95 for 8, plus a back-off set." | No set was added |
| "Sets 3 and 4 are 95 and AMRAP." | Set type. ADR 0019 says set-type claims are "never backed", but this one is |
| "Sets 3 and 4 are 95 with a 3 second pause." | Tempo isn't a target |
| "Your last three sets are 95." / "All four sets are 95." / "Sets 3 and 4 are 95 — and set 2 too." | Set 2 is unchanged |
| "Raised sets 3 and 4 to 95." / "Bumped sets 3 and 4 up to 95." / "Sets 3 and 4 are heavier now." | Wrong direction |
| "Sets 3 and 4 are 95, 10 lighter." / "Sets 3 and 4 are 95, down from 105." | The delta is 5 and the old value was 100 |
| "Sets 3 and 4 are 95, same reps." | Reps went from 6–8 to 8 |

**B1b. Undo record.** The undo restored set 4 to 100 × 6–8; set 3 was already logged. These are **kept**:
- "Undone, still 95 for set 4." This contradicts the card. `contradictsLiveChange` (`claims.ts:1220-1238`) checks only `adjust_pending_sets` and `set_next_session_targets`, not `undo`.
- "Both sets back to 100." Set 3 wasn't restored (`alreadyLogged: [3]`).
- "Undone, you're back on 100 for 8." The restored target is 6–8.

With an undone change and no undo in the turn, "Still 95 for the rest." and "Ok, 95 it stays." are kept. The fixed line does show here, but it says *no change was saved*. It doesn't correct the false *state*: the card shows 100.

**B1c. No-change turns: two holes in the inverted line.**
- `isPureQuestion` (`reply.ts:90`) treats any sentence ending in `?` as a question. So "Lighter now, better?" is kept by `checkReplyClaims` and gets no line. The same goes for "I've dropped it to 95, happy?" when the tag isn't in `TAG_QUESTION`. That one happens to be hidden by the claim list, so the gap is in the backstop, not the result.
- A reply with no letters or digits ("👍", "✅") is dropped from `statements`. It gets no line even when `benAskedForChange` is true, yet a thumbs-up straight after "lower it" is a claim.
- "Voilà.", "Boom.", "All yours.", "Easy." and "Nice one, that's you." get the line only when `benAskedForChange` is true. The gate misses 23 of my 34 clear requests (S4), so in exactly the turns where Ben asked and the gate didn't open the tool, the model can say "Boom." and nothing contradicts it.

**Failure scenario.**
1. Ben says "drop the last two to 95, my knee's a bit off".
2. The tool lowers sets 3–4. `set_pain_flag` doesn't open, because the mention is `unclear`, not `pain`.
3. The model replies "Done, 95 for the last two. Also sorted your knee."
4. Both sentences are kept and no line is shown.
5. Ben believes his knee is flagged. Next session squat progresses (rule 9, CC3).

**Fix.**
- Extend the inverted backstop to turns with a live change. Each sentence that is a claim, or has training content, and that `checkReplyClaims` keeps only through a ledger match must have *every* entity it names covered by a matched record: sets, exercises, flags, memories, scope (today or next) and set additions or removals. Treat anything else as `mismatch`, so an unmatched phrase hides rather than passes.
- Concretely:
  - flag, memory, playbook and "sorted your X" phrases need a record of that kind;
  - "next <session name>", "next week" and "next time" need `set_next_session_targets`;
  - "cut", "removed", "plus a … set" and "added" need `removedSets` / `addedSets`;
  - direction verbs ("raised", "bumped up", "heavier") must match the sign of `after − before`;
  - "N lighter" and "down from N" are deltas and old values;
  - "all/every/last N sets" must equal the set of changed sets;
  - run `contradictsLiveChange` on `undo` records too, and compare a set count ("both", "sets 3 and 4") with `restored` minus `alreadyLogged`.
- In `isPureQuestion`, treat a sentence as a question only if `isChangeClaim` is false for its text before the final clause.
- Count a reply with no letters as a statement when `benAskedForChange` is true. Better still, when Ben asked and nothing was saved, show the line for every non-question reply, including emoji.
- Add every row above to `claims-corpus.test.ts` (live and undo ledgers) and to `reply.test.ts`.

### B2. Remarks, reported speech and retractions still open `adjust_pending_sets` (rule 3)

`packages/coach/src/request.ts`:
- `:402` splits clauses on `:`, so the clause after "He told me:" reads as Ben's own imperative;
- `:239-262` (`RETRACTION`) misses common forms;
- `:264-266` (`PAST_DAY`) misses other-day phrasings;
- `:277-283` (`aboutSomethingElse`) only accepts a determiner at the start of the next clause;
- the em dash isn't a clause boundary (only `\s+-\s+` is).

16 of my 50 phrasings that shouldn't open anything do:

| Ben says | Result | Should be |
|---|---|---|
| "My PT said: lower it to 95" / "He told me: drop the weight" | `change` | `null` (reported speech) |
| "Lower it. jk" / "Lower it. Just kidding" / "Lower it. Or not." / "Lower it, or actually no" | `change` | `null` (retraction) |
| "Drop the weight — actually don't" | `change` | `null` (the em dash isn't split, so the retraction sits in the same clause) |
| "Missed a rep at the weekend" | `difficulty` | `null` (another day) |
| "That was brutal, honestly the commute" | `difficulty` | `null` |
| "Cut 5 kg before summer" / "Drop 3 kg of fat by Christmas" / "Add 5 kg to my deadlift goal" / "Add 10 minutes of cardio" | `change` | `null` (body weight, goals, cardio: not set targets) |
| "Lower the weight with a 3 second negative" | `change` | `null` (tempo cue) |
| "Increase the incline to 30 degrees" / "Change the plates to bumpers" | `change` | `null` (equipment set-up) |

**Failure scenario.** Mid-set, Ben dictates "My PT said: lower it to 95. Thoughts?" The second sentence is a question, but the first is read as Ben's own `change`, so `adjust_pending_sets` opens. Because a `change` request is applied straight away (Path A), the model can lower sets 3–4 on the strength of a quote, when Ben was asking for an opinion. Likewise "Lower it. jk" is applied against his last word. Undo limits the harm, but rule 3 is "apply when Ben asks".

**Fix.**
- Don't split on a colon when the text before it is a speech frame (`(?:he|she|they|my \w+|\w+) (?:said|says|told me|reckons|thinks|suggested)`). Treat the quoted part as data. A colon after a known label is already handled.
- Add `jk`, `just kidding`, `kidding`, `or not`, `(?:or )?actually no`, `scratch that` and `lol no` to `RETRACTION`. Allow a leading `or`.
- Split on `\s*[—–]\s*` as well as ` - `.
- Add `at the weekend`, `on the weekend`, `\w+ (?:weeks?|days?) back` and `the previous (?:session|workout|time)` to `PAST_DAY`.
- In `aboutSomethingElse`, allow leading adverbs (`honestly|mostly|just|more`).
- Reject `cut|drop|lose` + mass + `(?:of fat|before|by) …`, objects of the form `(?:my )?(?:\w+ )?goal`, `cardio|minutes? of`, and degrees/`incline|decline` angles, all as non-set objects. Add `negative`, `\d+ ?second` and `pause` to `TECHNIQUE_CUE`.
- Add every row above as a negative test.

## Should fix (not blocking)

### S1. Pain mentioned in an earlier turn doesn't block increases (rule 9)
`messagePain` (`packages/domain/src/coach/adjust.ts:53-60`) only sees the current message. Consider this sequence:
1. Turn 1: Ben says "knee's feeling a bit off" (`unclear`). CM6 asks "Sore or pain?" and he ignores it.
2. Turn 2: Ben says "add 5 to squat". The mention is `none` and there's no flag, so the increase applies.

The code comment at `adjust.ts:258-261` says "nothing goes up until he has answered", but only the same message enforces that. CM6 §2.8 says "Ignoring it flags nothing". The engine should carry an unanswered `unclear`/`pain` mention (with its body part) for the rest of the session as an input like `sessionPainUnspecified`, until Ben taps `Normal soreness`. See spec issue 2.

### S2. `unclear` false positives now block increases, and the note can misstate what Ben said
Since B4, `unclear` blocks every increase. These all return `unclear`, so "add 5" is refused:
- "Legs are dead but add a set", "Quads are dead, bump it" and "Way too easy, add 5, arms are on fire": effort at muscles, which r5 asked to keep as `effort`;
- "Add 5, no knee pain today": the negator isn't immediate;
- "Add 5 — knee's grand" and "Bump it, hip is behaving": positive words the fallback doesn't know;
- "Never had a knee problem".

For "Add 5, no knee pain today", the guard note reads **"Not increasing anything: you mentioned pain."** (`adjust.ts:265-268`, `bodyPart` null). Ben said the opposite, and this is app-authored text.

**Fix:**
- Muscles (quads, legs, arms, glutes, hams, lats, pecs, delts, calves) with effort or "dead"/"on fire" are `effort`.
- Add `grand|behaving|fine|ok|good|great` after a body part as a positive.
- Treat `no <body part> pain` as negated.
- For `unclear`, make the note say what was actually said: "Not increasing anything: you said your knee feels off. Tap Normal soreness to carry on." Never say "pain" for `unclear`.

### S3. Playbook personal-text check still lets common third-person forms through (rule 10)
`personalPlaybookText` (`packages/coach/src/tool-call.ts:128-169`) accepts all of these: "They prefer machines", "Their knee gets sore on lunges", "Athlete prefers machines", "Trainee prefers machines", "Lifter hates lunges", "Mr Dunlop trains before work", "Benjamin trains early" and "Our guy trains before work".

It refuses general rules that start with a bare verb: "Needs at least 48h between heavy squat sessions" and "Is best to keep RPE under 9 on accessories".

Ben approves candidates, so this isn't blocking, but the Your data / Coaching knowledge split shouldn't depend on his catching it.

**Fix:**
- Refuse `they|their|them` combined with a preference or body verb.
- Refuse a bare `(?:athlete|lifter|trainee|our guy)` subject.
- Refuse `benjamin|dunlop`.
- Allow `needs|is best|works best` when followed by a general object.

### S4. Clear requests still return `null` (rule 3, fail-safe)
23 of my 34 clear requests miss:
- "Lighter", "Less weight" and "Down to 95 please";
- "Strip 5 off";
- "I'll do 95 for the rest", "Gonna go 95 for the rest", "Let me do 95 instead" and "Same again but 95";
- "Rest of bench at 95 please";
- "One less set", "Two fewer reps please" and "No more sets after this";
- "Can I stop after this set?", "I'm done after this one" and "Let's call it after set 3";
- "Drop it to 95 if that works" and "Lower it if you think so": `POLITE_IF` misses these;
- "Can you drop it? Thanks, all good": "all good" is read as a retraction;
- the very-easy signals "Felt like nothing", "Easy peasy" and "Piss easy";
- the near-miss signals "Barely" and "Nearly didn't get it".

These fail safe: the coach offers and Ben taps. But each miss is also a turn where B1c's acknowledgement hole matters. The "all good" retraction is the one that reads against Ben's intent. Treat `all good|it's fine` as a retraction only when it is the whole clause, and not after "thanks".

### S5. JWKS signature path on the device
Unchanged from r5 S4.

## Nits
- `classifyPainMention("This app is a pain")` returns `pain`. That's harmless.
- Still open from r1–r3: `adjust.ts:399-400`, `adjust.ts:82-88` and `render.ts:360-370`.
- The catalogue drawing tests' 5 s timeout makes `npm run check` flaky under load. That's not this branch.

## Tests
The r5 rows are covered: the B1a live-ledger block (`claims-corpus.test.ts:766+`), the stale-undo scenario, the inverted `needsNoChangeLine`, the B2 anatomy, exclamation and strain rows, the B3 negatives and the B4 validator tests (`coach-guardrails.test.ts:920-970`).

These are missing:
- live-ledger claims that name an extra entity: a flag, a memory, next session, an added or removed set, a set type, the wrong direction or the wrong set range (B1a);
- undo records with `alreadyLogged`, and "still X" after an undo (B1b);
- question-shaped claims and emoji-only replies (B1c);
- reported speech, the new retractions and the goal/cardio objects (B2);
- a cross-turn pain case (S1);
- `unclear` false positives against the validator, and the wording of the note (S2).

## Spec issues
1. **Check 14 with a live change.** Option (a) now covers turns where nothing was saved. In turns with a saved change, the contract still relies on phrase lists. Every round shows those lists keep false extras ("Also sorted your knee."). I propose amending check 14: in a turn with a live change, a sentence is kept only when every entity it names is covered by a matched record; anything else is hidden with the existing `mismatch` note. The cost is a few false hides of harmless asides, and that trade is the same one Ben/PM are already ratifying for option (a).
2. **Unanswered "Sore or pain?" across turns** (S1). CM6 §2.8 says "Ignoring it flags nothing", but it doesn't say whether increases stay blocked for that body part for the rest of the session. Rule 9 ("pain or injury mentions stop progression") suggests they should. Ben/PM need to decide.
3. **Signals in words are now Path A.** Since r5 S1, "Felt like a warmup", "Had 5 more in the tank" and "RPE 6" are `difficulty`, so they open `adjust_pending_sets` and an *increase* can apply straight away. CLAUDE.md rule 3 says a change the coach raises from a signal is an offer that waits for Ben's accept; only Ben's ask applies immediately. Whether a report like this counts as asking is still open (r4 spec issue 3). It now affects increases as well as decreases, so Ben should decide before C4.
4. As before, the §6.1 `ben_request` notes, `REQUEST_KINDS_BY_TOOL`, the `playbook` and `hold` kinds, `messagePain`, the inverted no-change line and ADR 0019 are all still marked "needs Ben/PM approval" or Proposed.
