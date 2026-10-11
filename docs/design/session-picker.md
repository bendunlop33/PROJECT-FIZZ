# Session picker (choose today's session, keep the recommendation)

Status: v0.1, 11 Oct 2026. Asked for by Ben: "I should be able to choose what day/type of session I am hitting too, as well as the recommendations." Mockup: [mockups/session-picker.html](mockups/session-picker.html) (Direction D dark, 390 × 844).

Builds on [workout-overview.md](workout-overview.md), [overview-today-edits.md](overview-today-edits.md) (pre-start drafts, ADR 0022), premium-feel §2 (Today), routines.md, D19 (rotation) and D21 (coach next-session targets). Rules: CLAUDE.md 1, 2, 3, 4, 5, 6, 10 and the minimal-copy convention.

**Out of scope:** weekly calendar scheduling (planning sessions onto weekdays). D19 removed weekdays for lifting, and this slice doesn't add them back. Also out: voice grammar (noted for voice.md, §4.4), editing a session's exercises in the picker, and any AI call.

---

## 0. Brief correction (flag for Ben)

The task assumed FitNotes imports bring **named workouts**. They don't. The FitNotes CSV has no workout or routine name in any layout (research [fitnotes-export-format.md](../research/fitnotes-export-format.md) §215 and §286: routines and workout comments exist only in the `.fitnotes` backup). Imported sessions are stored with `routineName: null` (`packages/domain/src/import/session.ts`).

The CSV does have each row's **`Category`**, which is Ben's own muscle-group label (`Chest`, `Back`, `Legs`, `Shoulders`…). It is already kept as a raw cell in `import_rows` (ADR 0016). For a body-part split, that label is the day. This spec therefore derives an imported workout's session type from the Category of its working sets (§3.2). **Decision 1 for Ben.**

---

## 1. Purpose

**Question:** "What am I training today, and what should I lift?"

- **Today** still answers "what's next" with one recommended session and one reason line, one tap from Start.
- The **picker** answers "I'm doing legs instead". Ben picks any session type, and the overview shows recommended targets for it.
- **Primary action:** unchanged, `Start workout` on the overview. The picker's single action is picking a row.

### 1.1 Decisions

| # | Decision | Reason |
|---|---|---|
| SP-D1 | The choice lives in **three places, one sheet**: (a) `Change` on Today's Up next eyebrow line; (b) Today's `YOUR ROUTINES` section becomes `SESSIONS` (one tap to any session's overview); (c) the overview **title is a button** (`Legs ▾`) that opens the same sheet and switches in place. `Other routine` leaves the overview `⋯` menu | Today stays one tap from Start. Switching on the overview costs 2 taps and no back-navigation |
| SP-D2 | A **session type** is (1) a saved routine, (2) a group of named workouts with the same name, or (3) a group of unnamed imported workouts with the same Category label (§3.2). Groups are deduplicated so that one name is one row | Ben's split is body parts. Imports have no names (§0) |
| SP-D3 | **Order:** recommended first, then by longest since last done. Types not done in 42 days go under `OLDER`. Never-done routines go last, marked `New` | Recency is the useful order for a split. Stale programmes don't crowd the top |
| SP-D4 | **Recommendation:** D19 rotation when the last workout came from a routine and there are 2 or more routines (unchanged). **Otherwise, the active type that has gone longest since it was last done** (it replaces "repeat the last workout"). **Decision 2 for Ben** (it amends D19's fallback) | Repeating Back the day after Back is the wrong default for a split. "Longest gap" equals the rotation for any consistent split, and it needs no stored order |
| SP-D5 | A history type plans from **its most recent session**, through the existing `{kind: 'next', sourceSessionId}` overview basis: that session's exercises and set counts, with next targets from `nextTargetsFor` (coach D21 target when valid, else the built-in rule), fitted with `snapPlanToGym`. **Preview = Start** (OV3) with no new planner | One planner path, and stored coach targets work unchanged |
| SP-D6 | **Switching never discards or moves today's edits.** Drafts are already per basis (ADR 0022). The old session's draft stays until midnight, any Start, or Reset. Switching back shows it again. The picker marks such rows `Edited` | Safe and reversible. No confirmation dialog needed |
| SP-D7 | The check-in score, gym chip and coach state are **owner-level** and survive a switch. The picker shows no targets, no coach text and makes no AI call | Rules 1, 3. Nothing to re-answer |
| SP-D8 | Starting a history type names the session with the type's label (`routineName = 'Legs'`), so the next grouping is by name | The derived label becomes Ben's real name. Rename on Summary still works |

---

## 2. Layout (390 × 844)

### 2.1 Today, Up next (changes only)

```
┌────────────────────────────────────────┐
│ SUNDAY 11 OCTOBER          ( Main gym ▾)│
│                                        │
│ UP NEXT                        Change  │ eyebrow + underlined link (16 pt, 44 hit)
│ Legs                                   │ 40/600
│ Quads · Hamstrings · Glutes · 15 sets  │ callout, secondary
│ Last done Mon 5 Oct · 6 days ago       │ basis (actual)
│ ╭────────────────────────────────────╮ │
│ │           Start workout            │ │ 60 pt, the only filled pill
│ ╰────────────────────────────────────╯ │
│ Back squat                             │ hero detail rows (unchanged)
│ Target 120 kg × 5–8 · 3 sets           │
│ Romanian deadlift                      │
│ Target 100 kg × 8–10 · 3 sets          │
│ +3 more                                │
│ Empty workout     Past workouts        │
│ ────────────────────────────────────── │
│ SESSIONS                               │ was YOUR ROUTINES
│ Shoulders              4 days ago    › │ rows ≥ 52 pt → overview
│ Back                   3 days ago    › │
│ Chest                  2 days ago    › │
│ All sessions                         › │ opens the picker
│ ────────────────────────────────────── │
│ THIS WEEK …                            │
```

- `SESSIONS` lists up to 3 types in picker order, **excluding Up next**, then `All sessions ›` when more exist. It shows whenever there are 2 or more types (not only when routines exist). It is hidden while a workout is in progress (unchanged).
- `Change` appears only in the Up next state. It is not shown in Resume or Stale, or when there are fewer than 2 types. In Done today the `SESSIONS` list is the way to start another session.
- Basis line variants (actuals): `After Pull A · Thu 8 Oct` (D19) · `Your only routine` · `Last done Mon 5 Oct · 6 days ago` (longest gap) · `From Thu 8 Oct` (one type only).

### 2.2 Picker sheet (`SessionPickerSheet`, new; `BottomCard`, medium detent, drag to large)

```
┌────────────────────────────────────────┐
│ Choose session                   Close │ title2 + text button
│                                        │
│ ✓ Legs              [↻ UP NEXT]        │ SessionPickerRow ≥ 60 pt, one button
│   6 days ago · 5 exercises             │ callout, secondary (actuals)
│────────────────────────────────────────│
│   Shoulders                            │
│   4 days ago · 5 exercises · Edited    │ draft open for this basis
│────────────────────────────────────────│
│   Back                                 │
│   3 days ago · 6 exercises             │
│────────────────────────────────────────│
│   Chest                                │
│   2 days ago · 5 exercises             │
│────────────────────────────────────────│
│   Arms                                 │ routine, never done
│   New · 4 exercises                    │
│                                        │
│ OLDER                                  │ sectionLabel
│   Full body                            │
│   14 Aug · 6 exercises                 │
│                                        │
│ Empty workout                          │ underlined links, 44 hit
│ Past workouts                          │
└────────────────────────────────────────┘
```

- `✓` (checkmark icon, `text.primary`) marks the session the overview is showing. From Today, no row is checked.
- `UP NEXT` is a `tag` (icon + word, `bg.raised`), never colour alone, and never an accent fill.
- A tap on a row: from Today, closes the sheet and opens the overview for that type. From the overview, closes the sheet and reloads the overview in place (§4.2).
- No targets, loads or coach content in the sheet. It answers "which", and the overview answers "what".
- `Past workouts` is the existing history list (Repeat lives there).

### 2.3 Overview after picking (changes only)

```
┌────────────────────────────────────────┐
│ ⌄                     [Main gym ▾]  ⋯  │ ⋯: Save as routine · Empty workout (+ edits items)
│ LAST DONE WED 7 OCT                    │ eyebrow (no UP NEXT: not the recommendation)
│ Shoulders ▾                            │ title is a button (≥ 44 pt), caret text.secondary
│────────────────────────────────────────│
│  ≈ 50 min  │  ≈ 19:00  │     15        │
│ … rows exactly as workout-overview §3  │
```

- Eyebrow: `UP NEXT · LAST DONE MON 5 OCT` when the picked type is the recommendation; `LAST DONE WED 7 OCT` otherwise; existing variants for routines (`AFTER PULL A · THU 8 OCT`, `NEW ROUTINE`).
- `⋯` menu: `Save as routine` (history types, only when the page has no today's edits) · `Empty workout` · `Edit routine` (routines) · `Reorder` / `Reset today's edits` (overview-today-edits). `Other routine` is removed.
- Rows, markers, coach tags, check-in and Start are unchanged.

### 2.4 No-history session (new routine `Arms`, never done)

- Eyebrow `NEW ROUTINE`. Every row is marked `NEW`.
- A load the routine fixes shows as normal. `Auto` loads show `—` (`text.tertiary`) with the routine's sets × reps. The first set card asks for the load (first-run behaviour).
- An exercise in a history type with no comparable session (for example a different bar at this gym) is marked `NEW` with `—`, the same as today.
- `TIME` uses the default pace with `≈`. No extra words.

---

## 3. Session types

### 3.1 Grouping (`deriveSessionTypes`, pure, `packages/domain`)

Input: live routines (list order); finished sessions with `{id, routineId, routineName, startedAt, exerciseCount, importCategories?}`; now; tz.

1. **Routines.** One type per routine. Sessions that `isFromRoutine` count as its history. Named sessions whose normalised name equals the routine's also count (so the routine wins over a duplicate name).
2. **Named.** For sessions with `routineId: null` and a `routineName` other than null or `Workout` (`GENERIC_WORKOUT_NAME`): group by normalised name (trim, collapse spaces, case-fold). Display the most recent spelling.
3. **Category (imports only).** For unnamed imported sessions, use `categoryLabel` (§3.2). Group by its key. If a named group has the same normalised label, the two merge into one type (`Legs` named after SP-D8 joins imported `Legs`).
4. Unnamed sessions logged in the app with no label are **not types**. They stay in `Past workouts`.

Each type has: `key`, `label`, `kind: 'routine' | 'named' | 'category'`, `routineId | null`, `sourceSessionId` (the most recent session in the group, or null), `lastDone: ZonedTimestamp | null`, `exerciseCount` (from the source session or routine), and `older` (last done more than 42 days ago).

### 3.2 Category label (`categoryLabel`, pure)

From the FitNotes `Category` raw cells of a session's **working** sets (`import_rows`, read by the new `imports.categoriesBySession()`):

- If one category has 60% or more of the working sets, the label is that category (`Legs`).
- Else, if the top two each have 25% or more and together 80% or more, the label is both in alphabetical order, joined by ` + ` (`Chest + Triceps`). The key ignores order.
- Else the label is null (a mixed session is not a type).
- Empty category cells are ignored. The text is used exactly as Ben typed it in FitNotes (it is Your data), with only trimming.

### 3.3 Order and recommendation

- `recommendSession(types, routinesInOrder, lastFinished, now)`:
  1. If `nextInRotation` returns `{kind: 'routine'}`, that routine, with its existing basis.
  2. Else, among types that are not `older` and have a `lastDone`, excluding the type of the last finished workout (unless it is the only one): the one with the **oldest** `lastDone`. Basis `{kind: 'longest_gap', lastDone}`.
  3. Else, the single type (`From …`), or null (First workout, unchanged).
- `orderSessionTypes`: recommended first; then active types by `lastDone` ascending (longest gap first); then never-done routines (`New`) in list order; then `OLDER` by `lastDone` descending.

---

## 4. Interactions

### 4.1 Tap counts (check-in not due)

| Path | Taps to first logged set |
|---|---|
| Up next (unchanged) | 3: Start → Start → Log |
| A session in Today's `SESSIONS` | 3: row → Start → Log |
| `Change` → pick | 4: Change → row → Start → Log |
| `All sessions` → pick | 4 |
| On the overview: title → pick | +2 to switch, then Start → Log |

### 4.2 Switching on the overview

- Tap the title (or VoiceOver action "Change session"). The sheet opens with the current row checked.
- Pick → the sheet closes → `services.overview.load(newBasis, gymId)` → the page re-renders in place with no navigation push. The scroll position goes to the top, row panels close, and the Start op ID is cleared (a new one is minted on the next Start).
- Picking the checked row closes the sheet and changes nothing.
- No write and no Undo are involved: switching is navigation. To go back, pick the previous row again. Its edits are still there (SP-D6).
- The gym chip, the check-in score (saved, unlinked until Start, CI4) and the coach state carry over. A What's up? sheet in progress closes first (the picker can't open over it).

### 4.3 Save as routine (history types)

- `⋯` → `Save as routine` → the system rename prompt, pre-filled with the label → `Save`. This calls the Summary's existing save-as-routine command with the type's `sourceSessionId`, the name and an `opId`.
- The page reloads on the new routine basis (eyebrow unchanged). Toast: `Saved as routine` [Undo]. Undo deletes the routine (versioned) and reloads on the history basis.
- It is hidden while the page has today's edits, so a draft is never re-keyed.

### 4.4 Voice (for voice.md, build step 5)

"Legs today" / "switch to shoulders" → opens or switches the overview to the type whose label matches. If no type matches, or more than one does, the picker opens. The command never starts a workout. There are no spoken cues on these screens.

### 4.5 Accessibility

- Rows are ≥ 60 pt and each is one button: "Legs, up next, last done 6 days ago, 5 exercises." Edited rows add "edited today". The checked row adds "selected".
- Title button: "Shoulders. Change session." `Change`: "Change session."
- At AX sizes, the row's second line wraps and the tag moves under the name. Nothing truncates.
- The sheet's `Close`, the VoiceOver escape gesture and a swipe down all close it without a change.

---

## 5. States

| Where | State | Shows |
|---|---|---|
| Today | 0 types (fresh install) | First workout hero. No `Change`, no `SESSIONS` |
| Today | 1 type | Up next with `From …`. No `Change`, no `SESSIONS` |
| Today | 2 or more types | §2.1 |
| Today | Resume / Stale | Unchanged. No `Change`, no `SESSIONS` |
| Today | Done today | Hero unchanged; `SESSIONS` (all types, Up next included first) |
| Picker | Loading | Nothing for 300 ms, then static rows (no shimmer). Local only |
| Picker | Normal / with `OLDER` / with `Edited` / with `New` | §2.2 |
| Picker | Couldn't read | `Couldn't load sessions.` [Try again], plus `Empty workout` |
| Picker | A workout became active meanwhile | The pick returns `session_already_active`: the sheet and overview close, and Today shows Resume |
| Overview | Recommended / picked / new routine | §2.3, §2.4 |
| Overview | Source session deleted or edited while open | The `next` basis key changes. Start creates nothing and shows `Targets updated` (OV4). If the type is gone, `Couldn't load this workout.` with the picker reachable from the title |
| Any | Offline / AI unavailable / coach offline | Identical. Stored D21 targets still show with their `Coach` tag (overview §5) |
| Any | Force-close | No session. Drafts intact. Today shows the recommendation |

Transitions:

```
Today ─Change / All sessions─► Picker ─pick─► Overview(type) ─Start─► Workout
Today ─SESSIONS row─────────────────────────► Overview(type)
Overview ─title─► Picker ─pick─► Overview(new type, in place)   ─Close─► Today (nothing created)
                          └─Close / same row─► Overview(unchanged)
```

---

## 6. Copy

All loads on the overview are **targets** (column header `TARGET`). The picker's `… days ago` and dates are **actuals**. Nothing in this slice is an estimate except the overview's existing `≈`.

| Element | Text |
|---|---|
| Today | `UP NEXT` · `Change` · `SESSIONS` · `All sessions` · basis lines in §2.1 · `4 days ago` |
| Picker | `Choose session` · `Close` · `UP NEXT` · `N exercises` · `Today` / `Yesterday` / `N days ago` (under 14 days) / `14 Aug` · `New` · `Edited` · `OLDER` · `Empty workout` · `Past workouts` · `Couldn't load sessions.` · `Try again` |
| Overview | `UP NEXT · LAST DONE MON 5 OCT` · `LAST DONE WED 7 OCT` · `NEW ROUTINE` · `Shoulders ▾` · `Save as routine` · `Saved as routine` [Undo] |

There are no explanation lines. Why something is Up next is shown by the basis line itself. There are no rule names and no reassurance.

---

## 7. Data needed

**New pure functions (`packages/domain`, unit-tested):** `deriveSessionTypes`, `categoryLabel`, `recommendSession` (wraps `nextInRotation`), `orderSessionTypes`, `formatLastDone` (relative/absolute, tz-aware).

**Persistence:** `imports.categoriesBySession(): Map<sessionId, Record<category, workingSetCount>>` reads `import_rows` raw cells (owner-scoped, Your data). No migration.

**Services:**
- `services.sessions.list()` → `{types (ordered), recommendedKey, basis, editedKeys}`. Local, no AI, never throws (`null` on failure).
- `services.next.preview` → uses `recommendSession`, so Today and Plan (weekly-plan check 18) agree.
- `services.overview.load({kind: 'routine', routineId} | {kind: 'next', sourceSessionId, name})`. `name` is the type label used by Start (SP-D8) and is included in `previewKey`.
- `services.overview.start` is unchanged apart from passing `name`. Existing: `planWithTodayEdits`, `buildWorkoutOverview`, `nextTargetsFor`, `listNextTargets` (D21), `snapPlanToGym`, `previewKey` / `previewFence`, and the save-as-routine command.

**Screens/components:** `SessionPickerSheet`, `SessionPickerRow` (new; design-system follow-up), the Today `SESSIONS` section (replaces the routines section), and the `WorkoutOverviewScreen` title button. Screens format only and never group, order or recommend.

---

## 8. Acceptance checks

Fixture: no routines except `Arms` (never done) and `Full body` (last done 14 Aug). FitNotes import: `Legs` Mon 5 Oct, `Shoulders` Wed 7 Oct, `Back` Thu 8 Oct, `Chest` Fri 9 Oct (each ≥ 60% one Category), plus one mixed session. Today is Sun 11 Oct.

- **SP1.** Today shows Up next `Legs` with `Last done Mon 5 Oct · 6 days ago`, `Change`, and `SESSIONS` Shoulders, Back, Chest, then `All sessions`. Start is the only filled pill.
- **SP2.** The picker lists Legs (`UP NEXT` tag) · Shoulders · Back · Chest · Arms (`New`) · `OLDER` Full body. The mixed session is not a row.
- **SP3.** `categoryLabel` unit tests: 60% single, `Chest + Triceps` in both orders gives one key, mixed gives null, empty cells ignored, Ben's spelling kept.
- **SP4.** Named and category groups with the same normalised label merge. A named session equal to a routine's name counts for the routine. `Workout` never becomes a type.
- **SP5.** `recommendSession`: with ≥ 2 routines and the last workout from one, the result equals `nextInRotation` (D19 checks still pass). Otherwise it is the longest gap among active types, never the type just done (unless it is the only one), and never an `OLDER` type.
- **SP6.** Picking Shoulders from Today opens its overview. The rows equal the pending sets Start creates (OV3 over the `next` basis with Wed 7 Oct as source), loads fitted to this gym, with the eyebrow `LAST DONE WED 7 OCT`.
- **SP7.** With a stored D21 coach target for an exercise in the Shoulders source session, the row shows the `Coach` tag and that target. With none, or coach offline, it shows the built-in target and no coach UI (OV8).
- **SP8.** `Arms`: every row is `NEW`, `Auto` loads show `—`, and Start creates sets with `targetLoad: null` for them.
- **SP9.** On the overview, title → pick Back re-renders in place with no stack push. Close returns to Today with no session.
- **SP10.** Swap an exercise in Shoulders, switch to Back, then switch back: the swap is still there, and the picker shows `Edited` on Shoulders. Starting Back discards the Shoulders draft (TE-A15).
- **SP11.** A check-in score tapped before switching stays selected after the switch and is linked by Start. The gym chip is unchanged by a switch.
- **SP12.** Starting a category type stores `routineName = 'Legs'`. Next time, it groups by name with the imported Legs sessions (one row).
- **SP13.** `Save as routine` creates one routine from the source session (repeated `opId` gives one). The page reloads on the routine basis. Undo removes it. It is hidden while there are today's edits.
- **SP14.** Opening the picker, switching and saving make no provider call, and all of them work in airplane mode with no AI.
- **SP15.** A source session edited while the overview is open makes Start create nothing and shows `Targets updated`.
- **SP16.** All rows and links are ≥ 44 pt (picker rows ≥ 60). `UP NEXT`, `Edited`, `New` and the check are text or icon, never colour alone. At AX3 on 375 pt nothing truncates or scrolls sideways.
- **SP17.** VoiceOver reads the picker rows as in §4.5, and the title exposes "Change session".

---

## 9. For Ben

1. **Imported workouts are grouped by FitNotes Category** (`Legs`, `Chest + Triceps`), because the CSV has no workout names (§0). The alternative is to show only named workouts and routines. Then Ben would need to save `Legs` etc. as routines first, or import the `.fitnotes` backup (deferred).
2. **Up next without a routine rotation = the session with the longest gap since last done** (in the last 42 days), instead of repeating the last workout. This amends D19's fallback. The D19 routine rotation is unchanged.

PM follow-ups (not edited here): today.md / premium-feel §2 (`SESSIONS` replaces `YOUR ROUTINES`, the `Change` link), workout-overview §2.1 and §3.1 (`Other routine` removed, title button), design-system (`SessionPickerSheet`, `SessionPickerRow`), voice.md (§4.4 grammar), weekly-plan check 18 (reads `recommendSession`), and a CHANGELOG entry once Ben decides.
