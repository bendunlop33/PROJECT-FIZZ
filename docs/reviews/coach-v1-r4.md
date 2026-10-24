VERDICT: CHANGES NEEDED

# Review r4: coach v1 (branch `claude/coach`), after the fixes for `coach-v1-r3.md`

Reviewer, 10 Oct 2026. Range: `git log claude/gracious-knuth-joxqpw..HEAD`, 37 commits. The 4 commits since `a8b2372` are the r3 fixes. The branch-only diff (`...HEAD`, 57 files) adds no key, secret or `.env` file.

I checked the classifiers and guardrails against CLAUDE.md rules 2, 3, 4, 5 and 9 and the honesty contract (coach-contract CC3 to CC5, CC10, §6.1, check 14; coach-adjustments §4.1; coach-memory CM6). As in earlier rounds, I wrote my own phrasings rather than reusing the corpus.

## What I ran

- `npm run check`: typecheck and lint pass. The tests gave 1952 passed and 3 failed. All 3 failures were 5 s timeouts in `packages/catalogue/test/{figure,motion-r3}.test.ts`, which this branch doesn't touch. Re-run alone with `--testTimeout=120000`, those 2 files pass (50 tests). `catalogue:validate` passes (133 valid), `guide:check --all --verify` passes (10/10) and `guide:motion --all` passes (10/10).
- **Probes:** 363 phrasings that I wrote, run against `classifyBenRequest`, `classifyPainMention`, `checkReplyClaims` (with an empty ledger and with a bench-only ledger) and `personalPlaybookText`. The breakdown is 129 request, 123 pain, 106 claim and 5 playbook phrasings. The probe files were placed temporarily in `packages/coach/test/` and deleted, so nothing was committed. The results are quoted below.

## Status of the r3 findings

| r3 | Status |
|---|---|
| B1 request questions | **Fixed for the listed forms.** Every r3 row now returns `null`, including wh-questions, "would you … if", "Change nothing", `X's` remarks, wants with no training object and a bare "go ahead". My own question forms were also clean: "How come you dropped it?", "Should we lower it?", "Maybe drop it?", "What if we lowered it?", "So you would drop it to 95?" and others. There is a registry test for "Why would you lower sets 3 and 4?". The same flaw remains in the `STRONG` verb path and in `DIFFICULTY` (B1 below). |
| B2 pain words | **Mostly fixed.** Contractions, negated positives, carve-outs and body parts without "my" all work: "my knee's not right", "Knee wasn't happy", "Shoulder said no", "Knee not loving the squats", "Elbow did not enjoy that" and others. The vocabulary still misses common gym anatomy and conditions (B2). |
| B3 claim check | **The listed sentences are fixed** (212 claims in the corpus). Fresh phrasings still get through at about the same rate as in r1 to r3 (B3). |
| S1 playbook | **Partly fixed.** There is a new `playbook` kind, and `parseToolCall` refuses first-person candidate text. Two gaps remain: the spec's own example "Add a rule: …" doesn't classify as `playbook`, and third-person personal facts pass (S2). |
| S2 JWKS device run | Still open. |
| Nits | `pain-free` and "too much coffee" are fixed. `adjust.ts` set numbers, the `exerciseSets` duplicate and the `render.ts` Undo dedupe are still open. |

Scope is unchanged: there is no turn engine, store or coach sheet yet, so nothing on this branch writes. Within that scope, the deterministic validator (`validateTodayAdjustment`) still holds:
- only pending sets change (rule 2);
- loads are snapped, capped and converted in the right convention, including assisted direction (rule 4);
- a `baseVersion` mismatch returns `stale` (rule 5);
- increases and added sets are blocked under a pain flag, a check-in pain or a lighter session (rule 9).

I found no new issue in it. The findings below are in the gates and the claim check, which C4 will rely on.

## Blocking

### B1. Remarks still open `adjust_pending_sets` through the `STRONG` path and through `DIFFICULTY` (rule 3)
`packages/coach/src/request.ts:61-62, 170-176` (a `STRONG` verb with any object is a directive, and only `NON_OBJECT` and `PERSON_OBJECT` are excluded); `:110` (`DIFFICULTY` has no negation, question or subject check); `:222`; `registry.ts:269` (`difficulty` opens `adjust_pending_sets`).

r3 added a training-object test to `WANT_OBJECT` but not to `STRONG`. A difficulty report is Path A (coach-adjustments §4.1: the change applies straight away), so a false `difficulty` is the most harmful false positive.

| Ben says | Result |
|---|---|
| "It wasn't too heavy" / "Not too heavy" / "Never too easy" | `difficulty` (the negation is ignored) |
| "Set 3 was too heavy?" / "If set 3 is too heavy what then?" | `difficulty` (a question) |
| "Way too early for this" / "Way too many people here" / "That rest was way too long" / "Too hard to say" / "Too easy to forget my belt" / "Too light in here, the sun" | `difficulty` (not about a set) |
| "Couldn't get a bench, all taken" / "Failed the drug test lol" | `difficulty` |
| "Deload week starting Monday" / "Lower body day tomorrow" / "Increase in pain on set 3" / "Update on my shoulder, feels fine" / "Scale reckons 80 kg" | `change` (a remark that starts with a `STRONG` word; r3 fixed only the colon form "Update: …") |
| "Change the music" / "Cut the chatter" / "Ease up on the chat" / "Skip the small talk" / "Change your tone" / "Cut sugar this week" / "Adjust the timer to 3 min" / "Change my bodyweight to 82" / "Delete that last message" / "Drop the voice, text only" / "Remove the coach note please" / "Raise your game coach lol" | `change` (the object isn't training) |
| "Switch to dark mode" / "Swap the music" / "Replace the battery in my watch" / "Switch gyms, I am at the hotel" | `structural` |
| "Add a rule: never squat after deadlifts" | `change` (see S2) |
| "Can you lower it? Actually no, leave it." | `change` (the retraction is ignored; nit) |

**Failure scenario:** Ben finishes set 2 of bench at RPE 7 and says "It wasn't too heavy". The classifier returns `difficulty`, so `adjust_pending_sets` is in the registry. Under Path A the model raises sets 3 and 4 straight away, although Ben only made a remark. Rule 3 says the coach offers, and applies only once Ben accepts. "Increase in pain on set 3" also opens the adjust tool in the same turn as a pain report.

**Fix:**
- Give `STRONG` the same object test as `WANT_OBJECT`: the verb needs `TRAINING_OBJECT`, a pronoun (it/them/that/the rest/the last two), a set reference, an exercise name or a value. "Change the music" and "Cut sugar" then fail.
- Treat a `STRONG` word followed by a noun and a `LINKING`-like continuation (`week|day|body … starting|tomorrow`) or by `in|on|of` + noun ("increase in pain", "update on my shoulder", "change of …") as a remark.
- Give `DIFFICULTY` three checks:
  - a negator within 3 words before it cancels it ("not too heavy", "wasn't too heavy");
  - it doesn't count in a question or an `if` clause;
  - the "too/way too" forms need a set subject or end the clause ("too heavy", "way too heavy", "set 3 was too heavy"), and never `too <adj> to` or `too early|many|long|light in`.
- Limit `couldn't get|failed` to set objects (rep, reps, set, lift, the last, lockout, depth, a number).
- `STRUCTURAL` swap verbs need a training object too.
- Add every row above as a negative test, plus a registry test that "It wasn't too heavy" withholds `adjust_pending_sets`.

### B2. Pain words return `none` for common gym anatomy, conditions and vague reports (rule 9, CM6)
`packages/domain/src/coach/pain-words.ts:65-71` (`BODY`), `:117` (`flexor`/`flexors` in `NOT_BODY_FOLLOW`), `:280` (`VAGUE_BODY` needs a word from `BODY`), `:44-54` (`PAIN`) and `:254-289` (a negated pain word sets `clauseSignal`, so the fallback is skipped).

Of 123 pain phrasings, 24 return `none`:

| `none` for | Cause |
|---|---|
| "Delt feels weird", "Delt's angry", "My delts are wrecked", "Rear delt feels off" | `delt`/`delts` not in `BODY` |
| "Hammy went", "Hammy's gone again" | `hammy` not in `BODY` (yet "Pulled a hammy" is `pain`) |
| "Hip flexors are angry" | `flexors` is in `NOT_BODY_FOLLOW`, so it reads as an exercise |
| "Adductor feels weird", "QL is cranky", "Psoas acting funny", "Piriformis is angry", "Teres feels off", "Scapula feels off", "Collarbone feels odd", "Core feels weird" | missing anatomy |
| "Sciatica bad today", "Plantar fasciitis again", "Slipped disc" | conditions not listed (`sciatica`, `fasciitis`, `disc`, `herniated`, `bulging`, `hernia`, `fracture`, `broke(n)`, `shin splints` …) |
| "Left side is weird", "Right side feels off", "My left one is grumbling", "Not the best on the left side" | side or pronoun with no named part |
| "Doesn't hurt, just feels wrong", "Doesn't hurt exactly, just off" | the negated pain word marks the clause as handled, and "feels wrong" with no body part is `none` |
| "It aint right" | `aint` not a negator |

**Failure scenario:** after set 2 of lateral raises Ben says "rear delt feels off". `benPainWords` is false, so `set_pain_flag` isn't offered and CM6 doesn't ask. Progression continues on the movement. This is the third round in which the vocabulary has missed natural gym speech.

**Fix:**
- Add gym anatomy (`delt(s)`, `hammy/hammies`, `adductor(s)`, `abductor(s)`, `ql`, `psoas`, `piriformis`, `teres`, `scap(ula)`, `collarbone`, `sternum`, `oblique(s)`, `abs`, `core`, `it band`, `tfl`, `rhomboid(s)`, `lumbar`, `side`) and conditions (`sciatica`, `fasciitis`, `disc`, `herniated`, `bulging`, `fracture(d)`, `broke(n)` + body, `splints`) as pain or `unclear`.
- Remove `flexor`/`flexors` from `NOT_BODY_FOLLOW` and add `hip flexor` as a body part.
- Let `VAGUE_BODY` count after "left/right side", "left/right one" or "it", when the clause has a state verb (`feels|is|was`).
- In a clause where the pain word was negated, still treat a following vague word (`wrong|off|weird|odd|funny`) as `unclear`, and add `aint|ain't` to the negators.
- Add every phrase above to `coach-guardrails.test.ts`.

See also Spec issue 2.

### B3. The claim check keeps 43 of 84 fresh change statements with an empty ledger (CC3, check 14)
`packages/coach/src/claims.ts`:
- `:384-429` (`hasClaimTrigger`) and `:494-505` (`valueStatement` needs a digit);
- `:276-288` (`PRESENT_STATE`) and `:294-300` (`STRUCT_STATE`);
- `:308-309` (`PAIN_HOLD`) and `:540` (`UNDO_WORDS` doesn't make a claim on its own);
- `:547` (`GENERIC_ONLY`);
- `:127-133` and `:594` (an exercise word that isn't in `knownExerciseNames` is dropped).

Clear false keeps (`keep: true`, nothing saved):

| Kind | Sentences kept |
|---|---|
| Load, no number | "Lighter for the last two." "Bench lighter for the rest." "Your last two are a touch lighter." "Easier sets from here." "Easier from here on." "Bench goes up a notch next time." |
| Undo | "Back to 100." "Rolled back." "Reversed." "Back how it was." |
| Sets | "Extra set on the end for you." "One more set of curls on the card." "Last set scratched." "No set 4 today." "Two sets left at 95." "Last two: 95." "Last set is an AMRAP." "Bench gets a fourth set next time." |
| Structural (CC10) | "Pec deck next time." "Next time: pec deck." "Your next Push A has pec deck instead of cable fly." "Pec deck takes over next time." "Pec deck replacing cable fly." "Pec deck goes where cable fly was." "Squats lead next time." "Squat kicks off next session." "Cable fly retired." "Cable fly gets a rest next week." |
| Pain hold | "OHP's on ice for now." "Overhead press is off the table for now." "Leaving overhead press alone for now." "I won't push overhead press for now." "No more overhead pressing till the shoulder settles." "Overhead press stays at 50 until your shoulder settles." |
| Memory | "I've let that go." "Gone from memory." |
| Generic | "Boom done." "Handled." "Squared away." "Say no more." "Your plan now reflects that." |

Against a ledger holding only a bench change to 95 kg:
- "OHP is 95 for the rest", "RDL is 95 for the rest" and "Lat pulldown is 95 for the rest" are **kept**. Abbreviations aren't aliases, and a movement word that matches no known name is dropped, so it can't contradict the ledger.
- "All your sets are 95 now" and "Every set is 95 now" are **kept**, although only sets 3 and 4 changed.

**Failure scenario:**
1. Ben taps Undo by voice ("undo that").
2. The undo returns `stale` because set 3 was just logged.
3. The model says "Rolled back."
4. The sentence passes. The card still shows 95, and Ben believes it's 100 again.

Check 14 says a false keep fails the build.

**Fix:** extending the regex lists won't converge. This is the fourth round, and each round finds 25 to 45 misses. Pick one of the structural options in Spec issue 1 and stop treating recall from phrase lists as the guarantee. Until then, at minimum:
- treat `back to \d`, `rolled back`, `reversed` and `back how it was` as undo claims;
- treat comparative loads (`lighter|heavier|easier|harder|a notch|a touch`) with a scope as value claims;
- treat "`<exercise>` next time/session" with no verb, and present participles after a noun ("pec deck replacing"), as structural claims;
- treat `off the table|on ice|leave … alone|won't push` + exercise as pain-hold claims;
- add `ohp`, `rdl`, `db`, `bb` and similar abbreviations to the aliases;
- make a movement word that matches no known name (or `all|every set`) a mismatch, not a pass.

## Should fix (not blocking)

### S1. Clear requests are classified as not requests (rule 3, "When Ben asks … apply immediately")
These return `null`, so Ben has to ask again or tap: "Lighter please", "95 for the rest please", "Can I go lighter?", "Can I drop to 95?", "Bring it down to 95", "Gimme 95 for the rest", "Less weight next set", "Sets 3 and 4 at 95", "Last two at 95", "Put me down for 95", "One more set", "Another set please", "Extra set", "Two more reps on the last set", "Heavier next time", "I'm sick of cable fly", "Can we do something other than cable fly?" and "Remember: no lunges".

This fails safe, but the most natural ways to ask don't work, and the coach then has to offer something Ben already asked for. **Fix:**
- accept a verbless value request (a value or comparative with a scope, plus `please` or the end of the clause);
- accept `can i …` + a directive;
- add `bring` to the weak directives;
- accept `another|one more|extra set`;
- accept `sick of|tired of` + an exercise as structural;
- accept `remember:` with a colon.

### S2. Playbook: the spec example misses, and third-person personal facts pass (rule 10)
- `request.ts:124`: the clause split on `:` leaves "add a rule" with no trailing space, so "Add a rule: never squat after deadlifts" is `change`, not `playbook`. That is the example given in §6.1. It also opens `adjust_pending_sets`.
- `tool-call.ts:128-131`: `personalPlaybookText` allows "The left knee is dodgy on lunges", "Avoid deep lunges with a dodgy left knee", "He trains before work" and "The owner trains fasted". Rule 10 then rests on the model's phrasing again. Also refuse text with a body part + `dodgy|bad|my|the left/right` or a third-person subject.
- `request.ts:116`: "Remember to bring chalk", "Don't forget to stretch" and "Remember my belt next time" open the memory tools. This is low harm, but they are reminders, not facts about Ben.

### S3. JWKS signature path not run on the device
Unchanged from r3 S2. Re-run S1 on Ben's iPhone before a coach build reaches him.

## Nits
- `request.ts`: a retraction later in the message ("Can you lower it? Actually no, leave it.") still classifies as `change`. Consider letting a final `no|actually no|leave it|never mind` clause cancel the earlier ones.
- `pain-words.ts`: "Bad shoulder day" is `none` because `day` follows. Fine for "shoulder day", but `bad` before the part should win.
- Still open from r1 to r3: `adjust.ts:399-400`, `adjust.ts:82-88` and `render.ts:360-370`.
- The catalogue drawing tests use the 5 s default timeout and fail under load, so `npm run check` is flaky. Not this branch.

## Tests

The r3 fixes are well covered: the r3 rows are in `request.test.ts`, the registry withholding test, the pain phrases, and a claims corpus of 212 claims and 98 non-claims. These are missing:
- every B1 row as a negative case, and a registry test for "It wasn't too heavy";
- the B2 anatomy, conditions and side phrases;
- the B3 sentences, plus ledger tests for abbreviations, unknown exercise words and "all/every set";
- the S1 positives, and "Add a rule: …" → `playbook`.

## Spec issues

1. **Check 14 (100% recall from phrase lists) has now failed four rounds in a row.** r1 to r4 each found 10 to 45 natural misses after the previous round's list was added. The guarantee needs a structural mechanism, and that needs Ben/PM approval (coach-contract CC3/CC4). Two options:
   - **(a)** In any turn with no live committed action, attach the fixed line `No change was saved in this reply.` whenever the reply mentions a load, set, rep count, exercise from the session, memory, flag or undo. Don't try to classify sentences.
   - **(b)** The model reports claimed changes only through a structured field checked against the ledger, and the app renders change text from the ledger.

   I recommend (a) as the minimum for C4, with the current classifier kept as a second layer for turns that did write something.
2. **Rule 9 and CM6 cover pain on a movement, but not general health warnings.** "Chest pain on bench", "Heart racing", "Feeling dizzy", "Bit lightheaded", "Nosebleed" and "Got a headache" either give `none` or only flag bench. The spec has no defined response such as "stop and get checked", which wouldn't be a diagnosis. Ben/PM should decide whether the coach shows a fixed, non-diagnostic safety line for these.
3. **Path A makes a difficulty report ("that was a grind") apply immediately** (coach-adjustments §4.1). Rule 3 says changes apply immediately "when Ben asks", and that otherwise the coach offers. A report isn't clearly a request. Combined with the regex recall problem (B1), this is the riskiest path. Consider asking Ben whether a report, as opposed to a directive, should produce an offer with a one-tap Adjust.
4. The §6.1 `ben_request` definition, `REQUEST_KINDS_BY_TOOL`, the `playbook` kind and ADR 0019 are all still marked "needs Ben/PM approval" or Proposed.
