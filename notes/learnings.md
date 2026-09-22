# Learnings

Append one entry at the end of every session.

## Template
### YYYY-MM-DD — session summary
- What we learned:
- User feedback:
- Assumptions changed (IDs):
- Do differently next time:

### 2026-09-22 — blocked-page verification sweep (CSO, direct reads)
- **What we learned:**
  - **The egress policy changed.** Six of the seven domains that earlier sessions recorded as "blocked by the egress proxy" opened on first attempt: gov.uk, legislation.gov.uk, ankhway.com, wildnutrition.com, appliednutrition.uk, and assets.publishing.service.gov.uk (the NHC register spreadsheet downloaded cleanly). **Every "blocked" note in this register older than today should be re-tested before it is trusted as a limitation.**
  - **One block is real and permanent.** royalmail.com is *not* blocked by our proxy — the CONNECT succeeds and the proxy logs no failure; the 403 comes from Royal Mail's own Akamai edge refusing datacentre IPs. Misattributing this cost earlier sessions repeated attempts. A-006's tariff question cannot be closed by any agent and needs a human.
  - **A "potential showstopper" evaporated on one read.** A-043 blocked Recovery and Mind formulation for a day; zinc bisglycinate, methylcobalamin and pyridoxal-5'-phosphate are all plainly listed in Schedule 2, and zinc bisglycinate was never even an amendment — it was in the 2019 original. The earlier finding was a *search* failure reported as a *legal* finding.
  - **Search summaries degraded gracefully but did degrade.** A-009's estimate (155–170) was close but low (175), two per-nutrient counts were wrong, and one authorised wording differs from what we would have printed ("magnesium contributes to **a** reduction…"). Nothing strategic moved, which is the reassuring half; three artwork-grade errors existed, which is the other half.
  - **A downgrade can be over-corrected.** A-040's dose was downgraded largely on a "stated 10:1" raw-equivalent argument. The direct read shows **no 10:1 statement anywhere on ankhway.com**. The downgrade was still right — there is no supplement facts panel, so the dose is genuinely unverified — but it was right for one reason, not three.
- **User feedback:** asked for the blocked list to be cleared by direct reads; stopped the sweep before Berocca Boost and the Wild Nutrition per-serving pricing were done. Two items remain open by instruction, not by obstacle.
- **Assumptions changed (IDs):** A-043 (resolved, no longer a showstopper), A-009 (limb 1 primary-sourced, three corrections), A-035 (both limbs now primary-sourced), A-040 (10:1 basis withdrawn; price confirmed; compliance evidence hardened), A-006 (block cause corrected; tariff still open), A-039 (partial).
- **Do differently next time:** record *how* a page failed, not just that it failed — proxy 403, site 403 and TLS failure have completely different remedies. And re-test the blocked list at the start of every session before planning around it.
