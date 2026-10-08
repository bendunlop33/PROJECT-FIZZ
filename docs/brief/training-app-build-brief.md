# Training app: competitor findings and build brief

Prepared and extended 8 October 2026. Research and implementation specification; no app has been built or connected to accounts. Findings reflect public documentation, not hands-on testing. Proposed advantages are hypotheses to validate, not proven superior training outcomes. Sections below define proposed application functions, not existing product APIs.

> **Brief v0.2: approved amendments (8 October 2026).** These override the text below where they conflict. Details: `docs/brief/CHANGELOG.md`.
> - Rest alerts (persisted deadline, local notification, Live Activity countdown, optional AlarmKit loud mode) move into the first milestone instead of native polish.
> - The designer's workflow proposals P1–P12 (`docs/design/flow-first-milestone.md` §7) are adopted.
> - AI: one shared OpenAI Responses adapter for the ChatGPT-plan and personal-key routes. ChatGPT-plan use on iPhone is unproven until the sign-in test passes. Claude subscriptions can't be used; Claude means a separately billed API key.
> - Voice: the first release is on-device (Apple speech recognition plus spoken replies). `parseSpokenSet` is a deterministic parser in `packages/domain`. Realtime/GPT-Live becomes a later, explicit decision.
> - Platform: stay on React Native + Expo, pinned to SDK 57 (ADR 0001). A small custom Swift module owns the iOS audio session. Background spoken cues are an opt-in experiment, not a promise.
> - FitNotes: confirm which app (Android original or FitNotes 2 for iOS) and use a real export. RPE is not expected as a column.
> - **Progression (v0.4):** the coach chooses weights/reps/sets, either when asked or on a clear signal (e.g. RPE 10), never constantly. Today's changes apply with Undo when Ben asked, or are offered first when the coach raises them. Future changes are proposals. Deterministic code only guards (feasible loads, equipment max, pain, completed sets) and is the labelled offline fallback. This supersedes §3's "separate the rules generating numerical targets from the model" (ADR 0006).
> - **Distribution (v0.3):** free Apple ID + SideStore with a cloud-built `.ipa`, at no cost (ADR 0004). Backup/restore, the cloud build and a capability-probe screen join the first milestone. Only free-provisionable entitlements are used.

## Product goal

Build for Ben's personal use initially: one iPhone-friendly app that combines fast strength logging, an embedded coach with text and spoken conversation, durable training history, progression rules, saved gym/equipment profiles, and endurance context. Prioritise eligible access through Ben's own ChatGPT account; a personally funded API route is optional. Import his FitNotes history. Support Garmin/Strava only through verified, permitted routes. Keep logging functional without AI access.

## Current scope: personal use only

This is a private, single-user tool, not a commercial service. This scope governs the architecture and release plan below. Keep simple stable owner IDs and modular services so a future expansion is possible, but do not implement commercial or multi-user infrastructure now.

| Build now | Defer |
| --- | --- |
| One local owner profile, personal goals and availability | Public registration, organisations, coach/client accounts and user management |
| Personal gym profiles, workout history, voice/text coach and progression | Subscription products, payments, customer billing and commercial allowances |
| Local-first data and export/restore | Mandatory cloud database, cross-device sync and background job infrastructure |
| Own-account AI feasibility and optional personal API spend cap | App-funded coaching for customers, customer usage allocation and commercial provider approval workflows |
| Private installation/development build and real-device testing | Public website marketing, App Store launch and commercial analytics |

Start with a local SQLite database as the authoritative training record. Use in-process services for logging, equipment and coaching actions. A small private backend or personally operated companion service is justified only where the chosen AI/voice integration actually requires it. Do not expose an unauthenticated endpoint simply because only one person is intended to use it.

Personal use does not automatically qualify a remotely hosted app for ChatGPT plan usage or Garmin API approval. Investigate the supported local-personal route first and retain file imports/device speech as practical initial options. A normal app sign-in screen is unnecessary unless private hosting or sync is introduced; AI authorization remains a separate step.

## What LiftTrack's Max does

Max is an embedded Premium coach. It can read saved workouts, completed history, schedules, training maxes, programmes, weekly muscle/movement summaries and the coaching profile. It can create, edit and delete workouts and set training maxes. New workouts appear as reviewable cards. A separate Create Program flow builds programmes from the profile and schedules them. Chat alone does not create programmes.

Documented constraints: neither Max nor its external AI connector logs completed sessions, changes schedules or starts/joins programmes. Max chat survives tab changes but clears when the app restarts. Coaching has a weekly limit; the reviewed guide does not state its size. Max only sees data held in LiftTrack. Its profile includes weekly endurance hours, but that is not evidence of detailed endurance/recovery ingestion. The public materials reviewed do not identify its underlying model.

Sources:
- https://lifttrackapp.com/what-max-chatgpt-and-claude-can-do/
- https://lifttrackapp.com/ask-max-your-coach-in-lifttrack/
- https://lifttrackapp.com/build-your-program-with-ai/
- https://lifttrackapp.com/set-up-your-coaching-profile/

## Competitors and lessons

| Product | Documented strength | Lesson for our design / question to test |
| --- | --- | --- |
| LiftTrack / Max | Embedded conversation, structured workout changes, programme generation and Garmin strength workflow | Preserve structured review. Improve chat continuity, live logging and scheduling. Test active-session visibility. |
| Fitbod | Session generation from history, equipment, goals, duration, performance and estimated muscle recovery | Combine generated sessions with continuity of a chosen plan. Explain recovery as an estimate. Do not claim fatigue context is unique. |
| JuggernautAI | Strength programming and adjustment at set, day, week and block level | Same-session autoregulation already exists. Need good logging and interpretable decision rules, not just chat. |
| RP Hypertrophy | Volume/load/repetition adjustment using training feedback; hypertrophy focus | Track subjective session response and RIR while keeping input burden low. |
| Hevy + ChatGPT | Free conversational access to history and workout planning, strong logger | Basic AI planning is not sufficient differentiation. Direct Garmin connection remains a documented gap. |
| Liftosaur | Explicit progression logic and external AI tools; account-related AI features paid | Keep numerical progression deterministic, inspectable and editable. |
| Athletica | Markets combined endurance/strength load, adaptive scheduling and conversational coaching, including HYROX | Multisport AI coaching is already offered. Validate the depth of gym set tracking and simultaneous goals. |

Sources:
- https://help.fitbod.me/hc/en-us/articles/360004429814-How-Fitbod-Creates-Your-Workout
- https://www.juggernautai.app/about
- https://help.rpstrength.com/hc/en-us/articles/32600173777815-How-does-the-app-determine-when-to-add-weight-reps-and-sets
- https://www.hevyapp.com/features/hevy-chatgpt/
- https://help.hevyapp.com/hc/en-us/articles/35361029194647-Hevy-and-Garmin-Integration-Update-Why-It-s-Not-Possible-Yet
- https://www.liftosaur.com/features/chatgpt-claude-and-ai
- https://www.athletica.ai/sports/hyrox

## Proposed advantage

Make the coach useful inside the active workout, with the exact completed sets, pending sets and the ongoing plan available automatically. Combine this with durable, user-editable coaching memory, reversible plan changes, and endurance context when genuinely available. The intended benefit is less repeated explanation and less manual transcription, not an unverified claim of superior physiological modelling.

## First release

### 1. Workout logging

- Start from a routine or empty session. Display previous comparable session beside each exercise.
- Log weight, reps, optional RPE/RIR, set type, rest and completion time.
- Distinguish warm-up, normal, top, back-off and drop sets.
- Support supersets, custom exercises, kg/lb and configurable plate increments.
- Show planned and performed values separately. Preserve edits and undo.
- Keep local logging available through brief connectivity loss; queue sync and resolve conflicts without silently losing sets.

### 2. Embedded coach

- Persistent conversation across app restarts; editable saved goals/preferences with provenance and dates.
- Read active-session state, relevant history and the current training block before answering.
- Parse natural language into a structured candidate set. Resolve uncertainty such as ambiguous RPE/reps rather than guessing.
- Produce short coaching replies with structured actions: log set, alter pending sets, swap exercise, shorten session, update next session, reschedule.
- Show before/after changes, distinguish today-only from future-template changes, and offer undo.
- Never silently modify completed sets. An explicit logging command can save an unambiguous parsed set with immediate undo; broad programme changes need review.
- Display unavailable data honestly: no imported ride means no claim about ride fatigue; historical shoulder work is evidence of exposure, not proof of fatigue.

### 3. Progression engine

- User chooses strength, muscle gain or maintenance focus; define primary and secondary priorities.
- Begin with explicit rules for double progression and top-set/back-off routines. Progress only when chosen rep and effort criteria are met.
- Separate the rules generating numerical targets from the model explaining or proposing modifications.
- Round loads to available equipment; never extrapolate a machine maximum beyond its capacity.
- Treat one poor session differently from a repeated trend. Retain original programme targets alongside temporary changes.
- Label estimated 1RM as an estimate and compare like-for-like movements, units and set conditions.
- Do not collapse endurance fatigue and lifting tonnage into one supposedly equivalent score.

### 4. Programme and weekly plan

- Support a repeatable plan, variable availability, missed sessions and exercise substitutions.
- Include time remaining, preferred session length, equipment and optional symptom/soreness notes.
- Reschedule from chat with a review of affected sessions. Explain trade-offs when protecting a key endurance workout conflicts with lifting goals.
- Summarise weekly work, consistency and progression; track warm-ups separately from working volume.

### 5. Data foundation

- Import FitNotes CSV using a real export to validate its schema, units, RPE fields and exercise naming.
- Preview mapped data and flag uncertain exercise matches before committing. Retain original source fields.
- Detect duplicate imports and overlapping device activities.
- Export workouts, plans and coaching decisions in portable formats; offer backup and deletion.
- Keep account-owned data separate and private. Hosted app API secrets stay on the server; an approved local own-account integration stores its OAuth credentials in protected device storage. Never place renewable credentials in browser storage or repository files.

## Connections and platform constraints

Garmin: direct APIs require approval; access to specific metrics must be confirmed. An existing third-party integration does not grant our new app access. FIT/CSV import provides a first-release path without pretending live sync is connected.

Strava: the standard API policy prohibits using API data or derivatives in external AI applications. Its first-party MCP has a personal-use exception for subscribers. Investigate that route before implementation; do not assume our hosted app is eligible. Do not route restricted data through another platform as a workaround.

Apple Health: Garmin can share certain data to Apple Health, subject to device/settings support. Native HealthKit access needs an iOS app or native bridge; a browser-only app cannot read it. Do not promise Garmin HRV, Body Battery or Training Readiness via this route without confirming each field.

Platform recommendation after adding voice and saved gyms: target a native iOS experience, with shared TypeScript domain logic and an optional web companion. A web prototype can validate logging, imports and coaching before native investment, but must not be presented as supporting HealthKit, dependable background audio or watch integration. Mark integrations pending until a real end-to-end connection succeeds.

Embedded LLM: prioritise eligible ChatGPT plan usage through the approved local-personal Sign in with ChatGPT flow; separately billed personal API access is optional. Identity sign-in alone does not authorize inference. Remote hosting eligibility must be verified separately; personal use alone does not prove qualification. No existing ChatGPT conversations or memory are imported by this flow. Enable a live supported model before calling the coach complete. A disconnected state must be visible and cannot be disguised with canned replies. Detailed personal spending and voice separation follows below.

Sources:
- https://developer.garmin.com/gc-developer-program/program-faq/
- https://www.strava.com/legal/api_policy
- https://support.garmin.com/en-NZ/?faq=lK5FPB9iPF5PXFkIpFlFPA&productID=125677

## Validation before claiming it is better

Run matched scenarios against our version and, when account access is available, the competing products. Evaluate relevance, accuracy, logging friction, transparent reasoning and whether proposed actions are correctly applied. No paid subscriptions or account sign-ups have been made.

1. Log bench 115 kg x 4, RPE 10. Coach recognises the hard set and offers an appropriate reviewable adjustment to remaining sets.
2. A shoulder session is in the history two days earlier. Coach uses it without needing another prompt, but does not state it definitely caused fatigue.
3. A planned long run follows tomorrow. Coach shows the relevant scheduling trade-off rather than casually overwriting it.
4. User has 20 minutes left. Preserve the highest-priority work and update realistic remaining time.
5. User corrects a set from 100 x 8 to 95 x 8. History, analysis and subsequent recommendations use the correction.
6. User imports the same file twice. No duplicated sessions; original import preserved.
7. App restarts. Session and relevant coaching memory survive.
8. Network/model is unavailable. Logging still works and AI status is honest.
9. No wearable recovery data is present. Coach does not invent it.
10. User has pain during a movement. Stop progression for that movement and distinguish symptoms from ordinary effort; do not diagnose an injury.

## Initial research release order (expanded implementation order below)

1. Logger, FitNotes import, history, explicit progression rules, durable records.
2. Live embedded coach with structured actions, persistent memory and undo; validate matched scenarios.
3. Combined weekly planning and verified endurance imports/connections.
4. Native iOS/HealthKit/watch work only where it improves the proven core experience.

Defer social feeds, nutrition photo analysis, automatic form scoring, unvalidated injury predictions and large exercise-media libraries.

## 1. Product screens and navigation

Keep three main tabs: Today, Progress and Profile. Open routines and the weekly plan from Today. Open the coach as a sheet from a consistent Ask/Talk control, with the current page's context attached. The active workout is a dedicated screen with a collapsible coach/voice panel; logging must not require leaving it. Section 12 specifies the page layouts and guided-set behaviour.

| Screen | Required controls and behaviour |
| --- | --- |
| First-run setup | Goals and priorities, training experience, weekly availability, preferred session length, units, first gym, optional limitations. AI connection can be skipped. |
| Today | Today's planned sessions, current gym, quick readiness check, Start/Resume workout, reschedule and shorter-session options. |
| Routines and plan, opened from Today | Routines, programme calendar, exercise search and empty workout. Active session shows planned versus completed sets, previous comparable performance and rest timer. |
| Coach sheet | Persistent conversations, text entry, Talk button, linked session context, reviewable change cards and saved-memory controls. Expand for a longer conversation. |
| Progress | Exercise trends, estimated strength, working-set volume, adherence and programme reviews; optional endurance views with source labels. |
| Profile | Gyms/equipment, goals, schedule, voice settings, AI connection/usage, import/export, account and deletion. |
| Gym editor | Add/edit equipment, units and load conventions; select default gym, duplicate a gym and create a temporary travel setup. |
| Change review | Before/after differences, affected session/programme, today-only versus future scope, Apply and Undo. |

Onboarding should be short enough to start logging immediately. Richer profile questions can follow when they affect a decision. Do not prefill historical personal measurements or goals as if freshly confirmed.

## 2. AI access: own account first, personal API fallback

Keep the local owner profile, AI provider identity and inference payment separate. Ben can use the logger without connecting any AI account. Workout records remain in the app's personal database when the AI provider changes. Do not build customer account or billing screens.

| Mode | How it works | Implementation condition |
| --- | --- | --- |
| Own ChatGPT plan | User authorizes eligible plan usage through Sign in with ChatGPT; app supplies its own training context and tools | Verify client/hosting eligibility, granted inference scopes and selected-account entitlement. Do not assume free accounts qualify. |
| Personal API fallback | Ben explicitly enables separately billed provider API access for text and/or voice | Securely store his credential in protected local storage or a private backend secret store; show a personal spend cap and route choice. |
| External assistant | User connects the app's permitted tools to ChatGPT or another assistant | Separate surface; an optional companion to embedded coaching. |
| No AI | Manual logger and deterministic progression work normally | Offer this at onboarding and when entitlement/network fails. |

Official OpenAI documentation currently supports eligible ChatGPT plan usage for open-source/local projects and selected private clients; paid or remotely hosted products must pursue the appropriate partner route. An open-source label alone is not proof that a hosted service is eligible. Sign-in does not import ChatGPT chats, memory or API keys.

The documented preview supports eligible Responses requests with restrictions, including app-managed history and no audio/video input or transcription API through this flow. Do not promise that ChatGPT account usage pays for Realtime voice, speech recognition or text-to-speech. Maintain distinct capability flags for text, speech input, speech output and live voice.

Proposed functions:

| Function | Contract |
| --- | --- |
| `getAiCapabilities(userId)` | Return verified modes, text/voice capabilities, quotas and unavailable reasons; no secrets. |
| `beginAiConnection(userId, mode)` | Create short-lived OAuth transaction where eligible; return authorization URL/state. |
| `completeAiConnection(transactionId, code)` | Validate state/PKCE and identity; verify granted scopes, bind selected account and protect tokens. |
| `resolveInferenceRoute(userId, modality)` | Choose an explicitly selected permitted route, or return a clear unavailable error. |
| `refreshAiConnection(connectionId)` | Refresh according to provider contract; isolate per-user credentials. |
| `disconnectAiConnection(connectionId)` | Revoke where supported and delete credentials; retain app workouts. |
| `checkPersonalSpendCap(requestId, estimate)` | Check/reserve a personal API budget before inference; no customer billing ledger. Estimates are not guaranteed final cost. |
| `recordPersonalApiUsage(requestId, actualUsage)` | Record observed usage once, reconcile estimates and expose personal spending history. |

Never silently switch from Ben's account to a chargeable API route. Ask him to choose another route when unavailable. Show the funding mode in coach settings; keep OAuth tokens, renewal and technical scopes out of routine workout screens. An app-funded commercial option is a future extension, not a first-release requirement.

Sources, checked 8 October 2026:
- https://developers.openai.com/siwc/quickstart
- https://developers.openai.com/siwc/token-sharing-open-source
- https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations
- https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt

## 3. Two-way voice coaching

Voice is a conversation with spoken replies and real actions. It is not merely dictation. Text and voice share the same session, conversation, action executor and coaching memory.

Examples:
- User: "Bench, one fifteen, four reps, RPE ten." App resolves the exercise and load unit, logs an unambiguous set and says, "Logged 115 kilos for four. Want me to adjust the remaining sets?"
- User: "Yes, just today." App applies the specific current proposal to pending sets, shows the changes and speaks a brief confirmation.
- User: "Actually that was 110." App identifies the most recent set, proposes or applies the explicit correction with undo, and refreshes the recommendation.
- User: "The cable machine's occupied." App treats that station as unavailable for this session and proposes a compatible substitution from the active gym.
- User: "I've only got fifteen minutes." App proposes a shorter remaining session based on priorities and elapsed time.

First release: tap-to-talk/push-to-talk, spoken answers, transcript, mute, stop and interrupt controls. An explicit optional conversation mode can stay open during rests. No ambient always-on microphone by default and no unsolicited speech during a working set. Support headphones and route changes; allow quiet text-only mode.

Voice states: idle, requesting permission, listening, processing, speaking, interrupted, reconnecting and error. Show the current state and clear recording indicator. A confirmation expires or becomes invalid if its target session changes. "Yes" only confirms the latest identified proposal, not an unrelated action from earlier chat.

Use two interchangeable implementations:

1. Turn-based baseline: device or supported speech-to-text -> common coach text pipeline -> device or supported text-to-speech. Validate device recognition and speech synthesis on target hardware; local/offline recognition is not guaranteed. The eligible own-account text route may be used after transcription, while speech services are separately funded or device-provided.
2. Optional low-latency speech-to-speech: supported Realtime provider with WebRTC, interruption handling and the same restricted application tools. The backend creates short-lived client credentials; never ship the app's standard provider key. Realtime access has its own entitlement and cost. Confirm native transport/support in a development build before promising production voice.

| Function | Contract |
| --- | --- |
| `startVoiceSession(sessionId, mode)` | Check microphone permission, audio route and capabilities; open the appropriate transport. |
| `stopVoiceSession(voiceSessionId)` | Stop capture/playback, close transport and release audio resources. |
| `transcribeUtterance(audio, locale)` | Return transcript and uncertainty/alternatives where available. Never invent a confidence value. |
| `parseSpokenSet(transcript, context)` | Extract exercise, reps, load, units and RPE/RIR; return parsed candidate or clarification. |
| `handleVoiceTurn(turnId, transcript)` | Deduplicate final transcript events and run the shared coach pipeline. |
| `speakReply(text, preferences)` | Render a short spoken response; retain full text in the conversation. |
| `interruptSpeech(voiceSessionId)` | Cancel playback, preserve committed actions and stop processing future unconfirmed changes. |
| `createVoiceCredential(userId, sessionId)` | If required by the selected voice transport, authorize the personal connection, check spending and issue short-lived provider credentials. |
| `confirmProposal(proposalId, sessionVersion)` | Confirm a named valid proposal by voice or tap; ambiguous/stale approvals do not apply. |

Treat numeric accuracy as critical: "115" versus "150", kg versus lb, total barbell load versus plates, and dumbbell weight per hand. Ask one short clarification when the target or number is unclear. Do not announce success until the operation has committed locally or on the authoritative server. Say "saved on your phone; sync pending" when appropriate.

Raw audio is not stored by the app by default. Explain which service processes speech and any provider retention separately. Keep transcripts and durable notes under app retention/deletion controls. Provisional usability target: simple turn-based replies begin within roughly three seconds under good connectivity; measure median and tail latency on real devices, not a guaranteed product claim.

Sources:
- https://developers.openai.com/api/docs/guides/voice-webrtc
- https://developers.openai.com/api/docs/guides/realtime-conversations

## 4. Saved gyms and equipment personalisation

Users can save multiple locations: regular gym, work gym, home and travel. Each session records its gym and equipment snapshot. The coach uses the selected gym automatically; changing location revalidates pending exercises and loads, without rewriting historical sessions.

Capture equipment types and actual instances. A gym with "dumbbells" is not sufficient to prescribe 37.5 kg if its rack stops at 30 kg. Offer presets as draft equipment lists, then let the user confirm and customise them.

| Equipment field | Purpose |
| --- | --- |
| Name, type, optional make/model/station | Distinguish machines and duplicate stations. |
| Supported movement/exercise tags | Identify compatible exercises and alternatives. |
| Units and load convention | Total barbell load, per-dumbbell weight, stack reading, added plates or assistance. |
| Bar mass and plate inventory | Generate achievable total loads and plate calculations; include plate pairs/counts. |
| Explicit dumbbell/stack increments | Use real selectable loads; don't assume all equipment uses 2.5 kg increments. |
| Minimum and maximum load | Bound targets; progress reps or another variable at the equipment ceiling. |
| Bench/rack/attachment availability | Account for adjustable benches, safeties, handles and station compatibility. |
| Machine resistance direction | Assisted pull-up weight means more assistance, not greater lifted resistance. |
| Permanent and temporary availability | Separate missing equipment from a busy/broken station today. |
| User notes/preferences | Preferred setup, seat position, disliked machines and permitted alternatives. |

Never convert machine labels into assumed equivalent free-weight loads. Keep separate progression history per relevant equipment instance unless the user explicitly groups equivalent stations. For unilateral exercises record per side and avoid double-counting volume. Plate-loading calculations do not prove actual resistance on sleds or lever machines.

| Function | Contract |
| --- | --- |
| `createGym(profile)` / `updateGym(id, patch)` | Save name, location label and preferences; location coordinates optional, not required. |
| `addEquipment(gymId, equipment)` | Validate load conventions, increments and inventory before saving. |
| `updateEquipment(id, patch)` | Version changes and invalidate affected future recommendations. |
| `setActiveGym(gymId, sessionId?)` | Select gym and propose any necessary changes to pending work. |
| `getEquipmentSnapshot(gymId, date)` | Return confirmed permanent setup plus session availability overrides. |
| `setTemporaryAvailability(sessionId, equipmentId, status)` | Mark busy/broken without changing the saved gym profile. |
| `getCompatibleExercises(gymId, constraints)` | Return catalogue matches compatible with equipment, preferences and recorded limitations. |
| `rankSubstitutions(exerciseId, gymId, intent)` | Rank alternatives by movement, goal, setup and history; explain differences. |
| `getAchievableLoads(equipmentId)` | Compute finite feasible loads from explicit rack/stack/plate inventory. |
| `roundToAvailableLoad(target, equipmentId, policy)` | Round to permitted load with explicit up/down/nearest policy; bound result. |
| `buildPlateSetup(totalLoad, equipmentId)` | Return achievable balanced plate pairs or a clear infeasible result. |

Optional later: upload equipment photos to draft a gym inventory. The user must confirm identification, available loads and attachments; a photograph cannot reliably establish resistance or inventory hidden from view.

## 5. Recommended implementation architecture

These are design choices for the intended app, not a claim that a project exists. Use a native-capable stack for the full voice/equipment experience; do not start with a native wrapper that cannot support required audio and background behaviours.

| Layer | Suggested implementation | Responsibility |
| --- | --- | --- |
| Mobile client | React Native with Expo development builds and TypeScript | Screens, audio, device permissions, notifications and local records. |
| Optional web client | React/TypeScript; deferred initially | Add only if needed for desktop use; not a required second client. |
| Shared domain package | TypeScript functions, schema validation and versioned rules | Sets, units, feasible loads, progression, substitutions and action contracts. |
| Local data | SQLite on mobile | Authoritative workouts, equipment, programme, conversations, action audit and import provenance. |
| Application services | In-process TypeScript interfaces | Execute logging, imports, progression and proposals locally; no HTTP requirement. |
| Optional private API/companion | Small TypeScript service only if the integration needs it | Eligible AI authorization or voice credentials; not a mandatory cloud copy of all workouts. |
| Backup | Versioned export/restore to a user-selected destination | Portable recovery of personal records; encrypted backup if credentials/private data warrant it. |
| AI adapters | Provider interface with capability detection | Eligible own-account text, optional personal API access and supported voice implementations. |
| Local jobs | Resumable local import/export tasks | Progress reporting and retry without a managed queue. |

Choose exact package versions and managed-hosting compatibility during implementation. HealthKit and native audio require appropriate native modules, permissions and real-device validation; Expo Go alone is not the release test. Build a short audio/authorization feasibility spike before committing to Realtime transport or own-account native support. If a transport requires an incompatible server feature, use a supported service rather than implying it works on the chosen host.

Suggested repository modules (mobile and core packages first; web/sync/services directories only when needed):

```text
apps/mobile
apps/web
packages/domain
packages/schemas
packages/coach
packages/providers
packages/sync
packages/catalogue
services/api
services/jobs
```

The mobile client calls shared domain services directly. The AI calls a restricted tool registry that delegates to these same services; it never gets direct SQL access, arbitrary shell execution or an unrestricted account token. Text and voice use identical mutation and undo rules. If a private remote service is added, protect its operations and use the same owner-scoped interfaces.

## 6. Data model

Use stable UUIDs generated before local writes. Records carry a stable personal owner ID, creation/update timestamps and a record version. There is one owner profile, with no user-registration table or role system required. Tombstones/sync tables are optional until cross-device sync exists. Store timestamps in UTC alongside timezone for date interpretation. Preserve original imported values/units as provenance; calculations use explicit normalized units.

| Entity | Key fields and relationships |
| --- | --- |
| `UserProfile` | User ID, timezone, units, experience, primary/secondary goals and preferred coaching style. |
| `AvailabilityRule` | User, day/time windows, session duration and effective dates. |
| `Gym` / `EquipmentInstance` | Owner, gym, equipment type, load convention, available-load list/plate inventory and version. |
| `Exercise` / `ExerciseAlias` | Catalogue ID, movement, muscles, equipment requirements, variants and source-name mappings. |
| `Routine` / `RoutineExercise` | Ordered exercises, set templates, rest, equipment constraints and progression-rule reference. |
| `Programme` / `ScheduledSession` | Versioned block, goals, planned day/time, routine and skipped/completed/rescheduled state. |
| `WorkoutSession` | Gym, equipment snapshot, programme link, start/end time, state and source. |
| `SessionExercise` / `WorkoutSet` | Exercise/equipment, order, target load/reps/effort, actual load/reps/effort, set type and status. |
| `ProgressionRule` | Versioned method, rep/effort criteria, increments and temporary versus permanent adjustments. |
| `ReadinessEntry` | User-reported sleep/soreness/energy and any sourced wearable metrics; unknown stays unknown. |
| `EnduranceActivity` | Source ID, sport, time/duration and permitted metrics; retain provenance/use constraints. |
| `Conversation` / `CoachMessage` | User, context session, input modality, transcript, message order and linked actions. |
| `CoachingMemory` | Fact/preference, source, confirmation, effective date, expiry and user edit/delete control. |
| `ActionProposal` / `ActionRecord` | Typed payload, before/after, target versions, scope, status, author and undo relationship. |
| `AiConnection` / `PersonalUsage` | Provider/mode, verified capabilities, protected credential reference and optional personal API usage/spend cap. |
| `ImportJob` / `ImportMapping` | Source checksum, preview, mapped records, uncertainties and commit state. |
| `SyncOperation` (deferred) | Introduce only for optional cross-device sync; device/operation ID, entity, base version and acknowledgement. |

Do not sum RPE and RIR as separate effort measures. If conversion is used, label the relationship as an approximation; preserve the user's original input. Retain template targets separately from session results and rejected recommendations.

## 7. Application service functions

All writes return structured success/error results and a record version. In the local app, use the current personal owner and an operation ID; any remote endpoint additionally requires authentication and ownership checks. Use transactions for multi-record changes. Reject stale proposals instead of quietly applying them to newer session state.

| Function | Inputs and behaviour |
| --- | --- |
| `startWorkout(routineId?, gymId, operationId)` | Snapshot routine and equipment; create resumable session. |
| `getActiveSession(userId)` | Return completed/pending sets, active exercise, gym and sync state. |
| `logSet(sessionId, exerciseId, values, operationId)` | Validate values/units and append one set exactly once. |
| `correctSet(setId, patch, expectedVersion)` | Preserve audit, update projections and expose undo. |
| `finishWorkout(sessionId, expectedVersion)` | Reconcile unfinished sets, calculate summary and emit completion event. |
| `startRestTimer(setId, duration)` | Save deadline, show countdown; notifications must follow OS permissions. |
| `getComparableHistory(exerciseId, equipmentId, filters)` | Return relevant prior sessions without conflating variants or machines. |
| `calculateNextTargets(history, rule, equipment)` | Deterministic next-session targets and rule explanation; insufficient data yields bounded defaults. |
| `evaluateSessionAdjustment(activeSession, effort, constraints)` | Generate candidate changes to pending sets; keep original programme target. |
| `estimateRemainingDuration(session, assumptions)` | Include sets, rest and setup; return estimate with uncertainty. |
| `shortenSession(sessionId, minutes)` | Propose priority-preserving edits, not extra rushed work. |
| `createProgramme(profile, constraints)` | Draft catalogue-valid structured programme, then validate feasibility and review. |
| `rescheduleSession(id, newTime, expectedVersion)` | Update one occurrence or explicit series; show affected training conflicts. |
| `getWeeklyTrainingSummary(userId, range)` | Working sets, adherence and trends with separate endurance metrics. |
| `previewFitNotesImport(file)` | Parse source format and produce mappings, duplicates and unresolved units/exercises. |
| `commitImport(jobId, mappingVersion, operationId)` | Commit confirmed mapping atomically or in resumable batches with per-row results. |
| `exportTrainingData(userId, format)` | Portable workouts, equipment, programmes and decisions. |
| `createBackup(destination)` / `restoreBackup(file)` | Versioned snapshot, integrity check and preview before restoring; preserve the previous local database for rollback. |
| `syncOperations(deviceId, cursor, operations)` (deferred) | Only if cross-device use is requested: validate, acknowledge once and return changes/conflicts/tombstones. |

For personal release, expose these contracts as local application methods. If a backend becomes necessary, the same services can map to `/v1/sessions`, `/sets`, `/gyms`, `/equipment`, `/programmes`, `/schedule`, `/imports`, `/coach/turns`, `/coach/proposals`, `/ai/connections` and `/voice/sessions`. Do not implement all routes pre-emptively. Schemas specify resource IDs, expected versions and operation IDs; responses contain records, proposals or actionable errors. A valid resource ID is not remote authorization.

## 8. Coach orchestration and specific tools

Use a bounded context builder: current session first, then selected gym, current programme, recent relevant workouts and confirmed preferences. Include timestamps/source and missing-data flags. Retrieve detailed older history only when needed. Rebuild context after a committed change; stale chat text must not override the database.

| Function | Role |
| --- | --- |
| `buildCoachContext(userId, sessionId, request)` | Produce authorized, relevant records and version stamps within context budget. |
| `classifyCoachIntent(input, context)` | Distinguish log/correct/question/change plan/change gym/schedule and return ambiguity. |
| `runCoachTurn(turnId, input, modality)` | Persist input, choose eligible provider, execute bounded tool loop and stream response. |
| `validateCoachProposal(proposal, context)` | Check exercise catalogue, feasible loads, current versions, scope and constraints. |
| `applyCoachProposal(id, confirmation)` | Transactionally execute reviewed changes and return actual committed result. |
| `undoAction(actionId)` | Restore affected state only when safe; otherwise return a reviewable compensating proposal. |
| `saveConfirmedMemory(memory)` | Persist explicit preference/fact with source; don't silently infer lasting goals. |
| `getDecisionEvidence(actionId)` | Return facts, rule outputs, affected records and uncertainty behind a recommendation. |

Restricted model tools: `get_active_session`, `get_recent_training`, `get_gym_equipment`, `get_programme`, `get_schedule`, `get_progression_targets`, `get_substitutions`, `log_set`, `propose_set_correction`, `propose_session_change`, `propose_reschedule`, `save_preference`. Their implementations call services above. Tool outputs are structured and clearly report committed, proposed, pending-sync or failed state. Repeated tool calls use the same operation ID.

Example proposed action contract:

```typescript
type Proposal = {
  id: string;
  kind: 'adjust_pending_sets' | 'swap_exercise' | 'reschedule_session';
  sessionId: string;
  baseVersion: number;
  scope: 'this_session' | 'future_template';
  changes: { entityId: string; before: unknown; after: unknown }[];
  reason: string;
  evidenceRefs: string[];
  status: 'proposed' | 'applied' | 'rejected' | 'expired';
};
```

Use discriminated, typed payloads in implementation rather than leaving `unknown` as the write schema. Explicit logging commands may commit with immediate undo; broad plan mutations are proposed first. Destructive changes require explicit review. Coach replies should separate fact, interpretation and action; avoid confident causal explanations unsupported by the record.

## 9. Offline behaviour, recovery and security

Commit set logging, corrections and proposals transactionally to local SQLite. Use operation IDs to prevent duplicate voice/tool writes and record revisions for safe undo. Recovery does not require a network connection. Store rest deadlines rather than expecting a JavaScript countdown to run while suspended. Provide export/restore and make the distinction between local durability and backup clear.

Cross-device sync is deferred. If added, enqueue idempotent operations, merge append-only sets by unique ID, detect competing edits and use tombstones so deleted records do not reappear. Do not implement a distributed sync system for a one-device first release.

Do not replay voice commands simply because a network request retried. Realtime reconnect creates a new transport but resumes the app conversation from committed records. Undo after another-device edits must revalidate versions. Offline manual logging stays available; unavailable network coaching is labelled accordingly.

Scope records to the personal owner. Keep credentials in protected device storage or the optional private backend secret store according to integration mode. Tool confirmations are bound to owner, proposal and version. Limit model tool access and validate every result. Imported files/transcripts are data, never trusted instructions. Keep diagnostics local/minimal by default, redact credentials and unnecessary health information, and support clearing personal data. Public service compliance/billing infrastructure is outside this release.

## 10. Build sequence and completion criteria

1. Define schemas, equipment conventions, service contracts and native audio/own-account feasibility spike. Confirm actual provider/hosting eligibility; do not block manual logging on it.
2. Implement gym profiles, catalogue filtering, manual workout logging, deterministic targets and local persistence. Validate load ceilings, plates, assisted machines and dumbbell conventions.
3. Add local import preview/commit, export/restore, integrity checks and versioned corrections. Test duplicate files, app restarts and backup recovery; defer server records and cross-device sync.
4. Add embedded text coach, persistent messages/memory, restricted tools, proposals and undo with live eligible inference.
5. Add tap-to-talk and spoken replies using the shared coach loop; then optional Realtime conversation. Validate noisy-gym numeric recognition, interruption, audio routes and repeat-message handling.
6. Add programme/calendar adaptation and permitted endurance imports. Connect live services only after real authorization and end-to-end data tests.
7. Native polish: real-device session recovery, lock-screen timers/notifications, permissions and accessibility. Watch/HealthKit are separately validated extensions.

Additional acceptance scenarios:

- Home gym has only dumbbells up to 30 kg: no unavailable dumbbell or cable prescriptions; loads are per hand.
- Switch to a hotel gym mid-session: completed sets remain intact; proposed substitutions use that equipment only.
- Machine reaches its maximum: coach offers a valid progression/substitution, not imaginary extra weight.
- Spoken "one fifteen" in a noisy gym: transcript/candidate is visible, ambiguity is resolved and one set is saved.
- Interrupt a spoken reply: playback stops promptly without deleting a committed set or applying an unconfirmed plan.
- Bluetooth disconnect/phone call/app restart: microphone and audio release correctly, session survives and voice can reconnect.
- Own-account text is eligible but voice is not: app offers supported device/speech options and explains funding before use.
- OAuth permission revoked or budget exhausted: no automatic paid fallback; logger and fixed progression remain available.
- Same spoken turn or sync operation arrives twice: exactly one set/action is committed.
- Reschedule by voice: correct local date/time, explicit affected session and no stale confirmation application.

Measure logging taps/time, parsing accuracy on realistic utterances, voice latency, session recovery, sync conflicts, recommendation feasibility and whether users understand changes. Compare against Max with matched scenarios when access is available. Calling the app "better" requires workflow evidence; training outcomes need longer-term evaluation.

## 11. Outstanding decisions and dependencies

- Own-account AI eligibility for a local personal installation; supported models, limits and optional personal voice/API spending. Commercial distribution is not being planned now.
- A representative FitNotes export to validate import semantics; do not infer its schema from screenshots.
- Actual gym inventory and user confirmation of goals/availability; start with editable defaults.
- Personal native iOS development build is the target; a private foreground prototype may validate parts of the flow, but is not a public product launch.
- Garmin approval/partner route, source-level data permissions and supported metrics.
- Native audio/HealthKit requirements and any distribution/developer-account setup.

These dependencies do not require inventing credentials or accounts. Build and test the independent logger/equipment/domain components first, expose honest unavailable states, and activate each connection only when authorized and verified.

## 12. Simple page-by-page design and guided-set experience

### Design recommendation

Build a personal training companion whose main loop is: open Today, start or resume, perform a set, log the actual result, rest, repeat, review a short summary. The screen must answer three questions immediately: what am I doing, what did I do last time, and what comes next? Use familiar workout-table patterns with an optional focused set view. Conversation supports this loop rather than becoming another required step.

Borrow proven interaction patterns, using original visual design and wording. Do not reproduce competitors' branding, assets or entire screens. The home layout below is a design recommendation for Ben's personal use, not a claim of universal customer preference.

### Research informing the design

| Evidence | Design implication |
| --- | --- |
| Hevy officially displays previous exercise performance beside current inputs and allows tapping a previous value to copy it. | Keep comparable previous results beside the current set; reuse values without retyping. Distinguish a copied target from a completed result. |
| Hevy documents automatic configurable rest timers and Live Activity showing the current exercise, next set and countdown. | Start rest from the logging action; carry the same essential information onto the lock screen where supported. |
| A recent Hevy community request asks for rest durations specific to individual sets. | Allow a top set, warm-up and back-off set to have different saved rest durations. Keep the ordinary editing flow simple. |
| Recent community requests ask for timed exercise countdowns with an audible ending, including dead hangs and planks. | Provide a separate work timer for duration exercises; a rest countdown cannot substitute for it. |
| App Store feedback for Fitbod includes praise for gym equipment profiles and requests around correcting duration and editing workouts. | Save reusable gyms; make actual results and session times easy to correct; avoid regenerating the plan when the user only edits a log. |

These are qualitative examples from selected public feedback, not a representative survey or evidence that an older reported issue still exists. Test the proposed home layout with actual personal use. Retain only widgets Ben finds useful after two weeks.

Research links:
- [Hevy previous workout values](https://www.hevyapp.com/features/track-exercises/)
- [Hevy automatic rest timer](https://www.hevyapp.com/features/workout-rest-timer/)
- [Hevy Live Activity](https://help.hevyapp.com/hc/en-us/articles/35649846517399-How-to-Use-Hevy-s-Live-Activity-on-iOS-and-Android)
- [Community request: set-specific rest](https://www.reddit.com/r/Hevy/comments/1v1tuiv/feature_request_setspecific_rest_timers/)
- [Community request: exercise timer with alarm](https://www.reddit.com/r/Hevy/comments/1uu8oy7/exercise_timer_w_alarm/)
- [Fitbod App Store reviews](https://apps.apple.com/us/app/fitbod-gym-fitness-planner/id1041517543?see-all=reviews)

### Page 1: Today — useful home summary

| Vertical order | Content and action |
| --- | --- |
| Compact header | Date and selected gym chip. Tap the gym to switch location. |
| Main card | Today's workout name, focus, estimated duration and Start workout. An unfinished workout always replaces this with Resume, current exercise and saved progress. |
| Small alternatives | Choose routine, empty workout, or reschedule. A shorter-session option appears when a plan exists. |
| Optional readiness | One tap: Normal / Tired / Sore, with optional detail. Can be skipped. Do not present an invented recovery score. |
| This week | Sessions completed versus planned, plus one pinned lift trend chosen by the user. Show unavailable data honestly. |
| Next session | One upcoming session with date; tap for the weekly plan. |
| Coach access | Ask coach / Talk, consistently placed without covering Start. |

Limit the initial screen to one primary action, one compact weekly summary and the next session. Put detailed charts in Progress. If no plan exists, show Start empty workout and Create a routine. If data is sparse, show useful actions rather than empty chart panels. Endurance sessions can appear in the plan; use confirmed imported data and source labels rather than implying live Garmin access.

### Page 2: Routine and weekly plan — prepare once

Open from Today rather than adding another tab. Show saved routines as short rows with name, exercise count and estimated time. The weekly view lists days and sessions; tapping a day allows move, skip or replace. Starting a routine makes a session snapshot so later template edits do not change the active workout.

Routine editor: exercise order, warm-up/working-set type, target load or rep range, optional effort target, and rest preset. Advanced settings stay collapsed. Duplicate last session is a useful quick-start option but produces editable targets, not falsely completed sets. Coach proposals show a compact before/after review with today-only versus future scope.

### Page 3: Active workout — the most important screen

Default to a focused card for the current exercise and set. Offer an Overview toggle with the familiar FitNotes-style table for people who prefer all sets together. Both views edit the same data and retain the same rest timer.

| Region | Content |
| --- | --- |
| Compact top bar | Workout title, elapsed time, pause/menu and voice status. |
| Exercise header | Exercise name, set 2 of 4, warm-up/working label; tap for history or technique notes. |
| Previous result | Comparable last performance with date and gym/machine identity where relevant. Example: Last: 100 kg × 8. |
| Current set | Large editable load and reps fields, explicit kg/lb and per-hand convention. Planned rep ranges are shown as targets; the result field records the actual count. |
| Primary action | A wide Log 100 kg × 8 button when those values are present. Tapping it explicitly confirms completion; it never completes automatically. |
| Optional effort | Small RPE control available before or after logging; blank is valid. Skip is easy and does not delay the rest timer. |
| Rest/next set | Persistent countdown when resting, with the next exercise, load and target visible. |
| Secondary controls | Add set, swap exercise, overview, and Ask/Talk. Finish workout sits away from Log set. |

For a normal set matching its populated values, logging requires one tap. If the result differs, edit reps/load and then log; use a numeric keypad, clear unit labels and large increment controls. Keep the primary action visible above the keyboard. Do not make users type the exercise name or weight again for repeated sets.

Voice logging is another input method: “100 kilos, eight reps, RPE eight.” The app uses the active exercise and set, shows what it heard and saves an unambiguous result once. “Done” may log the displayed values only when the user has enabled that shortcut and the active set is unambiguous; otherwise ask for the actual result. A short spoken confirmation and visible Undo follow successful saving. Manual correction must not trigger AI plan regeneration.

Support warm-ups, working sets, supersets and timed exercises in the underlying model, but expose their controls only when relevant. In a superset, move to the next member and start rest at the configured round boundary rather than blindly starting rest after every member.

### Page 4: Rest state — stay on the workout screen

Show a large countdown and the next set on the same card. Controls: +30 seconds, −30 seconds, Skip rest, and Pause. A tap on the time edits the duration. Show the resolved preset before the first set so the user can correct it once.

Resolve duration in this order: explicit set override → routine exercise/set-type preset → exercise default → global default. Display the source in the editor, not on every set. Initial editable example presets could be Warm-up 60 seconds, Standard 90 seconds and Heavy 180 seconds. These are UI examples, not an individual training prescription; Ben sets the durations he prefers.

Start the countdown immediately after the completed set commits, without waiting for AI analysis, RPE entry or network access. Changing RPE or correcting a weight must not restart rest. Timer expiry means Ready when you are; it never marks a set complete or forces the next set to start. If another set starts early, end the previous rest and cancel its pending cue. After an exercise's final set, use an optional transition timer only if configured. After the workout's final set, show Finish instead of starting an unnecessary rest.

Pause workout freezes the active rest/work timer and excludes paused time from active session duration. Backgrounding or locking the phone does not pause the session. Persist the deadline and restore it on reopening; never reset to the full preset. Use supported notifications and Live Activity for background cues. Validate background spoken audio on the actual iPhone; if unavailable, use the tested alert/haptic route rather than promising speech under all lock-screen conditions.

### Spoken set companion — predictable cues plus optional conversation

Offer three modes: Quiet, Set cues, and Conversation. Quiet uses the screen and optional vibration. Set cues speaks short local scripted prompts and does not need an LLM call. Conversation adds push-to-talk questions and spoken coach answers; optional rest-only listening is separately enabled with a visible recording indicator. No microphone is opened just to run a timer.

| Event | Example cue, using illustrative values |
| --- | --- |
| User starts the first set or requests next-set guidance | “Bench press. Set one: 100 kilos, target eight reps.” |
| Result commits | “Logged 100 kilos for eight. Rest two minutes.” |
| Optional heads-up | “Fifteen seconds left.” |
| Rest finishes | “When you're ready: 95 kilos, target eight.” |
| Plan changed and accepted | “Remaining sets updated for today.” |
| User ends workout | “Workout saved. Your summary is ready.” |

Default to completion/rest-start and rest-end cues; the heads-up and repeated set introductions are optional. Avoid announcing every countdown second, reading whole summaries aloud, or interrupting reps. Spoken targets come from the committed plan, not fresh model guesses. Say whether reps are a target or an actual result. If the next set changes during rest, cancel any old queued prompt and use the new saved values.

Respect headphones, music and audio-route changes. Briefly lower music for cues where the platform supports it, then restore it. A phone call interrupts speech without losing the session. Separate voice volume, timer sound and haptics in Profile. Do not overlap a scripted cue with a conversational reply; expire stale cues rather than replaying a backlog. Speech can be stopped immediately.

Duration exercises have a separate Start work timer button and a saved duration such as 45 seconds. Its ending cue indicates the work interval finished; saving the result requires confirmation, or an explicitly enabled and clearly explained timed-set auto-complete mode. Keep rest time, work duration and total workout duration distinct.

### Page 5: Workout summary — saved first, interpreted second

On Finish, save locally first and display a compact summary: active duration, exercises completed, working sets and one meaningful lift comparison. Show warm-ups separately. A plain Done returns to Today; Edit workout permits corrections, including forgotten end time. Retain the original timestamps and distinguish a manual correction.

Below the factual summary, an optional coach note explains one useful observation and a proposed next-session adjustment. It can load later without blocking save or exit. No unsupported personal-best claims: compare compatible exercise, equipment, load convention and set type; label estimated strength as an estimate. Any proposed future change has Apply and Undo. Provide export/share only as a secondary action for personal use.

### Page 6: Progress — answer a specific question

Default to weekly consistency and three user-pinned exercise trends. Tapping a lift opens its dated history and selectable weight/reps or estimated-strength chart. Filters include gym/equipment and date range so unlike machines are not merged casually. Calendar opens saved workouts for correction. Add volume, muscle-group breakdown and endurance detail only when useful data exists; explanations and source labels remain accessible.

A weekly summary can say what was completed, what changed and what is planned next. Keep it to three factual observations and one optional recommendation. The Today page receives only its compact version. Do not turn this into an exhaustive daily analytics dashboard.

### Page 7: Profile and gym editor — useful detail, out of the logging flow

Profile contains goals/schedule, gyms, units, voice/rest preferences, AI connection and spending controls, import/export and deletion. No customer sign-up or subscription flow for this personal version.

Gym creation starts with a name and broad equipment checklist, then adds exact details where needed: dumbbell range and increments, barbell/plates, named machines, cable attachments and load conventions. Save once and reuse. Switching gyms updates pending recommendations through a reviewed proposal; completed history stays intact. “Machine occupied” is a temporary session restriction, while “This gym has no cable machine” updates the saved inventory only through an explicit edit. Include a quick Notes field for seat settings and equipment-specific setup.

### Visual direction and usability targets

Use a calm charcoal or navy background with one clear accent, strong contrast, tabular timer/load numerals and generous spacing. Offer light mode. Prefer readable labels around 16 points and touch targets at least 44 points, respecting Dynamic Type. Use colour plus text/icons for completed, active and pending sets. Keep headers compact to preserve space for the current set and timer. Avoid animated dashboards, oversized progress rings and full-screen chat prompts between sets.

Prototype Today, Active set, Rest and Summary first. Test them on an iPhone with one hand, sweaty fingers, headphones and the keyboard open. Provisional targets: one tap to resume; one tap to log a matching set; editable rest presets visible before training; no lost session after force-close; a clear route to undo/correct; no missed or duplicated timer endings. Verify usability with personal sessions before expanding the screens.

### Concrete UI and domain functions to implement

| Function/component | Responsibility |
| --- | --- |
| `buildTodayView(ownerId, localDate)` | Return resume priority, planned session, selected gym, compact weekly counts and next session. No AI dependency. |
| `buildActiveSetView(sessionId)` | Join the active set, comparable history, actual-value draft, next target and current timer. |
| `commitSetAndBeginRest(command)` | Atomically deduplicate and save the result plus timer state. Return success before optional coaching; account for supersets and final sets. |
| `resolveRestPreset(sessionId, setId)` | Return duration and source according to the stated hierarchy. Snapshot the chosen duration for the session. |
| `adjustRestTimer(timerId, deltaSeconds)` | Update the deadline/version, clamp to zero and replace scheduled alerts. Does not rewrite the saved routine preset. |
| `pauseSession(sessionId)` / `resumeSession(sessionId)` | Preserve remaining timer time and active duration; re-schedule alerts on resume. |
| `buildSetCue(event, sessionVersion)` | Generate short deterministic speech from committed values, with selected verbosity and unit convention. |
| `scheduleTimerCue(timerId, version)` | Schedule supported alerts, optionally heads-up; deduplicate foreground/background delivery. |
| `cancelObsoleteCues(sessionId, version)` | Cancel cues after edits, skip, new set, finish or interruption; never announce stale targets. |
| `startWorkInterval(setId, duration)` | Run a duration-based exercise timer independently of rest and require the configured completion behaviour. |
| `buildWorkoutSummary(sessionId)` | Calculate factual summary locally; attach optional coach commentary later. |
| `updateSessionTiming(sessionId, correction)` | Correct session timing with an audit record, then recompute duration and export values. |

State transitions are explicit: Ready → Working → Result saved → Resting → Ready, with Paused and Finished states. A timer expiry, AI reply or duplicate transcript cannot commit a set on its own. The existing services in sections 3 and 7 implement these contracts; these additions refine their UI behaviour rather than creating a separate logging system.

First design milestone: a real personal session with saved equipment, copied prior values, edited actual results, automatic predefined rest, short spoken cues, force-close recovery and a saved summary. Full conversational coaching follows once this loop works reliably.
