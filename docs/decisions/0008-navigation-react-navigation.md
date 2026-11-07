# 0008: Navigation with React Navigation 7 (native stack + bottom tabs)

**Status:** Proposed, 2026-10-09 (developer; for review)

## Context
The real app replaces the probe-only shell. It needs three tabs (Today, Progress, Profile), stacks inside Profile (Data & backup, App status, Developer), a full-screen workout stack over the tabs, and a first-run flow over everything (onboarding.md §2). Expo SDK 57 offers two routes:
- **expo-router 57.0.25**: file-based routes on top of a vendored React Navigation. Its dependency list includes web and server pieces (`vaul`, Radix, `expo-server`, `@expo/metro-runtime`), and it wants `expo-linking`, `react-native-reanimated` and `react-native-gesture-handler` as peers.
- **React Navigation 7** directly: `@react-navigation/native`, `native-stack`, `bottom-tabs`, plus `react-native-screens` (already in SDK 57's bundled list).

## Decision
- Use **React Navigation 7**, pinned: `@react-navigation/native` 7.5.0, `@react-navigation/native-stack` 7.20.0, `@react-navigation/bottom-tabs` 7.20.0, `react-native-screens` 4.26.2 (SDK 57 expects `~4.26.0`).
- Screens are declared in code with typed param lists. There are no URLs: Fizz has no deep links, no web target and no server routes (personal, offline, iPhone only). `fizz://` links (system-states.md §3.9) can be added later through React Navigation's `linking` option without changing the structure.
- The JS tab bar is used (stable). The `unstable` native tab bar is not used.
- Icons are SF Symbols through `expo-symbols` 57.0.3 (SDK 57's version), so the icon names in design-system.md are used as written. It adds a small native module; it needs no entitlement.

## Consequences
- Fewer dependencies than expo-router, and no reanimated/gesture-handler native code to compile without a Mac.
- `react-native-screens` and `expo-symbols` are native: a new cloud build is needed before the JS bundle can use them. Both are in SDK 57's bundled module list; neither adds an entitlement (the free-provisioning check still runs).
- No file-based routing conventions; navigation types live in `apps/mobile/src/navigation/types.ts`.
- **Revisit if:** we want deep links or typed URL routes widely (expo-router), or the native tab bar becomes stable and worth the native look.
