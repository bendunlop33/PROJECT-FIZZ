# Review: coach-fail-21oct (Ben's Build B report, 21 Oct)

Branch `claude/coach-fail-21oct`, diff `39b91f3..ffabc21` (4 commits). Reviewer: independent.

## Verdict: CHANGES NEEDED

Most of the plan is done well. Failure detail is kept and scrubbed, `request_error` is split from
`unavailable`, the retry only covers one step and never re-runs a write, `recentLifts` is in the context,
and failed turns stay in the history. However, two of the new guards fail in exactly the scenario they
were written for. I reproduced both with the branch's own fixtures.

- The invented-failure check is switched off on every turn where the change request was forced.
- The new change-intent detector applies edits when Ben declines or defers a change.

## Checks run (by reviewer)

- `npm run typecheck`: passes.
- `npm run lint`: 25 errors, all in the untracked `packages/coach/test/zz-tmp-schema.test.ts`, which is not part of this diff. All tracked files are clean.
- `npx vitest run --maxWorkers=2` (full suite): 456 files, 8,495 passed, 1 todo, 0 failed.
- Probes (temporary test files, deleted afterwards). These reproduce B1, B2 and S1 below.

## Blocking

### B1. The invented-failure check is disabled on exactly the turns it was meant for

**Where:** `packages/coach/src/turn.ts:865` (`notAppliedThisTurn`), together with the nudge log line at `turn.ts:991`.

**Cause:** `failureBacked` is true when any tool-log line has an outcome other than `read`, `committed` or `replayed`. The nudge itself logs `{ tool: coach_reply, outcome: 'not_allowed' }`, and so does "Only one call at a time". So on every live change turn where the model first answered in text (Ben's failure mode), the check treats the app's own nudge as a refused tool result.

**Reproduced with the branch fixtures:**
- **(a)** Model step 1 is `reply('The adjustment didn’t go through; keep the warm-ups controlled.')`. The forced `edit_today` step then gets a 400 (`request_error`), which is the case the developer says is unproven on the plan route. The turn returns `status=completed` and shows "The adjustment didn’t go through; keep the warm-ups controlled." This is Ben's turn 2, word for word.
- **(b)** Step 1 is text. The forced `edit_today` step commits. The final reply says "The change didn’t go through. Keep the bar path tight." The turn shows a **committed** card plus "The change didn’t go through." That contradicts the card and breaks rule 1/6.

**Fix:**
- Count only tool results that refused, went stale, were invalid or were offered for a today tool: `edit_today`, `TODAY_TOOLS`, or the tool the claim is about.
- Exclude `coach_reply` lines and the "only one call" line.
- If any `committed` today-change exists this turn, never back a "didn't go through" claim.
- Add both scenarios above as tests.

### B2. `asksLiveChange` treats declines and deferrals as asks, and `benWordsAsk` then applies the edit without an offer (rule 3)

**Where:**
- `packages/coach/src/request.ts:1214` (`FIX_ASK`) and `:1219` (`asksLiveChange`)
- `packages/coach/src/turn.ts:792` and `:1063` (`benWordsAsk: true`)
- `packages/coach/src/intent.ts:129`

**Probe results:** `asksLiveChange` returns true for:
- "I'll fix it myself"
- "Leave it, I'll sort it out"
- "Not now, I'll change it later"
- "Don't bump it"
- "The warm-up felt too easy but working sets were perfect"

Two turn-level probes:
- "I'll fix it myself" plus an `edit_today` call with `benAsked: true` produced a **committed** change and no offer.
- "Don't bump it, leave it, I'll sort it out" forced a named `edit_today` (`toolChoice: {type:'function',name:'edit_today'}`) after the model correctly answered in text. The app pushed the model into an edit Ben had just refused.

**Failure scenario:** Mid-set, Ben says "Leave the rows, I'll sort it out". His remaining row targets change immediately. Rule 3 says the coach must not apply changes Ben didn't ask for.

**Fix:**
- Exclude first-person and self-action subjects ("I'll / I will / I'm going to … fix/sort/change"), negations ("don't / do not / no need to / never … bump/change/fix"), and deferrals ("later", "not now", "myself").
- Use `KEEP_AS_IS` and extend it.
- Add these phrases as negative cases to the `asksLiveChange` test (`packages/coach/test/coach-fail-21oct.test.ts:157`).
- Consider requiring an imperative, a request cue, or an open earlier request for `FIX_ASK` matches, as opposed to complaint matches.

## Should fix

### S1. `benWordsAsk` also applies structural edits Ben didn't ask for

**Where:** `packages/coach/src/intent.ts:127-129`, `turn.ts:1063`.

**Cause:** `benWordsAsk` makes the verdict `asked: true` whatever `setsOnly` says. If Ben says "It's too light", any `edit_today` the model makes is applied immediately as Ben's ask, including one that swaps, adds or removes an exercise (`setsOnly === false`). The quote and word lists only show that he asked for a load change.

**Fix:** pass `benWordsAsk` only when `setsOnly !== false`, or when Ben's words are themselves structural (`isStructuralRequest`). Otherwise the structural part becomes an offer.

### S2. The forced step's own failure is swallowed, so diagnosis is lost again

**Where:** `turn.ts:967-971`.

**Cause:** When the forced named `edit_today` gets `unavailable` or `request_error`, the held reply is shown, but `error` and `failure` are never set. The turn ends `completed` with nothing in `CoachTurn.failure`. This is the exact path the developer flags as unproven on the plan route. If the route rejects named `tool_choice`, Ben sees advice again, and nothing records why the change wasn't made.

**Fix:**
- Keep `failure` on the turn even when the held answer stands, for example as a tool-log line.
- Show the "No change made." note so the outcome is honest.

### S3. The failure-claim regex hides true statements

**Where:** `packages/coach/src/reply.ts:190-200`.

**Probe:** `claimsChangeFailed` returns true for:
- "I can't change completed sets; edit the log instead." This is a correct rule-2 statement and is hidden on most turns.
- "I can't make that call for you."
- "It didn't land well with your elbow." This is pain-adjacent and is hidden.

**Fix:**
- Require a change or app noun as the subject or object for pattern 5 (`i couldn't apply|save|change …`), and do not count "completed/logged sets".
- Drop the bare pronouns `it|that|this|they|them` from `CHANGE_NOUN` unless they are next to a landed verb such as "go through", "apply" or "save".

### S4. Device check still pending for rule 3

**Where:** whether the plan route accepts named `tool_choice` (spike S3).

This is not proven. Until B1 and S2 are fixed, a rejection reproduces Ben's original symptom exactly. Run the device check before calling Ben's issue 2/4 fixed.

### S5. Failure message may carry Ben's words

**Where:** `packages/coach/src/failure.ts:135-160`, and the schema comment at `packages/schemas/src/coach.ts` (`CoachTurnFailureSchema`), which says "no … Ben's words".

**Cause:** Provider 400 messages can echo an input fragment. The scrubber removes tokens and emails but not quoted content.

**Fix:** truncate at the first quoted string longer than about 40 characters, or drop quoted spans, and make the schema comment match what the code actually guarantees.

### S6. The original 400 trigger was not investigated

**Where:** `packages/coach/src/function-tools.ts` (strict schemas using `format`, `pattern`, `multipleOf`, `exclusiveMinimum`, `minItems`/`maxItems`, `anyOf`).

**Cause:** The plan names these strict-mode schema keywords as a likely cause of HTTP 400 on the plan route. The branch adds diagnostics but no check that `function-tools.ts` sends only keywords the route accepts.

**Fix:** a unit test that walks every tool schema and rejects unsupported keywords. The untracked `zz-tmp-schema.test.ts` suggests someone has already started on this.

## Nits

- **N1.** `coach-fail-21oct.test.ts` has no test for: the held-reply plus forced-step-rejected path (B1a), a failure claim next to a committed card (B1b), decline phrases (B2), or a structural edit under `benWordsAsk` (S1).
- **N2.** `followsUpChange` accepts the bare words "yes", "ok" and "please". This is fine only because `openChangeRequestIn` gates it. Comment that dependency at `turn.ts:803`.
- **N3.** The layout fix (`CoachSheetScreen.tsx`):
  - The root cause is inferred. `ScrollView` already defaults to `flexGrow: 1`, so the `flex: 1` style changes little. The real change is `followOffset`, which scrolls to the newest turn's start.
  - When the newest turn is taller than the viewport, scrolling to its start makes `isAtBottom` false, so streaming text after that is no longer followed. That is acceptable, but check it on a device with the keyboard up.
- **N4.** `outcomeFor('request_error')` defaults Why? to "The AI service rejected the request", which is wrong for `app_error`, a failure thrown inside the app. It is masked when `failure` is present, which it always is from the plan port.

## Product rules checked

| Rule | Result |
|---|---|
| 1 (honest AI status) | Improved by the split and Why?, but broken by B1 and S2 |
| 2 (completed sets untouched) | Unchanged |
| 3 (applied only when asked) | Broken by B2 and S1 |
| 4 (achievable loads) | Unchanged; the executor still snaps loads |
| 5 (idempotent writes) | Retry is per step, and writes use the same op IDs; test at `coach-fail-21oct.test.ts:142` |
| 6 (no invented data) | `recentLifts` holds logged values only, with warm-ups and unit marked; numbers check covered |
| 7 (credentials, paid routes) | No secrets kept; the retry uses the same route and never switches |
| 8 (imported data) | Imported history is passed as data |
| 10 (data separation) | `recentLifts` sits under Your data |

No migration was needed: `failure` is an optional field in the JSON document.

## Spec issues

- **Complaint as ask.** The fix plan (point 4a) asks that "too light" / "fix them" always end in `edit_today` applied immediately. CLAUDE.md rule 3 separates *Ben asks*, which applies at once, from *a clear signal*, which the coach offers with "Want me to adjust?". A bare complaint such as "It's too light given Friday" sits between the two. The branch treats every complaint as an ask, which is what makes B2 and S1 risky. Ben should decide whether a load complaint counts as an ask (apply plus Undo) or a signal (offer). The decision should then go in the brief's CHANGELOG.
- **Effort level.** Live turns still run at effort `low`. The plan allowed escalating change requests to `think_harder` or medium effort. The developer deferred this, which is fine, but the brief should record which one is intended.
