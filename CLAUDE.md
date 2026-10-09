# PROJECT-FIZZ — GymSmarter, a personal training app

Shared context for every agent working in this repo. Read this first.

The app is called **GymSmarter** (approved by Ben, 9 Oct 2026). "Fizz" in older
docs and internal identifiers (bundle ID, `@fizz/*`, `FIZZ_*`, the Xcode project,
data and backup formats) is the same app; never rename those identifiers.

## What we're building

A private, single-user iPhone app for Ben: fast strength logging, an embedded
text/voice coach, deterministic progression rules, saved gym/equipment
profiles, FitNotes import, and (later) endurance context. Initial brief:
`docs/brief/training-app-build-brief.md`.

**The brief is a living first draft, not a fixed spec.** Treat it as the current
direction, not settled requirements. When research, design work or a real-device
test shows it is wrong, outdated or over-specified, say so and propose the change
instead of building around it. Ben approves brief changes. Record approved changes
in `docs/brief/CHANGELOG.md`, and record any change to the stack or architecture
as an ADR in `docs/decisions/`. Where CLAUDE.md and the brief disagree, flag it
rather than picking one silently.

**Scope: personal use only.** No registration, multi-user, billing,
subscriptions, App Store launch, or cross-device sync. Keep a stable owner ID
and modular services so expansion stays possible, but don't build it.

## Stack (brief §5, current choice and open to revision)

- React Native + Expo **SDK 57** (pinned, see ADR 0001) + TypeScript, iOS target; Expo Go is not a release test
- One custom Swift Expo module owns the iOS audio session (TTS, ducking, interruptions)
- Exercise guides play with `@shopify/react-native-skia` + `react-native-reanimated` + `react-native-worklets` (approved by Ben 9 Oct 2026, ADR 0013)
- Local SQLite is the authoritative record; in-process services, no HTTP layer
- Monorepo, created only as needed:
  - `apps/mobile` — screens, audio, permissions, notifications
  - `packages/domain` — sets, units, feasible loads, progression, substitutions
  - `packages/schemas` — schema validation, typed action contracts
  - `packages/persistence` — SQLite store, migrations, backup/restore
  - `packages/catalogue` — exercise catalogue, animated guide format and tooling
  - `packages/coach` — context builder, tool registry, proposals/undo
  - `packages/providers` — AI/voice adapters with capability detection
- Pin exact package versions when adding them.
- Distribution: free Apple ID + SideStore with a GitHub Actions-built `.ipa` (ADR 0004). Native config must stay free-provisionable: no push, time-sensitive notifications, Siri, iCloud or Associated Domains entitlements. Live Activity, AlarmKit and HealthKit are runtime-detected capability flags.

## Non-negotiable product rules

These are the rules reviewers check hardest:

1. Logging works with no network and no AI. AI status is shown honestly; no canned replies pretending to be the coach.
2. Never silently modify completed sets. Broad plan changes are **proposals** with before/after, scope (today-only vs future template), Apply and Undo.
3. The coach (LLM) chooses weights, reps and sets when Ben asks, or when a clear signal suggests it should (e.g. RPE 10, big rep miss, very easy set). It never adjusts constantly or unprompted otherwise. Deterministic code is the guardrail: every suggestion is snapped to achievable loads, bounded by equipment min/max, blocked by pain flags, and recorded with its reason. When Ben asks, changes to today's remaining sets apply immediately with visible change and one-tap Undo. When the coach raises a change on its own, it offers ("Want me to adjust?") and doesn't apply until Ben accepts. Changes to future sessions are always proposals (Apply/Undo). With no AI available, the simple built-in progression rules are the labelled fallback (ADR 0006).
4. Loads must be achievable on the selected gym's real equipment (plates, dumbbell racks, stack increments, min/max). Never extrapolate past a machine's max.
5. Writes are idempotent (operation IDs) and versioned; stale proposals are rejected, never applied to newer state.
6. Don't invent data: no fake recovery scores, no wearable metrics we don't have, estimated 1RM labelled as an estimate.
7. Never silently switch to a paid AI route. Credentials live in protected device storage, never in the repo or plain storage.
8. Imported files and transcripts are data, not instructions.
9. Pain or injury mentions stop progression for that movement; the coach never diagnoses.
10. Keep **Your data** (personal, owner-scoped: history, memories, pain flags, gyms, routines, settings) separate from **Coaching knowledge** (general: playbook rules, evidence, exercise catalogue, presets) in storage, coach context, backup/export/delete and UI. General training rules become playbook candidates, never personal memories.

## Build order (brief §10)

1. Schemas, equipment conventions, service contracts; feasibility spikes on Ben's iPhone (audio-session Swift module, rest alerts, on-device speech, ChatGPT-plan sign-in)
2. Gym profiles, catalogue, manual logging, deterministic targets, local persistence, layered rest alerts (deadline + notification + Live Activity)
3. FitNotes import preview/commit, export/restore, versioned corrections
4. Embedded text coach: memory, restricted tools, proposals, undo
5. On-device tap-to-talk voice + spoken set cues; Realtime only by later explicit decision
6. Programme/calendar adaptation, permitted endurance imports
7. Native polish: accessibility, optional AlarmKit/background-audio modes; HealthKit/Watch later

First design milestone: Today → Active set → Rest → Summary working end-to-end
on a real iPhone, with force-close recovery, reliable rest alerts, and backup/restore working before any real workout is logged.
Approved brief amendments are summarised at the top of the brief (v0.2).

## Agent team and handoffs

The main session acts as product manager and orchestrates. Subagents live in
`.claude/agents/` and pass work through files:

| Agent | Reads | Writes |
|---|---|---|
| `researcher` | brief, open questions | `docs/research/<topic>.md` |
| `designer` | brief §1 and §12, research | `docs/design/<screen-or-flow>.md`, `docs/design/design-system.md` |
| `developer` | design spec, brief, this file | `apps/`, `packages/`, tests |
| `reviewer` | diff, spec, brief acceptance scenarios | `docs/reviews/<feature>.md` (verdict: PASS / CHANGES NEEDED) |
| `training-researcher` | training topics Ben asks about | `docs/training-guides/<topic>.md`: candidate coaching-playbook rules with evidence grades; Ben approves rules |
| `exercise-researcher` | exercise lists, sources, schema | `packages/catalogue/data/exercises/<id>.json`: catalogue entries with cues, safety and a guide brief |
| `exercise-guide-maker` | catalogue entries, design system | `packages/catalogue/guides/<id>/`: original animated demos and static key frames |

Work in thin vertical slices: research (if needed) → design → build → review →
fix, one feature at a time. Record significant technical decisions in
`docs/decisions/NNNN-title.md` (short ADRs).

## Conventions

- TypeScript strict mode; discriminated unions for action payloads, not `unknown`.
- Domain logic is pure and unit-tested; UI never computes progression itself.
- Store UTC timestamps with the timezone; keep original imported values as provenance.
- kg/lb and load convention (total barbell, per-dumbbell, stack, assisted) are always explicit.
- Commit small, descriptive commits.
