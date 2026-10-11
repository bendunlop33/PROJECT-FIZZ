VERDICT: CHANGES NEEDED

# Review: coach v1, slices C1, C2 (pure parts) and C5 (branch `claude/coach`)

Reviewer, 10 Oct 2026. Range: `git log claude/gracious-knuth-joxqpw..HEAD` (9 commits, 45 files; the branch-only diff `...HEAD` does not touch `apps/mobile/src/guide/*`, `HowToScreen.tsx` or `packages/catalogue/src/figure/*`).

Checked against CLAUDE.md rules 1 to 10, ADR 0018, coach-contract, coach-adjustments, coach-memory (CM6), ai-connection (AC6, §2) and workout-summary.

## What I ran

- `npm run check` in `/home/user/wt-coach` exits 0: typecheck, lint, 108 test files and 1576 tests, catalogue validate, guide check and guide motion all pass.
- I also ran three probe tests from the scratchpad (not committed). They call `checkReplyClaims`, `classifyPainMention` and `renderActionResult` directly. The results are quoted below.

## Scope reality

Nothing on this branch can write a set, a target, a flag or a memory yet. There is no turn engine, no persistence, no context builder and no coach sheet. These questions are therefore answered for the code that exists:

- **Change completed sets?** No. `validateTodayAdjustment` drops completed, skipped and deleted sets (tested).
- **Apply unsnapped or out-of-range loads?** No. Loads go through `roundToAvailableLoad`, are capped at the max and never extrapolated (tested for kg, lb, per-hand, assisted and conversion).
- **Ignore pain flags?** Not in the validator. The pain word gate can miss real pain (B2).
- **Apply stale proposals?** No. A `baseVersion` mismatch or a non-active session is rejected as stale.
- **Fall back to a paid route?** No. There is no API-key route at all.
- **Leak Your data into Coaching knowledge?** No storage or context exists yet, so nothing can leak.

The live risks are in the honesty core, the pain gate and the connection flow.

## Blocking

### B1. The claim check keeps false "done" statements, and contract check 14 says a false keep fails the build
`packages/coach/src/claims.ts:158-236` (`PHRASES`, `WILL_VALUE` at :194, `hasClaimTrigger`).

These sentences pass with `keep: true` against an **empty ledger**, where nothing was saved:
- "Bench is down to 95."
- "Squat goes to 120 kg next time."
- "Pec deck replaces cable fly next time."
- "Cable fly is out, pec deck is in."
- "All changed."
- "Sets 3 and 4 are 95 kg."
- "You're on 95 kg for the last two sets."

**Failure scenario:** Ben says "too heavy" and the model answers "Bench is down to 95." without calling `adjust_pending_sets`, or after the call came back `stale`. Ben sees a change that never happened. This is exactly what CC3 exists to stop. The structural case also breaks CC10: "X replaces Y next time" reads as an applied swap.

**Fix:**
- Treat present-tense state statements about a target as claims: a set number, an exercise or "next time/session", plus "is/are/goes to/down to/up to/replaces/is out/is in/on N kg".
- Make bare "All changed" a claim, matching `GENERIC_ONLY`.
- Add every sentence above to the corpus as a claim.

The ADR's "100% recall" holds only for the corpus as written.

### B2. Pain word classifier misses clear pain, so the coach can't set a flag (rule 9)
`packages/domain/src/coach/pain-words.ts:13-16` (word list), `:24-25` (negation window and `without`/`never`), `:43`.

Probe results:

| Ben says | Result |
|---|---|
| "I can't press without pain" | `none` |
| "never had pain like this" | `none` |
| "not sure, it hurts" | `none` (the negator sits 3 words back) |
| "pulled something in my back" | `none` |
| "sprained ankle" | `none` |
| "my shoulder is killing me" | `none` |
| "felt a pop in my elbow" | `none` |

`set_pain_flag` is gated on `benPainWords` (`packages/coach/src/registry.ts:257-258`), so in every one of these cases the coach is not allowed to flag the movement. Progression then continues on a movement Ben said hurts.

**Fix:**
- Negate only with an immediately preceding negator ("no pain", "doesn't hurt"). Drop `without` and `never` as negators of pain.
- Add `pulled`, `sprain`/`sprained`, `strain`, `pop`/`popped`, `killing`, `torn`/`tore`, `numb`, `tingling`, `throbbing`.
- When the result is ambiguous, return `unclear` (CM6 asks the question) rather than `none`.
- Add these cases to `packages/domain/test/coach-guardrails.test.ts:577`.

### B3. Reconnecting silently switches the coach model (AC6)
`packages/providers/src/openai/connection.ts:224-226` (`preselectModel`) and `:365-366`. Test `packages/providers/test/connection.test.ts:243` asserts the behaviour.

**Failure scenario:**
1. Ben chose `gpt-6-astra` and later gets `expired`.
2. He taps `Sign in again`.
3. `gpt-6-astra` is no longer listed, so `connectChatGpt` saves `gpt-6.1-sol`, or `listed[0]`, as the model.
4. `firstUseSeen` is already true, so the screen goes straight to status (`CoachConnectionScreen.tsx:111`).

AC6 says: "If the chosen model disappears, the coach pauses with `Choose model`; it doesn't pick another silently."

**Fix:** preselect only when `settings.modelSlug === null` (first connection). If a previous choice exists and isn't listed, keep the slug so the state reads `model_gone`. Change the test to match.

### B4. The spoken Undo line states wrong restored loads
`packages/coach/src/render.ts:365`.

When restored sets had different targets, the text correctly says "Back to the previous targets for sets 3–4", but the spoken line uses `first.after` for every set. Probe: set 3 is restored to 100 kg and set 4 to 97.5 kg, and the voice says "Back to 100 kilos for 6 to 8 for sets 3 and 4."

This is an app-rendered line, so CC1 requires it to be true. **Fix:** use the same `every(sameTarget)` branch as the text, falling back to per-set spoken lines. Add a render test.

## Should fix (not blocking)

### S1. A pain flag drops a whole set change when only the reps go up
`packages/domain/src/coach/adjust.ts:318-323`.

`isIncrease` flags the change "100 kg × 6–8 → 95 kg × 8" because the rep minimum rises. The whole change is then refused, including the lighter load: "Not increasing … Sets unchanged." This is the spec's own too-hard example, and a pain flag is exactly when Ben needs it lighter.

**Fix:** drop only the increasing field (keep the load drop and the current reps) and add a guard note.

### S2. First-use notice and connected copy in a build with no coach
`apps/mobile/src/ai/coach-connection-view.ts:179-185` and `:73`.

The once-ever notice ("The coach's replies now count toward your ChatGPT plan") is used up by a build in which no coach can reply. When the real coach ships, Ben never sees it. The `Connected` card also gives no hint that there's nothing to use yet.

**Fix:** add a line such as "The coach chat isn't in this build yet." and don't set `firstUseSeen` until a build with the coach sheet runs. Alternatively, version the flag.

### S3. `benRequest` is undefined, so rule 3's "offer, don't apply" depends on whoever builds the gate
`packages/coach/src/registry.ts:223-236`.

`TurnGate.benRequest` is "Ben's own message … asked for something". A plain question ("why is set 3 at 100?") would probably set it, and the model then gets `adjust_pending_sets` and can apply changes Ben didn't ask for.

**Fix:** before C4 wires it, define it as a classified change request (Ben's own words or chip), separate from "Ben sent a message", and test it.

### S4. Idempotency only covers byte-identical replays
`packages/coach/src/tool-call.ts:336-338`.

`opId = turnId:tool:hash(args)`. A retried model call that rewords `reason` or `quote`, or a `Try again` that starts a new turn, gets a new opId. `adjust_pending_sets` is still protected by `baseVersion`, but the append tools have no version check: `set_pain_flag`, `save_memory` and `add_playbook_candidate` would write duplicates.

**Fix:** in C3/C4, dedupe the append tools on their content (active flag for the same exercise, same memory text) or hash only the semantic fields.

### S5. ID token signature is still not checked, now in a product screen
ADR 0012 open item; ADR 0018 C0 says it must close before ship.

C5 puts the sign-in into the product UI (Profile → Coach connection). It stores identity (`subject`, `email`) from an ID token whose RS256 signature is unchecked. The risk is low, because the token comes straight from the token endpoint over TLS.

Keep this as a hard gate before any build that is described to Ben as having the coach. Better still, gate the screen behind C0.

### S6. The connection settings file has a read-modify-write race
`packages/providers/src/openai/connection.ts:177-181`.

The mount-time `refreshModels` and a user-started `connectChatGpt` or `Check again` can interleave, and one write loses the other's `lastFailure` or `modelSlug`.

**Fix:** serialise the updates through one promise chain.

## Nits

- `adjust.ts:363`: a deleted set named in `removeSetId` produces "set 0 isn't pending". Use the fallback that `:343` uses.
- `adjust.ts:399-400`: when one call both removes and changes sets, the set numbers in the record are pre-removal numbers. After the apply, the card renumbers, so "changed set 3" can refer to the card's set 2. Render post-apply numbers, or apply removals last.
- `adjust.ts:82-88` duplicates `exerciseSets` in `session/active-view.ts:205`. Share one helper so card numbering and coach numbering can't drift.
- `render.ts:221-236`: spoken lines for a change across several exercises don't name the exercise ("Sets 3 and 4: … Sets 2 and 3: …").
- `packages/coach/package.json` declares `"sideEffects": false`, but `registry.ts:221` relies on `assertRegistrySafe` running at module load.
- ADR number clash: base now has `0018-worklet-errors-are-caught-in-the-worklet.md`. Renumber one before merge. The branch is behind its base.

## Tests

The guardrail tests are good:
- kg and lb, per-hand cap, machine max, below-minimum refusal, assisted direction both ways, pain on assisted, conversion note, wrong convention, no equipment, stale version, finished session, completed set change and removal.
- Lighter session, unspecified pain, replay-stable added set ID, and the trigger rules including RIR and "10 normal sets give no trigger".

Missing:
- Adversarial false-keep sentences (B1).
- Negated or idiomatic pain phrasing (B2).
- Reconnect with a vanished model (B3).
- Spoken undo with mixed targets (B4).
- A pain flag with load down and reps up (S1).

## Spec issues

1. **ai-connection.md:91-93** (copied into `EXPLAINER`): "In ChatGPT's settings, keep paying with credits after limits turned off for this app." It reads as an instruction to keep paying. Suggest: "In ChatGPT's settings, leave 'use credits after limits' off for this app." This supports rule 7.
2. **ADR 0018 §2** gives `add_playbook_candidate` `needs: none`, but coach-contract §6.1 says `ben_request`. The code follows the contract. Ben or the PM should settle it and fix the ADR table.
3. **coach-contract CC3/§6** lists the claim forms ("I've lowered", "is now", "will be + value") but not present-tense state statements ("Bench is down to 95", "X replaces Y next time"). Add them so the corpus requirement covers them (see B1).
4. **coach-contract TurnGate**: the spec doesn't define what counts as `ben_request`. Without a definition, rule 3's "offers, doesn't apply" can't be tested (see S3).
5. **ADR 0018 is still `Proposed`**, and its "Needs Ben" cuts (no paid route, ChatGPT-only connection screen, `Manage usage` via Safari instead of an in-app browser) are already built in C5. They're consistent with the rules, but Ben should approve them before this ships.
