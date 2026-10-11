VERDICT: CHANGES NEEDED

# Review r3: coach v1 (branch `claude/coach`), after the fixes for `coach-v1-r2.md`

Reviewer, 10 Oct 2026. Range: `git log claude/gracious-knuth-joxqpw..HEAD`, 32 commits. The 8 commits since `c0d2edf` are the r2 fixes (15 files). The branch-only diff (`...HEAD`) doesn't touch `apps/mobile/src/guide/*`, `HowToScreen.tsx` or `packages/catalogue/src/figure/*`, and it adds no key, secret or `.env` file.

Checked against CLAUDE.md rules 1 to 10, ADR 0019, coach-contract (CC1 to CC10, §6.1 and check 14), coach-adjustments, coach-memory CM6 and the honesty contract.

## What I ran

- `npm run check`: typecheck and lint pass. The full test run failed with 6 timeouts, all in `packages/catalogue/test/{definition,figure,motion-r3}.test.ts`. The machine was heavily loaded at the time (load average about 19 on 4 cores, from other worktrees). Re-run on their own with `--testTimeout=120000`, those 3 files pass (90 tests). Coach, domain, providers and schemas pass with 45 files and 990 tests. `catalogue:validate`, `guide:check --all --verify` and `guide:motion --all` pass. None of the timeouts are in code this branch changed. The 5 s default timeout on those catalogue tests is fragile under load, which is a note for the guides owner.
- I ran probe tests against `classifyBenRequest`, `classifyPainMention` and `checkReplyClaims`. I placed them temporarily in `packages/coach/test/` and deleted them, so nothing was committed. The results are quoted below.

## Status of the r2 findings

| r2 | Status |
|---|---|
| B1 claim check false keeps | **Mostly fixed.** Every listed sentence is now hidden and is in the corpus (147 claims). The negation fix (only the words before the trigger count) is right. The value-statement backstop is a good idea, but its vetoes apply to the whole clause, so a single word anywhere in the clause disables it (B3 below). |
| B2 request gate | **Partly fixed.** `REQUEST_KINDS_BY_TOOL` is the right design: a memory request no longer opens today's sets, and an unmapped tool opens on nothing. All r2 probe remarks now return `null`. The classifier still reads questions asking the coach's opinion as change requests (B1 below). |
| B3 pain words | **Partly fixed.** All listed phrases are now pain. The new body-part fallback misses the most common spoken form, "my knee's …", and a negated positive word cancels it (B2 below). |
| S1 JWKS | The code part is fixed: a failed key fetch reads differently from a signature mismatch, and this is tested. The device re-run is still open (S2 below). |
| S2 earlier ledger entries | Fixed. An `earlier` entry backs a sentence only when the sentence cites its token. Tested. |
| S3 same-turn repeats | Fixed. Documented in ADR 0019 §5 and tested. |
| Nits | `adjust.ts:399-400`, `adjust.ts:82-88` and the `render.ts:360-370` Undo dedupe are unchanged and still open. The `sharp` nit is fixed. |

## Scope reality (unchanged)

There is still no turn engine, context builder, store or coach sheet, so nothing on this branch can write a set, target, flag or memory. Against the code that exists:

- **Change completed sets?** No. `validateTodayAdjustment` only touches pending sets.
- **Apply unsnapped or out-of-range loads?** No. Loads are snapped, capped and never extrapolated.
- **Ignore pain flags?** The validator honours them. The pain-word gate still returns `none` for common injury talk (B2).
- **Apply stale proposals?** No. A `baseVersion` mismatch returns `stale`.
- **Claim a change that didn't commit?** Still possible through the claim check (B3).
- **Leak Your data into Coaching knowledge?** Nothing is stored yet. A memory request now also opens `add_playbook_candidate` (S1).
- **Paid route?** No.
- **Injection via notes or imports?** The gates take only Ben's own words, by documented contract. C4 must wire them that way, with a test.
- **Offline?** Logging and the Summary don't depend on the coach.

## Blocking

### B1. Questions asking for the coach's view still open `adjust_pending_sets` (rule 3)
`packages/coach/src/request.ts:75` (`ASK_PREFIX` starts with `^(?:.*?\b)?`, so any words, including `why` or `what`, may come before "would you"), `:112-116` (`isAsking` never applies `ADVICE_QUESTION` to the whole clause), `:77` (`WANT_OBJECT` accepts "more/another/less + anything"), `:49` (`LINKING` needs a space before `'s`), and `:115` (bare "go ahead").

Probe results: each of these returns `{kinds: ['change']}`.

| Ben says | Cause |
|---|---|
| "Why would you lower sets 3 and 4?" | `ASK_PREFIX` skips "why" and matches "would you" + "lower" |
| "What would you change?" | Same |
| "Would you lower it if you were me?" | Same (asks for an opinion) |
| "why would we drop the weight" | Same |
| "Change nothing" | `STRONG` verb with a negating object |
| "I need more sleep" / "I want another coffee" / "I would like more detail" / "I want more cues" / "I need less talking" | `WANT_OBJECT` has no training object |
| "Lower back's a bit tight" / "Cut's going well, down 2 kg" | `'s` attached to the noun defeats `LINKING` |
| "Update: my shoulder feels fine" / "Scale says 80 kg today" / "Add me as a friend lol" / "Remove? no keep it" | A `STRONG` verb at the start of the clause |
| "Go ahead" (with no pending offer) | Bypasses the `acceptedOffer` gate the spec defines for bare acceptances |

**Failure scenario:**
1. The coach says "Bar speed dropped on set 2. I'd consider 95 for the last two. Want me to adjust?"
2. Ben, sceptical, types "Why would you lower sets 3 and 4?"
3. `benRequest` is `change`, so `adjust_pending_sets` is in the turn's registry.
4. The model applies 95 kg straight away, when Ben was questioning the offer, not accepting it.

Rule 3 says a change the coach raises applies only once Ben accepts. The spec (§6.1) lists "a question for the coach's view" as not a request.

**Fix:**
- Anchor `ASK_PREFIX` at the start of the clause, after `POLITE` only. Treat any clause that starts with a wh-word, or ends with `?` and contains "would you … if" or "what would you", as a question.
- Make `WANT_OBJECT` require a training object or value: weight, load, it/them/the rest/sets/reps, an exercise name, or a number.
- Treat a `STRONG` verb followed by `nothing|anything|no` as not a request.
- Handle `'s` attached to the noun in `LINKING`, for example by normalising `X's` to `X is` before matching, as the claim normaliser does.
- Remove the bare `go ahead` from `isAsking`. It belongs to `acceptedOffer`.
- Add every row above as a negative test, plus a gate test for "Why would you lower sets 3 and 4?" that shows `adjust_pending_sets` is withheld.

### B2. The pain classifier returns `none` for "my knee's …" and for negated positives (rule 9, CM6)
`packages/domain/src/coach/pain-words.ts:93` (tokens keep the apostrophe, so `knee's` is one token and isn't in `BODY_SET`), `:118-126` (`ownedBodyPart`), `:61-66` (`bodyWent`), `:172-173` (any `POSITIVE` word sets `clauseSignal`, even when it is negated or about something else) and `:177`.

Probe results:

| `none` for | Cause |
|---|---|
| "my knee's not right", "my shoulder's a bit off", "my shoulder's weird", "my back's gone", "elbow's grumbling" | `knee's` doesn't match `knee` |
| "my elbow is not great", "my elbow's not great" | A negated `great` still counts as a signal |
| "Felt good apart from my elbow", "Felt great except my wrist", "good session apart from the knee" | A positive word in the same clause suppresses the body part |
| "the knee went again", "left knee feels off", "I've got a dodgy knee", "Bad back today", "The shoulder isn't happy today", "Achilles is grumbling", "knee is wonky", "wrist is iffy", "elbow was a bit off on the last set" | No "my", so there is no fallback |

For comparison, "my shoulder is off today" gives `unclear`, while "my shoulder's off today" gives `none`. The module promise (`:16-18`) is "when in doubt … never `none`", and the contraction is how Ben will actually type or speak.

**Failure scenario:** after set 2 of overhead press, Ben says "my shoulder's not right". `benPainWords` is false, so `set_pain_flag` is not in the registry and CM6 never asks. Progression continues on a movement that hurts.

**Fix:**
- In `clauses()`, split `'s` from the noun (`knee's` → `knee`, `is`), as the claim normaliser does.
- A negated `POSITIVE` word ("not great", "not right", "isn't happy") should count as `unclear`, not as a signal that cancels the fallback.
- A positive word should not cancel the fallback when the clause contains `except|apart from|other than|besides|just my`.
- Extend the fallback to a body part without "my" when it isn't part of an exercise name (not followed by `press|squat|raise|curl|extension|row|day|…`), and to the qualifiers `dodgy|bad|wonky|iffy|funny|off|grumbling`.
- Add every phrase above to `coach-guardrails.test.ts`.

### B3. The claim check still keeps false statements with nothing saved (CC3, check 14)
`packages/coach/src/claims.ts:351-363` (`valueStatement`: `HISTORICAL` vetoes on the whole sentence; `SUGGESTIVE`, `UNCHANGED_OR_PAST` and `GENERAL_FACT` veto on any word in the clause), `:334-337` (`IMPERATIVE_START` includes `expect`, `see`, `plan`), `:87-90` (`rather` is `SUGGESTIVE`) and `:436` (`presses` → `presse`).

Probe: each of these gives `keep: true` with an **empty ledger**.

| Sentence | Cause |
|---|---|
| "Expect sets 3 and 4 at 95 kg." / "Expect 95 kg on your card for sets 3 and 4." | `expect` is read as imperative advice |
| "Use 95 from here, it's on your card." | "it's on your card" states the app's state with no number |
| "Given last week, you have 95 kg for the rest." | "last week" anywhere vetoes the backstop |
| "Sets 3 and 4 have 95 kg rather than the 100 you did." | `rather` and `did` veto the whole clause |
| "You'll be on 95 for the rest which may feel light." | `may` later in the clause vetoes `WILL_VALUE` and the backstop. With a comma it is caught |
| "Push A now opens with squat." / "Squat first next time." / "Next Push A: pec deck, not cable fly." / "Pec deck's taking cable fly's spot next time." | Verbless or unlisted structural claims (CC10) |
| "Binned set 4." / "Chopped set 4." / "Set 4 is history." | Removal verbs that aren't listed |
| "Overhead press won't progress until your shoulder settles." / "Overhead press is on hold while your shoulder settles." | A pain-flag or progression claim |
| "I've wiped that memory." / "Consider it noted." / "I'll bear that in mind." | A memory claim |
| "Will do." / "On it." | A promise that acknowledges a change or memory request |
| "95 for the rest, yeah?" | A tag question; borderline |

There are also false keeps against a ledger holding only a bench change to 95 kg:
- "Dumbbells are 95 for the rest" and "Flyes are 95 for the rest" are kept. `dumbbells` doesn't map to `Incline DB press`, and `fly` isn't in `MENTION_WORDS`.
- "Your presses are 95 for the rest" is kept. At `:436`, `presses` is singularised to `presse`.

**Failure scenario:**
1. Ben asks for lighter sets.
2. `adjust_pending_sets` comes back `stale` because a set was logged at the same moment.
3. The model replies "Expect sets 3 and 4 at 95 kg."
4. The sentence passes. The card still says 100, and Ben trusts the coach over the card.

Check 14 says a false keep fails the build.

**Fix:**
- Remove `expect`, `see` and `plan` from `IMPERATIVE_START`, because they describe state rather than give advice.
- Make the vetoes local to the value. A `HISTORICAL`, `UNCHANGED_OR_PAST` or `SUGGESTIVE` word should only veto when it is in the same sub-clause as the number and comes before it. Split sub-clauses on `rather than|than|which|as|so|while`.
- Treat "(it's|they're|that's) (on|in) (your|the) (card|app|screen|plan)" as a claim.
- Add the structural forms ("X first/last next time", "now opens/starts/leads with", "taking X's spot/place", "`<workout>`: X, not Y"), the removal slang, and "won't progress / on hold / paused" + an exercise as a `set_pain_flag` claim.
- Add the memory forms ("wiped/erased/cleared/deleted … memory", "consider it noted", "bear … in mind") and bare "Will do." / "On it." to `GENERIC_ONLY`.
- Fix the plural `-es` handling at `:436`, and add `fly`/`flyes`, `row`, `curl`, `raise`, `squat` and `db`/`dumbbell` to the mention mapping.
- Add every sentence above to the corpus.

See also Spec issue 1: regex recall has failed in three review rounds.

## Should fix (not blocking)

### S1. A memory request opens `add_playbook_candidate` (rule 10)
`packages/coach/src/registry.ts:356-361`.

"Remember that my left knee is dodgy on lunges" opens `save_memory` and `add_playbook_candidate`. Only the tool description keeps personal facts out of the playbook queue. Because the queue needs Ben's approval, the damage is limited, but the separation still depends on the model. In addition, "Remember that time I hit 100?" classifies as `memory` (`request.ts`, `MEMORY` doesn't check for a trailing `?`), so it opens all three memory tools.

**Fix:** pending Ben's decision on `needs`, either add a separate `playbook` request kind ("add a rule", "as a general rule", "in the playbook"), or add a deterministic validator that rejects candidate text with first-person or owner references (`I`, `my`, `Ben`, body part + pain words). Also treat a `remember …?` question as not a request.

### S2. JWKS signature path still not run on the device
The S1 report attached to this run is from build 83. It says `Not checked: RS256 signature against JWKS … open item, ADR 0012`, so it predates the JWKS check. ADR 0019's build log says the same. Every sign-in now depends on BigInt modexp under Hermes plus two extra fetches. Re-run S1 on Ben's iPhone before any coach build reaches him, and record the `Checked: RS256 signature` line in `docs/device-tests/`.

## Nits

- `pain-words.ts`: "shoulder pain-free today" gives `pain`. It fails safe, but `pain-free` should be negated.
- `request.ts` `DIFFICULTY`: "Too much coffee this morning" gives `difficulty`, which opens `adjust_pending_sets`. Require a training subject or set context for `too much`.
- `claims.ts`: `IMPERATIVE_START` contains `remember`. "Remember: 95 for the rest" is caught today only by another path.
- Still open from r1 and r2: `adjust.ts:399-400` (pre-removal set numbers in the record), `adjust.ts:82-88` (duplicates `exerciseSets` in `session/active-view.ts`), and `render.ts:360-370` (Undo across two exercises doesn't name them).
- Test timeouts: the catalogue's heavy drawing tests use the 5 s default and fail under machine load. This isn't the coach branch, but `npm run check` is flaky because of it.

## Tests

Added since r2, and good:
- the negation, verbless and memory forms, and the backstop corpus (147 claims, 76 non-claims, 5.3% false hides reported);
- the request-kind gate (a memory request doesn't open today's sets, and an unmapped tool fails closed);
- the new pain phrases and the owned body-part `unclear` fallback;
- the CC5 cited-token test;
- the JWKS offline-versus-mismatch test.

Missing:
- Request: wh-questions with "would you" / "what would you", "Change nothing", "I need more sleep"-type wants, the `'s` remarks and a bare "go ahead". Add a registry test for "Why would you lower sets 3 and 4?" showing `adjust_pending_sets` is withheld.
- Pain: contractions ("my knee's not right"), negated positives ("not great"), "apart from my elbow", and a body part without "my".
- Claims: every B3 sentence, and the plural/generic mention cases against a bench ledger.

## Spec issues

1. **Check 14 (100% recall from regex lists) hasn't converged in three rounds.** Each round the reviewer finds 10 to 25 natural sentences the patterns miss, and the corpus grows only by those. The PM should consider a structural rule that doesn't depend on enumerating phrasings, for example:
   - In a turn where **no write committed**, attach a fixed `No change was saved in this reply.` line under any reply that mentions a load, a set number or an exercise from the session. Don't try to decide which sentence is a claim.
   - Alternatively, have the model emit claimed changes in a structured field that is checked against the ledger, and render them from the ledger rather than from free text.

   Either option makes the honesty guarantee checkable instead of best-effort. It is a design change to coach-contract CC3/CC4 and needs Ben/PM approval.
2. **§6.1 `ben_request` definition and `REQUEST_KINDS_BY_TOOL`** are still marked "needs Ben/PM approval". Mapping `add_playbook_candidate` to `memory` is a new decision that touches rule 10 (S1).
3. **ADR 0019 is still `Proposed`.** The "Needs Ben" cuts are built, and `add_playbook_candidate`'s `needs` is unsettled. Unchanged since r1.
