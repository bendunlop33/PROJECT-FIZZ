# 0018: Coach v1, the embedded text coach (build step 4)

**Status:** Proposed, 2026-10-10 (developer; for PM review and Ben's approval of the scope cuts marked **Needs Ben**). Nothing in this ADR is built yet. No part of the coach counts as working until it has run end to end on Ben's iPhone.

## Context
- Device test S1 passed on 10 Oct (build 83, [2026-10-10-chatgpt-signin-s1.md](../device-tests/2026-10-10-chatgpt-signin-s1.md)): Sign in with ChatGPT works through the loopback listener, `chatgpt.tokens.use.direct` is granted, `GET /v1/models` lists 7 models (`gpt-6.1-sol` …), a `store:false, stream:true` Responses call answers, and refresh rotates. This unblocks build step 4.
- **Not yet proven on the device:** a function-tool round trip on the plan route (spike S3: tool call → local execution → `function_call_output` → streamed reply), latency with real context, refresh after the 1-hour expiry and after a relaunch (S4), and the limit/not-eligible states (S5). ADR 0012 also leaves one item that must close before the coach ships: the ID token's RS256 signature is not checked against JWKS.
- The specs (coach-sheet, coach-contract, coach-adjustments, coach-memory, coaching-playbook, ai-connection, workout-summary, active-workout) describe the full coach: about 25 tools, threads with search and retention, memory with suggestions and expiry, a playbook tab with in-app approval, API-key route with spend caps, voice. That's months of work. Ben needs a useful coach soon.
- The code doesn't match some spec assumptions. **There are no routines, templates or rotation in the app.** "Next session" today means `Start next session` on Today (`workout.start({nextOf})`), which rebuilds the last workout with the built-in rule's targets (`nextTargetsOf`, computed from history, never stored). The profile has no goals or schedule yet. There is no conversations, memory, action-record or playbook storage, and no network-reachability module.
- Work in flight on other branches that the coach depends on: `claude/active-set` adds `TargetProvenance` (sources `plan | rule | repeat`), `buildStepCard` and `explainTarget` (the set card's `Why?`); `claude/gym-switch` adds migration `0004-gym-switch` and session commands, and numbers its ADR `0017`, which already exists on this branch (`0017-guide-motion-round-2.md`). The PM should renumber that one before merge.

## Decision

### 1. What v1 delivers
1. **Coach sheet (text chat)**, reachable from Today (`Ask` pill), the active workout (`Adjust` → `Type…`, and `Ask the coach` in the workout's `⋯` menu) and the Summary (`Ask about this workout`). Honest AI status: banner, route line, disabled `Send` with the text kept (CS4, no queued sending). It never opens itself.
2. **`packages/coach`** (new, pure TypeScript): context builder, restricted tool registry, turn orchestrator, honesty contract. Typed discriminated-union actions live in `packages/schemas/src/coach.ts`. Every write goes through deterministic guardrails in `packages/domain` and is idempotent, versioned and undoable.
3. **Trigger offers during rest** (path B, rule T with planned effort, D20 fallback thresholds). Pure check, no AI call until Ben taps `Adjust`.
4. **D21 next-session targets** after a workout: one summary turn; small changes saved by default with reason, % change, `Built-in rule would be …` and one-tap Undo; bigger changes as Apply proposals; the built-in rule (7-F) as the labelled fallback.
5. **Usage-limit and error states** that pause the coach and never switch to a paid route. v1 has no paid route at all (see §8).

### 2. Tool registry (v1 subset of coach-contract §6.1)
Every tool declares `effect: 'read' | 'append' | 'versioned_update' | 'propose'` and `needs`. There is no delete or overwrite effect; a unit test enumerates the registry (contract check 1). `buildTurnRegistry(turnKind, gate)` decides per turn which tools the model even sees.

| Tool | Effect | Needs | Turn kinds |
|---|---|---|---|
| `get_active_session`, `get_recent_training` (one exercise, last N comparable sessions), `get_gym_equipment` (with step cards), `get_progression_targets` (the built-in rule's targets and explanation), `get_recent_actions` | read | none | all |
| `adjust_pending_sets` (today's pending sets: load, reps, +/− one pending set) | versioned_update | `ben_request` or an accepted offer | workout |
| `set_next_session_targets` (D21; small changes saved, bigger come back `proposed`) | versioned_update | `summary_turn` | summary only |
| `propose_next_workout_change` (swap, add, remove or reorder exercises in the next workout built from this one) | propose | `ben_request` or a structural signal (CC10, CA9) | summary, workout, general |
| `set_pain_flag` | append | `ben_pain_words` (Ben's own words or chip in this turn, CM6 word list) | all |
| `save_memory` (only when Ben says "remember"), `forget_memory` (tombstone, Undo) | append / versioned_update | `ben_request` | all |
| `add_playbook_candidate` (a general rule Ben or the coach states; never a memory, CM9) | append | none | all except summary |

"Explain" needs no write tool: it is reply text over the read tools, with citations to approved playbook rules checked by `validateCitations`.

**Deferred tools (Needs Ben):** `log_set`, `correct_set`, `propose_set_correction`, `propose_session_change` (today's swaps), `propose_reschedule`, `propose_workout`, `propose_programme`, `propose_goal_change`, `propose_rotation_change`, and the reads `get_programme`, `get_rotation`, `get_schedule`, `get_substitutions`, `get_step_cards` (folded into `get_gym_equipment`). Logging stays on the Log button; swaps stay Ben's own (Add exercise / existing swap). The `Swap exercise` starter chip is left out of v1; `Machine busy` stays, and the coach can only suggest in words.

### 3. Structural changes without routines (Needs Ben)
With no templates, "Push A from now on" has nothing to apply to. v1's structural proposal targets **the next workout built from this one** (`Start next session`). Because each next workout is rebuilt from the last one, an applied swap carries forward the way a template change would. It's stored as a proposal with before/after, `Because: …`, Apply, Undo until that next workout starts, and it expires (CR8) when any workout starts from that source. Signals in v1 (`getStructuralChangeSignals`): `variety_request`, `equipment_changed` (gym switch or equipment version), `pain_flag`. `goal_changed` and `schedule_changed` return nothing until goals and schedule exist. When routines arrive, the scope widens to the routine; that's a later ADR.

"Next session of that routine" in D21 likewise means **the next workout started from this one, or the exercise's next appearance when Ben adds it**, as long as the coach target's basis is still that exercise's latest comparable session.

### 4. Guardrails (`packages/domain`, pure, unit-tested)
- `evaluateCoachTrigger(set, planned, thresholds)`: rule T (RPE ≥ 9.5 with plan ≤ 8.5, reps short by ≥ 2 from the bottom of the range, RPE ≤ 6 with plan ≥ 8), D20 when no planned RPE, never on warm-ups, drop, AMRAP or `+` sets, no "too easy" above 12 reps, RIR equivalents. CA4's once-per-kind rule uses a stored offer log.
- `validateTodayAdjustment(proposal, aggregate, equipment, painFlags, checkIn, intent)`: snaps with `roundToAvailableLoad` using `easier` for too-hard and `harder` for too-easy, caps at the equipment max, never past a machine max, blocks increases on pain-flagged movements (and everything with `pain_unspecified`), `lighter_no_increase`, drops completed sets (`Not changed: set 2 is already done.`), rejects a stale `baseVersion`. Units and conventions are never converted silently (kg/lb, per-dumbbell, stack, assisted, where "harder" means less assistance). Returns `{changes, guardNotes[], status}`.
- `classifyNextSessionChange` (CA8, uses `buildStepCard` from `claude/active-set`): one achievable step, reps ±2, sets ±1 (+1 only when Ben asked, D1), no effort or rest change, `Fixed` loads and rule 8/10 resets always `bigger`.
- Two new session commands in the reducer: `adjust_pending_targets` (pending sets only; `expectedVersion`; `opId`; writes `planned` with source `coach` and the action ID) and `revert_target_adjustment` (restores the action's before-values on still-pending sets; partial when some were logged). `TargetSource` gains `coach`.

### 5. Writes, versions and Undo
- **`ActionRecord`** (contract §6) is written **in the same SQLite transaction** as the change it describes (`writeAggregateInTx` already exists). `opId = turnId:toolName:hash(canonical args)`, so a replayed call after a dropped connection returns the existing record and changes nothing (contract check 6).
- Today's adjustments check the session version; next-session targets record the source session's version and each basis set's version. A later correction to the source workout makes the saved coach target stale: the built-in rule's target is used, with `Coach target was set before you edited this workout.`
- Coach targets for next time are stored in `next_session_targets` (one row per exercise, linked to the action). `nextTargetsOf` uses a valid, not-undone coach target and otherwise the built-in rule, which is always computed as the comparison and the fallback. This partly reverses the provisional "targets are worked out, not stored" for the coach case only; the built-in path stays computed.
- Undo: per-row and `Undo all` on the Summary until the next workout from that source starts; the banner `Undo` and exercise `⋯` → `Undo coach change` in the workout. Undo is itself an `ActionRecord`. An undo that's no longer safe returns a compensating proposal.
- Late answers (CA10) apply until a workout starts from that source; afterwards they are dropped as stale.

### 6. Context builder (`buildCoachContext`, `describeCoachContext`)
- Output `{formatVersion, contextHash, yourData, coachingKnowledge, notAvailable, messagesSent}`. The two domains are separate objects, built by separate functions, sent as separately labelled developer-message blocks, and listed under separate `DomainLabel`s in `What the coach can see`. An item can't be in both (test).
- **Your data (minimal by default):** turn kind, the active session (targets vs actuals, versions), the gym and its equipment summary, active pain flags, today's check-in quoted as Ben's words, confirmed memories with dates, the last messages of this thread that fit the budget (CS2). History and step cards come through read tools, not pre-stuffed.
- **Coaching knowledge:** playbook v1 approved rules (short form, ID, grade, whether in use now and why) from a **versioned bundled JSON** generated from `docs/training-guides/playbook-v1.md`, plus catalogue entries for exercises in context. 7-F is code and isn't sent as advice. Rules 11–13 are sent as `not in use: no endurance training logged`.
- **Not available:** no goals or schedule set (D15, labelled), no recovery or wearable data, no runs or rides. Nothing is invented (rule 6).
- Imported notes, check-in notes, pasted text and tool output are wrapped as quoted data, never instructions (rule 8), and never satisfy `ben_request` or `ben_pain_words`.

### 7. Turn orchestration and honesty (`packages/coach`)
- `runCoachTurn` runs a bounded loop (at most 4 model steps, `parallel_tool_calls: false`, strict JSON-schema function tools whose schemas are tested against the Zod action types) through an injected `CoachModelPort`. The real port wraps `streamResponse` and `TokenRefresher` from `packages/providers`; tests use a scripted stub.
- Ben's message is saved before the request; coach text is saved per checked sentence, so a force-close keeps what was shown. A turn still `running` at launch becomes `interrupted` (`Coach request was interrupted. Anything applied is shown above.`); committed actions show their cards once.
- Honesty contract kept in full: `renderActionResult` (fixed templates, target/actual labels, units), `[[ref]]` tokens, `checkReplyClaims` (corpus of ≥ 60 sentences, 100 % recall on claims required, unsure → hide), sentence-by-sentence display (CC8), `Not shown` in `Why?`.
- `timing.coachTimeout` (20 s) counts from the request to the **first stream event of any kind** (tool call or text), and `timing.coachStreamStall` (20 s) applies mid-reply. `packages/providers` gets an `onEvent` hook and abort support for this. Both values are re-checked against S3 measurements; a slow reasoning model may need a longer first-event time, which would be a spec change for Ben.
- Model: Ben picks from `GET /v1/models` (`visibility == list`); `gpt-6.1-sol` is preselected as "tested with GymSmarter" if listed. A model that disappears pauses the coach with `Choose model` (AC6).

### 8. Connection, status and errors
- **`getAiCapabilities`** gives `text.status` from the vault, the last provider failure and the network state: `ok | not_connected | expired | limit | unavailable | not_eligible | no_scope | region | model_gone | offline`.
- **Product Coach connection screen** (ai-connection §2.1–2.6, ChatGPT plan only): `Continue with ChatGPT`, the checking steps, first-use notice with model choice, the connected status card with a local weekly message count, `Manage usage`, `Disconnect ChatGPT`. The developer sign-in test screen stays.
- **No paid route in v1 (Needs Ben):** API key, spend caps and OpenAI voice are not built, so `Switch coach to your API key (paid)` never appears. A `usage_limit` (429) pauses the coach with `Manage usage`; `not_eligible` stops with no retry and no new OAuth; `unavailable`/5xx/network offer `Try again`; `refresh_unusable`/401 show `ChatGPT disconnected` with `Sign in again`. No error path changes the route, and no canned reply stands in for the coach.
- **JWKS signature check before ship (closes ADR 0012's open item):** RS256 verification in `packages/providers`, pure TypeScript using `BigInt` modular exponentiation and PKCS#1 v1.5 padding, with SHA-256 from the injected digest port (`expo-crypto`), and the JWKS fetched from the discovery document and cached. No new dependency. Tested with RFC/OpenSSL-generated vectors.
- **Offline (Needs Ben):** add `expo-network` at the SDK 57 bundled version (exact pin; no entitlement) so the sheet can disable `Send` and clear the banner by itself, as coach-sheet §3 says. A new cloud `.ipa` build is needed either way, since every JS change ships in a build. Alternative without a dependency: show `No connection…` only after a request fails with `network`.

### 9. Storage, backup and delete
- One new migration, numbered after `0004-gym-switch` lands: `coach_threads`, `coach_messages` (with `HiddenLine`s), `coach_turns` (status for restart recovery), `coach_actions`, `coach_offers`, `coach_proposals`, `next_session_targets`, `memories` (all Your data, owner-scoped), and `playbook_candidates` (Coaching knowledge, no owner, `to_review`, never used until approved).
- The backup format version goes up; Your data and Coaching knowledge sections stay separate; older backups restore with empty coach tables. `Delete my data` removes Your data coach tables and disconnects; credentials are never in a backup.

### 10. Deferred from v1 (Needs Ben for the spec items)
Voice and spoken replies (step 5); conversation list search, rename, delete and retention (v1 keeps every thread, reachable from the sheet's thread list, newest first); memory suggestions, editor, expiry and `Worth checking` (v1: save on "remember", a basic Memory list with Forget and Undo); the Playbook tab and in-app approval (candidates are listed read-only and never used); the coach-offers thresholds editor (defaults stored as data); weekly planning, programmes, goals and the workout builder; the API-key route and spend caps.

### 11. Build slices
Each slice ends with `npm run check` passing and a small set of commits; slices C3 onwards wait for `claude/active-set` and `claude/gym-switch` to merge.

| # | Slice | Main checks |
|---|---|---|
| C0 | **Device spike S3 + JWKS.** Developer screen `Coach tool test`: two strict tools (`get_active_session`, a no-op write) through the real route, 20 turns, first-event and total latency (median, p90). RS256/JWKS verification in providers. | Ben runs it on the iPhone. Tool round trip passes or fails honestly; JWKS check passes on the real ID token. If tools fail on the plan route, stop and report before C4 |
| C1 | **Schemas and honesty core** (`packages/schemas/coach.ts`, `packages/coach`): action and tool unions, `ToolDeclaration` registry, `buildTurnRegistry`, `listCoachCapabilities`, `ActionRecord`, `renderActionResult`, sentence splitter, `resolveActionTokens`, `checkReplyClaims` with the corpus | Contract checks 1, 11, 14, 17 (gate from the registry's structural list) |
| C2 | **Domain guardrails and commands**: `evaluateCoachTrigger`, `validateTodayAdjustment`, `classifyNextSessionChange`, `getStructuralChangeSignals`, `adjust_pending_targets` / `revert_target_adjustment` | coach-adjustments checks 4–6, 10–13, 23–24, 27; kg and lb, per-hand dumbbells, equipment max, assisted machines, duplicate op IDs, stale versions |
| C3 | **Persistence**: migration, repositories, action + change in one transaction, restart recovery, backup/restore and delete | Idempotent replay, kill mid-write, backup round trip with coach data, older backup restores |
| C4 | **Context builder and orchestrator** with the stub model: playbook bundle, `buildCoachContext`, `describeCoachContext`, `runCoachTurn`, executors, cancel, timeouts, error mapping | Contract checks 2–8, 10, 12, 16, 19; coach-sheet 9 (as replay), 14, 18; no AI call in 10 normal sets |
| C5 | **Connection and status**: product Coach connection screen, `getAiCapabilities`, model choice, real `CoachModelPort`, network state | ai-connection checks 1, 3, 5, 6, 11, 12, 16 (limit and not-eligible with stubbed responses) |
| C6 | **Coach sheet UI**: entry points, threads (CS1), messages and sentence display, cards, `Why?`, `What the coach can see`, `What the coach can do`, banners, Stop / Try again, route line, `Pain` chip offline | coach-sheet checks 1–6, 8, 11, 13, 16, 17, 20, 22 |
| C7 | **In-workout**: `Adjust` control and chips, offers in the rest card, pending / banner / outcome slot, Undo, draft-follow rule, `valueChangeGuard`, Log-while-pending re-send once | coach-adjustments checks 1–3, 7–9, 14–19 |
| C8 | **Summary (D21)**: background summary turn after `finishWorkout`, `Next time` coach rows with Undo / Undo all / Use coach target, bigger-change proposals, gated structural card, claim-checked coach note, `nextTargetsOf` preferring valid coach targets, late answers | coach-adjustments checks 26, 28–33; summary built-in labels offline |
| C9 | **Device test pack and review**: S3 again in the real flow, S4 (refresh after an hour, relaunch, revoke), airplane mode, force-close mid-turn, a full workout with an RPE 10 offer and a Summary on Ben's iPhone | Written to `docs/device-tests/`; the coach is called working only after this |

## Consequences
- Ben gets the coach in the workout loop (offers, Adjust, next-session targets) and in chat, with every change rendered from saved records and undoable, and the full workout loop unchanged when there's no network or AI.
- Several spec features wait for later slices or later ADRs (§10). The specs stay as the target. The developer will record the v1 cuts in the specs' revision notes once Ben approves them.
- New storage and a backup format bump; a new cloud build; possibly one new Expo module (`expo-network`).
- Risks: function tools on the plan route are unproven until C0; latency with tools may exceed the 20 s first-answer time; the claim-check corpus may hide too many harmless sentences (the false-hide rate is reported, not hidden).

## Build log
**10 Oct, slice C1 and the pure parts of C2** (developer). Built and unit-tested; nothing is wired to the app or a real model yet, so nothing here counts as working on the device.
- `packages/schemas/src/coach.ts`: strict tool-argument schemas, `ActionRecord`, `GuardNote`, `HiddenLine`.
- `packages/domain/src/coach/`: `evaluateCoachTrigger` + `shouldShowCoachOffer`, `validateTodayAdjustment`, `getStructuralChangeSignals`, `classifyPainMention`.
- `packages/coach`: registry and gate, `parseToolCall` (+ opIds), strict function-tool JSON Schemas, `renderActionResult`, `checkReplyClaims` with its corpus, sentence buffer, `[[ref]]` tokens, reply filter, `CoachModelPort` and a scripted fake.
- Not yet built from C2 (wait for `claude/active-set`): `classifyNextSessionChange` (needs `buildStepCard`) and the `adjust_pending_targets` / `revert_target_adjustment` reducer commands (touch `TargetSource`, which that branch changes).
- Choices to confirm: `add_playbook_candidate` uses `needs: ben_request` as coach-contract §6.1 says (this ADR's table says `none`); a load change on an exercise with no equipment is refused (rule 4 can't be checked), while its reps can still change; a kg request on lb equipment is converted with a visible guard note; the schema has no AMRAP flag, so a planned RPE 10 / RIR 0 set counts as all-out for rule T.
