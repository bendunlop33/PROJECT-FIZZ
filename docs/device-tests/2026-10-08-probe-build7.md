# Device probe results: build 7, 8 Oct 2026

**Device:** iPhone 17, iOS 26.6.1 (Europe/London). Signed with a free Apple ID using SideStore (0.7.0 Nightly).

**Totals:** 8 pass, 2 fail, 1 unavailable, 1 not run, 1 not implemented.

| Probe | Result | Notes |
|---|---|---|
| SQLite (WAL, exclusive transaction, rollback) | PASS | |
| Keychain round-trip | PASS | |
| Local notification while locked | PASS | Arrived on the lock screen. Interruption level "active" (time-sensitive needs the paid programme). |
| Rest deadline survives force-close | PASS | 2:09 remaining recovered after relaunch. |
| expo-speech cue | PASS | Heard. |
| Ducking over music (audio-coach) | PASS | Music dipped and came back. Playback category; notifyOthersOnDeactivation. |
| Audio events | PASS | Interruptions and route changes recorded. |
| On-device speech recognition | PASS | "Bench 100 kg for eight". The recogniser writes "kg", not "kilos", and mixes digits and words ("100", "eight"). Locale was **en-US**; Ben is in the UK. |
| Spoken cue while locked | UNAVAILABLE | Build made without the background-audio experiment. |
| **App Group** | **FAIL** | SideStore renamed the group to `group.com.projectfizz.fizz.<TEAMID>` (also in `ALTAppGroups`). expo-widgets reads the build-time group, so it has no container. The renamed group's container is writable. |
| **Live Activity** | **FAIL** | No countdown on the lock screen. This is most likely caused by the App Group rename (ADR 0007, Known risks). |
| AlarmKit | NOT RUN | Framework present; permission was never requested. |
| ChatGPT sign-in (S1) | NOT IMPLEMENTED | |

**Also observed:** SideStore appended the team suffix to the bundle ID (`com.projectfizz.fizz.<TEAMID>`). It stays stable as long as the same Apple ID and SideStore are used (ADR 0004).
