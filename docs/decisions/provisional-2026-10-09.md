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

## Added during the night (PM calls from the foundation review)
- **SP1:** Start workout needs a gym. With no gym, the button is replaced by "Add gym". This changes the spec in today.md.
- **SP2:** backup rotation never deletes the newest backup that passed its integrity check.
- **SP3:** until the gym editor exists, a gym saved during first run is shown read-only, so going Back never creates a second gym.
- **SP4:** "Save a copy to Files" uses a folder picker, pending a device test of iCloud and On My iPhone.
- **Triceps pushdown:** one exercise with an attachment option (rope or bar), not two separate exercises.
