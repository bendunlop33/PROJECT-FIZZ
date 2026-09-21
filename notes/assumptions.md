# Assumptions Register

Status key:
- `UNVERIFIED`: no evidence yet
- `CONFIRMED`: sourced
- `DISPUTED`: evidence suggests it's wrong or incomplete
- `INCORRECT`: shown to be wrong
- `OPEN`: a question to answer, not yet a claim

Every change needs evidence (a URL or the calculation) and a date. Never delete a row; if an item is superseded, mark it so.

| ID | Assumption (from brief unless noted) | Status | Evidence / notes | Owner | Last checked |
|---|---|---|---|---|---|
| A-001 | Starter kit £29.99 (case + 24 tablets), COGS £5.50, gross margin 80–82% | DISPUTED | The margin only works on the VAT-inclusive price. Net of VAT, £29.99 is £24.99, giving ~78% before shipping, payment fees, fulfilment and packaging. £5.50 for a CNC-milled anodised case plus 24 tablets looks low at launch volumes. | pricing-economist | 2026-09-21 |
| A-002 | Monthly refill £19.99 for 24 tablets (£0.83/serving), COGS £2.20, 88–89% margin | DISPUTED | Same VAT error: £16.66 net, giving ~87% before fulfilment and postage. | pricing-economist | 2026-09-21 |
| A-003 | Retail tube £6.99 for 15 (£0.47/serving) at Boots, Whole Foods, gyms | DISPUTED | Undercuts the subscription (£0.83/serving), a cannibalisation risk. The retailer's margin isn't accounted for. Whole Foods has a very small UK footprint; check. | pricing-economist / market-mapper | 2026-09-21 |
| A-004 | Case holds 12 tablets in a 2×6 grid inside a 110 mm case | INCORRECT | 6 × 23 mm = 138 mm, which exceeds 110 mm before walls. The options are an 8-tablet (2×4) tray, a ~150 mm case, or a smaller tablet. This changes pack counts, and so pricing. | (Phase 2) | 2026-09-21 |
| A-005 | "Dry until use" holds with a gasket and desiccant sheet in a case opened several times a day | DISPUTED | Loose effervescent tablets are highly moisture-sensitive, and UK ambient humidity is high. Individually sealed blister trays may be needed, which affects COGS and pack design. Needs a manufacturer's view and stability testing. | (Phase 2) | 2026-09-21 |
| A-006 | Refill mailer meets Royal Mail Large Letter (brief says 250×180×25 mm, <100 g) for under £1.60 | DISPUTED | Actual Large Letter maximum is 353×250×25 mm and 750 g. Price is banded by weight, with 0–100 g cheapest. 24 × 3.5 g = 84 g of tablets alone, so the mailer is likely in the 101–250 g band. Verify current Royal Mail prices. | pricing-economist | 2026-09-21 |
| A-007 | VAT: product is standard-rated (20%) | CONFIRMED (likely) | HMRC VAT Notice 701/14: vitamin and mineral supplements are standard-rated, as are preparations for making beverages. https://www.gov.uk/government/publications/vat-notice-70114-food. Confirm with an accountant. | pricing-economist | 2026-09-21 |
| A-008 | Competitor data: Waterdrop £8.99/12; Phizz £7.99/20; Spacegoods £39–49 per 30, sachets £7.99–£10 for 7; associated doses | UNVERIFIED | Earlier AI versions contradicted themselves (Phizz 4 vs 7 electrolytes; Spacegoods ashwagandha 300 vs 200 mg; sachet price). Re-verify every figure from official or retailer pages. | market-mapper | 2026-09-21 |
| A-009 | Health claims: B, C, D and zinc claims available; botanicals marketed on "traditional" profile | OPEN | Only claims in the GB NHC register may be used: https://www.gov.uk/government/publications/great-britain-nutrition-and-health-claims-nhc-register. Many botanical claims are "on hold" and may be usable under transitional rules. Check each ingredient. | claims-regulatory | 2026-09-21 |
| A-010 | Alpha-GPC (Mind SKU) is a permitted food supplement ingredient in GB | UNVERIFIED | EFSA assessed L-alpha-GPC as a novel food in May 2026 (proposed maximum 203.7 mg/day). GB status must be checked with the FSA. | claims-regulatory | 2026-09-21 |
| A-011 | Ashwagandha 150 mg (Recovery SKU) is an effective dose | OPEN | Typical studied doses are ~300–600 mg. KSM-66 is not usually described as a 10:1 extract. Check both, plus any UK safety position. | claims-regulatory | 2026-09-21 |
| A-012 | Caffeine 80 mg per tablet in 500 ml | OPEN | That's 160 mg/L. Check caffeine labelling requirements for food supplements and prepared drinks, and any warnings required. | claims-regulatory | 2026-09-21 |
| A-013 | £30 and £20 are key psychological price thresholds; under £20/month "passes bank subscription audits" | UNVERIFIED | No evidence given. Find evidence or treat as opinion. | pricing-economist / customer-insight | 2026-09-21 |
| A-014 | 24 tablets = one month's supply | OPEN | That's fewer than one a day. What usage frequency is realistic per segment? This drives LTV. | customer-insight / pricing-economist | 2026-09-21 |
| A-015 | Target customer is "active, on-the-go professionals" | UNVERIFIED | Not yet defined or sized. | customer-insight | 2026-09-21 |
| A-016 | Positioning gap: premium "bio-performance" between cheap squash, lifestyle hydration and clinical tablets | UNVERIFIED | Test whether the gap exists and whether there is demand in it. | market-mapper | 2026-09-21 |
| A-017 | B6 dose in Mind SKU ("Methyl B6 & B12: 10 mg") | OPEN | Check against UK advice on vitamin B6 intake from supplements. | claims-regulatory | 2026-09-21 |
