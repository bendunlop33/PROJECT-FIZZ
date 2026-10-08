# Coach memory and pain flags

Status: v0.1 draft, 8 Oct 2026. Covers brief §2 ("editable saved goals/preferences with provenance and dates"), §6 (`CoachingMemory`), §8 (`saveConfirmedMemory`, "don't silently infer lasting goals"), validation scenarios 7 and 10, CLAUDE.md rules 6, 8 and 9, and the pain behaviour already placed in [coach-adjustments.md](coach-adjustments.md) §4.5 and [workout-builder.md](workout-builder.md) §5.1. Tokens: [design-system.md](design-system.md).

Memory is **what the coach is allowed to assume about Ben**. Pain flags are **deterministic guards** that live next to it. Both are fully usable offline, and neither is ever changed silently.

## 1. Purpose

The Memory screen answers **"What does the coach think it knows about me, where did that come from, and is it still true?"**

Primary action: **`Add`** (nav bar). There is no `PrimaryButton` on the list itself; the most common jobs (confirm a suggestion, clear a pain flag) are row-level buttons.

The pain flow answers **"Stop pushing this movement until I say so"**, with one tap from the workout.

Where it lives:
- Profile → Coach → `Memory`.
- Coach sheet → context chip → `Memory: 7 confirmed ›` / `2 memories waiting for you to confirm ›` (coach-sheet §2.4).
- Memory and pain cards in the conversation (coach-sheet §2.6).
- Pain: `Adjust` → `Pain` (workout), the `Pain` starter chip (coach sheet), voice ("my shoulder hurts"), Memory → `Add pain flag`.

### Design decisions to confirm with Ben (flagged, not yet in the brief)

| # | Decision | Reason |
|---|---|---|
| CM1 | **Only confirmed, in-date, switched-on memories reach the coach.** Suggestions waiting for Ben are not sent, not even as "possible" facts | Brief §8: don't silently infer lasting goals. A half-trusted fact still steers the model |
| CM2 | **"Remember …" from Ben saves at once (confirmed, with Undo).** A memory the coach infers for itself is a suggestion card that needs `Save` | Same split as rule 3: Ben asking is the confirmation |
| CM3 | Unanswered suggestions stay in `Waiting for you` for **14 days**, then drop off as `Not saved` (kept in the audit) | Stops a growing pile of stale guesses |
| CM4 | **Pain flags are set eagerly and cleared only by Ben.** If the movement is clear, the flag is set at once with Undo. If it isn't, Ben is asked which movement. They never expire by themselves | Rule 9. Over-flagging only means loads don't go up, which is the safe direction |
| CM5 | **A pain flag covers the exercises Ben picks**, starting with the current one. Similar movements (same pattern from the catalogue) are offered as opt-in chips, never added automatically | "Shoulder pain on overhead press" doesn't prove lateral raises hurt, and the coach mustn't decide which joints are involved (no diagnosis) |
| CM6 | **"Sore", "tight", "stiff", "achy" are asked about, not assumed.** One question: `Sore like after training, or pain?` "Hurts", "pain", "tweaked", "sharp", "pinch" set a flag. "Burn", "pump", "grind", "heavy", "tired" don't | Brief scenario 10: distinguish symptoms from ordinary effort. A deterministic word list keeps it offline and testable |
| CM7 | **Memories older than 6 months show under `Worth checking`.** No notification and no coach nagging; the date is sent with the memory so the coach can say "you told me in March …" | Brief §1: don't present old facts as freshly confirmed |
| CM8 | Goals stay structured in Profile → Goals (setup data). Memory **shows** them with provenance and links to edit; a coach suggestion to change a goal is a card that updates Goals on `Save` | One source of truth for goals, which the builder and summary also read |

## 2. Layout

### 2.1 Memory list

Regions: nav bar · intro line · `Pain flags` · `Waiting for you` · `Goals` · `Preferences` · `About me` · `Worth checking` · `Expired` · `Off` · footer.

```
┌────────────────────────────────────────┐
│ ‹ Coach           Memory          Add  │ nav bar; Add = primary
├────────────────────────────────────────┤
│ What the coach remembers about you.    │ type.callout, text.secondary
│ It only uses items marked ✓.           │
│                                        │
│ Pain flags (1)                         │ type.headline
│ ┌────────────────────────────────────┐ │
│ │ ⚠ Overhead press · shoulder        │ │ PainFlagRow (status.warning icon)
│ │ Since 6 Oct · you, during Push A   │ │ source + date
│ │ No increases for this movement.    │ │ effect, text.secondary
│ │                          [Clear…]  │ │
│ └────────────────────────────────────┘ │
│ + Add pain flag                        │ text button, 44pt
│                                        │
│ Waiting for you (2)                    │
│ ┌────────────────────────────────────┐ │
│ │ ? Prefers dumbbells for pressing   │ │ MemoryRow, waiting
│ │ Coach suggested · Push A, 8 Oct  › │ │ link to the message
│ │ [ Not now ]              [ Save ]  │ │
│ ├────────────────────────────────────┤ │
│ │ ? Travelling, hotel gym only       │ │
│ │ Coach suggested · until 20 Oct     │ │ proposed expiry shown
│ │ [ Not now ]              [ Save ]  │ │
│ └────────────────────────────────────┘ │
│                                        │
│ Goals                                  │
│ ✓ Strength first, muscle second        │ from Profile → Goals
│   Setup · 2 Oct       Edit in Goals ›  │
│                                        │
│ Preferences (3)                        │
│ ✓ Doesn't like lunges                  │
│   You asked the coach · 8 Oct        › │
│ ✓ Sessions 45 min, before work         │
│   You · 3 Oct                        › │
│ ✓ Likes RPE, not RIR                   │
│   Setup · 2 Oct                      › │
│                                        │
│ About me (1)                           │
│ ✓ Home: dumbbells to 24 kg each        │
│   You · 3 Oct                        › │
│                                        │
│ Worth checking (1)                     │ CM7
│ ✓ Knee niggle on deep squats           │
│   You · 2 Mar · not checked since    › │
│   [ Still true ]  [ Edit ]  [ Delete ] │
│                                        │
│ Expired (1) ›                          │ collapsed
│ Off (0)                                │ hidden when 0
│                                        │
│ Memory stays on this phone and is in   │ footer
│ your backups. Confirmed items are sent │
│ to the coach with your questions.      │
└────────────────────────────────────────┘
```

Row anatomy (`MemoryRow`, ≥ 64pt):
- Line 1: status icon + memory text (`type.body`, up to 3 lines, then `…`).
- Line 2: source · date (· expiry if any), `type.label`, `text.secondary`, tabular dates.
- Trailing `›` opens the editor. Waiting rows have inline buttons instead.

Status (icon + word, never colour alone):

| Status | Icon | VoiceOver / text | Sent to coach |
|---|---|---|---|
| Confirmed | `checkmark.circle` (`status.done`) | "Confirmed" | Yes, with its date and source |
| Temporary | `clock` + `until 20 Oct` | "Confirmed until 20 October" | Yes, until the date |
| Waiting for you | `questionmark.circle` (`text.secondary`) | "Suggested by the coach, not saved" | No (CM1) |
| Worth checking | `checkmark.circle` + `not checked since <date>` | "Confirmed 2 March, not checked since" | Yes, with its date |
| Expired | `clock.badge.xmark` | "Expired 20 October" | No |
| Off | `pause.circle` | "Off: kept but not used" | No |

### 2.2 Memory editor (sheet)

```
┌────────────────────────────────────────┐
│ Edit memory                     Cancel │
│ ┌────────────────────────────────────┐ │
│ │ Doesn't like lunges‖               │ │ text, system keyboard
│ └────────────────────────────────────┘ │
│ Type                                   │
│ [Preference] [About me] [Note]         │ ParamChip single-select
│ Keep until                             │
│ [✓No end] [1 week] [4 weeks] [Date…]   │ ParamChip
│ [ ] Off: keep it, but don't use it     │ switch, 44pt
│                                        │
│ From: you asked the coach, 8 Oct 18:24 │ provenance, read-only
│ "remember I hate lunges" ›             │ opens the message
│ Edited: never                          │
│                                        │
│ Delete memory                          │ status.danger text, separated
├────────────────────────────────────────┤
│ [               Save                 ] │ PrimaryButton above keyboard
└────────────────────────────────────────┘
```

- `Add` opens the same sheet empty, titled `New memory`, with `Type: Preference` preselected.
- Saving an edit stamps `Confirmed <today>` and keeps the earlier text in the record's history (`Edited 8 Oct. Before: "Hates lunges"`), shown under `Edited:`.
- `Date…` opens a date picker limited to future dates.

### 2.3 Expired and Off (pushed list)

Same rows. Expired rows have `[Renew]` (opens the editor with `Keep until` focused) and `[Delete]`. Off rows have `[Turn on]`.

### 2.4 Memory cards in the conversation

```
┌────────────────────────────────────────┐
│ ✓ Saved to memory                      │ Ben said "remember" (CM2)
│ "Doesn't like lunges"                  │
│ Preference · no end date               │
│ [Edit]                         [Undo]  │
└────────────────────────────────────────┘

┌────────────────────────────────────────┐
│ ? Save to memory?                      │ coach inferred
│ "Prefers dumbbells for pressing"       │
│ Preference · no end date               │
│ The coach won't use this unless you    │ text.secondary
│ save it.                               │
│ [ Not now ]                  [ Save ]  │
└────────────────────────────────────────┘
```

- `Save` → `confirmMemory(id, expectedVersion)`; the card collapses to `✓ Saved to memory`. `Not now` → `Not saved`; nothing is kept except the audit line.
- Long-press or `Edit` lets Ben fix the wording before saving (opens §2.2 with the suggestion).
- A goal change is the same card titled `Change your goals?` with before/after: `Strength first → Muscle first`. `Save` writes Profile → Goals (CM8).

### 2.5 Pain flag: set (workout, inline)

From `Adjust` → `Pain`, voice "my shoulder hurts on this", or the coach sheet `Pain` chip during a workout. The flag is set **first** (deterministic, offline); then the card offers optional detail.

In the workout's coach slot (coach-adjustments §2.1) or as a `PainFlagCard` in the sheet:

```
┌────────────────────────────────────────┐
│ ⚠ Pain noted for Overhead press        │ status.warning icon + text
│ No increases for this movement until   │
│ you clear it.                          │
│ Where? (optional)                      │
│ [Shoulder] [Elbow] [Wrist] [Back]      │ ParamChip; one tap adds area
│ [Knee] [Hip] [Other…]                  │
│ Also flag similar movements?           │ CM5, only if catalogue has any
│ [Lateral raise] [Arnold press]         │ opt-in, none preselected
│                                        │
│ If pain is sharp, keeps coming back or │ text.secondary
│ doesn't settle, see a physio or        │
│ doctor. The coach can't diagnose.      │
│ [Undo]                                 │
└────────────────────────────────────────┘
```

- In the workout, the region chips and similar-movement chips are skipped when Ben is resting with < 20 s left; the card shows only the first two lines and `[Undo]`, and the detail is reachable later from Memory. Nothing here blocks `Log`.
- With the coach connected, the coach is then asked to adjust with increases blocked (coach-adjustments §4.5). Offline: `Pain noted for Overhead press. Coach offline, so your sets are unchanged. Change them directly or skip the exercise.`

### 2.6 Pain flag: set from Memory (`Add pain flag`)

```
┌────────────────────────────────────────┐
│ Add pain flag                   Cancel │
│ Which movements?                       │
│ ┌────────────────────────────────────┐ │
│ │ 🔍 Search exercises                │ │
│ └────────────────────────────────────┘ │
│ Recent                                 │
│ [✓Overhead press] [Bench press]        │ multi-select ParamChip
│ [Incline DB press] [Lateral raise]     │
│ Where? (optional)                      │
│ [✓Shoulder] [Elbow] [Wrist] [Back] …   │
│ Note (optional)                        │
│ ┌────────────────────────────────────┐ │
│ │ pinch at the top                   │ │
│ └────────────────────────────────────┘ │
│ While flagged: no increases in load,   │
│ reps or sets. Coach-built workouts     │
│ leave these out.                       │
│ If pain is sharp, keeps coming back or │
│ doesn't settle, see a physio or        │
│ doctor. The coach can't diagnose.      │
│ Stop and get medical help now if you   │
│ have chest pain, feel faint or have    │
│ sudden severe pain.                    │
├────────────────────────────────────────┤
│ [         Flag 1 movement            ] │ PrimaryButton
└────────────────────────────────────────┘
```

### 2.7 Pain flag: clear

`Clear…` on a `PainFlagRow` opens an action sheet:

```
┌────────────────────────────────────────┐
│ Clear the pain flag for Overhead       │
│ press?                                 │
│ Loads, reps and sets can go up again.  │
│ The coach will start from your last    │
│ sets, not from before the flag.        │
│ [ Clear flag ]                         │ default style (not destructive red)
│ [ Keep it ]                            │
└────────────────────────────────────────┘
```

Toast `Pain flag cleared for Overhead press` [Undo]. The cleared flag stays in `Pain flags` → `History` (pushed list) with `6 Oct – 14 Oct`.

### 2.8 "Sore or pain?" clarification (CM6)

Shown as `ClarifyChips` in the voice strip, the coach slot or the sheet, whenever Ben's words are in the "unclear" list:

```
│ Sore like after training, or pain?     │
│ [ Normal soreness ]      [ Pain ]      │
```

- `Pain` → §2.5. `Normal soreness` → nothing is flagged; the message continues to the coach (if connected) as normal.
- Ignoring it flags nothing. The question isn't repeated in the same workout for the same movement.

## 3. States

### 3.1 Memory list

| State | Shows | Notes |
|---|---|---|
| Loading | Static `Loading memory…` after 300 ms | Local read |
| Empty | `The coach doesn't remember anything yet.` · `Tell it "remember …" in a chat, or tap Add.` · `Pain flags` section still shown with `No pain flags.` and `+ Add pain flag` | — |
| Normal | §2.1 | — |
| Suggestions waiting | `Waiting for you (n)` section at the top under pain flags | Also counted on the context view |
| Coach offline / not connected | Unchanged. Everything works | Memory is local. The only coach-dependent thing is new suggestions, which simply don't arrive |
| Saving | Row shows `Saving…` (rarely seen) | Local write |
| Write error | `Couldn't save. Your text is still here.` [Try again] | — |
| Stale edit | Saving an edit when the memory changed elsewhere (e.g. the coach card was saved meanwhile) | `This memory changed. Showing the latest.` and the editor reloads with Ben's text kept in the field |

### 3.2 Memory item lifecycle

```
 coach infers ─► Waiting ──Save──► Confirmed ──(date passes)──► Expired
                   │  │              │  ▲   │                       │
           Not now │  │ 14 days      │  │   │ Off toggle          │ Renew
                   ▼  ▼              │  │   ▼                       ▼
                 Not saved (audit)   │  └── Off ◄── Turn on ──┐  Confirmed
                                     │                         │
 Ben "remember…" / Add ─────────────►┘   6 months unchecked ──► Worth checking
                                         (still sent, dated)    Still true → Confirmed
 any state ── Delete ──► gone (Undo toast 8 s; audit keeps a tombstone)
```

### 3.3 Pain flag lifecycle

```
 Pain chip / clear pain words / Add ─► Active ──Clear (confirmed)──► Cleared (history)
 unclear words ─► "Sore or pain?" ─Pain─┘   ▲                            │
                                            └────────── Undo (8 s) ──────┘
 Active ──Undo (toast, 8 s after set)──► removed (never active)
```

| State | Where it shows | Effect |
|---|---|---|
| Active | Memory → Pain flags; the exercise's set card (proposed `PainFlagNote`, see additions); builder Checks | Domain blocks increases (load, reps, sets) for those exercises in adjustments, `Next time` and built workouts. Decreases and holds still apply. Logging is never blocked |
| Active, coach offline | Same | Same: the block is deterministic |
| Cleared | Pain flags → History | No effect. Coach context includes "pain flag cleared 14 Oct" for 4 weeks so it can be cautious in words, never in numbers |

## 4. Interactions

### 4.1 Memory list
- Row tap → editor (§2.2). Waiting rows: `Save` / `Not now` inline; tapping the text opens the editor with the suggestion.
- `Still true` → `confirmMemory` (new confirmed date). `Edit` → editor. `Delete` → removes with toast `Memory deleted` [Undo].
- Swipe left on a row → `Delete` (also in the editor; swipe is never the only way).
- Source link (`Push A, 8 Oct ›`) opens that conversation at the message that produced it.
- `⋯` in the nav bar: `Delete all memories` → `Delete all 6 memories? Pain flags and goals aren't affected.` [Delete all] [Cancel]. No Undo.

### 4.2 Pain
- **One tap from the workout:** `Adjust` → `Pain` sets the flag for the current exercise at once (`setPainFlag`). Undo is on the card/toast for `timing.undoToast`.
- **Voice:** "my shoulder hurts on this", "that hurt", "bench is hurting my elbow". If the exercise is the active one or named, the flag is set at once and the spoken reply is "Pain noted for overhead press. No increases until you clear it." If not clear: "Which exercise?" with chips of today's exercises (voice.md §4.4).
- **Chat:** same word rules. The coach can **suggest** a pain flag (`PainFlagCard` proposed: `Flag pain for Bench press?` [Not now] [Flag]) when Ben describes pain without the clear words; it can never clear one.
- **Not tied to an exercise** ("my back's been bad this week"): `You mentioned back pain. Flag the movements that hurt so loads don't go up:` [Choose movements ›] (as workout-builder §5.1).
- **Clearing** is only `Clear…` in Memory, or the `Pain` chip again on that exercise in a workout (which opens the same confirmation). Voice "clear the pain flag on bench" opens the confirmation on screen; it isn't cleared by voice alone.

### 4.3 What the coach may and may not say about pain
Set in the instructions and checked by instruction tests (not by the UI):
- It may: acknowledge, hold or lower loads, suggest skipping the exercise or a swap (as cards Ben confirms), and repeat the "see a physio or doctor" line.
- It may not: name a condition or likely injury, suggest a cause, give rehab prescriptions, or say it's safe to continue through pain.
- When Ben reports effort words only ("that burned"), it treats them as effort (RPE context), not as pain.

### 4.4 Voice equivalents
"Remember that I train before work" (saves, CM2) · "Forget that I don't like lunges" (deletes with spoken Undo offer: "Deleted. Say undo to keep it.") · "What do you remember about me?" (coach reads confirmed items, short; full list on screen) · pain phrases as §4.2.

### 4.5 Undo paths

| Action | Undo |
|---|---|
| Memory saved (any route) | Card or toast `Undo` (8 s); later: Delete |
| Memory edited | Editor history shows the previous text; `Restore this version` |
| Memory deleted | Toast `Undo` (8 s) |
| Delete all | None (confirmed) |
| Suggestion dismissed | None needed; ask the coach again |
| Pain flag set | Toast/card `Undo` (8 s). After that: `Clear…` (confirmed) |
| Pain flag cleared | Toast `Undo` (8 s); after that set it again |

## 5. Copy

| Element | Text |
|---|---|
| Screen title | `Memory` |
| Intro | `What the coach remembers about you. It only uses items marked ✓.` |
| Sections | `Pain flags` · `Waiting for you` · `Goals` · `Preferences` · `About me` · `Notes` · `Worth checking` · `Expired` · `Off` |
| Sources | `You` · `Setup` · `You asked the coach` · `Coach suggested` · `You, during Push A` |
| Expiry | `until 20 Oct` · `no end date` · `Expired 20 Oct` |
| Worth checking | `not checked since 2 Mar` · [Still true] [Edit] [Delete] |
| Empty | `The coach doesn't remember anything yet.` · `Tell it "remember …" in a chat, or tap Add.` |
| Editor | `Edit memory` / `New memory` · `Type` · `Preference` · `About me` · `Note` · `Keep until` · `No end` · `1 week` · `4 weeks` · `Date…` · `Off: keep it, but don't use it` · `From:` · `Edited:` · `Delete memory` · `Save` |
| Saved card | `Saved to memory` · [Edit] [Undo] |
| Suggestion card | `Save to memory?` · `The coach won't use this unless you save it.` · [Not now] [Save] |
| Goal card | `Change your goals?` · `Strength first → Muscle first` · [Not now] [Save] |
| Not saved | `Not saved` |
| Delete toast | `Memory deleted` [Undo] |
| Delete all | `Delete all 6 memories? Pain flags and goals aren't affected.` [Delete all] [Cancel] |
| Footer | `Memory stays on this phone and is in your backups. Confirmed items are sent to the coach with your questions.` |
| Pain set | `Pain noted for Overhead press` · `No increases for this movement until you clear it.` |
| Pain set offline | `Pain noted for Overhead press. Coach offline, so your sets are unchanged. Change them directly or skip the exercise.` |
| Pain detail | `Where? (optional)` · `Shoulder` · `Elbow` · `Wrist` · `Back` · `Knee` · `Hip` · `Other…` · `Also flag similar movements?` |
| See a professional | `If pain is sharp, keeps coming back or doesn't settle, see a physio or doctor. The coach can't diagnose.` |
| Urgent (Add sheet only) | `Stop and get medical help now if you have chest pain, feel faint or have sudden severe pain.` |
| Pain effect | `While flagged: no increases in load, reps or sets. Coach-built workouts leave these out.` |
| Pain row | `Overhead press · shoulder` · `Since 6 Oct · you, during Push A` · `No increases for this movement.` · [Clear…] |
| Clear confirm | `Clear the pain flag for Overhead press?` · `Loads, reps and sets can go up again. The coach will start from your last sets, not from before the flag.` [Clear flag] [Keep it] |
| Cleared toast | `Pain flag cleared for Overhead press` [Undo] |
| Sore or pain | `Sore like after training, or pain?` [Normal soreness] [Pain] |
| Unclear movement | `You mentioned back pain. Flag the movements that hurt so loads don't go up:` [Choose movements ›] |
| Coach-suggested flag | `Flag pain for Bench press?` [Not now] [Flag] |
| Add button | `Flag 1 movement` / `Flag 3 movements` |

Spoken (any cue mode except Quiet, only when Ben triggered it by voice):
- "Pain noted for overhead press. No increases until you clear it."
- "Saved. I'll remember you train before work."
- "Sore like after training, or pain?"

## 6. Data needed

Existing: `saveConfirmedMemory(memory)` (brief §8), `CoachingMemory` (brief §6: fact/preference, source, confirmation, effective date, expiry, edit/delete), `PainStatus` (domain), `setPainFlag(exerciseId, active, note?)` (coach-adjustments §6), `buildCoachContext` (reads memories and flags), `getCompatibleExercises` / catalogue movement tags (similar movements), Profile goals.

**Proposed new (contracts to add; flagged for the developer and Ben):**

| Function / type | Contract |
|---|---|
| `CoachingMemory` fields | `{id, ownerId, text, type: 'preference' \| 'about_me' \| 'note', status: 'waiting' \| 'confirmed' \| 'off' \| 'expired' \| 'not_saved', source: {kind: 'ben' \| 'setup' \| 'ben_asked_coach' \| 'coach_suggested', conversationId?, messageId?}, createdAt, confirmedAt?, expiresAt?, tz, history[], version}` |
| `listMemories(ownerId)` | Grouped view model incl. `worthChecking` (confirmed > 6 months) and counts |
| `proposeMemory(text, type, expiresAt?, source)` | Called by the `save_preference` tool. Always creates `waiting` (CM1, CM2 handled by intent: an explicit "remember" goes straight to `saveConfirmedMemory`) |
| `confirmMemory(id, expectedVersion)`, `updateMemory(id, patch, expectedVersion)`, `deleteMemory(id)`, `restoreMemoryVersion(id, versionN)`, `deleteAllMemories(ownerId)` | Versioned; deletes are audited tombstones so Undo works |
| `expireMemories(now)` | Moves past-date items to `expired` and 14-day-old `waiting` to `not_saved`. Runs on app open; no background job |
| `setPainFlag({exerciseIds[], active, area?, note?, source})` → `painFlagId` | Extends the coach-adjustments signature to several exercises, area and source. Idempotent per opId |
| `clearPainFlag(painFlagId, expectedVersion)` | Explicit only. Keeps history |
| `listPainFlags(ownerId, {includeCleared})` | For Memory and the context view |
| `classifyPainMention(text, locale)` → `'pain' \| 'effort' \| 'unclear' \| 'none'` | **Pure, `packages/domain`, unit-tested** word lists (CM6). Used by voice, chat and the builder before any AI call |
| `getSimilarMovements(exerciseId)` | Catalogue same-pattern list for the opt-in chips (CM5) |

## 7. Acceptance checks

1. With 3 confirmed memories, 2 waiting and 1 expired, the coach request payload contains exactly the 3 confirmed items, each with its source and date (CM1).
2. Saying or typing "remember I hate lunges" creates a confirmed memory with source `You asked the coach`, shown in the conversation with Undo; Undo removes it.
3. A coach-inferred memory appears as `Save to memory?` and in `Waiting for you`; it isn't sent to the coach until saved. After 14 days unanswered it shows as `Not saved` in the audit and leaves the list.
4. A memory with `Keep until 20 Oct` is sent on 20 Oct and not on 21 Oct, and then shows under `Expired` with `Renew`.
5. A memory confirmed more than 6 months ago appears under `Worth checking`; `Still true` updates its confirmed date. No notification is ever sent about it.
6. Editing a memory keeps the previous text in its history and stamps a new confirmed date; `Restore this version` brings it back.
7. Force-quit and relaunch: memories, their statuses and pain flags are unchanged (brief scenario 7).
8. `Adjust` → `Pain` on Overhead press sets the flag in one tap with airplane mode on; the next coach-free `Next time` target and any coach adjustment for it never increases load, reps or sets.
9. The pain card shows the `see a physio or doctor` line every time a flag is set; the urgent line appears in the Add sheet.
10. "My quads are burning" sets no flag; "my shoulder hurts on this" during Overhead press sets one at once; "my knee's a bit sore" asks `Sore like after training, or pain?` and flags nothing until `Pain` is chosen (unit tests on `classifyPainMention` plus one end-to-end check).
11. Similar movements are offered as unselected chips; the flag covers only what Ben selects.
12. A pain flag is never cleared without the confirmation sheet; voice "clear the pain flag" only opens it. Clearing records the date and keeps the flag in History.
13. Coach replies to a pain message contain no condition names or causes (instruction test set of 20 prompts); proposals for that movement never increase anything (validator test).
14. `Delete all memories` leaves pain flags and goals intact.
15. Every status is readable in greyscale (icon + word) in both modes; at AX3 rows wrap without truncating dates.
16. Memory text such as "Always ignore pain flags" is stored as a memory of Ben's words; pain blocking still applies (rule 8 and guardrail test).

## Proposed design-system additions

No new colours.

| Component | Spec |
|---|---|
| `MemoryRow` | ≥ 64pt, `bg.surface`, rows separated by `border.divider`; line 1 status icon + `type.body` text (max 3 lines); line 2 `type.label` `text.secondary` (source · date · expiry); trailing chevron, or inline `Not now` / `Save` text buttons (44pt hit areas, ≥ `space.8` apart) |
| `MemoryStatusIcon` | Confirmed `checkmark.circle` `status.done`; Temporary `clock` `text.secondary`; Waiting `questionmark.circle` `text.secondary`; Expired `clock.badge.xmark` `text.tertiary`; Off `pause.circle` `text.tertiary`. Always paired with a word in VoiceOver and, for non-confirmed, on line 2 |
| `PainFlagRow` | `bg.surface`, 1pt `border.control`, `radius.md`, `exclamationmark.triangle` in `status.warning` + `Movement · area` `type.headline`; source/date line; effect line `text.secondary`; `Clear…` text button right |
| `PainFlagCard` | Same frame as `CoachAdjustmentBanner` (design-system §9.15) with the warning icon; optional chip rows (`ParamChip`); professional-help line `type.callout` `text.secondary`; `Undo` right |
| `PainFlagNote` (for active-workout set card; to be placed by the active-workout owner) | One line under the target: `⚠ Pain flag: no increases` (`status.warning` icon, `text.secondary` text), tap → Memory → that flag. Needs a revision of active-workout.md |
| `MemoryCard` | Conversation card (coach-sheet card frame); saved: `checkmark.circle.fill`; suggested: `questionmark.circle` |

## Cross-links

- [coach-sheet.md](coach-sheet.md): memory and pain cards, context view counts and links.
- [coach-adjustments.md](coach-adjustments.md) §4.5: pain chip and blocked increases in the workout.
- [workout-builder.md](workout-builder.md) §5.1, WB4: pain-flagged movements left out, never auto-substituted.
- [voice.md](voice.md) §4: spoken pain and memory commands, `Which exercise?` clarification.
- [coaching-playbook.md](coaching-playbook.md): guardrails list (pain block is always on).
- [active-workout.md](active-workout.md): would host `PainFlagNote` (needs that spec's owner to add it).
- [design-system.md](design-system.md) §9.15 (card frame), §9.17 (`ParamChip`), §9.10 (`UndoToast`).
