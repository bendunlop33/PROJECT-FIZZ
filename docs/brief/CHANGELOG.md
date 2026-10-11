# Brief changelog

The brief is a living document. Each approved change gets an entry here: the date, what changed, why, and the research or review that prompted it.

- 2026-10-08: Initial brief added (v0.1). Target platform: iOS first.

## v0.2: 2026-10-08 (approved by Ben)

**Build order**
- Lock-screen and notification rest alerts move into the first milestone (previously build step 7). Reason: the milestone requires no missed timer endings and recovery after force-close. Source: `docs/research/ios-platform-feasibility.md`.

**Design**
- Adopted P1–P12 from `docs/design/flow-first-milestone.md` §7:
  - P1: no Start tap for rep sets.
  - P2: logging during rest ends the rest.
  - P3: RPE is asked after logging.
  - P4: a single workout pause.
  - P5: a keypad that shows achievable loads.
  - P6: opening the app goes straight back into a recent workout.
  - P7: on-device voice set logging.
  - P8: the summary shows "Next time" targets.
  - P9: "Rest after" shown on every set.
  - P10: an inline voice strip.
  - P11: readiness is recorded only.
  - P12: placement of Talk/Ask.

**AI and voice** (from `docs/research/ai-access-and-voice.md`, proposals 1–7)
- The ChatGPT-plan route: Plus/Pro (Go unconfirmed), loopback-only redirect, models discovered at runtime, no published quota. "Use credits after limits" stays off.
- One shared Responses adapter. Reply length is set in the instructions.
- First-release voice is on-device. `parseSpokenSet` is deterministic in `packages/domain`.
- Realtime/GPT-Live is deferred to an explicit later decision that needs a separately funded key.
- Claude subscriptions can't be used; Claude is available only via a separately billed API key.
- §11 now lists the specific unknowns for the ChatGPT-plan route.

**Platform** (from `docs/research/ios-platform-feasibility.md`, proposals 1–6)
- A custom Swift audio-session module joins the step 1 spike.
- Layered rest-alert strategy. Notification sounds may be silent in silent mode or Focus.
- Two build profiles: development (needs the dev server) and preview (standalone, for the gym).
- FitNotes: confirm which app and get a real export. RPE comes only from reviewed comment parsing.
- Pin Expo SDK 57 and stay on Expo rather than SwiftUI (ADR 0001).
- Clarified the wording on on-device speech recognition.

**Open**
- The Apple Developer Program ($99/yr) dependency is being re-examined: Ben asked for a free install route. Research is in progress.

## v0.3: 2026-10-08 (approved by Ben)

- **Distribution:** use the free route (free Apple ID + SideStore + a cloud-built `.ipa`) and don't join the paid Developer Program. See ADR 0004 and `docs/research/free-ios-install.md`.
- **First milestone additions:** backup and a tested restore, a cloud `.ipa` build, and an on-device capability probe screen.
- **Native config:** only free-provisionable entitlements. Paid-only features are runtime capability flags.
- **Dependencies resolved:** Ben has a Windows laptop and an iPhone 17 (iOS 26), so AlarmKit is available as the loud rest-alert fallback.

## v0.4: 2026-10-08 (approved by Ben)

- **Coach-led progression replaces fixed rules as the primary method** (ADR 0006).
  - ChatGPT chooses weights, reps and sets.
  - **When it acts:** only when Ben asks, or when a clear signal warrants it, such as RPE 10. Never constantly.
  - **Today's sets, Ben asked:** the change applies immediately, with Undo.
  - **Today's sets, coach raised it:** the coach offers the change first.
  - **Future sessions:** always proposals.
  - **Guardrails:** achievable loads, equipment limits, pain blocks and completed sets are never edited. The deterministic rules become the labelled offline fallback.

## v0.5: 2026-10-08 (requested by Ben)

- **Coach workout builder.** Ben can ask the coach to create a whole workout. Later, he can also ask for a multi-week programme.
- **What the coach uses:** his goals, memories, recent training, the selected gym's equipment and his history.
- **Checks before Ben sees it:** catalogue, equipment, achievable loads, machine maximums and pain flags. The checks are deterministic.
- **Review:** he can Start now, Save as routine, Edit, or ask for changes. Programmes are approved before anything is scheduled.
- **Order:** single sessions first; programmes come with build step 6, the calendar.
- **Offline:** saved routines still work; generating a new workout needs the coach.

## v0.6: 2026-10-08 (Ben)

- **Ben has ChatGPT Pro.** It covers the text coach through the ChatGPT-plan route, once the iPhone sign-in test (S1) passes. It does **not** cover voice: the route excludes audio, transcription and Realtime.
- **Voice plan:**
  - **Set cues:** Apple on-device voices (Enhanced/Premium recommended). Instant, offline, free.
  - **Coach replies:**
    - **Default:** Apple voice.
    - **Opt-in:** an OpenAI TTS voice, using Ben's own OpenAI API key (stored in the Keychain) with a spend cap set on OpenAI's dashboard, and spend shown in the app.
    - **Fallback:** if Ben is offline, out of credit or the key fails, the app falls back to Apple and says so. It never silently switches to a paid route.
  - **Live ChatGPT-style conversation (Realtime/GPT-Live):** still a later, explicit decision. It needs a credential-issuing service.
- **Speech input:** Apple on-device recognition, using the device locale (en-GB). OpenAI transcription only if accuracy in the gym is poor.

## v0.7: 2026-10-08 (Ben)

- **Data is split into two domains everywhere:** storage, coach context, backup, export, delete and the UI.
  - **Your data (personal, owner-scoped):** profile, goals, workout history, coach memories about Ben, pain flags, gyms and equipment, routines and plans, conversations, settings, and Ben's own guide files.
  - **Coaching knowledge (general):** approved playbook rules with their evidence, candidate rules, the exercise catalogue and aliases, and default presets.
- **Routing:** general training rules stated in chat become playbook *candidates*, not personal memories. Personal preferences stay as memories.
- **Backup, export and delete:** backups have separate sections that can be restored independently. Each domain can be exported or reset on its own. Credentials stay in the Keychain, in neither domain.
- **Backups are in-app by default (Ben).** Automatic backups go into the app's own storage only. Off-phone backup to Files or iCloud is optional: a manual button, plus an automatic off-phone setting that is off by default. Onboarding no longer requires an off-phone backup. The safeguards don't nag: the app offers a one-tap off-phone copy before risky moments, and shows a quiet Settings reminder after 30 days without one.

## v0.8: 2026-10-08 (Ben)

- **Wearables (Garmin) are read-only.** The app only pulls data in: through Apple Health, Garmin's activity/health data, or exported files. It never uploads or writes anything to Garmin: no workouts pushed to the watch, nothing written back. Research is in progress in `docs/research/wearables-garmin.md`.

## v0.9: 2026-10-09 (Ben)

- **Wearables integration is parked.** Ben judged it too complex for now. The core app comes first: logging, rest, coach, progress. Endurance data stays a separate, empty-by-default domain. The coach never assumes runs it hasn't seen.
- **Later, read-only, in this order:**
  1. FIT file import.
  2. A HealthKit probe.
  3. Possibly the unofficial connector, only if Ben explicitly accepts the risks.

  Research is kept in `docs/research/wearables-garmin.md` and `garmin-live-data.md`.
- **Pre-workout check-in (Ben):**
  - **When:** on Start workout, the app asks "How are you feeling today?" (1–5) with Skip.
  - **Below 4:** it asks "What's up?" with multi-select reasons, an optional note, or voice.
  - **What the answers do:**
    - **Pain:** goes to the pain-flag flow.
    - **Feeling ill:** gets a gentle suggestion to rest.
    - **Low score:** the coach may *offer* a lighter session (rule 3), and never applies it on its own.
  - **Storage and display:** the check-in is recorded in Your data and shown as-is, never turned into a recovery score. It replaces the Today readiness chips. Spec: `docs/design/check-in.md`.
- **Exercise bank with visual guides (Ben).** This overrides EL8 ("no exercise videos"). A large catalogue (all common exercises, with basic entries). Rich entries with visual guides start with 10 examples (Ben), expanding later to about 100 to 150, each with original animated guides plus static key frames for Reduce Motion. Two new agents, `exercise-researcher` and `exercise-guide-maker`, do the work. The approach and licences are being researched in `docs/research/exercise-bank-and-visuals.md`.
- **Simplification (provisional, overnight 9 Oct).** Restore swaps the whole database; per-section restore is deferred. Backups still label the two data domains. Ben to confirm.

## 2026-10-09: App name (approved by Ben)
- **The app is called GymSmarter.** This replaces the placeholder "Fizz" (provisional decision 2 in `docs/decisions/provisional-2026-10-09.md`).
- **What changes:** only the name Ben sees. That's the home-screen and SideStore name (`CFBundleDisplayName`, `DISPLAY_NAME` in `apps/mobile/app-identity.mts`), in-app text, permission prompts, and the `.ipa` file name (`GymSmarter-<version>-build<N>.ipa`).
- **What stays the same:** bundle ID `com.projectfizz.fizz`, the App Group, the widget extension ID, the Expo slug, the internal Xcode project name (`Fizz`), the database, keychain and backup identifiers (backup files keep the `fizz-backup-` prefix), and all data. An installed "Fizz" build updated over the top becomes GymSmarter with its data intact.
- The repo stays `PROJECT-FIZZ`, and the `@fizz/*` package scope and `FIZZ_*` build variables are unchanged. In older docs (research, reviews, ADRs, design specs), "Fizz" means GymSmarter.

## 2026-10-09: Coaching playbook v1 (approved by Ben)
Ben's reply to the 14 candidate rules (`docs/training-guides/README.md`): "Ok. 1 - it should be guided by how often people say they gym per week too, rather than starting from a random number. 7 - i think this should be driven by a combination of AI and what the gym can offer, as a default rule won't always work best. stop with hyrox, it should be more adaptable depending on what the goal is / how training is being run."
- **Approved:** rules 2–6 and 8–13.
- **Rule 1 revised:** the starting weekly set target per muscle, and how it grows, come from how often Ben says he trains (days per week) and how sessions are run, not a fixed 10 sets.
- **Rule 7 revised:** progression is chosen by the AI coach from the selected gym's real equipment (increments, microplates, dumbbell steps, stack increments, machine min/max) and Ben's history. The built-in rule stays as the labelled fallback (CLAUDE.md rules 1 and 3, ADR 0006) for when the coach is unavailable or no coach target has been applied (open decision D21), and is itself equipment-aware.
- **HYROX is no longer a special case.** Rule 14 is removed and the "HYROX vs strength" question is dropped. The playbook adapts to Ben's current goal and how his training is run (days per week, session length, other training, equipment). Rules 11–13 apply only when a hard, long or key endurance-type session is planned, usual, imported or reported. HYROX remains only as an example in library research and as ordinary exercises in the catalogue.
- **Mid-session trigger refinement approved** (training-guides conflict 1): the coach compares a set's logged effort with its planned effort, skips warm-ups and planned all-out sets, and doesn't fire "too easy" above 12 reps. Recorded as an amendment to ADR 0006.
- The approved rules are written up in `docs/training-guides/playbook-v1.md`, with the onboarding and Goals & schedule specs updated to collect days per week and other training.

## 2026-10-09: Coach targets, rotation and competitor follow-ups (Ben)
- **Coach is the default for next-session targets (D21):** small load/rep/set adjustments apply by default with reason and Undo; structural changes stay proposals, raised only when Ben asks for variety or something changed. CLAUDE.md rule 3 and ADR 0006 (amendment 2) updated.
- **D19:** the next workout follows what Ben last trained (rotation by last session), not fixed weekdays.
- **Other playbook defaults (D1–D18, D20, D22) accepted as proposed.**
- **Competitor follow-ups approved** (`docs/research/competitor-landscape.md`): 1 rest Live Activity (plus fallback if the retest fails), 2 competitor-failure test pack, 3 "Why this number?" on every set target, 6 mid-workout gym switch re-snap (and Repeat B1), 7 coach honesty contract, 8 pain-flag UX, 9 per-set exclusion flags, 10 "About N min left" and a shorten proposal.
- **Item 4 changed by Ben:** history import should use AI to interpret any format and transform it into the app's format, instead of hand-written per-app import rules. The deterministic FitNotes importer stays as the offline path; the AI route is designed so the model proposes the mapping and code applies and validates it (rules 6 and 8).

## 2026-10-11: Your data slice: awaiting Ben (proposed, not approved)
Recorded so the open scope is tracked; nothing here is approved yet. Details in ADR 0023 (`docs/decisions/0023-delete-and-reset-by-data-domain.md`; renumbered from 0022, which is main's pre-start draft ADR), `docs/reviews/your-data-r2.md`, `docs/reviews/your-data-r3.md`, `docs/reviews/your-data-r4.md`, `docs/reviews/your-data-r5.md` and `docs/reviews/your-data-r6.md` (S2: still eight items). ADR 0023 stays Proposed until Ben answers these or says to merge as is.
- **Export scope:** JSON only, saved through the Files folder picker. CSV, FitNotes 2 CSV, date ranges, the warm-up toggle and the share sheet (data-import-export §2.6, §4.4) proposed as a follow-up slice. Ben to accept for now or ask for them before merge.
- **Pre-delete safety net:** `Save a copy to Files first` listed first when there is no copy off the phone (as specified), or a prompt before the Delete alert. Ben to decide.
- **Reset and playbook candidates:** until approving rules ships, Reset removes every candidate. The spec (§2.7, §3.6) should say so.
- **Custom exercises and aliases (B12):** treated as Your data in code, Coaching knowledge in the spec. The spec should match the code until B12 is decided.
- **Delete step order (§4.5):** the code swaps the database first (a failure before it deletes nothing), then signs out and wipes the Keychain, then alerts, backups and files; every step after the swap runs even if one fails. §4.5 orders Keychain → alerts → transaction. Ben to accept; the spec would then say credentials come first after the swap.
- **Reset and today's edits:** the code keeps an open pre-start draft through Reset and Undo last reset (only a restore discards drafts). Ben to confirm; the specs would then say so.
- **Undo last reset (§3.6):** the code brings back only Coaching knowledge and keeps everything logged since the reset; §3.6 calls it the restore mechanism (a whole-file swap, which reverted workouts logged since). Ben to confirm; §3.6 would then say so.
- **Reset with Undo last restore pending (§3.6):** the code replaces the restore's Undo copy; when that copy holds data not on the phone, the Reset alert names it and Reset saves it as an on-phone backup first. Ben to confirm, or choose refusing Reset or keeping Undo last restore instead.
- **Spec wording:** §4.5 step 3's "cached import files" should also name the copies made when Ben picks a backup to restore or check (the code removes all of them).

## 2026-10-11: Sending data to ChatGPT (Ben)
- **Approved:** "Fine to send stuff to ChatGPT." Answers data-import-export §9.8 question 2: the any-app import may send column names plus up to 30 code-chosen sample rows (or 120 note lines) to the ChatGPT-plan route, shown first behind `See what's sent`. Same consent covers the coach's existing context (Your data, quoted as data). Rule 7 unchanged: never a paid route without explicit opt-in.
- Still open for the any-app import: §9.8 Q1 (which apps besides FitNotes; a real sample file is needed) and Q3 (API-key fallback if the plan route can't carry it).
