# Design system

> **Revision 2026-10-08.** Added `L` / `R` side badges for unilateral sets and noted that deleted sets aren't shown (§7), per [ADR 0003](../decisions/0003-domain-review-decisions.md). No token values changed.
>
> **Revision 2026-10-08 (coach-led progression, v0.4).** For [ADR 0006](../decisions/0006-coach-led-progression.md) and [coach-adjustments.md](coach-adjustments.md): new timing tokens `timing.valueChangeGuard` and `timing.coachTimeout` (§6); target source styles and the `TargetSourceTag` (§7); `ChangeReviewCard` scope narrowed to swaps, gym changes and summary proposals (§9.11); new components `AdjustControl` (§9.13), `CoachOfferLine` (§9.14), `CoachAdjustmentBanner` (§9.15) and `CoachTargetProposal` (§9.16). No colour values added: coach UI uses existing tokens, so the one-accent rule holds.

> **Revision 2026-10-08 (workout builder, v0.5).** For [workout-builder.md](workout-builder.md): new timing token `timing.coachBuildTimeout` (§6) and components `ParamChip` (§9.17), `DraftExerciseRow` with diff markers (§9.18), `GuardNoteList` (§9.19) and `WorkoutDraftCard` (§9.20). No colour values added.

Status: v0.1 draft, 8 Oct 2026. This file is the only source of design tokens. Screen specs refer to tokens by name (for example `color.accent`, `type.loadDisplay`). Developers implement these values directly in `apps/mobile` (a single `theme.ts` is enough). If you need a value that is not here, add it here first. Don't hard-code it in a screen.

Context: one person uses the app on an iPhone, one-handed, mid-workout, with sweaty fingers and headphones, often in bright or dim gym light. Every choice below favours speed, legibility and calm over decoration.

---

## 1. Principles

1. **The current set and the Log button win.** Every other element is secondary and gives way to them at large text sizes.
2. **Numbers never move.** Loads, reps and timers use tabular numerals so the digits don't jitter as they change.
3. **Status is never colour alone.** Every status has an icon or a text label, and colour adds to it.
4. **Planned and actual values look different.** A target always carries the word "Target" or sits in a pending row style. Actual values are shown as done (see §7).
5. **Motion stays quiet.** There are no animated dashboards, progress rings, confetti or shimmer skeletons. Transitions are at most 200 ms and are removed under Reduce Motion.
6. **One accent colour.** The accent marks the single primary action and the active set. Semantic colours (done, warning, danger) are reserved for status.

---

## 2. Colour tokens

Dark mode is the default. Light mode follows the system setting, and Profile can override it (System / Dark / Light).

| Token | Dark | Light | Use |
|---|---|---|---|
| `color.bg.canvas` | `#0F1620` | `#F5F7FA` | Screen background |
| `color.bg.surface` | `#17202B` | `#FFFFFF` | Cards, sheets, bottom action bar |
| `color.bg.raised` | `#1F2A38` | `#EEF1F5` | Input fields, keypad keys, secondary buttons |
| `color.border.divider` | `#2A3646` | `#D9DEE5` | Decorative dividers only (not for control boundaries) |
| `color.border.control` | `#64748A` | `#7A8696` | Input and stepper outlines, secondary button outlines |
| `color.text.primary` | `#EEF2F6` | `#0F1620` | Main text, actual values |
| `color.text.secondary` | `#A9B4C2` | `#4A5666` | Labels, target values, metadata |
| `color.text.tertiary` | `#8593A3` | `#5F6B7A` | Pending-row icons, hints. Not for anything you must read to log |
| `color.accent` | `#5AA9FF` | `#0A63C9` | Primary button fill, active-set marker, links |
| `color.accent.pressed` | `#3F8FE6` | `#084FA1` | Pressed state of the primary button |
| `color.accent.subtle` | `#16304A` | `#E3EEFB` | Active-set row background, selected chip background |
| `color.on.accent` | `#0B1118` | `#FFFFFF` | Text and icons on `color.accent` |
| `color.status.done` | `#5CC98A` | `#1E7F45` | Completed-set icon, "Saved" confirmations |
| `color.status.done.subtle` | `#15301F` | `#E4F3EA` | Saved banner background |
| `color.status.warning` | `#F2B84B` | `#8A5A00` | Paused, equipment warning, stale proposal |
| `color.status.warning.subtle` | `#3A2C10` | `#FBF0D9` | Warning banner background |
| `color.status.danger` | `#FF7B72` | `#B3261E` | Destructive actions, errors, recording indicator |
| `color.status.danger.subtle` | `#3A1A1A` | `#FBE4E2` | Error banner background |
| `color.scrim` | `#000000` at 50% | `#0F1620` at 30% | Behind sheets |

### Contrast notes

I calculated these with the WCAG 2.x relative-luminance formula. Before shipping, re-check them in a contrast tool, along with any new token.

| Pair (dark) | Ratio | Pair (light) | Ratio |
|---|---|---|---|
| text.primary on bg.canvas | ~16.1:1 | text.primary on bg.surface | ~18.2:1 |
| text.primary on bg.raised | ~12.9:1 | text.secondary on bg.surface | ~7.5:1 |
| text.secondary on bg.canvas | ~8.7:1 | text.secondary on bg.canvas | ~7.0:1 |
| text.secondary on bg.raised | ~6.9:1 | text.tertiary on bg.surface | ~5.4:1 |
| text.tertiary on bg.canvas | ~5.8:1 | text.tertiary on bg.raised | ~4.8:1 |
| text.tertiary on bg.raised | ~4.6:1 (lowest; hints only) | accent on bg.surface (text/links) | ~5.8:1 |
| on.accent on accent (Log button) | ~7.7:1 | on.accent (white) on accent | ~5.8:1 |
| accent on bg.canvas | ~7.4:1 | accent on accent.subtle | ~4.9:1 |
| text.primary on accent.subtle | ~12.0:1 | text.primary on accent.subtle | ~15.5:1 |
| status.done on bg.canvas | ~8.8:1 | status.done on bg.surface | ~5.0:1 |
| status.warning on bg.canvas | ~10.2:1 | status.warning on bg.surface | ~5.9:1 |
| status.danger on bg.canvas | ~7.2:1 | status.danger on bg.surface | ~6.5:1 |
| border.control on bg.surface | ~3.4:1 (non-text ≥3:1) | border.control on bg.surface | ~3.7:1 |

Rules:
- All text meets 4.5:1 or better in both modes. Use `color.text.tertiary` only on canvas or surface, never on `accent.subtle`.
- `color.border.divider` is below 3:1 on purpose. Never use it as the only boundary of a tappable control.
- When the system "Increase Contrast" setting is on, use `color.text.secondary` wherever `color.text.tertiary` appears, and make dividers 2pt wide in `color.border.control`.

---

## 3. Typography

The typeface is the system font (SF Pro). React Native gives you this by default when no `fontFamily` is set. Every numeric display of a load, rep count, time, duration or set number uses tabular numerals (`fontVariant: ['tabular-nums']`). This applies everywhere, including set rows, the summary and toasts.

| Token | Size / line height (default text size) | Weight | Tabular | iOS text style it scales with | Max scale | Use |
|---|---|---|---|---|---|---|
| `type.timerDisplay` | 64 / 72 | Semibold | Yes | Large Title | 1.6× | Rest countdown, work timer |
| `type.loadDisplay` | 40 / 48 | Semibold | Yes | Large Title | 1.8× | Load and reps fields on the focused card |
| `type.title1` | 28 / 34 | Bold | No | Title 1 | 2.5× | Exercise name on the focused card |
| `type.title2` | 22 / 28 | Semibold | No | Title 2 | 2.5× | Screen titles, summary headings |
| `type.headline` | 17 / 22 | Semibold | When numeric | Headline | 3× | Button labels, row titles, Log button |
| `type.body` | 17 / 24 | Regular | When numeric | Body | 3× | Default body |
| `type.callout` | 16 / 22 | Regular | When numeric | Callout | 3× | Secondary text, set rows, "Last" line |
| `type.label` | 16 / 20 | Medium | When numeric | Callout | 3× | Chips, table headers, status labels, keypad hints |
| `type.keypad` | 28 / 34 | Regular | Yes | Title 1 | 1.5× | Custom keypad digits |

Rules:
- **The minimum size is 16pt.** No token goes below 16pt at the default text size. System tab bar labels follow iOS and are exempt.
- **Dynamic Type is on everywhere.** Display tokens (`timerDisplay`, `loadDisplay`, `keypad`) have a maximum scale because they start large. Every other token scales to the largest accessibility sizes.
- **At accessibility sizes (AX1 and above):** rows that sit side by side (load next to reps, the overview table columns, the summary label and value) stack vertically. Truncate exercise names after two lines with a tail ellipsis. Never truncate numbers or units.
- **Bold Text:** honour the setting by moving every weight up one step.
- **Number format:**
  - Use the locale decimal separator.
  - Never show a trailing `.0` (show `100 kg`, not `100.0 kg`). Show `.5` and `.25` where the equipment allows them.
  - Rest and work timers use `m:ss` (for example `1:47`). Elapsed workout time uses `m:ss` under an hour and `h:mm:ss` from an hour up.
  - Summary durations use `54 min` or `1 h 04 min`.
  - Use a no-break space between a number and its unit (`100 kg`) and around the multiplication sign (`100 kg × 8`).

---

## 4. Spacing, radii, layout

| Token | Value | Use |
|---|---|---|
| `space.1` | 4 | Icon–label gap |
| `space.2` | 8 | Gap between adjacent controls (minimum) |
| `space.3` | 12 | Space inside chips and rows |
| `space.4` | 16 | Screen side margin, card padding |
| `space.5` | 20 | Gap between card sections |
| `space.6` | 24 | Gap between regions |
| `space.8` | 32 | Large separation, e.g. Finish away from Log |
| `radius.sm` | 8 | Chips, keypad keys, inputs |
| `radius.md` | 12 | Buttons, set rows |
| `radius.lg` | 16 | Cards, sheets (top corners) |
| `radius.pill` | 999 | Gym chip, voice status pill, toasts |

Layout:
- The design width is 390pt (iPhone 15/16). Check it at 375pt (SE/mini width, still the minimum) and at 430pt.
- Respect safe areas. The bottom action bar sits on top of the home indicator inset.
- The focused card scrolls. The top bar and bottom action bar are fixed.
- **Thumb zone.** Primary and frequent workout controls live in the bottom 40% of the screen. Rarely used controls (the menu, Finish, Discard) go in the top bar.

---

## 5. Touch targets

| Token | Value | Applies to |
|---|---|---|
| `target.min` | 44 × 44 | Anything tappable anywhere (HIG minimum) |
| `target.workout` | 52 × 52 | Any control on the active workout screen: steppers, RPE chips, rest ±30 s, Skip, Talk |
| `target.primary` | full width × 60 | Log, Start, Resume, Finish, Done |
| `target.keypadKey` | ≥ 64 wide × 56 tall | Custom keypad keys |

Rules:
- Adjacent targets are at least `space.2` (8pt) apart. Where a hit area is larger than the visible control, the hit areas must not overlap.
- A destructive or session-ending control (Finish, Discard, Delete set) is never next to Log. Keep at least `space.8` between them, or put them in different bars.
- After a successful Log, ignore the Log button for **1.0 s** (`timing.commitGuard`). This stops a double tap from logging the next set by accident. The button shows "Saved" during the guard.

---

## 6. Motion, haptics, sound

| Token | Value |
|---|---|
| `timing.fast` | 150 ms ease-out (state swaps, toast in) |
| `timing.sheet` | System sheet animation |
| `timing.commitGuard` | 1000 ms |
| `timing.undoToast` | 8 s. With VoiceOver on, the toast stays until it is dismissed |
| `timing.valueChangeGuard` | 1000 ms. Log ignores taps for this long after a coach adjustment changes its label. Never applied to normal logging |
| `timing.coachTimeout` | 20 s. A coach adjustment request with no answer by then shows `The coach didn't answer in time. Nothing changed.` |
| `timing.coachBuildTimeout` | 60 s. A workout-builder request with no answer by then shows `The coach didn't answer in time. Nothing was built.` |
| `haptic.commit` | Success notification haptic |
| `haptic.undo` | Light impact |
| `haptic.step` | Selection change (steppers, keypad) |
| `haptic.restEnd` | Warning notification haptic (one per timer) |
| `sound.restEnd` | Short single chime. Plays only when cue mode is Quiet and timer sound is on (Profile) |

- The timer updates once per second with no animation or tick sound. It never shows a progress ring.
- With Reduce Motion on, replace slides with cross-fades or nothing.
- Each haptic has its own on/off switch in Profile → Voice & alerts. Haptics, timer sound and voice volume are separate settings.

---

## 7. Status styles (sets)

Never rely on colour alone. Every status also has an icon and a text label, and VoiceOver reads the label.

| Status | Icon (SF Symbol) | Colour | Text label / VoiceOver | Values shown |
|---|---|---|---|---|
| Done | `checkmark.circle.fill` | `status.done` icon; values in `text.primary` | "Done" | Actual: `100 kg × 8` (+ `RPE 8` if entered) |
| Done, edited | as Done + `pencil` tag | as Done | "Done, edited" | Corrected actual; history keeps the original |
| Active (current) | `arrowtriangle.right.fill` | `accent` icon, 4pt `accent` left bar, `accent.subtle` row background | "Now" | Draft values in editable fields, with the target beside them |
| Pending | `circle` | `text.tertiary` icon; values in `text.secondary` | "Target" | `Target 100 kg × 6–8` |
| Skipped | `slash.circle` | `text.tertiary` | "Skipped" | Target only, labelled "Skipped" |

Set-type badges sit next to the set number and are always text, never colour alone. They are: `W` Warm-up, `T` Top, `B` Back-off and `D` Drop. Working sets have no badge. The full word is shown in the focused card header and read by VoiceOver.

Side badges (unilateral exercises only; revision 2026-10-08): `L` Left and `R` Right, same style as set-type badges, read as "left side" / "right side". `Both sides` sets have no badge. Deleted sets have no status style: they are not shown in set lists (audited record only).

Target source (revision 2026-10-08, ADR 0006). A target's source is shown only where it matters, always as text:

| Source | Where shown | Style | VoiceOver |
|---|---|---|---|
| Plan / built-in rule (in workout) | Default; no tag | `Target 100 kg × 6–8` | "Target …" |
| Coach (in workout, pending sets) | Focused card, mini list, Overview | Label `Coach target`, `TargetSourceTag` `Coach`; Overview text badge `C` (set-type badge style); second line `Plan was …` in `text.secondary` | "Coach target, … Plan was …" |
| Coach (summary `Next time`) | Summary rows | `TargetSourceTag` `Coach` | "Source: coach" |
| Built-in rule (summary `Next time`) | Summary rows | `TargetSourceTag` `Built-in rule`, `Built-in rule (coach offline)` or `Built-in rule (coach unavailable)` | Same text |

**`TargetSourceTag`**: a text tag, `type.label`, `text.secondary` on `bg.raised`, `radius.sm`, padding `space.1`/`space.2`. The `Coach` tag adds the `text.bubble` icon before the word (the same icon as the Talk button's text state). It is not tappable on its own. It never uses `accent` (accent stays for the primary action and the active set) and never relies on colour.

Session status labels (top bar / Today):

| State | Icon | Colour | Label |
|---|---|---|---|
| Resting | `timer` | `accent` | "Rest 1:47" |
| Ready | `figure.strengthtraining.traditional` | `text.primary` | "Ready" |
| Paused | `pause.circle.fill` | `status.warning` | "Paused" |
| Saved locally | `checkmark.circle.fill` | `status.done` | "Saved on this phone" |

---

## 8. Load and unit conventions (display)

Every load shows its unit. If the convention isn't total load, it also shows a suffix.

| Convention | Display | Spoken |
|---|---|---|
| Barbell total | `100 kg` | "100 kilos" |
| Per dumbbell | `22.5 kg each` | "22.5 kilos each" |
| Weight stack | `45 kg stack` | "45 on the stack" |
| Added plates (plate-loaded machine) | `40 kg plates` | "40 kilos of plates" |
| Assisted | `Assist 20 kg` | "20 kilos of assistance" |
| Bodyweight + added | `BW + 10 kg` | "bodyweight plus 10 kilos" |
| Bodyweight | `BW` | "bodyweight" |
| Duration | `0:45` | "45 seconds" |

Use `lb` and "pounds" in the same way. Never convert units silently. The unit comes from the equipment instance, not a global setting.

---

## 9. Core components

Each component lists its anatomy, sizes, states and accessibility. Screen specs say where each one is used.

### 9.1 Bottom action bar (`ActionBar`)
- This is a fixed bar at the bottom of the active workout. It holds the **Talk button** (left, 60 × 60) and the **primary button**, which fills the rest of the width. The gap between them is `space.2`.
- **When the keyboard or keypad is open, the bar sits directly above it.** The primary action is therefore always visible.
- It sits on `bg.surface` with a top `border.divider`, and its padding is `space.3` vertical and `space.4` horizontal.
- The bar stays visible at every Dynamic Type size. If the primary label gets too long, it wraps to two lines. The bar height then grows, but the button is never shortened.

### 9.2 Primary button (`PrimaryButton`), including the Log button
- 60pt tall, full width of its container, `radius.md`, fill `accent`, label `type.headline` in `on.accent`.
- **The label always states what will happen, including the values.** For example: `Log 100 kg × 8`, `Log 22.5 kg each × 10`, `Log 0:45`, `Resume`, `Finish workout`.

| State | Look | Label example |
|---|---|---|
| Enabled | accent fill | `Log 100 kg × 8` |
| Pressed | `accent.pressed` | same |
| Saving (rarely seen; local write) | accent fill, spinner replaces icon | `Saving…` |
| Commit guard (1 s) | `status.done.subtle` fill, `status.done` check icon, `text.primary` label | `Saved` |
| Disabled (incomplete values) | `bg.raised` fill, `text.secondary` label | `Enter reps` / `Enter load` |
| Paused session | accent fill | `Resume` |

- VoiceOver label: "Log set 2, 100 kilograms, 8 reps". Hint: "Saves this set and starts rest".

### 9.3 Set row (`SetRow`)
- At least 52pt tall, `radius.md`, padding `space.3`.
- Columns: status icon with set number and type badge, Last (previous comparable), Target, Done (actual), and an optional RPE.
- Status styles come from §7. Pending rows show the target. Done rows show the actual. The active row shows editable fields.
- Taps:
  - A Done row opens the correction sheet.
  - A Pending row makes that set the active one.
  - The Active row puts focus on its load field.
- Swipe left on a Done row shows Delete. This asks for confirmation and gives an Undo toast. Swipe gestures are never the only way to do anything.
- At AX sizes, Last and Target stack under the set number, and Done goes on its own line.

### 9.4 Number field with stepper (`NumberStepper`)
- Anatomy: [− button 52 × 52] [value field] [+ button 52 × 52], with the unit label inside the field. For example, `100 kg` shows the digits in `type.loadDisplay` and the unit in `type.label`.
- **Load steps follow the equipment:** the step goes to the next feasible load up or down, from `getAchievableLoads` / `roundToAvailableLoad`. The buttons' accessibility labels name the destination ("Decrease to 97.5 kilograms").
- **Reps step by 1.** Durations step by 5 s.
- Field states: Default (`bg.raised`, `border.control` 1pt), Focused (2pt `accent` border), Draft-from-target (value in `text.primary` with a "Target" caption below), Invalid (2pt `status.warning` border with inline message), Disabled.
- The stepper stops at the equipment minimum and maximum. The disabled side shows its reason in the accessibility hint, for example "Rack maximum 30 kilograms".

### 9.5 Custom keypad (`WorkoutKeypad`)
- This replaces the system keyboard for load, reps and duration fields. It is 4 columns by 4 rows, and each key is at least 64 × 56, on `bg.raised`.

```
┌────────┬────────┬────────┬────────────┐
│   1    │   2    │   3    │  ↓ 97.5    │  feasible step down
├────────┼────────┼────────┼────────────┤
│   4    │   5    │   6    │  ↑ 102.5   │  feasible step up
├────────┼────────┼────────┼────────────┤
│   7    │   8    │   9    │    ⌫       │
├────────┼────────┼────────┼────────────┤
│   .    │   0    │  Hide  │  Next ›    │  Next: load → reps
└────────┴────────┴────────┴────────────┘
```
- For reps, the step keys read `↓ 7` / `↑ 9`. The `.` key is disabled for reps.
- On the reps field, `Next ›` reads `Done`. It closes the keypad and does **not** log the set. Logging stays on the primary button, which sits directly above the keypad.
- The first key press replaces the selected value. It does not append to it.
- VoiceOver: each key is a button. Keys can also be typed with an external or hardware keyboard.
- Fallback: if the custom keypad fails accessibility testing, use the system `decimalPad` with the action bar as its input accessory view.

### 9.6 Rest timer (`RestTimer`)
- It lives inside the focused card (full version) or in a bar above the action bar (compact version, used in Overview).
- **Full version:** label `Rest` (`type.label`, `text.secondary`), countdown in `type.timerDisplay`, and a control row with [−30 s] [+30 s] [Skip], each `target.workout`. Tap the time to edit the duration.
- **Compact version:** 52pt tall: `Rest 1:47` · [−30] [+30] [Skip].
- States:
  - **Running:** accent `timer` icon.
  - **Ended:** label `Ready when you are`, plus a count-up `Rested 2:12` in `text.secondary`.
  - **Paused:** `pause.circle.fill` in warning, with the label `Paused`.
- The countdown is always worked out from the saved deadline. It is never a counter running in memory.
- VoiceOver announces the remaining time only when asked (not every second), and announces "Rest done" when it ends.

### 9.7 Gym chip (`GymChip`)
- A pill, at least 44pt tall: `building.2` icon, gym name and a `chevron.down`. Text is `type.label` on `bg.raised`.
- Tapping it opens the gym switcher sheet.
- If the session has temporary restrictions, a small `exclamationmark.triangle` and the text "1 busy" are added.
- If no gym is set, it reads `Add gym`.

### 9.8 Coach / Talk button (`TalkButton`)
- In the active workout it is a 60 × 60 square in the action bar (left). On other screens it is a floating 52pt pill labelled `Ask`, placed bottom-trailing above the tab bar and never covering a primary button.
- The icon and label show the state. Colour is never the only signal.

| State | Icon | Caption (under icon / pill text) |
|---|---|---|
| Voice ready | `mic` | `Talk` |
| Text only (no voice route) | `text.bubble` | `Ask` |
| Listening | `mic.fill` in `status.danger` + pulsing dot replaced by static dot under Reduce Motion | `Stop` |
| Processing | `ellipsis` | `Wait` |
| Speaking | `speaker.wave.2` | `Stop` |
| Coach unavailable | `text.bubble` with `slash` | `Offline` |

- Tapping it while the coach is unavailable still opens the coach sheet, which explains why. The control never vanishes.

### 9.9 Voice status pill (`VoiceModePill`)
- This is in the active workout status row. It shows the cue mode: `Quiet` (`speaker.slash`), `Cues` (`speaker.wave.1`) or `Talk` (`waveform`).
- While the microphone is open it shows a red recording dot and `Mic on`, as text and icon.
- Tapping it opens the cue-mode menu (see rest-state.md).

### 9.10 Undo toast (`UndoToast`)
- A pill on `bg.surface` with a 1pt `border.control` outline, placed `space.2` above the action bar. **It never covers the action bar or the rest controls.**
- Content: a status icon and a message, plus an `Undo` text button (`accent`, at least 44 × 44).
- Example: `✓ Set 2 saved · 100 kg × 7` [Undo].
- It stays for `timing.undoToast`. A new toast replaces the old one, and the replaced action can still be undone from its row.
- VoiceOver announces it politely and keeps it until it is dismissed.

### 9.11 Change-review card (`ChangeReviewCard`)
- Used for exercise swaps, gym switches, compensating proposals from an unsafe Undo, and other changes that need Apply. It is an inline card, never a full-screen interruption. **Coach adjustments to today's remaining sets don't use it** (they apply at once: `CoachAdjustmentBanner`, §9.15), and summary next-time proposals use `CoachTargetProposal` (§9.16).

```
┌──────────────────────────────────────┐
│ Suggested change · Today only        │
│ Lighter back-off sets after a hard   │
│ top set (RPE 10).                    │
│                                      │
│ Set 3   Target 100 kg × 6–8          │
│      →  Target 92.5 kg × 6–8         │
│ Set 4   Target 100 kg × 6–8          │
│      →  Target 92.5 kg × 6–8         │
│                                      │
│ Why? ›                               │
│ [ Not now ]          [ Apply ]       │
└──────────────────────────────────────┘
```
- The scope label is always shown: `Today only` or `Future sessions` (the template).
- Each line shows before and after, labelled as targets. Completed sets never appear as "after" values.
- `Why? ›` opens evidence from `getDecisionEvidence`.
- After Apply, the card collapses to `✓ Applied · Remaining sets updated for today` with [Undo].
- **Stale state:** if the session version changed, the card shows the warning icon and `Out of date. Your workout changed since this was suggested.` Apply is disabled and a [Dismiss] button appears.
- Apply is a secondary-style accent button, not `PrimaryButton`. This keeps Log as the only primary action on the workout screen.

### 9.12 Banners (`StatusBanner`)
- An inline banner, 44pt minimum, showing an icon, one line of text and an optional action. It uses the `.subtle` background of its status colour.
- It is used for offline, coach-unavailable, paused, restored-after-close and equipment warnings. Banners never stack more than two deep. Lower-priority banners collapse into the status row.
- Coach adjustments never use `StatusBanner`; they use the card's coach slot (§9.15).

### 9.13 Adjust control (`AdjustControl`)
- A text button `Adjust` (`type.label`, `accent`, `slider.horizontal.3` icon) in the exercise header line, left of `⋯`, in Ready and Resting, Focus and Overview. Hit area `target.workout` (52 × 52), like every active-workout control; it sits away from the Log thumb zone because it is used rarely.
- Tapping opens an inline **reason-chip row** under the header: prompt `What should change?` (`type.label`, `text.secondary`), chips `Too hard` · `Too easy` · `Pain` · `Type…` (each `target.workout` tall, `radius.sm`, `bg.raised`, `border.control` outline) and a close `xmark` (`target.workout`). Chips wrap to 2 × 2 at AX1+.

| State | Look | Caption |
|---|---|---|
| Available | accent text + icon | `Adjust` |
| Chips open | `accent.subtle` fill behind the label | `Adjust` |
| Coach working | `ellipsis` icon, `text.secondary` | `Adjust` (tapping shows the pending line) |
| Coach offline / not connected | `text.secondary` label + `slash` on the icon, second line `Coach offline` | `Coach offline`. Still tappable: it explains, offers only `Pain` |

- VoiceOver: "Adjust remaining sets, button". Offline: "Adjust remaining sets. Coach offline."

### 9.14 Coach offer line (`CoachOfferLine`)
- Lives only in the rest card's coach slot. No card border, no fill, no icon animation.
- Anatomy: line 1 question (`type.callout`, `text.primary`), line 2 trigger fact (`type.callout`, `text.secondary`, tabular numerals), row of two text buttons with `target.workout` hit areas: `No thanks` (left, `text.secondary`) and `Adjust` (right, `accent`). Gap ≥ `space.8` between them.
- Never a modal, never auto-focused, never announced as an alert. VoiceOver announces it politely once: "That looked hard. Adjust remaining sets? RPE 10 on set 2."

### 9.15 Coach adjustment banner (`CoachAdjustmentBanner`)
- Lives in the focused card's coach slot (Focus) or under the active exercise header (Overview). `bg.surface`, 1pt `border.control`, `radius.md`, padding `space.3`. Not a toast: it doesn't time out; it collapses on the next Log.
- Anatomy:
  1. `text.bubble` icon + `Coach adjusted sets 3–4` (`type.headline`).
  2. `100 → 97.5 kg × 8 · <reason>` (`type.callout`; numbers tabular; reason max 2 lines, tail ellipsis).
  3. Optional guard note (`type.callout`, `text.secondary`, `info.circle` icon; pain block uses `exclamationmark.triangle` in `status.warning`).
  4. Row: `Why? ›` (left, `accent` text) and `Undo` (right, `accent` text button); both `target.workout` hit areas, ≥ `space.8` apart.
- Variants (same frame, no Undo): **pending** (`ellipsis` icon, `Coach is working on sets 3–4` / `Nothing has changed yet.` / `Cancel`), **outcome** (blocked, no change, timed out, failed, stale; `info.circle` or `exclamationmark.triangle` + text), **undone** (`arrow.uturn.backward` + `Back to the plan for sets 3–4.`).
- No progress animation. The pending icon is static; Reduce Motion changes nothing because nothing moves.
- VoiceOver announces the applied line politely, including both numbers: "Coach adjusted sets 3 and 4, from 100 to 97.5 kilograms, 8 reps."

### 9.16 Coach target proposal (`CoachTargetProposal`, summary only)
- One per exercise under `Next time`. Rows: exercise name + `TargetSourceTag` `Coach`; scope line (`From next Push A`); a two-row before/after table `Built-in rule  100 kg × 6–8` / `Coach  97.5 kg × 6–8` (labels `text.secondary`, values `text.primary`, tabular); the coach's reason; optional guard note; action row `Why? ›` · `Not now` · `Apply` (Apply is a secondary-style accent button, not `PrimaryButton`, so `Done` stays the only primary).
- Collapsed states: `✓ Coach target applied to next Push A: 97.5 kg × 6–8` [Undo]; `Built-in rule: 100 kg × 6–8 next time` + `Show coach suggestion`; `Out of date` (warning icon + text, Apply disabled, [Dismiss]).

### 9.17 Parameter chip (`ParamChip`, workout builder)
- Same frame as the Adjust reason chips: 52pt tall, `radius.sm`, `bg.raised`, 1pt `border.control`, label `type.label` in `text.primary`.
- Selected: `accent.subtle` fill + `checkmark` icon before the label (never colour alone). Single-select groups allow deselecting by tapping again.
- Chips wrap; at AX1+ one per row. VoiceOver: "45 minutes, selected, length".

### 9.18 Draft exercise row (`DraftExerciseRow`, workout builder)
- `bg.surface`, `radius.md`, padding `space.3`, rows separated by `border.divider`. Lines: name + equipment (`type.headline`), set scheme, `Target …` load, `Last …` (actual, `text.secondary`), optional `Built-in rule …` (`text.secondary`), optional guard note, `Rest m:ss`. All numbers tabular.
- Superset members sit behind a 4pt `border.control` left bracket labelled `Superset A · 3 rounds`.
- Diff markers (shown only when `Show changes` is on): `pencil` + `Changed`, `plus.circle` + `Added`, `minus.circle` + `Removed` (row text in `text.secondary` with strikethrough). Marker words are `type.label`; never colour alone, never `accent`.

### 9.19 Guard note list (`GuardNoteList`)
- Heading `Checks (n)` (`type.headline`). Each note: icon + one or two lines `type.callout`. `info.circle` in `text.secondary` for swapped/rounded/capped/removed; `exclamationmark.triangle` in `status.warning` for pain exclusions and over-length. Same note text as the row-level note. Text comes from the validator, never the model.

### 9.20 Workout draft card (`WorkoutDraftCard`, coach sheet)
- Inline card in the conversation: `bg.surface`, 1pt `border.control`, `radius.md`. Pending: static `ellipsis` icon + `Building …` + `Cancel`. Ready: `TargetSourceTag` `Coach`, name + version, counts + estimate, `Checks: n`, and `Review ›` (secondary-style accent button). Never opens a screen by itself.

---

## 10. Accessibility checklist (applies to every screen)

- Every control has a VoiceOver label that includes its values and units. Loads are read as "kilograms" or "pounds" in full.
- Focus order is: top bar → exercise header → current set → rest → action bar.
- Every gesture has a button equivalent.
- The screen is usable at AX3 text size without horizontal scrolling. The Log button stays visible.
- When a Bluetooth keyboard is connected, Return in the reps field acts like `Done`. Cmd+Return logs the set.
- Status is always conveyed by icon or text as well as colour (§7).
