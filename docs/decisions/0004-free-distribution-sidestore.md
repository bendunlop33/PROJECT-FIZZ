# 0004: Free distribution with a free Apple ID and SideStore

**Status:** Accepted by Ben, 2026-10-08

## Context
Ben chose not to pay for the Apple Developer Program (US$99/year). He has a Windows laptop (Huawei) and an iPhone 17 (iOS 26). See `docs/research/free-ios-install.md`.

## Decision
- **Build:** GitHub Actions macOS runners build an unsigned device `.ipa` from this private repo: Expo prebuild, then `xcodebuild` with code signing off, then the Payload is zipped.
- **Install:** Ben installs it with **SideStore**, using his own Apple ID, which he enters himself. The Windows laptop is used for setup and repairs only. The 7-day re-sign happens on the phone.
- Ben keeps one Apple ID and one signing tool for signing, and never changes them, because changing either installs a separate app with an empty database.
- **Native config stays free-provisionable:**
  - no push (`aps-environment`), time-sensitive notifications, Siri/App Intents, Associated Domains or iCloud entitlements;
  - Live Activities have no push type.
- Live Activity, AlarmKit, time-sensitive alerts and HealthKit are capability flags, detected at runtime. No acceptance criterion depends on them.
- Backup (SQLite snapshot + JSON export to Files) and a tested restore are part of the first milestone, before any real workout is logged.
- GitHub Actions spending stays capped at $0. If build minutes run out, builds wait for the monthly reset.

## Consequences
- **Cost:** $0, including updates. Ben does a weekly refresh tap in SideStore.
- **Upgrade triggers** (Ben's call): refreshes become a nuisance or keep failing; Live Activities or App Groups fail under re-signing; or he wants time-sensitive alerts, HealthKit or TestFlight. Migration uses backup/restore.

## Update 2026-10-08: SideStore risks
See `docs/guides/sidestore-windows.md`.
- **Sign-in break:** since early September 2026, SideStore stable builds (0.6.4 and older) can't sign in to an Apple ID. Only the 0.7.0 alpha/nightly builds have the fix.
- **iOS 26.4+ refresh errors:** some users report them, and the SideStore maintainers have no fix yet.
- **Fallback:** Sideloadly or AltStore Classic on the Windows laptop.
- **Trial run before any real data:** the signing tool is confirmed only after a trial run on Ben's iPhone. The run must:
  - install an update over the top;
  - skip a refresh and recover;
  - restore from backup.

  Switching tools later means backup, new app, restore.
