# 0001: Stay on React Native + Expo, pinned to SDK 57

**Status:** Accepted, 2026-10-08

## Context
Ben has no Mac. The feature set includes local SQLite, rest timers that survive force-close, Live Activities, TTS that ducks music, on-device speech recognition, and later HealthKit. Expo SDK 58 is in beta and has breaking changes. See `docs/research/ios-platform-feasibility.md`.

## Decision
- Use React Native + Expo SDK 57 (React Native 0.86). Upgrade only after SDK 58 is stable.
- Use native SwiftUI only for small local Expo modules where Expo falls short: the audio session, and later SpeechAnalyzer or AlarmKit.
- Keep the domain core in TypeScript so it can be tested on Linux.

## Consequences
- We can develop and test without a Mac. iOS builds happen in the cloud.
- Native modules mean we need a development or preview build. Expo Go isn't enough.
- **Revisit if:**
  - the audio-session spike fails;
  - an Apple Watch app becomes core;
  - Ben gets a Mac and wants SwiftUI.
- **Open:** how builds are signed and installed (paid Developer Program or a free route). See `docs/research/free-ios-install.md` when it's ready.
