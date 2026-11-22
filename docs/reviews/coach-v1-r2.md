VERDICT: CHANGES NEEDED

# Review r2: coach v1 (branch `claude/coach`), after the fixes for `coach-v1.md`

Reviewer, 10 Oct 2026. Range: `git log claude/gracious-knuth-joxqpw..HEAD`, 24 commits. The 13 commits since `811325b` are the fixes. The branch-only diff (`...HEAD`, 55 files) doesn't touch `apps/mobile/src/guide/*`, `HowToScreen.tsx` or `packages/catalogue/src/figure/*`. The guide and ADR 0018 differences in the two-dot diff are base-branch drift, not this branch.

Checked against CLAUDE.md rules 1 to 10, ADR 0019 (formerly 0018), coach-contract (CC1 to CC10, §6.1, check 14), coach-adjustments, coach-memory CM6, ai-connection AC6 and workout-summary.

## What I ran

- `npm run check` in `/home/user/wt-coach` exits 0: typecheck, lint, 110 test files and 1662 tests, catalogue validate, guide check and guide motion all pass.
- I ran probe tests from the scratchpad (not committed) against `checkReplyClaims`, `classifyPainMention` and `classifyBenRequest`. The results are quoted below.

## Status of the r1 findings

| r1 | Status |
|---|---|
| B1 claim check false keeps | **Partly fixed.** All 7 listed sentences are now hidden and are in the corpus. Other forms still pass, and one is a logic bug rather than a missing word (see B1 below). |
| B2 pain words | **Partly fixed.** All 7 listed phrases now classify as `pain`. Other common injury phrasings still return `none` (see B3 below). |
| B3 silent model switch | Fixed. `preselectModel` only preselects on a first connection, and a vanished choice is kept so the state reads `model_gone`. Tested. |
| B4 spoken Undo | Fixed, with a render test. |
| S1 pain blocks the whole change | Fixed. The lighter load is kept and the reps stay as planned. Tested. |
| S2 first-use notice | Fixed (`COACH_CHAT_IN_BUILD = false`). |
| S3 `benRequest` undefined | **Defined, but the classifier is far too broad, and the gate ignores the request kind** (see B2 below). |
| S4 idempotency | Fixed for the opId: only semantic fields are hashed, and `appendContentKeys` is ready for C3. |
| S5 JWKS | Built and unit-tested. Not yet run on the device (see S1 below). |
| S6 settings race | Fixed, with a slow-store test. |
| Nit "set 0" | Fixed. |
| Nit `sideEffects` | Fixed. |
| Nit ADR number clash | Fixed (renumbered to 0019). |
| Other r1 nits | Still open (see Nits). |

## Scope reality (unchanged since r1)

There is still no turn engine, context builder, store or coach sheet, so nothing on this branch can write a set, target, flag or memory. Against the code that exists:

- **Change completed sets?** No. `validateTodayAdjustment` drops completed, skipped and deleted sets (`adjust.ts:350-357`, `:372-376`).
- **Apply unsnapped or out-of-range loads?** No. Loads go through `roundToAvailableLoad`, are capped and never extrapolated, and an "easier" request never rounds harder (`adjust.ts:154-193`).
- **Ignore pain flags?** The validator honours them, including the new partial keep. The pain-word gate still misses real injury talk (B3).
- **Apply stale proposals?** No. A `baseVersion` mismatch or a non-active session returns `stale` (`adjust.ts:254-256`).
- **Claim a change that didn't commit?** Yes, still possible through the claim check (B1).
- **Leak Your data into Coaching knowledge?** There is no storage or context yet. `save_memory` and `add_playbook_candidate` are separate tools with separate content keys.
- **Fall back to a paid route?** No. There is no API-key route, and nothing in the diff adds a key or secret.
- **Prompt injection via notes or imports?** The gates (`classifyBenRequest`, `classifyPainMention`) are documented as taking only Ben's own words, and `benPainWords` / `benRequest` are never set from tool output. That holds only if C4 wires them that way, so add a test then.
- **Offline?** Logging and the Summary don't depend on the coach. The Summary reads the coach state from the Keychain and settings file only, with no network, and a read failure counts as `not_connected` (`SummaryScreen.tsx:50-51`).

## Blocking

### B1. The claim check still keeps false "done" statements against an empty ledger, and one cause is a logic bug
`packages/coach/src/claims.ts:254-257` (negator early return), `:203-221` (`PRESENT_STATE`, `presentStateClaim`), `:219` (modal veto) and `:90-93` / `:295-298` (generic name words dropped from aliases).

Probe: these sentences give `keep: true` with **nothing saved**:

| Sentence | Why it is kept |
|---|---|
| "Bench is down to 95 and not 100." | Any `not`/`no`/`n't` in the clause returns `false` at `:254` **before** `PRESENT_STATE` and `PHRASES` are tried |
| "Sets 3 and 4 are now 95 kg not 100." | Same cause |
| "Sets 3 and 4 should now show 95 kg." | `should` vetoes it as a suggestion, but "should now show" states a result |
| "You should now see 95 kg on sets 3 and 4." | Same cause |
| "Bench now sits at 95." / "The rest of your sets read 95 kg." / "Your app shows 95 for sets 3 and 4." | The verbs aren't in any list |
| "You are doing 95 for the rest." | `WILL_VALUE` only covers the future |
| "Bench: 95 kg for sets 3 and 4." / "95 kg for sets 3 and 4 from here." | A colon line with the exercise first doesn't match `SET_VALUE_LINE` |
| "Pec deck in, cable fly out." / "No more cable fly, pec deck from next time." | A structural claim (CC10) with no verb |
| "Got that in memory." / "I won't forget that." | A memory claim with no change verb |

With a ledger holding only a bench change to 95 kg, "Incline is 95 for the rest." is **kept**. "Incline" is in `GENERIC_NAME_WORDS`, so `Incline DB press` has no usable alias, the clause names no known exercise, and the bench record matches.

**Failure scenario:** Ben says "too heavy". The model answers "Sets 3 and 4 are now 95 kg, not 100." without calling `adjust_pending_sets`, or after the call came back `stale`. Ben sees a change that never happened. Check 14 says a false keep fails the build, and the corpus passes only because it doesn't contain these forms.

**Fix:**
1. Move the negator early return at `:254` so it only suppresses `PHRASES` that are themselves negated (for example, "nothing is now different"), not `presentStateClaim` and `GENERIC_ONLY`. Alternatively, apply the negation test only to the words before the trigger, as `negatedAt` does.
2. Treat "should/will now (show|see|read|be)" as a claim (a result statement), not a modal suggestion.
3. Add `sits at|reads?|shows?|you are doing|you're doing` + number, and "`<exercise>: N` / `N for sets …`" lines, to the present-state patterns.
4. Make verbless structural ("X in, Y out", "no more X") and memory ("in memory", "won't forget") forms claims.
5. When an alias resolves to nothing but the clause contains a word from a known exercise name (even a generic one like "incline"), treat it as a mention of that exercise and fail the match on mismatch.

Add every sentence above to the corpus. A cheaper long-term fix is worth considering: in any turn where no write committed, hide every clause that contains a load or set number in a present or past statement, rather than enumerating verbs.

### B2. `classifyBenRequest` classifies ordinary remarks as change requests, and the gate ignores the request kind (rule 3)
`packages/coach/src/request.ts:36` (`CHANGE_VERBS` includes `set`, `up`, `make`, `go`, `log`, `use`, `plan`, `take`), `:39` (`DIRECTIVE`), `:42` (`i (want|need) to …`), `:46`/`:63` (`MEMORY` with no negation or question check), `:65` (`STRUCTURAL` with no negation check). Also `packages/coach/src/registry.ts:259-262` (`needMet`: any non-null `benRequest` opens every `ben_request` tool).

Probe: each of these returns a request:

| Ben says | Result |
|---|---|
| "Set 3 was fine" | `change` |
| "set 2 felt good" | `change` |
| "Up next is squat right?" | `change` |
| "I want to understand why set 3 is 100" | `change` |
| "I need to leave by 7" | `change` |
| "Can you go over my form cues?" | `change` |
| "Plan looks good" / "Log looks right" / "Take your time" | `change` |
| "Remember when I did 100 for 8?" | `memory` |
| "I am not bored of incline press" | `structural` |
| "don't change my routine, just lower the weight" | `structural` |

The gate then gives any non-null request every `ben_request` tool. A `memory` request ("remember that I train before work") opens `adjust_pending_sets` and `forget_memory`. A `difficulty` report opens `save_memory` and `forget_memory`.

**Failure scenario:**
1. During a workout, after logging set 2, Ben types "set 2 felt good".
2. `benRequest = {kind: 'change'}`, so `adjust_pending_sets` is in the turn's registry.
3. The model raises sets 3 and 4 and the change applies immediately.

Rule 3 says that when the coach raises a change itself it must offer ("Want me to adjust?") and not apply until Ben accepts. The S3 fix was meant to make exactly this case testable, and the test list doesn't include a set remark.

**Fix:**
- Drop `set` (and the other noun-like verbs) from `DIRECTIVE` unless followed by a target ("set it to", "set 3 to 95"). Require an object or a value after the verb in `DIRECTIVE`. Restrict `i (want|need) to` to change verbs.
- Make `MEMORY` require "remember that/this" or a statement rather than a "remember when …?" question.
- Respect a preceding negator in `STRUCTURAL`.
- In `needMet`, map each tool to the request kinds that open it:
  - `adjust_pending_sets`: `change`, `difficulty` or a chip (or `acceptedOffer`);
  - `save_memory` and `forget_memory`: `memory`;
  - `add_playbook_candidate`: an explicit request kind.
- Add the probe sentences as negative tests, plus a gate test showing that a memory request doesn't expose `adjust_pending_sets`.

### B3. Pain classifier still returns `none` for common injury talk (rule 9, CM6)
`packages/domain/src/coach/pain-words.ts:22-31` (word lists) and `:90-93` (falls through to `none`). The module comment at `:16-18` says "When in doubt the answer leans to `pain` or `unclear`, never `none`". The probe shows that isn't true:

`none` for: "my shoulder flared up", "my back spasmed", "my knee is swollen", "aggravated my elbow", "it's bothering my wrist", "rolled my ankle", "my knee gave out", "my back went", "my lower back is acting up", "shoulder impingement again", "tendinitis flaring", "pins and needles in my hand", "dislocated finger", "bruised".

**Failure scenario:** Ben says "my shoulder flared up on the last set". `benPainWords` is false, so `set_pain_flag` isn't in the registry. The coach can't flag the movement, and progression continues on overhead press.

**Fix:**
- Add `flare/flared/flaring`, `spasm/spasmed`, `swollen/swelling`, `aggravate(d)`, `bother(ing)`, `rolled`, `gave out`, `impinge(ment)`, `tendinitis/tendonitis`, `dislocate(d)`, `bruise(d)`, `pins and needles` and `acting up` to `PAIN` or `UNCLEAR`.
- More robustly: when a clause names a body part (`shoulder`, `elbow`, `wrist`, `back`, `knee`, `hip`, `ankle`, `neck`, …) and no effort word, return `unclear` rather than `none`, so CM6 asks the question.
- Add these phrases to `coach-guardrails.test.ts`.

## Should fix (not blocking)

### S1. The JWKS check replaces a device-proven sign-in with an unproven one
`packages/providers/src/openai/jwks.ts`, `connection.ts:352-357`, `sign-in-test.ts:308-312`.

The code is correct as far as I can see:
- RS256 only, with no `none` or HMAC;
- a constant-time compare over the whole encoded message;
- a 2048-bit minimum;
- `jwks_uri` must be on `https://auth.openai.com/`;
- a failure revokes the tokens and stores nothing.

But S1 passed on Ben's iPhone today without it, and now every sign-in depends on BigInt modexp under Hermes, the discovery document's `jwks_uri` value, and two extra fetches. If any of these differs on the device, both the S1 test and the product connection fail with `id_token_invalid`. The failure is honest but unexplained, and the connection is unusable.

Before any build goes to Ben, re-run S1 on the device and record the `Checked: RS256 signature …` line in `docs/device-tests/`. Consider a distinct failure message for "couldn't fetch OpenAI's keys" (network) versus "signature mismatch", so Ben isn't told his token is invalid when he's only offline.

### S2. A claim can be kept on an "earlier" ledger entry without a token
`claims.ts:516`, where `checkClaim` considers all entries, including `origin: 'earlier'`. CC5 says an earlier change may only be mentioned through its `[[ref]]` from `get_recent_actions`. Free text such as "I lowered sets 3–4" is then kept on the strength of an earlier action read in this turn. Restrict free-text claim matching to `origin: 'this_turn'`, and let earlier actions appear only through tokens.

### S3. `semanticArgs` makes a same-turn deliberate repeat a replay
`tool-call.ts:46-49`. `adjust_pending_sets` is safe because `baseVersion` changes after an apply. For `set_next_session_targets`, two calls in one turn with the same targets and `sourceVersion` but different intent now share an opId. That is probably fine, but say so in ADR 0019 §5 and test it.

## Nits

- `adjust.ts:399-400` (r1 nit, still open): when one call both removes and changes sets, the numbers in the record are pre-removal numbers.
- `adjust.ts:82-88` (r1 nit, still open): this duplicates `exerciseSets` in `session/active-view.ts`, so card numbering and coach numbering can drift.
- `render.ts:360-370`: an Undo across two exercises with the same restored target says "Back to 100 kg for set 3" (deduped set numbers) when two sets on different exercises were restored. Name the exercise when `d.restored.length > 1`.
- `pain-words.ts:23`: `sharp` gives `pain` for "feeling sharp today". It fails safe, but the coach could then flag a movement for a compliment. Consider requiring a nearby body part for `sharp`/`shooting`.
- The developer edited design specs (`ai-connection.md` explainer, coach-contract CC3 and §6.1). The edits match r1's spec issues, and §6.1 is correctly marked "needs Ben/PM approval". Make sure the PM records them.

## Tests

The new tests cover:
- vanished model on reconnect;
- slow-store race;
- spoken Undo with mixed targets;
- pain flag with load down and reps up;
- semantic opId and content keys;
- the 19 B1 sentences and the B2 phrases;
- JWKS (stranger's key, tampered payload, unknown kid, `alg: none`/HS256, weak key, discovery and JWKS failures).

Missing:
- The B1 probe sentences: negator in the clause, "should now show", verbless structural and memory claims, and an alias from generic name words.
- Negative request tests for set remarks, "I want to understand…", "remember when…?" and negated structural phrases. A gate test showing that the request kind limits which tools open.
- The B3 injury phrasings, and a body-part `unclear` fallback.

## Spec issues

1. **coach-contract §6.1 `ben_request` definition** is still only proposed by the developer and needs Ben/PM approval. It should also say which request kinds open which tools (B2). As written, "a memory request" counts as `ben_request`, which also gates `adjust_pending_sets`.
2. **Check 14 (100% recall on the corpus)** can't guarantee honesty when the corpus is written by the same author as the patterns. Suggest the PM require that any sentence the reviewer finds is added, and the structural rule suggested in B1: in a turn with no committed write, hide any present or past value statement.
3. **ADR 0019 is still `Proposed`.** Its "Needs Ben" cuts are built, and `add_playbook_candidate`'s `needs` value (`none` in ADR §2, `ben_request` in the contract and code) is still unsettled. Unchanged from r1.
