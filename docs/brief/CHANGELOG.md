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
