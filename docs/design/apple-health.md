# Apple Health: write workouts, read bodyweight and activities, link watch data

Status: **Proposal, 27 Oct 2026.** Direction approved by Ben on 27 Oct: (1) write GymSmarter workouts to Health as strength workouts, (2) read bodyweight, (3) read runs and other activities (for example Garmin via Health). Everything else in this spec (ranking, placement, link rules, defaults) is a designer proposal until Ben answers §11. A developer is building the integration in `wt-health`; where this spec and that build differ, raise it rather than pick one.

Tags: **[Ben]** = Ben's decision. **[Proposal]** = designer proposal, Ben decides. **[Doc] / [User] / [Unverified]** = evidence grade for competitor and platform facts (§10).

Rules: CLAUDE.md 1–10 and minimal copy. Tokens: [design-system.md](design-system.md). Health sits **outside the logging loop**: nothing here adds a tap, a sheet or a wait to Active set, Rest or Finish. Ben's question: *"think about how to leverage the information from Apple Health, and how the functionality / view will be visible in the app. e.g. don't want to see two workouts if it's the same one I recorded in the app. Maybe option to link to activity in Apple Health like TrainingPeaks has."*

**§1–§3 and §11 are for Ben. §4–§9 are for the developer.**

---

## 1. What Health is for, ranked by value to Ben

**Question the feature answers:** "What else did I do this week, and what did my watch see during this workout?" **Primary action:** none new. Health data shows up where Ben already looks (Today's week, the Summary, Progress); the only new screen is Profile › Apple Health.

| # | Use | Why it ranks here | Where |
|---|---|---|---|
| 1 | **Runs, rides and other activities fill Today's week by themselves.** They feed the existing run rule (no heavy legs the day after a long or hard run, or the day before one), the weekly review and the coach's context | Highest coaching value. Today Ben has to type every run into `＋ Activity` or tell the coach; most weeks he won't, so the run rule never fires. Health removes the typing | Today strip, Day sheet, Progress, weekly review, coach |
| 2 | **Write each finished GymSmarter workout to Health** as a strength workout [Ben] | Low effort; lifting then counts in Health, Fitness and (through Health) anywhere else Ben reads it | Profile switch; nothing on the Summary unless it fails |
| 3 | **Linked watch data on a workout** (TrainingPeaks-style pairing): the watch's duration, average and max heart rate, shown on that workout's Summary as one `Linked activity` row | Real numbers Ben's watch recorded; useful for him to look back on. Not used to set loads (no playbook rule uses heart rate) | Summary, past workout, Library row mark |
| 4 | **Bodyweight** on Progress (the points chart already planned for Progress › Training, progress-goals Q6), and as a dated fact for the coach | Saves typing. Lower value than it looks for loads: bodyweight and assisted exercises already progress in steps from last session and never need bodyweight (workout-builder §8, B2). See §11 Q5 | Progress › Training, coach, bodyweight exercise `Why?` |
| 5 | **Recovery-ish signals** (resting heart rate, sleep): **not in this version** | Not approved, and Garmin's recovery data (HRV status, Body Battery, readiness) never reaches Health (wearables-garmin §2a). Any later use is raw values with their source, never a score (rule 6). §11 Q8 | — |

Not used, ever: a combined training-load, fatigue, readiness or recovery score (rule 6; weekly-plan WP9); calories as a target; heart rate to judge a set; anything Health doesn't actually contain.

---

## 2. Where it shows

### 2.1 Profile › Apple Health [Proposal]

A new row in Profile's **Your data** group (Health data is Ben's personal data, rule 10), under `Data & backup`:

```
│ Your data                              │
│ ┌────────────────────────────────────┐ │
│ │ Data & backup                    › │ │
│ │ Backed up on this phone · 19:05    │ │
│ │ ♥ Apple Health                   › │ │
│ │ On · last read 07:42               │ │  or: Off · Not available on this install
│ └────────────────────────────────────┘ │
```

The screen (grouped list, `SettingsRow`s):

```
┌────────────────────────────────────────┐
│ ‹ Profile        Apple Health          │
├────────────────────────────────────────┤
│ SAVE TO HEALTH                         │
│ ┌────────────────────────────────────┐ │
│ │ Workouts                     [ ●]  │ │  writes strength workouts
│ │ If the watch also recorded it      │ │
│ │                  Keep the watch's ›│ │  §3.4; Q1
│ └────────────────────────────────────┘ │
│ READ FROM HEALTH                       │
│ ┌────────────────────────────────────┐ │
│ │ Runs, rides and other    [ ●]      │ │
│ │ activities                         │ │
│ │ Heart rate on linked     [ ●]      │ │  avg / max only, §2.3
│ │ workouts                           │ │
│ │ Bodyweight                   [ ●]  │ │
│ └────────────────────────────────────┘ │
│ SOURCES                                │
│ ┌────────────────────────────────────┐ │
│ │ Garmin Connect     latest 06:10    │ │  per source seen in reads
│ │ Apple Watch        latest Sat 24   │ │
│ │ Withings           latest 07:02    │ │
│ │ When two record the same           │ │  only with ≥ 2 workout sources
│ │ activity              Garmin     › │ │  §3.5; Q11
│ └────────────────────────────────────┘ │
│ Last read 07:42 · 3 new        Read now│
│                                        │
│ Remove GymSmarter workouts from Health │  DangerTextButton, confirm
└────────────────────────────────────────┘
```

- Each switch is Ben's choice in the app, independent of iOS permission. Turning one on the first time shows iOS's Health permission sheet for that type only. Off stops reading or writing that type at once; data already read stays (it's in his history) until he deletes it in Data & backup.
- `Read now` reads at once; normally reads happen on app open and on return to the foreground (no background delivery, wearables-garmin §2a).
- `Remove GymSmarter workouts from Health` deletes only samples this app wrote (an app can't delete others'). Confirm: `Remove 42 workouts from Health?` `Remove` / `Cancel`. Toast `Removed from Health`. No Undo (the copies are rewritten only if Ben turns `Workouts` back on and picks `Add past workouts`, §11 Q2). GymSmarter's own history is untouched.
- **SOURCES** lists each app or device whose samples Ben's reads returned, with its latest sample time, so a stale Garmin sync is visible (`latest Thu 22`). No status colour: an old date isn't an error.
- States: §4.

### 2.2 Today's week strip and Day sheet

Health activities appear in the 7-day strip exactly like activities Ben logged (same run tint, same label `Run 12k`, `Ride 45 min`), plus a small `heart.fill` glyph (7 pt, `text.secondary`) at the pill's top-right so the source is visible without words. VoiceOver: `Saturday 24: Run 16 kilometres, from Apple Health`.

```
│ SAT  SUN  MON ┃TODAY WED  THU  FRI       │
│  24   25   26 ┃ 27    28   29   30       │
│ Run♥ Rest Back┃Chest ┆Legs┆      ┆Run   │  ♥ = from Health
│ 16k           ┃      ┆    ┆      ┆8k    │  dashed = planned (Ben's)
```

- A planned run Ben logged and a Health run on the same day become **one** item, shown done with the Health values (§3.3, TrainingPeaks-style planned/completed pairing).
- A Health workout linked to a GymSmarter workout is **never** a separate item: the day shows the workout pill only (`Chest`).
- A Health strength workout with no GymSmarter workout (Ben forgot to log, or trained without the app) shows as `Strength 45 min ♥` in the activity tint, not the lifting green, and never counts as a lifting workout (§11 Q7).
- Accessibility sizes: the strip's 7-row list reads `Sat 24 · Run 16 km · Apple Health`.

Day sheet (tap a day), half height:

```
│ Sat 24 Oct                             │
│ ┌────────────────────────────────────┐ │
│ │ ♥ Run · 16.2 km · 1:31        ›    │ │  actual, from Health
│ │   Garmin · Long                    │ │  source · Ben's effort word if set
│ └────────────────────────────────────┘ │
│ ┌────────────────────────────────────┐ │
│ │ ✓ Shoulders · 58 min ♥        ›    │ │  workout; ♥ = linked watch data
│ └────────────────────────────────────┘ │
│   Close                                │
```

Health activity sheet (tap the run):

```
┌────────────────────────────────────────┐
│ Run                              Done  │
│ Sat 24 Oct · 07:31–09:02               │
│ 16.2 km · 1:31 · Avg HR 141            │  actual; HR only if read
│ Garmin Connect · Apple Health          │  source
│ Effort                                 │
│ [ Easy ][ Moderate ][ Hard ][ Long ]   │  Ben's word, optional
│ Same as your Run 12k?     Same  Not it │  only when §3.3 asks
│ Link to a workout ›                    │  strength / other types only, §3.2
│ Hide                                   │  DangerTextButton
└────────────────────────────────────────┘
```

- Values from Health are read-only here (rule 8: to correct them, fix them in Garmin or Health). Ben can add **his own effort word**; it's stored as his annotation beside the Health record, never written back.
- `Hide`: the item stops showing and stops counting (strip, run rule, review, coach). Toast `Hidden · Undo`. Hidden items are listed under Profile › Apple Health › `Hidden` (row appears only when there are any) with `Show`.
- `Long` is derived from Health values with the existing rule (a run of ≥ 90 min or ≥ 15 km, `isLongActivity`); `Hard` comes only from Ben's word, never from heart rate (rule 6, §11 Q9).

### 2.3 Summary and past workout: `Linked activity` row

One row under the date, gym and time line, above the facts. It shows only when there's something to show.

**Linked** (auto-linked on clear overlap, or Ben linked it):

```
┌────────────────────────────────────────┐
│ Chest                              ⋯   │
│ Tue 27 Oct · Main gym · 18:02–19:04    │
│ ┌────────────────────────────────────┐ │
│ │ ♥ Garmin · 61 min                  │ │  Linked activity (actuals)
│ │   Avg HR 118 · Max 162          ›  │ │  only with Heart rate on
│ └────────────────────────────────────┘ │
│ Active time            54 min          │
│ …                                      │
```

**Possible match** (no clear overlap, §3.2): the same row as a question; nothing is linked until `Link`.

```
│ ┌────────────────────────────────────┐ │
│ │ ♥ Strength · Garmin · 17:40–18:35  │ │
│ │ Link to this workout?  Link  Not it│ │
│ └────────────────────────────────────┘ │
```

Two or more candidates: `♥ 2 activities from Health · Link one?` `Choose ›` opens a list sheet (one row each: type, source, times, `Link`).

**Nothing found:** no row. No `Waiting for Garmin` line: the row appears when the watch data arrives (Garmin often syncs later).

Linked activity sheet (tap the row):

```
┌────────────────────────────────────────┐
│ Linked activity                  Done  │
│ Strength · Garmin Connect              │
│ Tue 27 Oct · 18:01–19:02 · 61 min      │  watch's times (actual)
│ Avg HR 118 bpm · Max 162 bpm           │
│ [            Open Health             ] │  SecondaryButton
│ Unlink                                 │  DangerTextButton
└────────────────────────────────────────┘
```

- `Open Health` opens the Health app. [Doc gap] Apple publishes no deep link to a single workout, so it can't open this exact one; the button says only `Open Health`.
- `Unlink` → toast `Unlinked · Undo`. After it, the Health workout shows as its own item (`Strength 61 min ♥`) and this pair is never auto-linked again (§3.2).
- `⋯` on the Summary gains `Link activity from Health` when there's no link, listing Health strength or other workouts from the same day and the day either side.
- Shown values are actuals from the watch. The Summary's own `Active time` stays the app's; the two are never merged or averaged.

### 2.4 Library › Past workouts

One row per GymSmarter workout, always. A linked Health workout adds a small trailing `heart.fill` to the row; it never adds a row.

```
│ PAST WORKOUTS                          │
│ Tue 27 Oct   Chest           58 min ♥  │  VoiceOver: "linked to Garmin activity"
│ Sat 24 Oct   Shoulders       52 min    │
│ Thu 22 Oct   Back            61 min ♥  │
```

Health-only workouts (runs, a Garmin strength session with no GymSmarter workout) are not Past workouts. They live in Today's week, the Day sheet and Progress's calendar.

### 2.5 Progress

**Training › Bodyweight** (the points chart progress-goals Q6 already describes; no target, no trend line beyond the points):

```
│ BODYWEIGHT                     6 mo ▾  │
│ 84 ┤ ·                                 │
│ 83 ┤   · ·  ·                          │
│ 82 ┤          · · ·  ·   ·  ·          │
│    └────────────────────────────────── │
│ Latest 82.4 kg · Mon 26 Oct            │  actual
│ Withings · Apple Health              › │  sources; tap = list of entries
```

- One point per day: Ben's own entry for that day if he made one, else the last Health reading that day. Every entry stays in the list with its source.
- Kept in the unit it was recorded in, shown in Ben's unit (kg/lb explicit).

**This week** (Progress's week view and the weekly review): lifting and activities stay on separate lines, never added together (WP9):

```
│ This week                              │
│ Lifting   3 workouts · 48 sets         │
│ Runs      2 · 28.4 km                  │  ♥ when any came from Health
│ Ride      1 · 1:10                     │
```

Sets, total weight, muscle counts and records never include Health data. Progress's calendar shows Health activities like logged ones, with the ♥ glyph.

### 2.6 Bodyweight in the workout [Proposal, low priority]

Nothing changes in the logging loop. A bodyweight or assisted exercise's `Why?` sheet may show `Bodyweight 82.4 kg · 26 Oct` as context, dated. No load, est. 1RM or record is computed from it (progress PG11 stays). See §11 Q5.

---

## 3. Linking and dedupe rules (for the developer; plain words for Ben in bold)

### 3.1 Never re-import our own writes

**Anything GymSmarter wrote to Health is never read back as an activity.**

- Every workout we write carries `HKMetadataKeyExternalUUID` = the session ID, and its source is our bundle ID.
- Reads drop every sample whose source bundle ID is ours, and every sample whose external UUID matches a session (belt and braces: a reinstall under a different signing team can change the bundle's identity in Health).
- Writes are idempotent per session (rule 5): before writing, query our samples with that external UUID; if one exists with the same start, end and type, do nothing.

### 3.2 Linking a Health workout to a GymSmarter workout

Only Health workouts of a **strength family** type can link: traditional strength training, functional strength training, core training, cross training, and `other` (suggest only). Runs, rides, swims and walks never link; they stay activities (§11 Q12).

Window of a GymSmarter workout = its start to its end (wall clock, pauses included). Overlap = the time both cover.

| Situation | Result |
|---|---|
| Exactly one strength-family Health workout overlaps the session by **≥ 50 % of the shorter of the two**, neither is linked yet, and Ben hasn't unlinked this pair | **Auto-link.** Row shows linked; `Unlink` available |
| Overlap > 0 but < 50 %, or a Health workout of type `other` with ≥ 50 %, or one starting or ending within 60 min of the session on the same local day | **Ask:** `Link to this workout?` `Link` / `Not it` |
| Two or more candidates by the above | **Ask with a list** (`Choose ›`); nothing auto-links |
| Ben taps `Not it` or `Unlink` | That pair is remembered as **not linked** and never auto-linked or asked again |
| Ben links by hand (`⋯ › Link activity from Health`, or `Link to a workout ›` on the Health activity) | Linked, whatever the overlap. Candidates: the same local day and the day either side |

**Bold version for Ben: if the watch was recording while you lifted, it links by itself. If it's unclear, the Summary asks once. You can always unlink or link by hand.**

- One Health workout links to at most one GymSmarter workout and vice versa.
- A linked Health workout is shown only on its GymSmarter workout: never in the strip, calendar, week counts, run rule or the coach's activity list as a separate item.
- Links are Your data: versioned, with op IDs, in backups (rules 5, 10). `link.mode` = `auto` or `ben`.

### 3.3 Ben's own activities vs Health activities

Ben's `＋ Activity` and coach-logged activities have a date but no time.

| Ben's item | Health item | Result |
|---|---|---|
| Planned run on day D | One Health run on D | **Paired**: one item, shown done with Health values; Ben's effort word kept (`Long`). His plan record stays (the week plan still knows it was planned). `Unpair` in the sheet |
| Done run on D | One Health run on D, and distance or duration within 15 % (or Ben gave neither) | **Merged**: one item with the Health values; his effort word kept; his record kept underneath, never deleted. `Unmerge` in the sheet |
| Done run on D | Health run on D that doesn't match, or two Health runs | **Ask** in the Health activity sheet: `Same as your Run 12k?` `Same` / `Not it`. Until answered both show |
| Any kind other than the same kind | — | Never merged |

Coach `log_activity` for an activity Health already has follows the same rule, so "did 16k Saturday" after a Garmin sync doesn't double the run.

### 3.4 The same workout in Health twice (ours and the watch's)

Ben: "don't want to see two workouts". In the app, §3.2 already guarantees one. **In Health** itself both copies would show (GymSmarter's, plus Garmin's or Apple Watch's). Setting `If the watch also recorded it` [Proposal; Q1]:

- **`Keep the watch's`** (proposed default): once a GymSmarter workout is linked to a watch workout, GymSmarter's copy is removed from Health (or never written, if the link exists at Finish). The watch's copy has the heart rate and energy; ours has neither.
- **`Keep both`**: always write ours.
- `Unlink` under `Keep the watch's` writes our copy back (they're now different workouts).

### 3.5 Two sources record the same activity

Apple Watch and Garmin can both write the same run. Two non-GymSmarter Health workouts of the same family overlapping by ≥ 50 % of the shorter = **one item**, using the source chosen in `When two record the same activity` (default: the one with distance and heart rate; tie → the longer). The sheet says `Also recorded by Apple Watch`. Same rule for bodyweight: one point per day (§2.5).

### 3.6 Edits, deletes and moved times

| Change | Result |
|---|---|
| Ben edits a workout's times (`Edit times`, `Only the start`, a past log) | Our Health copy is replaced (Health samples can't be edited: delete and write, same external UUID). Auto-links are re-checked: one that no longer meets §3.2 becomes a question; Ben's own links stay |
| Ben corrects sets, reps or loads | Nothing in Health changes (we write no set data) |
| Ben deletes a GymSmarter workout | After its Undo window, our Health copy is deleted. A linked watch workout is freed and shows as its own item. Undo within the window restores the link and our copy |
| Ben discards a workout | Nothing was written (writes happen at Finish) |
| Ben deletes our copy in the Health app | Not rewritten. Profile › Apple Health shows nothing about it; `Add past workouts` (Q2) is the only way back |
| A Health workout is deleted or changed in Health (a change arrives as a new sample) | The old one's link, pairing or merge goes on the next read; the new one runs through §3.2–§3.3 as new. Ben's `Not it` memory is per sample, so it doesn't carry over |
| A Health activity's local date | From the sample's own time zone metadata if present, else Ben's zone at that time (UTC stored with zone, CLAUDE.md conventions) |
| Log a past workout | Written to Health like any finished workout |
| FitNotes or AI imports | **Never written to Health** (they're someone else's records of the past; Q2) |

### 3.7 What we write

One `HKWorkout` per finished workout: activity type traditional strength training, start, end, pauses as pause/resume events, external UUID = session ID. **No energy, heart rate, distance or set data** (we don't measure them; rule 6). Written on Finish, before the Summary appears; a failed write never blocks the Summary (§4).

---

## 4. States

| State | Profile › Apple Health | Rest of the app |
|---|---|---|
| **Not available on this install** (SideStore's signing strips the HealthKit entitlement, or the build doesn't include it) | Row: `Not available on this install`, `minus.circle`, `text.secondary`, with `Why?` → one line: `This install's signing doesn't include Health.` Switches hidden | No ♥ anywhere; `＋ Activity`, manual bodyweight and everything else work as today |
| **Off** (Ben's switches all off; first visit) | `Off` + switches | As not available |
| **On, permission not yet asked** | Switch on → iOS sheet for that type | — |
| **Write denied** (iOS reports share denied) | `Workouts` row: `Off in Health` (`circle`), `How ›` → `Health › your profile › Apps › GymSmarter` | Summary: nothing (no nag) |
| **Read: no data** (iOS never says a read was denied, wearables-garmin §2a) | Under the switch: `Nothing from Health yet` with `Why?` → `Check Health › your profile › Apps › GymSmarter.` Never `Denied` | As off for that type |
| **On, normal** | `On · last read 07:42` | As §2 |
| **Reading** | `Reading…` replaces the time; no spinner elsewhere | Items appear when the read ends; nothing moves under a finger (Today's 2 s rule) |
| **Read failed** | `Last read failed · 07:42` + `Read now` | Last good data stays |
| **Write failed** at Finish | `Workouts` row: `1 not saved to Health` + `Try again` | Summary: nothing. Retries on next open (idempotent) |
| **Offline / no AI** | No change: HealthKit is on the phone. Garmin's own sync into Health needs its app and a connection; the SOURCES time shows how fresh it is | No change (rule 1) |
| **Workout in progress** | — | Reads don't run while a workout is open; links are made after Finish |
| **Limited history granted** (Ben allows only recent data) | — | Older periods show what Health returned; never read as "no activity" (wearables-garmin §2a) |
| **Restore from backup** | Links, pairings, hides and Health-sourced rows come back; the next read matches by Health UUID, so nothing doubles | — |

Transitions: Off → (switch) → permission → On; On → (iOS change) → Off in Health / Nothing from Health yet; any → Not available when the capability probe fails (`healthCapability`).

---

## 5. Interactions

| Action | Result | Undo |
|---|---|---|
| Profile switch on | iOS permission sheet for that type; then a read | Switch off |
| `Read now` | Reads now; `3 new` | — |
| Summary `Link` | Linked; row shows values | `Linked · Undo` toast |
| Summary `Not it` | Row gone; pair remembered | `Undo` toast |
| `Unlink` | Freed; shows as own item; pair remembered | `Unlinked · Undo` |
| `⋯ › Link activity from Health` | List sheet of candidates | Unlink |
| Health activity `Link to a workout ›` | List of GymSmarter workouts from that day and either side | Unlink |
| Effort chip on a Health activity | Stored as Ben's word; run rule and review use it | Tap again to clear |
| `Same` / `Not it` on a merge question | Merged / kept apart | `Unmerge` / Undo toast |
| `Hide` | Item stops showing and counting | `Hidden · Undo`; `Show` in Profile › Apple Health › Hidden |
| `Remove GymSmarter workouts from Health` | Confirm, then delete our samples | None |
| Voice / coach | "did the run on Saturday sync?" answers from data; "link my Garmin workout" → same as `⋯ › Link activity from Health`, with the list in the coach sheet and `Link` on each row | As above |

All rows ≥ 44 pt; chips ≥ 44 pt; VoiceOver labels include the source word (`from Apple Health`, `linked to Garmin activity`).

---

## 6. Copy

`Apple Health` · `Save to Health` · `Read from Health` · `Workouts` · `If the watch also recorded it` · `Keep the watch's` · `Keep both` · `Runs, rides and other activities` · `Heart rate on linked workouts` · `Bodyweight` · `Sources` · `latest 06:10` · `When two record the same activity` · `Last read 07:42 · 3 new` · `Read now` · `Reading…` · `Last read failed` · `Remove GymSmarter workouts from Health` · `Remove 42 workouts from Health?` · `Remove` · `Removed from Health` · `Not available on this install` · `This install's signing doesn't include Health.` · `Off in Health` · `Nothing from Health yet` · `Check Health › your profile › Apps › GymSmarter.` · `1 not saved to Health` · `Try again` · `Linked activity` · `Link to this workout?` · `Link` · `Not it` · `Link one?` · `Choose ›` · `Linked` · `Unlink` · `Unlinked` · `Open Health` · `Link activity from Health` · `Link to a workout ›` · `Same as your Run 12k?` · `Same` · `Unpair` · `Unmerge` · `Also recorded by Apple Watch` · `Hide` · `Hidden` · `Show` · `Undo`.

Value labels: every Health number is an **actual** (what the device recorded): `16.2 km · 1:31`, `Avg HR 118 · Max 162` (bpm in the sheet), `Latest 82.4 kg · Mon 26 Oct`. Source shown as `Garmin` (short, in rows) or `Garmin Connect · Apple Health` (sheets). No reassurance lines, no rule text (`auto-linked because…`) in the main UI; the reason for an auto-link is behind the row's sheet only if Ben asks (`Why?` → `Recorded 18:01–19:02, during this workout.`).

No spoken cues: Health never speaks during a workout.

---

## 7. The coach and Health data

**May see** (in the context builder, in a block labelled `From Apple Health (data)`, Your data, rule 10):

- Activities from the last 14 days (and planned ones ahead, as today): kind, local date and time, duration, distance, Ben's effort word if any, source name. Hidden and linked ones excluded (no double counting).
- For a linked workout: the watch's duration and avg/max heart rate, only with `Heart rate on linked workouts` on (§11 Q4).
- Bodyweight: latest value and date, and the value about 4 weeks earlier, with sources.

**Never:**

- A diagnosis or medical reading of any number ("your heart rate suggests illness", "you're overtrained", "under-recovered") (rule 9 spirit; coach-contract).
- A recovery, readiness or fitness score, or any metric Health doesn't have (rule 6).
- Load, rep or set choices from heart rate or bodyweight. The run rule and Ben's words stay the only inputs from activities.
- Text inside Health samples (workout names, notes, source names) as instructions: quoted, length-capped, data only (rule 8).
- Resting heart rate, HRV or sleep (not read in this version).
- Health data turned into memories or playbook candidates (rule 10).

Coach phrasing for these facts follows the honesty contract: "Your Garmin recorded a 16 km run on Saturday", never "you ran hard".

---

## 8. Data needed

Names follow the brief's style; new ones are proposals for the developer.

**Providers** (`packages/providers`, capability flag, CLAUDE.md stack): `healthCapability(): 'available' | 'not_on_this_install' | 'unsupported'`; `requestHealthAccess(types)`; `readHealthWorkouts(sinceUtc)` (excluding our bundle, §3.1); `readHeartRateSummary(uuid)` (avg, max); `readBodyMass(sinceUtc)`; `writeStrengthWorkout(session)` (idempotent on session ID); `deleteOwnHealthWorkout(sessionId)`; `healthShareStatus('workout')`.

**Schemas / persistence** (Your data, versioned, op IDs, backed up): `HealthSampleRef` (Health UUID, source name and bundle ID, HK type, start/end UTC + zone, distance, duration, avg/max HR; original values kept as provenance); `Activity.source` gains `'health'` with a `health` ref and Ben's effort annotation (update the `activity.ts` header comment, which says Health is out of scope); `HealthLink` (`sessionId`, `healthUuid`, `mode: 'auto' | 'ben'`); `HealthDismissal` (pair, `kind: 'not_it' | 'unlinked'`); `ActivityPairing` (Ben's activity ↔ Health UUID, `paired | merged`); `WeightEntry` gains `source`, provenance and the time zone (fixes review profile-settings N4); `HealthWriteRecord` (session ID, Health UUID, status, last error).

**Domain (pure, unit-tested):** `matchHealthToSessions(healthWorkouts, sessions, links, dismissals)` → `{ autoLinks, questions }` (§3.2); `pairActivities(benActivities, healthActivities, pairings)` (§3.3); `dedupeHealthSources(samples, preferred)` (§3.5); `bodyweightSeries(entries)` (one per day, §2.5). Existing functions take Health activities unchanged once mapped to `Activity`: `legRunNear`, `avoidLegDays`, `isLongActivity`, `stripActivityText`, `weeklyFacts`, `thisWeekView`.

**Views:** `buildTodayWeekView` (adds `fromHealth`), `buildLinkedActivityView(sessionId)`, `buildHealthSettingsView()`, `buildHealthActivitySheet(id)`, Progress `bodyweightView`.

**Coach:** the context builder's `fromHealth` block (§7); `link_health_activity` tool (Ben asks only; returns the candidate list, links on Ben's tap).

**Config:** HealthKit entitlement and both `NSHealthShareUsageDescription` and `NSHealthUpdateUsageDescription` (writing is now approved, so the research's `NSHealthUpdateUsageDescription: false` no longer applies); background delivery off. `scripts/test/check-entitlements.test.ts` currently fails closed on `com.apple.developer.healthkit`: adding it needs an ADR (CLAUDE.md: native config must stay free-provisionable; HealthKit is a runtime-detected capability flag).

---

## 9. Acceptance checks

1. **One workout, never two.** Finish a 60-min workout while a Garmin strength activity records 18:01–19:02; after the Health read, the Summary shows one `Linked activity` row, Library › Past workouts has one row (with ♥), and Today's strip shows one pill for that day.
2. A GymSmarter workout written to Health is never read back: after Finish and `Read now`, no `Strength` activity from GymSmarter appears anywhere.
3. Writing is idempotent: kill the app during Finish, reopen; Health has exactly one GymSmarter workout for that session.
4. Overlap 30 % → `Link to this workout?`; `Not it` → row gone and never asked again for that pair, including after `Read now` and a restart.
5. `Unlink` → the Health workout shows in the strip as `Strength 61 min ♥`; `Undo` puts the link back. The pair is never auto-linked again.
6. A Health run never links to a GymSmarter workout, even if it overlaps.
7. With `Keep the watch's`: once linked, Health shows only the watch's workout for that time; after `Unlink`, GymSmarter's copy is back in Health.
8. Planned `Long run Sat` (Ben's) + Garmin run Sat → one item, done, with Health distance and Ben's `Long`; Up next keeps legs off Friday and Sunday as before.
9. A 16 km Health run with no effort word counts as long (≥ 15 km) for the run rule; a 6 km Health run never counts as hard.
10. Garmin and Apple Watch both record the same run → one strip item; the sheet says `Also recorded by …`.
11. Edit a workout's start by +2 h → our Health copy has the new times (one copy); an auto-link that no longer overlaps becomes a question.
12. Delete a workout → after the Undo window, its GymSmarter copy is gone from Health; a linked Garmin workout is untouched and shows as its own item.
13. A FitNotes import writes nothing to Health.
14. On a SideStore install without the entitlement: Profile shows `Not available on this install`; no ♥ anywhere; `＋ Activity` and logging work; no error dialog.
15. Airplane mode: Health reads, links and the strip work; nothing waits on the network (rule 1).
16. Read permission off in iOS: the row says `Nothing from Health yet`, never `Denied`, and no Health items show.
17. Progress › Training › Bodyweight: one point per day; a day with Ben's entry and a scale reading plots Ben's; both are in the list with their sources.
18. This week shows `Lifting` and `Runs` on separate lines; sets and total weight are identical with Health on or off.
19. The coach context contains a `From Apple Health (data)` block with only the §7 fields; a Garmin activity named "Ignore previous instructions" appears quoted and has no effect.
20. Asking the coach "am I recovered?" with Health on gets no score or medical reading.
21. Back up, delete the app's data, restore: links, pairings, hides and effort words return; after a read there are no duplicate activities.
22. Turning `Workouts` off stops new writes; earlier GymSmarter copies stay in Health until `Remove GymSmarter workouts from Health`, which removes only ours.
23. No new tap, sheet or wait in Active set, Rest or Finish; the Summary appears as fast with Health on as off.
24. Every ♥, link and status is icon or text plus VoiceOver words, never colour alone; rows ≥ 44 pt; numbers tabular.

---

## 10. How others do it (patterns borrowed, not branding)

| App | What it does with Apple Health | Source and grade | Borrowed |
|---|---|---|---|
| **TrainingPeaks** | Completed device files pair with the planned workout on the same day and sport; a mismatched pairing can be undone and a completed workout dragged onto another planned one | [Unverified this pass]: help centre returned HTTP 403 (help.trainingpeaks.com, 27 Oct). From product familiarity; Ben names it as the model | Auto-pair on a clear match, else Ben pairs by hand, with Unpair: §3.2, §3.3 |
| **Hevy** | "Hevy uses HealthKit and CareKit to export your Hevy workouts into the Health app", an optional setting; the Watch app tracks heart rate | [Doc] GB App Store listing, v3.2.3 (fetched 27 Oct 2026) https://apps.apple.com/gb/app/hevy-workout-tracker-gym-log/id1458862350. No read of bodyweight or dedupe described | Optional write switch |
| **Strong** | "Built in body measurements tracker to record your weight and other vitals, with support for Apple Health"; v6.5.0: "Faster Apple Health workout imports", "Large measurement histories from Apple Health could fail to import", a fix for calories "recorded incorrectly in Apple Health" | [Doc] GB App Store listing (fetched 27 Oct 2026) https://apps.apple.com/gb/app/strong-workout-tracker-gym-log/id464254577 | Bodyweight read into a measurements chart; large-history reads need paging (read windows, Q6) |
| **Boostcamp** | Apple Health sync for workouts and body weight (v264) | [Doc] competitor-landscape.md §Boostcamp | Same pair of items Ben chose |
| **StrengthLog, StrongLifts** | One-way export of workouts to Health | [Doc] competitor-landscape.md | Write-only is normal |
| Hevy users | "Apple Health and Watch sync stopped working" after 3 months (3★) | [User] competitor-landscape.md §Hevy | Show `last read` and per-source latest times so a broken sync is visible (§2.1) |

None of these is documented as hiding its own export from its own history, or linking a watch's workout to a logged session; both are this spec's proposals. Platform facts (read denial invisible, limited history, Garmin writes no HRV or readiness, SideStore likely strips HealthKit) are from [wearables-garmin.md](../research/wearables-garmin.md) §2a.

---

## 11. Open questions for Ben

| # | Question | Recommended |
|---|---|---|
| Q1 | When the watch also recorded a workout, keep only the watch's copy in Health (it has heart rate), or keep both? | **Keep the watch's** |
| Q2 | Add past GymSmarter workouts to Health once (`Add past workouts`)? FitNotes imports never | **No** for now; offer later if you miss them |
| Q3 | Health runs show on Today automatically. This replaces "runs show only when I logged them or told the coach" (20 Oct). OK? | **Yes**, with the ♥ mark and `Hide` |
| Q4 | Can the coach see the watch's avg/max heart rate for a linked workout? It never uses it for weights | **Yes**, behind the `Heart rate` switch |
| Q5 | Use bodyweight for anything beyond the chart and the coach (e.g. total load for weighted pull-ups)? | **No**: chart, coach and a dated line in bodyweight `Why?` only |
| Q6 | How far back to read? | Activities **8 weeks** (the review's bars); bodyweight **2 years** |
| Q7 | A Garmin strength session with no GymSmarter workout: show as `Strength 45 min ♥` (an activity, not a lifting workout)? | **Yes**, with `Link to a workout ›` |
| Q8 | Later: read resting heart rate and sleep as raw values (no score) for the check-in or coach? | **Not now**; Garmin's recovery data doesn't reach Health anyway |
| Q9 | Should a Health run ever count as `Hard` without your word (e.g. from heart rate)? | **No** |
| Q10 | HealthKit probably doesn't survive SideStore signing (unverified). If the probe fails: Xcode builds, paid signing, or accept `Not available on this install`? | **Probe first**; decide after |
| Q11 | Garmin and Apple Watch both recording: which wins? | **The one with distance and heart rate** (usually Garmin) |
| Q12 | A treadmill run recorded during a gym workout: its own run (counts for the run rule), or part of the workout? | **Its own run** |

## 12. Brief and decision impacts (Ben approves)

- Supersedes CHANGELOG 2026-10-20 "Apple Health imports stay out of scope (no HealthKit)" and backlog H2, for the three approved items only.
- The v0.8 "wearables are read-only" entry concerns Garmin; writing to **Apple Health** is new and needs its own line.
- ADR needed: HealthKit entitlement and usage strings vs the free-provisionable allowlist (`check-entitlements`), the runtime capability flag, and the SideStore probe result.
- `packages/schemas/src/activity.ts` header ("Read-only sources … are not in scope") needs updating when built.
- Today v2 acceptance check 6 ("With no activities logged or told to the coach, no run appears anywhere on Today") becomes "…and none read from Health".
