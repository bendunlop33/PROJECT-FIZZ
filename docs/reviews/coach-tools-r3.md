# Review: coach tools, round 3 (backlog §4.3)

Branch `claude/coach-tools` against `claude/gracious-knuth-joxqpw`. This round covers the two commits after round 2 (`cc85065` "Memory words sorted three ways", `ba94c6c` "Memory card offers Save as a memory about me or Add to playbook"). It also re-checks the whole slice for regressions. Reviewer, 12 Oct 2026.

**Verdict: PASS.** Nothing is blocking. Both round 2 should-fix items are fixed, and each fix has a test that fails without it. Two new should-fix items (S1, S2) are about the heuristic that decides where Ben's words go. In both cases the result is visible and can be undone, so neither breaks a rule silently.

## Checks run

- `npm run typecheck`: passes.
- `npm run lint`: passes.
- `npx vitest run --testTimeout=120000`: **207 files, 3985 passed, 1 todo, 0 failed** (load average about 9). Round 2's load flakes didn't come back.
- Mutation checks. I reverted each fix in turn, ran `executors`, `registry` and `coach-memory`, then restored the file:
  - M1: dropped the `save_memory` route to the playbook for rule wording. 2 tests fail.
  - M2: turned off the split card (`split = false`). 1 fails.
  - M3: removed the double-tap guard in `memoryToPlaybook`. 1 fails.
  - M4: ignored the schedule context in `memoryTextKind`. 4 fail.
- I ran `memoryTextKind` on 42 sample texts by hand. The results are behind S1.
- I ran `classifyBenRequest` on "remember …" phrasings. The results are behind S2.

## Round 2 findings

| R2 | State |
|---|---|
| S1 `save_memory` has no rule guard | **Fixed.** `executors.ts:217`: when Ben says "remember …" and the words are clear rule wording, they become a `To review` playbook candidate `From you` with Undo, never an active memory. Unclear words wait as a suggestion. The test confirms nothing reaches Your data or Coaching knowledge until Ben acts. A replay with the same opId doesn't write twice. |
| S2 false positives and misses | **Fixed** for every sample listed in round 2. Schedule constraints are now `personal`. "Avoid lunges" and "Use straps for deadlifts" are `unclear` and get the CM9 split card. "Works best", "helps recovery" and "Compound lifts first" are now `rule`. The refusal line is now `Rule, not a memory. Nothing changed.` (a test keeps it under 40 characters). |
| N1 Apply card optimistic after restart | **Fixed** with a comment (`coach-service.ts`, `refusedApplies`). |
| N2 card says `Applied` for an edit undone on the overview | Still open. Harmless. |
| N3 chat log skips pending warm-ups | **Fixed** in the spec (coach-sheet.md revision note). |
| N4, N5 | N4 was informational. N5 (a waiting row can't be edited before Save) is still open. |
| SP1 migration 9 renumbering owner | Still open. It's a plan question, not a code one. |
| SP2 CM9 card vs refusal | **Fixed.** The split card is built, and the coach-memory.md revision records what was built, pending Ben's approval. |

The rest of the slice (read tools and the chip, structural Apply cards, chat log and correct, the Memory screen, Playbook review) is unchanged since round 2. The full suite passes. The rules still hold:
- Rule 2: Apply and Undo, nothing silent.
- Rule 3: structural changes stay gated.
- Rule 4: loads are checked as doable.
- Rule 5: op IDs and versions. `memoryToPlaybook` refuses a stale version, and a retry after a crash completes the job because both writes are idempotent.
- Rule 8: tool reads are quoted as data.
- Rule 10: a candidate made from a memory card goes to Coaching knowledge, and the suggestion is closed as `not_saved` in Your data.

The claim checker stays honest. If the model says "I'll remember that" after `save_memory` was routed to the playbook or to a suggestion, `kindMatches` finds no committed `save_memory` and the claim is flagged.

## Blocking

None.

## Should fix

### S1. Ben's own "remember …" of a personal constraint without a subject goes straight to the playbook, with no choice

`packages/coach/src/tool-call.ts:197` (`ADVICE_WORDS` includes `should`/`shouldn't` with no subject check), `:240`; `packages/coach/src/executors.ts:217`

Memories are written without a subject ("Prefers dumbbells", "Trains before work"). But `memoryTextKind` treats any `should` as clear rule wording unless `personalPlaybookText` matches. That only covers a bare third-person verb, an owner word, or a body part with a side or a state word. My probe gave these results:

- "Should not bench heavy until the shoulder settles": `rule`
- "Should keep sessions short": `rule`
- "Rest 3 minutes between heavy sets": `rule`. This could easily be Ben's own preference.

For `save_memory`, a `rule` result is routed to `addCandidate(…, 'ben')` without asking.

**Failure scenario:** Ben says "Remember I shouldn't bench heavy until my shoulder settles". The model calls `save_memory` with "Should not bench heavy until the shoulder settles", following the house style without a subject. That personal health constraint becomes a `To review` playbook candidate in **Coaching knowledge**, and the coach doesn't remember it. This breaks rule 10 in the opposite direction from round 2: personal data stored as general knowledge, kept outside Your data's delete and export scope. The card is visible (`Saved`, with Undo), so it isn't silent. But Ben's only fix is Undo and then retyping it on the Memory screen.

**Fix:**
- Send Ben-asked text straight to the playbook only on the strongest signals: `PERIODIC_RULE`, `GENERAL_CLAIM`, `CLASS_WORDS`, or "works best" / "rule of thumb". When the only sign is `should`/`must` (or an imperative with no class word), return `unclear`, so Ben gets the split card.
- Treat a leading `should`/`shouldn't` with no subject as personal, like `BARE_THIRD_PERSON_VERB`.
- Treat "until the <body part> settles/heals" as a particular body part.
- Add the three samples above as tests.

### S2. CM9's own spoken example opens no memory tool, so the rule path can't be reached the way Ben would say it

`packages/coach/src/request.ts:258` (`REMINDER`, existing code but now load-bearing)

`classifyBenRequest("Remember to always deload every 5th week")` returns `null`, and so does "Remember to avoid lunges". Only "Remember: …" or "Remember I …" opens the `memory` request. The developer noted this in the coach-memory.md revision, and the tests go around it by sending "Remember: always deload every 5th week".

**Failure scenario:** Ben says CM9's exact sentence. `save_memory` isn't offered, and `add_playbook_candidate` needs a `playbook` request, so it isn't offered either. Nothing is stored. If the model replies "Noted", the claim guard flags it, so the app is honest. But the feature Ben asked for (a rule sent to the playbook) doesn't happen for the most natural way of saying it.

**Fix:** let the `REMINDER` lookahead also exclude rule signals (`every … weeks`, `deload`, `always`/`never` at any position), or treat "remember to <training verb>" as `memory` and let `memoryTextKind` route it. Add a request test with CM9's literal sentence.

## Nits

- **N1.** A suggestion closed with `Not now` reads `Playbook, to review: "…"` when the same words exist as a candidate from somewhere else (`coach-service.ts:252` only checks that the status is `not_saved` and that the content key matches). The same branch also reads `to review` when the candidate is already **approved** (`sheet-view.ts:121`). Store the choice instead, for example with an action referencing the memory, or check that the candidate's `createdByActionId` came from `memoryToPlaybook` for this memory. Show `Playbook` rather than `to review` when the candidate is approved.
- **N2.** If Ben already **rejected** the same words in Playbook, `Add to playbook` closes the suggestion and returns `ok` (`coach-service.ts:677`). The card then just reads `Not saved`, with no notice. It's consistent with coaching-playbook §3.1 ("not offered again"), but a one-word notice (`Rejected before.`) would explain why it isn't there.
- **N3.** If the app is force-closed between the candidate write and the close (`coach-service.ts:678`), the card still offers `Save as a memory about me`. Tapping it then gives both a memory and a candidate. A retry of `Add to playbook` recovers cleanly. Low risk; a check for a matching candidate in `decideMemory('save')` would close the gap.
- **N4.** A very fast double tap can reach `memoryToPlaybook` twice before `busy` re-renders (`CoachCard.tsx:151`). The second call loses the version race and shows `Out of date.`, which is wrong because the first call succeeded. Treat a stale result whose memory is now `not_saved` and whose candidate exists as `ok`.
- **N5.** The Memory screen's `Waiting for you` rows (`MemoryScreen.tsx:90`) offer only `Not now` · `Save`, even for `unclear` words. The chat card offers the CM9 split there, so the two places disagree.
- **N6.** Still open from round 2: N2 (`Applied` card for an edit undone on the overview) and N5 (a waiting suggestion can't be edited before Save).

## Spec issues

- **SP1.** (Carried over from round 2.) Someone must decide who renumbers migration 10 to 9, and when, if workout-library doesn't take 9.
- **SP2.** CM9 promises that "remember to always deload every 5th week" goes to the playbook. That depends on the request classifier treating "remember to …" as a memory request, which it doesn't (S2). Either fix the classifier or have Ben approve the narrower behaviour that the coach-memory.md 2026-10-12 revision describes.
- **SP3.** CM9 doesn't say which side wins when the words are ambiguous and Ben asked. This build sends clear rule wording to the playbook without a card (S1). Ben should confirm whether a Ben-asked "remember" should always get the split card unless the text is unmistakably general.
