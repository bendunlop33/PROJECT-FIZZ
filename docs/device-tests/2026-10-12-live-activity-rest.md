# Device test: rest countdown on the Lock Screen during a real workout

**About 10 minutes on the iPhone, with a real (short) workout.** Needs the SideStore build with the App Group fix and the Live Activity extension (`FIZZ_LIVE_ACTIVITY` not `0`). Nothing in this list has run on a phone yet: the Capability probe's countdown passed, but the real rest flow is new in this build, and so is the bigger layout. Put **P**, **F** (with one line) or **–** in each row and paste the table back.

Before you start: Settings › GymSmarter › Live Activities **on**; notifications allowed. Close the Capability probe's test countdown if it's still showing.

## What should happen
- One Lock Screen activity per workout. It appears when you start, shows **Ready**, switches to **Rest** with a large countdown when you log a set, and goes away when you finish or discard.
- The countdown is drawn by iOS, so it keeps going with the app closed. **Until 18:42** under it is the end time; the next set and its target are shown too.
- The rest-done notification still arrives at the end of each rest (the countdown doesn't replace it).

## Steps
L1. Start a workout (any routine). Lock the phone: a **Ready · <workout>** activity with the first exercise, `Set 1 of n` and its target.
L2. Unlock, log a set, lock straight away: **Rest** with a large countdown on the right, `Until hh:mm · <exercise> · Set 2 of n next` and `Target …`. The `Until` time matches the Lock Screen clock plus the rest.
L3. Wait on the Lock Screen through the end of the rest: the countdown stops at **0:00**, `Until` stays, and the **Rest done** notification arrives at the same moment.
L4. Unlock and open GymSmarter: within a second the activity shows **Ready** again for the next set (no 0:00 left behind).
L5. Log the next set, then tap **+30 s** (or −30 s) on the rest screen and lock: the countdown and `Until` moved by 30 s. Only one activity is on the Lock Screen (not one per rest).
L6. **Skip rest**, lock: **Ready** for the next set, no countdown.
L7. Log a set, then **Pause** the workout, lock: **Paused · <workout>**, `Rest m:ss left when you resume`, not counting. Resume, lock: the countdown is back with the right time left.
L8. **Force-close mid-rest.** Log a set, swipe GymSmarter away in the app switcher, lock: the countdown keeps going and the notification arrives at the end. Open GymSmarter again: still one activity, now showing the true state.
L9. **Dynamic Island** (iPhone 14 Pro or later): during a rest, in another app, the pill shows the timer icon and the countdown; long-press shows the large countdown, the next set and the target.
L10. **Legibility.** At arm's length in gym light, the countdown numerals are easy to read; nothing is cut off; long exercise names end in `…` without hiding the target numbers.
L11. **Always-On** (iPhone 14 Pro or later): with the phone face-up and locked, the activity dims but stays readable.
L12. **Swipe the activity away** during a rest: it stays gone for this workout (the notification still arrives). The next workout gets one again.
L13. **Finish** the workout: the activity disappears at once. **Discard** another test workout: same.
L14. **Live Activities off** (Settings › GymSmarter › Live Activities off), start a workout and log a set: no activity, no error in the app, and the **Rest done** notification still arrives.
L15. **VoiceOver** on the Lock Screen activity reads `Rest, until hh:mm. Next: <exercise>, set n of m, target … kilograms, … reps.` and the countdown.

## Results (paste back)

| Step | Result | Note |
|---|---|---|
| L1 Ready after Start | | |
| L2 Rest countdown, Until, next set, target | | |
| L3 0:00 + notification at the end | | |
| L4 Ready again on opening the app | | |
| L5 ±30 s moves it; only one activity | | |
| L6 Skip → Ready | | |
| L7 Pause / resume | | |
| L8 force-close mid-rest | | |
| L9 Dynamic Island compact / expanded | | |
| L10 big numerals readable, nothing cut off | | |
| L11 Always-On | | |
| L12 swiped away stays gone this workout | | |
| L13 Finish / Discard end it | | |
| L14 Live Activities off: notification only | | |
| L15 VoiceOver | | |

## Known limits (not faults)
- Updates happen only while GymSmarter runs (no push on a free Apple ID). If the app is suspended when a rest ends, the activity shows **0:00** with the `Until` time until you open the app; the notification is the alert.
- Tapping the activity opens GymSmarter where it was; there is no `fizz://workout` deep link yet (the app has no URL scheme).
- Widget layout features used for the first time here: `Spacer`, `frame`, `lineLimit`, `monospacedDigit`, `activityBackgroundTint`. If the activity shows blank or falls back to a plain layout, note which state (L1, L2, L7) and screenshot it.
