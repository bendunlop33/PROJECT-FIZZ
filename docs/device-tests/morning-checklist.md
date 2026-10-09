# Morning checklist: first real-app build (slice 3)

**About 10 minutes on the iPhone.** Written for the build made from `claude/gracious-knuth-joxqpw` after slice 3 (workout loop + review fixes, restore, gym editor, repeat last workout, Rest after, plate breakdown, warm-up suggestion, Summary highlight). Nothing here has run on a phone yet; every row is "not yet tested" until you mark it.

How to report: copy the results table at the bottom, put **P** (pass), **F** (fail, with one line on what you saw) or **–** (skipped) in each row, and paste it back. A screenshot of anything odd helps.

Before you start:
- Install **over the top** with SideStore. Never delete the app (that starts an empty one).
- Have some music playing for the cue steps if you like; it isn't required.
- Test workouts are real records (sessions are never deleted). That's fine: step 11 shows how to go back with a restore.

---

## 1. Open and first run (1 min)

1.1 Open Fizz. It should open in under a couple of seconds with no "Opening your training data" screen, or with it only briefly.
1.2 If this is a fresh install: choose **kg**, pick **Commercial gym**, name it, **Save gym**, read the data explainer, **Go to Today**.
1.3 Profile › **App status**: note the build number and the SQLite version (must be 3.37 or newer).

## 2. Check the gym (1 min) — new

2.1 Today › tap the **gym chip** (top right). It opens the gym's equipment. Items from the preset say *Typical values, not checked*.
2.2 Tap **Dumbbells**. Set **To** to your real heaviest pair, tap any weight your gym doesn't have (it shows *missing*), check the line *Makes n loads…* and any *Gap* line. **Save** → toast *Saved. Future workouts use the new setup.* with **Undo**.
2.3 Tap **Barbell and plates**. Count the plates on the tree with − / +, check *n a side*, type 102.5 in **Check a load** → *Each side: …*. Save.
2.4 Back on the gym: those two items no longer say *not checked*.

## 3. Start and check-in (1 min)

3.1 Today › **Start empty workout**. The check-in sheet appears (it's a check-in day by default).
3.2 At the **smaller sheet height**, can you see and reach **Skip**? (Scroll if needed; the buttons now sit under the content.) Tap a score, then **Done** / start.
3.3 The workout opens with a toast *Check-in saved · …*. There is **no Talk button** in the bottom bar any more.

## 4. Log sets (2 min)

4.1 **Add exercise** › **Bench press** with the barbell. Enter 60 kg × 8.
4.2 Under the load you should see the plates, e.g. **20 bar + 20 / side**. Change the load with + and check the line follows.
4.3 Type 100 in the load field, then tap **+** while the field is still focused: the field must show 102.5 (not stay at 100) and the button says *Log 102.5 kg × 8*. Set it back to 60.
4.4 If this is the first barbell exercise with nothing logged, a **Warm-up suggestion (built-in, not logged)** card shows a ramp. Tap **Hide**: it goes.
4.5 Tap **Rest after: 3:00 ›**. Pick 1:30, tap **This set only**. The line reads *Rest after: 1:30*.
4.6 ⋯ › **Add set**. **Log**. A toast *✓ Set 1 saved* with **Undo**; the rest card counts down.

## 5. Rest alert while locked (1.5 min)

5.1 During the rest, tap **−30 s** until it reaches zero once: you should feel **one** rest-end haptic. (Then log another set to start a fresh rest.)
5.2 Lock the phone. At the end of the rest a notification arrives on the lock screen (*Rest done*, next set). Exactly one.
5.3 Start another rest, tap **⌄** to minimise to **Today**, and wait: the **banner and sound** appear while Fizz is open on Today (new), and the Today card says *Rest over · ready for next set*.

## 6. Force-close mid-rest (1 min)

6.1 Start a rest (Log a set). Swipe Fizz away from the app switcher.
6.2 Reopen after ~10 s: Fizz opens straight into the workout with *Workout restored. Nothing was lost.* and the countdown about 10 s lower. Only one notification is pending (lock the phone to the end of rest if you want to confirm).

## 7. Finish and Summary (1 min)

7.1 ⋯ › **Finish workout** › **Finish**. The sheet closes first, then the Summary appears (no flicker or blank screen).
7.2 Summary: *Workout saved on this phone*, the backup line, the facts, and **Next time** tagged *Built-in rule (coach not connected)* with a rule name that says *provisional* (bench is a main barbell lift: 3–6 reps).
7.3 If you've done this exercise before on the same bar, a **Today** highlight line may show (e.g. heaviest set). One success haptic when it opens. No highlight is also correct when nothing improved.
7.4 Tap **Done**. You land on Today; an edge swipe must **not** go back to the Summary.

## 8. Repeat last workout (30 s) — new

8.1 Today › **Repeat last workout**. The screen says *Targets are what you did on …* and lists the sets.
8.2 **Start workout**, answer or skip the check-in. Sets show **Target (as last time) …**, nothing is ticked as done. ⋯ › **Discard workout** (it asks first when something is logged).
8.3 Optional: **Start from a past workout** lists older workouts.

## 9. Backup (1 min)

9.1 Profile › **Data & backup**: *Backed up on this phone · <time>* (an automatic backup runs after Finish).
9.2 **Save a copy to Files** › pick a folder in **iCloud Drive** (e.g. make *Fizz backups*) › **Open**. You see *Copy saved to Files · iCloud Drive › …*. Check the file exists in the Files app.

## 10. Check a backup (30 s) — new

10.1 Data & backup › **Check a backup** › pick the newest backup on this phone. Result: *This backup restores* with its counts and *Nothing on this phone was changed.*
10.2 Again with **Choose another file…** › the copy you saved to Files.

## 11. Restore trial run (1.5 min) — new

11.1 Log one more quick workout (one set) and finish it, so the phone has something the Files copy doesn't.
11.2 Data & backup › **Restore from a backup** › **Choose another file…** › the Files copy from 9.2.
11.3 The preview says *Checked: complete, no damaged records*, shows **Backup / This phone** counts and *1 workout on this phone isn't in this backup … It'll be replaced.* Tap **Restore** → confirm.
11.4 A full-screen *Restoring your data* cover shows briefly, then *Restored*. **Done** reopens Fizz on Today; the extra workout is gone.
11.5 Data & backup › **Undo last restore** › confirm. Fizz reopens with the extra workout back. The row now reads *Switch back to the restored backup*.
11.6 With a workout in progress, **Restore from a backup** is greyed out with *Finish or discard your workout first*.
11.7 The full SideStore trial run (install the next build over the top, let one weekly refresh lapse, refresh, restore) is in `docs/guides/sidestore-windows.md` §8; tick **Mark as done** in Data & backup when you've done it.

## 12. Pain flags (30 s) — new

12.1 Profile › **Pain flags** says *No pain flags* (or lists any from check-ins with **Clear**).

## 13. App status (30 s)

13.1 Profile › **App status**: build, signing expiry, SQLite version, and the capability lines. Nothing claims to work that hasn't been tested.

---

## Probe retests (Developer › Capability probe)

Run these after the checklist. They are the open rows from build 7.

| # | Probe | What to do | Expected |
|---|---|---|---|
| R1 | Live Activity | Run it first, then lock the phone | A countdown on the lock screen. If it fails again, note whether App Group (R2) passed |
| R2 | App Group | Run it | Pass with the SideStore-renamed group (`group.com.projectfizz.fizz.<TEAMID>`) |
| R3 | AlarmKit | **Request permission**, then run | A permission prompt; result recorded (it's a runtime capability flag, never required) |
| R4 | Spoken cue while locked | Run it, lock the phone | Only if this build was made with the background-audio experiment (`FIZZ_BACKGROUND_AUDIO=1`); otherwise it reports UNAVAILABLE, which is correct |
| R5 | On-device speech (en-GB) | Run it and say "Bench one hundred kilos for eight" | The probe reports the locale it used (should be en-GB from the device) and the transcript |

---

## Results (paste back)

| # | Step | Result | Notes |
|---|---|---|---|
| 1 | Open / first run / App status | | |
| 2 | Gym check: dumbbells missing + plates + Check a load | | |
| 3 | Start + check-in buttons reachable at small sheet; no Talk button | | |
| 4.2 | Plate line under the load | | |
| 4.3 | Typed 100 then + shows 102.5 | | |
| 4.4 | Warm-up suggestion + Hide | | |
| 4.5 | Rest after editor | | |
| 4.6 | Log + Undo toast + rest | | |
| 5.1 | −30 s to zero: one haptic | | |
| 5.2 | Rest notification while locked | | |
| 5.3 | Minimised to Today: banner + sound, "Rest over" | | |
| 6 | Force-close mid-rest: restored, right time, one alert | | |
| 7.1 | Finish sheet closes, then Summary | | |
| 7.2 | Next time with provisional rule name | | |
| 7.3 | Highlight / haptic (or none, honestly) | | |
| 7.4 | Done → Today, no swipe back to Summary | | |
| 8 | Repeat last workout | | |
| 9 | Backed up on this phone + Save a copy to Files (iCloud) | | |
| 10 | Check a backup (phone + Files) | | |
| 11.3–11.4 | Restore from Files copy, cover, Restored | | |
| 11.5 | Undo last restore | | |
| 11.6 | Restore greyed out during a workout | | |
| 12 | Pain flags screen | | |
| 13 | App status | | |
| R1 | Live Activity | | |
| R2 | App Group | | |
| R3 | AlarmKit permission | | |
| R4 | Spoken cue while locked | | |
| R5 | Speech en-GB | | |
