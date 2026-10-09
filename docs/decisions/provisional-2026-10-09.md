# Provisional decisions for the overnight build (9 Oct 2026)

Ben replied "s" to "go + 3 answers". This was read as **go**, with the stated defaults. Everything below is **provisional**: it's built so it can be changed, and listed for Ben to confirm or override.

1. **Look:** Direction D, Premium (inspired by Third Space; see `docs/research/thirdspace-visual-reference.md`). It's implemented as a single theme module, so switching to A, B or C is a token swap.
2. **Name:** "Fizz" stays as a placeholder display name. Changing it doesn't affect the bundle ID or data.
3. **Defaults:** all "Recommended" answers in `docs/design/open-decisions.md` are applied (B1–B14 recommendations and section B bulk defaults). B13 and B14 stay decided-after-test, as written.
4. **Still Ben's, not assumed:**
   - the 14 coaching-playbook rules (they stay *candidates*; nothing uses them as approved)
   - HYROX vs strength focus
   - the RPE-vs-planned trigger refinement (the current trigger rule stays)
   - the watch model
   - anything involving money or accounts
5. **Needs Ben's provisional OK before it's built (ADR 0010):** in-app playback of exercise guides with `@shopify/react-native-skia` 2.6.2 + `react-native-reanimated` 4.5.1 + `react-native-worklets` 0.10.1 (SDK 57 bundled versions; about 6 MB on iOS; a new cloud `.ipa` build; no entitlements). Fallback: `react-native-svg`. Until then, guides exist only as `guide.json` plus a review `preview.png`, every guide stays `Draft` until Ben approves it, and the catalogue and guide tooling (Linux-only, dev dependencies) are built.
