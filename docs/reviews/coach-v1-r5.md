VERDICT: CHANGES NEEDED

# Review r5: coach v1 (branch `claude/coach`), after the fixes for `coach-v1-r4.md`

Reviewer, 10 Oct 2026. Range: `git log claude/gracious-knuth-joxqpw..HEAD`, 42 commits. The 4 commits since `4c00fba` (`a980a5a`, `0d78d0a`, `bfacbb9`, `063f7ed`) are the r4 fixes. The branch-only diff (`...HEAD`, 59 files) adds no key, secret or `.env` file.

I checked the classifiers and guardrails against CLAUDE.md rules 2, 3, 4, 5 and 9, and against the honesty contract (coach-contract CC3 to CC5, CC10, §6.1, check 14; coach-adjustments §4.1; coach-memory CM6). As in earlier rounds, I wrote my own phrasings and didn't reuse the corpus.

## What I ran

- `npm run check`: typecheck and lint pass. The tests gave 3 failures, all 5 s timeouts in `packages/catalogue/test/{figure,motion-r3}.test.ts`, which this branch doesn't touch. Run alone with `--testTimeout=120000`, those 2 files pass (50 tests). `packages/coach` and `packages/domain` pass on their own (1308 tests). `catalogue:validate` passes (133 valid), `guide:check --all --verify` passes (10/10) and `guide:motion --all` passes (10/10).
- **Probes:** 439 phrasings that I wrote:
  - 172 run against `classifyBenRequest`;
  - 109 against `classifyPainMention`, including 4 mixed with requests;
  - 148 against `checkReplyClaims` and `needsNoChangeLine`, with an empty ledger, a ledger holding only the bench change to 95 kg, and an undone bench change;
  - 10 against `personalPlaybookText`.

  The probe files were placed temporarily in `packages/coach/test/` and deleted afterwards. Nothing except this review is committed.

## Status of the r4 findings

| r4 | Status |
|---|---|
| B1 request remarks | **Fixed for the listed rows, and much better overall.** Negated, past and question forms of the difficulty report now return `null`, as do "Too heavy for a Monday", "Drop me a text", "Raise a glass", "Up the volume", "Don't you dare lower the weight", "No need to drop the weight", "Maybe lower it" and "Lower it?". Of my 87 phrasings that shouldn't open anything, 11 still do (B3). |
| B2 pain words | **The listed anatomy and conditions are fixed.** The new gaps are pain said through an effort word and short exclamations (B2). |
| B3 claim check | **The listed sentences are fixed** (295 corpus claims). Fresh phrasings still get through at the same rate as before (B1). I also found a number-matching bug that earlier rounds missed (B1a). |
| Spec issue 1 | Option (a) is implemented as `needsNoChangeLine`, but it is **off by default** and its own topic list misses common claims (B1c). |
| S1 / S2 | Mostly fixed. Some clear requests still miss (S1), and one playbook gap remains (S3). |
| S3 JWKS device run | Still open. |

Nothing on this branch writes yet: there is no turn engine, store or coach sheet. `validateTodayAdjustment` still holds rules 2, 4 and 5 as r4 described. I found one rule 9 gap in its input contract (B4).

## Blocking

### B1. The claim check keeps wrong statements (CC3, CC4, check 14)

**B1a. A claim that states the old value as the new one is kept** (`packages/coach/src/claims.ts:810-820, 833-836, 915-925`).

`factsOf` adds both the `before` and the `after` target to `f.loads` and `f.numbers`. `numbersMatch` accepts any value in those sets. Against a ledger where bench sets 3 and 4 went from 100 kg × 6–8 to 95 kg × 8:

| Sentence | Result |
|---|---|
| "Sets 3 and 4 are 100 now." | **kept** |
| "Bench is 100 for the rest." | **kept** |
| "Sets 3 and 4 now 95 x 6." | **kept** (6 was the old minimum) |
| "Lowered sets 3 and 4 to 95 for 6." | **kept** |
| "Sets 3 and 4 are 95 per side." | **kept** (the convention is never compared; the saved load is 95 kg total) |
| "Took 5 off sets 3 and 4." | hidden as `numbers_differ`, although 100 to 95 is exactly 5 off (a false hide) |

**Failure scenario:** the coach lowers sets 3 and 4 to 95 kg and then says "Sets 3 and 4 are 100 now." The sentence passes the check and isn't replaced (CC4). The card says 95 and the coach says 100. "95 per side" tells Ben to load about 210 kg on the bar. That breaks the rule 4 / load-convention guarantee in what Ben hears, even though the stored value is correct.

**Fix:**
- Match a claimed value only against the `after` targets, and against `before` only when the clause is a before/after statement ("from 100 to 95").
- Compare `convention` as well as `unit`. Treat "per side", "a side", "per hand", "each" and "per dumbbell" as a convention marker in the claim.
- Compare reps with the `after` rep range.
- Compute "N off" or "N lighter" as `before − after`.
- Add each row above to `claims-corpus.test.ts`.

**B1b. Recall on fresh phrasings has still not converged.** Of 105 change statements I wrote, 37 are **kept** with an empty ledger:

| Kind | Sentences kept with nothing saved |
|---|---|
| Undo | "Back at 100." "You're back on 100." "Same as before now." "As you were." "Undo worked." |
| Sets | "Losing set 4." "Killed set 4." "Lost set 4." "Bye bye set 4." "Four sets becomes three." "Three sets today instead of four." "Only three sets today." "Tacked a set on." "Tacking on a set." "Two sets at 95 to go." "Rest of bench at 95." |
| Set type | "AMRAP on the last set." "Last set to failure." "Drop set on the end." |
| Structural (CC10) | "Pec deck in for cable fly." "Pec deck for cable fly next time." "Cable fly → pec deck." "Pec deck > cable fly from now." |
| Pain hold / flag | "Shoulder flag's up." "OHP won't go up for now." "I'll keep OHP where it is." "Locked OHP at 50." "Lunges won't show up again." "You won't see lunges again." |
| Memory / playbook | "I know you train before work now." "I've got that." "Got that." "Playbook has it now." |
| Generic | "In it goes." "On the card now." "Locked and loaded." "In the bank." "Banked." |

These are kept with the bench-only ledger:
- "Hack squat at 95 now."
- "Every exercise is lighter now.", "All of today is lighter." and "Whole session is lighter now." (r4 fixed "all/every set" but not these)
- "Everything's 95 now."
- "Bench stays 95 next session." This is a next-session claim, but the ledger holds only today's change.

**The r4 failure scenario still happens with a one-word change:**
1. Undo returns `stale`, so the bench change is still live. (With an undone ledger the result is the same.)
2. The model says "Back at 100."
3. The sentence is kept, and `needsNoChangeLine` returns false.
4. Ben believes the card shows 100.

**B1c. The structural backstop doesn't cover these** (`packages/coach/src/reply.ts:81-83, 109, 172`).
- `needsNoChangeLine` is off unless `noChangeLine: true` is passed, so the guarantee that check 14 depends on is not active.
- Its `CHANGE_TOPIC` list needs a unit, `back to`, a set or rep word, or an exercise. It returns **false** for "Back at 100.", "You're back on 100.", "95 it is.", "95 from here.", "You're on 95 for the rest.", "Next week: 102.5.", "Next session you're at 102.5.", "Coming off 5 for the last two.", "Your card shows 95 now.", "I know you train before work now.", "Got that.", "Banked.", "In it goes." and "On the card now.". That is 33 of the 105.

So even with the flag on, a short reply made only of a bare number or a generic acknowledgement gets neither a hidden line nor the fixed line.

**Fix:**
- Widen `CHANGE_TOPIC` so it fires on any digit; on `card|plan|next (week|session|time)|back (at|on)|as (you were|before)`; and on any of the claim triggers.
- Better still, invert it. In a turn with no live action, show the line unless the reply is a pure question or contains no training content.
- Get Ben/PM's decision on spec issue 1 so the line can be switched on before C4 ships. Until it is on, check 14 is not met.
- Add the B1b rows to the corpus.

### B2. Pain said through effort words, exclamations and "felt something go" is missed (rule 9, CM6)

`packages/domain/src/coach/pain-words.ts:185` (`EFFORT`) together with `:340-342`: any effort word sets `clauseSignal`, which turns off the body-part fallback at `:365`. `:56-70` (`PAIN`) and `:74-84` (`PAIN_PHRASES`) have gaps.

| Result | Phrases |
|---|---|
| `effort` | "Burning in my elbow", "Burning sensation in my forearm", "Shoulder feels heavy", "Knee is hard to bend", "Elbow's fried", "Lower back is cooked", "Knee is cooked", "Shoulder is gassed", "My back is tired, weird tired" |
| `none` | "Felt something go on the last rep", "Something gave on the last rep", "Felt a pull", "Something twanged", "Bit of a twang", "Heard a crack", "Felt a click and then nothing", "Ow", "Owww", "Argh", "That stung", "Stings a bit", "It stings", "Can't straighten it", "Can't grip properly", "Pins & needles" |

That is 25 misses out of about 95 pain or symptom phrasings.

**Failure scenario:** between sets of OHP, Ben says "burning in my elbow". The result is `effort`, so CM6 doesn't ask, `set_pain_flag` stays closed and progression continues. A burning joint is a classic thing to stop for. Likewise, "felt something go on the last rep" is the most common way people report a strain, and it returns `none`.

**Fix:**
- An effort word next to a **joint or tendon** (elbow, knee, wrist, shoulder, neck, back, hip, ankle, achilles, tendon, joint) is `unclear`, never `effort`. It stays `effort` only next to a muscle ("quads are burning").
- Add `ow+`, `argh`, `sting(s|ing)`, `stung`, `twang(ed)?`, `crack(ed)?`, `snap(ped)?`, `pins & needles`, `felt (a|something) (go|give|pull|pop|tear)` and `something (went|gave)` as pain.
- Make `can't (straighten|bend|grip|lift|raise|turn|move)` `unclear`.
- Add every row above to `coach-guardrails.test.ts`.

### B3. Remarks still open `adjust_pending_sets` (rule 3), and retractions are partly ignored

`packages/coach/src/request.ts`:
- `:268-272` (`difficultyIn` has no time check);
- `:216-218` (`FAILED`);
- `:329, 438` (a conditional counts only at the start of a sentence);
- `:347-356` (`rest` and `bar` count as training objects);
- `:364` (the linking-verb window);
- `:119` (`ANOTHER_SET`);
- `:196-197, 421-423` (`RETRACTION` is tested only on the last sentence, with commas removed).

| Ben says | Result | Should be |
|---|---|---|
| "Missed a rep on Tuesday, today was fine" | `difficulty` | `null` (another day) |
| "Couldn't do the last rep last week but today flew up" | `difficulty` | `null` |
| "That was brutal, the traffic" | `difficulty` | `null` |
| "Drop set on the last one was fun" | `change` | `null` (the linking verb is beyond the 3-word window) |
| "Extra set of eyes would help" | `change` | `null` |
| "Lower the weight under control" | `change` | `null` (a tempo cue) |
| "Remove the bar from the rack first" | `change` | `null` |
| "Increase the rest to 3 minutes", "Add 30s rest" | `change` | `null` or a settings question: rest isn't a target `adjust_pending_sets` can change |
| "Add weight next time if it moves well" | `change` | `null` (a conditional after the verb) |
| "I want it lighter but leave it" | `change` | `null` (a retraction in the same sentence) |
| "Lower it. Hmm actually leave it as it was" | `change` | `null` |
| "Lower it. Never mind, keep it" | `change` | `null` (the comma is stripped, so "never mind keep it" doesn't match) |
| "Lower it. Don't" | `change` | `null` |

Difficulty is Path A, so a past-day report like "Missed a rep on Tuesday" lets the model lower today's sets straight away when Ben made a remark. A retraction that isn't recognised means a change applies against Ben's last word. Undo limits the harm, but rule 3 is "apply when Ben asks".

**Fix:**
- Cancel `difficulty` and `FAILED` when the clause has a past-time marker (`last week|yesterday|on <weekday>|last time|used to|ago`).
- Test `if|unless` anywhere after the verb in `isDirective`, not only at the start of the sentence.
- Exclude `rest <duration>` and `the bar from|off the rack` objects.
- Widen the linking-verb window for `drop set|superset|top set` nouns.
- Require `ANOTHER_SET`'s `of …` to be an exercise.
- Test `RETRACTION` on each clause after the last directive, keeping comma clauses, and add `leave it as it was`, `don't`, `never mind keep it` and `but leave it`.
- Add every row above as a negative test.

### B4. A pain mention in the same message doesn't block an increase in that message (rule 9)

`packages/domain/src/coach/adjust.ts:45-47` (the validator input has `painFlags` and `sessionPainUnspecified` only); `packages/coach/src/registry.ts:225-240` (`TurnGate.benPainWords` gates `set_pain_flag` and nothing else).

| Ben says | Request | Pain |
|---|---|---|
| "Way too easy, but my knee hurts" | `difficulty` | `pain` |
| "Bump it up, shoulder's niggly" | `change` | `unclear` |
| "Add 5 kg to squat, my knee is sore" | `change` | `unclear` |

Both tools are open. If the model calls `adjust_pending_sets` before `set_pain_flag` (or never calls the flag tool, or Ben hasn't answered CM6's "Sore or pain?" yet), no flag exists and the increase passes the validator. Rule 9 says "Pain or injury mentions stop progression for that movement", not "pain flags do".

**Fix:** add `messagePain: PainMention` (and the movements named, if any) to the validator input. Drop increases on the named movement, or on every movement when none is named, when the message is `pain` or `unclear`, with a guard note ("Not increasing: you mentioned your knee"). Test the three rows above.

## Should fix (not blocking)

### S1. Clear requests and Path A signals still return `null` (rule 3)
This is fail-safe, but Ben has to ask twice.
- **Plate talk:** "Strip a plate", "Pull a plate off", "Take a plate off each side", "Throw another 5 on", "Stick 2.5 on each side", "Load it up to 100".
- **Easing off:** "Back it off a bit", "Back off to 90", "Dial it back", "Tone it down", "Lighter".
- **Removing a set:** "Kill/Lose the last set", "Get rid of set 4", "Nix set 4", "Can we not do set 4".
- **Other changes:** "8 reps instead", "Push me harder", "Do dumbbells instead".
- **Holding progression:** "Hold bench where it is", "Same weight next time", "Don't increase it next time", "Stop progressing bench". These are hold requests, which CLAUDE.md rule 3 treats as small next-session changes.
- **Labelled lines:** "Rule: no deadlifts after squats", "Remember, I hate lunges".

The signals CLAUDE.md rule 3 names ("RPE 10", "big rep miss", "very easy set") return `null` in words: "RPE 10", "That was RPE 10", "0 RIR", "Barely got the last rep", "Almost failed", "Had 5 more in the tank", "Felt like a warmup". If `signals.ts` covers these from the logged RPE, say so in §6.1. If not, add them as `difficulty`.

### S2. Pain false positives
"Knee hasn't hurt since Tuesday" and "It hurt last week, fine now" return `pain`, because `hasn't`, `haven't` and `hadn't` aren't in `NEGATORS` (`pain-words.ts:191`) and past tense isn't considered. "Pulled 200 today" and "Popped another plate on" also return `pain`. This is low harm (it opens the flag tool), but add the negators.

### S3. Playbook text
`personalPlaybookText` (`tool-call.ts:157`) allows "Trains fasted before work" (no subject) and "Owner prefers machines" (no article). Refuse a sentence that starts with a bare third-person verb, and refuse `owner` without "the".

### S4. JWKS signature path on the device
Unchanged from r4 S3.

## Nits
- `request.ts`: "Remember: I said that already" returns `memory`. That's harmless, because the model still chooses the content.
- Still open from r1 to r3: `adjust.ts:399-400`, `adjust.ts:82-88` and `render.ts:360-370`.
- The catalogue drawing tests use the 5 s default timeout, so `npm run check` fails under load. That isn't this branch.

## Tests
The r4 rows are well covered:
- every B1 row as a negative test, plus the registry test that "It wasn't too heavy" withholds `adjust_pending_sets`;
- the r4 anatomy phrases;
- a corpus of 295 claims;
- `needsNoChangeLine` tests.

These are missing:
- any test that a claim stating the **before** value, the wrong reps or the wrong convention is hidden or replaced (B1a);
- the B1b, B2 and B3 rows;
- a validator test for same-message pain plus an increase (B4);
- a `needsNoChangeLine` test for bare-number replies ("Back at 100.").

## Spec issues
1. **Check 14 still fails on phrase lists, for the fifth round.** The developer's own probe kept 16 of 40 fresh phrasings, and mine kept 37 of 105. Option (a) exists but is off pending Ben/PM. I recommend approving it now, with the widened trigger from B1c, as a precondition for C4. Without it the honesty contract rests on regexes that every round shows to be incomplete.
2. **Same-message pain** (B4): the spec (CM6, coach-adjustments) doesn't say what happens to an increase in a turn whose message also says "sore" or "hurts" before Ben answers "Sore or pain?". I propose: no increases on that movement in that turn.
3. Open from r4: whether a difficulty report should apply straight away (Path A) or only offer (r4 spec issue 3). B3 shows that past-day remarks still reach Path A. General health symptoms (r4 spec issue 2) are `unclear` until Ben/PM decide.
4. The §6.1 `ben_request` definition, `REQUEST_KINDS_BY_TOOL`, the `playbook` kind and ADR 0019 are still marked "needs Ben/PM approval" or Proposed.
