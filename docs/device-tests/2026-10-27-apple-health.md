# Device test: Apple Health (27 Oct 2026)

Build: the first `.ipa` from `claude/health-27oct` (ADR 0035). About 15 minutes. Needs Ben's iPhone, the Health app,
and ideally the Garmin watch with Garmin Connect sharing to Health (Connect › Settings › Connected Apps › Apple
Health). Record each step as Pass / Fail / Not run with a note.

## 0. Is HealthKit on this install?

1. Profile › Apple Health.
   - **`Not available on this install`**: the signing dropped the HealthKit entitlement (expected under SideStore). Go
     to §6. Check logging still works (start a workout, log a set, finish) and nothing mentions Health anywhere else.
   - Switches showing: continue.

## 1. Permission prompt

1. Turn on **Workouts**. iOS shows the Health sheet with only *Workouts* under "Allow GymSmarter to write". Allow.
2. Turn on **Runs, rides and other activities**: the sheet lists Workouts, distances and Active Energy under read.
   Allow. Then **Bodyweight** (Body Mass), **Resting heart rate**, **Sleep**, **Heart rate on linked workouts**.
3. Turn one off and on again: no sheet the second time (iOS asks once).

## 2. Write a workout

1. Start a short workout without the watch recording, log 2 sets, Finish.
2. Health › Browse › Activity › Workouts (or Fitness): one **Traditional Strength Training** from GymSmarter with
   the Summary's start and end. No calories shown from GymSmarter.
3. Summary › Edit times: move the start 30 min earlier. Within a few seconds Health shows one workout at the new times.
4. Force-close GymSmarter right after Finish on another workout, reopen: still exactly one copy in Health.
5. Delete the workout (Past workouts): it disappears from Health. Recently deleted › Restore: it comes back once.
6. Log a past workout for yesterday: it appears in Health on yesterday's date.

## 3. A Garmin (watch) workout during a gym workout

1. Record a **Strength** activity on the watch while doing a GymSmarter workout; finish both; let Garmin sync.
2. Open GymSmarter (or Profile › Apple Health › Read now). The Summary of that workout shows `♥ Garmin · N min` and
   `Avg HR … · Max …` (and kcal if Garmin shared it). Today shows no separate Strength item.
3. Health now shows only Garmin's workout for that time (ours was removed, Q1).
4. Tap the row › Unlink › the Garmin Strength shows on Today as its own item, and GymSmarter's copy is back in Health.
   Undo relinks.

## 4. Read a Garmin run

1. After a run on the watch (synced): Today's Recent shows `Run · … km · … · Garmin`; tapping it opens a read-only
   sheet with the source. Days around a run of 90 min or 15 km keep legs off Up next.
2. If you had planned that run in GymSmarter, there's one item, done, with Garmin's distance.

## 5. Bodyweight, resting heart rate, sleep

1. Weigh in on a scale that writes to Health (or add a weight in Health). Profile › Training details lists it with
   `♥` and its source; your own entry for the same day wins.
2. Progress (Training): an `Apple Health` section with Resting heart rate and Sleep lines once 2 days exist, each with
   its source. Values match Health's.
3. Change `How far back` to 4 weeks: older Garmin activities disappear after the read.

## 6. If the permission or entitlement is missing (SideStore)

- `Not available on this install` means iOS rejected HealthKit for this signing. Nothing else is affected.
- Optional check: build with Xcode on a Mac under the same free Apple ID (LoopDocs keeps HealthKit); if that shows the
  switches, the cause is SideStore's signing.
- `Off in Health` under Workouts means you declined writing: Health › your profile › Apps › GymSmarter.
- `Nothing from Health yet` after a read: iOS never says a read was refused. Check the same Health › Apps screen.
- Fallbacks if Health stays unavailable: log runs with Today › ＋ Activity; type bodyweight in Training details.
  Ben's decision (Q10): Xcode builds, paid signing (ADR 0004), or no Health.

## Result (Ben, 26 Oct 2026, build 419 via SideStore)

- Profile › Apple Health shows **"Not available on this install"**. As predicted (ADR 0035, `free-ios-install.md` §1.2): SideStore's re-signing drops `com.apple.developer.healthkit`. The rest of the app is unaffected.
- Next: Ben chooses the route (apple-health.md Q10): Xcode build on a Mac with his free Apple ID (HealthKit is signable on a free team), the paid Apple Developer Program, or no Health for now.
