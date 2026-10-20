# Supersets and the workout screen: how GymSmarter compares

For Ben. Written by the `competitor-researcher`, 20 Oct 2026. It condenses passes 3 and 3b of [`competitor-landscape.md`](competitor-landscape.md), after a fact-check pass on 20 Oct. Seven claims were wrong and six were too broad, and all of them are corrected here. The full evidence stays in the landscape file.

**Labels.**
- **[Doc]** means the app's own site, listing, help page or changelog says it.
- **[User]** means one person's review or forum post.
- **[Inference]** means my reading of the evidence.
- "Not documented" means I didn't find it, not that it doesn't exist. Researchers can't install or try the apps, so nothing here is hands-on.

**What GymSmarter has.**
- **Built (19 Oct):** `Superset with…` in the middle of a workout, sets alternating A1, B1, A2, B2, rest after each pair, and `Remove superset`. The coach can do the same when asked ([CHANGELOG, 19 Oct](../brief/CHANGELOG.md)).
- **Approved 20 Oct, not built yet:**
  - builder v3: a `Supersets` on/off switch where code pairs accessories by rules and never pairs the main lift; it is also used to fit the time; numbered `3a`/`3b` ([workout-builder-v3.md](../design/workout-builder-v3.md) §2.2–2.4, §3.2, §3.5–3.6).
  - in-workout v3: one round per page with both exercises on screen, each exercise's sets in their own scroll box, swipe between rounds ([workout-table-v3.md](../design/workout-table-v3.md)).

---

## 1. Short answer: do other apps set up supersets like we do?

**Partly.** Every app I checked lets you link exercises by hand. Most also jump a→b→a as you log. Nobody I found combines the rest of what we designed. That puts us ahead on paper, but the parts that are new are also the parts that aren't built or tested yet.

**Standard (we match it, nothing new):**
- Linking by hand, in a template and/or mid-workout. All 9 plain loggers do this: Hevy, Strong, FitNotes, FitNotes 2, JEFIT, Boostcamp, Liftosaur, StrengthLog and Lyfta. So do MacroFactor, Gravl and Fitbod [Doc].
- Jumping a→b after each set: Hevy (a settings toggle, default not stated), Strong (via `Next`), FitNotes, FitNotes 2 and Liftosaur [Doc].
- Set types (warm-up, drop, failure) are common [Doc]. A target effort on each set exists in Liftosaur (`@8`) and in Boostcamp's builder [Doc].

**Closest to us:**
- **MacroFactor:** rest starts "after completing both sets", the pair is "grouped together, with the rounds shown beneath them", and pairs must be next to each other [Doc].
- **Liftosaur:** one card per exercise with a thumbnail strip (`2/5`, ✓), "Warmup sets do not move you", and a target RPE per set [Doc]. Its superset timer, though, runs after *every* set, not after the round.
- **Gravl:** a setting that builds supersets into generated workouts, and a session length you can change (30–90 min) [Doc]. It doesn't say whether supersets are used to hit that length.

**What nobody documents (absence of evidence, not proof) [Inference]:**
1. **Using supersets to fit your time.** Gravl and SensAI ("make it shorter") change session length, but neither says supersets are how. Fitbod's own data shows its users use supersets *less* in short workouts [Doc].
2. **A rule that keeps the main lift out of supersets.**
3. **Both exercises on one screen, one round per page.** Others use either one long scrolling list (Hevy) or one exercise per page with swipes (Liftosaur, FitNotes 2, JEFIT).
4. **A coach that suggests a pair with a reason, Apply and Undo.**

**Not unique to us any more:**
- **Automatic pairing.** None of the 9 loggers auto-pairs. Fitbod and Gravl do, behind a setting, and Arvo says its AI does [Doc, vendor]. One JuggernautAI user says it adds supersets "with random muscle groups" [User].
- **Rest after the round.** Among the loggers it's missing: Hevy needs a workaround and Boostcamp counts rest "between sets of the same exercise only". MacroFactor and Arvo do describe it [Doc]. Ours is already built.

**What others do better, or have and we lack:**
- **Supersets saved in templates before you start.** Hevy, FitNotes 2, Liftosaur and MacroFactor have this [Doc]. Ours is mid-workout only until builder v3 is built (pre-Start pairing was deferred on 19 Oct).
- **Clear edge-case rules.** Liftosaur skips warm-ups and finished exercises. FitNotes 2 can skip the rest timer after the final set [Doc]. Our v3 spec doesn't define these yet.
- **A proven screen.** Liftosaur's card-and-strip layout is shipped and documented. Ours is a design.

---

## 2. Matrix

Key:
- ✓ = documented
- ✗ = documented absent
- ? = not documented
- "vendor" = the app's own claim, unverified

Create = template / mid-workout / auto.

| App | Create | Time-driven | Label | a→b auto-advance | Rest placement | Both visible | Set types | Per-set target effort |
|---|---|---|---|---|---|---|---|---|
| **GymSmarter, built 19 Oct** | ✗ (deferred) / ✓ / ✗ | ✗ | A1, B1… | ✓ | After each pair | ? (v3 adds it) | see v3 | ✓ target RPE (built 11 Oct) |
| **GymSmarter v3, designed** | ✓ / ✓ / ✓ (rules, Supersets on) | ✓ | `3a`/`3b`, numbered rounds | ✓ | One `After each round` value | ✓ round page | warm-up, working, top, back-off, drop | ✓ RPE |
| Hevy [S1–S5] | ✓ / ✓ / ✗ | ✗ | Colour | ✓ (toggle, default not stated) | Per exercise; round rest only by workaround (unverified excerpt) | ✗ (one list) [Inference] | warm-up, failure, drop | ? (RPE logged) |
| Strong [S8, S9] | ? / ✓ / ✗ | ✗ | Vertical line | ✓ via `Next` | ? | ? | warm-up | ✗ (RPE logged only) |
| FitNotes Android [S10] | ? / ✓ / ✗ | ✗ | Coloured bar | ✓ (wraps to first) | Per exercise | ✗ [Inference] | none documented | ✗ |
| FitNotes 2 [S11–S13] | ✓ / ✓ / ✗ | ✗ | Link icon | ✓ | Per set / exercise / global; skip after final set | ✗ [Inference] | warm-up flag | ✗ (RPE/RIR logged) |
| JEFIT [S14, S16] | ✓ / ✓ / ? | ✗ | Chain icon [User] | ? | Per exercise | ✗ [Inference] | warm-up, working, drop, failure | ✗ (RPE per session) |
| Boostcamp [S17, S18] | ✓ / ? / ? | ✗ | ? | ? | Same exercise only | ? | warm-up, drop | ✓ RPE / %1RM in builder |
| Liftosaur [S19–S21] | ✓ / ✓ (today only) / ✗ | ✗ | Group name + coloured line | ✓ (warm-ups don't move you) | After every set in the group | ✗ (one card each) | free labels (`(Main)`) | ✓ `@8` |
| StrengthLog [S22–S24] | ? / ✓ / ✗ | ✗ | Superset / Circuit blocks | ? | ? | ? | warm-up, drop | ? (RPE/RIR Premium) |
| Lyfta [S25, S26] | ? / ? / ✗ | ✗ | ? | ? | ? | ? | warm-up, failure, drop, negative, L/R | ? |
| Fitbod [T1–T3] | ✓ / ✓ / ✓ (setting) | ? | Group heading | ? | ? | ? | ? | ✗ (RIR asked after the whole group) |
| Gravl [T5–T8] | ✓ / ? / ✓ (setting) | ? (length rebuild; supersets not mentioned) | ? | ? | ? | ? | warm-up, drop | ✗ (Easy/Hard rating) |
| Arvo [T4] (vendor) | ? / ? / ✓ (AI) | ? | ? | ? | After both | ? | 8 techniques incl. top set + back-off | partial (example sets at RIR 1–2) |
| MacroFactor [T10, T11] | ✓ / ✓ / ✗ | ✗ | Grouped, rounds beneath | ? (auto-advance is per exercise, not documented for supersets) | After both | ? | W, D, M, F | ? (separate article not opened) |
| Alpha Progression [T9] | ✓ (feature listed) / ? / ? | ? | ? | ? | ? | ? | drop; auto warm-ups (Pro) | ? (Pro ramps RIR week to week) |
| JuggernautAI [T13] | ? / ? / partial [User] | ? | ? | ? | Main vs accessory rest | ? | guided warm-ups | ✓ (RPE/RIR app) |
| Dr. Muscle [T14] | partial (alternate by hand) / ? / partial (list pre-pairs antagonists) | ? | ? | ✗ (by hand) | ? | ? | rest-pause default | ✓ RIR |
| GymStreak [T15] | ? (built in) | ? | ? | ? | Superset rest exists (bug fixed v6.2.4) | ? | warm-up, drop | ? |
| SensAI [T16] | ✗ / ✗ / ✗ | n/a | n/a | n/a | n/a | n/a | warm-up, drop, failure | ? |

Footnotes [S…] and [T…] are the landscape file's (pass 3 and pass 3b).

---

## 3. How GymSmarter compares more generally (refresh, 20 Oct)

**Where things stand.** Much more is built than on 9 Oct, when the landscape matrix's GymSmarter row was written. Most of it is tested with real SQLite and a scripted model, but **not yet run on the iPhone** ([CHANGELOG](../brief/CHANGELOG.md) entries 12–20 Oct). Built:
- the coach (builds, plans, today's edits with Undo);
- spoken cues;
- FitNotes import and AI import;
- Progress;
- adaptive plans, Pause and week-flex around runs;
- quick gym setup;
- lift targets;
- mid-workout supersets.

Today v2, builder v3 and in-workout v3 are approved designs.

**Strengths** (compared with the landscape's evidence):

| Area | GymSmarter now | Others |
|---|---|---|
| Coach that edits today with Undo and is checked by code | Built: `edit_today`, plans, `propose_week`, `update_gym`, `set_lift_target`; asked → applied with Undo, not asked → offer; stale writes refused | Arvo is close (in-session AI edits, Undo only on plan activation, vendor) [Doc]. Hevy's free ChatGPT app writes plans, not live sets [Doc] |
| Loads on real kit | Built: plates, racks, stacks, min/max, snap down; a gym is now assumed full and learns while you train | At parity with MacroFactor, Gravl, Alpha and Liftosaur; stricter on machine max [Inference] |
| Plan that follows what you do | Built: adaptive Up next, Make next, Pause, runs move leg days | Gravl and SensAI regenerate; none documents a run rule [Inference] |
| Offline and honest | Built: logs with no network, `Not reviewed · Offline`, a labelled `Rule` fallback | FitNotes 2, Liftosaur and Alpha are offline too; not unique |
| Import | Built: FitNotes Android and FitNotes 2, plus AI import from any app, with preview and Undo | FitNotes 2 imports FitNotes; Liftosaur has the best import UX; MacroFactor has none [Doc] |
| Voice | Built: spoken rest and set cues with the silent switch on, coach replies read aloud (Apple voices) | Few loggers speak; tap-to-talk on-device is still to come |
| Supersets | Built mid-workout with rest after the pair; v3 adds time-fit and the round page | See §1 |

**Gaps** (where others are ahead today):
1. **Lock screen.** A rest Live Activity is standard (Hevy free; Strong, Alpha, MacroFactor and FitNotes 2) [Doc]. Ours failed its probe and is waiting for a retest. A count-up activity for cardio isn't built.
2. **Not yet proven on the phone.** Most of what's above has only run in tests. Competitors' versions are shipped.
3. **Exercise guides:** 10 draft animations against hundreds of videos (Hevy 400+, MacroFactor 600+, JEFIT 1,400+) [Doc].
4. **Supersets in templates before Start:** standard elsewhere; ours waits on builder v3.
5. **Watch and Health:** parked by choice (v0.9), while most peers have them.

**Ideas worth taking** (proposals, ranked; Ben decides):

1. **Get the rest Live Activity working, or ship the actionable-notification fallback.**
   - Effort: M. When: first milestone.
   - Why: it's the one feature every serious competitor has. Landscape #1 and #14.
2. **Superset edge rules in the v3 build:**
   - warm-ups run before the alternation and don't move you a→b;
   - extra sets on one side run alone;
   - the last round's rest can be skipped.
   - Effort: S. When: now (step 2).
   - Evidence: Liftosaur ("Warmup sets do not move you"; finished exercises skipped) and FitNotes 2 v8 ("skip the rest timer for the final set") [Doc]. The 19 Oct build already runs extra sets as straight sets. Gravl does the opposite: it trims to the smaller set count and drops warm-ups, but only when linking two unlinked exercises. Landscape #20.
3. **Test the round page on Ben's iPhone early, with Liftosaur's one-card-per-exercise layout as the named fallback.**
   - Effort: S. When: first gym session on v3.
   - Why: our layout has no precedent. Landscape #21.
4. **Pairing round-trip and rest tests:**
   - a mid-workout pair survives `Save as variation`, the Start prompt and backup/restore;
   - editing or unlinking never changes the round's rest.
   - Effort: S. When: step 2–3.
   - Evidence: FitNotes 2 needed "Fix supersets missing in templates created from a workout" (3.1.0) and a fix for a wrong "next set" message with supersets (v5). GymStreak had to fix "superset rest time changing during workout session" (6.2.4) [Doc]. Landscape #22.
5. **Coach-suggested pairs carry a one-line reason and pass the same pairing checks as the builder.**
   - Effort: S. When: coach step, reusing the step 2 pairing code.
   - Evidence: JuggernautAI "random muscle groups" [User]. Arvo, Fitbod and Gravl document no reason or Undo. Landscape #25.

**Keep:** logging one set at a time, and no "log the whole round" button. The one complaint I found about logging a whole superset at once is about Fitbod's **Apple Watch** app, not the phone [User]. It matters only if a Watch app is ever built.

No brief changes are proposed.

---

## 4. Sources

All checked 20 Oct 2026 unless marked. Pages that couldn't be opened:
- help.fitbod.me (403) and help.hevyapp.com (403): their wording comes from search excerpts.
- rpstrength.com (429).
- Reddit: not tried.

**Loggers**
- Hevy:
  - [supersets](https://www.hevyapp.com/features/what-are-supersets/)
  - [workout settings](https://www.hevyapp.com/features/workout-settings/)
  - [set types](https://www.hevyapp.com/features/workout-set-types/)
  - [rest timer](https://www.hevyapp.com/features/workout-rest-timer/)
  - [circuits help](https://help.hevyapp.com/hc/en-us/articles/36954623739415) (403, excerpt, unverified)
  - [forum review, 5 Mar 2026](https://iphonecleaner.net/t/can-anyone-share-an-honest-hevy-app-review-and-experience/2191)
- Strong: [supersets](https://help.strongapp.io/article/98-supersets-and-circuits), [RPE](https://help.strongapp.io/article/230-about-rpe)
- FitNotes: [workout tracking](http://www.fitnotesapp.com/workout_tracking/)
- FitNotes 2: [workout docs](https://getfitnotes.com/docs/workout.html), [changelog](https://getfitnotes.com/changelog/)
- JEFIT: [workout tab](https://www.jefit.com/blog/upcoming-enhancements-revamped-workout-tab-and-improved-exercise-screens), [set types](https://www.jefit.com/blog/set-types-new-in-jefit-customize-your-workouts-with-set-types)
- Boostcamp: [features](https://www.boostcamp.app/features), [rest timer](https://www.boostcamp.app/features/rest-timer)
- Liftosaur: [supersets](https://www.liftosaur.com/features/supersets), [workout screen](https://www.liftosaur.com/features/workout-screen), [set types](https://www.liftosaur.com/features/set-types)
- StrengthLog: [supersets and circuits](https://www.strengthlog.com/track-supersets-and-circuits-in-the-strengthlog-workout-app/)
- Lyfta: [gym log](https://lyfta.app/usage/gym-log-app)

**Adaptive and AI coaches**
- Fitbod:
  - [superset help](https://help.fitbod.me/hc/en-us/articles/360006427813) (403, excerpt)
  - [short-workout blog](https://fitbod.me/blog/what-gets-cut-when-lifters-are-short-on-time/)
  - [reviews (Watch quote)](https://justuseapp.com/en/app/1041517543/fitbod-gym-fitness-planner/reviews)
- Gravl:
  - [create a superset (27 Sep 2026)](https://gravl.ai/help/create-a-superset)
  - [duration (7 Aug 2026)](https://gravl.ai/help/quick-filter-duration)
  - [drop sets](https://gravl.ai/help/create-a-dropset)
  - [US listing (v1.53.4, 5 Oct)](https://apps.apple.com/us/app/personal-trainer-gravl/id6450921637)
- Arvo: [features](https://arvo.guru/features)
- MacroFactor: [supersetting (321)](https://help.macrofactorapp.com/en/articles/321-supersetting-exercises), [logging a workout (310)](https://help.macrofactorapp.com/en/articles/310-how-to-log-a-workout), [set types (317)](https://help.macrofactorapp.com/en/articles/317-logging-different-types-of-sets)
- Alpha Progression: [US listing](https://apps.apple.com/us/app/gym-workout-alpha-progression/id1462277793), [site](https://alphaprogression.com/en)
- RP Hypertrophy: [US listing](https://apps.apple.com/us/app/rp-hypertrophy/id1555614554)
- JuggernautAI: [US listing](https://apps.apple.com/us/app/juggernautai/id1515756471), [reviews](https://justuseapp.com/en/app/1515756471/juggernautai/reviews)
- Dr. Muscle: [superset guide (26 Apr 2025)](https://dr-muscle.com/superset/), [2017 release](https://dr-muscle.com/deload-3/)
- GymStreak: [site](https://gymstreak.com/), [GB listing](https://apps.apple.com/gb/app/gymstreak-ai-personal-trainer/id1371187280)
- SensAI: [US listing](https://apps.apple.com/us/app/id6738963099)

**GymSmarter (internal)**
- [`docs/brief/CHANGELOG.md`](../brief/CHANGELOG.md) (11, 12, 18, 19 and 20 Oct entries)
- [`workout-builder-v3.md`](../design/workout-builder-v3.md)
- [`workout-table-v3.md`](../design/workout-table-v3.md)
- [`competitor-landscape.md`](competitor-landscape.md) (general comparison, checked 9 Oct)
