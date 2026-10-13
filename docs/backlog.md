# GymSmarter backlog: what's been looked at but not built

Status: 11 Oct 2026. This is the single list of everything the brief, CHANGELOG, design specs, research, ADRs and reviews asked for or suggested, checked against the code. It was put together from five separate sweeps, with duplicates merged. "Code" here means branch `claude/gracious-knuth-joxqpw` @ `3c8e292`, which is the real main (local `main` holds only the first commit). Work on the in-progress branches is described in section 3. A completeness check on 11 Oct spot-checked 15 "not built" and 10 "built" lines against the code (all held), re-read the CHANGELOG and playbook decisions against section 5, and added the gaps it found.

Sizes: **S** is about a day or less, **M** a few days, **L** about a week, **XL** more than a week.
"Waiting on": **nothing** means it can be built now. **Ben** means one of your decisions in section 5. **Device test** means it needs a check on your iPhone first. **After X** means it needs another item built first.

---

## 1. In plain words

1. The main workout loop works end to end: pick today's workout, log sets with one tap, rest timer and alert, summary, and next time's targets.
2. Closing the app mid-workout is safe. It reopens where you were, rest timer included.
3. Gyms, real plates and machines, the exercise list, 10 animated how-to guides, FitNotes import, backups and restore all work.
4. The text coach works on your ChatGPT plan. It can change today's remaining sets and next time's numbers, always with Undo.
5. Three things are being built now: choosing which session to do today, deleting old workouts, and Progress charts.
6. The biggest gaps are voice (talking to log sets and spoken cues), a routine editor, Goals & schedule, and a weekly plan.
7. Several smaller workout gaps remain: swapping an exercise mid-workout, a timer for timed exercises such as planks, and Undo after deleting a set.
8. The coach can't yet read your past training. You also can't see or edit what it remembers, or approve its rule suggestions.
9. About 35 decisions and 20 confirmations are waiting on a short answer from you. Section 5 lists each one with a suggested answer, and 5.4 lists the ones already answered.
10. A handful of phone checks still need doing before real workouts, mainly the lock-screen countdown and a full SideStore update and restore run.

---

## 2. Built

Grouped by area so you can see what's covered. "(phone check pending)" means the code is done but hasn't been confirmed on your iPhone yet.

**Workout loop**
- Today → workout overview → Start → log set → rest → Finish → Summary, end to end
- One-tap Log from prefilled values, with double-tap protection and safe repeated saves
- Last time's result beside each set (tap to copy). Planned and actual values kept separately
- Undo the last set. Correcting a set saves an edit history, and the change carries into next time's targets
- Optional RPE or RIR after logging, in the rest card
- Add set, delete set, add exercise, skip exercise, tap any pending set to do it next
- One-sided exercises logged per side (Both / Left / Right), with the other side added automatically
- kg/lb and explicit load types (total, per dumbbell, stack, assisted, bodyweight)
- Plates per side, warm-up line, and a warning when a typed load isn't on the gym's equipment
- Pause and resume (paused time doesn't count). Discard a workout. Edit start and end times
- Finish sheet: end time, an estimated end after 20 idle minutes, "Nothing logged yet"
- Force-close recovery: reopens straight into a workout under 6 hours old, otherwise a stale-workout card on Today. Unsaved edits are restored
- Time left ("About 25 min left · ends about 19:05") and Finish by
- "Why?" on every target, plus "Plan was" markers
- Marking a set as not counting (Spotted / Pain / Form broke / Other equipment)
- Pre-start overview: time, sets, muscles, last time, plates, warm-ups, change markers, superset bracket, inline check-in
- Today-only edits before Start (swap, skip, do first, reorder, reset), saved until midnight, and "Change Push A too" with before/after and Undo
- Repeat a past workout, with the gym re-checked

**Rest and alerts**
- Rest countdown from a saved deadline: −30 s / +30 s / Skip. Logging the next set ends the rest
- "Rest after" on every set (this set, or the exercise from now on). Rest presets by exercise type
- Rest-end notification on the lock screen, one per rest, kept in step with Skip, Log, Undo, Pause and Finish (phone check pending)
- Rest-end haptic in the app, a "Rest ended at 18:42" line after reopening, and an alerts permission ask at the first Start

**Check-in and pain**
- Check-in on Start (1–5, Skip, "What's up?" reasons and note). Pain leads to pain flags. "Feeling ill" suggests a rest
- Check-in reused within 2 hours, shown on Today and the Summary, and editable
- Pain flags: progression stops, "May hurt" in the picker, a "Still hurts?" check every 14 days, a Pain flags list with Clear, "Sore or pain?" clarification

**Summary and progression**
- Summary: active time, sets, warm-ups separate, comparison with last time, records, exercise rows, rename, backup line, finish animation
- Next time: coach's small changes saved by default with reason and Undo / Undo all; bigger ones as Apply; built-in rule as the labelled fallback
- Built-in progression rules (double progression, top set and back-off), always rounded to loads your gym can do. Equipment step card

**Routines and Today**
- Save as routine, start, rename, delete with Undo. Up next follows the routine after the one you last did
- Today: date, gym, Up next with targets, Resume card, Done today, This week line and dots, one lift trend, Ask button, database-error state, system banners

**Gyms and exercises**
- Gyms from presets, "not checked" tags, equipment editors for barbell and plates, dumbbells, stacks, assisted, plate-loaded and bodyweight; "Use changes today"
- Switch gym mid-workout: remaining targets re-fitted, logged sets untouched, Undo and "Switch back" (phone check pending)
- Exercise picker: recent, common lifts, A–Z, search, How to button. 135 catalogue entries
- How to screen with 10 animated guides: muscle highlight, cues, safety, "What not to do", still frames under Reduce Motion, safe mode (guides still marked Draft for your review)

**Coach**
- ChatGPT-plan sign-in, ID-token signature check, model choice, honest states (usage limit, expired, not eligible), Disconnect
- Coach sheet: threads kept across restarts, streaming, Stop / Try again, opened from Today, the workout and the Summary
- Adjust chips (Too hard / Too easy / Pain / Type…), changes applied at once with Undo. Offers after a clear signal, once per kind
- Honesty: change lines come from saved actions only, untrue "I changed…" sentences are hidden, offline is shown honestly
- "What the coach can see", Why? on cards, memory saved and forgotten through chat, playbook v1 sent as Coaching knowledge, pain words become pain flags

**Data**
- Automatic on-phone backup after every workout (keeps 14), Back up now, Save a copy to Files, 30-day reminder
- Restore with preview, integrity check and Undo; Check a backup; Restore from the Welcome screen (phone check pending)
- FitNotes CSV import: preview, name matching, questions, duplicates, results, past imports, Undo import (to check against your real export)
- Export My data or Coaching knowledge as JSON. Delete my data (keeps coaching knowledge). Reset coaching knowledge with Undo

**App and platform**
- Cloud-built .ipa for SideStore under the GymSmarter name, with a check for forbidden entitlements
- Three tabs with a full-screen workout. Local SQLite with migrations 1–7, write checks, append-only history and an integrity check
- First-run setup (units, gym, how data is kept). Capability probe, App status with dated evidence, crash capture and Last error, signing-expiry banners
- Dark premium theme (Direction D), Dynamic Type, Reduce Motion, VoiceOver labels, haptics and motion tokens
- Minimal-copy pass across the app

---

## 3. In progress now

| Work | Branch / worktree | State | Waiting on |
|---|---|---|---|
| **Choose today's session** (pick any session type, the recommended one first) | `claude/session-picker`, `/home/user/wt-picker` | 6 commits: domain, services, the UI (picker sheet, Today and overview) and the spec, plus fixes after the review. Nothing uncommitted. The one review on file says CHANGES NEEDED; no re-review yet | Re-review. Ben: session type taken from the FitNotes Category (Q-S1) |
| **Delete workouts** (one or several, one set in a finished workout, Recently deleted for 30 days) | `claude/delete-workouts`, `/home/user/wt-delete` | 3 commits: spec, domain (deleted status, restore) and persistence (migration 8, delete/restore/purge). About 22 app files uncommitted, including the UI (`RecentlyDeletedScreen.tsx`, `ui/selection.tsx`, `history/`, `history-services.ts`) | Finishing, then review. Spec §9 (DW-Q1, Q3, Q4, Q6) for Ben; DW-Q2 needs an ADR on purging |
| **Progress analytics v1** (window picker, sessions, time in gym, sets per muscle, Push/Pull/Legs, estimated 1RM, rep records, records list) | `claude/progress`, `/home/user/wt-progress` | No commits. Uncommitted: spec (`progress.md` v1.0), mockup, and first code edits (schemas, catalogue vocabulary, `calendar.ts`, tokens). The catalogue has no split tag yet, and 11 of 135 entries have no secondary muscles | Ben: the PG decisions in progress.md §0 and the split vocabulary (Q-P1) |

---

## 4. Not built

Partly built items are marked *(partly)*, with what exists. Sources are under `docs/` unless they're code paths.

### 4.1 Workout logging

**During the workout**

| Item | Size | Waiting on | Source |
|---|---|---|---|
| Swap an exercise mid-workout (applies at once with Undo). Today it's only possible before Start | M | Ben (B3) | design/active-workout.md §4.4; exercise-library EL4 |
| Undo for delete set, skip exercise and corrections (these only confirm today) | M | Ben (copy D4) | ADR 0003; minimal-copy-audit D4 |
| Timed exercises (planks, hangs, carries) with a work timer. *(built on claude/gaps: picker, Start/Stop, `Log 0:45` without the timer, a `Time` notification at 0 when locked; needs a device check)* | M | nothing | active-workout §2.7; ADR 0010 |
| "Auto-save timed sets" setting (save the planned time at 0 with Undo), and the spoken `Time.` cue | S | Audio-session module (cue) | active-workout §2.7 |
| Distance sets (sled push, carries), so the sled-push guide can be reached | M | nothing | ADR 0011; exercise-library §8.2 |
| Supersets during the workout: create them, A1/A2 rounds, rest at the end of a round. *(partly: domain grouping, bracket on the overview)* | M | After the routine editor | active-workout §2.6 |
| In-workout "All" overview table (FitNotes style) | L | nothing | active-workout §2.4 |
| Custom number keypad with achievable-load keys (the system keypad is used now) | M | nothing | flow P5; active-workout §2.2 |
| Shorten today's session to fit the time left ("I've only got 15 minutes"), and an offer when Finish by will be missed | M | nothing | brief §7 shortenSession; active-workout §2.15.4; competitor #10 |
| "Machine busy today" without changing the saved gym | M | nothing | brief §4 setTemporaryAvailability; ADR 0019 |
| Exercise history sheet from the exercise header (comparable history) | M | nothing | active-workout §4.4; exercise-library §4.3 |
| Set-type control (warm-up / top / back-off / drop) in Edit set. *(partly: in the schema, no control)* | S | nothing | brief §1 |
| Transition rest between exercises: a way to set it. *(partly: carried into sessions, no UI)* | S | After the routine editor | rest-state §3 |
| "Ask for effort before logging" option. *(partly: after-logging and off exist)* | S | nothing | flow P3; profile-and-settings PS7 |
| Rest editor: "all working sets, today" scope and editing the running timer. *(partly)* | S | nothing | rest-state §2.4 |
| Remove an exercise added by mistake (nothing logged yet) | S | nothing | exercise-library §4.6 |
| Notes on an exercise or set (also to keep FitNotes comments as notes) | S | nothing | active-workout §4.4; ADR 0016 diff 6 |
| Edit history view for a set (corrections and marks) | S | nothing | active-workout §2.13 |
| "Why?" panel extras: History footer, "Use built-in rule" (AW4), "Undo this change". *(partly)* | S | nothing | active-workout §2.12 |
| "Swap ›" link when a target can't be loaded here, on the gym-switch card (GS5) and in Repeat | M | nothing | active-workout §2.11; ADR 0019 |
| "Check ›" / "Add equipment ›" actions on the gym-switch card; the card surviving a force-close | S | nothing | gym-switch §3.2; ADR 0019 |
| Logging while the coach is working re-sends once on the new state (now shows "Out of date" and Ask again). *(partly)* | S | nothing | coach-adjustments CA7 |
| Changing a set's side in a correction adds or removes the other-side set | S | nothing | ADR 0003 |
| Rest between the two sides of a one-sided exercise (full rest is used now) | S | Ben (B14) | ADR 0003; routines RT8 |
| Hold today's remaining raised targets when a pain flag is set mid-workout | S | Ben | active-workout §8.3 |
| Return towards pre-flag loads gradually after a pain flag clears. *(partly: pre-flag reference kept)* | M | Ben (R1–R6) | training-guides/return-to-load.md; active-workout AW10 |
| Lighter-session offer after a low check-in. *(partly: logic built and tested, never shown)* | S | Ben (B16) | check-in CI5; ADR 0020 §10 |
| Pain flag and set edit saved in one transaction (a rollback is used now) | M | ADR needed | reviews/active-set-r3 S2 |
| Barbell in kg with plates in lb | M | nothing | ADR 0003 |
| Tapping a rest notification opens the workout. *(partly: only the relaunch path does)* | S | nothing | lock-screen-and-alerts §4.3 |
| Hardware keyboard: Return = Done, Cmd+Return logs | S | nothing | active-workout §4.1 |
| Rename a workout while it's running (open-ended workouts) | S | Ben | premium-feel §13 item 6 |

**Summary**

| Item | Size | Waiting on | Source |
|---|---|---|---|
| Edit a finished workout: values, set types, a forgotten set. *(partly: times only)* | M | nothing | workout-summary §4 |
| Share or export a workout summary (text or CSV) | S | nothing | brief §12 Page 5 |
| Reopen a workout within 30 min of finishing | S | nothing | workout-summary §4 |
| "Based on edited sets" state with "Use built-in rule" / "Ask the coach again" | S | nothing | workout-summary §3 |
| Exercise row or comparison opens that exercise's history | S | After exercise detail (Progress) | workout-summary §4 |
| Optional estimated 1RM line (off by default) | S | After Progress e1RM | workout-summary §5 |

**Progression rules**

| Item | Size | Waiting on | Source |
|---|---|---|---|
| Plateau offer with a per-movement mute. *(partly: the built-in rule drops 10% after 2 misses)* | M | nothing | competitor-landscape #13; playbook rule 8 |
| Deload offer when performance drops. *(partly: playbook text only)* | M | nothing | playbook rule 10 |
| Treat one bad session differently from a repeated trend. *(partly)* | S | nothing | brief §3 |
| Plate order that keeps plate changes between sets to a minimum | M | nothing | competitor-landscape #15 |
| Swaps and order that prefer the station you're already at | M | nothing | competitor-landscape #16 |

**Bugs and loose ends found in the sweep** (each checked in code)

| Item | Size | Waiting on | Source |
|---|---|---|---|
| Built-in rule doesn't hold reps when the next load is a jump of more than 10% (`maxLoadJump: null`, `default-rule.ts:95`) | S | nothing | playbook 7-F; equipment-aware-progression EQ9 |
| Summary says "Done at more than one gym" after a same-gym equipment update (`gym-switch.ts:141`) | S | nothing | reviews/gym-switch-r3 M1 |
| Summary highlight and records use different "Heaviest" rules (1 vs 3 earlier sessions; imports ignored) | S | Designer: which rule wins | reviews/premium-feel-r2 S1 |
| With no equipment, next time still plans 0 + 2.5 kg | S | nothing | reviews/failure-tests-r2 S2 |
| Body-part-only pain mention may flag the focused exercise (S2 not confirmed fixed) | S | nothing | reviews/coach-v1-final-r3 S2 |
| Keychain wipe stops at the first item that fails to delete (`ai/keychain.ts`) | S | nothing | reviews/your-data-r6 N1 |
| Copy items O17/O18 still long (equipment editor save toast, gym detail "in use today") | S | nothing | minimal-copy-audit §9 |
| One shared wording helper for fit/snap lines (wording repeated in 4 domain files) | S | nothing | minimal-copy-audit §11 |
| Two time estimators (`duration.ts` vs `time-left.ts`); Finish by uses a ±5 min stepper instead of the wheel | S | Designer | active-workout §2.15 |
| FitNotes import: the r8 fixes (B1, B2, S1–S3) are committed but no r9 review is on file; still open SP1 ("Both together" halving dumbbell names) and the remembered EZ/trap bar weight not filled in | S | Review; SP1: Ben | reviews/fitnotes-import-r8; ADR 0016 "Still open after review r8" |

**Gyms and equipment**

| Item | Size | Waiting on | Source |
|---|---|---|---|
| Gym actions: set default, duplicate, archive, delete | S | nothing | gym-editor §4.5 |
| Quick travel gym (archives itself after a date) | M | nothing | gym-editor GE5 |
| Benches, racks and cable attachments as listable equipment | S | nothing | gym-editor GE2; brief §4 |
| Equipment notes (seat settings, dislikes) | S | nothing | brief §4 |
| One shared plate set per gym | M | nothing | gym-editor GE3 |
| "Out of order" / "Removed" equipment; delete unused items | S | nothing | gym-editor GE4 |
| More equipment types: kettlebells, EZ and trap bar, Smith machine, sled, erg, bands, medicine ball | M | nothing | ADR 0011; exercise-bank brief change 4 |
| Added weight on bodyweight stations (dip belt "BW + 10 kg") | S | Ben (GE8) | gym-editor GE8 |
| Shared history across gyms ("same equipment as…") | M | nothing | gym-editor GE9 |
| Check a routine against a gym | S | nothing | ADR 0019 |
| Move sets logged at the wrong gym | M | Ben (B21) | gym-switch GS13 |
| Which gym's sets decide next time after a split workout, with a note at Start | S | Ben | ADR 0019 GS-S4a |
| Today's gym chip opens a gym switcher sheet. *(partly: opens gym detail)* | S | nothing | today.md §4 |
| Draft a gym from equipment photos; photo of a weight stack suggests loads | L | nothing | brief §4; competitor-landscape #19 |

**Exercise library and guides**

| Item | Size | Waiting on | Source |
|---|---|---|---|
| Your own custom exercises: create, edit, hide (locked load type once logged). *(partly: only via FitNotes import "Add new")* | M | Ben (B12) | exercise-library EL3 |
| Search by other names and with typos ("RDL") | S | nothing | exercise-library EL1 |
| Picker filters (at this gym, muscle, movement, equipment) | M | nothing | exercise-library EL2 |
| Ask before adding an exercise whose equipment isn't here. *(partly: added without asking)* | S | nothing | exercise-library §4.2 |
| Browse the library and an exercise detail page with its guide | M | nothing | exercise-library §2.4 |
| Swap sheet intent chips and search | S | nothing | overview-today-edits TE9 |
| Catalogue to about 300 entries. *(partly: 135)* | L | nothing | exercise-bank-and-visuals §8 |
| Guides to about 100–150. *(partly: 10, all Draft)* | XL | Ben: review the 10 drafts | exercise-bank-and-visuals; ADR 0013 |
| Full-screen guide view | S | nothing | exercise-guides-v2 GV10 |
| Variations on How to; optional "how it should feel" cue | S | nothing | ADR 0013; competitor-landscape #17 |
| Rack prop and a visible-muscle-area warning in guides | S | Ben (guides B7) | ADR 0014 |
| Rest countdown inside How to | S | Phone feedback | exercise-library §8.9 P3 |
| Differentiate Without Color in guides. *(partly: drawing supports it, needs a native flag)* | S | nothing | ADR 0014 |
| Web review page for guides | M | nothing | exercise-guides-v2 §4.11.9 |
| Guide motion polish: one outline per limb (V4), 60 fps bake for larger sizes (V6, after a phone check), pose changes (squat S4, overhead-press soft knee S5, split-squat front shin) | M | Device test; pose changes: Ben | ADR 0017 "Not built yet" |
| Static muscle-focus figure on the overview. *(partly: text only)* | M | nothing | competitor-first-pages #10 |

### 4.2 Planning and programming

| Item | Size | Waiting on | Source |
|---|---|---|---|
| Goals & schedule: goal, days a week, session length, experience, other training, event (Profile and optional setup steps) | L | Ben (D13 bulk approval) | profile-and-settings §2.2; onboarding §2.7; playbook rule G |
| Weekly sets per muscle from your days a week (playbook rule 1) | M | After Goals & schedule | volume-by-frequency.md |
| Routine editor: set templates, Auto/Fixed/% of top set, rep ranges, effort, rest by set type, supersets, reorder, pick several exercises | XL | nothing | routines §2.3; brief §12 Page 2 |
| Duplicate routine; version history and restore; who made it (Coach/You/Imported); AMRAP flag; "counts as heavy legs" | M | After the routine editor | routines §4.4, §4.8, RT5–RT7 |
| Explicit rotation with Add/Remove and Edit rotation | M | nothing | routines RT9; weekly-plan WP19 |
| Plan hub (Week · Routines) | L | nothing | routines RT1 |
| Simple weekly plan: week view, aim vs done, move/skip/missed | XL | Ben (B11) | weekly-plan §2.2; brief §4 |
| Reschedule a session (also hidden in the check-in), with conflict review | L | After the weekly plan | brief §7; check-in §2.5 |
| Availability this week and a mismatch note | M | After the weekly plan | weekly-plan §2.7 |
| Today extras: "This week: 2 of your 4 days", "Then: Pull A · Legs A", "N coach suggestions to review", first-use links, Shorter session, a "Not training today" card. *(partly)* | M | After Goals & schedule / weekly plan | today.md §2–§4 |
| Pin the lift shown on Today. *(partly: chosen automatically)* | S | After Progress pins | today.md; progress §2.4 |
| Coach workout builder: build sheet, review screen, drafts kept 14 days, from the coach sheet | XL | Ben (B6) | workout-builder.md; CHANGELOG v0.5 |
| Multi-week programmes (weeks, deloads, phases) | XL | After the weekly plan | weekly-plan WP18; brief §7 createProgramme |
| Lighter first session after a break (today-only edit) | M | Ben (R1–R6) | overview-today-edits §9; competitor-first-pages #13 |
| Repeat: "Start Push A instead" link | S | nothing | routines §2.4 |

### 4.3 Coach

| Item | Size | Waiting on | Source |
|---|---|---|---|
| Coach reads past training, gym equipment and built-in targets (tools declared, no executors), plus a "How am I doing?" chip | M | nothing | ADR 0020 §10; coach-contract §6.1 |
| Coach proposes structural changes (swap/add/remove/reorder) as Apply cards. *(partly: swap, remove and reorder built on claude/coach-tools; add not offered, see next row)* | L | Ben (ADR 0020 §3) | CLAUDE.md rule 3; coach-adjustments CA9 |
| Coach proposes adding an exercise to the next workout (Apply card with Undo). The pre-start draft (ADR 0022) has no slot for an added exercise yet | M | After workout-library (or a draft model that can hold an add) | ADR 0020 §3; reviews/coach-tools S8, SP1 |
| Variety requests become a change-review card on a routine | M | After structural changes | workout-builder WB14 |
| Generic change review: stored proposals with scopes (today / one date / from now on / programme), review list, change history, "Ask for changes". *(partly: gym-switch and "Change routine too" cards)* | L | Ben (CR1) | change-review.md |
| Memory screen: list, edit, forget, suggestions needing Save, expiry. *(partly: save/forget through chat)* | L | nothing | coach-memory §2.1–2.4 |
| Playbook tab: review and approve rule candidates, rules by when they apply, edit default numbers. *(partly: candidates stored, unused)* | XL | Ben (B8) | coaching-playbook §2; ADR 0020 §10 |
| Your own guides (PDFs) indexed on the phone, excerpts to the coach | XL | Ben (B9) | coaching-playbook §2.5–2.7 |
| Playbook conflicts view, guardrails page, citations in replies, "which rules this build implements" | M | After the playbook tab | coaching-playbook §2.4, §2.9, PB15 |
| Conversation search, rename, delete and retention | M | nothing | coach-sheet §4.7 |
| Coach offer thresholds editor | S | nothing | coach-adjustments §4.7 |
| Log or correct a set by chatting ("Log 100 for 8") | M | Ben | ADR 0020 §2; coach-sheet §2.7 |
| Quick-action chips kept above the text box. *(partly: only on an empty thread)* | S | nothing | gymbuddy-visual-reference §7.4 |
| Exercise option cards in replies | M | nothing | gymbuddy-visual-reference §7.4 |
| "Not shown" hidden sentences in Why?; a "What the coach can do" sheet. *(partly: data exists)* | S | nothing | coach-contract CC9, §2.5 |
| Summary chat can revise next time's targets | S | nothing | reviews/coach-v1-final-r3 |
| "This week: N coach messages" line on the connection card | S | nothing | ai-connection §2.6 |
| Detect offline straight away (expo-network) instead of after a failed request | S | Ben (new dependency) | ADR 0020 §8 |
| Coach sees 4 weeks of check-ins | S | Ben (B18) | check-in CI10 |
| Similar-movement chips when setting a pain flag; pain-flag history and "Add pain flag" in Profile | S | Ben (B5) for the chips | coach-memory CM5, §2.6–2.7 |
| Ask with the Progress screen's context | S | After Progress | progress §4.5 |
| Your own API key route (OpenAI) with spend caps; Claude API adapter | L | Ben (B10) | ai-connection §2.7–2.9; ai-access-and-voice |
| Offline explanations using Apple's on-device model (spike) | L | Device test | competitor-landscape #18 |
| External assistant (your app's tools exposed to ChatGPT) | L | nothing | brief §2 |
| Baseline: run the brief's scenarios in ChatGPT voice mode and compare (no build) | S | Ben (30 min) | competitor-landscape #5 |

### 4.4 Progress and analytics

Section 3 covers the v1 build. These come after it.

| Item | Size | Waiting on | Source |
|---|---|---|---|
| Lifts you follow: pin up to 3, with suggestions | M | nothing | progress §2.4 |
| Exercise detail: trend chart, metric and range chips, table, monthly history, pain status | XL | nothing | progress §2.3 |
| All exercises list with search | S | nothing | progress §4.1 |
| Calendar month view; mark a week as deload | M | nothing | progress §2.6, PG14 |
| Check-ins on Progress (raw entries, points-only chart) | M | nothing | check-in CI11 |
| Weekly review (three facts and one optional suggestion) | L | nothing | brief §12 Page 6; progress §2.7 |
| Monthly recap (facts only) | M | nothing | competitor-analytics #6 |
| Body map of weekly sets | M | nothing | competitor-analytics #8 |
| Extra per-exercise metrics (best set reps, totals) | S | nothing | competitor-analytics #9 |
| Body weight log (manual) | M | Ben | competitor-analytics #7; playbook D5 |
| Sets-per-muscle guide band (10–20 or by goal) | S | Ben (rule 1 ranges) | progress PG6 |
| Set muscles for custom exercises | S | After custom exercises | progress §4.6 |
| Edit history on past workouts. *(partly: past Summary opens)* | M | nothing | progress §2.6 |
| Resume bar on Progress and Profile during a workout | S | nothing | progress PG5 |
| Home or lock-screen widget (Up next, workouts per week) | L | Device test (App Group) | competitor-first-pages #12 |

### 4.5 Data and import

| Item | Size | Waiting on | Source |
|---|---|---|---|
| Export as CSV, FitNotes 2 CSV or Strong-compatible CSV, by date range, through the share sheet | M | Ben (accept JSON for now?) | ADR 0023; competitor-landscape #11 |
| Send a backup copy through the share sheet (AirDrop, Mail) | S | nothing | data-import-export §4.1 |
| Backup settings: on/off after each workout, keep 7/14/30/All | S | nothing | data-import-export DX9 |
| Automatic off-phone backup to a chosen folder (off by default) | M | Device test (DEP-FILES) | data-import-export §2.2 |
| Online backup to Google Drive's hidden app-data folder (Google sign-in in the system sheet, drive.appdata scope, token in Keychain, no server; Ben creates a free Google Cloud OAuth client once; unverified-app warning acceptable for one user). Parked by Ben 12 Oct; preferred over an own server | M | Ben (parked) | Ben 12 Oct chat |
| "Save a copy first" before import, restore and updates. *(partly: delete and reset only)* | S | nothing | data-import-export §4.1a |
| Restore a backup but skip damaged records | M | nothing | ADR 0005 |
| Clear AlarmKit alarms, Live Activities and audio on Delete my data | S | After those features | ADR 0023 |
| Import any app's history with AI (model proposes the columns, code checks them) | L | Ben (Q1 sample file, Q3) | research/ai-import.md; data-import-export §9 |
| Remembered import layouts; import from notes or pasted text; "Ask the coach to suggest matches" | L | After AI import | ai-import Recs 6, 9; AI14 |
| FitNotes history used as "Last" and repeatable | M | Ben (B7) | ADR 0016 P-I3 |
| `.fitnotes` (Android backup) import | M | Ben | fitnotes-export-format Rec 8 |
| Import polish: implausible-load flag, side-by-side for dates already logged, row-count progress, Undo-import note about skipped dates, specialty/Smith bar choice, remove one answer, source on a history set. *(partly)* | M | nothing (bar choice: designer) | ADR 0016; reviews/fitnotes-import-r8 |
| Delete or undo a check-in; check-in settings (days, thresholds) | S | nothing | ADR 0010; check-in §2.8 |

### 4.6 Voice and audio (build step 5)

| Item | Size | Waiting on | Source |
|---|---|---|---|
| Tap-to-talk set logging ("100 kilos, eight reps, RPE eight"): on-device parser, voice strip with Undo, one clarifying question | XL | Device test (DEP-STT en-GB, gym noise) | voice §2.1, §4.2; flow P7/P10 |
| Voice commands: undo, skip rest, ±30 s, what's next, pause, machine busy, pain, yes/no to offers, "done" | M | After voice logging | voice §4.3 |
| Voice elsewhere: check-in, Today ("start my workout"), overview edits, gym switch *(partly: parser built, unused)*, set marks, exercise search, coach sheet | M | After voice logging | voice; today.md; gym-switch GS9 |
| Spoken set and rest cues ("Logged 100 for 8. Rest two minutes"), 15 s heads-up, music ducking. *(partly: Swift audio module works in probes only)* | L | Device test (DEP-AUDIO) | rest-state §5; lock-screen-and-alerts §5 |
| Cue modes Quiet / Set cues / Conversation and a Voice & alerts settings screen (voices, rate, volume, timer sound, talking options) | L | nothing | profile-and-settings §2.6; voice §2.5 |
| Spoken coach replies (Apple voice), stop and mute; spoken offers and "Workout saved" cue | M | nothing | voice §3.2; coach-adjustments §5.3 |
| OpenAI voice option | M | Ben (B10) | ai-connection §2.8 |
| Speak while locked (opt-in) | L | Device test + Ben (B13) | lock-screen-and-alerts §2.4 |
| Rest-end chime and a custom notification sound (`rest-end.caf`) | S | nothing | design-system §6 |
| Separate on/off for each haptic | S | nothing | premium-feel §13 item 8 |
| Microphone permission asked in context | S | After voice logging | onboarding §4.6 |

### 4.7 Wearables and endurance (parked by Ben, 9 Oct)

| Item | Size | Waiting on | Source |
|---|---|---|---|
| Garmin FIT file import and a Data sources screen (first in Ben's later order) | L | Ben (un-park) | wearables-garmin Phase 1 |
| HealthKit probe, then Apple Health read (workouts, resting HR, sleep) | L | Ben (un-park) | wearables-garmin Phase 0, 2a |
| Unofficial Garmin Connect reader | XL | Ben (accept the risks) | wearables-garmin Phase 2b |
| Live heart rate from the watch over Bluetooth | L | Ben (watch model) + device test | garmin-live-data Recs 1–2 |
| Garmin data through Amalgama's link | M | Ben | garmin-live-data Rec 4 |
| Endurance context: planned sessions, Progress cards, trade-off notes (rules 11–13), coach tools, reschedule | XL | After FIT/Health import | brief §3–§4; weekly-plan; concurrent-training.md |
| Apple Watch app | XL | Later decision | brief §10 step 7 |

### 4.8 Platform and iOS polish

| Item | Size | Waiting on | Source |
|---|---|---|---|
| Lock-screen and Dynamic Island rest countdown during workouts. *(partly: probe widget only; build 7 failed on the App Group)* | L | Device test (DEP-LIVE retest after the App Group fix) | lock-screen-and-alerts §2.1; competitor #1 |
| Quiet "Resting until 18:42" notification when the Live Activity doesn't work | S | After that retest | lock-screen-and-alerts P-L6 |
| Loud rest alerts through AlarmKit (Off / Long rests / Every rest) | M | Device test (DEP-ALARM) | lock-screen-and-alerts §2.3 |
| Optional "workout still running" reminder | S | nothing | lock-screen-and-alerts P-L7 |
| "When rest ends" settings section and a 10-second Test rest alert | M | nothing | lock-screen-and-alerts §2.5 |
| Profile sections: Training, Voice & alerts; settings screens for logging, rest presets, check-ins and appearance. *(partly)* | M | nothing | profile-and-settings §2.1–2.9 |
| Setup gaps: edit rest presets, "+ Add something else", limitations step, Connect the coach and Import history rows on Ready | S | nothing | onboarding §2.2–2.8; ADR 0016 diff 8 |
| Signing: refresh reminder notification, "I refreshed today", signing tool setting | S | nothing (tool setting: bulk approval) | system-states §3.5, P-S4 |
| "Updated to build N, your data carried over" notice; database update cover with steps | S | nothing | system-states §3.6 |
| Per-screen error boundary; set aside a damaged unfinished workout | S | nothing | system-states §3.8, P-S5 |
| App status: Permissions section, Copy status report; About this build (privacy, licences); Credits for wger and guide sources | S | nothing | system-states §2.4; profile-and-settings §2.11; ADR 0011 |
| Deep links (`fizz://`); development client for quick test loops | S | nothing | ADR 0007, 0008 |
| Full accessibility pass (AX sizes, VoiceOver), including the overview at large text | M | Device test | design-system §10; workout-overview §11 |

### 4.9 Look and feel

| Item | Size | Waiting on | Source |
|---|---|---|---|
| Light appearance for the shipped look and a System / Dark / Light setting. *(partly: only the old Direction A follows the system; D is always dark)* | S | nothing | brief §12; profile-and-settings §2.9 |
| Optional display serif for a few titles | S | Ben (optional) | thirdspace-visual-reference Rec 3 |
| Rest countdown ring (developer toggle) | S | Ben | premium-feel §13 item 5 |

---

## 5. Waiting on Ben

Each question can be answered in a word. The suggested answer is what the specs or code already assume. "Yes to all suggestions" is a fine answer.

### 5.1 Decisions that unblock building

| # | Question | Suggested |
|---|---|---|
| B3 | When you swap an exercise yourself mid-workout, does it apply straight away with Undo (rather than an Apply card first)? | Yes |
| D13 | Approve the Goals & schedule design (goal, days a week, length, other training) and the rest of the bulk defaults in open-decisions §B? (Your 9 Oct "defaults accepted" covered D1–D22, but D13's own default was "pending your bulk approval", so it's still open.) | Yes |
| ADR 0020 §3 | Let the coach suggest structural changes (swap/add/remove exercises) as Apply cards, only when you ask or something changed? | Yes |
| Coach tools | Let the coach log or correct a set when you tell it to in chat, with Undo? | Yes |
| B16 | Lighter-session offer after a low check-in: on the first set card (rather than in the check-in)? | Yes |
| R1–R6 | Approve the return-to-load rules (lighter first session after 14+ days off; gradual return after a pain flag)? | Yes |
| Pain mid-workout | When you flag pain mid-workout, also hold that exercise's raised targets for the rest of today? | Yes |
| Copy D4 | Undo after deleting a logged set (instead of a confirm alert)? (Not playbook D4, which is settled.) | Yes |
| B8 | Is the app the record of which playbook rules you approved (v1 arrives already approved)? | Yes |
| B11 | Build a weekly plan soon, or is "next in rotation" enough for now? (D19 already made the next workout follow what you last trained; the 8 Oct spec suggested building the plan early.) | Rotation is enough for now |
| B12 | Custom exercises you create: Your data (as the code does) or Coaching knowledge (as the 8 Oct spec suggested)? | Your data |
| CR1 | Change suggestions use four scopes in words (today / one date / from now on / programme)? | Yes |
| B6 | Coach-built workouts with no history on that equipment leave the load blank ("start light")? | Yes |
| Q-S1 | Session picker: take an imported workout's session type from FitNotes' Category? | Yes |
| Q-P1 | Progress: approve the Push/Pull/Legs/Core/Other split and the PG defaults in progress.md §0, and the analytics brief changes (a Stats screen alongside brief §12 Page 6's "no dashboard" line; time in gym leaves out imported and open-ended workouts)? | Yes |
| DW-Q1, Q3, Q4, Q6 | Delete workouts: allow deleting one set in a finished workout; list imported workouts with an "Imported" tag; restore keeps deleted workouts deleted; add deletion to the brief? | Yes to all |
| Network check | Add `expo-network` so offline shows at once (instead of after a failed request)? | Yes |
| B5 | After pain on one exercise and a swap to a similar one, block the similar one from going up today? | Yes, today only |
| B7 | Show FitNotes history as "Last (FitNotes, 1 Oct)" when the machine wasn't recorded, and let imported workouts be repeated? | Yes, labelled |
| Export | JSON-only export is enough for now (CSV and Strong CSV later)? | Yes |
| Q1 (AI import) | Which other apps' history do you have? Send one real sample file | FitNotes only for now |
| Q3 (AI import) | If the ChatGPT plan can't do the import, fall back to an API key? | No |
| FitNotes file | Send your real FitNotes CSV export so the importer can be checked against it | Send it |
| `.fitnotes` | Is anything missing from your CSV that would need the Android backup import? | No |
| Body weight | Add a simple manual body-weight log? | Later |
| Rule 1 band | Show a sets-per-muscle guide band on Progress? | After Goals & schedule |
| B10 | Add your own OpenAI API key (paid, with caps of $5 text and $2 voice)? | Not now |
| B18 | Should the coach see 4 weeks of check-ins (rather than only today's)? | No, today's only |
| B21 | Offer "Move 2 sets to Home" when you logged at the wrong gym? | Later |
| Split gym | After a workout split across two gyms, should the latest part decide next time, with a note at Start? | Yes |
| GE8 | Allow added weight on bodyweight stations ("BW + 10 kg")? | Yes |
| B14 | Rest between left and right sides: full set rest until you've tried it? | Yes |
| Rename | Allow renaming a workout while it's running? | Yes |
| B13 | "Speak while locked": decide after the phone test, then opt-in and off by default? | Yes |
| Discard | One Discard rule: confirm only when something is logged? | Yes |
| Repeat, no kit | Repeating an exercise logged with no equipment: drop the load and let you enter it? | Yes |

### 5.2 Confirm defaults already built or assumed in the specs

| # | Question | Suggested |
|---|---|---|
| B1 | Permanent app ID `com.projectfizz.fizz` (it can never change after the first real install)? | Yes |
| B2 | Backups stay plain readable files (training data only, no passwords), not encrypted? | Yes |
| B4 | Tapping Adjust on a coach offer counts as yes (applies with Undo)? | Yes |
| B9 | Guide PDFs are left out of backups (only their index is kept)? | Yes |
| B17 | Pain in the check-in without a movement: don't insist; the Summary asks later? | Yes |
| ADR 0023 | Your data slice as built: delete order (database first, then Keychain), Reset keeps today's draft, Undo last reset brings back only coaching knowledge, Reset saves a pending restore's copy first, "Save a copy first" offered before Delete? | Yes to all |
| Proposed ADRs | Confirm 0007 (identity), 0008 (navigation), 0019 (gym switch), 0021 (overview Start), 0022 (saved draft until midnight) and the provisional 9 Oct choices (built-in rule rep ranges, "typical gym" when none, folder picker, whole-file restore)? | Yes |
| ADR 0003 | Brief wording: Undo checks the set's own version; progress only when every planned set is done; a left + right pair counts as one set? | Yes |
| Coach rules | Coach Undo is refused after a gym change; honesty rules ("No change made.", wrong numbers dropped)? | Yes |
| Rule T | Coach offers compare logged effort with planned effort (built). The CHANGELOG records it as approved, but your only reply was "Ok." and provisional decisions item 4 still lists it as yours. Keep it as built? | Yes |
| Copy D1, D2 | A one-word `Rule` tag on built-in targets (explanation behind Why?); the check-in pain step keeps the see-a-professional and red-flag lines but drops "The coach can't diagnose"? | Yes |
| Import rules | FitNotes import answers as built (generic aliases, "Both together" for dumbbells, etc.)? | Yes |
| Motion | Record and finish haptics and the motion tokens? | Yes |
| Overview defaults | Today's-edits defaults in overview-today-edits §10? | Yes |
| Guides | Muscle definition tint: neutral (rather than violet)? | Neutral |
| Guides | Redraw the lat pulldown guide from behind? | No, keep it |
| Guides | Review the 10 draft guides on the phone (squat bar path, pulldown, overhead press knee, bench tempo) | When you can |
| Credits | Approve research brief changes 1–6 (Credits screen, more equipment types)? | Yes |
| Raw `.db` | Drop the raw database snapshot as a second backup format? | Yes |
| Per-section restore | Keep whole-file restore (separate Your data / Coaching knowledge restore stays deferred)? | Yes |

### 5.3 Say no to these for now

| # | Question | Suggested |
|---|---|---|
| Start now | Long-press Start to skip the overview? | No |
| Ring | Rest countdown ring? | No |
| Serif | Display serif for titles? | No |
| P-S3 | "New build available" notice? | No |
| Realtime | Live speech-to-speech coach? | Not now |
| Garmin | Unofficial Garmin connector? | No (wearables stay parked) |
| Baseline | 30-minute ChatGPT voice comparison? | Optional |

### 5.4 Already answered (docs to tidy, no action from Ben)

- **B19** (whose next-time targets win) was answered by D21: the coach's small changes are the default.
- **B20 / D22** ("Too hard" drop at least 5%, at most 10%) was accepted with the other playbook defaults on 9 Oct. `playbook-v1.md` §5 still says "until Ben decides".
- **B15** (check-in as a sheet on Start) was already approved.
- **DEP-AI / S1** (ChatGPT sign-in on the iPhone) passed on 10 Oct.
- **Playbook D1–D22** were settled on 9 Oct (D19 rotation, D21 coach targets, the rest as proposed), except D13 (still in 5.1). D5 settled "no body-weight entry, assisted moves one step", so the Body weight question in 5.1 is a new ask from the analytics research.
- **AI import Q2** (sending column names and sample rows to ChatGPT) was approved on 11 Oct: "Fine to send stuff to ChatGPT."
- **Rule T** is approved in the CHANGELOG, but `provisional-2026-10-09.md` item 4 and open-decisions Part 2 still say it's open (confirm in 5.2, then tidy).

### 5.5 Waiting on a phone test (not a decision)

SideStore trial run (update over the top, skip a refresh, restore) · Live Activity retest after the App Group fix (DEP-LIVE) · AlarmKit (DEP-ALARM) · speaking with music and AirPods, and speaking while locked (DEP-AUDIO) · en-GB speech in gym noise (DEP-STT) · folder bookmark (DEP-FILES) · coach C9 pack (tool round trip, refresh after an hour, limits) · ID-token signature re-run · restore of a backup taken on your phone · SQLite kill mid-write · large text and VoiceOver on the overview and gym switch · two taps to the first logged set · guide bake time and autoplay.

---

## 6. Dropped or superseded

| Item | Why |
|---|---|
| Readiness chips on Today (P11) | Replaced by the pre-start check-in (v0.9) |
| Fixed rules as the main way to progress | The coach leads; the rules are the labelled fallback (v0.4, ADR 0006) |
| HYROX special case, a fixed 10-set start | Playbook v1: rule 14 removed, rule 1 revised |
| Writing workouts to Garmin | Wearables are read-only (v0.8) |
| Garmin LiveTrack, Connect IQ app, Garmin developer API, Strava API | Rejected in research (anti-bot checks, write routes, business-only) |
| Web client, cross-device sync, private backend | Personal use only (CLAUDE.md) |
| Time Sensitive rest notifications | Not possible on a free Apple ID (ADR 0004) |
| Lock-screen buttons (+30 s, Skip, Log) | Deferred out of the first milestone (P-L4). Revisit after real use |
| Inline "Alert when rest ends?" row on the rest card | The ask happens once at the first Start (premium-feel §3.5) |
| Sign in on a computer and move the credential | Not needed: on-phone sign-in passed |
| Routine detail screen; a Start button on routine rows | The workout overview is the one pre-workout page |
| Per-section restore (Your data / Coaching knowledge) | Whole-file restore (provisional 9 Oct, Ben to confirm). Backups still label both sections |
| Raw `.db` snapshot as a second backup | JSON only (Ben to confirm) |
| GymBuddy-style monochrome palette B | Direction D adopted |
| Wrong-form "ghost" frame in guides | "Not now" (GV9). Revisit only if you ask |
| Realtime voice coach | Not in this release. A later, explicit decision |

---

## 7. Proposed next six slices

Run the phone checks in 5.5 alongside these. The first-milestone rule says backup and restore must be confirmed on the phone before a real workout is logged.

1. **Finish Delete workouts** (in progress). You asked for it on 11 Oct, it's mostly written, and it needs the purge ADR and a review.
2. **Finish the session picker** (in progress). The review fixes are known. It needs one yes from you (Q-S1).
3. **Progress analytics v1** (task #22). These are your four asks: how often, how long, which muscles, estimated 1RM and records. The spec is ready, and it opens the way to exercise detail and history links.
4. **Workout gaps**: mid-workout swap (B3), Undo for delete set and skip (D4), timed exercises with a work timer, and the five small bugs in 4.1. These are the most likely day-one annoyances once real workouts start.
5. **Coach can see your training**: read tools for past sets, equipment and targets, then a memory screen and the playbook candidate list. These are small (M), need no decision, and make every coach answer better.
6. **Lock-screen countdown** in the rest flow, once the DEP-LIVE retest passes. If it fails, build the quiet "Resting until" fallback instead. It's the top competitor opportunity and is already approved.

Next in line: Goals & schedule plus rule 1 volume (after D13), the routine editor (which also unlocks supersets and transition rest), then voice (build step 5) once the en-GB speech test passes.

## Ben's feedback 13 Oct (build 131-era; triaged, not started)

| # | Item | Type | Triage |
|---|---|---|---|
| F1 | Coach doesn't let you talk to it (voice) | Feature | Brief §10 step 5 (on-device tap-to-talk). Large; later |
| F2 | Live two-way voice during workout + music | Feature | Realtime voice deferred (paid route, rule 7). Music: ducking already in audio-session module; Spotify integration not needed, "just works" with ducking. Later |
| F3 | Current set doesn't say warm-up / working / drop set | Bug-ish UX | Small. Set-type tag on Focus/current row **Built on claude/quick-wins (13 Oct); device check pending.** |
| F4 | What does RPE 6–10 mean? | UX | Small. "Why?" info tap with RIR wording (minimal-copy rule) **Built on claude/quick-wins (13 Oct); device check pending.** |
| F5 | Keyboard stays up on working set | Bug | Small. Same fix as coach sheet (tap-out/Done/dismiss on Log) **Built on claude/quick-wins (13 Oct); device check pending.** |
| F6 | Edit sets inline in table without opening each set | Feature | Medium. Editable table cells |
| F7 | Focus view: swipe/buttons prev/next set, pinch out to workout | Feature | Medium |
| F8 | Focus view shows last set's effort without saying it's previous; rest = previous small (editable) + next set, under timer | UX | Medium, high value |
| F9 | Reps ≥ 10 show as 1 when logging | Bug | Small, high priority; likely field width/truncation — verify on device **Built on claude/quick-wins (13 Oct); device check pending.** |
| F10 | Recommended rest from what was done (effort) | Feature | Medium; deterministic rule + coach. Playbook candidate |
| F11 | Table view: stack and reps on one row | UX | Small **Built on claude/quick-wins (13 Oct); device check pending.** |
| F12 | "Couldn't reach the coach" errors | Bug | Catch-all text hides real cause (too_many_steps/no_reply/unavailable, sheet-view.ts:317-322). Show reason under Why? and log it; likely builder tool loops hitting step cap **Built on claude/quick-wins (13 Oct); device check pending.** |
| F13 | Target vs achieved per set, used for adjustments | Feature | Mostly exists (target RPE/reps vs logged, rule T). Needs visible target vs actual on table/summary |
| F14 | ± time at end of workout works badly | Bug | Needs repro detail |
| F15 | Progress periods: 7/14 vs 30 look different; any period (3 m, 4 m); 60-day formatting; prefer charts | UX | Partly fixed in build 133 (custom period). Make one adaptive bar chart for all periods (7/14 d: daily bars; 30/60 d: weekly; 3–12 m: monthly), same layout, labels thinned to fit (60 d labels currently skip/misalign, zero bars clutter). Screenshots 13 Oct **Built on claude/quick-wins (13 Oct); device check pending.** |
| F16 | Muscles table header "SESSIONS" wraps to "SESSION / S"; Ask button overlaps the table | Bug | Small: narrower header word or column width; content bottom padding under the Ask button **Built on claude/quick-wins (13 Oct); device check pending.** |
| F17 | TIME tile shows 45 min next to 3 sessions when only 1 has a time (imports have none) | UX | Small: show time only as avg of timed sessions, or label "45 min · 1 timed"; keep the footnote **Built on claude/quick-wins (13 Oct); device check pending.** |
| F18 | Workout set structure as a per-set table: columns Weight · Reps · RPE, each changed by a scroll wheel; per-set values (not one weight per exercise); reps can be exact or a range. Library editor and edit-before-start overview | Feature | Medium. Supersedes F6 for the editor; reuse the existing per-set templates (load/reps/RPE already stored per set) |
| F19 | Build card: drop the "Coach picks" chip; the coach builds whichever split is selected, defaulting to the next split from the Settings split (D7) | UX | Small; do with D7 |
| F20 | Session list names imported sessions from the FitNotes Category ("Trapezius"); name them from their exercises like the overview ("Pull"). Today "Legs · 45 min" then "45 min" repeated | Bug | Small; with quick wins |
