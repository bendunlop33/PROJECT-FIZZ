# Device test: the workout on the Lock Screen (Live Activity, rest buttons, rest-done alert)

**About 10 minutes on the iPhone, with one short real workout.** Updated 26 Oct 2026 for the build with Ben's lock-screen changes (last time on the Lock Screen, `−15 s` / `+15 s` / `Skip` buttons, the new rest-done text). Put **P**, **F** (with one line) or **–** in each row and paste the table back. A screenshot of anything odd helps.

**Status: open, not run.** (27 Oct: rest-end switch and new cues added at the top; 27 Oct (b): Log on the Lock Screen, steps L1–L7.) Every Live Activity check so far ran against a fake ActivityKit. Only the Capability probe's countdown has passed on the phone. The buttons are new and are the main unknown: they need no entitlement, but whether iOS delivers the tap to GymSmarter when it's installed through SideStore is only known once this runs.

## New in the 27 Oct build: rest end on the Lock Screen, and rest cues (3 min)
Ben, 27 Oct (build 435): the Lock Screen stayed at 0:00 when the rest ran out. Now the activity is told the next set when the rest starts, and iOS switches to it by itself at the end, even with GymSmarter suspended.
- **A. Probe (2 min, no workout):** Profile › Developer › Capability probe › Live Activity › Run. Lock the phone and wait for its 2:00 countdown to reach 0:00 (don't open the app). It should turn to **Ready · Probe** / `Bench press · Set 2 of 3` / `Target 100 kg × 8` within a second or two of 0:00.
- **B. Workout:** step 5 below (lock through a rest): at 0:00 the banner turns to **Ready** with the next set, target and `Last …`, no countdown, no buttons, and the **Rest done** notification arrives. Note how long after 0:00 it changed (at once / a few seconds / only when I woke the screen / never).
- **C. Dynamic Island:** in another app through a rest end: the compact island shows `Set n` instead of a countdown.
- **D. Voice cues (app open, Profile › Voice › Timer and set details):** 15 s before the end: "15 seconds. Next: bench press, set 3, 80 kilos for 8." (dumbbells say "each"; pounds if the set is in pounds). At 0:00: just "Rest over." With **Timer only**: "15 seconds." then "Rest over." A rest of 15 s or less: only "Rest over."

## New in the 27 Oct (b) build: Log on the Lock Screen (4 min)
Ben, 27 Oct: a **Log** button on the Lock Screen, like Hevy. Build without `FIZZ_LA_LOG=0` or `FIZZ_LA_BUTTONS=0`. Use a rep exercise with a target (bench press).
- **L1. Ready shows Log:** start, skip the first rest (or lock before the first set). Lock: under the target, one button **Log 100 kg × 8** with the same numbers as the in-app Log button. Dumbbells read `each`; a set you edited in the app shows your edit.
- **L2. Log from the Lock Screen** (don't unlock): within about a second the banner turns to **Rest** with the countdown and **−15 s / +15 s / Skip** for the next set. The **Rest done** notification arrives at the end.
- **L3. Rest end → Log again:** stay locked through that rest: at 0:00 the banner shows Ready with **Log** for the next set. Tap it: the next rest starts.
- **L4. Open the app:** the logged sets are there with the right values and times; a toast **Set n logged from Lock Screen · Undo** shows once. Tap **Undo**: that set is back as not done and its rest is gone.
- **L5. Double tap Log quickly:** one set logged, not two.
- **L6. Force-closed:** with Ready on the Lock Screen, swipe GymSmarter away, lock, tap **Log**. Either the banner turns to Rest (best case) or nothing changes. Open the app: the set is logged once, with the tap's time. Never twice, never an error.
- **L7. No Log where it needs input:** a timed set (plank) or cardio set shows no Log; after the last set the banner says `Open GymSmarter to finish`. Also: is the banner too tall with the Log row?

## Before you start (1 min)
- Install the IPA built from branch `claude/lockscreen-26oct` (or the branch it was merged into) **over the top** with SideStore. Built with the Live Activity on (the default) and without `FIZZ_LA_BUTTONS=0`.
- Settings › GymSmarter › **Live Activities on**; notifications allowed.
- For `Last …` you need an exercise you've logged before **at this gym with the same equipment** (an earlier workout, or a FitNotes import with the same unit). Bench press is used below; use whatever you have.
- Close the Capability probe's test countdown if it's still showing.

## The 10-minute run
1. **Start** a workout and add Bench press (or start a routine with it). Lock: a **Ready** activity with `Bench press · Set 1 of n`, the target, and `Last … × …` (if set 1 is a working set; a warm-up has no `Last`).
2. Log a working set. Lock straight away: **Rest** with the big countdown, `Until hh:mm · Bench press · Set 2 of n next`, the target, `Last 100 kg × 7` (your number from last time's matching set), and three buttons **−15 s**, **+15 s**, **Skip**. Check `Last` against that workout in History.
3. **+15 s on the Lock Screen** (don't unlock): within about a second the countdown and `Until` move 15 s later. Tap **−15 s** twice: 15 s earlier than where it started. Unlock and open GymSmarter: the rest on screen matches.
4. Lock, tap **Skip** on the Lock Screen: the activity turns **Ready** for the next set. No **Rest done** notification arrives later for that rest. In the app, rest is over and **no set was logged**.
5. Log another set, lock, and **wait through the rest** (don't open the app): at 0:00 the activity turns to **Ready** with the next set, target and `Last …` (no countdown, no buttons), and the **Rest done** notification arrives at that moment reading `Bench press · set n · target … · last …`. Open the app: nothing on the Lock Screen changes.
6. **Force-close mid-rest**: log a set, swipe GymSmarter away in the app switcher, lock, tap **+15 s**. Either the countdown moves (iOS launched the app in the background: best case) or nothing happens. It must never show an error, and the notification still arrives (at the new time if it moved). Note which.
7. **Dynamic Island** (in another app during a rest): long-press shows the countdown, the next set, `Last …` and the three buttons; **+15 s** there works too.
8. **Legibility**: at arm's length in gym light, the countdown is easy to read; with the buttons and the `Last` line nothing important is cut off (`Until …` may end in `…`; the target must not). Is the banner too tall or cramped?
9. **Pause** during a rest, lock: **Paused**, no buttons. Resume: the countdown and buttons are back.
10. **Finish** the workout: the activity disappears at once.

If time is short, run 2, 3, 4, 6 and 8.

## If there's time
- 11. **Live Activities off** (Settings), start a workout, log a set: no activity, no error, the notification still arrives with `last …`. Turn them back on mid-workout and log a set: the activity appears (no relaunch needed).
- 12. **Swipe the activity away** during a rest: it stays gone for this workout; the notification still arrives.
- 13. **VoiceOver** on the Lock Screen: the activity reads `Rest, until hh:mm. Next: Bench press, set n of m, target … Last time …`, and the buttons read `15 seconds less rest`, `15 seconds more rest`, `Skip rest`.
- 14. **Long rest** (9:30, then +15 s a few times): `10:00` shows every digit on the banner and in the Dynamic Island.
- 15. **Always-On** (phone face-up, locked): dimmed but readable.

## Results (paste back)

| Step | Result | Note |
|---|---|---|
| L1 Ready shows Log with the in-app numbers | | |
| L2 Log from Lock Screen → Rest with buttons; notification at end | | |
| L3 Rest end shows Log for next set; tap starts next rest | | |
| L4 App: values/times right; toast once; Undo works | | |
| L5 Double tap logs once | | |
| L6 Force-closed: logged once (in background or at open) | | |
| L7 No Log for timed/cardio; last set says finish in app; height OK | | |
| 1 Ready with target and `Last` | | |
| 2 Rest: countdown, Until, target, `Last` matches History, 3 buttons | | |
| 3 +15 s / −15 s from the Lock Screen move it; app matches | | |
| 4 Skip → Ready, no later notification, no set logged | | |
| A Probe turns to Ready · Probe at 0:00 without the app | | |
| B Rest end: turned to Ready (how fast?) | | |
| C Dynamic Island shows `Set n` after the rest | | |
| D Cues: 15 s with next set, "Rest over" at end | | |
| 5 Ready at 0:00 + notification `… set n · target … · last …` | | |
| 6 Force-closed: tap moved it / did nothing (which?), no error | | |
| 7 Dynamic Island expanded with `Last` and buttons | | |
| 8 Readable, nothing important cut off, height OK | | |
| 9 Paused: no buttons; resume brings them back | | |
| 10 Finish ends it | | |
| 11 Live Activities off / on again | | |
| 12 Swiped away stays gone | | |
| 13 VoiceOver | | |
| 14 10:00+ rest shows every digit | | |
| 15 Always-On | | |

## Known limits (not faults)
- The activity is updated only while GymSmarter runs (no push on a free Apple ID). A button tap wakes it briefly to make the change. At a rest's end the switch to Ready is done by iOS from content written when the rest started (27 Oct); if iOS doesn't redraw then, it shows **0:00** with `Until` until you open the app, and the notification is the alert.
- A button tap more than a minute old, for a rest that has changed since, or while paused does nothing (by design: it's never applied to a newer rest).
- Two quick taps before the activity redraws count as one (the second is for the old picture of the rest).
- `Last …` can appear a moment after the rest starts (history is read once per exercise).
- In-app rest buttons stay ±30 s; the Lock Screen's are ±15 s.
- The notification's target is the planned one: if you edited the load in the app, the Live Activity shows `Your edit …` but the notification doesn't (known gap, unchanged).
- Tapping the activity outside the buttons opens GymSmarter where it was; there is no `fizz://workout` deep link yet.
- **Log** shows only in Ready (not while a rest counts), and only for rep sets whose values are known; anything else needs the app. A Log for a set you changed in the app since does nothing (by design). Undo is in the app (`… logged from Lock Screen · Undo`), not on the Lock Screen.
- If a Log tap launches GymSmarter from killed and it can't finish within a few seconds, the set is logged when you next open the app, at the time you tapped.

## What the 12 Oct version had
The 12 Oct list (L1–L17) is in git history. Its checks are folded in above: Ready/Rest/Paused (1, 2, 9), ±/Skip (3, 4), force-close (6), Dynamic Island (7, 14), legibility (8, 14), Always-On (15), swipe (12), Live Activities off and on (11), VoiceOver (13), Finish and Discard (10). Left out as covered by automated tests: the Capability probe running during a workout (old L16) and the launch/foreground read ordering (old L4, L8 detail).
