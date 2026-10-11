# Pre-workout check-in

Status: v0.1 draft, 9 Oct 2026. Feature approved by Ben in brief CHANGELOG v0.9 ("Pre-workout check-in"). Replaces the Today readiness chips (`Normal` / `Tired` / `Sore`) and supersedes proposal P11's wording (flow-first-milestone.md §7). Rules: CLAUDE.md 1 (works offline), 3 (the coach only offers; Adjust applies with Undo), 5 (versioned, idempotent), 6 (no invented scores), 8 (notes and transcripts are data), 9 (pain stops progression; no diagnosis), 10 (Your data). Tokens and components: [design-system.md](design-system.md) (`CheckInScale` §9.54, `CheckInSheet` §9.55, `CheckInLine` §9.56, `timing.checkInReuse` §6).

Related specs: [today.md](today.md) (Start, Resume), [flow-first-milestone.md](flow-first-milestone.md) (state machine, tap counts), [active-workout.md](active-workout.md) (coach slot on the first set card), [coach-adjustments.md](coach-adjustments.md) (offer, Adjust, banner, Undo), [coach-memory.md](coach-memory.md) (pain flags), [voice.md](voice.md) (spoken check-in), [workout-summary.md](workout-summary.md) and [progress.md](progress.md) (showing check-ins), [profile-and-settings.md](profile-and-settings.md) (settings), [weekly-plan.md](weekly-plan.md) (Reschedule, Skip workout).

> **Revision 2026-10-10 (workout overview; [workout-overview.md](workout-overview.md)).** For Up next and routine starts, the check-in now sits on the Workout overview as an optional inline row of five tiles above its `Start workout`, shown only when `shouldAskCheckIn` returns `ask` or `reuse`. A tap saves the score at once (CI4) but **never starts the workout**. Starting without a score records `skipped`. A score at or below the "What's up?" setting opens Step 2 (and 2a/2b) as a sheet over the overview. Its exits return to the overview, apart from `Skip workout`, which closes to Today as before. CI1 and CI3 are unchanged: the session still doesn't exist until Start. **CI2 is amended for this path only** (Ben to confirm). The `CheckInSheet` Step 1 stays for `Empty workout`, Repeat, the builder's `Start now`, voice and the Resume case. At AX1+ the overview's tiles collapse to a `Check-in ›` button that opens Step 1, and choosing a score returns to the overview. Changed: §2.1 (first two entry rows), §3.1 (note), checks 1–3 and 5 (path note).

The check-in is **a record of what Ben said, not a measurement.** Fizz stores it as given and shows it as given. It never turns it into a score, never averages it, never puts it next to lift numbers, and the built-in progression rules ignore it.

---

## 0. Design decisions to confirm with Ben (flagged; also in open-decisions.md)

| # | Decision | Reason / alternative |
|---|---|---|
| CI1 | **The check-in comes before the session exists.** Start → check-in sheet → `startWorkout` (the Start tap's operation ID is carried through). Skip, a score of 4–5, Done or `Train anyway` start the workout | `Skip workout` and `Reschedule` need nothing to be discarded; the session's start time is when Ben actually started; a force-close during the sheet leaves no empty workout behind. Alternative: create the session at Start and show the sheet over Active workout (then `Skip workout` must discard it) |
| CI2 | **A bottom sheet on Start (one extra tap: a score or Skip)** rather than an inline card on the first set card | Ben approved "asks on Start, with Skip". The answer matters most before the first set (pain flags, the lighter-session offer), and the first Log stays clean. **Alternative with zero extra taps:** open the workout at once and put the 1–5 row inline in the first set card; logging the first set counts as "skipped". Cheaper, but it crowds the set card, invites sweaty mis-taps near the steppers, and the pain and illness steps don't fit inline. Recommend the sheet; revisit after two weeks of real use |
| CI3 | **Swipe-down (or the VoiceOver escape gesture) means "not now": back to where Ben was, nothing started.** Anything already saved stays saved. It never starts a workout | iOS convention: dismissing a sheet cancels. Starting a workout should always be a deliberate tap. `Skip` is the one "carry on without it" action |
| CI4 | **The score is saved at the first tap**; reasons and the note update the same record. A check-in that isn't linked to a workout (app closed, swiped away, `Train anyway` later) is **reused** by the next Start within `timing.checkInReuse` (2 h) without asking again | No answer is lost to a force-close, and Ben is never asked twice for the same session |
| CI5 | **The lighter-session offer appears in the first set card's coach slot, in Ready, before any set is logged.** It's visual only (never spoken), and stays until Ben answers, the first exercise's last set is logged, or a set-trigger offer replaces it | Exception to coach-adjustments §2.3 ("offers only while Resting"). That rule protects a lift in progress from interruption; a silent line before the first set doesn't interrupt anything. Alternative: put the offer as a last step in the sheet (one more tap for every low score) |
| CI6 | **`Adjust` on the check-in offer counts as yes** (same as B4 / CA1): the coach's change applies at once to **today's pending sets only**, with Undo. A lighter-session request can't raise anything: `validateCoachProposal` drops every increase (`lighter_no_increase`) | Rule 3 (Ben accepted). Today only, never the routine template (rule 2) |
| CI7 | **Coach offline or unavailable** (a route exists but can't answer): one honest line in the coach slot, `Check-in saved. Coach offline, so today's plan is unchanged.` **Coach not connected** (no route set up): nothing extra | Rule 1: be honest when Ben would expect something. A permanent "not connected" line on every low day would nag |
| CI8 | **`Pain` with no movement chosen sets no pain flag**, but blocks every coach increase in that session (`pain_unspecified`) and the summary asks Ben to choose movements | Rule 9 needs a movement to stop progression on; the session-wide block is the safe direction (CM4) without guessing joints (CM5) |
| CI9 | **Voice: numbers only.** "Feeling great" isn't turned into a 5; Fizz asks for the number. A bare "sore", "stiff" or "tight" asks `Sore like after training, or pain?` (CM6). The tapped chip `Sore (from training)` is explicit and isn't questioned | Rule 6 (don't invent data) and the existing soreness rule |
| CI10 | **What the coach sees:** only **this session's** check-in, during this session (offer, adjustments, coach sheet) and in this session's summary turn, labelled as Ben's own words. It is **not** sent to the weekly review or to other sessions, and nothing computes over check-ins | Ben's brief: "never combined with other metrics". Alternative (needs Ben): send the last 4 weeks of check-ins as raw entries so the coach can notice patterns |
| CI11 | **Progress shows check-ins in their own card**, after `Sets per muscle`: recent entries as given and plain counts. The detail screen has a points-only chart on a fixed 1–5 axis and a table. No average, no line through the points, no overlay on lift charts | A line or an average reads like a recovery score. Counts and raw entries don't |
| CI12 | **Feeling ill:** fixed app text, not a coach reply. Three equal `SecondaryButton`s, no primary, `Train anyway` in the thumb position. Shown once per check-in and never repeated inside the workout | "Gentle, never pushy, no diagnosis" |
| CI13 | **A check-in can be changed or deleted afterwards** (summary, past workout, Progress). Edits are versioned and audited. Changing it never changes a set, an adjustment already applied, or a pain flag | Fixes sweaty mis-taps without rewriting history (rules 2 and 5) |
| CI14 | **Replaces readiness.** Today's readiness chips and `recordReadiness` are withdrawn. The brief's `ReadinessEntry` (§6, "and any sourced wearable metrics") becomes `CheckIn` (self-reported only); wearable data, if it ever arrives, is a separate record (wearables-garmin.md `WellnessObservation`) | One honest self-report, never mixed with device data. Brief §6 and §12 wording change: for the product manager |

---

## 1. Purpose

The check-in answers **"How do I feel before this workout, and should today change because of it?"** Ben answers in one tap; anything more is optional.

Single primary action: **a score from 1 to 5** (one tap, then the workout starts). `Skip` is always one tap away. When Ben opens the follow-up ("What's up?"), its primary is `Done`.

What it may lead to, and nothing else:
- `Pain` → the existing pain-flag flow (choose movements). No diagnosis; the "see a physio or doctor" line.
- `Feeling ill` → a gentle, optional suggestion to rest: `Reschedule` / `Skip workout` / `Train anyway`.
- A low score, or `Tired` / `Poor sleep` → the coach **offers** a lighter session in the workout (`No thanks` / `Adjust`). Nothing changes until `Adjust`. Offline: recorded only.

It never blocks logging, never appears after the first set is logged, and adds no tap when it is turned off or not due today.

---

## 2. Layout

### 2.1 When the check-in is asked

The check-in is shown by one gate, `shouldAskCheckIn`, at every way of starting a workout:

| Entry point | Spec |
|---|---|
| Workout overview `Start workout` (reached from Today's `Start workout`, `Start another workout` and routine rows): **inline row, not the sheet** (10 Oct) | workout-overview.md §2.2 |
| `Start empty workout`, `Start a workout anyway` | today.md §4 |
| `Repeat last workout` → `Start workout` | routines.md |
| Session sheet `Start workout` | weekly-plan.md §2.3 |
| `Start now` on a coach draft (after its pre-start check passes) | workout-builder.md §4 |
| Voice "start my workout" | voice.md §4.3 |
| `Resume` / cold-launch auto-open (P6) of a session with **no set ever logged** and check-in status `pending` | §3 |

| Situation | What happens |
|---|---|
| Check-ins on, today is a check-in day, nothing answered for this start | Sheet (§2.2) |
| An unlinked check-in exists from the last 2 h (`timing.checkInReuse`) | No sheet. The workout starts, the check-in is linked, toast `Check-in 18:02 · 3 of 5` [Change] |
| Check-ins off, or today isn't one of the selected days | No sheet. Start behaves exactly as before (one tap). Session status `not_asked` |
| This session already answered or skipped | Never asked again (Resume, relaunch, P6) |
| Any set has been logged in this session (even if later undone or deleted) | Never asked. **Never mid-workout** |
| Stale unfinished workout (≥ 6 h) | Today's stale card as now; no check-in |

### 2.2 Step 1: score (bottom sheet over Today)

`CheckInSheet` at its compact detent. Today is dimmed behind `color.scrim`. The score row sits in the bottom 40% of the screen (thumb zone).

```
┌────────────────────────────────────────┐
│ Thu 8 Oct                [⌂ Main Gym ▾]│ Today, behind the scrim
│░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│
│░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│
├────────────────────────────────────────┤
│                 ───                    │ grabber
│ How are you feeling today?        [⚙]  │ type.title2 · settings 44×44
│ Before Push A. Saved with this         │ type.callout, text.secondary
│ workout. Nothing changes unless you    │
│ say so.                                │
│                                        │
│ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐│ CheckInScale
│ │  1  │ │  2  │ │  3  │ │  4  │ │  5  ││ 5 buttons, ≥ 62 × 64 at 375pt
│ └─────┘ └─────┘ └─────┘ └─────┘ └─────┘│
│ 1 = rough                   5 = great  │ type.label, text.secondary
│                                        │
│ ┌──────┐ ┌───────────────────────────┐ │
│ │  🎙  │ │           Skip            │ │ TalkButton 52 · SecondaryButton
│ │ Talk │ │                           │ │
│ └──────┘ └───────────────────────────┘ │
└────────────────────────────────────────┘
```

- No `PrimaryButton` on this step: the five score buttons are the action, and none is accent-filled (accent stays for Today's Start, which is now behind the scrim, and for Log).
- `Talk` is hidden when voice input isn't available; `Skip` then spans the full width.
- No second line under the title (minimal UI copy, CLAUDE.md 10 Oct 2026; review workout-overview r2 N2).
- Resume case (§3): the same sheet over Active workout.

### 2.3 Step 2: What's up? (score at or below the "What's up?" setting; default 3 or lower)

The same sheet grows to its medium detent; content swaps in place (no new sheet).

```
├────────────────────────────────────────┤
│                 ───                    │
│ ‹ 3 of 5                               │ back: change the score (44pt)
│ What's up?                             │ type.title2
│                                        │
│ [ Tired ]  [ Poor sleep ]              │ ParamChip, multi-select, 52pt
│ [ Sore (from training) ]  [ Stressed ] │
│ [ Feeling ill ]  [ Pain ]  [ Other… ]  │
│ ⚠ Next you'll choose which movements   │ only when Pain is selected
│   hurt.                                │ (NoteLine, info.circle)
│                                        │
│ Note (optional)                        │ type.label
│ ┌────────────────────────────────────┐ │ 52pt, grows to 3 lines
│ │ Anything else?                     │ │ bg.raised, border.control
│ └────────────────────────────────────┘ │
│ Skip                                   │ text button, above-left of bar
├────────────────────────────────────────┤
│ ┌──────┐ ┌───────────────────────────┐ │
│ │  🎙  │ │           Done            │ │ TalkButton · PrimaryButton
│ └──────┘ └───────────────────────────┘ │
└────────────────────────────────────────┘
```

- Selected chips use the `ParamChip` selected state (`accent.subtle` fill **and** a `checkmark` before the word).
- `Other…` selects the chip and puts focus in the note field (placeholder becomes `What else?`).
- With the keyboard open, the sheet goes to its large detent and the bottom bar (`Talk`, `Done`) sits directly on top of the keyboard. `Skip` moves into the bar's leading edge (text button) so nothing is hidden.
- At AX1+ the chips go one per row and the sheet opens at the large detent; the bar stays fixed.

### 2.4 Step 2a: Which movements hurt? (only when `Pain` was selected)

Pushed inside the sheet (large detent). Content and copy are coach-memory.md §2.6 (`Add pain flag`), with today's exercises first.

```
├────────────────────────────────────────┤
│ ‹ What's up?                           │
│ Which movements hurt?  ⓘ               │ type.title2; ⓘ → `Flagged movements don't go up until you clear the flag.`
│ In Push A                              │ type.label
│ [ Bench press ] [ Overhead press ]     │ ParamChip, multi-select, none
│ [ Incline DB press ] [ Lateral raise ] │ preselected
│ ┌────────────────────────────────────┐ │
│ │ 🔍 Search exercises                │ │ SearchField
│ └────────────────────────────────────┘ │
│ Where? (optional)                      │
│ [Shoulder] [Elbow] [Wrist] [Back] …    │
│ If pain is sharp, keeps coming back or │ type.callout, text.secondary
│ doesn't settle, see a physio or        │
│ doctor. The coach can't diagnose.      │
│ Stop and get medical help now if you   │
│ have chest pain, feel faint or have    │
│ sudden severe pain.                    │
│ Not now                                │ text button, above-left
├────────────────────────────────────────┤
│ [ 🎙 ] [       Flag 1 movement       ] │ PrimaryButton
└────────────────────────────────────────┘
```

- With nothing selected the primary is disabled and reads `Choose a movement`.
- An empty workout has no `In Push A` row; `Recent` (coach-memory §2.6) comes first.
- `Not now` sets no flag (CI8) and continues.

### 2.5 Step 2b: Feeling ill (only when `Feeling ill` was selected; after the pain step if both)

```
├────────────────────────────────────────┤
│ Rest today?                            │ type.title2
│                                        │
│ ┌────────────────────────────────────┐ │
│ │            Reschedule              │ │ SecondaryButton, 52pt
│ └────────────────────────────────────┘ │
│ ┌────────────────────────────────────┐ │
│ │           Skip workout             │ │ SecondaryButton
│ └────────────────────────────────────┘ │
│ ┌────────────────────────────────────┐ │
│ │           Train anyway             │ │ SecondaryButton (thumb zone)
│ └────────────────────────────────────┘ │
└────────────────────────────────────────┘
```

- No `PrimaryButton`, no icon, no warning colour: the three choices are equal.
- `Reschedule` is shown only when today has a planned session and the weekly plan (Phase A) exists; otherwise it is hidden, not disabled.
- No medical wording beyond the title. The app doesn't say what Ben might have.

### 2.6 After the sheet: the first set card

The sheet closes and Active workout opens as normal (Ready on the first set). Two optional things may appear; both sit where the spec already puts them, and neither covers `Log`.

```
┌────────────────────────────────────────┐
│ ⌄  Push A           0:12     ⏸    ⋯   │
│ [⌂ Main Gym ▾] [🔈 Cues ▾] [Focus|All] │
├────────────────────────────────────────┤
│ Bench press             Adjust  ⋯      │
│ Barbell · Warm-up · Set 1 of 6         │
│ Last (1 Oct): 60 kg × 8                │
│  Load                    Reps          │
│ ┌──┬────────────┬──┐ ┌──┬───────┬──┐   │
│ │− │   60 kg    │+ │ │− │   8   │+ │   │
│ └──┴────────────┴──┘ └──┴───────┴──┘   │
│  Target 60 kg · 8 reps                 │
│  Rest after: 1:00 ›                    │
│ Want a lighter session today?          │ coach slot: CoachOfferLine (CI5)
│ You said 2 of 5 · Tired, Poor sleep    │ fact: the check-in as given
│ [ No thanks ]              [ Adjust ]  │ 52pt hit areas, ≥ space.8 apart
│                                        │
│ ▶ 1  now                               │
│ ○ 2  Target 80 kg × 5  …               │
├────────────────────────────────────────┤
│ ✓ Check-in saved · 2 of 5   [ Change ] │ UndoToast slot (8 s)
│ ┌──────┐ ┌───────────────────────────┐ │
│ │  🎙  │ │       Log 60 kg × 8       │ │ action bar, unchanged
│ └──────┘ └───────────────────────────┘ │
└────────────────────────────────────────┘
```

- **Toast** (every answered check-in): `✓ Check-in saved · 2 of 5` [Change]. If a pain flag was set, the pain toast wins the slot instead: `Pain noted for Overhead press` [Undo] (coach-memory §4.5).
- **Coach slot** (only when the offer conditions in §4.4 hold): the offer line. Offline: the outcome line from CI7. Otherwise empty.
- `PainFlagNote` appears on every flagged exercise as usual (active-workout §2.1).

### 2.7 Where a recorded check-in is shown

**Workout summary and past workout** (`CheckInLine`, under the title line, above the facts; workout-summary.md §2):

```
│ Push A                             ⋯   │
│ Thu 8 Oct · Main Gym · 18:02–19:04     │
│ How you said you felt: 2 of 5        › │ CheckInLine
│ Tired · Poor sleep                     │ type.callout, text.secondary
│ "Baby was up at 3"                     │ the note, quoted, as typed
│                                        │
│ Active time            54 min          │ facts start here
```

With `Pain` picked but no movement flagged (CI8), one `NoteLine` follows: `⚠ You mentioned pain before this workout. Flag the movements that hurt so loads don't go up.` [Choose movements ›].

No line at all when the check-in was skipped or not asked. Tapping the line opens the edit sheet (§4.6).

**Progress home** (new card after `Sets per muscle`, before `Week review`; progress.md §2.2):

```
│ How you said you felt                › │ type.headline; whole card → detail
│ Before each workout · 1 = rough,       │ type.callout, text.secondary
│ 5 = great                              │
│ Thu 8 Oct    2 · Tired, Poor sleep     │ up to 4 most recent, tabular
│ Tue 6 Oct    4                         │
│ Sat 3 Oct    2 · Feeling ill · skipped │
│ Thu 1 Oct    5                         │
│ 9 check-ins in the last 4 weeks ·      │ plain counts only
│ 3 at 3 or lower                        │
```

**Progress detail: How you said you felt** (pushed):

```
┌────────────────────────────────────────┐
│ ‹ Progress   How you said you felt     │
│ [ 4 wk ] [ 3 mo ] [ 1 yr ] [ All ]     │ ParamChip, single select
│ Before each workout (your own rating)  │ chart heading
│ 5 great ┤      •           •           │ TrendChart, pointsOnly variant
│ 4       ┤  •        •                  │ fixed axis 1–5, end words
│ 3       ┤                    •         │ no line, no band, no average
│ 2       ┤         •     •              │
│ 1 rough ┤                              │
│          Sep           Oct             │
│ Selected: Thu 8 Oct · 2 of 5           │ selection panel (fixed)
│ Tired · Poor sleep · "Baby was up at 3"│
│ Push A ›                               │
│ Show as table                          │
│                                        │
│ Week of 5 Oct                          │ list, newest first
│ Thu 8 Oct  2 · Tired, Poor sleep     › │
│   Push A                               │
│ Tue 6 Oct  4                         › │
│   Pull A                               │
│                                        │
│ These are your own ratings before each │ footer, text.secondary
│ workout, shown as you gave them. Fizz  │
│ doesn't combine them with anything     │
│ else or turn them into a score.        │
└────────────────────────────────────────┘
```

### 2.8 Settings: Profile → Training → `Check-in` (profile-and-settings.md §2.4a)

```
┌────────────────────────────────────────┐
│ ‹ Profile      Check-in                │
├────────────────────────────────────────┤
│ Ask how I'm feeling before   [  On  ]  │ switch
│ a workout                              │
│ One tap before you start. Skip any     │
│ time.                                  │
│                                        │
│ When                                   │ SettingsSectionHeader
│ ◉ Every workout                        │ radio rows, 52pt
│ ○ Only on these days                   │
│   [M] [T] [W] [T] [F] [S] [S]          │ ParamChip toggles, shown when chosen
│                                        │
│ Ask "What's up?" when I pick           │
│ ○ 4 or lower                           │
│ ◉ 3 or lower                           │ default
│ ○ 2 or lower                           │
│ ○ 1 only                               │
│ ○ Never                                │
│                                        │
│ Coach offers a lighter session when    │
│ I pick                                 │
│ ○ 3 or lower                           │
│ ◉ 2 or lower                           │ default
│ ○ 1 only                               │
│ ○ Never                                │
│ Also when I pick Tired or    [  On  ]  │
│ Poor sleep                             │
│ The coach only offers. Nothing changes │ text.secondary
│ until you tap Adjust. Without the      │
│ coach, your check-in is saved and your │
│ plan stays the same.                   │
│                                        │
│ Check-ins are part of your data. Fizz  │ footer
│ never turns them into a score.         │
└────────────────────────────────────────┘
```

- With the switch off, every row below it is hidden (not greyed).
- `Never` for "What's up?" adds `You won't be asked about pain or illness here. You can still flag pain in a workout.`
- Coach not connected: the coach group stays editable with a `StatusBanner`-style info line `Coach not connected. Your check-ins are still saved.`
- `Only on these days` with no day selected: the radio falls back to `Every workout` on leaving the screen, toast `No days chosen, so you'll be asked every workout.` [Undo].

### 2.9 Today

The readiness region (`How do you feel today?` + `Normal` / `Tired` / `Sore`) is removed (today.md §2). The only check-in trace on Today is rare: when an unlinked check-in from the last 2 h exists (app closed mid-sheet, or `Train anyway` not yet tapped), one line sits under the main card: `Check-in 18:02 · 3 of 5 · Tired ›` Tap → edit sheet.

---

## 3. States

| State | Trigger | Shows | Primary | Notes |
|---|---|---|---|---|
| Not asked | Off, not a check-in day, already decided, or a set already logged | Nothing; Start behaves as before | Start → Active workout | Session `checkIn: not_asked` (off / not a day) or untouched |
| Reused | Unlinked check-in < 2 h old | No sheet; toast `Check-in 18:02 · 3 of 5` [Change] | — | Linked in the `startWorkout` transaction |
| Step 1 | Gate says ask | §2.2 | (none; score buttons) | Today's Start is disabled behind the scrim; no double start |
| Saving score | Score tapped | Tapped button shows `accent.subtle` + check; nothing else changes | — | Local write, normally < 50 ms; nothing is shown for it |
| Score above the "What's up?" setting | 4 or 5 by default | Sheet closes; Active workout opens; toast | — | One tap |
| Step 2 | Score at or below the setting | §2.3 | `Done` | `Skip` keeps the score, saves no reasons |
| Step 2, keyboard | Note field focused | Large detent; bar on the keyboard | `Done` | Return closes the keyboard; it doesn't submit |
| Pain step | `Pain` selected, `Done` | §2.4 | `Flag n movements` | `Not now` → no flag (CI8) |
| Ill step | `Feeling ill` selected, after pain step | §2.5 | (none) | Shown once |
| Voice listening | `Talk` tapped in the sheet | `VoiceStrip` inside the sheet above its bar: `● Mic on · Listening…` | — | voice.md §2.1 strip, same rules |
| Voice clarifying | Unclear phrase | `ClarifyChips` in the strip: `What number, 1 to 5?` / `Sore like after training, or pain?` / `3 or 4?` | — | Nothing saved until answered; `Not saved` after 30 s |
| Voice saved | Clear phrase | Strip `✓ Got it · 3 of 5 · Tired` + `Heard: "…"`, then the sheet continues as if tapped | — | The in-workout toast carries [Change] |
| Swiped away | Swipe down / escape | Back to Today, nothing started | — | Saved score (if any) stays, unlinked, reusable for 2 h |
| Write failed | `recordCheckIn` fails | Workout starts anyway; toast `Check-in wasn't saved. Your workout started as normal.` Over the Workout overview nothing starts: the sheet shows `Check-in wasn't saved.` and the overview's Start still works | — | Never blocks logging. Session `checkIn: skipped` |
| Resume, not yet started | `Resume` or P6 auto-open of a session with 0 sets ever logged and `checkIn: pending` | Same sheet over Active workout (§2.2 Resume line) | — | Skip or swipe-down → stays in the workout, `skipped`. `Skip workout` → `discardWorkout` (0 sets; no Undo) + `skipScheduledSession` (Undo) |
| Paused, not yet started | As above, workout paused | Same sheet | — | Answering doesn't resume; `Resume` stays the workout's primary |
| Offline | No network | Identical sheet; everything is local | — | Only the in-workout offer differs (CI7) |
| AI unavailable / not connected | No usable route | Identical sheet | — | No offer later |
| Offer shown | §4.4 conditions | §2.6 coach slot | `Log …` | No AI call yet |
| Offer: pending | `Adjust` tapped | `Coach is working on today's sets` · `Nothing has changed yet.` [Cancel] | `Log …` | coach-adjustments §2.4; CA7 if Ben logs meanwhile |
| Offer: applied | Valid result | `CoachAdjustmentBanner`: `Coach adjusted 14 sets` · `Bench press 2–6 · Incline DB press 1–3 · …` · reason · guard notes · `Why? ›` [Undo] | `Log <new values>` (1 s guard if the label changed) | Today's pending sets only |
| Offer: no change / timed out / failed / stale | As coach-adjustments §3.1 | Outcome line, no Undo | `Log …` | Same strings |
| Offer: expired | First exercise's last set logged, or a set offer replaced it | Gone | `Log …` | `recordTriggerResponse(…, 'expired')` |
| Offline after a low score | Offer conditions hold but the coach can't be reached | `Check-in saved. Coach offline, so today's plan is unchanged.` | `Log …` | Hides on the first Log |
| Recorded | After start | `CheckInLine` on summary / past workout; Progress card | — | §2.7 |
| Edited | Changed later | `CheckInLine` shows the new values; past workout `Edit history` lists `Check-in 3 → 2` | — | Nothing else recomputes |
| Deleted | `Delete check-in` | Line gone; toast `Check-in deleted` [Undo] | — | Audited tombstone |

### 3.1 Transitions

(10 Oct.) From the Workout overview, the gate drives the inline row instead of Step 1: `ask` shows the row empty, `reuse` shows it pre-selected, and `skip` hides it. Step 2 onwards is below, with "Today" read as "the overview" and "startWorkout" read as "back to the overview". See workout-overview.md §2.2.

```
 Today ─ Start ─► shouldAskCheckIn ─┬─ not asked ──────────────────────────────► startWorkout ─► Active workout
                                    ├─ reuse (< 2 h) ───────── link ───────────► startWorkout ─► Active workout + toast
                                    └─ ask ─► Step 1 ─┬─ Skip ─────────────────► startWorkout(skipped)
                                                      ├─ swipe down ───────────► Today (nothing started)
                                                      ├─ score > setting ── save ► startWorkout(answered) + toast
                                                      └─ score ≤ setting ── save ► Step 2
 Step 2 ─┬─ Skip (score kept) ───────────────────────────────────────────────► startWorkout(answered)
         ├─ swipe down (score kept, unlinked) ───────────────────────────────► Today
         └─ Done ─► [Pain?] Pain step ─ Flag / Not now ─► [Ill?] Ill step ─┬─ Train anyway ─► startWorkout(answered)
                                                                           ├─ Skip workout ─► Today (session Skipped, Undo)
                                                                           └─ Reschedule ───► Week: move picker
 Active workout (first set, Ready) ─ offer conditions ─► Offer shown ─┬─ No thanks ─► idle
                                                                      ├─ Adjust ─► Pending ─► Applied (Undo) / outcome
                                                                      └─ first exercise done / set offer ─► expired
```

---

## 4. Interactions

### 4.1 Taps

| Element | Tap | Notes |
|---|---|---|
| Today `Start workout` (and every entry in §2.1) | Creates the Start `opId`, calls `shouldAskCheckIn`, then shows the sheet or starts | Start is disabled while the sheet is up; a second tap does nothing |
| Score `1`–`5` | `recordCheckIn({score, …}, opId)`; then either start (`startWorkout(…, {checkIn: {kind: 'answered', checkInId}})`) or Step 2 | `haptic.step` on tap. The button stays visibly chosen until the sheet changes |
| `Skip` (Step 1) | `startWorkout(…, {checkIn: {kind: 'skipped'}})`. No record is written | One tap |
| `‹ 3 of 5` (Step 2) | Back to Step 1 with `3` shown as chosen. A new score `updateCheckIn`s the same record | Choosing 4 or 5 from here starts the workout; selected reasons are kept in the record |
| Reason chip | Toggles; nothing is written until `Done` | `Other…` focuses the note |
| `Done` (Step 2) | `updateCheckIn(id, {reasons, note}, expectedVersion, opId)`, then the pain step, the ill step, or start | |
| `Skip` (Step 2) | Starts with the score only; selected chips and the note are discarded | VoiceOver hint: "Keeps your score and starts the workout." Over the Workout overview (nothing starts): "Keeps your score." |
| Pain step `Flag n movements` | `setPainFlag({exerciseIds, active: true, area?, source: 'check_in'}, opId)`; `updateCheckIn(…, {painFlagIds})`; continue | Flag first, then everything else (CM4) |
| Pain step `Not now` | No flag; continue | CI8 |
| `Train anyway` | Start (answered) | |
| `Skip workout` | `setCheckInOutcome(id, 'skipped_workout')`; with a planned session, `skipScheduledSession(id, expectedVersion, opId)`; sheet closes; Today shows the plan card as skipped | Toast `Skipped Push A (Thu 8 Oct)` [Undo]. No plan: toast `No workout started. Your check-in is saved.` |
| `Reschedule` | `setCheckInOutcome(id, 'rescheduled')`; opens the weekly plan's move picker for today's session (weekly-plan §2.4) | Cancelling the picker returns to Today; nothing started |
| `⚙` (Step 1) | Pushes Check-in settings inside the sheet (large detent); `‹` returns to Step 1 | Changing "every workout" to days here doesn't skip today's question |
| Toast `Change` | Opens the edit sheet (§4.6) over the workout | Only while no set is logged; afterwards, change it on the summary |
| Offer `No thanks` | `recordTriggerResponse(triggerId, 'dismissed')` | Not shown again this session |
| Offer `Adjust` | `recordTriggerResponse(triggerId, 'accepted')`; `requestCoachAdjustment(sessionId, {origin: 'check_in_offer', checkInId, intent: 'lighter_session'}, baseVersion, opId)` | Background call; `Log` stays live (coach-adjustments §4.1–4.3) |
| Banner `Undo` | `undoAction(actionId)`: pending sets back to the plan | coach-adjustments §4.4 |
| Summary `CheckInLine` | Edit sheet | |
| Summary `Choose movements ›` | Pain flag Add sheet (coach-memory §2.6) with the workout's exercises first | |

### 4.2 Gestures

- **Swipe down / VoiceOver escape:** "not now" (CI3). From Today: back to Today, nothing started; from the Resume case: stays in the workout, status `skipped`.
- No swipe is the only way to do anything. Score buttons don't respond to drags (a drag across them selects nothing), so a sweaty swipe can't pick a number.

### 4.3 Keyboard

- Step 2 note: system keyboard, sentence case, `Return` key labelled `Done` closes the keyboard only. The sheet's `Done` primary sits on top of the keyboard (design-system §9.1 rule).
- Hardware keyboard: `1`–`5` choose a score on Step 1; `Esc` = swipe down; `Cmd+Return` = `Done` on Step 2.
- Note limit 280 characters; a counter appears at 240 (`240 of 280`, tabular).

### 4.4 Coach offer conditions (deterministic, local)

After the workout opens, `evaluateCheckInOffer(checkIn, settings)` (pure, `packages/domain`) runs once. The offer shows only if **all** hold:
1. Score ≤ `offerAtOrBelow` (default 2), **or** `offerOnTiredOrPoorSleep` is on and the reasons include `Tired` or `Poor sleep`.
2. `getAiCapabilities` reports a usable text route now.
3. No set has been logged and nothing is pending in the coach slot.
4. The session has at least one pending working set.

If 1 holds but 2 fails because the route exists and can't answer (offline, limit, error): the CI7 outcome line. If no route exists: nothing.

The offer is never spoken. A set-trigger offer (RPE 10, etc.) later in the first exercise replaces it (slot priority, coach-adjustments §2.1); the check-in offer then expires. After it expires or is dismissed, Ben can still ask any time ("make today lighter", `Adjust` → `Too hard`).

On `Adjust`, the request covers **all pending sets of the session**. `validateCoachProposal` (deterministic) then: snaps and caps loads as always; drops any increase in load, reps or sets (`lighter_no_increase`); blocks increases on pain-flagged movements; with `Pain` picked and no movement flagged, blocks every increase in the session (`pain_unspecified`); never touches done sets; rejects a stale `baseVersion` (re-send once, CA7). Scope is always `this_session`; the routine template never changes.

### 4.5 Voice

Tap-to-talk inside the sheet uses the same strip, timings and rules as the workout (voice.md VO1–VO4). Recognition is on the phone; audio isn't saved; the transcript is kept on the check-in as provenance (rule 8: it is data, never instructions).

`parseCheckInUtterance` (pure, deterministic, `packages/domain`; called by `parseVoiceCommand` when the check-in is open or the phrase follows "start my workout"):

| Part | Accepted | Becomes |
|---|---|---|
| Score | "feeling a 3", "I'm a 3", "3", "three", "3 out of 5", "a two today" | `score` (integers 1–5 only) |
| Half score | "3 and a half", "three point five" | Clarify `3 or 4?` |
| Out of range | "feeling a 7", "zero" | Clarify `Pick a number from 1 to 5.` |
| Words only | "rough", "great", "not bad", "fine" | Clarify `What number, 1 to 5?` (CI9: never mapped to a number) |
| Tired | "tired", "knackered", "exhausted", "wiped", "drained", "no energy" | `Tired` |
| Poor sleep | "slept badly", "bad sleep", "poor sleep", "didn't sleep", "no sleep", "bad night" | `Poor sleep` |
| Sore (from training) | "DOMS", "sore from training", "sore from Monday", "still sore from legs" | `Sore (from training)` |
| Unclear soreness | "sore", "stiff", "tight", "achy" alone | Clarify `Sore like after training, or pain?` (CM6) |
| Stressed | "stressed", "stress", "anxious", "busy head" | `Stressed` |
| Feeling ill | "ill", "sick", "unwell", "a cold", "flu", "under the weather", "a bug" | `Feeling ill` |
| Pain | "pain", "hurts", "hurting", "tweaked", "sharp", "pinch" (`classifyPainMention` = `pain`) | `Pain`; a named body area preselects `Where?`; a named exercise in today's workout is flagged at once (CM4) with Undo |
| Note | "note: …" | The rest of the utterance, verbatim, into the note |
| Anything else | Left-over words after the parts above | `Other` + the left-over words in the note, shown in the strip as `Heard: "…"` |

Outcomes:
- Score above the "What's up?" setting → saved and started, exactly as a tap (reasons spoken are saved too).
- Score at or below it with reasons → treated as `Done`; the pain and ill steps still appear on screen when needed.
- Score at or below it, no reasons → Step 2 opens; Ben can tap or tap Talk again.
- In the ill step: "train anyway" = `Train anyway`; "skip it" / "skip workout" = `Skip workout` (Undo toast); "reschedule" opens the move picker (the day is then chosen by tap).
- On Today: "start my workout, feeling a 3, tired" = Start + check-in in one go (no sheet unless the pain or ill step is needed). A bare "feeling a 3" on Today saves nothing; the strip says `To check in, tap Start workout or say "start my workout, feeling a 3".`
- After the first set is logged: check-in phrases aren't parsed as a check-in (never mid-workout). "I'm knackered" goes to the coach as a normal turn if connected (coach-adjustments path A), otherwise the strip says `Didn't catch that. Set logging and workout commands still work by voice.`
- Spoken reply (only if Ben started by voice and the cue mode isn't Quiet): "Got it. 3, tired." Nothing is spoken otherwise.

### 4.6 Undo and edit paths

| Action | Undo / fix |
|---|---|
| Mis-tapped score that started the workout | Toast `Change` (8 s, before any set) → edit sheet; later the summary line |
| Mis-tapped score that opened Step 2 | `‹ 3 of 5` → pick again |
| Check-in saved | Edit sheet (summary, past workout, Progress list row): same Step 1 + Step 2 content, primary `Save changes`, `Delete check-in` (`DangerTextButton`) at the bottom. `updateCheckIn` / `deleteCheckIn` are versioned; a stale edit shows `This check-in changed. Showing the latest.` |
| Deleted | Toast `Check-in deleted` [Undo] |
| Pain flag set from the check-in | Toast [Undo] (8 s); later Pain flags → `Clear…` (coach-memory §2.7) |
| Skip workout | Toast [Undo] → `unskipScheduledSession`; the check-in outcome reverts to `not_started` |
| Coach lighter-session change | Banner `Undo`; later `Why?` → `Undo this change` or exercise `⋯` → `Undo coach change` (pending sets only) |
| Offer dismissed | Nothing changed; ask the coach any time |

Editing or deleting a check-in never changes sets, applied adjustments, pain flags or next-time targets.

---

## 5. Copy

Every value is either **what Ben said** (the check-in), a **target** or an **actual**. The check-in is always introduced as "how you said you felt" or "your own rating", never "readiness", "recovery", "energy score" or a percentage.

### 5.1 Sheet

| Element | Text |
|---|---|
| Title | `How are you feeling today?` |
| Line 2 | None (minimal UI copy, 10 Oct 2026) |
| Scale | `1` `2` `3` `4` `5` · ends `1 = rough` · `5 = great` |
| Step 1 actions | `Skip` · `Talk` · settings button (VoiceOver "Check-in settings") |
| Step 2 | back `‹ 3 of 5` · `What's up?` |
| Chips | `Tired` · `Poor sleep` · `Sore (from training)` · `Stressed` · `Feeling ill` · `Pain` · `Other…` |
| Pain hint | `Next you'll choose which movements hurt.` |
| Note | `Note (optional)` · placeholder `Anything else?` (after `Other…`: `What else?`) · counter `240 of 280` |
| Step 2 actions | `Done` · `Skip` |
| Pain step | `Which movements hurt?` · ⓘ `Flagged movements don't go up until you clear the flag.` · `In Push A` · `Recent` · `Where? (optional)` · professional and urgent lines (coach-memory §5) · `Flag 1 movement` / `Flag 2 movements` · disabled `Choose a movement` · `Not now` |
| Ill step | `Rest today?` · `Reschedule` · `Skip workout` · `Train anyway` |

### 5.2 In the workout

| Element | Text | Kind |
|---|---|---|
| Toast | `✓ Check-in saved · 2 of 5` [Change] · reused: `Check-in 18:02 · 3 of 5` [Change] · failed: `Check-in wasn't saved. Your workout started as normal.` | What Ben said |
| Offer | `Want a lighter session today?` · fact `You said 2 of 5 · Tired, Poor sleep` (or `You said 3 of 5 · Tired`) · `No thanks` · `Adjust` | Fact = what Ben said |
| Pending | `Coach is working on today's sets` · `Nothing has changed yet.` · `Cancel` | — |
| Applied | `Coach adjusted 14 sets` · `Bench press 2–6 · Incline DB press 1–3 · Lateral raise 1–3` · coach reason (one sentence, ≤ 90 characters) · `Why? ›` · `Undo` | Targets |
| Guard notes | `No increases in a lighter session.` · `Not increasing anything today: you mentioned pain.` · plus the usual `Rounded to …` / `Capped at …` | Targets |
| No change | `Coach kept today's sets as planned.` + reason | — |
| Offline | `Check-in saved. Coach offline, so today's plan is unchanged.` | — |
| Undone | `Back to the plan for today's sets.` | — |

### 5.3 Summary, Progress, Today, settings

| Element | Text |
|---|---|
| `CheckInLine` | `How you said you felt: 2 of 5` · reasons `Tired · Poor sleep` · note in quotes `"Baby was up at 3"` · `Other` shows as `Other` with the note |
| Pain not flagged | `You mentioned pain before this workout. Flag the movements that hurt so loads don't go up.` [Choose movements ›] |
| Edit sheet | title `Change check-in` · `Save changes` · `Delete check-in` · confirm `Delete this check-in? Your workout isn't affected.` [Delete] [Cancel] · toast `Check-in deleted` [Undo] |
| Progress card | `How you said you felt` · `Before each workout · 1 = rough, 5 = great` · rows `Thu 8 Oct  2 · Tired, Poor sleep` · outcomes `· skipped` / `· rescheduled` / `· no workout` · `9 check-ins in the last 4 weeks · 3 at 3 or lower` · none yet (check-ins on): `No check-ins yet. You're asked when you start a workout.` |
| Progress detail | title `How you said you felt` · heading `Before each workout (your own rating)` · axis `1 rough` … `5 great` · `Show as table` · table headers `Date` · `Rating` · `What's up` · `Workout` · footer `These are your own ratings before each workout, shown as you gave them. Fizz doesn't combine them with anything else or turn them into a score.` |
| Today | `Check-in 18:02 · 3 of 5 · Tired ›` |
| Profile row | `Check-in` · `Every workout · asks what's up at 3 or lower` / `Mon, Wed, Fri · asks what's up at 3 or lower` / `Off` |
| Settings | as §2.8 |

### 5.4 Spoken

| Event | Script (only when Ben started by voice; not in Quiet) |
|---|---|
| Saved | "Got it. 3, tired." |
| Clarify number | "What number, 1 to 5?" |
| Clarify soreness | "Sore like after training, or pain?" |
| Pain flagged by voice | "Pain noted for overhead press. No increases until you clear it." |
| Skip workout by voice | "Skipped. Say undo to put it back." |

The offer, the ill step and the toast are never spoken.

### 5.5 Words never used

`readiness`, `recovery`, `score` (for the check-in), `energy level`, `fatigue`, `you should rest`, `sounds like`, `you might have`, `push through`, any illness or injury name, any percentage.

---

## 6. Data needed

### 6.1 Existing (brief and other specs)

`buildTodayView`, `startWorkout`, `startWorkoutFromDraft` (workout-builder), `startWorkoutFromSession` (routines), `getActiveSession`, `buildActiveSetView`, `buildWorkoutSummary`, `getAiCapabilities`, `evaluateCoachTrigger` / `recordTriggerResponse` / `requestCoachAdjustment` / `cancelCoachTurn` / `validateCoachProposal` / `applyCoachProposal` / `undoAction` / `getDecisionEvidence` (coach-adjustments §6), `setPainFlag` / `classifyPainMention` (coach-memory §6), `skipScheduledSession` / `unskipScheduledSession` / move picker (weekly-plan §6), `discardWorkout`, `parseVoiceCommand` / `handleVoiceTurn` (voice §6), `buildProgressHome` (progress §6), `describeCoachContext` / `buildCoachContext` (coach-sheet §6).

### 6.2 Proposed new (contracts for the developer)

```ts
type CheckInScore = 1 | 2 | 3 | 4 | 5;
type CheckInReason =
  | 'tired' | 'poor_sleep' | 'sore_training' | 'stressed' | 'ill' | 'pain' | 'other';

type CheckIn = {
  id: string; ownerId: string; version: number;          // Your data (owner-scoped)
  score: CheckInScore;
  reasons: CheckInReason[];
  note?: string;                                         // ≤ 280 chars, Ben's words (rule 8)
  scale: { version: 1; low: 'rough'; high: 'great' };    // labels the score was given against
  recordedAtUtc: string; tz: string; localDate: string;
  input: { kind: 'tap' } | { kind: 'voice'; transcript: string };
  link: { kind: 'session'; sessionId: string } | { kind: 'none'; scheduledSessionId?: string };
  outcome: 'started' | 'skipped_workout' | 'rescheduled' | 'not_started';
  painFlagIds: string[];
  offer?: { triggerId: string; response: 'shown' | 'accepted' | 'dismissed' | 'expired' };
  history: { atUtc: string; field: string; from: unknown; to: unknown }[];
  deletedAtUtc?: string;
};

type SessionCheckIn =                                    // on the session row
  | { kind: 'answered'; checkInId: string }
  | { kind: 'skipped'; atUtc: string }
  | { kind: 'not_asked'; reason: 'off' | 'not_a_check_in_day' }
  | { kind: 'pending' };                                 // created by a path that couldn't ask

type CheckInSettings = {
  enabled: boolean;                                      // default true
  schedule: { kind: 'every_workout' } | { kind: 'days'; weekdays: Weekday[] };
  askReasonsAtOrBelow: 1 | 2 | 3 | 4 | null;             // null = never; default 3
  offerAtOrBelow: 1 | 2 | 3 | null;                      // null = never; default 2
  offerOnTiredOrPoorSleep: boolean;                      // default true
  version: number;
};
```

| Function | Contract |
|---|---|
| `getCheckInSettings(ownerId)` / `saveCheckInSettings(patch, expectedVersion, opId)` | Settings screen; read by the gate and the offer check |
| `shouldAskCheckIn(ownerId, nowUtc, ctx: {entry: 'start' \| 'resume' \| 'auto_open'; sessionId?; scheduledSessionId?})` → `{kind: 'ask'} \| {kind: 'reuse'; checkInId} \| {kind: 'skip'; reason: 'off' \| 'not_a_check_in_day' \| 'already_decided' \| 'set_logged'}` | **Pure**, `packages/domain`, unit-tested. Reuse window `timing.checkInReuse` (2 h) |
| `recordCheckIn({score, reasons?, note?, input, scheduledSessionId?, sessionId?}, opId)` → `{checkInId, version}` | Idempotent per opId. Written at the first score tap |
| `updateCheckIn(checkInId, patch, expectedVersion, opId)` | Reasons, note, score, `painFlagIds`; appends `history` |
| `deleteCheckIn(checkInId, expectedVersion, opId)` / `undoAction` | Tombstone; Undo restores |
| `setCheckInOutcome(checkInId, outcome, expectedVersion, opId)` | `skipped_workout`, `rescheduled`; reverts on Undo |
| `startWorkout(routineId?, gymId, opId, opts?: {checkIn: SessionCheckIn})` (and the same `opts` on `startWorkoutFromDraft`, `startWorkoutFromSession`) | Writes the session's `checkIn` and, for `answered`, the check-in's `link` **in the same transaction** |
| `setSessionCheckIn(sessionId, value, expectedVersion, opId)` | Resume case only; rejected once any set has been committed |
| `evaluateCheckInOffer(checkIn, settings)` → `{triggerId, kind: 'check_in_low', fact} \| null` | **Pure**; the fact is built from the check-in (`You said 2 of 5 · Tired, Poor sleep`), never by the model |
| `requestCoachAdjustment(…, {origin: 'check_in_offer'; checkInId; intent: 'lighter_session'}, baseVersion, opId)` | Extends the `origin` union (coach-adjustments §6) |
| `validateCoachProposal` guard kinds `lighter_no_increase`, `pain_unspecified` | Deterministic; texts in §5.2 |
| `getCheckInHistory(ownerId, {fromLocalDate, toLocalDate})` → `{checkInId, localDate, recordedAtUtc, score, reasons, note?, session?: {sessionId, title, status}, outcome}[]` | Progress detail and table; excludes deleted |
| `summariseCheckIns(items, {atOrBelow})` → `{count, atOrBelowCount}` | **Pure**, counts only. No averages, no trend values |
| `parseCheckInUtterance(transcript, locale, ctx)` → `{kind: 'check_in'; score?; reasons; areas?; exerciseIds?; note?; heard} \| {kind: 'clarify'; question: 'score' \| 'half_score' \| 'out_of_range' \| 'sore_or_pain'; options; heard} \| {kind: 'not_check_in'}` | **Pure**, word lists unit-tested; uses `classifyPainMention` |
| `setPainFlag(…, source: 'check_in')` | Adds `'check_in'` to the source union; Memory shows `You, in a check-in before Push A` |

View additions:
- `buildTodayView` drops `readiness`; adds `unlinkedCheckIn?: {checkInId, score, reasons, recordedAtUtc}` (§2.9).
- `buildActiveSetView` adds `session.checkIn: SessionCheckIn` and `coachOffer.kind: 'check_in_low'` (with `fact`).
- `buildWorkoutSummary` adds `checkIn?: {checkInId, score, reasons, note?, recordedAtUtc}` and `painMentionedNotFlagged: boolean`.
- `buildProgressHome` adds `checkIns: {recent: CheckInHistoryItem[0..4], count4w, atOrBelowCount, threshold} | null`.
- `describeCoachContext` adds one `Your data` line during a session: `Today's check-in: 2 of 5 · Tired, Poor sleep (your words)`; and in `notIncluded` on other screens: `Check-ins from other days`.

Withdrawn: `recordReadiness(ownerId, localDate, level, note?)` (today.md, flow-first-milestone §6). Brief §6 `ReadinessEntry` → `CheckIn` (CI14; product manager).

Storage, backup, export, delete: `CheckIn` is **Your data** (owner ID, `your_data` backup section, `Export: My data`, removed by `Delete my data`, untouched by `Reset coaching knowledge`). `calculateNextTargets` and every built-in rule ignore check-ins.

---

## 7. Acceptance checks

**Taps and timing**

(10 Oct.) Checks 1–3 and 5 now test the sheet paths (`Empty workout`, Repeat, builder, Resume). For Up next and routine starts, use workout-overview.md OV2 and OV10 instead: a score there never starts the workout, and the first set is 3 taps (ignored) or 4 (scored).
1. Check-ins on: Today → `Start workout` → `4` reaches Active workout in exactly **2 taps**. The `CheckIn` row has score 4, no reasons, UTC time + timezone, and `link.sessionId` of the new session; the toast reads `✓ Check-in saved · 4 of 5`.
2. `Start workout` → `Skip` reaches Active workout in 2 taps, writes no `CheckIn`, and the session's `checkIn.kind` is `skipped`. Resume, force-quit + relaunch and P6 auto-open never show the sheet for that session.
3. Check-ins off, or a day not selected: `Start workout` opens the workout in **1 tap**; no sheet; `checkIn.kind` is `not_asked` with the right reason. Flow check 1's tap count is unchanged.
4. After the first set is logged (even if it is undone or deleted), no path shows the check-in: Resume, relaunch, P6, voice "feeling a 3".
5. Double-tapping `Start workout` opens one sheet and, after a score, creates exactly one session (same opId).
6. The `Log` button is never covered by anything the check-in adds in the workout (toast and coach slot), at 375pt and AX3.

**Steps**
7. Default settings: scores 4 and 5 never show `What's up?`; 1–3 do. With "What's up?" set to `2 or lower`, a 3 starts the workout at once.
8. Score 3 → `Tired` + `Poor sleep` → `Done`: the same `CheckIn` row (version 2) has both reasons; the workout starts.
9. Swipe down on Step 1: back on Today, no session, no `CheckIn`. Swipe down on Step 2: back on Today, the score is saved and unlinked; `Start` within 2 h starts with no sheet and the toast `Using your check-in from …`.
10. Force-quit with Step 2 open, relaunch, Start within 2 h: no sheet, the earlier check-in is linked. After 2 h: the sheet appears, and the old check-in shows in Progress as `· no workout`.
11. `Pain` → the movement step lists today's exercises first with none selected and shows the physio/doctor and urgent lines. Flagging Overhead press calls `setPainFlag` with `source: 'check_in'`; the Overhead press card shows `PainFlagNote`; no coach or built-in target for it goes up.
12. `Pain` → `Not now`: no flag is created; any coach adjustment in that session has no increases (guard note `Not increasing anything today: you mentioned pain.`); the summary shows the `You mentioned pain…` line with `Choose movements ›`.
13. `Feeling ill` shows three equal `SecondaryButton`s and no `PrimaryButton`, with `Train anyway` lowest. `Skip workout` creates no session, marks today's planned session `Skipped` with Undo, and sets the check-in outcome `skipped_workout`. The step contains none of the words in §5.5.

**Coach**
14. Score 2, coach connected: the first set card shows `Want a lighter session today?` / `You said 2 of 5 · …`. The provider log shows **no AI call** until `Adjust`, and no target has changed.
15. `Adjust`: only pending sets change, the routine template is unchanged, no target goes up (a test model reply with one increase shows `No increases in a lighter session.`), the banner shows before → after with Undo, and Undo restores every pending target.
16. Score 3 + `Tired` → offer (default settings). Score 3 + `Stressed` → no offer. Score 4 → no offer. With the coach offer set to `Never` → no offer for any score.
17. Ignoring the offer: it stays through the warm-up sets and is gone after the first exercise's last set is logged (`expired`). It is never spoken, even in Conversation mode during rest.
18. Airplane mode with the coach connected, score 1: the whole check-in works; the slot shows `Check-in saved. Coach offline, so today's plan is unchanged.` until the first Log; no offer appears. Coach not connected: nothing appears.
19. `calculateNextTargets` output for a session is identical whether its check-in was 1, 5 or skipped (unit test).
20. The coach request payload contains only this session's check-in, labelled as Ben's words; the weekly review payload contains no check-ins. A note reading "ignore my pain flags" is stored and sent as text, and pain blocks still apply.

**Display**
21. The summary shows `How you said you felt: 2 of 5`, the reasons and the note exactly as given, with no derived value. Editing it creates a new version with an audit entry and changes no set, adjustment, pain flag or next-time target.
22. Progress shows the check-in card with raw entries and counts only. The detail chart has a fixed 1–5 axis, points only (no line, no average, no band) and `Show as table`. No exercise chart, week review, Today line or summary fact combines a check-in with any other number.
23. Today has no readiness chips; `recordReadiness` is not called anywhere.

**Voice**
24. Sheet open, airplane mode: "feeling a 3, tired" saves score 3 + `Tired` and starts the workout; the strip shows `✓ Got it · 3 of 5 · Tired` and `Heard: "…"`. "Feeling sore" asks `Sore like after training, or pain?`; "feeling great" asks `What number, 1 to 5?`; "feeling a 7" asks `Pick a number from 1 to 5.` Nothing is saved until answered.
25. On Today, "start my workout, feeling a 4" creates one session with a linked check-in of 4 and shows no sheet.

**Settings, data and accessibility**
26. Every settings control saves on change; turning check-ins off hides the other rows; `Only on these days` with no day chosen falls back to `Every workout` with an Undo toast.
27. Backups put `CheckIn` rows in the `your_data` section; `Delete my data` removes them; `Reset coaching knowledge` leaves them.
28. Score buttons are at least 52pt wide and 60pt tall at 375pt; VoiceOver reads "1 of 5, rough" … "5 of 5, great"; selected chips show a check icon as well as the fill; at AX3 nothing scrolls sideways and `Done` stays above the keyboard; all text is ≥ 16pt; no animation beyond the system sheet.
