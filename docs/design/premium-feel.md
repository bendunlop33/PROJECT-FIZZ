# Premium feel pass (Today, Rest, motion, haptics, finish)

Status: v0.1 draft, 10 Oct 2026. Owner: designer. Look: Direction D (Premium), dark.
Inputs: Ben's device screenshots of 10 Oct (Today first run, Today with a workout in progress, Rest, Rest paused with the ⋯ menu), the approved mockups D-Today, D-ActiveSet and D-Rest, and the specs [today.md](today.md), [routines.md](routines.md), [rest-state.md](rest-state.md), [active-workout.md](active-workout.md), [workout-summary.md](workout-summary.md), [onboarding.md](onboarding.md) §4.6 and [design-system.md](design-system.md).

Ben, 10 Oct: *"The app look still wasn't like the original demo in terms of feel."*

This pass changes **feel, not rules**. Logging stays one tap. Nothing here needs network or AI. No new colour values are added, and the one-accent rule holds.

---

## 0. Diagnosis (measured from the screenshots)

The screenshots are 1184 px wide, which is about 393 pt, so 1 pt ≈ 3.0 source px (≈ 2.34 px in the downscaled view). Values are ±1 pt.

| # | Where | Seen on device | Mockup | Verdict |
|---|---|---|---|---|
| D1 | Today, in progress | Hero and `Resume`, then `THIS WEEK` with a ringed Saturday and **`No workouts logged yet this week.`** The bottom ~290 pt (37% of the screen) is empty | Hero, Start, two links, week strip with a count, lift highlight, `Next` row pinned to the bottom | **Bug + emptiness.** `buildTodayView` counts finished sessions only, so an active workout reads as "none". The lift highlight is hidden in the Resume state. There are no routines |
| D2 | Today, first run | A sheet with no content covers Today after `Start workout` | n/a | **Bug, cause not confirmed.** A sheet must never open empty (see §7.1) |
| D3 | Rest | Six blocks: numeral, ±30/Skip, saved line + effort, a 128 pt permission card (`Get an alert when rest ends…` / `Not now` / `Allow`), `Edit the next set`, Log | Numeral, controls, saved + effort, coach card, Log | **Clutter.** The permission card is the biggest thing below the timer |
| D4 | Rest, paused | Amber banner `Workout paused. Timers are stopped.` + header `⏸ Paused · 3:56` + eyebrow `REST · PAUSED` + greyed numeral | n/a | **Paused is said three times.** Keep two signals (header pill, eyebrow) |
| D5 | Rest header | Chevron, `FULL BODY`, `2:09`, pause icon, `⋯` (5 items) | Title, elapsed (D-Rest); title, elapsed, pause (D-ActiveSet) | **Busy.** Move Pause into `⋯` (§3.2) |
| D6 | Rest next line | `Next · Set 2 · 3–6 reps` | `Next · Set 3 · 100 kg × 6–8` | **Missing the target load** |
| D7 | Rest controls | −30 s / +30 s / Skip and effort chips are 46 pt tall | 48 pt | **Under `target.workout` (52 pt).** Use 52 |
| D8 | Secondary link | `Edit the next set` on one screen, `Edit Back squat` on another | none | **Inconsistent.** One fixed label |
| D9 | Everywhere | No press feedback on the primary buttons, instant screen swaps, no change when the rest numeral ticks, no finish moment | Mockups are static; "the original demo" felt alive | **No motion.** §4–§7 |
| D10 | Type | Date label 13/600/+1.4 ✓, hero 40 ✓, rest numeral 88/300 ✓, Log 58 pt tall (token 60), gym chip 32 pt tall (mockup 34) | — | **Mostly right.** Small fixes in §8 |

---

## 1. Purpose

Today answers **"What am I training now, and what will I lift?"** Its single primary action is `Start workout` (or `Resume`).

Rest answers **"How long until my next set, and what is it?"** Its single primary action is `Log <target>`. Everything else gives way.

The finish moment answers **"Is it saved, and how did it go?"** in under a second, without blocking `Done`.

---

## 2. Today

### 2.1 Regions, top to bottom

1. **Header.** `SATURDAY 10 OCTOBER` (`type.sectionLabel` at 13, `text.secondary`) and the gym chip (`Main gym ▾`, 34 pt tall, hit area 44 pt).
2. **Banners** (system-states.md, at most two). Unchanged.
3. **Hero.** One of: Up next, Resume, Stale, Done today, First workout. One primary button.
4. **Hero detail list.** New. Up next: the exercises with their **targets**. Resume: this workout's exercises with progress. At most 5 rows, then `+2 more` (expands in place).
5. **Alternatives row.** At most two text links (§2.4). Hidden while a workout is in progress.
6. **Your routines.** New. Up to 4 rows, then `All routines ›`. Hidden while a workout is in progress and when there are none.
7. **This week.** Week strip + one line. Now shows in-progress and done (§2.5).
8. **Lift highlight.** `BENCH PRESS` / `100 kg × 8  6 Oct · up from 97.5` / sparkline. Now shown in every state except Stale and First workout.
9. **Tab bar.** Unchanged.

The ask pill (today.md region 7) isn't built yet. When it is, the content keeps its bottom inset.

### 2.2 Wireframes (390 pt)

**Up next (a routine, or the next session of the last workout)**

```
┌────────────────────────────────────────┐
│ SATURDAY 10 OCTOBER        ( Main gym ▾)│
│                                        │
│ UP NEXT                                │ eyebrow
│ Push A                                 │ 40/600 hero
│ Chest · shoulders · triceps · 18 sets  │ callout, text.secondary
│ After Pull A on Thu 8 Oct              │ actual (basis)
│                                        │
│ ╭────────────────────────────────────╮ │
│ │           Start workout            │ │ 60 pt pill, accent
│ ╰────────────────────────────────────╯ │
│                                        │
│ Bench press                            │ list row, 44 pt min
│ Target 100 kg × 6–8 · 3 sets           │ text.secondary
│ Incline dumbbell press                 │
│ Target 30 kg each × 8–10 · 3 sets      │
│ Cable fly                              │
│ Target 15 kg × 12–15 · 3 sets          │
│ +2 more                                │ text link, expands
│                                        │
│ Empty workout     Past workouts        │ ≤ 2 links, underlined
│ ────────────────────────────────────── │
│ YOUR ROUTINES                          │
│ Push A        5 exercises · 6 Oct    › │ rows ≥ 52 pt
│ Pull A        6 exercises · 8 Oct    › │
│ Legs A        5 exercises · 3 Oct    › │
│ ────────────────────────────────────── │
│ THIS WEEK                              │
│  M   T   W   T   F   S   S             │
│  ●   ○   ●       ●   ◉                 │ ● done  ◉ today
│ 3 workouts this week                   │
│                                        │
│ BENCH PRESS                            │
│ 100 kg × 8   6 Oct · up from 97.5      │
│ ╱‾‾‾‾╲___╱‾‾‾‾‾‾‾‾                     │ sparkline 40 pt
├────────────────────────────────────────┤
│   TODAY        PROGRESS       PROFILE  │
└────────────────────────────────────────┘
```

**Resume (fixes D1)**

```
│ SATURDAY 10 OCTOBER        ( Main gym ▾)│
│ IN PROGRESS · STARTED 16:22            │
│ Full body                              │
│ Bench press · set 2 of 3               │
│ 1 of 6 sets done · Rest 1:50 left      │ live, tabular
│ ╭────────────────────────────────────╮ │
│ │               Resume               │ │
│ ╰────────────────────────────────────╯ │
│ ✓ Back squat              3 of 3 sets  │ done (status.done icon + words)
│ ▸ Bench press             1 of 3 sets  │ now (accent marker)
│ ○ Barbell row             0 of 3 sets  │ pending (text.tertiary icon)
│ ────────────────────────────────────── │
│ THIS WEEK                              │
│  M   T   W   T   F   S   S             │
│                      ◐                 │ ◐ in progress (today)
│ Full body in progress                  │ never "No workouts logged"
│                                        │
│ BENCH PRESS                            │
│ 60 kg × 8   3 Oct · up from 57.5       │
```

**First workout (no history, no routines)**

```
│ TODAY                                  │
│ First workout                          │
│ ╭────────────────────────────────────╮ │
│ │           Start workout            │ │
│ ╰────────────────────────────────────╯ │
│ ────────────────────────────────────── │
│ THIS WEEK                              │
│  M   T   W   T   F   S   S             │
│                      ○                 │
│ No workouts yet this week.             │
```

**Done today**: the hero is `DONE TODAY` / `Full body` / `42 min · 6 sets`, then the secondary button `View summary`. Under it are the routines, This week and the lift. Starting a second workout uses a routine row or `Empty workout`. The Up next preview isn't shown, because it would compete with `View summary`.

### 2.3 Hero detail list (region 4)

- **Up next rows** come from the preview's per-exercise lines, which are already snapped to this gym's loads. Each row has the name (`type.body`) and, under it, `Target … · N sets` (`type.callout`, `text.secondary`). These values are **targets**, so the word `Target` is always there. Rows aren't tappable in this pass.
- **Resume rows** use one line per exercise: a status icon (§7 of design-system: `checkmark.circle.fill` done / `arrowtriangle.right.fill` now / `circle` pending / `slash.circle` skipped), the name, and `N of M sets` (tabular). Tapping a row resumes the workout on that exercise (`set_active_set` on its first unlogged set), then opens Workout.
- At most 5 rows. `+2 more` expands the list in place (`motion.listEnter`). At AX1+, rows stack and the cap drops to 3.

### 2.4 Alternatives row (region 5)

Up to two underlined links (`component.linkAffordance: underline`), `type.callout`, each with a 44 pt hit area:

| State | Links |
|---|---|
| Up next | `Empty workout` · `Past workouts` |
| First workout | none |
| Done today | `Empty workout` |
| Resume / Stale | none |

`Save as routine` lives on the Summary and the routine sheet, not here (§2.6).

### 2.5 This week (region 7). Fixes the bug in D1

Domain change in `buildTodayView` (`packages/domain/src/session/today.ts`):

- `TodayInput` gains `activeLocalDate: string | null`: the local date the active session started on.
- `WeekDay` gains `inProgress: boolean`. A day can be `trained`, `inProgress`, both (a finished workout and an active one), or neither.
- `week.text` becomes:

| Finished this week | Active now | Text |
|---|---|---|
| 0 | no | `No workouts yet this week.` |
| 0 | yes | `<title> in progress` |
| n ≥ 1 | no | `1 workout this week` / `n workouts this week` |
| n ≥ 1 | yes | `n done · <title> in progress` |

The unit test in `summary-today.test.ts` that expects `No workouts logged yet this week.` changes to the new text.

Dots (10 pt): done = filled `accent`; in progress = a 1.5 pt `accent` ring with a 4 pt `accent` centre; today with nothing = a 1.5 pt `accent` ring; other days = nothing. The today letter is `text.primary`, the others `text.tertiary`. Colour is never the only signal: the line under the strip says it in words, and VoiceOver reads the strip as `This week: 2 days trained, today in progress`.

### 2.6 Routines and named workouts

**Model.** This uses the existing `Routine` schema (`packages/schemas/src/routine.ts`) and `RoutineRepository` (in-memory and SQLite already exist). One field is added:

- `createdFromSessionId: Id | null` (optional in the schema, so old backups still parse).

Routines are **Your data** (CLAUDE.md rule 10). They're included in backup and restore with the other routines.

**Save as routine.** This is available from:
- the Summary (a text link `Save as routine` under the title line, shown when the workout didn't come from a routine), and
- the Repeat screen (already specified in routines.md §4.6).

It opens a half sheet:

```
┌────────────────────────────────────────┐
│ Save as routine                        │ title2
│ Name                                   │ label
│ ┌────────────────────────────────────┐ │
│ │ Full body                          │ │ prefilled with the workout name
│ └────────────────────────────────────┘ │
│ 3 exercises · 9 sets. Targets start    │ callout, text.secondary
│ from what you did today.               │
│ ╭────────────────────────────────────╮ │ sits above the keyboard
│ │            Save routine            │ │
│ ╰────────────────────────────────────╯ │
└────────────────────────────────────────┘
```

- The keyboard opens with the name selected. `Save routine` stays above the keyboard (`KeyboardAvoidingView`); Return also saves.
- The routine is built by `routineFromSession` (extracted from the routine-building half of `startFromSession` in `repeat.ts`). It skips deleted and skipped sets and warm-up-only exercises, and keeps set types, rep ranges, rest and supersets. Loads come from the actuals.
- An empty name, or one longer than 120 characters, disables `Save routine` and shows `Give it a name` / `Keep it under 120 characters`.
- A duplicate name is allowed, with the note `You already have a routine called Push A.` (no block).
- After saving: toast `Saved routine Push A` [Undo], `timing.undoToast`. Undo deletes the routine (versioned, op ID).
- Saving doesn't change the finished workout.

**Start a routine with next-session targets.** Tapping a routine row opens the **routine sheet**:

```
│ Push A                             ⋯   │ ⋯: Rename · Delete
│ Last done Thu 8 Oct at Main Gym        │ actual
│ Bench press                            │
│ Target 100 kg × 6–8 · 3 sets           │ targets, snapped to this gym
│ …                                      │
│ Targets from the built-in rule.        │ SourceTag line (or Coach when
│                                        │ the coach set next time)
│ ╭────────────────────────────────────╮ │
│ │         Start this routine         │ │
│ ╰────────────────────────────────────╯ │
```

- Structure comes from the **routine**. Loads and reps come from the next targets of the routine's most recent finished session (`routineId = r.id`, otherwise `createdFromSessionId`), using the same `nextTargetsOf` as Today's next-session preview. Exercises with no comparable history keep the routine's own templates.
- Everything is snapped and bounded by the selected gym's equipment, as `startFromSession` already does. Rounding notes show as `NoteLine`s above the Start button.
- The new session gets `routineId = r.id` and `routineName = r.name`.
- Start goes through the check-in gate and the notification ask (§3.5), as Today's Start does.
- Adding or skipping an exercise during the workout **never** changes the routine. Updating a routine from a workout is a later pass (routines.md editor).

**Up next with routines (rotation by last session, D19, simplified).** With 2 or more routines, Up next is the routine **after** the one most recently finished, in list order (it wraps round). If the most recent workout wasn't from a routine, Up next stays as today: that workout's next session. The basis line is `After Pull A on Thu 8 Oct`. With 1 routine it is `Your only routine`.

**Routine list order** is creation order in this pass. Reordering comes with the routine editor.

**Rename and delete.**
- Routine: `⋯` → `Rename` (same sheet, title `Rename routine`, button `Save name`) or `Delete` (iOS confirm: `Delete Push A?` [Cancel] [Delete]). After deleting: toast `Deleted Push A` [Undo].
- **Named workouts.** A workout's name is shown on Today, the workout header and the Summary. New command `rename_session { name, opId, expectedVersion }` (discriminated union in `packages/schemas/src/commands.ts`). Allowed while the workout is active and after it finishes (versioned, original kept in history). It is reachable from Workout `⋯` → `Rename workout` and by tapping the Summary title (pencil icon, 44 pt). A routine's name is copied into the session at start, so renaming a session never renames the routine.

---

## 3. Rest screen, decluttered

### 3.1 Regions, top to bottom

1. **Header** (fixed): chevron-down (closes to Today), `FULL BODY` (`type.sectionLabel`, `text.secondary`), elapsed `26:05` (`type.callout`, `text.secondary`, tabular), the alerts-off glyph if needed (§3.5), and `⋯`.
2. **Timer block**: `REST` eyebrow, numeral (`type.timerDisplay`, 88/300), next line.
3. **Rest controls**: `−30 s` · `+30 s` · `Skip`, outline pills, **52 pt** tall (D7).
4. **Saved + effort** (ruled section): `Set 1 saved · 60 kg × 8`, `EFFORT`, chips 6–10 at **52 pt**.
5. **Coach slot** (§3.4). It takes no space when empty.
6. **Flexible space.**
7. **One secondary link**: `Edit next set` (§3.3).
8. **Action bar** (fixed, on canvas): `Log 60 kg × 6`, a 60 pt pill. The `Talk` button (D-Rest's mic) appears to its left only once voice is built (Phase 5). Never show a control that does nothing.

```
┌────────────────────────────────────────┐
│ ⌄  FULL BODY              2:09     ⋯   │
│                                        │
│                 REST                   │
│                1:21                    │ 88/300, tabular
│     Next · Set 2 · 60 kg × 3–6         │ target (D6)
│                                        │
│ (  −30 s  ) (  +30 s  ) (   Skip   )   │ 52 pt
│ ────────────────────────────────────── │
│ Set 1 saved · 60 kg × 8                │ actual
│ EFFORT                                 │
│ ( 6 ) ( 7 ) ( 8 ) ( 9 ) ( 10 )         │ 52 pt, selected = ✓ + fill
│                                        │
│ ┌────────────────────────────────────┐ │ coach slot (only when the coach
│ │ COACH …                            │ │ card has something to say)
│ └────────────────────────────────────┘ │
│                                        │
│ Edit next set                          │ the only secondary link
│ ╭────────────────────────────────────╮ │
│ │           Log 60 kg × 6            │ │ 60 pt
│ ╰────────────────────────────────────╯ │
└────────────────────────────────────────┘
```

**Removed from Rest:** the permission card (moved, §3.5), the paused banner (§3.2), the header pause icon (§3.2), and any second text link. Banners from system-states.md don't show on the workout screen during rest unless they're `danger` level (a write failed). Everything else waits for Today.

### 3.2 Paused

- The header shows the `StatusPill` `⏸ Paused · 3:56` (`pause.circle.fill`, `status.warning`, plus the word). The eyebrow reads `REST · PAUSED` in `status.warning`. The numeral turns `text.tertiary`. The primary button becomes `Resume`.
- **No banner.** That's two signals with words, which is enough.
- **Pause moves into `⋯`.** The action sheet becomes `Pause workout` (or `Resume workout`) · `Rename workout` · `Finish workout` · `Edit workout times` · `Discard workout` (destructive) · `Cancel`. Pause isn't part of the logging loop. When paused, Resume is the one-tap primary.

### 3.3 One secondary link

`Edit next set` opens the folded set editor (the existing `showNextSet` path). The label is fixed. It never names the exercise (D8), and the next exercise's name is already in the next line. With no next set (all done), the link is hidden.

### 3.4 Coach slot

- `CoachSlot` is a `View` the coach-card work fills. It sits between effort and the flexible space, with `space.5` above it. It renders **nothing** (0 height, no margin) when there's no card.
- Its card style is fixed now so it matches D-Rest: `bg.surface`, `radius.lg` (20), padding `space.4`, `COACH` eyebrow, body at 16/22, buttons as 44 pt pills (outline secondary + accent primary).
- It is never full screen and never covers the Log bar. It enters with `motion.listEnter` and leaves with a 150 ms fade.
- At most one card shows at a time. If the coach is unavailable, nothing shows here: the honest status lives in the coach's own surfaces, not as a canned card.

### 3.5 Notification permission: asked on the first Start, not on Rest

**Change from rest-state.md §3 and onboarding.md §4.6.** It's still asked in context and still never in onboarding, but now on the **first `Start workout`** (any start: Today hero, routine sheet, Repeat, Past workouts) while the permission is `undetermined` and not yet answered in-app.

```
┌────────────────────────────────────────┐
│ Rest alerts                            │ title2
│ Get an alert when rest ends while your │ body
│ phone is locked?                       │
│ ╭────────────────────────────────────╮ │
│ │               Allow                │ │ → iOS prompt, then continue Start
│ ╰────────────────────────────────────╯ │
│               Not now                  │ text button, continues Start
└────────────────────────────────────────┘
```

- This is a half sheet shown **before** the check-in sheet. Either answer continues the same Start (same op ID), so Start is still one decision away. The first-Start ask happens once in the app's life, so later Starts stay one tap.
- `Not now` stores `alertsAsk: 'later'`. The sheet never appears again on Start. Profile → Voice & alerts keeps `Allow`.
- **Honest status on Rest when alerts are off** (denied, or `Not now`): a `bell.slash` glyph (`text.secondary`, 44 pt hit area) sits beside the elapsed time in the header. Tapping acts on the permission without leaving the workout (as built, review S6; Ben to confirm): denied → iOS Settings (iOS can't ask again); `Not now` (iOS hasn't asked) → the iOS prompt, and an allowed alert is scheduled for the running rest. VoiceOver says which: `Rest alerts are off. Opens iOS Settings.` / `Rest alerts are off. Asks to allow them.` It isn't a card, a banner or a link row.
- rest-state.md's `Notifications not allowed` row and onboarding.md §4.6's `Asked when` cell need updating to point here (designer follow-up; Ben approves).

### 3.6 Next line copy (D6)

`Next · Set <n> · <target>`, where the target is the planned load and reps of the next set, for example `60 kg × 3–6` or `30 kg each × 8–10`. With no load target: `Next · Set 2 · 8–10 reps`. For the next exercise: `Next · Incline dumbbell press · 30 kg each × 8–10`. VoiceOver: `Next set target: 60 kilograms, 3 to 6 reps.` The word "Next" marks it as a target on screen, and VoiceOver says "target".

---

## 4. Motion

Principle 5 in design-system.md ("Motion stays quiet… at most 200 ms") **still holds**, with the three marked exceptions below. **Ben approves these before they're merged into design-system.md §6.** Every motion runs on the UI thread through React Native's `Animated` with the native driver (as built; chosen over Reanimated to keep worklet risk off the logging screen after the build-83 How to crash). It never delays a write, and the write never waits for an animation.

### 4.1 Proposed tokens (to merge into design-system.md §6 and `theme/tokens.ts` `MOTION`)

| Token | Value | Use |
|---|---|---|
| `motion.pressIn` | 80 ms, ease-out | Press-down of any pressable |
| `motion.pressOut` | 160 ms, ease-out | Release |
| `motion.pressScale.primary` | 0.97 | `PrimaryButton` (Log, Start, Resume, Finish, Done) |
| `motion.pressScale.pill` | 0.95 | Outline pills, chips (±30 s, Skip, effort) |
| `motion.pressOpacity.text` | 0.55 | Text links and icon buttons (no scale) |
| `motion.swap` | 180 ms, ease-in-out | Ready ↔ Rest swap inside Workout: cross-fade, incoming block rises 8 pt |
| `motion.listEnter` | 160 ms fade + 6 pt rise, stagger 35 ms, at most 6 items | New set row, preview rows, coach card, Summary rows |
| `motion.digit` | 140 ms opacity cross-fade per changed glyph | Rest numeral, Today's live `Rest 1:50 left` |
| `motion.screenFade` | 200 ms | Workout → Summary replace |
| `motion.finish` | 420 ms check stroke + 200 ms title fade (120 ms delay). **Exception 1:** over 200 ms, once per workout | Summary entry (§6) |
| `motion.restRing` | Linear to the deadline. **Exception 2:** off by default (§4.4) | Optional ring |
| `motion.recordPulse` | 1 → 1.06 → 1 scale on the record line icon, 300 ms, once. **Exception 3** | Heaviest-set line (§5) |

### 4.2 Screen transitions (native-stack options)

| From → to | Animation | Reduce Motion |
|---|---|---|
| Today → Workout | `fullScreenModal`, slide from bottom (system) | `fade` |
| Workout → Today (chevron) | slide down (system dismiss) | `fade` |
| Workout → Summary | `replace` with `motion.screenFade` (no back navigation) | `fade` (the same, since fades are allowed) |
| Summary → Today (`Done`) | dismiss, slide down | `fade` |
| Today → routine sheet, Save as routine, permission sheet | system sheet (`timing.sheet`) | system |
| Push screens (Profile, Past workouts) | system push | system (iOS handles it) |

### 4.3 In-screen motion

- **Pressables.** One `Pressable` wrapper (`ui/Pressable.tsx`, replacing ad-hoc `opacity: pressed ? 0.6 : 1`) applies `motion.press*` by kind: `primary`, `pill`, `text`, `row` (row = `bg.surface` highlight, no scale). The pressed fill colour (`accent.pressed`, `bg.surface`) still changes, so feedback isn't motion only. It is disabled while `busy` or during `timing.commitGuard`.
- **Log → Rest.** After a successful log: `haptic.commit` → the Log label becomes `Saved` (existing guard) → the editor cross-fades into the rest block (`motion.swap`). The new done row in the set list enters with `motion.listEnter`.
- **Rest end → Ready.** At the deadline (foreground): `haptic.restEnd` → `REST` becomes `READY` with a digit cross-fade to `0:00` → after 600 ms, `motion.swap` to the set editor. Skip uses the same swap with no haptic delay.
- **Countdown numeral.** It still updates once a second (design-system §6). Only glyphs that changed cross-fade (`motion.digit`), so `1:21 → 1:20` animates one digit. Tabular numerals mean no glyph moves sideways, so principle 2 ("numbers never move") holds. ±30 s changes cross-fade the whole numeral once. There's no tick sound and no colour change in the last 10 s.
- **Lists.** Rows animate only when they're **added after the first draw** (a logged set, `+2 more`, a coach card). They never animate on screen entry, refresh or scroll. Reordering isn't animated (no `LinearTransition` without Reanimated).
- **Loading.** No shimmer (unchanged). Placeholders follow `timing.placeholderDelay`.
- **Not animated:** charts, sparklines, numbers in rows and totals (no count-up), the week strip, banners, tab switches.

### 4.4 Countdown ring: optional, off by default

D-Rest (approved) has no ring, and design-system §6 says "never shows a progress ring". The ring is **not shown by default**. To let Ben compare on his phone, it's built behind `Profile → Developer → Rest ring` (default off):

- A 3 pt stroke, diameter `min(264, screenWidth − 2 × 40)`, centred on the numeral. The track is `border.divider` and the remaining arc is `text.secondary` (never `accent` or a status colour). It depletes clockwise from 12 o'clock.
- It is animated continuously from the stored deadline on the UI thread. After ±30 s it re-targets over 250 ms. When paused it freezes.
- With Reduce Motion it steps once per second with no interpolation.
- It's decorative: `accessibilityElementsHidden`. The numeral carries the meaning.
- If Ben keeps it on, design-system principle 5 and §6 get updated. Otherwise the flag and code are removed.

### 4.5 Reduce Motion

Read from the existing `theme.a11y.reduceMotion` (the ThemeProvider listens for changes). A change applies at once, mid-animation included.

| Motion | Reduce Motion on |
|---|---|
| Press scale | No scale; opacity and colour only |
| `motion.swap` | 150 ms cross-fade, no rise |
| `motion.listEnter` | Appears at once (no fade, no stagger) |
| `motion.digit` | Instant swap |
| Screen slides | `fade` (table §4.2) |
| `motion.finish` | Static check, title appears at once |
| `motion.recordPulse` | None |
| Rest ring (if on) | Steps once per second |
| Haptics | Unchanged (they aren't motion) |

---

## 5. Haptics map

All haptics go through `haptic(token)` (`apps/mobile/src/device/haptics.ts`). They are never awaited and never block a write. Each has its own switch in Profile → Voice & alerts (design-system §6). They fire **after** the local write succeeds, never on press-in.

| Moment | Token | Feedback (expo-haptics) | Status |
|---|---|---|---|
| Set logged | `haptic.commit` | `notificationAsync(Success)` | exists |
| Undo (log, routine, rename) | `haptic.undo` | `impactAsync(Light)` | exists |
| Stepper, keypad, effort chip, ±30 s | `haptic.step` | `selectionAsync()` | exists; add to effort and ±30 s |
| Skip rest | `haptic.undo` | `impactAsync(Light)` | new use |
| Rest end (foreground, once per timer) | `haptic.restEnd` | `notificationAsync(Warning)` | exists |
| Heaviest set (§5.1) | `haptic.record` **(new)** | `impactAsync(Medium)`, then `impactAsync(Light)` 90 ms later | new |
| Workout finished (Summary shown after commit) | `haptic.finish` **(new)** | `notificationAsync(Success)` | new |
| Errors (write failed) | none | — | haptics never signal failure alone |

A log that is also a record plays **only** `haptic.record`, not both. The finish haptic never plays for discard.

### 5.1 Heaviest-set line (the only "PR" in the app)

> **Superseded (Ben, 26 Oct 2026, one definition of best).** The line under a just-logged set, the live table's `PB` mark and the Summary all use the Summary's `New best` rule (`liveNewBestLine` / `liveNewBestSets` / `sessionNewBests`): tracked lifts at their tracked reps, real sets only. The line reads `New best · Bench press 102.5 × 8` and plays `haptic.pb`; the Summary no longer shows the separate heaviest-set / most-reps sentences. `findSetRecord` stays for the services that still read it; the rules below are history.

- New pure function `findSetRecord(set, history)` in `packages/domain` (unit-tested). A set qualifies only if:
  - it's a completed working, top or back-off set (not warm-up or drop) on a weighted exercise in reps (the same eligibility as `buildLiftHighlight`);
  - it's **comparable** (workout-summary.md §3 rule): same exercise, equipment instance, load convention, unit and set type group;
  - there are **at least 3 earlier finished, logged sessions** with comparable sets. This stops early weeks from making every set a "record";
  - its load is strictly heavier than every comparable earlier set (`kind: 'heaviest'`), **or** it's equal to the heaviest with more reps than ever at that load (`kind: 'most_reps_at_load'`);
  - no imported set of the same exercise (any equipment) is heavier. If one is, it's suppressed: imported history isn't comparable (ADR 0016), but we won't claim a record it might contradict.
- Copy (on Rest, under the saved line, `type.callout`, `text.primary`, `star` SF Symbol in `text.secondary`):
  - `Heaviest bench press set at Main Gym so far`
  - `Most reps at 100 kg on bench press so far`
- Summary: the same sentences in the Comparison region (workout-summary.md §3 already allows this wording).
- No badge, no colour, no confetti, no estimate. It's never computed from estimated 1RM.

---

## 6. Finish moment

### 6.1 Sequence

1. `Finish workout` in the Finish sheet → `finishWorkout` commits locally.
2. The sheet closes → Workout is **replaced** by Summary (`motion.screenFade`).
3. On the Summary's first draw: `haptic.finish`. The saved banner's `checkmark.circle.fill` draws its stroke (`motion.finish`, 420 ms). Then the title block fades in (200 ms, 120 ms delay). Facts and exercise rows follow with `motion.listEnter` (at most 6 staggered, the rest appear at once).
4. `Done` is visible and tappable **from the first frame**. Animation never gates it, and tapping `Done` mid-animation just leaves.

### 6.2 What it says

```
│ ✓ Workout saved on this phone          │ check draws once
│                                        │
│ Full body                         ✎ ⋯  │ tap ✎ to rename
│ Sat 10 Oct · Main gym · 16:22–17:04    │
│ 42 min · 3 exercises · 9 sets          │ one factual line (actuals)
│ Heaviest bench press set at Main gym   │ only if §5.1 qualifies
│ so far                                 │
│ Save as routine                        │ text link (not from a routine)
│ …rest of Summary unchanged…            │
```

- No confetti, trophies, streaks, scores, "great job" copy, sounds or count-ups. The moment is a check that draws, one haptic and calm facts.
- Spoken cue (when voice cues are on): `Workout saved.` once. No praise.

---

## 7. States (across this pass)

| State | Today | Rest | Summary |
|---|---|---|---|
| Loading (< 300 ms) | Canvas only | n/a (local) | Canvas only |
| Loading (≥ 300 ms) | Static placeholder rows | n/a | Static placeholder rows |
| No history | First workout (§2.2) | — | — |
| Routines exist | Up next + routines | — | `Save as routine` hidden if the workout came from a routine |
| In progress | Resume + list + week ◐ | — | — |
| Resting / Ready / Paused | — | §3.1 / swap §4.3 / §3.2 | — |
| Offline / AI unavailable | Unchanged. Nothing on Today needs AI | Coach slot empty | Unchanged (built-in rule tags) |
| Alerts off | — | `bell.slash` in the header | — |
| Next preview unreadable | Falls back to First workout or Empty-workout hero, never an error | — | — |
| Write failed (save routine, rename) | `⚠ Couldn't save the routine. Try again.` (`StatusLine` warning), sheet stays open | — | — |
| Reduce Motion | §4.5 | §4.5 | §4.5 |

Transitions: First workout → (finish) → Done today → (next day) Up next. Up next → Start → [permission sheet, first time only] → [check-in, if due] → Workout. Rest ↔ Ready (§4.3). Workout → Summary (§6).

### 7.1 Empty-sheet guard (D2)

Any sheet the app opens (check-in, permission, routine, picker) must render its content or static placeholder rows within `timing.placeholderDelay`. Developer: reproduce the first-run Start on a fresh install and find which sheet showed blank, then fix the cause. Don't hide the symptom.

---

## 8. Typography and spacing fixes

| Item | Device now | Change to | Token |
|---|---|---|---|
| Rest controls, effort chips | 46 pt tall | 52 pt | `target.workout` |
| Primary pill | ~58 pt | 60 pt exactly | `target.primary` |
| Gym chip | 32 pt | 34 pt visual, 44 pt hit (hitSlop 5) | `target.min` |
| Hero lines (Today) | 16 pt | keep 16 (mockup 15 is under the 16 pt floor) | `type.callout` |
| Hero eyebrow → title | ~6 pt | 6 pt | `space.1` + 2 |
| Hero lines gap | 8 pt | 4 pt (lines are one paragraph) | `space.1` |
| Hero → primary button | ~28 pt | 24 pt | `space.6` |
| Region gaps (Today) | 24 pt | 26 pt → use 24 (`space.6`), dividers inside ruled sections | `space.6` |
| Rest numeral | 88/300 ✓ | keep; `letterSpacing −2` ✓ | `type.timerDisplay` |
| Rest timer block padding | ~26 pt above `REST` | 26 pt (18 + 8, as D-Rest) | — |
| Next line | 16 pt `text.secondary` | 16 pt; the target values in `text.primary` | `type.callout` |
| Elapsed in header | ~17 pt | 16 pt `text.secondary` | `type.callout` |
| Header icon buttons | chevron, pause, ⋯ | chevron, ⋯ (+ `bell.slash` when off) | `target.min` |
| Selected effort chip | fill only | `✓ 10`, `accent` fill, `on.accent` text | design-system §9 Chip |
| Routine and resume rows | — | ≥ 52 pt, `type.body` name, `type.callout` detail | `target.workout` |
| Lift value | 28/500 | keep (D-Today) | inline in `LiftCard`; add `type.liftValue` 28/34/500 to the design system |

---

## 9. Interactions summary

- **One tap to resume:** `Resume` on Today, or the lock-screen/Live Activity (unchanged).
- **One tap to log a matching set:** `Log 60 kg × 6` on Rest and Ready. Unchanged, and never behind a sheet.
- **One tap to start** after the first-ever Start (the permission sheet shows once). The check-in shows only when due (unchanged).
- **Routines:** tap a row → routine sheet → `Start this routine`. Long-press a row → context menu `Rename` · `Delete`.
- **Undo paths:** save routine, delete routine, rename (routine or workout) → toast [Undo], 8 s (stays with VoiceOver). Log undo is unchanged.
- **Voice:** no new voice commands in this pass. `Workout saved.` is the only new spoken cue.
- **Keyboard:** the rename and save sheets keep their primary button above the keyboard. Return submits.

---

## 10. Copy (exact)

Cut to values, actions and short status words after the CLAUDE.md minimal-copy rule (Ben, 10 Oct; review B3).
Start notices: `Using saved targets.` · `Using last time’s numbers.`

| Key | Text |
|---|---|
| Today eyebrows | `UP NEXT` · `IN PROGRESS · STARTED 16:22` · `DONE TODAY` · `TODAY` · `YOUR ROUTINES` · `THIS WEEK` |
| Up next basis | `After Pull A on Thu 8 Oct` · `Your only routine` · `From Thu 8 Oct` |
| Preview row | `Target 100 kg × 6–8 · 3 sets` |
| Resume row | `3 of 3 sets` |
| More | `+2 more` |
| Routine row | `5 exercises · 6 Oct` (last done) · `5 exercises · not done yet` |
| Links | `Empty workout` · `Past workouts` · `All routines` · `Save as routine` · `Edit next set` |
| Week text | §2.5 |
| Save sheet | `Save as routine` · `Name` · `3 exercises · 9 sets` · `Save routine` · `Give it a name` · `You already have a routine called Push A.` |
| Toasts | `Saved routine Push A` · `Deleted Push A` · `Renamed to Push A` (each with `Undo`) |
| Routine sheet | `Last done Thu 8 Oct at Main gym` · `Rule` tag + `Why?` → `Next targets from the built-in rule` (nothing when the routine's own targets are used) · `Start this routine` |
| Delete confirm | `Delete Push A?` / `Cancel` / `Delete` |
| Rename | `Rename routine` / `Rename workout` · `Save name` |
| Permission sheet | `Rest alerts` · `Alert when rest ends?` · `Allow` · `Not now` |
| Alerts off (VoiceOver) | `Rest alerts are off. Opens iOS Settings.` · `Rest alerts are off. Asks to allow them.` |
| Rest next | `Next · Set 2 · 60 kg × 3–6` · `Next · Incline dumbbell press · 30 kg each × 8–10` |
| Rest end | `READY` |
| Record | `Heaviest bench press set at Main gym so far` · `Most reps at 100 kg on bench press so far` |
| Summary line | `42 min · 3 exercises · 9 sets` |
| Spoken | `Workout saved.` |
| ⋯ menu | `Pause workout` / `Resume workout` · `Rename workout` · `Finish workout` · `Edit workout times` · `Discard workout` · `Cancel` |

---

## 11. Data needed

| Function / service | Change |
|---|---|
| `buildTodayView` (domain) | `activeLocalDate` input; `WeekDay.inProgress`; new week texts |
| `buildLiftHighlight` | unchanged; Today shows it in Resume and Done today too |
| `services.next.preview(gymId)` | unchanged; rows feed §2.3 |
| `buildActiveSetView` | unchanged; Resume rows use `exercises` progress; Rest next line uses the next planned set's target text |
| `routineFromSession` (domain, new, extracted from `startFromSession`) | builds a `Routine` from a finished session |
| `planRoutineStart` (domain, new) | routine structure + `nextTargetsOf(latest routine session)` → session, snapped to the gym |
| `services.routines.list / save / rename / delete / restore / preview(routineId, gymId) / start(routineId, gymId, opId)` | new; versioned, op IDs, Your data |
| `nextInRotation(routines, lastFinished)` (domain, new, pure) | Up next with ≥ 2 routines |
| `rename_session` command (schemas + domain) | new |
| `findSetRecord` (domain, new, pure) | §5.1 |
| `RoutineSchema.createdFromSessionId` | new optional field; backup round-trip test |
| `haptic('record' \| 'finish')` | new tokens in `HAPTICS` |
| `MOTION` tokens in `theme/tokens.ts` | §4.1, after Ben approves |
| alerts ask state (`alertsAsk: 'undetermined' \| 'later' \| 'answered'`) in settings | replaces `askLater` local state on Workout |

---

## 12. Acceptance checks

1. With a workout in progress, Today's week line reads `<title> in progress` (or `n done · <title> in progress`), today's dot is the in-progress style, and `No workouts yet this week.` never shows while a workout is active (domain unit test plus a screen test).
2. Today in the Resume state shows the exercise list with done/now/pending icons **and words**, and the lift highlight. The bottom third of the screen isn't empty at 390 × 844 when there's history.
3. The Up next state lists up to 5 exercises, each line starting with `Target`. The values match what `Start workout` actually creates (same snapped loads).
4. Save as routine from a Summary creates a routine. Its row appears on Today. `Undo` removes it. The finished workout is unchanged (version not bumped).
5. Starting a routine uses its last session's next targets. An exercise added mid-workout to a routine session does **not** appear the next time the routine starts.
6. With 3 routines and Pull A done last, Up next is the routine after Pull A in list order, with `After Pull A on <date>`.
7. Renaming a workout updates Today, the header and the Summary, and the rename is undoable. Renaming never renames the routine.
8. On a fresh install, the first `Start workout` shows the Rest alerts sheet once, before any check-in. Both answers continue to the workout. No permission card ever appears on Rest. A second Start shows no sheet.
9. With alerts denied or `Not now`, Rest shows `bell.slash` in the header with the VoiceOver label in §10; the tap opens iOS Settings when denied, or the iOS prompt after `Not now` (§3.5).
10. The Rest screen has at most one text link (`Edit next set`). Paused shows no banner. The header has no pause icon, and `Pause workout` is in `⋯`.
11. The Rest next line includes the target load when the next set has one.
12. −30 s, +30 s, Skip and the effort chips measure ≥ 52 pt tall. Log measures 60 pt.
13. The primary button scales to 0.97 on press with Reduce Motion off, and doesn't scale with it on. Its pressed colour changes in both cases.
14. The rest numeral updates once per second. Only changed digits fade, and with Reduce Motion on they swap instantly. No digit shifts sideways (tabular).
15. No ring shows by default. With `Developer → Rest ring` on, it depletes to the deadline, freezes when paused, and steps per second under Reduce Motion.
16. Logging a set fires one success haptic after the write. A record fires the record haptic instead. Rest end fires once per timer. Finish fires once, and never on discard.
17. A record line appears only after ≥ 3 earlier comparable sessions, never for warm-ups, never when an imported set was heavier, and never from an estimate (`findSetRecord` unit tests for each rule).
18. Summary: `Done` is tappable on the first frame. The check draws once (static under Reduce Motion). There's no confetti, sound, score or count-up.
19. No animation delays a write. Kill the app 100 ms after tapping Log and the set is saved.
20. No sheet ever renders blank. The first-run Start on a fresh install shows content or placeholders within 300 ms.
21. `npm run check` passes. No new colour values, and every new token is listed in design-system.md before it's used.

---

## 13. Open items for Ben

1. **Motion exceptions** (§4.1: the finish check over 200 ms, the record pulse, the optional ring). They're needed for the "feel" but amend design-system principle 5.
2. **Permission timing** moves from the first rest to the first Start (§3.5). This amends rest-state.md and onboarding.md §4.6.
3. **Pause** moves from the header into `⋯` (§3.2).
4. **Record rule:** "≥ 3 earlier comparable sessions" is a judgement call (§5.1).
5. **Rest ring:** try it on device, then keep it or remove it.
6. **Rename while active (review S5).** As built, `Rename workout` is in `⋯` only for a planned workout (a routine or a named next session). An open-ended (Empty) workout is named after Finish, because a name currently marks a workout as planned and that changes how its last set rests (audit B1). Options: (a) keep "named after Finish"; (b) store a display name separately from the planned marker so Empty workouts can be renamed mid-workout. (b) is a session schema and backup format change, so it waits for Ben's call.
7. **`bell.slash` target (review S6).** Built as an in-place action (iOS Settings when denied, the iOS prompt after `Not now`) rather than opening Voice & alerts (§3.5). Confirm or revert.
8. **Per-haptic switches (§5, design-system §6).** Not built yet; every haptic follows the system setting. A dependency for a later Voice & alerts pass, not part of this one.

### 13.1 Deferred from this pass (as built)

- `Rest ring` developer toggle (§4.4): not built; the ring stays off.
- Spoken `Workout saved.` (§6.2): waits for the voice-cue pipeline (build order step 5); there's no in-app speech yet.
- The ±30 s `haptic.step`, the READY hold (§4.3), the Summary record lines and `motion.recordPulse` are built.
