# 0035: Apple Health through a small HealthKit module, as a runtime capability

**Status:** ACCEPTED by the developer on 27 Oct 2026 after Ben approved Apple Health items 1–3 and answered
`apple-health.md` §11 (27 Oct). Not yet run on the phone. For PM and reviewer review. Renumber on merge if another
branch took 0035.

## Context

Ben approved: write finished workouts to Apple Health; read bodyweight; read runs and other activities (Garmin via
Health); then (§11) merge a linked watch workout with ours (Q1), a read-window setting (Q6), resting heart rate and
sleep (Q8). CLAUDE.md and ADR 0004 make HealthKit a runtime-detected capability flag, and native config must stay
free-provisionable. Research (`wearables-garmin.md` §2a, `free-ios-install.md` §1.2): a free team can sign HealthKit
through Xcode (LoopDocs), but SideStore's AltSign maps only App Groups and inter-app audio to App ID features, so the
entitlement is probably dropped on Ben's install and HealthKit calls then fail with "Missing
com.apple.developer.healthkit entitlement". Only a device probe can tell.

## Decision

1. **Our own small Swift module** (`apps/mobile/modules/health-store`, ~300 lines, `HealthKit` framework), like
   `loopback-auth`, instead of `@kingstinct/react-native-healthkit` (16.2.0, maintained, peer
   `react-native-nitro-modules`). Reasons: no new dependency (the library needs Nitro's C++ runtime on RN 0.86, which
   can't be verified here, and installing it would touch the shared `node_modules`); its config plugin turns on
   background delivery by default; we need nine calls. It is a separate module, not part of `audio-coach` (which owns
   the audio session). The module reports a missing entitlement as a status, never a crash.
2. **Entitlement: `com.apple.developer.healthkit` only**, added by `plugins/with-healthkit.mts`, allowlisted in
   `entitlement-rules.mts`. `com.apple.developer.healthkit.background-delivery` and `.access` (clinical records) are
   on the forbidden list (stripped at prebuild, errors in CI). `FIZZ_HEALTHKIT=0` builds without it, a fallback if
   the key ever stops SideStore signing the app. Both usage strings are in `app.config.ts`.
3. **Runtime capability.** `healthCapability` (`packages/providers`) is `available` only when the module is in the
   build, the build has the entitlement and HealthKit answers; a missing entitlement, no module or any error is
   `not_on_this_install`. Then Profile › Apple Health reads `Not available on this install` (`Why?`), no switch shows,
   nothing is read or written, and logging is untouched. iOS is asked for each type only when Ben turns its switch on.
4. **Writes are idempotent and versioned.** One op ID per write (`health-save:<session>:<syncVersion>`); the Health
   workout carries `HKMetadataKeySyncIdentifier` `gymsmarter-session:<id>`, the sync version and
   `HKMetadataKeyExternalUUID` = the session ID. Before saving, the module looks for our sample with that identifier
   and adopts it, so a retry after a force-close never writes a second workout. Health samples can't be edited: a
   move saves a new version and deletes the old. Records are kept per workout (`health_writes`).
5. **Reads land in the existing activity model.** `activities.listBetween` returns Ben's activities plus Health's
   (read-only, built when listed, never stored in `activities`), deduped and paired by `activitiesWithHealth`
   (domain), so every reader (Today, the week and run rule, calendar, reviews, coach, the History screen being built
   elsewhere) gets them. Edits only reach Ben's own.
6. **Storage (rule 10, Your data), migration 38.** `health_samples` (what was read) and `health_settings` (switches,
   per install, like iOS permission) are **local only**: left out of backups and exports with the derived tables
   (`LOCAL_ONLY_TABLES`), re-read from Health, removed by Delete my data. `health_writes` and `health_links` are backed
   up: a restore doesn't write twice and keeps Ben's links and `Not it`s.
7. **When it runs.** Reads on app open and return to the foreground (at most every 15 min unless `Read now`), never
   while a workout is open; writes catch up after any store write (a 3 s check of the store's write count) and on
   open. No background delivery, no network (rule 1).
8. **Nothing invented (rule 6).** We write type, times and pauses only. We show only what Health recorded, with its
   source: duration, distance, avg/max heart rate, active energy for linked workouts, resting heart rate and minutes
   asleep. No scores; a Health run is `hard` only by Ben's word; bodyweight isn't used for loads (Q5 pending).

## Consequences

- Likely on SideStore: `Not available on this install`. Ben then chooses (Q10): Xcode builds (keep HealthKit per
  LoopDocs), paid signing (ADR 0004's upgrade trigger), or living without it. The device test says how to tell.
- **Confirmed on build 419 (26 Oct), and a fourth route added (26 Oct, ADR 0036):** a patched SideStore built in our
  CI with SideSign PR #3, which maps the entitlement to the HealthKit App ID feature for free teams. The cause was
  SideStore's signing library, SideSign in SideStore 0.6.4 and later (AltSign only in 0.6.3 and older), not an Apple
  refusal. Ben approved trying it; the runtime flag still covers it failing.
- The Swift module is unverified until the macOS CI build compiles it; the JS side is tested against a fake port.
- Migration 38 is new; another branch taking 38 must renumber on merge.
