# Open decisions

Status: consolidated 8 Oct 2026 from every design spec's decision tables (OB, PS, GE, CS, CM, AC, VO, PB, RT, EL, WP, CR, CA, WB, PG, DX, P-B, P-I, P-L, P-S, X) and the open items in ADRs 0003–0007. Each question appears once. Part 1 is for Ben; Part 2 is technical detail. **Updated 9 Oct 2026** with the pre-workout check-in's decisions (CI1–CI14, [check-in.md](check-in.md) §0): B15–B18 below, the rest in section B under "Check-in". **Updated again 9 Oct 2026** for the approved coaching playbook v1 ([playbook-v1.md](../training-guides/playbook-v1.md)): the decisions resolved below, B8 extended, and new defaults in section B under "Goals, week and playbook v1". **Updated again 9 Oct 2026** for the playbook review fixes: B19 and B20 added for Ben, the "Already decided" lines corrected, section B's playbook defaults extended, and the follow-ups and developer notes updated.

**Already decided, not repeated below:**
- Data is split into **Your data** and **Coaching knowledge**; backups are kept **in the app by default** and a copy off the phone is optional. Both were approved by Ben and relayed by the product manager. They are applied in every spec (README.md explains them). The brief/CHANGELOG entries and an ADR 0004 wording update for these belong to the product manager (see Part 2, "For the product manager").
- **Coaching playbook v1, approved by Ben 9 Oct 2026** (CHANGELOG 9 Oct). Rules 2–6 and 8–13 approved. Rule 1 is revised: weekly sets start from his stated days a week and session length. Rule 7 is revised: the coach picks progression from his goal, history and the gym's real equipment. The built-in rule 7-F is equipment-aware and labelled. It sets next-session targets when the coach is offline, **and today also when the coach is connected but Ben doesn't apply its suggestion** (corrected in the review fixes: the earlier "kept only for when the coach is offline" wasn't what the app does; B19 asks Ben whether to change that). Rule 14 is removed. Rules G and T are added. Applied in onboarding, profile-and-settings §2.2, coaching-playbook, weekly-plan, workout-builder, workout-summary and coach-adjustments §4.6.
- **HYROX vs strength focus: resolved, goal-adaptive** (Ben, 9 Oct: "stop with hyrox, it should be more adaptable depending on what the goal is / how training is being run"). There's no HYROX special case and no "HYROX or strength?" question. The app collects Ben's goal and how he trains (days a week, session length, other training, equipment), and the playbook adapts to them (rule G). Rules 11 and 12 apply only while the endurance switch is on: a **hard, long or key** endurance-type session in the plan (planned or usual) or logged (imported or reported). Rule 13 also needs endurance to be one of his goals. Any event, HYROX included, is an ordinary `Working towards` entry with no built-in defaults. No design spec now names HYROX.
- **Rule T** (offers compare logged with planned effort; skip warm-ups and planned all-out sets; no "too easy" above 12 reps) is recorded as approved in the CHANGELOG and the ADR 0006 amendment. The specs treat it as approved, and they show an honest `This app version` note until it's built (coaching-playbook PB15). *For the product manager:* `docs/decisions/provisional-2026-10-09.md` item 4 still lists it as Ben's to decide, so please reconcile. Ben's reply was "Ok.", so it's worth confirming with him.

---

## Part 1: For Ben

### A. Needs Ben's call

These are genuinely your preference. Each has a recommendation, but there's no single right answer.

| # | Question | Recommended | Affects |
|---|---|---|---|
| B1 | **App ID.** Fizz's permanent ID is `com.projectfizz.fizz`. It can never change after the first real install, or the app starts empty. OK? | Yes, confirm it before the first real install | ADR 0007; profile-and-settings (About) |
| B2 | **Backup files are plain, readable files** (not encrypted). They contain training data only, never your passwords, sign-in or API keys. OK to keep them in iCloud Drive or Files? | Yes | ADR 0005 #2; data-import-export DX8, P-B2 |
| B3 | **Swapping an exercise yourself mid-workout:** should your choice apply straight away (with Undo), or show an `Apply` card first? Coach-suggested swaps always show the card. | Apply straight away, with Undo (one tap fewer between sets) | exercise-library EL4; active-workout §4.4; coach-adjustments CA2; change-review |
| B4 | **Tapping `Adjust` on a coach offer** ("That looked hard. Adjust remaining sets?"): does that tap count as yes, so the change applies with Undo? Or should a second `Apply` card follow? | Counts as yes | coach-adjustments CA1 |
| B5 | **Pain on one exercise, swapped to a similar one:** should the similar exercise also be blocked from going up for the rest of that workout? | Yes, for today only | exercise-library EL6; coach-memory CM5 |
| B6 | **Coach-built workouts with no history on that equipment:** leave the load empty with "start light, enter your load", rather than inventing a starting number? (The brief currently says "bounded defaults".) (Review fixes) Playbook rule 7 step 7 now follows this too: an estimated starting load is given only if you ask the coach directly, and it's labelled as an estimate | Leave it empty | workout-builder WB2; brief §7; playbook rule 7 |
| B7 | **Old FitNotes history as "Last time":** when the exercise, unit and load type match but FitNotes didn't record the machine, may it show as `Last (FitNotes, 1 Oct)`? | Yes, always labelled as FitNotes | data-import-export P-I3; active-workout §4.2; progress |
| B8 | **Approving playbook rules in the app:** the app keeps the record of what you approved and when (and it's in your backups). OK for the app to be the record? (9 Oct) The playbook v1 you approved in the review would arrive already approved, showing `Approved by you 9 Oct · playbook review`, so you aren't asked again. Rules that come later are approved in the app | Yes, both | coaching-playbook PB2, PB11 |
| B9 | **Guide PDFs aren't copied into backups** (only their index); after a restore you re-add the file. OK? | Yes (keeps backups small) | coaching-playbook PB9; data-import-export |
| B10 | **OpenAI key and spending:** enter one key once and use it for both text and voice by default (separate keys optional), and set in-app monthly caps that stop spending before OpenAI's own limit? Caps are estimates. | One key by default; caps $5 text, $2 voice (editable) | ai-connection AC2, AC3, AC7; profile-and-settings PS3, PS4 |
| B11 | **Build the simple weekly plan earlier** (repeating week, move/skip/missed) together with routines, instead of waiting for build step 6? Endurance and programmes stay in step 6. | Yes | weekly-plan WP1; today; brief §10 |
| B12 | **Custom exercises you create:** treat them as Coaching knowledge (like the exercise list), never removed by `Reset coaching knowledge` while your workouts or routines use them? | Yes | exercise-library; data-import-export §2.7 |
| B13 | **"Speak while locked"** (Fizz keeps a silent audio session so it can say "Ready" with the phone locked; uses more battery): offer it as an opt-in setting if the device test works? | Decide after the test; if it works, opt-in and off by default | lock-screen-and-alerts §2.4, P-L8; ADR 0007 |
| B14 | **Rest between left and right sides** of a one-sided exercise: full set rest, a short transition, or none? | Decide after trying it; until then full set rest | ADR 0003 follow-up 3; routines RT8 |
| B15 | **Check-in as a sheet on Start, or inline on the first set?** The sheet costs one tap every workout (a score or Skip). The inline version costs nothing (logging the first set just skips it) but crowds the set card and can't hold the pain and illness steps | The sheet, as you approved; revisit after two weeks of real use. Turning check-ins off or choosing days removes the tap | check-in CI2; today; flow-first-milestone check 1 |
| B16 | **Where the "lighter session?" offer appears after a low check-in:** on the first set card before you log anything (never spoken, ignorable), or as a last question in the check-in sheet (one more tap each time)? | On the first set card | check-in CI5; coach-adjustments §2.3 (the one exception to "offers only during rest") |
| B17 | **You pick Pain in the check-in but don't say which movement:** no flag is set, the coach can't raise anything in that workout, and the summary asks you to choose movements. OK, or should it insist on a movement before you start? | As described: don't insist | check-in CI8; coach-memory CM4; rule 9 |
| B18 | **What the coach sees of your check-ins:** only today's, during today's workout and its summary. Should it also see the last 4 weeks (as raw entries, never a score) so it can notice patterns, e.g. "third rough session in a row"? | Today's only for now (your brief said "never combined with other metrics") | check-in CI10; coach-sheet context view; progress week review |
| B19 | **Next time's weights when the coach is connected** (playbook D21). After a workout, the coach suggests next time's targets beside the built-in rule's. If you don't tap Apply, which one is used? **(A)** The coach's, shown on the summary with one-tap Undo. This is closest to "a default rule won't always work best", but CLAUDE.md rule 3 and ADR 0006 say future-session changes are always suggestions, so both would need changing. **(B)** The built-in rule's, as now. It's equipment-aware and labelled, the coach's alternative sits beside it, and `Apply all coach targets` is one tap | Your call. B is what the current rules allow, and the screens show it honestly meanwhile. If you'd rather the coach's numbers win, choose A and the product manager will draft the rule changes | playbook D21; workout-summary; coach-adjustments §4.6; coaching-playbook §2.1 |
| B20 | **"Too hard" load drop** (playbook rule 5, D22). The rule says "5–10% less" and "about 2–4% per effort point over plan". These disagree when a set is one point harder than planned. Should the drop be at least 5%? | At least 5%, at most 10%, rounded down to a weight you can load | playbook rule 5 |
| B21 | **Sets logged before you noticed the gym was wrong** (added 9 Oct with the gym switch). Switching gym never changes sets you've already logged, so those sets stay recorded at the wrong gym's equipment. That skews `Last` and comparisons there. Should a later version offer `Move 2 logged sets to Home` as an explicit correction, with Undo? | Later, as an explicit correction with Undo (not in this slice). Meanwhile, the switch and Repeat's gym chip make it easy to pick the right gym before logging | gym-switch GS13; rule 2 |

### B. Recommended defaults: approve in bulk

Each line is a sensible default the specs already use. Approving this section in one go is fine; tell us any line you want changed.

**Setup and settings**
- Onboarding is three short steps (units and rests, gym, a "how your data is kept" explainer); goals, week and limitations are optional and can come later (OB1). `Restore from a backup` is on the Welcome screen (OB3). No permission is asked until a feature needs it, and location is never asked (OB4).
- Profile shows what works on this phone honestly, with dated evidence (App status), and warns about signing expiry 3 days and 1 day ahead (PS1, PS2).
- Loud alarm-style rest alerts are optional, with `Long rests only (2:00 or more)` or `Every rest` (PS5). Recognition language suggests English (UK) (PS6). "Ask for effort after the set" (default) or before is saved in your profile (PS7).
- Gyms: preset values are marked `not checked` until you check them (GE1); benches, racks and cable attachments can be listed (GE2); one plate set per gym shared by bars and machines (GE3); `Out of order` for long-term broken kit (GE4); travel gyms archive themselves after their end date (GE5); a piece of equipment's unit is locked once it has sets (GE6); a mid-workout gym switch only happens when you tap `Switch` (GE7). Shared history across gyms comes later (GE9).

**Logging, alerts and voice**
- Tap to talk (stops when you stop speaking); hold-to-talk is a setting (VO1). Sets are understood on the phone without AI (VO2); a clear spoken set saves at once with Undo, an unclear one asks one question (VO3); its Undo sits in the voice strip (VO4). On-device speech only, unless you allow Apple's servers (VO6). Stop speech by tapping, not by talking over it (VO7). Spoken replies are at most two sentences (VO8). Voice can't spend money, change keys, start a coach-built workout, approve a rule or clear a pain flag (VO9).
- Lock screen: no Time Sensitive option (needs the paid programme) (P-L1); one Live Activity per workout showing the end time and next target (P-L2, P-L3); rest buttons `−15 s` / `+15 s` / `Skip` on the Live Activity, no `Log` (P-L4 superseded and P-L4b, Ben 26 Oct); the loud alarm only when Fizz is in the background (P-L5); optional quiet "Resting until 18:42" notification when the Live Activity doesn't work (P-L6); optional "workout still running" reminder, off (P-L7).

**Coach**
- Coach offers never fire on warm-up or drop sets, and "reps short" counts from the bottom of the range (CA5); at most one offer per exercise unless the reason changes (CA4); adjustments don't change rest times (CA3); with no coach, nothing is adjusted mid-workout (CA6); if you log while the coach is thinking, it retries once on the new state or drops it (CA7). Swaps and gym changes still need `Apply` (CA2, unless B3 changes it for your own swaps).
- Coach conversations: one thread per workout, plus general threads (CS1); only recent messages are sent (CS2); a workout bar in the sheet, with no Log button (CS3); nothing is sent later on its own when offline (CS4); things you explicitly ask for apply at once, things the coach infers are suggestions (CS5); starter chips are fixed text (CS6). Conversations are kept forever unless you choose 1 year or 90 days.
- Memory: only confirmed memories reach the coach (CM1); "remember …" saves at once with Undo (CM2); unanswered suggestions drop after 14 days (CM3); pain flags are set eagerly and only you clear them (CM4); "sore/tight" asks "soreness or pain?" (CM6); memories over 6 months old show under `Worth checking` (CM7); goals stay in Profile (CM8); general training rules go to the playbook, not memory (CM9).
- Playbook: guardrails always win (PB1); editing a rule marks it `Edited by you` (PB3); guides are searched on the phone and only short excerpts are sent (PB4); guide text is reference, never instructions (PB5); unresolved conflicts default to the higher source (PB6) and are labelled by where they came from (PB7); the coach may suggest rules from your guides as ungraded candidates (PB8); approving a rule never changes app settings by itself (PB10).
- AI connection: the coach route is a setting you pick, never an automatic fallback (AC1); the "you're using your ChatGPT plan" notice appears once at sign-in, never mid-workout (AC5); the model is chosen explicitly and never swapped silently (AC6); if ChatGPT sign-in can't work on iPhone, the API key is offered and the laptop workaround isn't built (AC4).
- Coach-built workouts: drafts are separate from routines (WB1); loads are rounded down and capped (WB3); missing or pain-flagged exercises are swapped or removed and flagged, never auto-substituted for pain (WB4); duration is always the app's estimate (WB5); 60 s build timeout (WB6); voice can ask but not start (WB7); editing a coach routine makes it yours (WB8); unused drafts kept 14 days (WB9); during a workout a new build can only be saved (WB10).
- Change review: four scopes shown in words (today / one date / from now on / programme) (CR1); narrowest scope by default (CR2); all-or-nothing apply (CR3); any change elsewhere makes a suggestion out of date (CR4); overlapping suggestions are marked (CR5); a spoken "yes" only applies narrow changes (CR6); `Not now` keeps it for 30 days (CR7); suggestions expire on clear rules (CR8).

**Check-in** (added 9 Oct 2026; [check-in.md](check-in.md))
- The check-in comes before the workout is created, so skipping or rescheduling leaves nothing to discard (CI1). Swiping the sheet away means "not now": back to Today, nothing started; only `Skip` carries on without a check-in (CI3). Your score is saved at the first tap, and a check-in that didn't lead to a workout is reused if you start within 2 hours (CI4).
- `Adjust` on the lighter-session offer counts as yes, changes only today's remaining sets, and can never raise anything (CI6). With the coach offline you get one honest line and no change; with no coach set up, nothing (CI7).
- Voice takes numbers only ("feeling great" asks for a number), and a bare "sore" asks "soreness or pain?" (CI9). Progress shows check-ins as you gave them, with counts but no average or line (CI11). The feeling-ill step is fixed app text with three equal buttons, shown once (CI12). You can change or delete a check-in later; that never changes sets, adjustments or targets (CI13).
- Check-ins replace the Today readiness chips; the brief's `ReadinessEntry` becomes a self-reported `CheckIn` with no wearable data in it (CI14).

**Goals, week and playbook v1** (added 9 Oct 2026; follows your direction on rules 1 and 7 and "stop with hyrox". These are the screen details, and they answer playbook decision D13)
- **Setup (OB5).** `About your training` becomes 4 short optional steps:
  1. Goal: Strength, Muscle, General fitness, Maintain or Support other training, plus also-matters chips and an optional dated `Working towards`.
  2. How you train: **days a week you lift** (1–7; the main input for weekly sets), session length, usual days and experience.
  3. Other training: running, cycling, swimming, rowing, classes or HIIT, team or court sport or other, each with usual days and an optional `Hard or long` / `Easy` (classes and sport start on `Hard or long`).
  4. Limitations.

  Event details (what it involves, priority) and priority muscles are set in Profile only.
- **Missing values (review fixes).** Nothing you skip is filled in silently. With no days a week (and under 4 weeks of logs), no weekly-set number is worked out, and the coach asks for days and length when you ask it to plan. With no session length, plans assume 60 min and say `(assumed)`. With no experience (and no logs), weekly sets start at the lowest cap, 8 per muscle, labelled. With no goal, the app uses only your days and session length and says so.
- **Rule 1 details (review fixes; all marked default in the playbook):** more days a week never start with fewer sets per muscle than fewer days; 5 days = upper/lower ×2 plus a 3-slot day for priority muscles (or the muscles furthest below their range; never extra main-lift sets for Strength); 7 days = the 6-day split plus one short accessory day; heavy main-lift sets count about 4 minutes each in the set budget (Strength at 60 min ≈ 14 sets, 6 of them heavy); starting from your logs scales with your stated days, with at most +2 sets for a Muscle goal; the "2–3+ sets" in rule 2 is per lift per session.
- **Endurance rules (review fixes).** Only hard, long or key sessions turn the endurance rules on; easy ones never do. The weekly "two heavy sessions" line (rule 13) appears only when endurance is one of your goals and you lift 2+ days a week. "Lift first" appears only when lifting is your priority.
- **Built-in rule (review fixes).** It never adds sets until you decide playbook D2: at the rep limit it holds and says why. Its targets show their % change.
- **Profile (PS8, PS9).** Your own edits to goal and week save at once with Undo. The plan only changes through a suggestion you apply, and older suggestions go out of date. A quiet `Your logs: about 2 a week lately` line appears when 4+ weeks of logs differ from your stated days. It has no button and isn't a prompt. Priority muscles show only when Muscle is a goal. Matches start as `Key` in the endurance form, and you can switch that off.
- **Playbook screens (PB11–PB16).** These rely on B8 for the approval record.
  - `Applied to you` shows what the coach works from.
  - Rules are grouped `Always` / `Only with endurance, classes or sport` / `Built-in rule` (was `Only when the coach is offline`), each with an on/off-now reason. The built-in rule reads `In use: when no coach target is applied` while the coach is connected (B19).
  - Each rule shows `With your setup` (e.g. next weight steps at your gym, with %) separately from the rule.
  - Numbers marked default are editable.
  - Open playbook decisions D1–D22 show as `Not decided yet` on the rules they affect.
  - If this app version doesn't yet do what a rule says, a `This app version` card says so.
- **Weekly plan (WP10–WP13).** Usual other training shows as `Usual` items. A rule 13 line appears when fewer than 2 heavy strength sessions are planned, only while endurance is one of your goals and you lift 2+ days a week. Endurance entries get an optional `Easy` / `Hard or long`. Same-day order follows rule 11 as a hint, with "lift first" only when lifting is your priority, and nothing is moved. The "day after a long run" note is dropped because it isn't in v1. After-match notes only appear for confirmed matches.
- **Workout builder (WB11–WB13).** The context line names your goal, days and length, and says which are missing or assumed. With no goal, a single workout still builds from your session length only, but a programme asks for a goal. Targets show their % change from last time. A heavy-legs draft before a key session gets a rule 12 note, only while endurance rules are on.
- **Out-of-date suggestions (review fixes).** Plan suggestions remember the goal, days, session length, usual days, experience and other training they were built on. Changing any of them makes the suggestion out of date, and it can't be applied.
- **Still open in the playbook (not repeated here).** D1–D22 in [playbook-v1.md](../training-guides/playbook-v1.md) stay with you and the product manager (D21 and D22 are B19 and B20 above). The ones that change screens:
  - D1: whether the coach may offer extra sets or ask about changed days.
  - D2: the built-in rule's step size, and whether it may ever add a set.
  - D4: a "Big jump" note.
  - D5: a bodyweight entry.
  - D11: the coach asking about goal changes.
  - D15: no-goal defaults.
  - D19: running the plan as a rotation.

  Until each is decided, the screens use the playbook's "until decided" behaviour.

**Plan and library**
- Routines and the week live in one `Plan` screen with `Week` and `Routines` (RT1); each routine row has a `Start` button (RT2); loads default to `Auto` (coach or built-in rule), with Fixed and "% of top set" available (RT3); "Repeat last workout" copies what you did as targets, with nothing marked done (RT4); routines show who made them (RT5); an optional `AMRAP` flag that never triggers effort offers (RT6); "counts as heavy legs" is automatic with an override (RT7).
- Exercise search works offline and shows why something matched (EL1); "at this gym" filter on when picking, and hidden results are counted (EL2); a custom exercise's load type is locked once used (EL3); swap reasons are plain text, never scores (EL5); sled-type exercises are logged as plates added (EL7). Exercise guides: some exercises have an original, code-drawn animated guide plus cues on a `How to` screen, with no filmed or third-party videos (EL8, changed and approved 9 Oct 2026; exercise-library.md §8).
- Weekly plan: your own one-off moves apply at once with Undo; repeating changes and coach suggestions go through review (WP2); endurance sessions are things you enter, shown `Not confirmed` until marked or imported (WP3); "heavy legs" uses a clear rule (WP4); trade-off warnings only from rules you approved (WP5); missed sessions are never moved for you (WP6); `Fixed` sessions are never moved by the coach (WP7); a day list, not a grid (WP8); strength and endurance counted separately, no combined score (WP9).

**Progress**
- Calendar is the second half of the Progress tab (PG1); fixed card order (PG2); home always shows this week (PG3); sets-per-muscle shows after a week of data (PG4); a Resume bar on Progress and Profile during a workout (PG5); the 10–20 sets guide appears only after you approve that rule (PG6); unrated sets count and are shown as unrated (PG7); helper muscles count once the data exists (PG8); drop sets count as hard sets (PG9); records need 3 earlier sessions (PG10); estimated 1RM only from 1–10 rep load-based sets, always labelled an estimate (PG11); a 21-day gap breaks a trend line (PG12); deloads are never guessed (PG14); different machines are never merged (PG15); weeks run Monday–Sunday (PG16); a weekly (not daily) streak, hideable (PG17); one weekly review per week when you open Progress (PG18), with every number checked (PG19).

**Data and system**
- JSON-only backup snapshot, no second raw database file (P-B1); restore and import wait until the workout is finished (DX4, P-B4); unknown FitNotes columns stop the import instead of guessing (DX5, P-I1); load-type questions in imports have no pre-picked answer (DX6, P-I2); `Undo this import` hides rather than deletes (DX7); automatic backups keep the last 14 (DX9); the coach and voice can't run backups, restores, imports, exports or deletes (DX10); cardio rows are skipped and listed until endurance import exists (P-I4); a one-tap "save a copy to Files" before risky moments, and a quiet reminder after 30 days without one, which you can switch off (DX12).
- Brief wording changes from these specs: "saved on your phone; sync pending" becomes `Saved on this phone` (there is no sync) (P-S1); one function decides which status banners show (P-S2); the signing tool (SideStore or Sideloadly) is a setting that changes the refresh instructions (P-S4).
- Brief wording changes from the domain review (ADR 0003): Undo checks the set's own version (S1); progress only when every prescribed working set is done (S3); a left + right pair counts as one set and the load goes up only when both sides qualify (R4).
- The audio rule in ADR 0007: one custom module owns the phone's audio session; other libraries only run inside its listening window.

### C. Needs a device test

These can't be decided on paper. Each has a fallback that already works.

| Test | What it decides | If it fails | Affects |
|---|---|---|---|
| **SideStore trial run** (ADR 0004): save a copy to Files, install an update over the top, skip a refresh and recover, restore | Whether real workouts can start on this install route | Switch signing tool (Sideloadly / AltStore Classic) via copy-to-Files → new app → restore | data-import-export §4.1 (trial-run line); system-states §3.5 |
| `DEP-LIVE` Live Activity after the App Group fix (ADR 0007; build 7 failed) | Lock-screen countdown | Notification only, plus the optional quiet "Resting until" notification | lock-screen-and-alerts §2.1; App status |
| `DEP-ALARM` AlarmKit: permission, alarm without the widget, silent mode and Focus | Loud rest alerts | Setting stays hidden or off | lock-screen-and-alerts §2.3 |
| `DEP-AUDIO` speak while locked (background-audio build), battery over 75 min; silent-switch behaviour; iPhone mic with AirPods keeps music quality (VO5) | B13; voice VO5 | Notification as the locked alert; headset mic with a note | lock-screen-and-alerts §2.4; voice §4.5 |
| `DEP-STT` speech in **en-GB** (build 7 ran en-US) and the 30-phrase gym-noise test | How often voice asks a question; recognition language default | Voice asks more often; typing and tapping always work | voice §7; profile-and-settings PS6 |
| `DEP-AI` / spike S1 ChatGPT sign-in on iPhone | Whether the ChatGPT plan can run the coach | API key route (B10) or no coach; logging unaffected | ai-connection; onboarding §2.8 |
| `DEP-FILES` folder bookmark survives relaunch, refresh and update | Only matters if you turn on **automatic** off-phone backups | That switch is hidden; `Save a copy to Files` still works | data-import-export P-B5 |
| SQLite on the phone (ADR 0005): version ≥ 3.37, survives a kill mid-write, restore and rollback across relaunch, backup size with a real FitNotes import | Persistence as designed | Developer adjusts before real data | data-import-export; system-states |
| Your **real FitNotes export** | Which columns and formats the importer must read | Import stays unavailable for that file | data-import-export P-I1 |
| Live Activity timer at `0:00`; quiet notification visibility; 10,000-row import preview within 5 s | Small layout choices | Documented fallbacks in each spec | lock-screen-and-alerts; data-import-export |
| `DEP-UPDATE-FEED` (only if wanted later) | A "new build available" notice | Only the "Updated to build N" notice after installing | system-states P-S3 (recommend: not now) |

### D. Target RPE (from the target-rpe review, 11 Oct)

Implementation choices and spec issues not stated in Ben's words (moved from the CHANGELOG, which lists approved changes only). Built as described until he answers; his answers go in `docs/brief/CHANGELOG.md`. Spec: [coach-adjustments.md](coach-adjustments.md) CA5, CA8, §4.8.

- **SP3:** a planned RPE 10 set never triggers "too easy" either (approved rule T: planned all-out sets never trigger); "too easy" doesn't fire when reps were short.
- **SP2:** a coach next-session target RPE that differs from the set's target (as the coach saw it) is a "bigger" change, a proposal, because CA8 keeps effort targets unchanged for small changes. Does a ±0.5–1 RPE change count as small instead?
- **SP1:** the built-in target of RPE 9 for compound and isolation lifts (`builtInTargetRpe`) means RPE alone never fires "too hard" there (it needs 10.5), while "too easy" fires at RPE 7. `default-rule`'s RPE 9 is a progression ceiling, not a prescribed effort; playbook rule 3 says working sets default to RPE 7–9. Suggested: a built-in target of RPE 8 for compound and isolation lifts (harder at ≥ 9.5, easier at ≤ 6).

---

## Part 2: Technical detail

### Where each spec code went

| Codes | Section above |
|---|---|
| OB1, OB3, OB4 | B (setup). OB2 withdrawn (backups in the app by default) |
| PS1, PS2, PS5–PS7 | B (setup). PS3, PS4 → B10 |
| GE1–GE7, GE9 | B (setup). GE8 → developer (dip-belt loads) |
| GS1–GS12 (gym switch, 9 Oct) | Applied under Ben's approval of competitor follow-up 6 (gym-switch.md §1.1). GS13 → B21 |
| CS1–CS6, CM1–CM9, PB1, PB3–PB8, PB10, AC1, AC4–AC6 | B (coach). PB2 → B8; PB9 → B9; AC2, AC3, AC7 → B10 |
| VO1–VO4, VO6–VO9 | B (logging). VO5 → C (`DEP-AUDIO`) |
| RT1–RT7 | B (plan). RT8 → B14 |
| EL1–EL3, EL5, EL7, EL8 | B (plan). EL4 → B3; EL6 → B5 |
| WP2–WP9 | B (plan). WP1 → B11 |
| CR1–CR8 | B (coach) |
| CA2–CA7 | B (coach). CA1 → B4 |
| WB1, WB3–WB10 | B (coach). WB2 → B6 |
| PG1–PG12, PG14–PG19 | B (progress). PG13, PG20 → developer |
| DX1–DX12, P-B1, P-B3, P-B4, P-I1, P-I2, P-I4 | B (data) or applied. P-B2 → B2; P-B5 → C; P-I3 → B7; P-B6, P-B7 recorded as approved |
| X1 | Withdrawn (superseded by backups in the app). X2, X3 applied in the consolidation |
| P-L1–P-L7 | B (logging). P-L8 → C (`DEP-LIVE`) and B13 |
| P-S1, P-S2, P-S4 | B (data and system). P-S3 → C. P-S5 → developer |
| ADR 0003 S1, S3, R4, follow-up 3 | B (data and system); follow-up 3 → B14 |
| ADR 0005 #1–#3 | P-B1 (B), B2, developer (damaged backups) |
| ADR 0007 bundle ID, audio rule, background audio, App Group route | B1, B (data and system), B13, C |
| CI1, CI3, CI4, CI6, CI7, CI9, CI11–CI14 (check-in, 9 Oct) | B (check-in). CI2 → B15; CI5 → B16; CI8 → B17; CI10 → B18 |
| OB5, PS8, PS9, PB12–PB16, WP10–WP13, WB11–WB13 (playbook v1, 9 Oct) | B (goals, week and playbook v1). PB11 → B8 |
| Playbook D21, D22 (review fixes, 9 Oct) | B19, B20 |

### For the product manager

- **Brief / CHANGELOG entries** are needed for the two approvals applied today (data domains; backups in the app by default) and for any items Ben approves above that change the brief: B6 (WB2 vs brief §7), B11 (build order), CR1 (proposal scopes), P-S1 ("sync pending" wording), ADR 0003 S1/S3/R4.
- **ADR 0004** says backups go to Files "before any real workout is logged". The approved default is now "in the app, off-phone optional". The trial run in ADR 0004 still needs one copy saved to Files first, and the ADR wording should be updated by its owner. This design doesn't edit ADRs.
- **CLAUDE.md** describes the agent table and rules only; nothing here conflicts with it. Rule 1 (no network, no AI) and rule 7 (no silent paid route) are satisfied in every spec.
- **Playbook v1 follow-ups (9 Oct).**
  - **Rule T status:** reconcile `docs/decisions/provisional-2026-10-09.md` item 4 with the CHANGELOG and the ADR 0006 amendment (see "Already decided"). Ben's only reply was "Ok.", so confirm with him first.
  - **Review fixes (9 Oct), PM-owned wording** (not edited by the designer):
    - The ADR 0006 amendment ("the built-in fallback … only runs without the coach") and CHANGELOG 2026-10-09 ("stays only as the labelled fallback when the coach is unavailable") don't match today's behaviour. Either reword them to "sets next-session targets when the coach is unavailable or no coach target has been applied", or, if Ben chooses B19 (A), amend CLAUDE.md rule 3 and ADR 0006 so the coach's next-session target applies with visible change and Undo.
    - CHANGELOG 2026-10-09 says rules 11–13 apply "when endurance training is in the plan or imported". The single definition is now: a hard, long or key session in the plan (planned or usual) or logged (imported or reported); rule 13 also needs endurance as a goal.
    - `.claude/agents/training-researcher.md` line 19 still says Ben's goals are "strength plus endurance/HYROX-style work". It's agent config, so propose the edit to Ben.
    - `docs/design/design-system.md` §9.62 (`RuleActivityTag`) still lists `Not in use: coach connected`. Replace that row with `Built-in rule, coach connected` · `gearshape` · `In use: when no coach target is applied`, and rename the next row `Built-in rule, coach offline`. Its §11 index still lists the alias "Your training context". This wasn't edited in the review-fix pass because design-system.md has unrelated work in progress (the `color.guide.definition` token); change it in the next design-system commit.
  - **Specs updated in the review-fix pass:** workout-summary (7-F with %, no added sets, the B19 state), coach-adjustments §4.6 and §6, workout-builder (WB2, WB3, WB11, §8), coaching-playbook, onboarding, profile-and-settings, weekly-plan. If Ben chooses B19 (A), workout-summary §3 already describes the changed row; coach-adjustments §4.6 and check 17 there change with it.
  - **Brief §1 first-run setup** (the "Goals and priorities, training experience, weekly availability, preferred session length…" row): add "days a week you lift" and "other training" (onboarding OB5). The brief's only HYROX mentions are in the competitor table (Athletica), which is market research and not a special case, so no change is needed there. §12 Page 7 says only "goals/schedule", which still fits.
  - **Design specs not changed in this pass** (they need small follow-ups, listed for the next design slice):
    - coach-memory.md CM8 and §2.4: the goal card uses `Save`; it should become rule G's goal suggestion with Apply and Undo, plus a separate plan suggestion. CM9's `T1…` numbering becomes `Chat rule 1…`.
    - change-review.md: `(C3)` should read `(rule 12)`, and it needs a `update_goals` proposal kind with before/after goal fields and an effective date. (Review fixes) Its `Proposal` needs `baseContext {goals, setup, otherTraining}` and a `stale_context` state (coaching-playbook §6).
    - progress.md PG6: the fixed "10–20 guide" band should follow the goal ranges in rule 1 (e.g. 3–6 per main lift for Strength, 10–20 for priority groups under Muscle), with its label naming the goal. (Review fixes) Planning ranges count direct sets; Progress's ½-credit totals must be labelled and never drawn against those ranges as if they were the same count.
    - coach-adjustments.md §4.2/§4.7 and profile-and-settings §2.7 (Coach offers): rule T wording (compare with the planned effort; skip planned all-out sets; no "too easy" above 12 reps).
    - coach-sheet.md's context view: use `TrainingContextCard` for "Goals and week".
- **Brief text for the check-in (9 Oct).** CHANGELOG v0.9 records the approval, but the brief body still describes readiness: §1 (Today: "quick readiness check"), §6 (`ReadinessEntry`: "user-reported sleep/soreness/energy **and any sourced wearable metrics**") and §12 Page 1 ("Optional readiness: One tap: Normal / Tired / Sore"). Proposed wording: Today "pre-workout check-in on Start (1–5, Skip)"; §6 `CheckIn` "self-reported 1–5 rating, reasons and note before a workout; never combined with device data or turned into a score" (wearable values, if ever imported, are a separate record); §12 Page 1 row replaced by a pointer to the check-in. Proposal P11 in flow-first-milestone §7 is marked superseded by v0.9.

### For the developer

#### 1. Two data domains (approved; applies everywhere)

- **Separate storage.** Personal records and coaching-knowledge records live in separate tables (or a clear namespace such as `personal_*` / `knowledge_*`) so a restore, export, delete or reset can touch one without the other.
- **Owner ID on every personal record** (`ownerId`, the stable owner ID from CLAUDE.md scope): profile, goals, availability, sessions and sets, check-ins and check-in settings (9 Oct), audits, memories, pain flags and `PainFlagEvent`s, gyms and equipment, routines, scheduled sessions, planned endurance, conversations and messages, settings (voice, triggers, appearance, rest presets), import jobs, proposals and action records, guide files and their extracted text. Knowledge records carry no owner ID: playbook rules and their approval records, research bundle versions, guide index metadata, exercise catalogue, aliases, custom exercise definitions (B12), default presets.
- **Cross-domain references are by stable ID only.** Personal records point at exercise and rule IDs; sessions already snapshot the exercise (ADR 0003 M4), so history survives a knowledge reset or restore. Routines and plans that reference a missing exercise must show `Exercise missing`, never fail to load. `resetCoachingKnowledge` must keep custom exercises that personal records reference.
- **Approval records.** Who approved which rule version, and when, is stored with the rule (knowledge), not as a personal record; PB2 treats it as the approval record.
- **Guide text placement (question for the developer).** Ben's guide files are personal; the index (titles, headings, pages, status) is knowledge. Decide where extracted section **text** lives: recommendation is personal (it is Ben's licensed content), with the knowledge index pointing at it by ID. `Reset coaching knowledge` rebuilds the index from the files.
- **Credentials** are in the Keychain only and in neither domain, never in a backup or export (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`).
- **The coach context** (`buildCoachContext` / `describeCoachContext`) returns the two groups separately (coach-sheet.md §2.4).

#### 2. Backup format with two sections

- One JSON file, `format: 'fizz-backup'`, **`formatVersion: 2`**, with top-level `createdAt` (UTC + zone), `app`, `schemaVersion`, and two sections: `your_data` and `coaching_knowledge`. Each section has its own table list, `counts`, rows in primary-key order, and its own SHA-256; the file also has an overall checksum. Credentials never appear.
- `verifyBackup` and `previewRestore` report per section; `restoreBackup(file, {sections})` builds the new database from the current one plus the chosen sections, migrates, runs the integrity check and switches the pointer (ADR 0005). Restoring one section must leave the other byte-identical (data-import-export check 13a).
- `formatVersion: 1` files (if any exist from the probe) are restored as both sections together.
- Automatic backups go to Fizz's container with rotation (`Keep last 14`); `saveBackupToFiles` uses the system export picker; optional automatic off-phone backups use a security-scoped bookmark (`DEP-FILES`).
- `deleteMyData` removes owner-scoped records, the previous generation, on-phone backups, guide files and Keychain items, then writes a knowledge-only backup; `resetCoachingKnowledge` keeps a rollback generation.

#### 3. Schema and domain gaps

| Area | Gap | Source |
|---|---|---|
| Catalogue | `Exercise.secondaryMuscles: string[]` and one fixed muscle-group vocabulary | progress PG8 |
| Pain | `setPainFlag({exerciseIds[], active, area?, note?, source}, opId)`, `clearPainFlag`, `listPainFlags`; **`PainFlagEvent {exerciseId, setAt, clearedAt?, note, area?, source}`** history; `classifyPainMention` (pure, word lists) | coach-memory §6; progress PG13 |
| Proposals | `Proposal.kind`: `adjust_pending_sets`, `swap_exercise`, `change_gym`, `reschedule_sessions`, `update_template` (also covers progress's `adjust_template`), `update_pattern`, `schedule_programme`, `deload_week`, `compensating`, (9 Oct, rule G) `update_goals` (before/after goal fields, effective date); (review fixes) plan-level proposals store `baseContext {goals, setup, otherTraining}` versions from `resolveTrainingContext` and `confirmProposal` rejects them with `stale_context` when any differs (unit test: 4-day rebuild rejected after days change to 3); `author: coach \| ben \| checks`; `scope: this_session \| occurrence \| future_template \| programme`; `variants`; `targets[{entityType, entityId, baseVersion}]`; typed `changes` union; `notChanged`, `guardNotes`, `origin`, `expiresAt`, `supersedesId`, `status`; `confirmProposal(proposalId, targetVersions)` | change-review §6; progress PG20; coach-adjustments §6 |
| Routines | `SetTemplate.amrap`, `Routine.source`, `Routine.defaultGymId`, `Routine.heavyLegsOverride`, `Routine.deletedAtUtc`; `session.source = {kind: 'routine' \| 'repeat' \| 'draft', …}` | routines §6 |
| Equipment | `detailsSource: 'preset' \| 'user'` + `checkedAtUtc` (GE1); `accessory` kind and `weight_stack.attachments` (GE2); gym `plateSetId` (GE3); `availability: available \| out_of_order \| retired` + `since`, `note` (GE4); `Gym.kind`, `useUntil` (GE5); unit lock (GE6); **open:** loads for a dip belt (`BW + 10 kg` has no field yet) (GE8) | gym-editor §8 |
| Profile | `effortPrompt: 'after' \| 'before'`, auto-save timed sets, appearance; `TrainingGoals` with provenance; `AvailabilityRule` + weekly overrides. (9 Oct) `TrainingGoals` becomes versioned: `primary: 'strength' \| 'muscle' \| 'general_fitness' \| 'maintain' \| 'support_other'`, `secondary[]`, `target?: {text, date?, involves?, priority?}`, `priorityMuscleGroups[]`. New `TrainingSetup` (`daysPerWeek` 1–7, `sessionMinutes`, `minutesByDay?`, `usualDays[]`, `varies`, `experience`) and `OtherTraining[]` (`kind`, `label?`, `effort?` for every kind (review fixes; `class` and `sport` default to `hard` in the UI), `usualDays[]`, `keyDays[]`), all versioned with provenance; `undoProfileChange` | profile-and-settings §6; onboarding §6; weekly-plan §6 |
| Training context (9 Oct; revised in the review fixes) | `resolveTrainingContext(ownerId, date)` (pure, unit-tested; the endurance switch, set budget, phase by date and key sessions are all deterministic). Review fixes add: the switch counts only `hard` or key entries; `liftFirstApplies`, `rule13Active` (+ reason); `session.heavySets` and the heavy-set budget (h + ⌊(min − 10 − 4h) ÷ 3⌋); `assumed[]` (60 min, lowest start cap, days from logs); `versions {goals, setup, otherTraining}` and `contextHash`. `getLoggedFrequency`; `comparePlanToSetup`; plans, programmes and drafts record those versions | coaching-playbook §6; profile-and-settings §6 |
| Progression (9 Oct; revised in the review fixes) | `buildStepCard` and `listRecentStepCards` (pure, from `getAchievableLoads`). **Code vs rule 7-F:** `packages/domain/src/default-rule.ts` sets `maxLoadJump: null`, so the built-in rule can step +20–25%. A % limit needs a `ProgressionRule` schema change, a new rule version and an ADR (playbook PM notes). 7-F also **never adds a set** (holds at the rep cap; caps 8 / 12 / 15 by category) until Ben decides D2, and its results carry `pctChange`. History matching ignores the routine slot (playbook D7) | coaching-playbook §2.2, §6; playbook-v1 notes; workout-summary §6 |
| Playbook (9 Oct additions) | `PlaybookRule` string IDs (`'G'`, `'T'`, `'7-F'`, `'guide-1'`, `'chat-1'`), `appliesWhen` (review fixes: `builtin_baseline` replaces `coach_offline`; `endurance_switch` takes `alsoNeeds: 'lifting_priority' \| 'endurance_goal'`), `params` with provenance, `byGoal`, `openDecisions`, `status: 'removed'`, `approval.via: 'playbook_review'`; `buildRuleDetailView`; `setRuleParameter` / `resetRuleParameter`; `getRuleImplementationStatus(build)` declared per build | coaching-playbook §6 |
| Settings | Voice settings record (`saveVoiceSettings`), coach trigger thresholds record (`saveCoachTriggerThresholds`) | profile-and-settings §6 |
| Memory | `CoachingMemory` fields (type, status, source, dates, history, version); `proposeRuleFromChat`; `classifyCoachIntent` adds `propose_rule` | coach-memory §6 |
| Playbook | `PlaybookRule` (origins research / guide / chat), `Guide`, `GuideSection`, rule bundle loader, conflicts, `validateCitations` | coaching-playbook §6 |
| Conversations | `CoachMessage` union, conversations with kind and retention | coach-sheet §6 |
| Plan | `ScheduledSession.fixed, key, kind, timeLocal, tz, provenance, linkedSessionId, seriesId`; planned endurance entries. (9 Oct) Endurance entries add `type` (`run` / `ride` / `swim` / `row` / `class` / `sport` / `other`) and `effort?`; `listUsualItems` / `hideUsualItem`; `classifySessionLoad.heavyStrength`; `checkScheduleConflicts` takes the training context and returns nothing while the endurance switch is off | weekly-plan §6 |
| Session commands | `swap_exercise` / `undo_swap` (if B3 approved); `saveSetDraft`, `setActiveSet`, `endRestTimer`; undo for correction, delete and skip-exercise; "this rest only" rest edits; side corrections (ADR 0003 open) | exercise-library §6; flow §6; ADR 0003 |
| Gym switch and re-snap (9 Oct; needs an ADR before building) | Pure `snapPlanToGym` shared by `startWorkout`, Repeat, `setActiveGym` and `validateRoutineForGym`, with a property-test invariant; `PlannedSet.snap` (intended target, `intendedOn`, outcome, reason); `session.gymChanges`; an append-only `equipmentSnapshot` unique by `(id, version)` plus `SessionExercise.equipmentVersion`; `SessionExercise.continuesFromId`; commands `change_gym` / `undo_change_gym`. **Code gap:** `startWorkout` keeps a pinned item's Fixed load unchecked at a gym without it (the same class as review B1) | gym-switch §6 |
| Import | Import jobs with source rows, `mappingVersion`, session status `reverted`, `ExerciseAlias.source = 'fitnotes'`, per-set provenance (file, row, original values) | data-import-export §6 |
| System | `buildSystemStatus`, `getInstallStatus`, `DatabaseManager.open()` result union, `scheduleRefreshReminder`, `buildStatusReport`; **open:** how to "set aside" a damaged unfinished workout so a new one can start (P-S5) | system-states §7 |
| Backups | Damaged records: backups can be created but restore is refused, never "skip damaged" (ADR 0005 #3) | data-import-export §3.3 |
| Check-in (9 Oct) | `CheckIn` record (score, reasons, note, UTC + tz, input provenance, session link, outcome, pain flag IDs, history), `session.checkIn` union, `CheckInSettings`; `startWorkout` / `startWorkoutFromDraft` / `startWorkoutFromSession` take `opts.checkIn` and link it in the same transaction; `shouldAskCheckIn`, `evaluateCheckInOffer`, `summariseCheckIns`, `parseCheckInUtterance` are pure domain functions; `requestCoachAdjustment` origin `check_in_offer`; guard kinds `lighter_no_increase`, `pain_unspecified`; `setPainFlag` source `check_in`. `calculateNextTargets` must not read check-ins | check-in §6 |

#### 4. Canonical function names (use these; old names are withdrawn)

| Canonical | Replaces | Owner |
|---|---|---|
| `getBackupStatus(ownerId)` (two-part shape: `onPhone`, `offPhone`) | profile-and-settings' `getBackupStatus()` shape | data-import-export §6 |
| `verifyBackup(file)` (per-section report) | onboarding's copy of the contract | data-import-export §6 |
| `saveApiKey(purpose, key \| {sameAs: 'text'}, capUsd, opId)`, `removeApiKey(purpose)` | `setProviderCredential`, `checkProviderCredential`, `removeProviderCredential` | ai-connection §6 |
| `getPersonalUsageSummary(purpose, month)` | `getPersonalUsageSummary({provider, month})` | ai-connection §6 |
| `setPainFlag({exerciseIds[], active, area?, note?, source}, opId)` | `setPainFlag(exerciseId, active, note?)` | coach-memory §6 |
| `getVoiceSettings()` / `saveVoiceSettings(patch, opId)` | `setVoicePreferences(…)` | profile-and-settings §6 |
| `getInstallStatus()` | `getInstallInfo()` | system-states §7 |
| `runRestAlertTest()` | `runAlertTest()`, `runRestAlertTest(layers)` | lock-screen-and-alerts §6 |
| `getDeviceCapabilities()` aggregates `getRestAlertCapabilities()`, `getVoiceCapabilities()`, `getAiCapabilities()`, `getPermissionStatus()` | — | profile-and-settings §6, system-states |
| `deleteMyData(ownerId, confirmation)`, `resetCoachingKnowledge(confirmation)` | `deleteAllData` | data-import-export §6 |
| `exportTrainingData(…)` (My data), `exportCoachingKnowledge()` | — | data-import-export §6 |
| `describeCoachContext(…)` → `{yourData[], coachingKnowledge[], notIncluded[], notAvailable[], messagesSent}` | ungrouped shape | coach-sheet §6 |
| `timing.coachTimeout` | `timing.coachFirstToken` | design-system §6 |
| `timing.offPhoneReminder` | `timing.backupOverdue` | design-system §6 |
| `Proposal.kind = 'update_template'` | `'adjust_template'` | change-review §6 |
| `recordCheckIn`, `updateCheckIn`, `deleteCheckIn`, `setCheckInOutcome`, `getCheckInHistory` (9 Oct) | `recordReadiness` (withdrawn); brief `ReadinessEntry` → `CheckIn` | check-in §6 |
| `saveTrainingSetup(…)` (9 Oct) | `saveAvailability({days[], varies, sessionMinutes})` | onboarding §6 |
| Candidate rule IDs `guide-N` / `chat-N`, shown `Guide rule N` / `Chat rule N` (9 Oct) | `G1…` (coaching-playbook), `T1…` (coach-memory CM9); these clashed with playbook rules G and T | coaching-playbook §2.1 |
| Playbook rule IDs `'11'`, `'12'`, `'13'` for scheduling (9 Oct) | `C1`–`C4` in weekly-plan and change-review (C4 withdrawn) | weekly-plan §6 |

#### 5. Domain constants (data, not design tokens)

Memory suggestion expiry 14 days (CM3); "worth checking" after 6 months (CM7); cleared pain flags stay in coach context 4 weeks; coach drafts kept 14 days (WB9); `Not now` proposals kept 30 days (CR7); trend gap 21 days (`TREND_GAP_DAYS`, PG12); records need 3 earlier sessions (PG10); estimated 1RM 1–10 reps (PG11); heavy-legs thresholds (WP4, stored with rule 12 since 9 Oct; was C3); playbook v1 defaults (rule 1 time per set 3:00, heavy set 4:00, warm-up 10 min, 8 sets per group per session; review fixes: assumed session length 60 min, lowest start cap 8 when experience isn't set, default heavy sets per session 6 for a Strength focus, history-start bonus +2 sets; rule 7 and 7-F big-step limit 10%; rule 12 48 h before key, 48 h after a match, 6 h gap; rule 13 two heavy sessions) are rule parameters stored with each rule (Coaching knowledge, coaching-playbook PB14), not constants; coach trigger defaults (ADR 0006 and its amendment, playbook rule T): "too hard" at RPE ≥ 9.5 when the set was planned at ≤ 8.5, or reps short by ≥ 2; "too easy" at RPE ≤ 6 when planned at ≥ 8, never on sets above 12 reps; sets with no planned RPE use RPE ≥ 9.5 / ≤ 6 (playbook D20); never on warm-ups, drop sets or planned all-out/AMRAP/"+" sets. Until a build implements the planned-effort check, coaching-playbook PB15 shows it as a `This app version` gap; automatic backups kept 14; off-phone reminder 30 days; check-in defaults (9 Oct): asked every workout, "What's up?" at 3 or lower, lighter-session offer at 2 or lower or with Tired / Poor sleep, note ≤ 280 characters (the 2 h reuse window is `timing.checkInReuse`).
