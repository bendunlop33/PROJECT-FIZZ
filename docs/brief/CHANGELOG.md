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

## 2026-10-11: Backlog defaults accepted (Ben)
Ben, on docs/backlog.md: "Seems there is a lot of stuff that u need to action. Unless u r not sure pls work on them." Recorded as acceptance of the **suggested answers** in backlog §5.1, §5.2 and §5.3, and of the session-picker decisions (imported sessions take their type from the FitNotes Category; Up next without a routine rotation = the longest gap). Notable consequences:
- Coach may propose structural changes (swap/add/remove/reorder) as Apply cards, only when Ben asks or something changed (ADR 0020 §3), and may log or correct a set from chat with Undo.
- Mid-workout swap applies at once with Undo (B3); Undo replaces the confirm alert for deleting a logged set (copy D4).
- Return-to-load rules R1–R6 approved, with the break threshold at **14 days** as suggested in §5.1 (the 21-day alternative from return-to-load.md is not taken).
- Goals & schedule design and the open-decisions §B bulk defaults (D13) approved; weekly plan deferred (rotation is enough for now, B11).
- Custom exercises are Your data (B12); JSON-only export for now; `expo-network` for offline detection; FitNotes history shown as "Last (FitNotes, date)" and repeatable (B7).
- AI import: Ben's sources are FitNotes Android and FitNotes 2 (iPhone) only (Q1, files provided, not committed); no API-key fallback (Q3). The any-app AI import is therefore deferred.
- Not now: own OpenAI API key (B10), body-weight log, weekly-plan, Realtime voice, unofficial Garmin connector, long-press Start, countdown ring, display serif.
Backups: Ben confirmed every logged workout must be kept forever; "keeps 14" refers to backup file copies (each a full snapshot), which the app must word clearly, and a keep 7/14/30/All setting is added (DX9).

## 2026-10-11: Offers follow the target RPE (Ben)
Ben: "The recommendation rule to adjust should be based on what target RPE was, which should be driven by AI coach recommendation to optimise sets or override from human. Hitting 10 RPE is not bad if that was the plan."
- Every working set carries a **target RPE**: set by the coach's recommendation (D21), else the built-in rule's rep-range profile value (default-rule.ts), and **Ben can override** it (set, exercise or today). Shown on the target line ("@ RPE 8").
- **Rule T becomes deviation-based:** "harder than planned" = logged effort ≥ target + 1.5 RPE, or reps short of the range minimum by ≥ 2 while effort ≥ target; "easier than planned" = logged ≤ target − 2. A set planned at RPE 10 never triggers "too hard". The fixed no-target thresholds (D20) apply only if a set somehow has no target.
- Size of the offered change unchanged (playbook rule 5/6: ≈ 2–4% per RPE point over target, rounded to an achievable load). Offers still only apply on Adjust, with Undo (rule 3). Playbook rule T and D20 to be updated to match.

## 2026-10-11: Built-in fallback for today's sets; target RPE details (Ben)
Ben's decisions on the coach-fallback branch (build 108: the coach "didn't change sets for the set or session"), with the "Offers follow the target RPE" entry above. ADR 0006 amendment 3; `docs/design/coach-adjustments.md` CA5, CA6, §4.8; playbook rule T, rules 5/6 notes, D20.
- **CLAUDE.md rule 3's built-in fallback covers today's remaining sets** (CA5/CA6 as built). With the coach not reachable, a trigger shows the built-in rule's concrete change as an **offer** tagged `Rule`; it applies only on `Adjust`, with `Why?` and one-tap Undo. Ben's own `Too hard` / `Too easy` with no coach applies the rule's change at once (he asked). No AI call.
- **Target RPE** on every working set, as above. Ben overrides it from the exercise `⋯` menu for **this set, this exercise or today**, stored on the workout as Your data (versioned, idempotent). It wins over the coach's and survives the coach's Undo.
- **"Reps short", clarified:** any rep below a range's minimum (single-number targets: short by ≥ 2) counts, unless logged effort was clearly below target (≤ target − 1); a miss with no effort logged still counts. This replaces "short of the range minimum by ≥ 2 while effort ≥ target" in the entry above, which would not have fired on Ben's own case (3–6, 2 reps, no RPE).
- **Change size:** rule 5's 2–4% per RPE point over target, implemented at the low end (2% per point), at least 5% and at most 10% (D22), rounded down to an achievable load; else the same load with fewer reps.
- **Override from Edit set** (his "(Edit set + exercise ⋯)"): a logged working set's target RPE is set from its Edit set sheet, as a versioned, audited correction (`correct_set`) that never touches the logged values; the offer check then runs again, so a wrong "That looked hard." clears (review target-rpe B2).

## 2026-10-12: Workouts library, edit before start, fit to time (Ben)
Ben's answers to the open decisions of the workout-library branch (routines.md §A9, fit-to-time.md FT6 and §10), relayed by the PM session at the merge with main. ADR 0006 and ADR 0022 notes; specs updated.
- **WL7, coach target vs Ben's later edit:** Ben's own later edit to a saved workout wins on **set count and reps**. The coach's next-session load is used only on sets where its reps fit his range; elsewhere the built-in rule's load is used, and `Why?` says what was kept (`Kept your edit: 4 sets, 6–8 reps`). As built (`routineTemplatesWithTargets`). This narrows D21 for library workouts: the coach's small changes still apply by default, except where Ben has changed that slot since the target became active. Where the coach's load is used, its target RPE goes with it (target RPE entry, 2026-10-11).
- **FT6, fit applies at once:** choosing a time applies the fit at once, with a before → after card and one-tap Undo, for both the built-in trim and the coach's fit (Ben asked: CLAUDE.md rule 3). No Apply step on the fitted version. Coach swap or superset suggestions from a fit stay a separate `Today only` card with Apply. Resolves the brief §7 `shortenSession` "proposes" wording in favour of rule 3 for a Ben-initiated fit.
- **N6, a `FROM HISTORY` row saved under another name:** the older sessions stay under `FROM HISTORY` (conservative: no history is rewritten). Only the session saved is linked to the new workout.

## 2026-10-12: Workout split and coach goals (Ben)
- Workout Split categories: Chest (incl. triceps), Shoulders (incl. triceps), Back (incl. biceps), Legs; a chest + shoulders session = Push. Details and the rest of Ben's 12 Oct ideas in `docs/brief/ideas-2026-10-12.md` (proposal pending).
- Coach goals (strength / muscle / combination) live in a Profile coach setting, asked on first coach-driven use, re-checked every 6 weeks by default (adjustable); not asked per workout.

## 2026-10-12: Coach builder sets working weights; B6 reversed (Ben)
Ben, after trying the coach builder in build 131: "Why does the coach not estimate my working weights when building? That's the whole point, it should learn from data." He also asked to be able to add text, for the coach to ask questions when they help, and for it to reuse what he has already said.
- **Reversed: B6 / workout-builder BD6** (approved earlier: the model sends no loads; no comparable history = blank + "start light"). **Now:** in `propose_workout` the coach proposes each exercise's working load, with a short basis drawn from logged **and imported** history, e1RM estimates, related lifts and the target reps/RPE. Code converts or rejects the convention, holds the load on pain (≤ last), bounds it against history (clamp band, reject band), snaps it with `snapPlanToGym` within the equipment min/max, and records the basis as the target's reason (`Why?`). A load with no own comparable history is marked `est.`. The built-in rule is the labelled fallback (`Rule`) when a load is missing or rejected; a blank load is left only when nothing is usable. This brings the builder in line with CLAUDE.md rules 3, 4 and 6. Design: `docs/design/workout-builder.md` v2.0 (BD6, BD12, §8.5); ADR 0025 amendment 1.
- **Requested (design v2.0, details for Ben to confirm):** clarifying questions (one card, 2–4 tap answers plus free text, at most 2 per build, never about things already known); known preferences read from Profile and Memory instead of being asked again; a text field on the Build card.
- **Still open for Ben:** the bound numbers (§8.5), estimates with no reference at all (§11.2, recommended: accept as `est.`), imported history in swaps and next-session targets (§11.4), and the 12 Oct proposal decisions D6/D7 (main lift per split; coach- vs self-driven; 45-min default). The design follows the recommended defaults, marked ◇.

## 2026-10-12: AI import from any app (Ben)
- **2026-10-12 — Ben wants AI import from any app; built on the coach's ChatGPT plan route, no API-key fallback (Q3 unchanged).** Ben: "I do think having a GPT ability to just import would make the data importation much more efficient". This reopens the any-app import deferred in the 2026-10-11 backlog entry.
- **Q1 is now an open set of apps.** The import is generic, with synthetic test files shaped like Strong, Hevy, JEFIT and spreadsheets.
- **Q2 stands** (11 Oct): column names and up to 30 sample rows go to ChatGPT.
- **What the coach does:** it proposes a typed layout only. Code checks it, applies it and asks Ben about anything the file doesn't state. Import keeps its preview, idempotent commit and Undo.
- **Where it's written up:** ADR 0026 and `docs/design/ai-import-build-plan.md`.
- **Open for the PM:**
  - how times with no time zone are stored (AI6);
  - dropping the separate `importLayouts` gate (S3);
  - deferring notes and pasted text.

## 2026-10-13 — D1–D8 answers (Ben, from the mockup)

Recorded in `docs/brief/ideas-2026-10-12.md` ("Ben's D1–D8 answers"). Summary: D2 Alternative without the guide band; D3 multi-metric strength chart with a trailing average of last 3/5/10/20/custom sessions, Y axis, tap values, and a per-session KPI table below; D5 both Self options as a Settings choice; D7 splits from a Settings split choice (PPL, Chest/Legs/Shoulders/Back, custom) and main lift changeable per split in Settings; D8 gender, age, height, weight and a new lifting-experience level feed the coach's planning. D1, D4, D6 assumed as suggested pending confirmation. Not yet built (usage limited).

## 2026-10-13: Build from chat: offer the tool, force only on an explicit ask (PM decision, pending Ben's confirmation)
After four review rounds on build 131 (`docs/reviews/coach-chat-fixes-r4.md`), widening regex phrase-matching kept adding false positives: a sore-shoulder question made a draft (r4 B1), and history answers were hidden (r4 B2). PM decision, **pending Ben's confirmation**; `docs/design/workout-builder.md` §8.2 amended to match.
- **`propose_workout` is offered on every general (Today) coach turn when Ben has a gym** (or typical equipment). The tool description and prompt say: use it only when Ben asks for a workout or session, or agrees to put a session described earlier in the thread into the app; never for pain, advice, history or multi-week plans. It still only makes an `open` draft that Ben must tap Start or Save on (BD12, BD15).
- **Forced (text answer held, then the call named) only on an unambiguous build request in Ben's own words** ("build / make / plan me a … workout / session", or a change to the coach draft in context), with **no pain word** (`classifyPainMention` is `none`) and **no multi-week scope**. Follow-ups ("yes add it") get the build instructions but are never forced. The broad "give / make me something … today" trigger is removed.
- **The "workout claimed but not built" backstop** hides only explicit claims that a workout, draft or session was built, added or saved in the app. Short done-claims ("On it!", "It's saved", "I've set it up") count only when a build is in play that turn. With the tool offered, a false claim is just dropped; without it, it is replaced once by "Want me to build it in the app?".
- **Every build prompt says multi-week programmes and weekly plans aren't available yet.**
- **Cost:** the build context and tool definition now go with every general turn with a gym. The usable-exercise list is capped at 60 when the tool is only offered, and at 200 when a build is in play. Measured: about 2.7k extra input tokens per general turn (the 60-entry list about 1.8k at roughly 120 characters per entry, the tool schema about 600, the offered instructions about 300).


## 2026-10-14: Mid-workout coach: today's tools on every live turn, rename, FitNotes history as a basis (PM decision, pending Ben's confirmation)
Build 151: in a live workout Ben asked "can you repopulate the weights based on my maximum working weight recently?". The regex request classifier didn't recognise the wording, so `adjust_pending_sets` was withheld and the coach said it had no tool for it. It also told him his imported bench history "isn't a verified like-for-like basis". In the same thread, "Change name of workout to …" had no tool at all. This follows the 13 Oct "Build from chat" pattern. PM decision, **pending Ben's confirmation**:
- **Today's tools are offered on every live-workout turn, never forced**: `adjust_pending_sets`, `rename_workout` and, when the context carries the list of exercises that can be added, `add_exercise_today` (review S5). The prompt lists them, says they change today only, and tells the coach never to say it lacks a tool for them. A "no tool for that" sentence is hidden anyway and replaced by `Want me to adjust?` with the Adjust offer (review S3).
- **Rule 3 is still decided by code, per call** (`todayChangeAsked`). The call applies at once with a card and one-tap Undo when Ben asked: a chip, an accepted offer, a classifier hit, or any message in the live workout about loads or sets ("weights", "sets", "reps", "load", "kg"/"lb", "heavier", "lighter", "target", "repopulate", "recalculate", "based on"). Singular "set" alone ("set 2 felt good") and holds ("keep the weights as they are") don't count. Questions for information ("what weight did I do last week?", "how many sets left?") don't count (review S6). Words scoped to a later session or the plan ("make bench heavier next time", "from now on", "routine", "template", "every push day"), with no "today" in them, never apply to today: the set or add call is refused, not offered (reviews B2, B1). A rename needs rename words, and a rename claimed in the reply without a saved rename is hidden (review S2). An accepted offer applies `adjust_pending_sets` only (review S1). **When Ben didn't ask, the call is never run**: the turn becomes the `adjust_today` offer, and the thread shows `Adjust` on the coach's last message. Ben's `Adjust` tap or "yes" then applies it with Undo.
- Guardrails are unchanged. Loads are snapped to the gym's equipment and capped at its min/max, pain holds apply, done sets are never touched, op IDs are idempotent and stale versions are refused.
- **`rename_workout`** renames the live workout through its own `rename_session` command, versioned, with Undo back to the previous name. As before (audit B1), an open-ended workout in progress can't be named until Finish, and the coach shows that refusal. Renaming today's plan before it starts is not built. New schema migration 17 adds the kind to `coach_actions`.
- **FitNotes history counts as a basis for loads** (B7). The history read labels FitNotes workouts as Ben's own history (equipment not recorded), usable for loads, and the app fits every load to today's equipment. Tool descriptions no longer say imported workouts are "never compared". The overview's up/down trend still compares app sets on the same equipment only.
- **Trade-off:** the broad wording test means a question like "should I drop the weight?" counts as asking, so a change the coach makes in reply applies at once (with Undo) rather than being offered first.
- **Cost:** the three tool schemas and the live-workout instructions now go with every live-workout turn. Measured at about 6.3k characters, roughly 1.6k input tokens, less on turns that already had them. The addable-exercise list is still sent only when Ben's words might add an exercise.

## 2026-10-18: Weight on bodyweight exercises (PM decision, pending Ben's confirmation)
Ben (build 156): "How can I change it so I can make a body weight eg lower back extensions to be including weight". A `+ Weight` / `Bodyweight` control on the set card and Edit set switches a bodyweight exercise to added weight for the rest of today (new `set_load_mode` command, versioned, idempotent; logged sets keep what they were logged as). The workout editor's `Add weight` chip saves it on the workout. Sets record the added mass only (`added`, shown `BW + 10 kg`, no 1RM). Steps and targets use the gym's own dumbbells and plates in Ben's unit (one or more items, never past the heaviest single item). No migration. Open for Ben: whether plates and dumbbells may combine; the coach can change reps but not the added load.
## 2026-10-18: Today shows Recent; Up next by least recently trained split day (PM decision, pending Ben)
Ben's feedback on Today (real iPhone, 18 Oct): he can't quickly see previous sessions; the lift card summarises one set for no clear reason; the Sessions rows repeat `Change`; Pull was Up next the day after he trained back; and Up next was a 20-minute workout. PM decision, **pending Ben's confirmation**:
- **Today: one `Recent` section** replaces This week (the dots), the lift card and the Sessions rows under Start. It lists the last 5 finished workouts (in the app, coach-built, empty and imported alike), newest first: name (stored, else the derived title), short day (`Yesterday`, `Sat`, `12 Oct`) and set count. A tap opens the past workout as Past workouts does. `Change` stays the way to pick another session, on the Up next and Done today labels; Done today also keeps `Start next session` whenever there is an Up next (review B1). `Past workouts` stays on the Up next card. The `Your workouts` rows remain only as the fallback when the session list can't be read.
- **Up next by split day.** Root cause: Up next picked by session *name* with the longest gap, and unnamed workouts (most coach-built and empty ones) weren't counted, so yesterday's back session didn't stop Pull. Now, unless the last workout came from a routine *and* Ben has set no split, Up next is the day of Ben's split (Profile; Push/Pull/Legs until he sets one) trained least recently in the last 42 days, counting every finished workout by the muscles of the exercises done (a day counts when it is the workout's main day or got a third of its working sets). Never a day the last workout trained unless it is the only one. It plans that day from a routine with the day's name, else the newest full workout that was mainly that day, whatever its name, so targets come from the latest sets (review B2; a saved routine's workout plans that routine). The card is called what that workout is called (its name, else the derived title), the same as the started workout and Recent. When no due day has a workout in the window, the longest-gap rule applies but passes over types that trained the day just done while another is left. The Build card's preselected day and the coach's `Up next` now match Today's.
- **No 20-minute Up next by default.** Root cause: a coach-built workout is stored with its draft name, `Pull · 20 min`, so it became its own session type; Up next then copied that short plan (the next session copies only the sets done), and the estimate said about 20 min. Now a source that was cut short (a quarter or more of its working sets skipped or not logged) or a coach build shorter than Ben's Profile session length is used only when nothing fuller trained that day; a cut-short source is planned whole (its skipped and unlogged working sets at their targets), so its `about N min` is the full plan's; and a coach build's `· N min` is dropped from the Up next and overview title and from the next session's name. The root cause is from reading the code and tests, not yet checked against Ben's data. **For Ben:** Up next is never stretched to fill the Profile session length, because adding exercises is a structural change (rule 3, the coach's proposal). Alternative: show the honest estimate and offer `Build with coach` when it is well under the length. Also for Ben: the 42-day window, the one-third share for a day to count and the 25% cut-short threshold are PM picks.

## 2026-10-18: Coach v3: the model reads what Ben meant, code checks it (Ben)
After build 156, Ben reported two problems: "make it 40" left a hotel-gym shoulder draft at `Workout · 60 min · Main gym`, and "Working set" (his answer to the coach's question after `Too easy`) changed nothing. Ben approved the fix on 18 Oct. The details are in ADR 0027. Built (slices 1–6, scripted model only, not yet on the iPhone):
- **Who asked is the model's call, checked by code.** Today-changes carry `benAsked` and a quote of Ben's words. The change applies with Undo when the quote is in his message. The word lists are now only the fallback. Unprompted changes are still offered. Later-session words still veto.
- **The coach sees the last logged set** (warm-up or working, load, reps, RPE). `Too easy` is about the last working set, and the coach never asks which set. After warm-ups only, it offers.
- **Builds take length, focus and gym from the coach's call.** A length Ben states outright, or a single bare number he says, wins. The gym must be one he has saved, and the draft is checked at that gym. The card shows the draft's own gym.
- **The add-exercise list goes on every live turn** (60 entries at most).
- **One tool for today's workout** (`edit_today`): swaps, adds, removals, moves, set counts and targets as one change with one Undo. An unasked edit is saved as an offer that `Adjust` applies exactly.
- **The coach reads Ben's history**: records (e1RM labelled an estimate), recent workouts, any saved gym's equipment. At most 4 reads a turn.
- **Numbers in replies are allowed when checked** against Ben's data, tool results and his words. Unchecked sentences are hidden. Build messages may be up to 600 characters.
- **Thinking effort per turn**: builds high, mid-workout low, otherwise medium. Mid-workout the coach can ask to think harder once a turn. Settings has an optional lighter `Mid-workout` model from his plan's list; the default is the coach's model.

## 2026-10-19: Cardio with a timer and distance (Ben approved 19 Oct; details PM decision, pending Ben)
Ben: "Can we also add options to add things like rowing machine or bike eg something cardio focussed with a timer and distance". **Ben approved 19 Oct:**
- **Cardio sets record time and distance**, both optional but at least one: `20:00 · 4,800 m`. A new `cardio` measurement; the rowing machine, ski erg, treadmill run (were distance) and air bike (was timed) become cardio, history included.
- **A start/stop timer on the set**: `Start`, then ✓ logs the time on the timer with the distance typed from the machine; `Stop` puts the time in the field first. It counts up from the stored start (the work interval), so a force-close loses nothing. In the table row and the focus card.
- **Pace shown automatically**: `/500 m` on the rower and ski erg, `/km` on everything else. Never estimated: shown only with both a time and a distance.
- **More machines**: Exercise bike, Cross trainer, Stair climber, Incline walk (treadmill).
- **A Cardio filter**: the Library's Equipment filter, and a `Cardio` chip in Add exercise.
- **Targets repeat last time**: next time's target is last time's time and distance; the built-in rule never adds load or reps to cardio.
- **The coach can add cardio** to today's workout (`edit_today` add) and to builds (`propose_workout`), with `workSeconds` and an optional `distanceMetres`.
- **Progress**: cardio is kept out of Est. 1RM, volume and muscle set counts; its history shows time, distance and pace (`20:00 · 4,800 m · 2:05 /500 m`), with total distance, best distance and total time.
- No calories (no reliable data, rule 6).

**PM decisions, pending Ben:**
- **Migration 20 moves the four machines' history to cardio** so one exercise keeps one history. No set's values change (rule 2): an old rowing set reads `2,000 m`, an old air-bike set `10:00`. Older backups convert when restored.
- **Cardio machines need no gym item.** Gym profiles don't list cardio machines, so the picker and the coach offer them at any gym. A hotel gym without a rower isn't known to the app.
- **Defaults**: a new cardio slot or coach add is one 10-minute set. A coach build without a time uses 10:00, and builds cap cardio at 2 h. Time is typed in minutes (`20` or `20.5`). Steps are 1 minute and 100 m. The timer stops itself at 4 h (the most a set's time holds).
- **While the timer runs**, the lock screen shows `Since 18:20` and no countdown. No "Time" notification fires. A count-up Live Activity needs native work and isn't built.
- **The four new machines are basic catalogue entries** like the other cardio machines, with no cues, safety notes or guide. Rich entries need sourced research (`exercise-researcher`).
- **FitNotes cardio rows are still skipped** on import (P-I4). Importing them as cardio is a later step.
