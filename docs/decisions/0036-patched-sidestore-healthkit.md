# 0036: A patched SideStore so HealthKit survives free-Apple-ID signing

**Status:** ACCEPTED. Ben approved building it on 26 Oct 2026. Not yet built or run on the phone. Renumber on merge if
another branch took 0036.

## Context

Build 419's device test showed `Not available on this install` for Apple Health (ADR 0035). Research
(`docs/research/sidestore-healthkit.md`) found why: SideStore's signing library, SideSign, doesn't map
`com.apple.developer.healthkit` to an App ID feature and doesn't allow it for free teams. So the App ID never gets
HealthKit, the profile lacks it, and the signer drops the entitlement. An open upstream PR, SideSign #3 (commit
`74950d3`, unmerged, one on-device report), adds `Feature.healthKit = "HK421J6T7P"` and allows it for free teams.
Without a Mac or the paid programme, a SideStore built with that change is the only route.

Checked 26 Oct against SideStore's git tags and its published source (`SideStore/apps-v2.json`): the **0.6.4 release
(9 Sep 2026) already uses SideSign** (pin `7f81842`), as does 0.7.0-alpha (11 Sep, pin `a731c0d`), which SideStore's
source now lists as the newest stable. Only 0.6.3 and older use the old AltSign (`ALTCapabilities.m`).

## Decision

1. Build a third-party SideStore in our CI from **pinned upstream refs plus that one upstream PR**, nothing else:
   `.github/workflows/sidestore-healthkit.yml` ("SideStore HealthKit (patched)"), manual only (dispatch, or a pushed
   `sidestore-hk-*` tag). No fork, no secrets, isolated from the GymSmarter `iOS IPA` workflow.
2. Two outputs:
   - **Recommended:** `SideStore-HealthKit.ipa`: tag `0.7.0-alpha` (SideStore's current stable) with SideSign at PR
     #3's head (optionally cherry-picked onto 0.7.0-alpha's own pin instead). 0.7 carries the fix for Apple's
     September sign-in change (`docs/guides/sidestore-windows.md` §8), which 0.6.4 lacks.
   - Alternative, if Ben wants to stay on the version he has: `SideStore-0.6.4-HealthKit.ipa`: tag `0.6.4` with PR #3
     cherry-picked onto its own SideSign pin, plus the one line PR #3 relies on that the pin lacks
     (`Entitlement.healthKit`). Nine lines change in SideSign. Same sign-in limits as stock 0.6.4.
3. The workflow fails unless SideSign maps the entitlement to `HK421J6T7P` and allows it for free teams, and keeps
   clinical records (`healthKitAccess`) off. Each `.ipa` ships with a README of the exact refs and its SHA-256.
4. GymSmarter's own build, entitlements and runtime flag (ADR 0035) don't change.
5. No AltSign (0.6.3 and older) variant: there is no upstream patch to pin to, and those versions can't sign in
   since Apple's September change either.

## Consequences

- Ben runs SideStore built by us, not by SideStore's team. It holds his Apple ID session, so it is built only from
  the pinned tag plus the reviewed PR diff.
- Every SideStore update has to be rebuilt with the patch until PR #3 is merged and released. Ben must turn off
  SideStore's update prompts and not accept an upstream update meanwhile. Installing an unpatched SideStore and then
  reinstalling GymSmarter drops HealthKit again (`Not available on this install`); data and logging are unaffected.
- After installing the patched SideStore, GymSmarter must be **installed again** from an `.ipa` (a refresh doesn't
  re-sign with the new entitlement).
- Unverified until the device test (`docs/device-tests/2026-10-27-sidestore-healthkit.md`): that the build compiles
  on GitHub's runner, that Apple turns HealthKit on for Ben's existing free App ID, and that SideStore installs over
  itself keeping its account and pairing.
- Fallbacks if it fails: Xcode on a Mac with Ben's Personal Team, the paid programme (ADR 0004 upgrade trigger), or
  living without Health. The runtime flag already covers all three.

## Retiring it

When SideSign merges PR #3 (or an equivalent) and a SideStore release includes it: switch Ben to that official
release (or the nightly channel if that comes first), reinstall GymSmarter once, check Profile › Apple Health, then
delete `sidestore-healthkit.yml` and mark this ADR superseded. Also retire it if Ben moves to Xcode or paid signing.
