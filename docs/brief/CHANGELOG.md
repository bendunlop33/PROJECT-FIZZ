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
