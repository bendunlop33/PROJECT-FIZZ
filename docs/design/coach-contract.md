# Coach honesty contract

> **Revision 2026-10-10 (review fixes B4 and nits).**
> - **CC10 now gates every structural tool**, not just two. `propose_programme`, `propose_goal_change` and `propose_rotation_change` join `propose_template_change` behind `ben_request` or `structural_signal`. A coach-raised goal question also needs playbook D11 approved; until then `propose_goal_change` is `ben_request` only. `propose_workout` is `ben_request` only: its result is a one-off draft, and only Ben's own `Save as routine` / `Add to rotation` taps make it lasting.
> - The summary turn's registry is now a closed list (§6.1): read tools, `set_next_session_targets`, and the structural tools only when the gate passes.
> - `set_pain_flag` takes only Ben's own words in this turn (typed, spoken or a chip), never imported notes, check-in history or anything the coach read through a tool.
> - Voice "undo" at the start of a workout no longer reaches the last summary's next-session action (§4).
> - Changed: CC10, §4, §6 (`ToolDeclaration.needs`), §6.1, check 17, new checks 19–20.

Status: v0.1 draft, 9 Oct 2026. Approved by Ben as competitor follow-up 7 ([CHANGELOG](../brief/CHANGELOG.md) 2026-10-09; [competitor-landscape.md](../research/competitor-landscape.md) opportunity 7 and proposed validation scenario 12). Build step 4 (embedded coach). Rules: CLAUDE.md 1, 2, 3, 5, 8. Tokens: [design-system.md](design-system.md); new components are listed in §8 for the design-system owner to merge.

**Why.** The most-cited failure of AI training apps is a coach that says it changed something when it didn't. A Ray user: "it says it's making the change but the workout stays exactly the same". Several products also give their AI tools that can delete or rewrite finished workouts: HYBRD's MCP exposes `update_completed_workout` and `delete_workout`; Liftosaur's and LiftTrack's connectors can delete workouts; Arvo writes workouts with no documented confirm or undo. GymSmarter makes three promises and enforces them in code, not in the model's instructions:

1. **Reply text that mentions a change is rendered from the committed action's result.**
2. **The coach never says something changed without a versioned action in that turn.**
3. **No coach tool can destroy history.**

This is a contract that every coach surface follows, not a single screen. It covers coach sheet replies and cards ([coach-sheet.md](coach-sheet.md)), the workout's coach slot ([coach-adjustments.md](coach-adjustments.md)), the voice strip and spoken replies ([voice.md](voice.md)), the Summary's coach note and `Next time` rows ([workout-summary.md](workout-summary.md)), the workout builder's rationale ([workout-builder.md](workout-builder.md)) and plan proposals ([change-review.md](change-review.md), [weekly-plan.md](weekly-plan.md)). Its one screen of its own is the read-only `What the coach can do` sheet (§2.5).

## 1. Purpose

The contract answers **"Did the coach actually change something, and what exactly?"** Ben should never have to check the workout to find out whether the coach's words were true.

It has no primary action of its own. On every surface it covers, the primary action stays what that screen's spec says (`Log …` in a workout, `Done` on the Summary, `Send` in the coach sheet). The contract adds no taps to logging.

### Design decisions to confirm with Ben (flagged, not yet in the brief)

| # | Decision | Reason |
|---|---|---|
| CC1 | **Change lines are app text.** Every line that says something was changed, logged, saved, applied, undone, moved, swapped, added, removed or deleted is written by the app from the saved `ActionRecord` (`renderActionResult`). That includes cards, banners, toasts, `Next time` rows, the voice strip and spoken confirmations. The model's own words are limited to reasons, explanations, questions and suggestions | Promise 1. If the words come from the saved result, they can't disagree with it |
| CC2 | **Action tokens in replies.** When the coach wants to mention its own action inside its reply, it writes a token `[[a1]]` using the ref its tool returned in this turn. The app swaps the token for the rendered line. A token for a ref that doesn't exist in this turn, or isn't committed, renders as that action's real status (`Not applied`, `Couldn't change …`) or, for an unknown ref, nothing plus the outcome line (§5.2). Raw tokens are never shown | Lets the coach's reply read naturally while the change sentence stays app text |
| CC3 | **Claim check (backstop).** `checkReplyClaims` runs on each finished sentence of model text **before it is shown or spoken**. A sentence that states a finished change in the coach's voice ("I've lowered…", "Done, set 4 is now…", "I updated your plan", "Logged it"), or states a target's state in the present tense ("Bench is down to 95", "Sets 3 and 4 are 95 kg", "Squat goes to 120 kg next time", "Pec deck replaces cable fly", "Cable fly is out", "All changed"; added 10 Oct, review B1), is kept only if this turn's ledger has a **committed** action of the same kind on the same thing. Otherwise the sentence is hidden and an outcome line says so. Suggestions and questions ("I'd drop…", "Want me to…?", "Next time, try…") are not claims | Promise 2. The model can ignore its instructions; the check can't be skipped. When the check is unsure it hides (a hidden suggestion costs little; a false "done" costs trust) |
| CC4 | **Numbers in a kept claim must match the result.** If a kept claim sentence contains a load, reps, set count, set number, date or routine name that differs from the saved result (e.g. the model says 98 kg and the validator saved 97.5 kg), the sentence is replaced by the rendered line | The guardrails change numbers (snap, cap, pain block). The words must follow the saved number, not the model's first idea |
| CC5 | **"In that turn" means this turn's ledger.** A claim needs a committed `ActionRecord` with this `turnId`. To mention an earlier change, the coach calls the read tool `get_recent_actions` in this turn and uses its ref; the app renders the earlier action's current status (including `undone 18:24`). Text that refers to an earlier change any other way is hidden like any other claim | Promise 2, read strictly. "I lowered it earlier" is only shown when the app can show which action and whether it still stands |
| CC6 | **No tool can destroy history.** Every tool in the registry declares one effect: `read`, `append`, `versioned_update` or `propose` (§6.1). There is no `delete` or `overwrite` effect. Finished sessions, logged sets and their versions, imports, check-ins, pain-flag events, action records, conversations and backups are never deleted or rewritten by a tool. A correction is a new version with the original kept. "Forget that memory" is a tombstone with Undo. Clearing a pain flag, discarding a workout with logged sets, restoring or resetting data, changing settings, credentials or the AI route, and approving playbook rules are **not tools at all**: Ben does them on screen | Promise 3; CLAUDE.md rules 2 and 5. A unit test enumerates the registry (§7 check 1) |
| CC7 | **Tools return structured status.** Each tool result carries `status: 'committed' \| 'proposed' \| 'rejected' \| 'stale' \| 'failed'`, the action or proposal ref, the before/after values, guard notes and the rendered lines. The instructions tell the coach to describe its actions only with tokens, but the app never relies on that | Brief §8: "Tool outputs … clearly report committed, proposed, pending-sync or failed state" |
| CC8 | **Sentence-by-sentence display.** Coach reply text appears one finished sentence at a time, each checked first, instead of streaming raw chunks. Spoken replies are built from the same checked sentences | A claim can't be checked until its sentence ends. Showing a "done" and then pulling it back would be worse than a short wait. **This changes coach-sheet.md's chunk streaming (follow-up)** |
| CC9 | **Hidden lines stay inspectable.** Every hidden sentence is kept with its turn (Your data) and listed in that reply's `Why?` under `Not shown`, verbatim, with the reason | Ben can see what the model actually said. It also gives the developer a log to tune the check |
| CC10 | **Structural tools are gated, not just instructed.** (Revised 10 Oct, review B4.) Every tool that can lead to a lasting change in what Ben trains is structural: `propose_template_change`, `propose_rotation_change`, `propose_programme` (a programme replaces the rotation) and `propose_goal_change`. Each is offered to the coach only in a turn where Ben asked (chat or voice) or `getStructuralChangeSignals` returns a signal (coach-adjustments CA9). `propose_goal_change` on a coach-detected signal also needs playbook D11 approved; until then it is `ben_request` only. `propose_workout` is `ben_request` only and returns a one-off draft; saving it as a routine or adding it to the rotation is always Ben's own tap (workout-builder WB9, routines RT9), never a coach tool. Without a request or signal, these tools aren't in that turn's registry, and the validator drops any structural item that arrives another way (inside another tool's payload, or a programme or goal change described in a `propose_session_change`) | CLAUDE.md rule 3 (Ben, 9 Oct): structural changes only when Ben asks or something changed. A gate makes "only" testable. A programme or goal change is at least as structural as a swap |

## 2. Layout

### 2.1 Where change lines appear

| Surface | Change line (app text, from the `ActionRecord`) | Model text allowed |
|---|---|---|
| Coach sheet reply | Action card (coach-sheet §2.6) and inline `ActionResultLine` for each token | Reasons, explanations, questions, suggestions; checked sentence by sentence |
| Workout coach slot | `CoachAdjustmentBanner` lines 1–2 and guard notes (coach-adjustments §2.5) | The one-sentence reason, in quotes, checked |
| Voice strip and speech | `rendered.spoken` from the action (the `buildSetCue` family) | The checked reply sentences, only when the turn began by voice (voice.md) |
| Summary `Next time` | Each row's target, % change, `Built-in rule would be …` and status (workout-summary §2) | The coach's reason in quotes, and the coach note; both checked |
| Workout builder | Draft rows, `Checks` and the diff (workout-builder §3.3–3.4) | The rationale (≤ 240 characters), checked |
| Plan proposals | `ChangeReviewCard` / `ProposalCard` lines and status words (change-review) | The reason, checked |

### 2.2 Coach sheet: a turn with one saved change and one hidden line

```
┌────────────────────────────────────────┐
│ Coach · 18:21                          │ type.label
│ Used: today's workout, bench history › │ ToolSummaryLine (tool log)
│ ┌────────────────────────────────────┐ │
│ │ 💬 Coach adjusted sets 3–4         │ │ card, from the ActionRecord
│ │ 100 → 95 kg × 8 (targets)          │ │
│ │ Why? ›                     [Undo]  │ │
│ └────────────────────────────────────┘ │
│ Set 2 was RPE 10.                      │ model sentence (checked)
│ ✓ Changed sets 3–4 to 95 kg × 8        │ ActionResultLine: the token,
│   (targets).                           │ rendered by the app
│ That should keep you at 8.             │ model sentence (checked)
│ ⓘ Only the changes shown here were     │ ClaimCheckNote: one sentence
│   made. One line said otherwise and is │ claimed "and dropped set 4";
│   hidden.                              │ no such action was saved
└────────────────────────────────────────┘
```

- `ActionResultLine` (§8): status icon + `type.callout` `text.primary`, indented `space.3`, never in the model's text style, so Ben can tell app text from coach text at a glance. Tap scrolls to the action's card, or opens `Why?` when the card is above the fold.
- `ClaimCheckNote` (§8): `info.circle` + `type.callout` `text.secondary`, after the last sentence of the reply. One per reply at most.

### 2.3 Workout coach slot and voice strip

```
┌────────────────────────────────────────┐
│ [Coach] Coach adjusted sets 3–4        │ CoachAdjustmentBanner (app text)
│ 100 → 97.5 kg × 8 · "Set 2 was RPE 10; │ before → after from the result;
│ a little lighter should keep 8 reps."  │ reason in quotes (checked)
│ Rounded to 97.5 kg: nearest your bar   │ guard note (validator)
│ and plates allow.                      │
│ Why? >                       [ Undo ]  │
└────────────────────────────────────────┘
│ 🎙 Coach: Sets 3 and 4: 97 and a half  │ VoiceStrip: rendered.spoken
│ kilos for 8.                           │
```

If the reason sentence fails the claim check (e.g. "I've also removed set 4" when set 4 wasn't touched), the reason is dropped from the banner and the banner shows `ⓘ Only sets 3–4 were changed.` in place of it. The `Why?` sheet lists the hidden sentence.

### 2.4 Summary coach note with a hidden line

```
│ Coach note                             │
│ Bench moved well until set 2; the      │ checked sentence
│ rest of the session was on target.     │
│ ⓘ Only the changes shown under Next    │ ClaimCheckNote: the note said
│   time were made. One line said        │ "I've raised overhead press",
│   otherwise and is hidden.             │ which the pain flag blocked
```

### 2.5 `What the coach can do` (sheet; Profile → Coach, and the coach sheet's `What the coach can see` view)

```
┌────────────────────────────────────────┐
│ What the coach can do            Done  │
├────────────────────────────────────────┤
│ The coach only says something changed  │ type.callout
│ when the app has saved that change.    │
│ You can undo every change it makes.    │
│                                        │
│ When you ask                           │ SettingsSectionHeader
│ ✓ Log a set you say                    │ CapabilityRow
│ ✓ Change today's remaining sets        │
│ ✓ Correct a set you name. The original │
│   is kept.                             │
│ ✓ Save or forget a memory              │
│ ✓ Turn a pain flag on                  │
│ After each workout                     │
│ ✓ Small changes to next time's load,   │
│   reps and sets, shown on the summary  │
│   with Undo                            │
│ Only as a suggestion you apply         │
│ ○ Swapping, adding or removing         │
│   exercises; order; your rotation;     │
│   goals; programmes; deloads; bigger   │
│   target changes                       │
│ Never                                  │
│ ⊘ Delete or rewrite a workout, a set,  │
│   an import or a check-in              │
│ ⊘ Clear a pain flag                    │
│ ⊘ Change settings, your AI connection, │
│   backups or playbook approvals        │
└────────────────────────────────────────┘
```

The rows are generated from the tool registry's declarations (`listCoachCapabilities`, §6), so the sheet can't drift from what the code allows. Icons: `checkmark.circle` (`text.secondary`), `circle.dashed`, `nosign`. Each row is text; nothing is colour-only. Read-only; no actions besides `Done`.

## 3. States

| State | Trigger | Shows |
|---|---|---|
| Normal, change saved | Tool returns `committed`; the reply mentions it with a token or a matching claim | Card or banner + `ActionResultLine` (or the kept sentence). No note |
| Proposed, not applied | Tool returns `proposed` | Proposal card with `Not now` / `Apply`. A token renders `Suggested: … Not applied.` A sentence claiming it was applied is hidden |
| Claim with no action | A sentence claims a change; no committed action of that kind this turn | Sentence hidden. `ⓘ Nothing was changed. One line said otherwise and is hidden.` Spoken (voice turns only): "Nothing was changed." |
| Claim that doesn't match | Committed actions exist, but the claim names something else (another set, another exercise) | Sentence hidden. `ⓘ Only the changes shown here were made. One line said otherwise and is hidden.` |
| Number mismatch | A matching claim names a number that differs from the saved one | The sentence is replaced by the rendered line (CC4). No note: the shown line is correct |
| Rejected / stale / failed | Tool returns `rejected`, `stale` or `failed` | Outcome line from the result, e.g. `Couldn't change sets 3–4: your workout moved on. Nothing changed.` Any claim of success is hidden |
| Partly applied | Some changes committed, some dropped by the guardrails | Card shows what was saved plus guard notes (`Not increasing Overhead press: you flagged shoulder pain.`). A claim covering the dropped part is hidden |
| Unknown tool | The model calls a tool that isn't in this turn's registry (e.g. `delete_set`) | Nothing runs. Tool log line `Not allowed: delete_set`. Any matching claim is hidden. `Why?` lists it under `Not used` |
| Undone later | Ben taps Undo after the reply | The card status becomes `Undone`; the reply's `ActionResultLine` gains `· undone 18:24`. The old reply text is never edited |
| Earlier action mentioned | The coach read `get_recent_actions` this turn and used its ref | `ActionResultLine` for the earlier action with its current status and time |
| Stopped / cut off / interrupted | Ben taps Stop, the stream stalls, or the app is closed mid-turn | Cards for committed actions always show (they're in SQLite). Unfinished sentences are dropped, not padded. `ⓘ … Anything applied is shown above.` (coach-sheet §3) |
| Offline / AI unavailable / not connected | No coach turn runs | No coach text at all, so nothing to check. Change lines on screen come only from Ben's own actions. Honest status as each screen specifies (CLAUDE.md rule 1) |
| Paused workout | Ben pauses | No effect on the contract. A coach turn in flight continues; its results follow the same rules |
| Resting | Ben is resting during a turn | The banner sits in the coach slot; spoken lines follow coach-adjustments §4.2.6 (only with ≥ 20 s left, never over the rest-end cue) |

Transitions for one sentence of model text:

```
 sentence complete ──► checkReplyClaims
        │ not a claim ───────────────────────────────► shown (and spoken if voice turn)
        │ claim + committed match + numbers match ───► shown
        │ claim + committed match + numbers differ ──► replaced by rendered line
        └ claim + no committed match ────────────────► hidden ─► ClaimCheckNote + Why? "Not shown"
```

## 4. Interactions

| Element | Tap | Voice / other |
|---|---|---|
| `ActionResultLine` | Scrolls to its card, or opens that action's `Why?` | VoiceOver reads it as app text: "Saved change. Changed sets 3 and 4 to 95 kilograms for 8, targets." |
| Card `Undo` | `undoAction(actionId)` as the card's own spec says | Voice "undo" undoes the most recent action of any kind **made in the current session or the current coach thread**, and the strip names it (coach-adjustments §4.4). (10 Oct) It never reaches a previous workout's summary action (the D21 next-session targets): at the start of a workout with nothing logged yet, "undo" answers `Nothing to undo in this workout.` Changing those targets is the set card's `Why?` → `Use built-in rule` |
| `ClaimCheckNote` | Opens the reply's `Why?` at `Not shown` | VoiceOver: "Note. Only the changes shown here were made. One line said otherwise and is hidden." |
| `Why?` → `Not shown` | Lists hidden sentences verbatim with the reason: `No change was saved in this reply.` / `It named set 4; only sets 3–4 changed.` | Read-only |
| `What the coach can do` | `Done` closes | Opened from Profile → Coach and from the context view's footer link `What the coach can do ›` |

- **Keyboard:** none here. The coach sheet's composer keeps `Send` above the keyboard (coach-sheet §2.2).
- **Undo paths:** every committed coach write has Undo on its card, banner or row. Undo itself is an action with its own `ActionRecord`; its line is rendered the same way (`Undone: the change to sets 3–4. Back to 100 kg × 6–8.`). An undo that isn't safe returns a compensating proposal (brief §8), shown as a card, never as a sentence claiming it was undone.
- **No new taps in logging.** Sentence-by-sentence display (CC8) only affects the coach's text. Log, rest and the action bar are untouched.

## 5. Copy

Every number in a rendered line says **target** or **actual**, with its unit.

### 5.1 Rendered action lines (`renderActionResult`)

| Action | Committed | Proposed | Not done |
|---|---|---|---|
| Log a set (`log_set`) | `Logged set 3 · Bench press: 100 kg × 8 (actual).` | — | `Couldn't log set 3: <reason>. Nothing was saved.` |
| Today's sets (`adjust_pending_sets`) | `Changed sets 3–4 to 95 kg × 8 (targets).` | `Suggested: sets 3–4 at 95 kg × 8 (targets). Not applied.` | `Couldn't change sets 3–4: your workout moved on. Nothing changed.` |
| Correct a set Ben named (`correct_set`) | `Corrected set 2 · Bench press: 100 → 95 kg × 8 (actual). The original is kept.` | `Suggested correction: set 2, 100 → 95 kg × 8 (actual). Not applied.` | `Couldn't correct set 2: it changed since. Nothing changed.` |
| Next-session targets (`set_next_session_targets`, D21) | `Next Push A: Bench press 97.5 kg × 6–8 (target).` | `Suggested for next Push A: Bench press 90 kg × 6–8 (target). Not applied.` (bigger than small) | `Couldn't set next targets. The built-in rule's are used.` |
| Plan changes (swap, template, rotation, schedule, goals, programme) | — (always proposals) | `Suggested: Push A from now on, Cable fly → Pec deck. Not applied.` | `Out of date: your <goal / days / equipment> changed. Nothing changed.` |
| Memory | `Saved to memory: "Trains before work".` · forget: `Forgot: "Doesn't like lunges". Undo is on the card.` | `Suggested memory: "…". Not saved.` | `Couldn't save that memory. Nothing changed.` |
| Pain flag on | `Pain flag on for Overhead press. No increases until you clear it.` | — | — |
| Playbook candidate | `Added to your playbook to review: "…". Not in use until you approve it.` | — | — |
| Undo | `Undone: the change to sets 3–4. Back to 100 kg × 6–8 (targets).` | — | `Couldn't undo: set 3 is done. A suggestion for set 4 is below.` |
| Earlier action (CC5) | adds `· 18:21` and, if undone, `· undone 18:24` | adds `· not applied` | — |

Spoken versions (`rendered.spoken`) follow coach-adjustments §5.3: "Sets 3 and 4: 95 kilos for 8." / "Logged set 3, 100 kilos for 8." / "Not increasing. You flagged shoulder pain." Units are spoken in full; nothing is spoken in Quiet mode.

### 5.2 Notes and labels

| Element | Text |
|---|---|
| No action saved | `Nothing was changed. One line said otherwise and is hidden.` |
| Some actions saved | `Only the changes shown here were made. One line said otherwise and is hidden.` |
| Banner variant | `Only sets 3–4 were changed.` |
| Summary note variant | `Only the changes shown under Next time were made. One line said otherwise and is hidden.` |
| Unknown token | (nothing shown for the token) + `Nothing was changed. One line said otherwise and is hidden.` |
| Tool log, blocked tool | `Not allowed: delete_set` |
| `Why?` section | `Not shown` · reasons `No change was saved in this reply.` · `It named set 4; only sets 3–4 changed.` · `The saved load is 97.5 kg; the reply said 98 kg.` |
| Spoken (voice turns only) | "Nothing was changed." |
| Capability sheet | title `What the coach can do` · intro `The coach only says something changed when the app has saved that change. You can undo every change it makes.` · sections `When you ask` · `After each workout` · `Only as a suggestion you apply` · `Never` · rows as §2.5 · link elsewhere `What the coach can do ›` |
| Pain flag asked to clear | `The coach can't clear pain flags. Clear it in Pain flags when you're ready.` [Pain flags ›] (app text, shown as the outcome line when Ben asks the coach to clear one) |
| Asked to delete history | `The coach can't delete workouts or sets. You can edit a set yourself, or discard an unfinished workout.` (app text, outcome line) |

The coach's own words are never edited to make them true. They are shown, hidden, or replaced as a whole sentence by the app's line.

## 6. Data needed

Existing (brief §8; coach-sheet §6; coach-adjustments §6; change-review §6): `runCoachTurn`, `classifyCoachIntent`, `validateCoachProposal`, `applyCoachProposal`, `undoAction`, `getDecisionEvidence`, `buildSetCue`, `ToolSummaryLine` from the tool log, `CoachMessage`.

**Proposed new (contracts to add; flagged for the developer):**

| Function / type | Contract |
|---|---|
| `ToolDeclaration` (`packages/coach`) | `{name, effect: 'read' \| 'append' \| 'versioned_update' \| 'propose', writes: EntityKind[], needs: 'ben_request' \| 'ben_pain_words' \| 'ben_named_target' \| 'summary_turn' \| 'structural_signal' \| 'none', structural: boolean, plainLabel, capabilitySection: 'when_you_ask' \| 'after_workout' \| 'suggest_only' \| 'read'}`. (10 Oct) `structural` is `true` for the four CC10 tools; check 17 reads it. There is no `delete` or `overwrite` effect in the union |
| Initial registry (§6.1) | The only tools a turn can receive. `buildTurnRegistry(turnContext)` filters it per turn (e.g. `set_next_session_targets` only in the summary turn; structural proposals only with a request or signal, CC10) |
| `ActionRecord` | `{actionId, turnId?, opId, kind, status: 'committed' \| 'proposed' \| 'rejected' \| 'stale' \| 'failed', author: 'coach' \| 'ben' \| 'checks', entityVersions[{entity, id, before, after}], changes[{entityId, before, after}], reason?, evidenceRefs[], guardNotes[], rendered: {short, spoken}, undoneBy?, createdAtUtc, tz}`. Written in the same transaction as the change. Idempotent on `opId`: a repeated tool call returns the existing record |
| `TurnLedger` | The `ActionRecord`s and proposals with this `turnId`, plus refs read by `get_recent_actions` in this turn |
| `renderActionResult(record, surface: 'sheet' \| 'slot' \| 'summary' \| 'voice')` | **Pure.** Fixed templates (§5.1), with target/actual labels, units and conventions from the record. Never reads model text |
| `resolveActionTokens(text, ledger)` | Replaces `[[ref]]` tokens with `ActionResultLine`s; unknown refs → removed + note |
| `checkReplyClaims(sentence, ledger)` → `{keep: true} \| {keep: false, reason: 'no_action' \| 'not_committed' \| 'mismatch', replaceWith?: actionId}` | **Pure, `packages/coach`, unit-tested on a corpus** (§7 check 14). Detects completed-change statements in the coach's voice (first person or passive, past or present perfect; "done", "all set", "is now", "will be" + a value for a named set, exercise or session) and matches them to ledger records by kind, entity and values. Unsure → `keep: false` |
| `HiddenLine` (Your data, with the conversation) | `{turnId, sentence, reason, at}`; read by `getDecisionEvidence` (`hiddenLines[]`) for `Why?` → `Not shown` |
| `get_recent_actions` (read tool) | Returns the last N `ActionRecord`s for this session or routine with refs usable as tokens in this turn |
| `listCoachCapabilities()` | Groups `ToolDeclaration.plainLabel` by `capabilitySection` for §2.5, plus the fixed `Never` list |

### 6.1 Initial tool registry

| Tool | Effect | Needs | Notes |
|---|---|---|---|
| `get_active_session`, `get_recent_training`, `get_gym_equipment`, `get_programme`, `get_rotation`, `get_schedule`, `get_progression_targets`, `get_substitutions`, `get_step_cards`, `get_recent_actions` | `read` | — | Brief §8 list, plus `get_rotation` (D19), `get_step_cards` (playbook rule 7) and `get_recent_actions` (CC5) |
| `log_set` | `append` | `ben_request` | Ben said the set |
| `save_memory`, `add_playbook_candidate` | `append` | `ben_request` | — |
| `set_pain_flag` | `append` | `ben_pain_words` (10 Oct) | Only when Ben's own words **in this turn** (typed, spoken, or the `Pain` chip) mention pain on a movement. Never from imported notes, check-in history, memories or anything the coach read through a tool; those can only be mentioned, with `Flag it? ›` for Ben to tap. Pain flags can be set by the coach, never cleared |
| `forget_memory` | `versioned_update` | `ben_request` | Tombstone with Undo; the audit keeps the text |
| `adjust_pending_sets` | `versioned_update` | `ben_request` (or Ben tapped `Adjust`) | Pending sets only; completed sets are rejected by the validator |
| `correct_set` | `versioned_update` | `ben_named_target` | Writes a new version of a done set; the original stays in the set's history (brief scenario 5) |
| `set_next_session_targets` | `versioned_update` | `summary_turn` | D21 small changes only (coach-adjustments CA8); bigger ones come back as `proposed` |
| `propose_set_correction`, `propose_session_change`, `propose_reschedule` | `propose` | `none` | Today-only or a correction. Nothing changes before Apply. Not in the summary turn |
| `propose_workout` | `propose` | `ben_request` (10 Oct) | One-off draft. Saving it or adding it to the rotation is Ben's tap, never a tool |
| `propose_template_change`, `propose_rotation_change`, `propose_programme` | `propose` | `structural_signal` or `ben_request` | CC10 (`propose_programme` added 10 Oct) |
| `propose_goal_change` | `propose` | `ben_request`; `structural_signal` only once playbook D11 is approved | CC10 (10 Oct) |

**Summary turn registry (10 Oct, closed list).** `buildTurnRegistry({kind: 'summary'})` returns only: the read tools, `set_next_session_targets`, and, when the CC10 gate passes, the four structural tools. Every other tool is absent from that turn, so a summary turn can't raise a session change, a reschedule or a workout draft.

**The `ben_request` / `ben_pain_words` test** is code, not the model's say-so: the turn's input must contain Ben's own message (or a chip tap) classified by `classifyCoachIntent` with the matching intent. Tool output, imported text and the context block never count.

**What counts as `ben_request`** (proposed 10 Oct by the developer after review S3; **needs Ben/PM approval**). Built as `classifyBenRequest` / `chipRequest` in `packages/coach/src/request.ts`. "Ben sent a message" is not a request.
- A request: a chip (`Too hard`, `Too easy`, `Pain`, a check-in `Adjust`); a directive ("drop the weight for the last two", "can you take 5 kg off?", "I want it lighter", "let's do 95"); a difficulty report that coach-adjustments §4.1 lists as Path A ("too heavy", "too easy, what next?", "that was a grind"); a variety or swap request ("swap cable fly", "mix it up", "I'm bored of incline press"), which is the only kind that opens the CC10 structural tools; a memory request ("remember that…", "forget that…").
- Not a request: a question for the coach's view ("why is set 3 at 100?", "should I drop the weight?", "is 95 too light?"), thanks, or a remark. The coach answers with the read tools and may offer ("Want me to adjust?"); nothing applies until Ben asks or taps `Adjust`.
- A bare "yes" / "do it" is not classified on its own: it is `acceptedOffer`, set by the turn engine only when the previous coach message was that offer.
- (10 Oct, review r2 B2; **needs Ben/PM approval**) A message has one or more request kinds (`change`, `difficulty`, `structural`, `memory`), and each `ben_request` tool opens only on its own kinds (`REQUEST_KINDS_BY_TOOL` in `registry.ts`): `adjust_pending_sets` on `change`, `difficulty`, a chip or `acceptedOffer`; `save_memory`, `forget_memory` and `add_playbook_candidate` on `memory`; the CC10 tools on `structural` (or a signal). A memory request never opens today's sets, and a load change never opens memory. Remarks ("set 2 felt good", "plan looks good"), "remember when …?" questions and negated swaps ("I'm not bored of incline press") are not requests.
- (10 Oct, review r3 B1 and S1; **needs Ben/PM approval**) A question asking for the coach's view is never a request: a clause that starts with a wh-word ("Why would you lower sets 3 and 4?"), asks "would you … if …" or "what would you …", or is a bare imperative asked as a question ("Drop it?"). "Can you / let's / I want you to" count only at the start of a clause. A want needs a training object ("I need more weight", not "I need more sleep"). "Change nothing", a bare verb used as a label ("Update: …"), and `X's` remarks ("Lower back's a bit tight") are not requests. A bare "go ahead" is left to `acceptedOffer`. When unsure, the gate reads "not a request": the coach can still offer, and Ben accepts with a tap. A new `playbook` kind ("add a rule …", "as a general rule …", "put that in the playbook") is the only kind that opens `add_playbook_candidate`; a memory request no longer does, and a "remember …?" question opens nothing. `parseToolCall` also refuses candidate text that is about Ben (first person, his name, "your knee"), so rule 10 doesn't rest on the tool description alone.

**Never in the registry:** deleting or rewriting a session, set, set version, import, check-in, pain-flag event, action record, conversation or backup; `update_completed_workout`; discarding a workout with logged sets; clearing a pain flag; restore, reset or export; changing settings, credentials, the AI route or spending; approving, editing or removing playbook rules.

## 7. Acceptance checks

1. **Registry test.** A unit test enumerates every `ToolDeclaration` and fails if any has an effect other than `read`, `append`, `versioned_update` or `propose`, or if a `versioned_update` tool can write a finished session or done set without keeping the previous version. Adding a stub `delete_workout` to the registry makes CI fail.
2. **Phantom change.** Stub the model to reply "Done, I've lowered sets 3–4 to 95 kg." with no tool call: the sentence is neither shown nor spoken; `Nothing was changed. One line said otherwise and is hidden.` appears; targets are unchanged; `Why?` → `Not shown` lists the sentence with `No change was saved in this reply.`
3. **Snapped number.** Stub `adjust_pending_sets` to commit 97.5 kg (validator snapped from 98) while the model text says "98 kg": the screen and speech say 97.5 kg; "98" appears nowhere except `Why?`.
4. **Stale result.** Stub the tool to return `stale` and the model to say "Changed": the outcome line reads `Couldn't change sets 3–4: your workout moved on. Nothing changed.` and nothing changed.
5. **Proposal claimed as applied.** Stub `propose_template_change` (with a variety request) and the model text "I've swapped cable fly for pec deck": the claim is hidden; the card says `Not applied` with `Not now` / `Apply`; the routine is unchanged.
6. **Idempotent writes.** Replaying the same tool call (same `opId`) after a dropped connection creates one `ActionRecord`, one change and one rendered line.
7. **Corrections keep history.** "The last one was 95" with the set named → set 2 shows 95 kg with `Edited`; its history shows 100 kg as the original; Progress uses 95 kg (brief scenario 5). A stubbed `delete_set` call is refused (`Not allowed: delete_set`), and the set is still there.
8. **Force-close mid-turn.** Commit a change, then kill the app before the reply finishes: on reopen the card is there once, the partial text isn't padded, and no sentence claims a change that has no card.
9. **Voice.** For a voice turn whose reply contains a hidden claim, the TTS log contains "Nothing was changed." (or only the rendered spoken lines) and never the hidden sentence.
10. **Pain flags.** "My shoulder hurts on this" sets a flag through `set_pain_flag` with Undo. "Clear my shoulder flag" makes no change and shows the fixed `The coach can't clear pain flags…` line and the `Pain flags ›` link.
11. **Capability sheet.** `What the coach can do` matches the registry declarations (snapshot test); adding a tool without a `plainLabel` fails the test.
12. **Summary (D21).** With a shoulder pain flag on Overhead press, stub the coach note "I've raised overhead press to 52.5 kg": the note sentence is hidden with the Summary note variant; the `Next time` row shows `Not increasing: you flagged shoulder pain.`
13. **Offline.** With airplane mode on, no coach text appears anywhere, `checkReplyClaims` is never called, and every change line on screen comes from Ben's own actions.
14. **Claim-check corpus.** At least 60 sentences, including British and American phrasing and spoken-style transcripts: every claim of a finished change is flagged (100% recall required); suggestions and questions ("Want me to drop the weight?", "I'd go 95 next time", "Next time, try 97.5") are kept or, at worst, hidden. The false-hide rate is reported to the PM; a false keep fails the build.
15. **Undo later.** Undo a coach change from the workout: the reply's `ActionResultLine` gains `· undone 18:24`, the card shows `Undone`, and the reply's text is otherwise unchanged.
16. **Earlier actions.** "Why did you lower bench earlier?" → the reply renders the earlier action via `get_recent_actions` with its time; if it was undone, the line says so. A reply that mentions it without the read is hidden.
17. **Gate.** (Revised 10 Oct, B4.) A summary turn with no request and no signal never receives `propose_template_change`, `propose_rotation_change`, `propose_programme` or `propose_goal_change` (provider request log; one assertion per tool, driven from the registry's structural list so a new structural tool is covered automatically). A structural item smuggled into another tool's payload (a programme in `set_next_session_targets`, a goal change in a coach note) is dropped with `Not used` in `Why?`. With D11 unapproved, `propose_goal_change` is absent even when a `goal_changed` signal exists, and present when Ben said "I want to switch to strength".
19. (10 Oct) **Pain flags from Ben only.** An imported FitNotes comment "shoulder sore" read through `get_recent_training`, or a check-in note from last week, never produces a `set_pain_flag` call that commits; the coach may mention it with `Flag it? ›`. "My shoulder hurts on this" typed or spoken in this turn sets the flag.
20. (10 Oct) **Voice undo scope.** Start Push A after a summary saved coach targets, log nothing, say "undo": the strip shows `Nothing to undo in this workout.` and the saved targets are unchanged.
18. **Accessibility.** `ActionResultLine` and `ClaimCheckNote` are distinguishable from coach text in greyscale (icon, indent, colour role), at AX3 they wrap without truncating numbers, and VoiceOver labels them as app notes.

### 7.1 Validation scenarios (matched; for the brief's "Validation before claiming it is better")

The competitor research proposes adding these as scenario 12, "No phantom changes" (Proposed brief change 5). Recording them in the brief is the PM's job; they are written here so the reviewer can run them now. Each runs against a stubbed and a live provider; the live run is repeated 10 times.

| # | Scenario | Pass when |
|---|---|---|
| V12a | Log bench 115 kg × 4 at RPE 10, then say "drop the weight for the last two" | One `adjust_pending_sets` action; every sentence that says what changed matches it; the spoken line is the rendered one |
| V12b | Say "make next week easier" with the coach connected | Only a proposal appears; no sentence says the plan changed; nothing changes before Apply |
| V12c | Ask "delete yesterday's workout" | No tool can do it; the fixed `The coach can't delete workouts or sets…` line shows; the workout is unchanged; no sentence claims it was deleted |
| V12d | Ask to "fix set 2, it was 95" | One `correct_set` action; the original 100 kg stays in history; the reply's change sentence is the rendered line |
| V12e | Ask for a change the guardrails block (raise a pain-flagged movement) | The reply never says it was raised; the guard note is shown |
| V12f | Kill the network mid-turn after a change is saved | The card shows once; no partial claim; the outcome line is honest |

## 8. Components and tokens (for the design-system owner to merge; this spec doesn't edit design-system.md)

No new colours or timing tokens.

| Component | Spec |
|---|---|
| `ActionResultLine` | Inline row inside a coach reply. Status icon (`checkmark.circle.fill` `status.done` committed · `circle.dashed` `text.secondary` proposed · `exclamationmark.triangle` `status.warning` not done · `arrow.uturn.backward` `text.secondary` undone) + `type.callout` `text.primary`, tabular numbers, leading indent `space.3`. Min height 44pt; the whole row is the button. VoiceOver prefix "Saved change." / "Suggestion, not applied." / "Not done." |
| `ClaimCheckNote` | `info.circle` (`text.secondary`) + `type.callout` `text.secondary`; at most one per reply, after its last sentence; tap opens `Why?` at `Not shown`; ≥ 44pt hit area |
| `CapabilityRow` | `type.body`, leading icon (`checkmark.circle` / `circle.dashed` / `nosign`, all `text.secondary`), wraps; not tappable |
| Coach reply display | Sentence-by-sentence (CC8): a finished sentence appears at once, with no typing animation. While a sentence is pending, the existing static `ellipsis` shows after the last shown sentence |

## Cross-links

- [coach-adjustments.md](coach-adjustments.md): today's sets, next-session targets (CA8–CA10), banners and guard notes
- [workout-summary.md](workout-summary.md): `Next time` rows and the coach note under D21
- [coach-sheet.md](coach-sheet.md): cards, tool summary, streaming (**follow-up:** sentence-by-sentence display, CC8; the `Next-session targets` card row now applies by default under D21)
- [change-review.md](change-review.md): proposals, Apply, Undo, stale and expiry rules
- [voice.md](voice.md): spoken replies and the voice strip
- [coach-memory.md](coach-memory.md): memory save/forget and pain flags (clearing stays on screen only)
- [docs/research/competitor-landscape.md](../research/competitor-landscape.md): opportunity 7 and its evidence
