# Open decisions

Status: consolidated 8 Oct 2026 from every design spec's decision tables (OB, PS, GE, CS, CM, AC, VO, PB, RT, EL, WP, CR, CA, WB, PG, DX, P-B, P-I, P-L, P-S, X) and the open items in ADRs 0003–0007. Each question appears once. Part 1 is for Ben; Part 2 is technical detail.

**Already decided today, not repeated below:** data is split into **Your data** and **Coaching knowledge**; backups are kept **in the app by default** and a copy off the phone is optional. Both were approved by Ben and relayed by the product manager. They are applied in every spec (README.md explains them). The brief/CHANGELOG entries and an ADR 0004 wording update for these belong to the product manager (see Part 2, "For the product manager").

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
| B6 | **Coach-built workouts with no history on that equipment:** leave the load empty with "start light, enter your load", rather than inventing a starting number? (The brief currently says "bounded defaults".) | Leave it empty | workout-builder WB2; brief §7 |
| B7 | **Old FitNotes history as "Last time":** when the exercise, unit and load type match but FitNotes didn't record the machine, may it show as `Last (FitNotes, 1 Oct)`? | Yes, always labelled as FitNotes | data-import-export P-I3; active-workout §4.2; progress |
| B8 | **Approving playbook rules in the app:** the app keeps the record of what you approved and when (and it's in your backups). OK for the app to be the record? | Yes | coaching-playbook PB2 |
| B9 | **Guide PDFs aren't copied into backups** (only their index); after a restore you re-add the file. OK? | Yes (keeps backups small) | coaching-playbook PB9; data-import-export |
| B10 | **OpenAI key and spending:** enter one key once and use it for both text and voice by default (separate keys optional), and set in-app monthly caps that stop spending before OpenAI's own limit? Caps are estimates. | One key by default; caps $5 text, $2 voice (editable) | ai-connection AC2, AC3, AC7; profile-and-settings PS3, PS4 |
| B11 | **Build the simple weekly plan earlier** (repeating week, move/skip/missed) together with routines, instead of waiting for build step 6? Endurance and programmes stay in step 6. | Yes | weekly-plan WP1; today; brief §10 |
| B12 | **Custom exercises you create:** treat them as Coaching knowledge (like the exercise list), never removed by `Reset coaching knowledge` while your workouts or routines use them? | Yes | exercise-library; data-import-export §2.7 |
| B13 | **"Speak while locked"** (Fizz keeps a silent audio session so it can say "Ready" with the phone locked; uses more battery): offer it as an opt-in setting if the device test works? | Decide after the test; if it works, opt-in and off by default | lock-screen-and-alerts §2.4, P-L8; ADR 0007 |
| B14 | **Rest between left and right sides** of a one-sided exercise: full set rest, a short transition, or none? | Decide after trying it; until then full set rest | ADR 0003 follow-up 3; routines RT8 |

### B. Recommended defaults: approve in bulk

Each line is a sensible default the specs already use. Approving this section in one go is fine; tell us any line you want changed.

**Setup and settings**
- Onboarding is three short steps (units and rests, gym, a "how your data is kept" explainer); goals, week and limitations are optional and can come later (OB1). `Restore from a backup` is on the Welcome screen (OB3). No permission is asked until a feature needs it, and location is never asked (OB4).
- Profile shows what works on this phone honestly, with dated evidence (App status), and warns about signing expiry 3 days and 1 day ahead (PS1, PS2).
- Loud alarm-style rest alerts are optional, with `Long rests only (2:00 or more)` or `Every rest` (PS5). Recognition language suggests English (UK) (PS6). "Ask for effort after the set" (default) or before is saved in your profile (PS7).
- Gyms: preset values are marked `not checked` until you check them (GE1); benches, racks and cable attachments can be listed (GE2); one plate set per gym shared by bars and machines (GE3); `Out of order` for long-term broken kit (GE4); travel gyms archive themselves after their end date (GE5); a piece of equipment's unit is locked once it has sets (GE6); a mid-workout gym switch only happens when you tap `Switch` (GE7). Shared history across gyms comes later (GE9).

**Logging, alerts and voice**
- Tap to talk (stops when you stop speaking); hold-to-talk is a setting (VO1). Sets are understood on the phone without AI (VO2); a clear spoken set saves at once with Undo, an unclear one asks one question (VO3); its Undo sits in the voice strip (VO4). On-device speech only, unless you allow Apple's servers (VO6). Stop speech by tapping, not by talking over it (VO7). Spoken replies are at most two sentences (VO8). Voice can't spend money, change keys, start a coach-built workout, approve a rule or clear a pain flag (VO9).
- Lock screen: no Time Sensitive option (needs the paid programme) (P-L1); one Live Activity per workout showing the end time and next target (P-L2, P-L3); no lock-screen buttons for now (P-L4); the loud alarm only when Fizz is in the background (P-L5); optional quiet "Resting until 18:42" notification when the Live Activity doesn't work (P-L6); optional "workout still running" reminder, off (P-L7).

**Coach**
- Coach offers never fire on warm-up or drop sets, and "reps short" counts from the bottom of the range (CA5); at most one offer per exercise unless the reason changes (CA4); adjustments don't change rest times (CA3); with no coach, nothing is adjusted mid-workout (CA6); if you log while the coach is thinking, it retries once on the new state or drops it (CA7). Swaps and gym changes still need `Apply` (CA2, unless B3 changes it for your own swaps).
- Coach conversations: one thread per workout, plus general threads (CS1); only recent messages are sent (CS2); a workout bar in the sheet, with no Log button (CS3); nothing is sent later on its own when offline (CS4); things you explicitly ask for apply at once, things the coach infers are suggestions (CS5); starter chips are fixed text (CS6). Conversations are kept forever unless you choose 1 year or 90 days.
- Memory: only confirmed memories reach the coach (CM1); "remember …" saves at once with Undo (CM2); unanswered suggestions drop after 14 days (CM3); pain flags are set eagerly and only you clear them (CM4); "sore/tight" asks "soreness or pain?" (CM6); memories over 6 months old show under `Worth checking` (CM7); goals stay in Profile (CM8); general training rules go to the playbook, not memory (CM9).
- Playbook: guardrails always win (PB1); editing a rule marks it `Edited by you` (PB3); guides are searched on the phone and only short excerpts are sent (PB4); guide text is reference, never instructions (PB5); unresolved conflicts default to the higher source (PB6) and are labelled by where they came from (PB7); the coach may suggest rules from your guides as ungraded candidates (PB8); approving a rule never changes app settings by itself (PB10).
- AI connection: the coach route is a setting you pick, never an automatic fallback (AC1); the "you're using your ChatGPT plan" notice appears once at sign-in, never mid-workout (AC5); the model is chosen explicitly and never swapped silently (AC6); if ChatGPT sign-in can't work on iPhone, the API key is offered and the laptop workaround isn't built (AC4).
- Coach-built workouts: drafts are separate from routines (WB1); loads are rounded down and capped (WB3); missing or pain-flagged exercises are swapped or removed and flagged, never auto-substituted for pain (WB4); duration is always the app's estimate (WB5); 60 s build timeout (WB6); voice can ask but not start (WB7); editing a coach routine makes it yours (WB8); unused drafts kept 14 days (WB9); during a workout a new build can only be saved (WB10).
- Change review: four scopes shown in words (today / one date / from now on / programme) (CR1); narrowest scope by default (CR2); all-or-nothing apply (CR3); any change elsewhere makes a suggestion out of date (CR4); overlapping suggestions are marked (CR5); a spoken "yes" only applies narrow changes (CR6); `Not now` keeps it for 30 days (CR7); suggestions expire on clear rules (CR8).

**Plan and library**
- Routines and the week live in one `Plan` screen with `Week` and `Routines` (RT1); each routine row has a `Start` button (RT2); loads default to `Auto` (coach or built-in rule), with Fixed and "% of top set" available (RT3); "Repeat last workout" copies what you did as targets, with nothing marked done (RT4); routines show who made them (RT5); an optional `AMRAP` flag that never triggers effort offers (RT6); "counts as heavy legs" is automatic with an override (RT7).
- Exercise search works offline and shows why something matched (EL1); "at this gym" filter on when picking, and hidden results are counted (EL2); a custom exercise's load type is locked once used (EL3); swap reasons are plain text, never scores (EL5); sled-type exercises are logged as plates added (EL7); no exercise videos (EL8).
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

---

## Part 2: Technical detail

### Where each spec code went

| Codes | Section above |
|---|---|
| OB1, OB3, OB4 | B (setup). OB2 withdrawn (backups in the app by default) |
| PS1, PS2, PS5–PS7 | B (setup). PS3, PS4 → B10 |
| GE1–GE7, GE9 | B (setup). GE8 → developer (dip-belt loads) |
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

### For the product manager

- **Brief / CHANGELOG entries** are needed for the two approvals applied today (data domains; backups in the app by default) and for any items Ben approves above that change the brief: B6 (WB2 vs brief §7), B11 (build order), CR1 (proposal scopes), P-S1 ("sync pending" wording), ADR 0003 S1/S3/R4.
- **ADR 0004** says backups go to Files "before any real workout is logged". The approved default is now "in the app, off-phone optional". The trial run in ADR 0004 still needs one copy saved to Files first, and the ADR wording should be updated by its owner. This design doesn't edit ADRs.
- **CLAUDE.md** describes the agent table and rules only; nothing here conflicts with it. Rule 1 (no network, no AI) and rule 7 (no silent paid route) are satisfied in every spec.

### For the developer

#### 1. Two data domains (approved; applies everywhere)

- **Separate storage.** Personal records and coaching-knowledge records live in separate tables (or a clear namespace such as `personal_*` / `knowledge_*`) so a restore, export, delete or reset can touch one without the other.
- **Owner ID on every personal record** (`ownerId`, the stable owner ID from CLAUDE.md scope): profile, goals, availability, sessions and sets, audits, memories, pain flags and `PainFlagEvent`s, gyms and equipment, routines, scheduled sessions, planned endurance, conversations and messages, settings (voice, triggers, appearance, rest presets), import jobs, proposals and action records, guide files and their extracted text. Knowledge records carry no owner ID: playbook rules and their approval records, research bundle versions, guide index metadata, exercise catalogue, aliases, custom exercise definitions (B12), default presets.
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
| Proposals | `Proposal.kind`: `adjust_pending_sets`, `swap_exercise`, `change_gym`, `reschedule_sessions`, `update_template` (also covers progress's `adjust_template`), `update_pattern`, `schedule_programme`, `deload_week`, `compensating`; `author: coach \| ben \| checks`; `scope: this_session \| occurrence \| future_template \| programme`; `variants`; `targets[{entityType, entityId, baseVersion}]`; typed `changes` union; `notChanged`, `guardNotes`, `origin`, `expiresAt`, `supersedesId`, `status`; `confirmProposal(proposalId, targetVersions)` | change-review §6; progress PG20; coach-adjustments §6 |
| Routines | `SetTemplate.amrap`, `Routine.source`, `Routine.defaultGymId`, `Routine.heavyLegsOverride`, `Routine.deletedAtUtc`; `session.source = {kind: 'routine' \| 'repeat' \| 'draft', …}` | routines §6 |
| Equipment | `detailsSource: 'preset' \| 'user'` + `checkedAtUtc` (GE1); `accessory` kind and `weight_stack.attachments` (GE2); gym `plateSetId` (GE3); `availability: available \| out_of_order \| retired` + `since`, `note` (GE4); `Gym.kind`, `useUntil` (GE5); unit lock (GE6); **open:** loads for a dip belt (`BW + 10 kg` has no field yet) (GE8) | gym-editor §8 |
| Profile | `effortPrompt: 'after' \| 'before'`, auto-save timed sets, appearance; `TrainingGoals` with provenance; `AvailabilityRule` + weekly overrides | profile-and-settings §6; onboarding §6; weekly-plan §6 |
| Settings | Voice settings record (`saveVoiceSettings`), coach trigger thresholds record (`saveCoachTriggerThresholds`) | profile-and-settings §6 |
| Memory | `CoachingMemory` fields (type, status, source, dates, history, version); `proposeRuleFromChat`; `classifyCoachIntent` adds `propose_rule` | coach-memory §6 |
| Playbook | `PlaybookRule` (origins research / guide / chat), `Guide`, `GuideSection`, rule bundle loader, conflicts, `validateCitations` | coaching-playbook §6 |
| Conversations | `CoachMessage` union, conversations with kind and retention | coach-sheet §6 |
| Plan | `ScheduledSession.fixed, key, kind, timeLocal, tz, provenance, linkedSessionId, seriesId`; planned endurance entries | weekly-plan §6 |
| Session commands | `swap_exercise` / `undo_swap` (if B3 approved); `saveSetDraft`, `setActiveSet`, `endRestTimer`; undo for correction, delete and skip-exercise; "this rest only" rest edits; side corrections (ADR 0003 open) | exercise-library §6; flow §6; ADR 0003 |
| Import | Import jobs with source rows, `mappingVersion`, session status `reverted`, `ExerciseAlias.source = 'fitnotes'`, per-set provenance (file, row, original values) | data-import-export §6 |
| System | `buildSystemStatus`, `getInstallStatus`, `DatabaseManager.open()` result union, `scheduleRefreshReminder`, `buildStatusReport`; **open:** how to "set aside" a damaged unfinished workout so a new one can start (P-S5) | system-states §7 |
| Backups | Damaged records: backups can be created but restore is refused, never "skip damaged" (ADR 0005 #3) | data-import-export §3.3 |

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

#### 5. Domain constants (data, not design tokens)

Memory suggestion expiry 14 days (CM3); "worth checking" after 6 months (CM7); cleared pain flags stay in coach context 4 weeks; coach drafts kept 14 days (WB9); `Not now` proposals kept 30 days (CR7); trend gap 21 days (`TREND_GAP_DAYS`, PG12); records need 3 earlier sessions (PG10); estimated 1RM 1–10 reps (PG11); heavy-legs thresholds (WP4, stored with rule C3); coach trigger defaults RPE ≥ 9.5, reps short ≥ 2, RPE ≤ 6 (ADR 0006); automatic backups kept 14; off-phone reminder 30 days.
