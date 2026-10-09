# Design system

> **Revision 2026-10-08.** Added `L` / `R` side badges for unilateral sets and noted that deleted sets aren't shown (§7), per [ADR 0003](../decisions/0003-domain-review-decisions.md). No token values changed.
>
> **Revision 2026-10-08 (coach-led progression, v0.4).** For [ADR 0006](../decisions/0006-coach-led-progression.md) and [coach-adjustments.md](coach-adjustments.md): new timing tokens `timing.valueChangeGuard` and `timing.coachTimeout` (§6); target source styles and the `TargetSourceTag` (§7); `ChangeReviewCard` scope narrowed to swaps, gym changes and summary proposals (§9.11); new components `AdjustControl` (§9.13), `CoachOfferLine` (§9.14), `CoachAdjustmentBanner` (§9.15) and `CoachTargetProposal` (§9.16). No colour values added: coach UI uses existing tokens, so the one-accent rule holds.

> **Revision 2026-10-08 (workout builder, v0.5).** For [workout-builder.md](workout-builder.md): new timing token `timing.coachBuildTimeout` (§6) and components `ParamChip` (§9.17), `DraftExerciseRow` with diff markers (§9.18), `GuardNoteList` (§9.19) and `WorkoutDraftCard` (§9.20). No colour values added.

> **Revision 2026-10-08 (Progress tab).** For [progress.md](progress.md): chart colour **aliases** of existing tokens (§2.1; no new colour values, one accent kept), number formats for fractional sets, changes and estimates (§3), chart dimension tokens (§4.1), components `Sparkline` (§9.21), `TrendRow` (§9.22), `TrendChart` (§9.23), `ChartMarker` (§9.24), `VolumeBandRow` (§9.25), `WeekStrip` (§9.26), `ChartDataTable` (§9.27), `SourceTag` (§9.28), `ResumeBar` (§9.29) and `CalendarDay` (§9.30), and chart items in the accessibility checklist (§10).

> **Revision 2026-10-08 (consolidation).** Merged the "Proposed design-system additions" sections from onboarding, profile-and-settings, gym-editor, coach-sheet, coach-memory, ai-connection, voice, coaching-playbook, routines, exercise-library, weekly-plan, change-review, data-import-export, lock-screen-and-alerts and system-states. Those sections now point here; where they disagree, this file wins.
> - **Duplicates given one canonical name** (old names kept as aliases, §11): `SourceTag` now covers `TargetSourceTag`, `ProvenanceTag` and the routine/change-review author tags (§9.28); `StatusBanner` covers `AttentionRow` (§9.12); `StatusRow` + `StatusLabel` are one row and one vocabulary (§9.40); `SecureKeyField` is defined once (§9.45); `ClarifyChips` once (§9.37); `StepRow` covers `StepResultLine` (§9.42); `NoteLine` covers guard notes, conflict notes and load-preview warnings (§9.43); the card families are `ResultCard` (something already happened, with Undo), `SuggestionCard` (nothing happens until Ben taps) and `ProposalCard` (a summary that opens the Review screen); `ChangeReviewCard` (§9.11) is the inline `SuggestionCard` for plan changes and is extended per change-review.md.
> - **Two approved changes from Ben (via the product manager) applied here:** data is split into **Your data** and **Coaching knowledge** (§7.2, `DomainLabel` §9.53); backups are stored **in the app by default**, with off-phone copies optional, and three distinct durability phrases (§7.1).
> - **Timing tokens added** (§6): `timing.placeholderDelay`, `timing.staleWorkout`, `timing.spokenOfferMinRest`, `timing.cueOverlapWait`, `timing.lateCueDrop`, `timing.coachStreamStall`, `timing.signInTimeout`, `timing.voiceEndSilence`, `timing.voiceMaxUtterance`, `timing.voiceClarifyWindow`, `timing.clarifyExpiry`, `timing.ttsFallback`, `timing.offPhoneReminder`, `timing.coverDelay`, `timing.expiryNotice`, `timing.expiryUrgent`, `timing.expiryReminder`, `timing.loudModeMinRest`, `timing.stillRunningReminder`. `timing.coachFirstToken` (coach-sheet) is merged into `timing.coachTimeout` (same 20 s, same copy).
> - **Status vocabularies added to §7**: capability, backup, schedule, proposal/action, memory and import-match statuses, with one icon per meaning (e.g. every warning-level state uses `exclamationmark.triangle` + `status.warning`; `Not working` no longer uses `xmark.octagon`).
> - Added `SecondaryButton` and `DangerTextButton` (§9.2a, §9.2b), money format (§3), `type.liveCountdown` (§3), Live Activity colour mirror and app icon / launch tokens (§2.2). **No new colour values; one accent kept.**

> **Revision 2026-10-09 (pre-workout check-in, brief v0.9).** For [check-in.md](check-in.md): new timing token `timing.checkInReuse` (§6); check-ins listed under Your data (§7.2); `UndoToast` may carry `Change` instead of `Undo` for a check-in (§9.10); `CoachOfferLine` may also sit in the first set card's coach slot in Ready for the check-in offer (§9.14); `TrendChart` gains a `pointsOnly` variant for self-reported 1–5 ratings (§9.23); new components `CheckInScale` (§9.54), `CheckInSheet` (§9.55) and `CheckInLine` (§9.56); index rows (§11). The readiness chips they replace had no component of their own. **No new colour values; one accent kept.** Check-in values are never shown as a score, ring, gauge or colour scale.

> **Revision 2026-10-09 (exercise guides, [ADR 0013](../decisions/0013-in-app-guide-playback.md); approved by Ben 9 Oct 2026).** Principle 5 gains the one exception to "motion stays quiet": the exercise guide (research brief change 3). Added guide colour **aliases** (§2.3, no new colour values, never `accent`), guide timing values (§6), the `ExerciseGuide` component (§9.57), an accessibility checklist line (§10) and an index row (§11). The screen is specified in [exercise-library.md](exercise-library.md) §8. **The app is now called GymSmarter.** New copy uses that name; "Fizz" in older specs means GymSmarter. Identifiers containing "fizz" are unchanged (decisions/README.md). **Gap to note, not fixed here:** the code's default look is Direction D (provisional-2026-10-09.md, decision 1), whose colour values live in `apps/mobile/src/theme/tokens.ts` and research, not in §2. Until §2 records them, this file is not yet the single source for the default look's values; token *names* and roles still match.

Status: v0.1 draft, 8 Oct 2026. This file is the only source of design tokens. Screen specs refer to tokens by name (for example `color.accent`, `type.loadDisplay`). Developers implement these values directly in `apps/mobile` (a single `theme.ts` is enough). If you need a value that is not here, add it here first. Don't hard-code it in a screen.

Context: one person uses the app on an iPhone, one-handed, mid-workout, with sweaty fingers and headphones, often in bright or dim gym light. Every choice below favours speed, legibility and calm over decoration.

---

## 1. Principles

1. **The current set and the Log button win.** Every other element is secondary and gives way to them at large text sizes.
2. **Numbers never move.** Loads, reps and timers use tabular numerals so the digits don't jitter as they change.
3. **Status is never colour alone.** Every status has an icon or a text label, and colour adds to it.
4. **Planned and actual values look different.** A target always carries the word "Target" or sits in a pending row style. Actual values are shown as done (see §7).
5. **Motion stays quiet.** There are no animated dashboards, progress rings, confetti or shimmer skeletons. Transitions are at most 200 ms and are removed under Reduce Motion.
   **The one exception is the exercise guide** (`ExerciseGuide`, §9.57; approved 9 Oct 2026). A looping movement demonstration is allowed, but only:
   - **on the How to screen**, which Ben opens himself (exercise-library.md §8). It never appears in rows, the Log card, the rest screen, Today, the Live Activity or a notification;
   - **in neutral tones only**, using the guide colour aliases (§2.3). Never `accent` or a status colour, no colour-highlighted muscles and no text in the art;
   - **briefly**: at the guide's own tempo, autoplay stops after `guide.autoplayPasses` (3 reps) and holds the start position with `Replay`. `Pause` is always visible while it moves;
   - **if Reduce Motion is off.** With Reduce Motion on, Ben sees still key positions with `Previous` / `Next` and an opt-in `Play animation`. Turning Reduce Motion on stops a running animation at once, and turning it off never starts one;
   - **while on screen**: it pauses whenever it is off-screen (scrolled out of view, covered or closed, app in the background, phone locked);
   - **silently**: no sound, speech or haptics, and it doesn't touch the audio session.
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

### 2.1 Chart colour aliases (revision 2026-10-08, Progress)

Charts use **aliases** of the tokens above. No new colour values exist, and charts add no second accent. Implement them as references in `theme.ts` so both modes switch together.

| Token | Alias of | Use |
|---|---|---|
| `color.chart.line` | `color.text.primary` | Trend line, sparkline line |
| `color.chart.point` | `color.text.primary` | Data points |
| `color.chart.selected` | `color.accent` | Selected point ring and its vertical guide line only (selection is the "active" item) |
| `color.chart.grid` | `color.border.divider` | Horizontal gridlines. Decorative only |
| `color.chart.axisText` | `color.text.secondary` | Axis labels, unit labels, month ticks |
| `color.chart.bandFill` | `color.bg.raised` | Reference band fill (e.g. the 10–20 sets guide). Decorative only |
| `color.chart.bandEdge` | `color.border.control` | Band edge lines (≥ 3:1 non-text contrast) |
| `color.chart.bar` | `color.text.secondary` | Volume bars, endurance weekly bars |
| `color.chart.marker` | `color.text.secondary` | Coach, deload, edited and gap markers (always icon + word) |
| `color.chart.markerPain` | `color.status.warning` | Pain marker and span (always with `exclamationmark.triangle` + `Pain`) |

Rules:
- **One series per chart.** No chart needs a colour legend. Comparing series means switching the series picker, never overlaying lines in different colours.
- The trend line is never `accent`. `accent` appears in a chart only for the selected point.
- Up/down changes never use `status.done` or `status.danger`: a lower number isn't a failure (it may be a deload). Use arrow icons and words in `text.secondary`.
- Meaningful graphics (line, points, bars, band edges, selected ring) need ≥ 3:1 against `bg.surface` and `bg.canvas` in both modes: `text.primary` and `text.secondary` exceed 7:1, `border.control` is 3.4:1 (dark) and 3.7:1 (light), `accent` exceeds 5.8:1. Re-check if any alias target changes.

### 2.2 Surfaces outside the app (revision 2026-10-08, consolidation)

These surfaces can't import `theme.ts`, so they **mirror** existing values in a comment-labelled constant. No new colour values.

| Token | Value | Use |
|---|---|---|
| `widget.accent` | mirror of `color.accent` (`#5AA9FF` dark / `#0A63C9` light) | Live Activity `timer` icon only (lock-screen-and-alerts.md §2.1) |
| `widget.warning` | mirror of `color.status.warning` (`#F2B84B` / `#8A5A00`) | Live Activity paused icon, always with the word `Paused` |
| `widget.text` | system primary / secondary label colours on the system material | Live Activity text. With `isLuminanceReduced`: regular weight, no accent tint |
| `icon.canvas` | `color.bg.canvas` dark `#0F1620` | App icon background (system-states.md §6.1) |
| `icon.mark` | `color.accent` dark `#5AA9FF` | App icon ring and bubbles; dark icon mark; tinted icon uses white |
| `launch.bg` | `color.bg.canvas` per appearance | Launch screen background |
| `launch.mark` | `color.accent` per appearance | Launch screen mark, 96pt wide, no text, no spinner |

Re-check contrast for these mirrors whenever the source tokens change.

### 2.3 Exercise guide colour aliases (revision 2026-10-09, ADR 0013)

Guides use **aliases** of six neutral tokens, and nothing else. There are no new colour values, and `accent` is deliberately excluded. The code's single source is `GUIDE_TOKEN_NAMES` / `GUIDE_PAINT_TOKENS` in `packages/catalogue/src/figure/style.ts`. The app resolves them from the live theme, so they follow the active look and dark/light. The Linux preview renderer uses a mirror, and a test fails if the mirror drifts from `theme/tokens.ts`.

| Token | Alias of | Use |
|---|---|---|
| `color.guide.background` | `color.bg.surface` | Canvas fill (inside a `Card`), corners `radius.md` scaled to the canvas (12pt at 240pt) |
| `color.guide.nearBody` | `color.text.secondary` | Near-side body and limbs (>7:1 on the canvas) |
| `color.guide.farBody` | `color.border.control` | Far-side limbs drawn behind (≥3:1 non-text) |
| `color.guide.implement` | `color.text.primary` | Bar, dumbbells, kettlebell, sled: the highest contrast, so the load path reads first |
| `color.guide.frame` | `color.border.control` | Machine frames, bench outlines |
| `color.guide.frameFill` | `color.bg.raised` | Pads, seat and bench fills. Decorative only |
| `color.guide.trace` | `color.text.tertiary` | Static bar-path trace and floor line (dashed) |
| `color.guide.cable` | `color.text.tertiary` | Cable lines |

Rules:
- Working muscles are never colour-highlighted; the header's `Main muscles:` text carries that meaning (principle 3).
- Nothing in a guide may use `accent`, `status.*` or chart aliases. The accent stays reserved for the single primary action and the active set (principle 6).
- Labels and captions are app text under the canvas, never drawn into the art. They can then scale with Dynamic Type and be read by VoiceOver.

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
| `type.liveCountdown` | Banner 28 semibold; Dynamic Island expanded trailing 24 semibold; compact trailing system size | Semibold (regular when luminance is reduced) | Monospaced digits (`.monospacedDigit()`) | System-rendered | — | Live Activity countdown only (lock-screen-and-alerts.md). Widget-only; not used in the app |

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
  - Fractional set counts (helper muscles count ½) use the `½` glyph: `7½`, never `7.5 sets`. VoiceOver: "7 and a half".
  - Changes: arrow icon + word + magnitude, `Up 7.5 kg since 16 Jul` / `Down 5 kg …` / `Same load as …`. Never a bare `+7.5` and never a percentage.
  - Estimates: `≈` before the value and the word "estimate" (or `Est.`) on the same line, e.g. `≈ 123 kg (estimate)`. Estimates are rounded to 0.5 kg / 1 lb and are never snapped to achievable loads (they aren't targets).
  - Date ranges: `9 Apr – 8 Oct`; weeks `Week of 5 Oct` or `5–11 Oct`; chart month ticks `Apr`; across a year boundary `Dec 2025`.
  - Money (revision 2026-10-08, consolidation): USD with two decimals and tabular numerals (`$1.42`, `$5.00`). Any figure the app worked out itself carries the word `estimate` on the same line or in its heading (`October (estimate)`), plus the price-table date (ai-connection.md §2.9).
  - Dates in proposals and plan changes are local and written in full (`Thu 15 Oct`), never "tomorrow" (change-review.md §5).
  - Counts in data screens use thousands separators (`4,105 sets`), tabular.

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

### 4.1 Chart dimensions (revision 2026-10-08, Progress)

| Token | Value | Use |
|---|---|---|
| `chart.sparkline` | 96 × 32 | `TrendRow` sparkline. Hidden at AX1+ |
| `chart.detailHeight` | 220 | `TrendChart` plot area at default text sizes |
| `chart.detailHeightAX` | 280 | Plot area at AX1+ (axis labels are larger) |
| `chart.lineWidth` | 2 | Trend and sparkline lines (3 under Increase Contrast) |
| `chart.point` | 6 diameter | Data points. Selected: 10 with a 2pt `chart.selected` ring |
| `chart.markerLane` | 28 tall | Marker row under the x-axis |
| `chart.bandBar` | 12 tall | `VolumeBandRow` bar |
| `chart.weekBar` | 8 wide, gap 4 | Endurance weekly bars |

Charts never animate their drawing, values or axes. Changing a chip redraws at once.

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
| `timing.coachTimeout` | 20 s. A coach adjustment request, a coach-sheet turn or a voice question with no first answer (first chunk, tool call or result) by then shows `The coach didn't answer in time. Nothing changed.` Replaces coach-sheet's `timing.coachFirstToken` |
| `timing.coachStreamStall` | 20 s without a new chunk in the middle of a coach reply → `The reply was cut off. Anything applied is shown above.` (coach-sheet.md §3) |
| `timing.coachBuildTimeout` | 60 s. A workout-builder request with no answer by then shows `The coach didn't answer in time. Nothing was built.` |
| `timing.signInTimeout` | 5 min. ChatGPT sign-in listener and browser sheet close; `Sign-in took too long. Nothing was connected.` (ai-connection.md §2.3) |
| `timing.placeholderDelay` | 300 ms. A local read that takes longer than this shows static grey placeholder rows (never shimmer). Under it, nothing extra shows |
| `timing.coverDelay` | 1 s. A start-up or data operation shorter than this shows no `BlockingCover` (system-states.md §3.6) |
| `timing.staleWorkout` | 6 h since the last activity. Under it a cold launch opens the workout (P6) and the `ResumeBar` shows; at or over it, Today shows the stale-workout card |
| `timing.spokenOfferMinRest` | 20 s. A coach offer may be spoken (Conversation mode only) only while Resting with at least this much left |
| `timing.cueOverlapWait` | 3 s. A scripted cue that would overlap a coach reply waits up to this long, then is dropped if stale |
| `timing.lateCueDrop` | 5 s. A spoken cue later than this is not spoken |
| `timing.voiceEndSilence` | 1.2 s of quiet ends a tap-mode utterance (voice.md VO1) |
| `timing.voiceMaxUtterance` | 12 s hard stop for one utterance |
| `timing.voiceClarifyWindow` | 8 s. The mic stays open this long after a spoken clarification question |
| `timing.clarifyExpiry` | 30 s. An unanswered voice clarification closes as `Not saved` |
| `timing.ttsFallback` | 3 s to first OpenAI audio; after that the reply is spoken in the Apple voice |
| `timing.loudModeMinRest` | 2:00. Default threshold for `Loud rest alerts: Long rests only`; editable in Voice & alerts |
| `timing.stillRunningReminder` | 60 min after the last set (optional `still running` notification, off by default) |
| `timing.checkInReuse` | 2 h. A check-in not yet linked to a workout (sheet swiped away, app closed mid-sheet, `Train anyway` later) is used by the next Start within this window without asking again (check-in.md CI4) |
| `timing.offPhoneReminder` | 30 days without a `Copy saved to Files`. Then a quiet, dismissible row appears in Data & backup and on the Profile `Data & backup` row. Never a banner, never during a workout, and Ben can switch the reminder off. (Replaces data-import-export's `timing.backupOverdue`, which no longer applies now that automatic backups stay on the phone) |
| `timing.expiryNotice` | 72 h before signing expiry: info banner on Today |
| `timing.expiryUrgent` | 24 h before signing expiry: warning banner with the time |
| `timing.expiryReminder` | One local notification at 19:00 local, two days before signing expiry (one per signing period) |
| `guide.autoplayPasses` | 3. An exercise guide plays this many reps (one pass is one rep; for a ping-pong guide, forwards and back), then holds the start position with `Replay`. Code: `MAX_AUTOPLAY_PASSES`. Provisional, confirm on device (exercise-library.md §8.8) |
| `guide.repDuration` | 2–6 s per rep, set by each guide (`durationMs`), checked by `guide:check`. Guides keep their own tempo; no global speed-up |
| `guide.frameRate` | 30 frames per second of guide time, drawn on the UI thread. It is never a reason to raise the timer's once-a-second update |
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

**`TargetSourceTag`** (alias of `SourceTag`, §9.28, revision consolidation): a text tag, `type.label`, `text.secondary` on `bg.raised`, `radius.sm`, padding `space.1`/`space.2`. The `Coach` tag adds the `text.bubble` icon before the word (the same icon as the Talk button's text state). It is not tappable on its own. It never uses `accent` (accent stays for the primary action and the active set) and never relies on colour. New specs should say `SourceTag`.

Session status labels (top bar / Today):

| State | Icon | Colour | Label |
|---|---|---|---|
| Resting | `timer` | `accent` | "Rest 1:47" |
| Ready | `figure.strengthtraining.traditional` | `text.primary` | "Ready" |
| Paused | `pause.circle.fill` | `status.warning` | "Paused" |
| Saved locally | `checkmark.circle.fill` | `status.done` | "Saved on this phone" |

### 7.1 Other status vocabularies (revision 2026-10-08, consolidation)

One icon per meaning across the app. Every status shows its word; VoiceOver reads the word. Warning-level states always use `exclamationmark.triangle` + `status.warning`.

**Durability labels** (data-import-export.md §3.1, system-states.md §3.3; revised for "backups in the app by default", approved by Ben via the product manager). Exactly three durability phrases exist, so Ben always knows whether a copy exists off the phone. Never "sync", "synced", "uploaded", "in the cloud", or a bare "Backed up".

| Level | Meaning | Icon | Colour | Label |
|---|---|---|---|---|
| Saved on this phone | Committed to the app's database | `checkmark.circle.fill` | `status.done` | `Saved on this phone` |
| Backed up on this phone | An automatic backup file in the app's own container includes it. Lost if the app is deleted or re-signed with another Apple ID | `iphone` | `status.done` | `Backed up on this phone · 19:05` |
| Copy saved to Files | A backup file exists outside the app (Files, iCloud Drive or another provider). Survives deleting the app | `externaldrive.fill.badge.checkmark` | `status.done` | `Copy saved to Files · Thu 8 Oct` |
| Backing up | A write is in progress | static `ellipsis` | `text.secondary` | `Backing up…` |
| Backup didn't save | The on-phone backup or an off-phone write failed | `exclamationmark.triangle` | `status.warning` | `Last backup on this phone didn't save` · `Copy to Files didn't save` |
| No off-phone copy (quiet) | No `Copy saved to Files` in 30 days (`timing.offPhoneReminder`) | `info.circle` | `text.secondary` | `No copy off this phone since 8 Sep` (Settings row only, dismissible) |

**Capability statuses** (`StatusLabel` vocabulary; App status, Alert check, Coach connection). `Working` is shown only with evidence (a runtime check, probe or user test, with date and build).

| Status | Icon | Colour |
|---|---|---|
| `Working` | `checkmark.circle.fill` | `status.done` |
| `Not working` | `exclamationmark.triangle` | `status.warning` |
| `Not tested` | `questionmark.circle` | `text.secondary` |
| `Not available` / `Not in this build` | `minus.circle` | `text.secondary` |
| `Off` / `Not set up` | `circle` | `text.secondary` |

**Proposal and action statuses** (change-review.md, coach-sheet.md card status words).

| Status | Icon | Colour |
|---|---|---|
| `Applied` · `Saved` · `Logged` | `checkmark.circle.fill` | `status.done` |
| `Out of date` | `exclamationmark.triangle` | `status.warning` |
| `Expired` | `clock.badge.xmark` | `text.secondary` |
| `Replaced` | `arrow.triangle.2.circlepath` | `text.secondary` |
| `Not now` · `Dismissed` · `Not applied` | `minus.circle` | `text.secondary` |
| `Undone` | `arrow.uturn.backward` | `text.secondary` |
| `Couldn't apply` | `xmark.octagon` | `status.danger` (write failures only) |

**Schedule statuses** (weekly-plan.md): `Planned` `circle` `text.tertiary` · `Done` `checkmark.circle.fill` `status.done` · `In progress` `arrowtriangle.right.fill` `accent` · `Missed` `exclamationmark.circle` `status.warning` · `Skipped` `slash.circle` `text.tertiary` · `Not confirmed` `questionmark.circle` `text.secondary` · `Didn't happen` `xmark.circle` `text.secondary`. `Fixed` (`lock.fill`) and `Key` (`flag.fill`) are `Tag`s (§9.28), never `accent`.

**Memory statuses** (coach-memory.md): `Confirmed` `checkmark.circle` `status.done` · `Temporary` `clock` `text.secondary` · `Waiting for you` `questionmark.circle` `text.secondary` · `Worth checking` `checkmark.circle` + `not checked since <date>` · `Expired` `clock.badge.xmark` `text.tertiary` · `Off` `pause.circle` `text.tertiary`.

**Playbook rule statuses** (coaching-playbook.md): `To review` `questionmark.circle` · `Approved 8 Oct` `checkmark.circle.fill` · `Edited by you` `pencil` · `Updated in research` `arrow.triangle.2.circlepath` · `Rejected` `xmark.circle`. Grades are `EvidenceGradeTag`s with no colour coding.

**Import match statuses** (data-import-export.md): `Matched` `checkmark.circle.fill` `status.done` · `Check` `questionmark.circle` `status.warning` · `No match` `xmark.circle` `text.secondary` · `Skipped` `slash.circle` `text.tertiary`.

### 7.2 Data domains: "Your data" and "Coaching knowledge" (revision 2026-10-08, approved by Ben via the product manager)

Everything the app stores belongs to exactly one of two domains. Screens, backups, exports, deletes and the coach's context view always use these two names, in this order.

| Domain | UI name | Icon | What's in it |
|---|---|---|---|
| Personal (owner-scoped) | `Your data` | `person.crop.circle` | Profile, goals, availability, workout history, pre-workout check-ins (revision 2026-10-09), coach memories about Ben, pain flags, his gyms and equipment, his routines and plans, conversations, his settings (including his rest presets), his guide **files** |
| General | `Coaching knowledge` | `books.vertical` | Approved playbook rules with evidence and sources, research candidate rules, the guide library's index and excerpt metadata, the exercise catalogue and aliases (including custom exercise definitions, see open-decisions.md), default presets (gym presets, example rest presets) |

- **Credentials** (ChatGPT tokens, API keys) live in the Keychain and belong to neither domain. They are never in a backup or export.
- A `DomainLabel` (§9.53) heads any list or section that mixes the two, so Ben can always tell which one he is looking at.
- Wording: "Your data" is about Ben; "Coaching knowledge" never contains anything about him. A general training rule ("deload every 5th week") is coaching knowledge (a candidate rule), never a memory. A personal preference ("I hate leg press") is a memory.

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

### 9.2a Secondary button (`SecondaryButton`) (revision consolidation)
- Used wherever specs say "secondary-style accent button": `Apply` on cards, `Review ›`, a `RoutineRow`'s `Start`, `Back up first`, `Not now` when it is a button rather than a text link.
- `bg.raised` fill, 1pt `border.control`, `radius.md`, label `type.headline` in `accent`, at least 44pt tall (52pt on the active workout screen). Disabled: `text.secondary` label. Never filled with `accent`, so the screen's `PrimaryButton` stays the only accent-filled button.

### 9.2b Danger text button (`DangerTextButton`) (revision consolidation)
- `type.headline` in `status.danger`, no fill, at least 44 × 44 hit area, at least `space.8` from any other button, usually at the bottom of a list. Used for `Delete set`, `Discard workout`, `Archive gym`, `Remove key`, `Delete my data`, `Reset coaching knowledge`. Always followed by a confirmation; the label names exactly what goes.

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
- The `Ask` pill: tap opens the coach sheet; long-press (≥ 0.4 s) starts listening when voice is available (voice.md §2.3). In the workout: tap Talk starts listening; long-press opens the coach sheet (voice.md §4.1). The pill sits above the `ResumeBar` when that is shown.

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
- A set logged **by voice** shows its Undo in the `VoiceStrip` (§9.38) instead of this toast (voice.md VO4). There is one Undo per action, next to the words it undoes.
- (Revision 2026-10-09, check-in.) A saved check-in's toast carries `Change` instead of `Undo` (`✓ Check-in saved · 2 of 5` [Change]); same frame, timing and placement. `Change` reopens the check-in, because removing it outright would lose what Ben said.

### 9.11 Change-review card (`ChangeReviewCard`)

> Consolidation: this is the canonical **inline `SuggestionCard` for plan and target changes** (§9.48). change-review.md owns its behaviour and extends it: author tag (`Coach` / `Ben` / `Checks`) before the title; scope always in words from the four scopes (`Today only`, `Thu 15 Oct only`, `Push A from now on` / `Your weekly pattern from now on`, `This programme · weeks 2–6`) as a `ScopeBadge`; at most 4 change lines (`ChangeLine`, §9.47), then `Review all N changes ›`; a `Not changed` line; the `Out of date` variant **hides** Apply (rather than disabling it) and keeps the lines in `text.secondary` under `Was suggested:`. Anything bigger uses `ProposalCard` (§9.49) and the Review screen.
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
- **Severities (revision consolidation, from system-states.md):** `info` (`info.circle`, `bg.surface` with 1pt `border.control`), `warning` (`exclamationmark.triangle`, `status.warning.subtle`), `danger` (`exclamationmark.octagon`, `status.danger.subtle`; only for writes that failed). Info banners for one-time notices can be dismissed (`xmark`, 44 × 44); warnings clear only when the cause is fixed.
- **Where and how many** (system-states.md §2.2 is the priority list): Today at most 2; the active workout's banner slot at most 2, and only write errors, damage to this workout, paused, restored after force-close, coach offline while Ben is using it, and equipment warnings (never signing expiry, backups, new builds, permissions or alert-layer status); the coach sheet at most 1; Profile root at most 2. Which banners show is decided by `buildSystemStatus`, never by the screen.
- **`AttentionRow`** (profile-and-settings.md) is not a separate component: it is a `StatusBanner` at the top of Profile, chosen by the same priority list.

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
- Lives only in the rest card's coach slot. No card border, no fill, no icon animation. **Exception (revision 2026-10-09, check-in.md CI5):** the check-in's lighter-session offer sits in the coach slot of the first set card in Ready, before any set is logged. It is never spoken.
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

### 9.21 Sparkline (`Sparkline`, Progress)
- `chart.sparkline` (96 × 32), `chart.line` at `chart.lineWidth`, no axes, no points except the last one (`chart.point`). Gaps (progress.md PG12) break the line.
- Drawn only with ≥ 3 points; otherwise the parent shows text instead. Never an empty frame.
- Not focusable on its own: the parent row's VoiceOver label carries the numbers. Hidden at AX1+.

### 9.22 Trend row (`TrendRow`, Progress)
- A full-width button row (≥ 52pt), `bg.surface`, padding `space.3`, chevron `›`.
- Lines: exercise name (`type.headline`); equipment context (`type.callout`, `text.secondary`, e.g. `Main Gym · barbell`); then `Sparkline` + latest actual (`type.body`, tabular, e.g. `102.5 kg × 6 · 8 Oct`); change line (`type.callout`, `text.secondary`, arrow icon `arrow.up.right` / `arrow.down.right` / `equal` + words).
- Optional extra line for other-equipment or not-lately notes (`type.callout`, `text.secondary`, `info.circle`).
- At AX1+: sparkline hidden, lines stack. VoiceOver: one element with the full sentence (progress.md §5.7).

### 9.23 Trend chart (`TrendChart`, Progress)
- One series. Plot `chart.detailHeight` (`chart.detailHeightAX` at AX1+), y-axis on the leading edge with 3–4 labels in `type.label`/`chart.axisText` and the unit above it (`kg`, `kg each`, `reps`); y range fits the data with padding, not forced to zero; x-axis month ticks. Gridlines `chart.grid`, horizontal only.
- Line `chart.line`, points `chart.point`. A gap breaks the line.
- **Marker lane** under the x-axis (`chart.markerLane`): `ChartMarker`s aligned to their dates; spans (deload, pain) are drawn as a bracket with the word. Markers never sit on the line.
- **Selection panel** below the chart, fixed height, never a floating callout: range summary (`Latest`, `Best in range`, `Change`) or the selected session (date, value with `(actual)` or `(estimate)`, markers, `Open workout ›`, `Clear`).
- Selection: tap anywhere in the plot selects the nearest point by date (the plot is the hit area); drag scrubs with `haptic.step`. Selected point uses `chart.selected` ring + a 1pt guide line.
- VoiceOver: the chart is one adjustable element; its label is the summary, swipe up/down moves between points and reads each. A visible `Show as table` button always sits under the panel.
- No animation on load, on chip changes or on selection.
- **`pointsOnly` variant** (revision 2026-10-09, check-in.md §2.7): for self-reported 1–5 ratings only. Points (`chart.point`) with **no connecting line**, no band, no average and no marker lane. The y-axis is fixed at 1–5 with the end words on the axis (`1 rough`, `5 great`); x-axis as normal. The heading says `(your own rating)`. Selection, `Show as table` and VoiceOver work as above; the VoiceOver summary lists counts per value, never a mean.

### 9.24 Chart marker (`ChartMarker`)

| Kind | Icon (SF Symbol) | Colour | Word | VoiceOver |
|---|---|---|---|---|
| Coach adjusted (in-workout) | `text.bubble` | `chart.marker` | `Coach adjusted` | "Coach adjusted sets" |
| Ran on coach target | `text.bubble` | `chart.marker` | `Coach target` | "Coach target used" |
| Deload (span) | `arrow.down.to.line` | `chart.marker`, span fill `chart.bandFill` | `Deload` | "Deload week" |
| Pain (point or span) | `exclamationmark.triangle` | `chart.markerPain` | `Pain` | "Pain flag" |
| Edited | `pencil` | `chart.marker` | `Edited` | "Corrected after logging" |
| Gap | `ellipsis` | `chart.marker` | `Gap 24 days` | "Gap of 24 days" |

- Icon 16pt with the word in `type.label` when there is room; when markers crowd, the lane shows icons only and the word appears in the selection panel and the table. The icon is never the only carrier for VoiceOver.

### 9.25 Volume band row (`VolumeBandRow`, Progress)
- Line 1: muscle name (`type.body`) left; value + status text right (`type.body`, tabular): `14 · in 10–20`, `8 · under 10`, `23 · over 20`, `7½ · under 10`.
- Line 2: a horizontal bar `chart.bandBar` tall on a fixed scale (0 to max(25, value)). Fill `chart.bar` up to the value; the guide band drawn behind it as `chart.bandFill` with 1pt `chart.bandEdge` lines at the band's min and max.
- Status is the text, never the fill colour. With the guide off: no band, no status text.
- At AX1+: line 1 wraps (value on its own line), bar full width. VoiceOver: "Chest, 14 hard sets this week, within the 10 to 20 guide."
- As a button (detail screen), it expands to contributor lines (`type.callout`, `text.secondary`, tabular).

### 9.26 Week strip (`WeekStrip`, Progress)
- Seven equal columns, Mon–Sun (locale first weekday): weekday letter (`type.label`, `text.secondary`), glyph below. Not interactive (the parent card is the button), so columns may be narrower than 44pt.
- Glyphs: `checkmark.circle.fill` in `status.done` = done; `circle` in `text.secondary` = planned; `minus` in `text.tertiary` = planned, not logged; none = rest. Today's letter is bold. A one-line text legend follows.
- At AX1+: replaced by a list (`Mon · Done · Push A`). VoiceOver: one sentence for the week.

### 9.27 Chart data table (`ChartDataTable`)
- Replaces the chart when `Show as table` is on. Rows ≥ 44pt, columns `Date` + metric columns + `Notes` (markers as words). Values tabular; estimates keep `≈` and `(estimate)` in the column header.
- Each row is a button to the session. At AX1+ rows stack (date, value, notes lines). No horizontal scrolling.

### 9.28 Tag frame and `SourceTag` (canonical; revision consolidation)

**`Tag`** is the one small text-tag frame: `type.label`, `text.secondary` on `bg.raised`, `radius.sm`, padding `space.1`/`space.2`, optional leading SF Symbol, not tappable on its own, never `accent`, never colour-only. At AX1+ tags wrap; they never truncate numbers. Every tag below uses it.

**`SourceTag`** answers "who or what produced this?". It replaces `TargetSourceTag` (§7), onboarding's `ProvenanceTag`, routines' source tag and change-review's author tag. Kinds:

| Kind | Texts | Icon |
|---|---|---|
| Target source | `Coach` · `Built-in rule` · `Built-in rule (coach offline)` · `Built-in rule (coach unavailable)` · `Fixed` | `text.bubble` (Coach); none otherwise |
| Author of a routine, proposal or rule | `Coach` · `Ben` · `Checks` · `Imported` · `From the research` · `From your guide` | `text.bubble` · `person` · `checkmark.shield` · `square.and.arrow.down` · `books.vertical` · `book.closed` |
| Data provenance | `Your logs` · `FitNotes import` · `Garmin file, imported 3 Oct` · `Built-in summary` | `iphone` · `square.and.arrow.down` · `gearshape` |
| Value provenance (how trustworthy a stored value is) | `Typical values, not checked` · `Checked by you` · `Set in setup, 8 Oct` · `Changed by you, 12 Oct` · `From coach chat, 14 Oct · you confirmed` | `questionmark.circle` · `checkmark` · none |

Other `Tag` uses (same frame, different meaning; not sources):
- `EvidenceGradeTag`: the grade words exactly as the research writes them (`Weak + Practice`, `Not graded`). No colour by grade.
- `ScopeBadge`: `text.primary` on `bg.raised` with 1pt `border.control` and a `calendar` icon; always on every proposal (§9.11).
- `FixedBadge` / `KeyBadge`: `lock.fill` + `Fixed`; `flag.fill` + `Key`.
- `AvailabilityTag` (inline icon + word, no fill): `⚠ Busy today` / `⚠ Pain flagged` (`status.warning`), `⊘ Not at Main Gym` (`slash.circle`, `text.secondary`), `Custom`.
- `DomainLabel` (§9.53): `Your data` / `Coaching knowledge`.

### 9.29 Resume bar (`ResumeBar`)
- Fixed above the tab bar on non-Today tabs while a workout is unfinished and < 6 h old. 60pt, `bg.surface`, top `border.divider`, padding `space.3`/`space.4`.
- Left: status icon (§7 session status labels) + `Push A · Rest 1:12` / `· Ready` / `· Paused` (`type.headline`, tabular; the rest time is computed from the saved deadline, updated once per second, no animation). Right: `Resume` button (accent fill, `on.accent`, `radius.md`, ≥ 44pt tall, ≥ 96pt wide). Tapping anywhere on the bar resumes.
- It is the only accent-filled button on the screen while shown. The `Ask` pill moves above it. VoiceOver: "Workout in progress, Push A, rest 1 minute 12 left. Resume, button."

### 9.30 Calendar day (`CalendarDay`)
- ≥ 44 × 44 cell: date number (`type.callout`, tabular) and up to two glyphs below: `●` (`circle.fill`, `text.primary`) workout, `▲` (`triangle.fill`, `text.secondary`) imported endurance, `○` (`circle`, `text.secondary`) planned. Shapes, not colours, carry the meaning; a legend sits under the grid.
- Today: 1pt `border.control` ring and bold number. Selected: `accent.subtle` fill + `text.primary` number (selection, like a selected chip).
- VoiceOver: "Thursday 8 October, Push A, 54 minutes, edited. Selected."

### 9.31–9.53 Components merged from the screen specs (revision 2026-10-08, consolidation)

Each component has one name and one definition here. The owning spec says where it is used.

#### Rows and lists

**9.31 `SettingsRow`** (profile-and-settings, gym-editor). The base list row outside the workout. Min 52pt, padding `space.3`/`space.4`, `bg.surface`, rows separated by `border.divider` (decorative; the whole row is the target). Title `type.body` `text.primary`; value or subtitle `type.callout` `text.secondary`, tabular when numeric; optional leading SF Symbol; trailing `chevron.right` (`text.tertiary`), a system switch, or a radio. At AX1+ the value moves under the title. Variants:
- *Radio row* (was ai-connection `RouteOption`): radio + name `type.body` + right-aligned cost word (`Included` / `Free · on device` / `Paid · …`) as `type.label` `text.secondary`. `Paid` is always a word, never a colour.
- *Slider row* (was `SliderRow`): system slider, value as a percentage at the trailing edge (tabular); VoiceOver adjustable in 10% steps.
- *Question row* (was data-import-export `ImportQuestionRow`): leading capability/status icon from §7.1 + one or two lines `type.body` + chevron; answered rows show the answer in `text.secondary`.
- *Destructive*: use `DangerTextButton` (§9.2b), not a red row with a chevron.

**9.32 `SettingsSectionHeader`.** `type.label`, `text.secondary`, sentence case, `space.6` above, `space.2` below.

**9.33 `ChecklistRow`** (onboarding, gym-editor). Checkbox (`checkmark.square.fill` / `square`) row, 52pt min, whole row toggles; optional trailing `›` button 44 × 44 separated by `space.2` with non-overlapping hit areas; optional second line with a `SourceTag` (value provenance).

**9.34 `ChoiceCard`** (onboarding, gym-editor). Single- or multi-select card: `bg.surface`, 1pt `border.control`, `radius.md`, padding `space.4`, min height 60. Selected: 2pt `accent` border, `accent.subtle` fill, `checkmark.circle.fill` before the title. Disabled: `text.secondary` title and a reason line.

**9.35 Specialised rows** (all build on `SettingsRow` metrics, ≥ 52pt unless noted, numbers tabular, status by icon + word):

| Component | Owner | Delta from `SettingsRow` |
|---|---|---|
| `ExerciseRow` / `SubstituteRow` | exercise-library | Line 1 `type.headline`, lines 2–3 `type.callout` `text.secondary`; trailing history button 44 × 44 (`clock.arrow.circlepath`); optional leading checkbox. Substitute adds up to 2 reason lines (`checkmark`, `text.primary`) and 1 difference line (`notequal`, `text.secondary`), then `More ›`. Never a numeric score |
| `RoutineRow` | routines | Min 76pt; line 1 name + `SecondaryButton` `Start` (≥ 44 × 88); line 2 `SourceTag` + summary; line 3 one status. At AX1+ `Start` goes full width under line 3 |
| `SetTemplateRow` | routines | Columns: set number + type badge, type word, target, rest; `●` + VoiceOver "own rest" for overrides. Stacks at AX1+ |
| `ReorderRow` | routines | One line + drag handle + `Move up` / `Move down` buttons 44 × 44 (gesture never the only way) |
| `DayRow` | weekly-plan | Date column 64pt; today = 4pt `accent` left bar + `accent.subtle` + the word `Today`. At AX1+ the date sits above its items |
| `MemoryRow` | coach-memory | ≥ 64pt; status icon (§7.1) + `type.body` text (max 3 lines); line 2 source · date · expiry `type.label`; trailing chevron or inline `Not now` / `Save` (≥ `space.8` apart) |
| `PainFlagRow` | coach-memory | Card frame (§9.48) with `exclamationmark.triangle` `status.warning` + `Movement · area` `type.headline`; source/date line; effect line; `Clear…` text button |
| `RuleRow` | coaching-playbook | ≥ 64pt; number + title `type.headline`; summary `type.callout` (2 lines); `EvidenceGradeTag` + status |
| `GuideRow` | coaching-playbook | ≥ 72pt; order number, title, switch; kind · pages; index status as text (`Reading page 112 of 260`), updated at most once a second |
| `GuardrailRow` | coaching-playbook | `lock.fill` `text.secondary` + `type.body`; not tappable except where `›` is shown |
| `ChangeLine` | change-review | Marker icon + word (`pencil` `Changed` / `arrow.right` `Moved` / `plus.circle` `Added` / `minus.circle` `Removed`, same markers as §9.18), entity `type.headline`, before → after `type.callout`; `→` read as "to"; removed rows strikethrough + word |

**9.36 `StatusRow`** — see §9.40.

#### Chips and inputs

**9.37 `ClarifyChips`** (coach-sheet, voice, coach-memory; defined once). A question line `type.callout` above 2–4 options in the `ParamChip` frame (52pt), single choice, with the status word `Not saved` until one is chosen. Nothing applies until a choice is made.

**`FilterChip`** (exercise-library): `ParamChip` plus a trailing `chevron.down`; when active it shows the choice (`Movement: Vertical pull`). Toggle chips (`At Main Gym`) use the `ParamChip` selected state.

**`LoadChip`** (gym-editor): 44pt min, `radius.sm`, `type.label`, tabular. Present: `bg.raised`, 1pt `border.control`. Missing: `minus.circle`, strikethrough, `text.secondary`, dashed `border.control`. VoiceOver "30 kilograms, in the rack" / "missing".

**`ContextChip`** (coach-sheet): pill, 44pt min, `bg.raised`, 1pt `border.control`, `eye` icon + `type.label` text (`Sees: Push A (live) · Main Gym`); optional trailing `xmark` 44 × 44; wraps at AX1+.

**`CitationChip`** (coaching-playbook): pill, 44pt min, `bg.raised`, 1pt `border.control`, `type.label` `text.primary`, `list.number` (playbook rule) or `book.closed` (guide); wraps; never `accent`.

**`SearchField`** (exercise-library): 52pt, `bg.raised`, 1pt `border.control`, `radius.sm`, `magnifyingglass`, `type.body`, clear button and optional `mic` (each 44 × 44, `space.2` apart). The mic hides when on-device speech is unavailable.

**`RangeBuilder`** (gym-editor): `From [ ] to [ ] every [ ] <unit>`, three numeric fields (`bg.raised`, `border.control`, `radius.sm`, ≥ 44pt) and a remove button 44 × 44.

**`CountStepper`** (gym-editor): `NumberStepper` variant for counts outside the workout: 44 × 44 buttons, value `type.headline`, trailing derived text (`2 a side`) in `text.secondary`.

**`ScopeSelector`** (change-review): system segmented control 44pt; stacked radio rows (52pt) at AX1+; default = narrowest scope.

**`PlanSegmentControl`** (routines, weekly-plan): system segmented control, 44pt, `Week` / `Routines`.

**`WeekSwitcher`** (weekly-plan): `chevron.left` / `chevron.right` 44 × 44 buttons around a `type.headline` title (tabular dates); tap the title for this week. No swipe-only navigation.

#### Voice and conversation

**9.38 `VoiceStrip`** (voice, active-workout §2.5). Above the action bar, never over it: `bg.surface`, top 1pt `border.divider`, padding `space.3`/`space.4`; line 1 status icon + words (`type.headline`), line 2 values (`type.callout`, tabular), line 3 `Heard: "…"` (`type.callout`, `text.secondary`); trailing action (`Stop` / `Undo` / `Cancel` / `Settings`) with a 52 × 52 hit area. Max 4 lines; at AX1+ `Heard` collapses behind `Heard ›`. Carries the Undo for voice logs (§9.10). On other tabs the same strip sits above the tab bar.

**9.39 `RecordingIndicator`.** Static 8pt dot in `status.danger` + the words `Mic on`. No pulse, whether or not Reduce Motion is on. Shown together with the iOS orange dot.

**`ConversationMessage`** (coach-sheet): Ben = right-aligned `bg.raised` bubble, `radius.md`, padding `space.3`, max width 80%, `type.body`, time `type.label` `text.secondary`, `mic` icon when spoken. Coach = left-aligned, no bubble, label `Coach · hh:mm`. Gap `space.4` between messages.

**`ToolSummaryLine`**: `type.callout` `text.secondary` + chevron; expands in place (at most `timing.fast`). Text comes from the tool log, never the model.

**`SheetComposer`**: `Talk` 52 × 52 left; field `bg.raised` `radius.sm`, 52pt, grows to 5 lines; `Send`/`Stop` 52 × 52 right (`accent` fill when enabled, `bg.raised` when disabled); pinned above the keyboard.

**`RouteLine`**: `type.label` `text.secondary`, link part in `accent` with a 44pt hit area (`Using ChatGPT plan · Manage usage`). Always visible under the composer.

**`WorkoutBar`** (coach sheet during a workout): 52pt, card frame, icon + status `type.callout` tabular + `Back to workout ›` in `accent`; the whole bar is one button that closes the sheet. It never logs.

#### Status and progress

**9.40 `StatusRow`** (system-states App status, lock-screen Alert check, profile capability rows). ≥ 52pt on `bg.surface`: a `StatusLabel` icon from §7.1 (capability vocabulary) or the durability labels, title `type.body`, optional evidence/detail line `type.callout` `text.secondary` (`Tested 8 Oct, build 7`), optional trailing text button (`accent`, ≥ 44 × 44, e.g. `Open Settings`) or `chevron.right`. `StatusLabel` is the icon + word pair on its own, `type.label`.

**9.41 `StatusCard`** (was ai-connection `ConnectionStatusCard`; also the Data & backup status card). Card frame (§9.48), padding `space.4`. Line 1 icon + status word `type.headline` from §7.1; body `type.callout`; optional `PrimaryButton` or `SecondaryButton` for its one action.

**9.42 `StepRow`** (was onboarding `StepResultLine` and `BlockingCover` steps; also ai-connection's checking list). Icon + one or two lines `type.body`/`type.callout`: done `checkmark.circle.fill` `status.done`; current static `ellipsis` `text.secondary`; to do `circle` `text.tertiary`; problem `exclamationmark.triangle` `status.warning`. Steps are real and shown only while they run. No spinner animation.

**9.43 `NoteLine`** (guard notes §9.19, weekly-plan `ConflictNote`, gym-editor `LoadPreview` warning, routine gym notes). Icon + one or two lines `type.callout`: `info.circle` `text.secondary` for facts (rounded, capped, swapped, removed); `exclamationmark.triangle` `status.warning` for pain, over-length and conflicts; optional trailing action (`Options ›`, `Swap ›`) in `accent` with a 44pt hit area. Acknowledged variant: one line, `text.secondary`, same icon. Text comes from the validator or a deterministic check, never the model. `GuardNoteList` (§9.19) is a list of these under `Checks (n)`.

**`LoadPreview`** (gym-editor): one or two `type.callout` lines, tabular (`Makes 126 loads: 20–332.5 kg, total, every 2.5 kg.`), updates without animation; its warning is a `NoteLine`.

**9.44 `ProgressLine`** (data-import-export). Determinate linear bar, 4pt tall, `radius.pill`, `accent` fill on `bg.raised`, always with a text count above (`180 of 412 workouts`, tabular). Jumps to each value without animation. Never indeterminate, never a ring. `SpendLine` (ai-connection) uses the same 4pt static bar with a `text.secondary` fill and is optional; its text (`Text $1.42 of $5.00 · 380 messages`, `⚠ 80% of cap` at ≥ 80%) carries the meaning.

**`BlockingCover`** (data-import-export, system-states). Full screen, `bg.canvas`, no nav bar, tab bar or Ask pill; centred `type.title2` title; a `StepRow` list; one `type.callout` `text.secondary` line saying what happens if Fizz closes. No buttons unless the state needs one (`Copy details`). Appears only after `timing.coverDelay`. Used only for restore, undo restore, delete, database update and data from a newer build.

**`CountCompareTable`** (data-import-export): label column `type.callout` `text.secondary`; value columns right-aligned `type.callout` tabular `text.primary`; headers `type.label`. At AX1+ each row stacks into `Label` / `Backup 412 · This phone 415`.

#### Credentials

**9.45 `SecureKeyField`** (ai-connection owns the key screens; profile-and-settings links to them). `bg.raised`, 1pt `border.control`, `radius.sm`, 52pt, masked, paste allowed, trailing `Paste` text button (44pt). Rejects text that isn't key-shaped. After saving it shows only `sk-…3F9a` read-only (`type.body`, tabular) and never the full value again. The `Check and save key` `PrimaryButton` sits above the keyboard.

#### Frames for onboarding and full-screen editors

**9.46 `OnboardingFrame`.** Top bar (`Back`, centred `Step n of m` in `type.label` `text.secondary`, optional `Skip`); title `type.title2`; one line `type.callout` `text.secondary`; scrolling content; fixed bottom bar with one `PrimaryButton`, same padding and keyboard behaviour as `ActionBar` (§9.1) without Talk. No progress bar. The same bottom-bar rule applies to every editor with `Save` (equipment, routine, memory, custom exercise) and to the Review screen (`Not now` text button above-left, `Apply` full width, ≥ `space.8` apart).

#### Card families

**9.47** — see `ChangeLine` in §9.35.

**9.48 Card frame and card families.** One frame for every inline card: `bg.surface`, 1pt `border.control`, `radius.md`, padding `space.3`. Line 1 is always a status icon + words (§7.1). Buttons are text buttons or `SecondaryButton`s with 44pt hit areas (52pt on the workout screen), never a `PrimaryButton`. Cards never open a screen or sheet by themselves.

| Family | Meaning | Members (existing names kept) |
|---|---|---|
| `ResultCard` | Something **already happened**; shows what and offers Undo (and `Why? ›` / `Edit` where useful) | `CoachAdjustmentBanner` (§9.15), `SetLoggedCard` and applied `CorrectionCard` (coach-sheet §2.7), saved `MemoryCard` and set `PainFlagCard` (coach-memory §2.4–2.5), `SwapSlotLine` (exercise-library §2.5, without the coach icon), the collapsed `Applied · …` line of any proposal |
| `SuggestionCard` | **Nothing has happened yet**; Ben must tap to apply | `ChangeReviewCard` (§9.11, plan and target changes), `CoachTargetProposal` (§9.16, summary), suggested `MemoryCard` (`Save to memory?`), suggested `CorrectionCard`, suggested `PainFlagCard` (`Flag pain for Bench press?`), suggested playbook rule (`Add to playbook?`, coach-memory §2.4a), `ConflictCard` (coaching-playbook §2.8). `CoachOfferLine` (§9.14) is the borderless rest-card member |
| `ProposalCard` (§9.49) | A one-line summary of something bigger that opens the Review screen | Change-review proposals; `WorkoutDraftCard` (§9.20) is its workout-draft variant |

**9.49 `ProposalCard`** (change-review). Card frame: `SourceTag` (author) + title `type.headline`; scope + `nothing changed yet` (`type.callout`, `text.secondary`); first change line; `+ N more`; `Review ›` `SecondaryButton`. Overlap line: `exclamationmark.triangle` + `Overlaps with "…"`.

**9.50 `PainFlagNote`** (coach-memory; placed on the active-workout set card, active-workout.md §2.1). One line under the target line: `exclamationmark.triangle` `status.warning` + `Pain flag: no increases` in `text.secondary`, `type.callout`. The whole line is a 44pt target that opens that flag in Pain flags. Never blocks Log. VoiceOver: "Pain flag on this movement. Loads won't go up."

**9.51 `MemoryStatusIcon`** — see §7.1 memory statuses.

**9.52 Icons used for system states** (system-states.md): offline `wifi.slash` · signing `clock.badge.exclamationmark` · build updated `arrow.down.app` · damaged record `exclamationmark.octagon` · permission off `slash.circle` · gym `building.2` · travel gym `airplane` (always with `Travel`) · out of order `wrench.and.screwdriver` (with text) · archived `archivebox`. Backup icons in §7.1.

**9.53 `DomainLabel`** (revision: data domains, §7.2). A `SettingsSectionHeader` with a leading icon that names the domain: `person.crop.circle` + `Your data`, `books.vertical` + `Coaching knowledge`. Used wherever both domains appear together: Data & backup, the backup and restore previews, export and delete, the coach's `What the coach can see` view, App status. Never colour-coded; the word carries the meaning.

#### Check-in (revision 2026-10-09; owner: check-in.md)

**9.54 `CheckInScale`.** Five equal buttons `1`–`5` in one row, `space.2` apart, filling the content width (≈ 65pt each at 390pt, ≈ 62pt at 375pt), **64pt tall** (above `target.workout`). Each: `bg.raised`, 1pt `border.control`, `radius.md`, digit in `type.keypad` (`text.primary`, tabular, max 1.5×, so five always fit in one row at AX3). Under the row, two end labels in `type.label` `text.secondary`: `1 = rough` (leading) and `5 = great` (trailing); at AX1+ they stack on two lines.
- States: default; pressed (`accent.subtle` fill); chosen (`accent.subtle` fill, 2pt `accent` border, `checkmark` glyph under the digit). Never accent-filled, so the screen's only accent-filled button is still its `PrimaryButton`. No colour scale across the numbers (1 is not red, 5 is not green).
- Tapping selects on touch-up inside only; a drag across the row selects nothing. `haptic.step` on selection.
- VoiceOver: five buttons, "1 of 5, rough", "2 of 5", "3 of 5", "4 of 5", "5 of 5, great"; the row's label is "How are you feeling today, 1 to 5". Hardware keys `1`–`5` select.

**9.55 `CheckInSheet`.** A system sheet with a grabber, presented over Today (or over Active workout in the Resume case). Detents: a content-fit compact detent for the score step (≈ 330pt at default text size), medium for `What's up?`, large for the pain step, with the keyboard open, and at AX1+. Content uses the `OnboardingFrame` rules (§9.46) without its top bar: title `type.title2`, one `type.callout` `text.secondary` line, content, then a fixed bottom bar with `TalkButton` (52 × 52, hidden without voice input) and the step's action (`SecondaryButton` `Skip` on the score step; `PrimaryButton` `Done` / `Flag n movements` on later steps). A secondary text action (`Skip`, `Not now`) sits above-left of the bar, ≥ `space.8` from the primary. The bar sits on the keyboard when it is open. Steps swap content in place (cross-fade ≤ `timing.fast`, none under Reduce Motion). Swipe-down = "not now" (check-in.md CI3). An in-sheet `VoiceStrip` (§9.38) appears above the bar while voice is in use.

**9.56 `CheckInLine`.** How a recorded check-in is shown (summary, past workout, edit entry points). Line 1 `How you said you felt: 2 of 5` (`type.body`, tabular) with a trailing `chevron.right`; line 2 reasons joined by ` · ` (`type.callout`, `text.secondary`); line 3 the note in quotes (`type.callout`, `text.secondary`, max 2 lines, tail ellipsis). No icon colour, no fill, no gauge or bar. Whole line is a ≥ 44pt button that opens the edit sheet. VoiceOver: "How you said you felt before this workout: 2 of 5. Tired, poor sleep. Note: Baby was up at 3."

#### Exercise guide (revision 2026-10-09; owner: exercise-library.md §8)

**9.57 `ExerciseGuide`** (code: `GuidePlayer`). A square canvas inside a `Card`, 200–360pt (`min(360, content width − 2 × space.4)`), centred, drawn only in the §2.3 aliases. Above it, a `Tag` reading `Draft guide` until Ben approves the guide. Below it, the controls, built from `SecondaryButton`s (`flexBasis` 140, wrapping, ≥ 44pt tall, `space.3` apart):
- *Animating:* one play control whose label is what a tap will do: `Pause` (`pause.fill`) · `Play` (`play.fill`) · `Replay` (`arrow.counterclockwise`). It is joined by `Key positions` (`rectangle.split.3x1`) when the guide has labelled key positions (exercise-library.md §8.9 P2, built).
- *Key positions (still):* `1 of 3 · Start` (`type.headline`, tabular) and its caption (`type.callout`, `text.secondary`), `Previous` (`chevron.left`) and `Next` (`chevron.right`), disabled at the ends, then a secondary-tone text button `Play animation` (`play`).
- Motion follows the principle 5 exception. The canvas itself isn't tappable (no scrub, no tap-to-pause), so a stray touch can't change it.
- VoiceOver: the canvas is one image with a fixed label, `Exercise guide for <name>. <a11y.summary>` (the same for the still view; P4), so it isn't re-announced while it moves. The still view's text is one element (`Key position 1 of 3, Start. <caption>`), announced after each Previous/Next.
- Loading: the first frame shows at once, and the rest are prepared in ≤ 8 ms slices so the JS thread never stalls. No spinner or shimmer.
- Errors are never drawn in the canvas. The screen shows a `StatusLine` instead (exercise-library.md §8.4).

#### Sound asset

`sound.restEnd` is the file `rest-end.caf` (≤ 2 s), used by both the in-app chime and the rest-end notification sound.

---

## 10. Accessibility checklist (applies to every screen)

- Every control has a VoiceOver label that includes its values and units. Loads are read as "kilograms" or "pounds" in full.
- Focus order is: top bar → exercise header → current set → rest → action bar.
- Every gesture has a button equivalent.
- The screen is usable at AX3 text size without horizontal scrolling. The Log button stays visible.
- When a Bluetooth keyboard is connected, Return in the reps field acts like `Done`. Cmd+Return logs the set.
- Status is always conveyed by icon or text as well as colour (§7).
- Every chart has a VoiceOver summary sentence, point-by-point adjustable navigation and a visible `Show as table` alternative (§9.23, §9.27). Charts carry one series, so no colour legend is ever needed.
- Every chart and progress value says whether it is an actual result, a target or an estimate. (Revision 2026-10-09) A check-in value says it is Ben's own rating (`How you said you felt`, `your own rating`) and is never called a score, readiness or recovery.
- (Consolidation) Every durability statement uses one of the three phrases in §7.1, and every screen that mixes the two data domains labels them with `DomainLabel` (§9.53).
- (Consolidation) Any figure in money says `estimate` when the app worked it out.
- (Revision 2026-10-09) Anything that moves on its own for more than 5 s has a visible `Pause` and stops by itself. Under Reduce Motion it doesn't move at all until Ben asks, and off-screen it doesn't move. Today only `ExerciseGuide` (§9.57) does this; anything else that wants to needs its own exception in principle 5.

---

## 11. Component index: canonical names and aliases (revision consolidation)

Use the canonical name in new specs. Aliases are kept so older specs stay readable; they mean exactly the canonical component.

| Canonical | Section | Aliases / merged from |
|---|---|---|
| `SourceTag` (on the `Tag` frame) | §9.28 | `TargetSourceTag` (§7), `ProvenanceTag` (onboarding, profile, gym-editor), routines' source tag, change-review author tag |
| `Tag` uses | §9.28 | `EvidenceGradeTag`, `ScopeBadge`, `FixedBadge`, `KeyBadge`, `AvailabilityTag`, `DomainLabel` text |
| `StatusBanner` (info / warning / danger) | §9.12 | `AttentionRow` (profile) |
| `StatusRow` + `StatusLabel` | §9.40, §7.1 | system-states `StatusRow`, profile `StatusLabel`, lock-screen "Alert check row" |
| `StatusCard` | §9.41 | ai-connection `ConnectionStatusCard`, Data & backup status card |
| `StepRow` | §9.42 | onboarding `StepResultLine`, `BlockingCover` step list, ai-connection checking steps |
| `NoteLine` | §9.43 | guard notes (§9.19), weekly-plan `ConflictNote`, `LoadPreview` warning |
| `SecureKeyField` | §9.45 | profile §2.6.2 and ai-connection §2.7 definitions |
| `ClarifyChips` | §9.37 | coach-sheet and voice definitions |
| `SettingsRow` (+ radio, slider, question variants) | §9.31 | `RouteOption`, `SliderRow`, `ImportQuestionRow` |
| `ResultCard` family | §9.48 | `CoachAdjustmentBanner`, `SetLoggedCard`, `CorrectionCard` (applied), `MemoryCard` (saved), `PainFlagCard` (set), `SwapSlotLine` |
| `SuggestionCard` family | §9.48 | `ChangeReviewCard`, `CoachTargetProposal`, `CoachOfferLine`, suggested `MemoryCard` / `CorrectionCard` / `PainFlagCard`, `ConflictCard`, suggested playbook rule |
| `ProposalCard` | §9.49 | `WorkoutDraftCard` (variant) |
| `SecondaryButton` | §9.2a | "secondary-style accent button" in every spec |
| `DangerTextButton` | §9.2b | "danger text", "status.danger text button" |
| `timing.coachTimeout` | §6 | `timing.coachFirstToken` (coach-sheet, voice) |
| `timing.offPhoneReminder` | §6 | `timing.backupOverdue` (data-import-export; retired) |
| `ExerciseGuide` | §9.57, §2.3 | `GuidePlayer` (code), "guide player", "animated guide" (research §5.4) |
| `CheckInScale`, `CheckInSheet`, `CheckInLine` | §9.54–9.56 | Replace the Today readiness chips (`Normal` / `Tired` / `Sore`), which had no component name (revision 2026-10-09) |
