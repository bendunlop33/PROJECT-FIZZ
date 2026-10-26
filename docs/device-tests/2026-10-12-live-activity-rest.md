# Device test: the workout on the Lock Screen (Live Activity, rest buttons, rest-done alert)

**About 10 minutes on the iPhone, with one short real workout.** Updated 26 Oct 2026 for the build with Ben's lock-screen changes (last time on the Lock Screen, `−15 s` / `+15 s` / `Skip` buttons, the new rest-done text). Put **P**, **F** (with one line) or **–** in each row and paste the table back. A screenshot of anything odd helps.

**Status: open, not run.** Every Live Activity check so far ran against a fake ActivityKit. Only the Capability probe's countdown has passed on the phone. The buttons are new and are the main unknown: they need no entitlement, but whether iOS delivers the tap to GymSmarter when it's installed through SideStore is only known once this runs.

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
5. Log another set, lock, and **wait through the rest**: the countdown stops at 0:00, and the **Rest done** notification arrives at that moment reading `Bench press · set n · target … · last …`.
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
| 1 Ready with target and `Last` | | |
| 2 Rest: countdown, Until, target, `Last` matches History, 3 buttons | | |
| 3 +15 s / −15 s from the Lock Screen move it; app matches | | |
| 4 Skip → Ready, no later notification, no set logged | | |
| 5 0:00 + notification `… set n · target … · last …` | | |
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
- The activity is updated only while GymSmarter runs (no push on a free Apple ID). A button tap wakes it briefly to make the change. If the app is suspended when a rest ends, the activity shows **0:00** with `Until` until you open the app; the notification is the alert.
- A button tap more than a minute old, for a rest that has changed since, or while paused does nothing (by design: it's never applied to a newer rest).
- Two quick taps before the activity redraws count as one (the second is for the old picture of the rest).
- `Last …` can appear a moment after the rest starts (history is read once per exercise).
- In-app rest buttons stay ±30 s; the Lock Screen's are ±15 s.
- The notification's target is the planned one: if you edited the load in the app, the Live Activity shows `Your edit …` but the notification doesn't (known gap, unchanged).
- Tapping the activity outside the buttons opens GymSmarter where it was; there is no `fizz://workout` deep link yet.
- There is no **Log** button on the Lock Screen (not built; it waits on this test).

## What the 12 Oct version had
The 12 Oct list (L1–L17) is in git history. Its checks are folded in above: Ready/Rest/Paused (1, 2, 9), ±/Skip (3, 4), force-close (6), Dynamic Island (7, 14), legibility (8, 14), Always-On (15), swipe (12), Live Activities off and on (11), VoiceOver (13), Finish and Discard (10). Left out as covered by automated tests: the Capability probe running during a workout (old L16) and the launch/foreground read ordering (old L4, L8 detail).
