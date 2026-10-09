# Competitor landscape

Written by the `competitor-researcher`, 9 Oct 2026. Pass 2 (same day) applied the completeness critique: it adds Arvo, a "ChatGPT used directly" baseline, six more apps and a UK store view, and fixes unsourced cells. Later passes should extend and correct this file rather than start over. The changes are listed under "Revision log" at the end.

## Summary

- **Coverage.** 55 apps, a "ChatGPT used directly" baseline and 6 one-line notes, all checked on 2026-10-09 against vendor pages, US and GB App Store listings and help docs. User evidence comes only from the App Store, Trustpilot, forums and GitHub (Reddit can't be fetched, and there was no web search in pass 2), so the complaints are examples, not a survey.
- **The market has caught up.** A rest Live Activity is standard (Hevy free; Strong, Arvo and GymStreak too). Equipment-aware loads exist in MacroFactor, Gravl, Alpha, Liftosaur and (vendor claim) Arvo. In-session AI that edits workouts exists in SensAI, Arvo, GymStreak and LiftTrack Max. Ben's realistic alternative, his ChatGPT Pro voice mode plus a free logger such as Hevy (whose free ChatGPT app saves plans), costs him nothing extra.
- **The headline claim survives only in narrowed form [Inference].** No app checked documents all of these together: version-checked proposals that are rejected when stale, Undo on in-session coach edits, a max for every machine, and a labelled no-AI fallback. Arvo comes closest (in-session AI edits, plates per gym, Undo for plan activation only), but its "client-side AI" claim is contradicted by its own privacy policy, and GymSmarter's version is designed, not built.
- **Top recommendations:** get the rest Live Activity working (with an actionable notification as fallback), build competitor-failure tests, show "Why this number?" on every target, get Ben's FitNotes export now, and (new) have Ben run four brief scenarios in ChatGPT voice mode before the coach is built.
- **The brief needs changes** (see "Proposed brief changes"): hold "Proposed advantage" (change 2) until that baseline check; add "ChatGPT used directly" as the first competitor row; refresh the table and the LiftTrack section; add exclusion flags (low evidence) and validation scenarios; and say that only Ben can test competitors.

## How to read this

- **Dates.** Every URL was checked on **2026-10-09** unless another date is given. Prices are App Store in-app-purchase lists: US prices in the per-app sections, GB prices in "UK store view". Several listings show more than one price for the same plan without saying which applies; those are reported as listed. Where a listing shows a day and month without a year, this file says "year not shown". A year is given only where a lookup or the version order confirms it.
- **Labels.** **[Doc]** means documented by the vendor (site, listing, changelog or help). **[User]** means an anecdote from a review or forum post. **[Inference]** means my reading of the evidence, not proven. Where sources conflict, both are given.
- **Limits.**
  - **Unreachable:**
    - Reddit can't be fetched. The Reddit links here and in the brief were not opened.
    - Web search was unavailable for all of pass 2, because the shared per-turn budget was used up.
    - These returned 403:
      - help.hevyapp.com;
      - help.rpstrength.com;
      - parts of help.fitbod.me;
      - openai.com, help.openai.com and chatgpt.com;
      - whoop.com.
  - **"Not documented"** means I didn't find it, not that it doesn't exist.
  - **Hands-on testing:** researchers can't sign up, start trials or download apps. Any hands-on competitor test (brief, "Validation before claiming it is better") can only be run by Ben.
- **Scope decisions already made by Ben.** HYROX is no longer a special case (CHANGELOG, playbook v1), and wearables are parked (v0.9). HYROX and endurance apps are tracked for completeness only, and no recommendation below depends on them.
- **GymSmarter status** is taken from the latest reviews (`docs/reviews/slice-3-and-s1.md`, `guides-v2.md`, `critic-pass-1.md`) and the code in `apps/` and `packages/`. "Built" means it is in the code. "Designed" means it is specified in `docs/design/` but not built.

## Capability matrix

**Legend.**
- **✓** means documented and substantial.
- **partial** means limited, paid-only or only partly documented.
- **✗** means documented as absent or explicitly not offered. For AI and Voice, ✗ also covers a full vendor feature list that describes no such feature.
- **?** means not documented or not verified.
- **n/a** (table B only) means parked scope (wearables, v0.9; endurance and HYROX tracked for completeness only), not researched.
- **Privacy column:**
  - ✓: no account is needed or nothing is linked to identity, and no tracking.
  - partial: an account or linked data, but no tracking declared.
  - ✗: the App Store label declares data "used to track you".
- **GymSmarter row:** uses built / designed / parked / not built.
- **Column key:** Log = logging; Plates = plate and equipment maths; Gyms = gym profiles; Prog = progression and autoregulation; AI = AI coach; Builder = workout builder; Guides = exercise guides; Rest/LA = rest timer, lock screen and Live Activity; I/E = import and export; Wear = wearables; Endur = endurance.

### A. Baseline, strength loggers, adaptive strength coaches and voice-first newcomers

| App | Log | Plates | Gyms | Prog | AI | Voice | Builder | Guides | Rest/LA | Offline | I/E | Wear | Analytics | Pain | Endur | Privacy |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **GymSmarter (9 Oct)** | built [G1] | built [G2] | built [G3] | built, fallback [G4] | designed [G5] | designed [G6] | partial [G7] | built, 10 draft [G8] | partial [G9] | built | partial [G10] | parked | not built | built [G11] | parked | ✓ |
| **ChatGPT used directly (baseline)** [B1] | ✗ | ✗ | partial | partial | ✓ | ✓ | ✓ | partial | ✗ | ✗ | partial | ? [B2] | partial | partial | partial | partial |
| Hevy | ✓ | partial [1] | partial | partial (Pro) | partial [2] | ✗ | ✓ | ✓ | ✓ [3] | ? [4] | partial | partial [5] | ✓ | partial (Pro) | partial | partial |
| Strong | ✓ | partial (PRO) | ✗ | ✗ | ✗ | ✗ | partial | ✓ [46] | ✓ [6] | ? | partial [7] | partial | ✓ | ✗ | partial | partial [8] |
| FitNotes (Android) | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | partial | ✗ [47] | partial | ✓ | partial | ? | ✓ | ✗ | partial | ✓ |
| FitNotes 2 (iOS) | ✓ | ✓ | partial | partial | ✗ | ✗ | ✓ | partial | ✓ | ✓ | ✓ [9] | partial | ✓ | ✗ | partial | ✓ |
| JEFIT | partial [10] | partial | partial | partial (Elite) | partial | partial [57] | ✓ | ✓ | partial | ? | ? | ✓ | ✓ | partial | partial | ✗ |
| Boostcamp | ✓ | partial | ✗ | partial [11] | partial | ✗ | ✓ | ✓ | ✓ | ✓ | ? | partial | ✓ | ✗ | ? | ✗ |
| StrongLifts | ✓ | ✓ | ? | ✓ | ✗ [60] | ? | ? | ? | partial [54] | ? | ? | ✓ | ? | ? | ? | ✓ |
| StrengthLog | ✓ | partial | ? | partial (Premium) | ✗ | ? | ✓ | ✓ | partial | ? [59] | partial | partial | partial | ? | ? | partial |
| Lyfta | ✓ | ? | ? | ? | ? | ? | partial | ✓ [55] | partial | ? | ? | ✓ | ? | ? | ? | ✗ |
| Liftosaur | ✓ | ✓ [12] | ✓ [13] | ✓ | partial [14] | ✗ | ✓ | partial | ✓ (Premium) | ✓ | ✓ | partial | partial (Premium) | ✗ | partial | ✓ [15] |
| Liftin' | ✓ | partial | partial | ✓ | partial [16] | ✗ | ✓ | partial | ✓ | ? | partial | ✓ | ✓ | ? | ? | ✓ |
| Alpha Progression | ✓ | ✓ (Pro) | ✓ (Pro) | ✓ (Pro) | ✗ | ? | ✓ | ✓ | ✓ | ✓ | partial | partial | partial | ? | ? | ✗ |
| MacroFactor Workouts | ✓ | ✓ | ✓ [17] | ✓ | ✗ | ✗ | ✓ | ✓ | ✓ [18] | partial [48] | partial [49] | ? | ✓ | ? | partial | partial [19] |
| LiftTrack / Max | partial | partial | partial | ✓ | ✓ [20] | ✗ | ✓ | partial | partial | ? | partial | ✓ | ✓ | partial | partial | ✗ |
| Fitbod | ✓ | partial [21] | ✓ | ✓ | partial | ? | ✓ | ✓ | ✓ | partial [22] | partial | ✓ | partial | partial [23] | ? | ✗ |
| Gravl | ✓ | ✓ | ✓ [24] | ✓ | partial | ? | ✓ | ✓ | partial [25] | partial | partial | ✓ | partial | ✓ | partial | ✗ |
| SensAI | ✓ | ? | partial | partial [26] | ✓ | ? | partial | ✓ | ✓ | partial | ? | ✓ | ? | partial | partial | partial |
| Arvo | ✓ | partial [50] | ✓ [50] | ✓ | ✓ [52] | partial | ✓ | ? | ✓ | ? [51] | ✓ | partial | partial | partial | ? | partial |
| GymStreak | partial [53] | ? | partial | ? | partial [53] | ? | ✓ | ? | ✓ | ? | ? | ✓ | ? | ? | ? | ✗ |
| Fitness AI | ✓ | ? | partial | ✓ | partial | ? | partial | ? | ? | ? | ? | partial | partial | ? | ? | ✗ |
| JuggernautAI | ✓ | ✓ | partial | ✓ | ✗ | ? | partial | ✓ | ✓ | ? | ? | ✗ | ? | partial | ? | ✗ |
| RP Hypertrophy | partial | partial | ? | ✓ | ✗ | ? | ✓ | ✓ | ? | ? | ? | ? | ? | partial [27] | ✗ | ✗ |
| Dr. Muscle | partial | ? | partial | ✓ | partial [28] | ? | ? | ? | ? | partial | partial | partial | partial | ? | ? | ✓ [58] |
| Planfit | ✓ | ? | ✓ | partial | partial | ✓ | ? | ✓ | partial | ✗ [29] | ? | partial | ? | partial | ? | ✗ |
| MyLiftingCoach | ✓ | ? | partial | partial | partial [30] | ? | ? | ? | partial | ✓ | ? | ? | ? | partial | ? | ✗ |
| RepTalk | ✓ | ? | ? | partial | partial | ✓ | ? | ? | partial | ✓ | ? | ? | ? | partial | ? | ✗ |
| Copper | partial | ? | ? | ? | partial | ✓ [31] | ? | ? | ? | partial | ✓ | partial | ? | ? | ? | partial |
| Ray | partial | ? | ? | partial | ✓ | ✓ | partial | ✓ | ? | ? | ? | partial | ? | partial | ? | ✗ |
| Amrap | partial | ? | ? | partial | ✓ | ✓ | partial | partial | ? | ✗ [32] | ? | ? | ? | ? | ? | ✗ |
| Motra (ex-Train Fitness) | partial [56] | ? | ? | partial | partial | ? | partial | ? | ? | ? | ? | ✓ | partial | ? | ? | ? |

**Notes for table A** (sources are in the per-app sections):
- [G1] Built: the focused set card, `Last` with tap-to-copy, the Undo toast, correct/delete/skip/add set, pause, and the check-in. Not built: the Overview table, the custom keypad, and timed sets in the UI.
- [G2] Built in `packages/domain`: achievable loads, min/max ceilings, a plate-breakdown line, and a warm-up ramp that rounds down. Open blocker: Repeat at a gym that lacks the equipment keeps the old load (`slice-3-and-s1.md` B1).
- [G3] Multiple gyms and a minimal gym editor are built. A gym switch mid-workout, offered as a proposal, is designed (`gym-editor.md` GE7).
- [G4] The built-in rule (category defaults, pain halts) is the labelled fallback (ADR 0006). Coach-led progression is designed.
- [G5] Only the ChatGPT sign-in spike S1 exists, on the Developer screen. There is no coach in the user UI.
- [G6] On-device voice is designed (`voice.md`). Only a speech probe exists.
- [G7] `Repeat last workout` is built. Routines, the weekly plan and the coach workout builder are designed.
- [G8] 10 original draft guides with muscle focus are built. The v2 review says CHANGES NEEDED (B1).
- [G9] A persisted rest deadline and a keyed notification are built. The Live Activity failed on probe build 7 (App Group), and a retest is pending.
- [G10] On-phone backups, `Save a copy to Files`, and restore with Undo are built. FitNotes import and CSV export are designed.
- [G11] A check-in `Pain` with chosen movements creates flags, and progression is then halted for those movements. Pain flagged during a workout is designed only.
- [B1] Baseline: Ben uses ChatGPT (his Pro plan) in a chat or voice session alongside a logger. Most cells are [Inference] about what a general chat assistant does without a training app. Three cells are [Doc]: Voice (Advanced Voice Mode on the GB listing); Builder and I/E (Hevy's free ChatGPT app reads history and saves plans into Hevy). See "Baseline: ChatGPT used directly".
- [B2] Claude's Apple Health integration is documented as a US-only beta for Pro and Max (Jan 2026). ChatGPT's health features and their UK availability couldn't be verified: OpenAI's pages returned 403.
- [1] Hevy: the plate calculator is opt-in and covers barbell, short bar and EZ bar only. It shows "Closest possible weight" instead of snapping targets.
- [2] Hevy: there is no in-app LLM. A free @hevy ChatGPT app reads your history and saves plans to Hevy. Since 3.1.12 (3 Sep 2026) the finish screen can send workouts to ChatGPT and Claude.
- [3] Hevy: the Live Activity is free, and sets can be completed and rest adjusted by ±15 s without unlocking.
- [4] Hevy offline isn't documented on the listing, the logging feature page or the Live Activity page, and the FAQ URL returned 404. Pass 1's anecdote (alternativeto) couldn't be reopened and has been dropped.
- [5] Hevy wearables: a Watch app and full-detail Strava sync since Jun 2026. No Garmin; the accounts of why conflict (see Hevy).
- [6] Strong: Live Activity and Dynamic Island arrived in 6.5.0 (12 Aug 2026).
- [7] Strong: the CSV export "cannot be imported back".
- [8] Strong: an account is required before use.
- [9] FitNotes 2: imports the FitNotes Android database and CSV, plus CSVs from seven other apps.
- [10] JEFIT: RPE is logged once per session, not per set.
- [11] Boostcamp: the vendor says progressive overload is free, but the App Store notes label it "Auto Progression (PRO)" (versions 241 and 266).
- [12] Liftosaur: rounds every target. Its largest-plate-first solver forces stripping and reloading the bar (issue #199, open).
- [13] Liftosaur: switching gym mid-workout doesn't re-snap loads (issue #282, open since Mar 2025).
- [14] Liftosaur: its external MCP can log, edit and delete workouts. No undo is documented. Premium only.
- [15] Liftosaur: local-first with an optional account. The GB label lists linked data (including for Analytics) when you sign in; no tracking.
- [16] Liftin': a text-to-workout feature using Apple's Private Cloud Compute (v52), and ChatGPT/Claude connectors (v53).
- [17] MacroFactor: weight stacks are modelled as several ranges with micro-adjustments and an AI scan from a photo. There is no separate maximum field.
- [18] MacroFactor: Live Activity added in 1.2.1. A user reports the timer sound "periodically going silent".
- [19] MacroFactor: "never serve ads" and data "never sold". The GB label shows only "Data Linked to You", with purposes that include Developer's Advertising or Marketing.
- [20] LiftTrack Max: an embedded chat with approval cards. The 6.3.0 notes and the 26 Sep help pages disagree on scheduling and memory.
- [21] Fitbod: its help article covers barbell and plate-loaded machines, but the same article's FAQ says barbell only.
- [22] Fitbod: generated workouts can be completed offline. PRs and full history need the server.
- [23] Fitbod: "Injuries and Limitations" excludes or substitutes exercises. No stop to progression per movement is documented.
- [24] Gravl: machine 1RMs are kept per gym. You can't switch gym during a workout.
- [25] Gravl: rest timers on Watch and Garmin. No iPhone Live Activity is documented.
- [26] SensAI: the programme regenerates every week.
- [27] RP: users report that the joint-pain input "doesn't do anything" (Trustpilot).
- [28] Dr. Muscle: the vendor describes AI chat with human review. The App Store describes chat with a human coach.
- [29] Planfit: anecdote that in Airplane mode it "doesn't work at all".
- [30] MyLiftingCoach: an on-device Apple Intelligence coach; needs iPhone 15 Pro or later.
- [31] Copper: extraction runs in the cloud on Gemini, despite a "works offline" claim.
- [32] Amrap: anecdote: "your gym better have good WiFi".
- [46] Strong guides: "Detailed exercise instructions with a growing library of animated videos" (GB listing).
- [47] FitNotes (Android) guides: the docs describe only exercise notes you write yourself ("instructions … tips about form, machine settings") and a link field. No built-in guides were found.
- [48] MacroFactor offline: "not an offline-first application, and does not have a true offline mode", but it has a "limited offline mode" (help 366).
- [49] MacroFactor I/E: you can import a workout or programme from a supported spreadsheet and export spreadsheets at any time (quick or granular). It imports no past history.
- [50] Arvo: one gym profile per gym, "each with its own equipment and plate inventory, so load suggestions match the plates available" (changelog, week of 7 Jun 2026), plus "accurate dumbbell weights" (1.3.8). Stack ranges and a max per machine aren't documented. Vendor claims only.
- [51] Arvo offline: **conflict.** The homepage says "All AI decisions run client-side. Full functionality without connectivity." Its privacy policy names Anthropic and OpenAI as its AI providers and Supabase as its database host.
- [52] Arvo AI: "Ask Arvo" can "generate and edit your split and workouts, swap exercises, log sets in chat". It also has an MCP server with write tools. Neither documents a confirmation step or Undo. One-tap plan activation has Undo (1.4.2).
- [53] GymStreak: logging and the AI coach both need Premium.
- [54] StrongLifts: rest starts automatically and is longer after a failed set. You can "long press on the timer notification to log how many reps you did and mark the set done". No Live Activity is documented.
- [55] Lyfta guides: the GB listing says "HD video guides"; the vendor site says "illustrated images".
- [56] Motra: exercises are detected automatically from Apple Watch motion, so a Watch is needed.
- [57] JEFIT voice: Elite includes "professional audio cues" (GB listing). Voice logging isn't documented.
- [58] Dr. Muscle privacy: the label lists only an email address, not linked to you.
- [59] StrengthLog: without an account, data is stored only on the phone. Offline use isn't stated.
- [60] StrongLifts AI: the feature page describes rule-based automation only.

### UK store view (GB App Store, 2026-10-09)

Ben is in the UK. GB rating counts are 3 to 30 times smaller than US counts, and newcomers have one or two GB ratings, so their US praise says little about UK users. Prices are GB in-app-purchase lists as shown, and periods are given where the listing names them. Sources: the GB listings linked in each per-app section, plus three GB lookups ([1](https://itunes.apple.com/lookup?id=6758769325,1371187280,1446224156,1462277793,1661880849,6737156524,1538896016,1445041669,1529354455,449810000,6736655105,1515756471,1555614554,6738963099,1073943857,1511876936,6474633735,6758109776&country=gb), [2](https://itunes.apple.com/lookup?id=1434229662,6443740936,488580022,1458862350,464254577,1041517543&country=gb), [3](https://itunes.apple.com/lookup?id=6450921637,1502936453,1466445684,1288178982,1482405410,6670271875&country=gb)) and two US lookups ([US 1](https://itunes.apple.com/lookup?id=6758769325,1371187280,1446224156,1462277793,1661880849,6737156524,1538896016,1445041669,1529354455,449810000,6736655105,1515756471,1555614554,6738963099,1073943857,1511876936,6474633735,6758109776,1458862350,464254577,1041517543,6450921637&country=us), [US 2](https://itunes.apple.com/lookup?id=1434229662,6443740936,488580022,1371187280&country=us)).

| App | GB price (as listed) | GB rating (count) | US rating (count) | UK note |
|---|---|---|---|---|
| Hevy | Pro £2.99/mo (plus a £3.99 monthly item), £23.49/yr, £74.99 lifetime | 4.91 (29,414) | 4.92 (97,024) | |
| Strong | £4.99 or £4.49/mo; £17.99/6 mo; £21.99–£29.49/yr; Forever £79.99 or £99.99 | 4.86 (23,932) | 4.86 (108,529) | |
| Fitbod | £11.49 or £14.99/mo; £70.99 or £99.99/yr | 4.75 (16,283) | 4.81 (286,937) | |
| Ladder | not fetched | 4.92 (15,498) | 4.95 (205,582) | |
| StrongLifts | Pro £4.99/wk, £10.99/mo, £27.99/qtr, £54.99/yr; 5 years £199.99 or £229.99. A subscription is required to use it | 4.84 (14,493) | 4.86 (76,815) | Seller Stronglifts Limited |
| JEFIT | Elite £11.49/mo; yearly £30.99–£69.99 | 4.70 (6,136) | 4.76 (46,909) | |
| GymStreak | £11.49–£89.99 (many items) | 4.63 (5,118) | 4.70 (15,909) | Seller "GymStreak Ltd" [Inference: probably a UK company] |
| Fitness AI | £3.99/wk to £89.99/yr (many items) | 4.56 (3,250) | 4.70 (55,951) | |
| Planfit | not fetched | 4.71 (1,444) | 4.76 (8,242) | |
| Lyfta | Premium £5.99–£54.99 (periods not shown) | 4.80 (1,283) | 4.81 (6,869) | |
| Boostcamp | Pro items £10.99–£14.99 and £49.99–£79.99 (periods not shown) | 4.81 (1,227) | 4.85 (10,490) | |
| Alpha Progression | £9.99 or £10.99/mo; £69.99/yr | 4.90 (840) | 4.92 (2,206) | |
| StrengthLog | £14.90/mo, £33.90/3 mo, £98.90/yr | 4.85 (776) | 4.86 (3,669) | Swedish (Styrkelabbet AB) |
| Caliber | not fetched | 4.81 (545) | 4.84 (5,998) | |
| MacroFactor Workouts | £11.99/mo, £49.99/6 mo, £69.99/yr, £89.99 bundle | 4.76 (410) | 4.84 (4,683) | |
| Gravl | £14.99/mo, £34.99/3 mo, £52.00 or £69.99/yr | 4.89 (332) | 4.89 (5,757) | |
| JuggernautAI | £30.99/mo | 4.84 (306) | 4.85 (5,655) | |
| Trainwell | not fetched | 4.83 (208) | 4.9 (5,542) | Listed in GB; whether the coaching service runs in the UK is unknown |
| Liftin' | £2.99/mo, £24.99/yr, £99.99 lifetime | 4.90 (204) | 4.74 (767) | |
| FitNotes 2 | Unlimited £1.99 or £14.99; Forever £44.99 | 4.14 (106) | 4.57 (569) | |
| Dr. Muscle | not fetched | 4.62 (58) | 4.49 (382) | |
| Liftosaur | £2.69/mo, £21.99/yr, £54.99 lifetime | 5.00 (57) | 4.85 (410) | |
| LiftTrack | £7.99/mo; £49.99 or £59.99/yr | 4.63 (43) | 4.77 (135) | |
| HYBRD | not fetched | 4.81 (31) | 4.8 (764) | |
| RP Hypertrophy | £34.99/mo, £299.99/yr | 4.22 (23) | 4.30 (239) | |
| Arvo | Pro £3.99/mo, £29.99/yr (site: €4/mo) | 1.0 (2) | 2.70 (10) | GB listing is English only |
| Amrap | £19.99/mo, £59.99/6 mo, £99.99/yr | 5.0 (2) | 4.75 (32) | |
| SensAI | £6.99/mo, £69.99/yr | 5.0 (1) | 4.62 (37) | |
| Ray | Premium £19.99, £39.99, £119.99 (periods not shown) | 5.0 (1) | 4.78 (302) | UK and Australia support added in 1.1.27 (11 Aug, year not shown) |
| Future | n/a | **not in the GB store** | 4.87 (10,718) | Moved to the end of section D |
| ChatGPT | Go £6.99; Plus £19.99; Pro items £88.90–£444.99 | 4.8 (1.4m) | not fetched | Baseline (Ben already pays for Pro) |

Other UK limits:
- Google's coach preview was US-only, with iOS "soon" (Oct 2025); its current status is unverified.
- Apple Workout Buddy needs English or Spanish. Apple says only that Siri AI won't initially be available in the EU, so [Inference] the UK isn't excluded.
- Claude's health integration is US-only.
- ChatGPT's health features are unverified.

### B. Coaching services, platforms, hybrid/endurance, guides and hardware

| App | Log | Plates | Gyms | Prog | AI | Voice | Builder | Guides | Rest/LA | Offline | I/E | Wear | Analytics | Pain | Endur | Privacy |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Caliber | ✓ | ? | partial | partial | partial [34] | ? | ? | ✓ | partial | partial | partial | partial | ✓ | ? | partial | partial |
| Trainwell (human) | partial | ? | ? | partial | ✗ | partial | ✗ | ✓ | partial | partial | ? | ✓ | partial | partial | partial | partial |
| Ladder | partial | ? | partial | partial | ✗ | partial | partial | ✓ | partial | partial | partial | partial | partial | ✗ | partial | ✗ |
| Future (human; not in UK store) | partial | ? | ? | partial | ✗ [33] | partial | ? | ✓ | ? | ? | ? | partial | partial | partial | partial | partial |
| Apple Workout Buddy | n/a | n/a | n/a | ✗ | partial | partial | n/a | partial | n/a | partial | n/a | ✓ | partial | n/a | ✓ | partial |
| WHOOP | partial | n/a | partial | partial | ✓ | partial | ✓ | partial | ? [35] | n/a | partial | ✓ | ✓ | partial | ✓ | partial |
| Garmin Connect+ | partial | n/a | partial | partial | partial | n/a | ✓ | ✓ | partial | n/a | partial [36] | ✓ | ✓ | n/a | ✓ | partial |
| Oura Advisor | partial | n/a | n/a | n/a | partial | n/a | n/a | n/a | n/a | n/a | n/a | ✓ | n/a | partial | partial | partial |
| Google Health Coach | n/a | n/a | partial | partial | ✓ | n/a | ✓ | partial | n/a | partial | partial | partial | n/a | partial | ✓ | partial |
| Samsung Health [37] | partial | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | ✓ | ✓ | n/a | ✓ | n/a |
| Runna | partial | n/a | partial | ✗ [38] | partial | n/a | ✗ | ✓ | n/a | n/a | partial | ✓ | partial | partial | ✓ | ✗ |
| Strava | partial | n/a | n/a | n/a | partial [39] | n/a | partial | partial | n/a | n/a | ✓ (import) | ✓ | partial | n/a | ✓ | ✗ |
| TrainingPeaks | partial | n/a | n/a | partial | n/a | n/a | ✓ | ✓ | n/a | n/a | partial | ✓ | partial | n/a | ✓ | partial |
| Athletica | partial [40] | n/a | partial | partial | partial [41] | n/a | partial | partial | n/a | n/a | partial | ✓ | partial | n/a | ✓ | partial |
| HYBRD | partial | n/a | partial | partial | ✓ [42] | n/a | partial | n/a | partial | n/a | partial | ✓ | partial | partial | ✓ | ✗ |
| ROXFIT | partial | n/a | partial | n/a | partial | partial | ✓ | n/a | partial | n/a | partial | ✓ | ✓ | n/a | ✓ | ✗ |
| Repz | partial | n/a | partial | partial | n/a | n/a | partial | ✓ | n/a | n/a | partial | n/a | partial | n/a | ✓ | ✗ |
| HYBRID (HPM) | ✓ | n/a | n/a | partial | ✗ | n/a | ✓ | ✓ | partial | partial | n/a | n/a | partial | n/a | ✗ | partial |
| Muscle & Motion | ? | ? | ? | ? | ✗ | ? | ? | ✓ [43] | ? | ✓ | ? | ? | ? | ? | ✗ | partial |
| MuscleWiki (API) | ? | ? | ? | ? | partial | ? | partial | ✓ | ? | ✗ [44] | ? | ? | ? | ? | ? | ? |
| Nike Training Club | partial | ✗ | ? | partial | ? | partial | ? | partial | ? | ? | ? | ✓ | ? | ? | partial | ✗ |
| Gymshark Training [45] | partial | ? | partial | ? | ? | ? | ? | ✓ | ? | ? | ? | ? | ? | ? | ? | ? |
| Tempo | partial | partial | ✗ | partial | partial | ? | ? | partial | ? | ? | ? | partial | partial | partial | ? | ? |
| Tonal | partial | ✗ | ✗ | ✓ | partial | ? | partial | partial | ? | ? | ? | ? | partial | ? | ? | ? |

**Notes for table B:**
- [33] Future cancelled its AI-trainer beta for members in Jun 2026. Whether its coaches still use the coach-side AI tool (2025) is unverified. Future isn't in the GB App Store (GB lookup).
- [34] Caliber: a first-party MCP for ChatGPT and Claude since 5.15.0 (Jul 2026). No in-app AI.
- [35] WHOOP: no Live Activity is documented, and users asked for one (forum, Jul 2026).
- [36] Garmin: third-party apps can't write strength sets to Garmin.
- [37] Samsung: current Galaxy Watches don't work with iPhone.
- [38] Runna: "Strength sessions sit outside the adaptive running plans."
- [39] Strava: since Sep 2026, subscribers can ask Claude about strength workouts through the Strava MCP.
- [40] Athletica: strength is logged through Garmin strength mode or a comment field.
- [41] Athletica: the AI Coach chat never modifies training. The plan engine adapts on its own.
- [42] HYBRD: its AI ("Brain") can edit completed workouts. Its MCP exposes `update_completed_workout` and `delete_workout` with no documented confirm or undo.
- [43] Muscle & Motion: 3D animations with muscles colour-coded by role.
- [44] MuscleWiki: the API terms forbid storing media for offline playback.
- [45] Gymshark Training is frozen: no further updates, and withdrawn from Android (Jul 2026).
- Tempo, Tonal and Gymshark privacy weren't checked: their App Store IDs couldn't be found without web search.

## Per-app sections

Each section covers what the app is, its notable capabilities, what users say, and what it means for GymSmarter. GB prices and ratings are in "UK store view".

### 0. Baseline: ChatGPT used directly (Ben's current option)

- **What it is.**
  - **[Doc]** Ben has ChatGPT Pro (CHANGELOG v0.6). GymSmarter's ChatGPT-plan route covers text only and excludes audio, transcription and Realtime (same entry).
  - **[Doc]** The ChatGPT iPhone app offers "Advanced Voice Mode: Tap the soundwave icon to have a real-time convo on the go". Its GB label lists Health & Fitness as data linked to you ([GB listing](https://apps.apple.com/gb/app/chatgpt/id6448311069)).
  - **[Doc]** Hevy's free ChatGPT app (@hevy) works with free Hevy and free ChatGPT accounts. It:
    - reads workout history;
    - suggests the next workout with loads;
    - creates plans that are "saved straight to your Hevy account".
    It can't see body weight or measurements, and the page says nothing about confirmation or undo before it writes ([Hevy for ChatGPT](https://www.hevyapp.com/features/hevy-chatgpt/)). Since 3.1.12 (3 Sep 2026), Hevy's finish screen can send a workout to ChatGPT or Claude ([US listing, version history](https://apps.apple.com/us/app/hevy-workout-tracker-gym-log/id1458862350)).
  - **[Doc]** Claude's Apple Health and Android Health Connect integrations launched in beta through the iOS and Android apps for Pro and Max subscribers "In the US" (announced 11 Jan 2026; [Anthropic](https://www.anthropic.com/news/healthcare-life-sciences)). The UK isn't mentioned. The Claude GB listing doesn't mention Apple Health, and its label has no Health & Fitness category ([GB listing](https://apps.apple.com/gb/app/claude-by-anthropic/id6473753684)).
  - **Unverified.** OpenAI's health features (often called "ChatGPT Health") and their UK availability. openai.com, help.openai.com and chatgpt.com all returned 403. My background memory says it launched around Jan 2026 without the UK, EEA or Switzerland, but that **must not be relied on** until checked.
  - **[Inference]** FitNotes (Android) doesn't run on an iPhone, so on iPhone this baseline is ChatGPT plus FitNotes 2, Hevy or another logger.
- **Users say [User].** A SensAI reviewer cancelled: "I think you can get better recommendations for less money with one of the chat bots" (Sep 14, year not shown; [US reviews](https://apps.apple.com/us/app/id6738963099?see-all=reviews)). This is one review, not a trend.
- **What the baseline does better today [Inference].**
  - Two-way voice now. GymSmarter's first voice release is on-device, and Realtime is a later decision (brief v0.2).
  - Broad general knowledge, memory across all of Ben's chats, and zero build effort.
- **What GymSmarter would add [Inference; each point is designed, not built, and must be shown in the baseline check, Opportunity #5].**
  1. **Live session state without dictation.** ChatGPT sees only what Ben says or pastes. Hevy sends a workout only after it's finished, and @hevy reads saved history, not the set in progress.
  2. **Loads computed by code.** Every number is snapped to the selected gym's plates, dumbbells and stacks and bounded by each machine's max (rule 4). A chat model does this arithmetic in text, unchecked.
  3. **Structured, versioned writes with Undo** (rules 2 and 5). With ChatGPT alone, changes stay in chat text. Hevy's ChatGPT app writes plans with no documented undo.
  4. **Logging and rest alerts that work offline,** on the lock screen (rule 1). ChatGPT has no rest timer, and voice mode needs a connection.
  5. **Pain flags that stop progression in code** (rule 9). In chat, this depends on the model remembering.
  6. **Data that stays on the phone** in SQLite (rule 10), not in an OpenAI or Hevy account.
- **For GymSmarter.** If points 1–3 don't save Ben time in practice, the case for building the coach (step 4) weakens, while logging and guardrails stay valuable. Testing this is cheap: Ben runs it with his own account, and no researcher sign-up is needed (Opportunity #5).

### A. Strength loggers

#### Hevy
- **What it is [Doc].**
  - The market-leading free logger, on iOS/iPadOS 15.1+, Apple Watch and Android.
  - Pro costs $2.99/mo, $23.99/yr or $74.99 lifetime. A second $3.99 monthly item is also listed.
  - Rated 4.9 from 97K US ratings (29K GB); v3.1.16 (2 Oct 2026) ([App Store](https://apps.apple.com/us/app/hevy-workout-tracker-gym-log/id1458862350); [GB](https://apps.apple.com/gb/app/hevy-workout-tracker-gym-log/id1458862350)).
  - Free-tier limits: graphs show the last 3 months ([progress](https://www.hevyapp.com/features/gym-progress/)), and you can have 7 custom exercises ([library](https://www.hevyapp.com/features/exercise-library)).
  - Hevy Coach is a separate platform for human coaches ([coach](https://www.hevyapp.com/features/strength-coach/)).
  - The label declares no tracking. Purchases, contact info, contacts and usage data are linked to you (US listing).
- **Notable [Doc].**
  - Previous values sit inline and can be tapped to copy ([track](https://www.hevyapp.com/features/track-workouts/)).
  - Rest starts automatically, 5 s to 5 min per exercise, with ±15 s ([rest](https://www.hevyapp.com/features/workout-rest-timer/)).
  - A free Live Activity shows the next set and the countdown, and you can complete sets without unlocking ([Live Activity](https://www.hevyapp.com/features/live-activity/)).
  - The plate calculator is opt-in and covers the barbell family only. When a load can't be made it shows "Closest possible weight" ([plates](https://www.hevyapp.com/features/weight-plate-calculator/)).
  - **Trainer (Pro)** uses double progression. A swap asks whether it applies this session or permanently. Injury Management (3.1.9, 14 Aug 2026) replaces high-risk exercises or warns, with "not medical advice" ([Trainer](https://www.hevyapp.com/features/workout-plan-generator/)).
  - AI is external: a free ChatGPT app reads your history and saves plans into Hevy ([ChatGPT](https://www.hevyapp.com/features/hevy-chatgpt/)). Since 3.1.12 (3 Sep 2026) the finish screen can send workouts to ChatGPT and Claude (US listing, version history).
  - A workout can be tagged with a gym (3.1.11, 28 Aug 2026), which Hevy calls "a first step". Hevy says logging single vs double dumbbells is "genuinely tricky" and still being investigated ([July update](https://www.hevyapp.com/community-updates/july-26/)).
  - **Analytics:** graphs for volume, best weight and total reps, muscle-group graphs, and 1RM; unlimited history needs Pro (US listing).
  - **Endurance:** HYROX-style hybrid training tracking (3.0.13, May 2026) (US listing). Full-detail Strava sync since June 2026 (July update).
  - **Offline:** not documented ([4]).
  - **Garmin: the accounts conflict.** Hevy's help centre says Garmin rejected its API application ([help](https://help.hevyapp.com/hc/en-us/articles/35361029194647-Hevy-and-Garmin-Integration-Update-Why-It-s-Not-Possible-Yet); 403 on recheck, so not re-read). the5krunner says Garmin offered a restricted integration that Hevy declined ([the5krunner](https://the5krunner.com/2026/03/24/garmin-connect-plus-strength-apps/)).
- **Users say [User].**
  - Praise: easy logging and the lifetime option.
  - Complaints:
    - The feed can't be turned off.
    - A bug deletes the wrong set.
    - Assisted pull-up PR medals are wrong.
    - Users want sets done while injured or spotted excluded from stats.
    - Watch sync failed for about 3 months.
    - "equipment weights vary between gyms."
  - A CA reviewer (about 8 Oct 2026) would leave "if it ever becomes … opt-out-only" AI ([GB](https://apps.apple.com/gb/app/hevy-workout-tracker-gym-log/id1458862350?see-all=reviews), [AU](https://apps.apple.com/au/app/hevy-workout-tracker-gym-log/id1458862350?see-all=reviews), [CA](https://apps.apple.com/ca/app/hevy-workout-tracker-gym-log/id1458862350?see-all=reviews), [US](https://apps.apple.com/us/app/hevy-workout-tracker-gym-log/id1458862350?see-all=reviews)).
  - Set-specific rest is requested on [r/Hevy](https://www.reddit.com/r/Hevy/comments/1v1tuiv/feature_request_setspecific_rest_timers/) (link not opened: Reddit can't be fetched).
- **For GymSmarter.**
  - Copy: inline previous values; the "this session or all future" swap prompt (rule 2); completing a set from the Live Activity.
  - Do better: snap every target for every equipment type, and make per-hand vs total explicit (rule 4; CLAUDE.md conventions).
  - Avoid: a social feed, and pushing AI.
  - [Inference] AI review of your history is now free here, so GymSmarter's coach has to win inside the session.

#### Strong
- **What it is [Doc].**
  - A minimalist logger on iOS 15+, Apple Watch (watchOS 10+) and Android. An account is required before use ([account](https://help.strongapp.io/article/143-strong-account)).
  - PRO is listed at $4.99/mo, $19.99/6 mo, $29.99 or $23.99/yr, and Forever at $99.99 or $79.99; the listing doesn't map the prices to plans.
  - The free tier is limited to 3 custom routines (description). Rated 4.9 from 109K US (24K GB); v6.5.1 (8 Oct 2026) ([App Store](https://apps.apple.com/us/app/strong-workout-tracker-gym-log/id464254577); [GB](https://apps.apple.com/gb/app/strong-workout-tracker-gym-log/id464254577)).
- **Notable [Doc].**
  - Per-set RPE (6–10) is recorded but never acted on ([RPE](https://help.strongapp.io/article/230-about-rpe)).
  - Rest can differ for warm-up and working sets on each exercise ([rest](https://help.strongapp.io/article/231-rest-timer)).
  - A PRO warm-up calculator adds sets that are "not counted in metrics" ([warm-up](https://help.strongapp.io/article/171-warm-up-calculator)).
  - The PRO plate calculator has no documented behaviour for loads it can't make ([plates](https://help.strongapp.io/article/169-plate-calculator)).
  - Live Activity and Dynamic Island arrived in 6.5.0 (12 Aug 2026), after timer-notification fixes in 6.2.8, 6.2.9 and 6.3.2 (App Store).
  - The CSV export "cannot be imported back" ([export](https://help.strongapp.io/article/235-export-workout-data)).
  - **From the GB listing:**
    - "Detailed exercise instructions with a growing library of animated videos".
    - "A comprehensive range of cardio and strength exercises".
    - Advanced Statistics with 1RM and volume graphs.
    - A Watch app that logs "with or without your iPhone".
    - Health, fitness and identifiers are linked to you, with no tracking.
  - **Offline:** not documented. The listing doesn't say, and a help-centre search for "offline" returns nothing ([search](https://help.strongapp.io/search?query=offline)).
- **Users say.**
  - [Doc] The help centre says "lost" data is usually a second account ([lost data](https://help.strongapp.io/article/217-lost-data)) and that templates can vanish through cloud sync ([templates](https://help.strongapp.io/article/253-templates-disappearing)).
  - [User] Praise: design, flexibility, the Watch tap.
  - [User] Complaints: no 25 lb Smith bar in the plate presets (2020); the routine cap ([GB reviews](https://apps.apple.com/gb/app/strong-workout-tracker-gym-log/id464254577?see-all=reviews)); the developer ignores requests ([intervals.icu forum](https://forum.intervals.icu/t/import-strong-data-weightlifting-app/5531?page=2)).
- **For GymSmarter.**
  - Copy: separate warm-up and working rest, with warm-ups kept out of metrics.
  - Do better: treat RPE 10 or a big miss as a coach signal (rule 3).
  - Avoid: data loss from mismatched accounts (we're local-first), and an export that can't be restored (test the backup round-trip).
  - [Inference] Strong's CSV is widely imported (FitNotes 2 and Copper; Hevy too, per its help centre, which couldn't be re-read), so a Strong-format export would be cheap portability. Nothing shows Ben wants to leave, so this is low priority.

#### FitNotes (Android original): probably Ben's source
- **What it is [Doc].** Android only, free and ad-free.
  - A paid Supporter app adds extras, including per-exercise units ([settings](http://www.fitnotesapp.com/settings/)).
  - The FAQ says "there aren't any plans to develop an iOS/iPhone version" ([FAQ](http://www.fitnotesapp.com/faq/)).
- **Notable [Doc].**
  - Plate inventory with counts, custom plates, a bar per exercise, and a percentage calculator that rounds to the closest step ([tools](http://www.fitnotesapp.com/workout_tools/)).
  - A local `FitNotes_Backup.fitnotes` file, with optional Google Drive backup. The CSV is for spreadsheets only: "It is not possible to restore data from the CSV file" ([settings](http://www.fitnotesapp.com/settings/)).
  - Separates Estimated from Actual PRs, with a rep cap ([progress](http://www.fitnotesapp.com/progress_tracking/)).
  - No RPE field is documented ([tracking](http://www.fitnotesapp.com/workout_tracking/)).
  - Set fields are "some combination of Weight, Reps, Distance, and Time", so cardio can be logged.
  - Exercise Notes hold your own "instructions … tips about form, machine settings" and a link. There are no built-in guides (same page).
- **For GymSmarter.**
  - Units must be resolved per exercise in the import preview, because Supporter users can set them per exercise [Doc + Inference].
  - Copy the split between estimated and actual PRs (rule 6).
  - Ask Ben for both the CSV and the `.fitnotes` backup. Don't guess the database format (brief §11).
  - [Inference] Imported exercise notes may contain machine settings worth keeping as provenance. They are data, not instructions (rule 8).

#### FitNotes 2 (unofficial iOS alternative)
- **What it is [Doc].**
  - On iPhone/iPad 16.6+ and Apple Watch, by Ginger Technologies. It is not the original developer.
  - Free up to 12 saved workouts; Unlimited $1.99 or $14.99; Forever $44.99. Rated 4.6 from 569 US (4.1 from 106 GB); v14 (9 Sep 2026) ([App Store](https://apps.apple.com/us/app/fitnotes-2-gym-workout-log/id1538896016); [GB](https://apps.apple.com/gb/app/fitnotes-2-gym-workout-log/id1538896016)).
- **Notable [Doc].**
  - No account; iCloud backups.
  - Imports the Android FitNotes database and CSV, plus CSVs from Strong, IronGAINS, HeavySet, Fitbod, Hevy, Liftin and WeightFit, and exports back to FitNotes ([changelog](https://getfitnotes.com/changelog/)).
  - The Android migration **skips any workout on a date that already has one** ([migrate](https://getfitnotes.com/docs/migrate-from-android.html)).
  - Plate profiles per gym; RPE/RIR; warm-ups excluded from stats; a Live Activity with "Next set" (v13).
  - "Graph your progress with any exercise", a breakdown by body part, and workout templates ([site](https://getfitnotes.com/)).
  - An "Exercise video library" (v12). Weight, reps, distance and time exercises, plus EMOM, AMRAP and Tabata timers (GB listing).
  - The privacy label lists only data not linked to you.
- **Users say [User].**
  - Praise: simplicity, and the Live Activity.
  - Complaints: there's no pause, so durations are inflated; the Live Activity must be turned on in settings; the 12-workout free limit; per-exercise rest is hard to find ([reviews](https://apps.apple.com/us/app/fitnotes-2-gym-workout-log/id1538896016?see-all=reviews), [GB](https://apps.apple.com/gb/app/fitnotes-2-gym-workout-log/id1538896016)).
- **For GymSmarter.**
  - Confirm which FitNotes Ben uses (brief v0.2). FitNotes 2's own export schema is undocumented.
  - Our import design already offers "Skip those dates" or "Import them as extra workouts" (`data-import-export.md`). Keep the choice. [Inference] FitNotes CSV has no times, so the date is the natural key.
  - Turn the Live Activity on by default with the first rest.
  - Pause is already modelled (ADR 0003).

#### JEFIT
- **What it is [Doc].**
  - On iOS 15+, Watch, Android, Wear OS and web. Logging is free with no ads.
  - Elite costs $12.99/mo or $69.99/yr, plus legacy and discounted items. Rated 4.8 from 47K US (6.1K GB); v17.2.6 (5 Oct 2026) ([App Store](https://apps.apple.com/us/app/jefit-gym-workout-plan-tracker/id449810000); [GB](https://apps.apple.com/gb/app/jefit-gym-workout-plan-tracker/id449810000); [vendor, 2026-09-14](https://www.jefit.com/blog/jefit-vs-caliber)).
- **Notable [Doc].**
  - 1,400+ exercises with HD video and animations, and 27K+ plans.
  - The Elite Adaptive Plan adjusts from every logged set, and you can override it. It has mesocycles and pauses progression in deload weeks.
  - Editing the available plates or dumbbells mid-workout adjusts the planned sets (17.2.1).
  - Assisted exercises progress the right way (17.2.4).
  - Injuries can be rated by severity, with recovery reminders and injury-aware swaps that state their reason (17.0.9, 17.2.2).
  - RPE is logged once per session.
  - Elite includes "professional audio cues" (GB listing).
  - Cardio machines are in the library, and Adaptive Plans have a "Cardio Finishers" setting (GB listing).
  - Two-way Strava, and Apple Health.
  - **Offline and CSV import/export:** not documented on the listing, site or FAQ ([FAQ](https://www.jefit.com/support/faq)).
  - The privacy label says Usage Data is "used to track you", and Device ID is used for third-party advertising.
- **Users say [User].**
  - Praise: the database and the muscle-balance view.
  - Complaints:
    - "There is not A DAY that goes by without having to report a bug."
    - Routines show the wrong videos (Jul 25, year not shown).
    - The Watch timer freezes.
    - Updates add prompts.
    - Upsells ([reviews](https://apps.apple.com/us/app/id449810000?see-all=reviews)).
- **For GymSmarter.**
  - [Inference] JEFIT is converging on GymSmarter's rules (planned sets that follow the equipment, assisted semantics, injury swaps with reasons), so none of these is a differentiator on its own.
  - Keep RPE per set.
  - Avoid upsell-style prompts (rule 3) and tracking.
  - Guides must always play, so keep them bundled.

#### Boostcamp
- **What it is [Doc].**
  - On iOS and Android: "Boostcamp doesn't currently have an Apple Watch or Wear OS app" ([site](https://www.boostcamp.app/)). Programmes are free.
  - Pro costs $59.99/yr or $14.99/mo ([vendor, Sep 2026](https://www.boostcamp.app/best/strength-training)). Rated 4.8 from 10K US (1.2K GB); v266 (2 Oct 2026) ([App Store](https://apps.apple.com/us/app/boostcamp-gym-workout-fitness/id1529354455); [GB](https://apps.apple.com/gb/app/boostcamp-workout-tracker/id1529354455)).
- **Notable [Doc].**
  - 11,000+ programmes, 130+ of them coach-designed, and "an AI program builder" (site).
  - RPE and RIR on every set.
  - A Live Activity on the Lock Screen and Dynamic Island.
  - "Workout online or offline" (GB listing).
  - Performance charts, muscle volume and streaks (GB listing).
  - Apple Health sync for workouts and body weight (v264, 13 Aug 2026).
  - **Import/export:** not documented on the site or listing.
  - **Conflict:** the vendor's FAQ says progressive overload is free, but the App Store notes say "Auto Progression (PRO)" (versions 241 and 266).
  - The privacy label says identifiers are used to track you, and lists coarse location.
- **Users say [User].**
  - GB reviews: the app "sometimes resets mid-workout when the screen locks", losing the session (15 Sep 2022), and it's "buggy" (19 Oct 2022) ([GB](https://apps.apple.com/gb/app/boostcamp-workout-tracker/id1529354455)).
  - Pass 1 also listed freezes after a workout, lost entries without a connection (2023, fixed in 2024 per the developer) and completed workouts not registered. Those couldn't be re-found on a page in pass 2, so treat them as unverified.
- **For GymSmarter.**
  - Named programmes belong in Coaching knowledge as templates (rule 10; `docs/training-guides/programmes.md`). Don't build a library.
  - Its data-loss reports support force-close recovery and idempotent writes (rule 5).

#### StrongLifts
- **What it is [Doc].**
  - A 5×5 logger on iOS, Android and Apple Watch, by Stronglifts Limited ([site](https://stronglifts.com/app/)).
  - The GB listing says it's free to download but needs a subscription to use. Pro costs £4.99/wk, £10.99/mo, £27.99/qtr or £54.99/yr. Rated 4.8 from 77K US and 14K GB; v4.4.0 (5 Oct 2026) ([GB](https://apps.apple.com/gb/app/stronglifts-5x5-workout-plan/id488580022)).
  - Label: nothing linked to you, and no tracking.
- **Notable [Doc]** ([site](https://stronglifts.com/app/)).
  - The weight goes up automatically once every set is completed. Increment and frequency are configurable, for example 1 lb every three workouts with fractional plates.
  - A deload follows repeated failures; both the count and the size are configurable, for example 15% after two failures.
  - After a break it offers an optional deload.
  - A plate calculator for "any bar and any plate type", including 0.5 lb plates.
  - Rest starts automatically: longer after a failed set, shorter after a successful one.
  - "Simply long press on the timer notification to log how many reps you did and mark the set done."
  - The Watch app logs the whole workout with one tap per set. Workouts sync to Apple Health.
  - No AI is described. Silent mode mutes the timer chime ([support](https://support.stronglifts.com/article/39-timer)).
- **For GymSmarter.**
  - The notification long-press is evidence for a lock-screen fallback if the Live Activity keeps failing under SideStore (Opportunity #14; needs a device test).
  - Send these to the training-researcher as playbook candidates, not facts: rest lengths that depend on success or failure, and the deload-after-failures and post-break rules.

#### StrengthLog
- **What it is [Doc].**
  - A Swedish logger (Styrkelabbet AB) on iOS, Android and Apple Watch ([site](https://www.strengthlog.com/app/)).
  - The free tier has unlimited workouts, no ads, basic stats and programmes, a plate calculator and a rest timer.
  - Premium (£14.90/mo, £33.90/3 mo, £98.90/yr in GB) adds RPE/RIR, advanced programmes and reports.
  - Rated 4.9 from 3.7K US and 776 GB; v9.0.8 (6 Oct 2026) ([GB](https://apps.apple.com/gb/app/strengthlog-workout-tracker/id1434229662)).
- **Notable [Doc].**
  - 500+ exercises with written and video instructions in the free tier (GB listing; the site says 450+).
  - 200+ programmes; the programme builder is free, and %1RM and RPE options are Premium.
  - "Without an account, data is saved only on the phone" (site). Offline use isn't stated.
  - It shares data to Apple Health one way. Export is in settings, in an undocumented format.
  - Label: contact info and user ID are linked to you; no tracking.
  - Warm-up exclusion from stats isn't documented.
- **For GymSmarter.** [Inference] It shows that a generous free tier with written-and-video guides is now normal. Nothing new to copy; keep guides scoped to Ben's lifts.

#### Lyfta
- **What it is [Doc].**
  - A free logger with Premium, on iOS and Android, by Lindberg Development AS. It claims "7M+ users" and 600M+ logged lifts (vendor claim) ([site](https://www.lyfta.app/)).
  - GB Premium items cost £5.99–£54.99, with periods not shown. Rated 4.8 from 6.9K US and 1.3K GB; v1.163 (1 Oct 2026) ([GB](https://apps.apple.com/gb/app/lyfta-gym-tracker-workout-log/id6443740936)).
- **Notable [Doc].**
  - 5,000+ exercises. The GB listing says "HD video guides" and the site says "illustrated images".
  - Automatic rest timers.
  - Apple Watch, Apple Health and Strava.
  - No AI coach or import is documented.
  - The label says identifiers and usage data are used to track you.
- **For GymSmarter.** Nothing new to copy. [Inference] Library size isn't a goal for a single-user app.

#### Liftosaur
- **What it is [Doc].**
  - Open source (AGPL-3.0, [GitHub](https://github.com/astashov/liftosaur)): a web app wrapped for iOS 17+ and Android, with Apple Watch support and a web editor.
  - Premium costs $4.99/mo, $39.99/yr or $99.99 lifetime. Rated 4.9 from 410 US (57 GB); v122 (29 Sep 2026) ([App Store](https://apps.apple.com/us/app/liftosaur-scriptable-workouts/id1661880849); [GB](https://apps.apple.com/gb/app/liftosaur-scriptable-workouts/id1661880849)).
  - Premium adds per-side plates, graphs, the Live Activity, the Watch app and API/MCP access ([premium](https://www.liftosaur.com/features/premium)).
- **Notable [Doc].**
  - Local-first: "saved on the device first", with no account needed ([sync](https://www.liftosaur.com/features/sync-and-offline)).
  - Multiple gyms, fixed-weight equipment, and a round-down policy. No maximum cap or per-dumbbell convention is documented ([equipment](https://www.liftosaur.com/features/equipment-and-gyms)).
  - A **"Why is the weight adjusted?"** sheet, a preview of progression, and Suppress. Update scripts "never change completed sets" ([progressions](https://www.liftosaur.com/features/progressions)).
  - The Live Activity shows the next target with per-side plates and can complete a set. Its chime ducks other audio and plays through headphones via a silent background audio session ([lock screen](https://www.liftosaur.com/features/lock-screen-and-notifications)).
  - **Import:**
    - preview;
    - skipped rows with reasons;
    - sanity flags (more than 3,000 lb, more than 1,000 reps, dates before 2000 or in the future);
    - dedupe of workouts within 1 minute;
    - undo of the last 5 imports.

    Hevy and Liftosaur CSVs only ([import/export](https://www.liftosaur.com/features/import-export)).
  - The MCP lets ChatGPT and Claude log, edit and delete workouts and edit gyms. No undo is documented; Premium only; published 27 Sep 2026 ([AI](https://www.liftosaur.com/features/chatgpt-claude-and-ai)).
  - Release notes add time-based exercises (Tabata, EMOM) and heart rate from Apple Watch or AirPods (GB listing). That's the only endurance support.
- **Users say [User].**
  - Praise: flexibility, and a responsive developer.
  - Complaints: the docs; programme edits lost without tapping "apply"; the DSL is a barrier ([reviews](https://apps.apple.com/us/app/liftosaur-scriptable-workouts/id1661880849?see-all=reviews)).
  - Open issues: [#199](https://github.com/astashov/liftosaur/issues/199) (the greedy plate solver forces strip-and-reload), [#282](https://github.com/astashov/liftosaur/issues/282) (a gym switch doesn't re-snap loads), [#270](https://github.com/astashov/liftosaur/issues/270) (day variants per gym).
- **For GymSmarter.**
  - Copy: the import safety features and the "why adjusted" sheet.
  - The audio-routing pattern is a data point for the Swift module. Its v120 notes fix audio routing again, so test this on the device.
  - Contrast: its external AI can delete workouts with no undo; rules 2 and 5 forbid that here.
  - Use the AGPL code as reference only and copy none of it.

#### Liftin'
- **What it is [Doc].**
  - iPhone, iPad and Mac (26.0+) and Apple Watch. Free for 5 workouts a month.
  - $2.99/mo, $24.99/yr or $99.99 lifetime. Rated 4.7 from 767 US (4.9 from 204 GB); v53.0.4 (5 Oct 2026) ([App Store](https://apps.apple.com/us/app/liftin-gym-workout-tracker/id1445041669); [GB](https://apps.apple.com/gb/app/liftin-gym-workout-tracker/id1445041669); [site](https://liftinapp.co/)).
- **Notable [Doc].**
  - Customisable rules to raise weights on success and lower them on failure.
  - Text-to-workout "Powered by Private Cloud Compute" (v52, 11 Sep 2026).
  - ChatGPT/Claude connectors (v53, 27 Sep 2026).
  - Apple Health, Watch sync, and Strava with heart rate and sets (GB listing). Cardio isn't described.
  - "Beautiful graphs" for progress (GB listing).
  - Nothing is linked to you, and no tracking is declared.
  - Apple's WWDC26 session says PCC has "no cloud API costs" for developers below 2 million first-time downloads and requires an entitlement ([WWDC26 241](https://developer.apple.com/videos/play/wwdc2026/241/)).
- **Users say [User].** Praise for the UX, Watch app, plate calculator, export and developer.
- **For GymSmarter.**
  - PCC needs an entitlement. ADR 0004 allows only entitlements a free Apple ID can sign, so treat PCC as out of scope unless a new ADR changes distribution (see Opportunity #18).
  - Don't use AI-generated exercise instructions (rule 10; ADR 0011).

#### Alpha Progression
- **What it is [Doc].**
  - iPhone only, with no Watch app; also on Android.
  - The free tier never expires and has: unlimited logging, 795 videos, your own plans, a rest timer, CSV export, no ads and no account.
  - Pro costs $12.99/mo or $79.99/yr. Rated 4.9 from 2.2K US (840 GB); v7.7 (6 Oct 2026) ([site](https://alphaprogression.com/en); [App Store](https://apps.apple.com/us/app/alpha-progression-gym-log/id1462277793); [GB](https://apps.apple.com/gb/app/alpha-progression-gym-tracker/id1462277793)).
- **Notable [Doc] (Pro).**
  - Set-by-set targets that use past workouts **and today's sets**.
  - "More reps first" when the next dumbbell is too big a jump; the plate calculator falls back to the closest weight below.
  - Gyms can have weight ranges (min/max/interval), plate counts, unit overrides per equipment item and per exercise, and an exercise allow/deny list per gym ([gym profile](https://alphaprogression.com/en/glossary/gym-profile)).
  - A Live Activity with the current recommendation (6.6).
  - Real-gym videos, marketed as "no (AI) animations", available offline at lower resolution.
  - "Works fully offline" (GB listing). The FAQ says plans, logging and Pro recommendations work without internet; generating a new plan needs it (site).
  - Apple Health and Health Connect; charts for Pro only (site).
  - Voice cues and pain handling: neither is documented on the site or listing.
  - The privacy label says Purchases and Identifiers are used to track you.
- **Users say [User]** ([reviews](https://apps.apple.com/us/app/alpha-progression-gym-log/id1462277793?see-all=reviews)).
  - Praise: an older review (4 Feb 2023) contrasts it with another app whose recommendations "kept changing".
  - Complaints:
    - The rest-end alert is "too subtle" (Sep 28, year not shown).
    - In one review (Jan 4, year not shown):
      - "the weights … didn't match up" after switching gyms;
      - there's no per-machine history;
      - it jumps to the next exercise after the last set;
      - removing an exercise needs a second choice so it doesn't apply to future workouts.
- **For GymSmarter.**
  - This is the closest analogue to our deterministic layer. It validates snapping down and adding reps first (`progression.ts` `jump_too_big`).
  - Do better: history per equipment item, and switching gyms.
  - The rest alert must be impossible to miss.
  - Remove and skip should default to today only.

#### MacroFactor Workouts (launched Jan 2026)
- **What it is [Doc].**
  - iOS and Android. $11.99/mo, $47.99/6 mo or $71.99/yr, with a 7-day trial and no free tier.
  - "never serve ads"; data "never sold" ([workouts](https://macrofactor.com/workouts/)). v1.4.1 (3 Oct 2026) adds rep-progression schemes. Rated 4.8 from 4.7K US (410 GB) ([App Store](https://apps.apple.com/us/app/macrofactor-workouts-tracker/id6737156524); [GB](https://apps.apple.com/gb/app/macrofactor-workouts-tracker/id6737156524)).
- **Notable [Doc].**
  - "rule-based logic, not generative AI".
  - Gym profiles. Weight stacks are modelled as several ranges with increments, plus dial, pin and external-plate micro-adjustments. "Scan with AI" builds ranges from a stack photo. There is no separate max field ([help 403](https://help.macrofactorapp.com/en/articles/403-how-to-configure-weight-stack-ranges-for-pin-loaded-machines)).
  - Holds the load and adds reps when the next jump is too big ([help 392](https://help.macrofactorapp.com/en/articles/392-why-am-i-being-recommended-very-high-reps)).
  - A Live Activity since 1.2.1.
  - **Offline is limited:** "not an offline-first application, and does not have a true offline mode", but it has a "limited offline mode that prevents faults and interruptions". It sometimes needs the internet at launch to load the account and validate the subscription ([help 366](https://help.macrofactorapp.com/en/articles/366-troubleshoot-internet-connectivity-workouts)).
  - **Import/export:**
    - "You cannot import past workout data from other apps", but you can import workouts or full programmes from a supported spreadsheet ([workouts](https://macrofactor.com/workouts/); [help 287](https://help.macrofactorapp.com/en/articles/287-how-to-import-a-workout-or-program)).
    - Spreadsheet export, quick or granular ([help 356](https://help.macrofactorapp.com/en/articles/356-export-your-data-workouts)).
  - Analytics: a "Workout Insights & Analytics" article and volume-over-time views ([help collection](https://help.macrofactorapp.com/en/collections/20-macrofactor-workouts)). "Added basic cardio support" (1.1.2).
- **Users say [User].**
  - Praise: accurate RIR suggestions; gym profiles.
  - Complaints:
    - No history import ("only complaint").
    - It suggests dumbbells the user doesn't own.
    - Lost sessions.
    - Editing a set resets rest.
    - The timer sound goes "periodically … silent".
    - e1RM rises when lifts get lighter ([reviews](https://apps.apple.com/us/app/macrofactor-workouts-tracker/id6737156524?see-all=reviews)).
- **For GymSmarter.**
  - Validates the multi-range gym editor and `jump_too_big`; no change needed.
  - [Inference] Our explicit max per machine is stricter; keep it.
  - Corrections must never restart rest (brief §12).
  - Later: a stack photo could produce a *proposal* of ranges (rule 2).

### B. Embedded AI and adaptive strength coaches

#### Arvo (new in pass 2)
- **What it is [Doc].**
  - An "AI personal trainer" for bodybuilding and powerbuilding, on iOS (15.1+), Android and web, by Aetha, Inc (aetha.ai). It launched 4 Mar 2026; v1.4.2 (29 Jul 2026) ([site](https://arvo.guru/); [GB](https://apps.apple.com/gb/app/arvo-ai-workout-coach/id6758769325)).
  - There is a free tier. Pro costs €4/mo on the site ([pricing](https://arvo.guru/pricing)), or £3.99/mo or £29.99/yr on the GB store.
  - Rated 1.0 from 2 GB ratings and 2.7 from 10 US ratings, with no written GB reviews.
  - Sign-in is by magic link, so an account is needed ([support](https://arvo.guru/support)).
  - The GB label lists Health & Fitness, purchases, email, user ID and usage data as linked to you; no tracking section is shown.
- **Notable [Doc, vendor claims].**
  - **Load Navigator:** sets the next set from the last set's reps and RIR. Example: 100 kg × 12 at RIR 1 → 102.5 kg × 8. It's "Powered by GPT-5 reasoning models" (site).
  - **Ask Arvo:** can "generate and edit your split and workouts, swap exercises, log sets in chat", with "100+ tools that act, not just answer". Its memory of injuries and preferences can be reviewed and edited (site). No confirmation step or Undo is documented for these actions.
  - **Undo:** "one-tap plan activation with undo" (1.4.2). That's the only Undo documented.
  - **Equipment:**
    - "one profile per gym, each with its own equipment and plate inventory, so load suggestions match the plates available" (changelog, week of 7 Jun 2026; [changelog](https://arvo.guru/changelog));
    - equipment-aware coaching and "accurate dumbbell weights" (1.3.8);
    - an equipment scanner that identifies machines from a photo (1.3.2; the site says GPT-4 Vision).
    Stack ranges and a max per machine aren't documented. The site's swap examples are approximate ("~80kg", "~70-75kg").
  - **Lock screen and voice:**
    - a rest timer on the Lock Screen and Dynamic Island, and a Watch timer (1.2);
    - an audio rest countdown (1.3.3);
    - mid-workout coach voice cues (changelog, week of 7 Jun 2026), "generated by AI" with TTS (site).
  - **Offline: conflict.**
    - The site says "All AI decisions run client-side. Full functionality without connectivity" and "All AI decisions run locally with cached models".
    - The privacy policy (updated 24 Feb 2026) names Anthropic and OpenAI as AI providers and Supabase (EU) as the database host. The only on-device storage it mentions is localStorage for workouts in progress ([privacy](https://arvo.guru/privacy)).
    - The GB listing makes no offline claim.
    - [Inference] Logging may survive a dropped connection, but the AI almost certainly needs the network.
  - **External AI:** an open-source MCP server (29 tools, OAuth) that can write workouts and log sets ([developer](https://arvo.guru/developer)). No confirm or undo is documented. After you disconnect ChatGPT, issued tokens stay valid until they expire (refresh tokens last 90 days) ([support](https://arvo.guru/support)).
  - **Data:** a portable account archive and a workout-only CSV export (support), history import from apps such as Fitbod (1.3.7), and plan export (changelog).
- **Users say [User].** No written reviews on the GB or US pages checked.
- **For GymSmarter.**
  - [Inference] Arvo documents more of GymSmarter's combination than any other app: AI that edits and logs during the session, plates per gym, and lock-screen rest. What it doesn't document:
    - version-checked proposals that are rejected when stale;
    - Undo for coach edits or logged sets;
    - a max per machine;
    - a labelled no-AI fallback.
    Its offline claim is contradicted by its own policy. The headline claim therefore survives only in narrowed form, and it rests on absence of evidence.
  - Avoid marketing AI as offline when it calls a cloud model. Rule 1 requires honest status.
  - Avoid write tools for external AIs without confirm or undo (rules 2 and 5). Avoid tokens that outlive a disconnect (rule 7).
  - Only Ben could test Arvo's real behaviour, and that would need an account.

#### GymStreak (new in pass 2)
- **What it is [Doc].**
  - An AI personal trainer app on iOS (17.6+) and Android, by GymStreak Ltd ([site](https://www.gymstreak.com/); [GB](https://apps.apple.com/gb/app/gymstreak-ai-personal-trainer/id1371187280)).
  - Premium is needed for workout logging, the AI coach and food search. GB items cost £11.49–£89.99.
  - Rated 4.6 from 5.1K GB and 4.7 from 15.9K US; v6.4.3 (27 Aug 2026).
  - The label says data including Health & Fitness, identifiers and usage data is used to track you (GB listing, checked in the critic pass).
- **Notable [Doc].**
  - The AI coach "can create and edit workouts in your plan", with chat and a daily briefing. Whether it adjusts loads, and whether changes need confirmation or can be undone, isn't stated.
  - Plans are built from the equipment you say you have.
  - Ticking a set starts the rest timer, which shows in a Live Activity.
  - Logging from the Watch; Apple Health or Health Connect sync.
- **For GymSmarter.**
  - [Inference] Putting logging behind a paywall is the opposite of rule 1's spirit (logging always works).
  - It's another AI coach that edits plans with no documented undo.
  - Being a UK seller doesn't change anything here.

#### Fitness AI (new in pass 2)
- **What it is [Doc].**
  - iOS and Apple Watch, by FitnessAI Inc ([site](https://www.fitnessai.com/); [GB](https://apps.apple.com/gb/app/fitness-ai-gym-workout-planner/id1446224156)).
  - GB items cost £3.99/wk to £89.99/yr. Rated 4.6 from 3.3K GB and 4.7 from 56K US; v24.1 (30 Sep 2026).
  - Identifiers and usage data are used to track you.
- **Notable [Doc].**
  - "automatically optimizes weight lifting sets, reps and weights for each exercise every time you work out", from a dataset the listing puts at 5.9M workouts.
  - Works "with whatever equipment you have available".
  - A "training reset algorithm" (17.0, 11 Apr); a Progress tab with Strength Progress charts (22.0, 12 Aug).
  - No chat coach is documented.
- **For GymSmarter.** [Inference] The algorithm is a black box: nothing explains how each number is chosen. That's the contrast case for "Why this number?" (Opportunity #3).

#### LiftTrack / Max
- **What it is [Doc].**
  - On iOS (Android per the vendor).
  - Free: 3 of your own workouts, phone tracking, sending to Garmin, and read-only ChatGPT/Claude.
  - Premium costs $7.99/mo; $49.99/yr and $59.99/yr are both listed. Rated 4.8 from 135 US (43 GB); v6.3.0 (3 Oct 2026) ([site](https://lifttrackapp.com/); [App Store](https://apps.apple.com/us/app/lifttrack-strength-training/id6736655105); [GB](https://apps.apple.com/gb/app/lifttrack-strength-training/id6736655105)).
- **Notable [Doc].**
  - A Garmin strength round trip; phone tracking since 6.1.1 (18 Sep 2026). "Phone-recorded workouts stay in LiftTrack and do not export to Garmin Connect" (GB listing).
  - Deterministic linear/double progression with a **"Next time" Accept/Skip** step: "Nothing in the workout changes until you tap Accept" ([progressions](https://lifttrackapp.com/progressions-in-the-lifttrack-app/)).
  - Max reads history, maxes and equipment, shows "Used N tools" and remembers injuries. Workout cards save nothing until you tap Create. Chat clears on restart, and there is a weekly cap ([ask Max](https://lifttrackapp.com/ask-max-your-coach-in-lifttrack/)).
  - **Conflict:** the 6.3.0 notes add a Coach tab, approval cards for workout and training-max changes, and one-off scheduling via Max, ChatGPT or Claude. The help page dated 26 Sep says none of them can change the schedule. ChatGPT and Claude can permanently delete workouts ([what Max can do](https://lifttrackapp.com/what-max-chatgpt-and-claude-can-do/)).
  - "Discard workout deletes the session and every set logged in it, with no second step" ([phone tracking](https://lifttrackapp.com/track-a-workout-on-your-phone/), updated 26 Sep 2026). Rest timers have audio alerts. Offline isn't documented.
  - A Training screen with weekly load and volume ([training](https://lifttrackapp.com/training-load-weekly-volume-lifttrack/)).
  - Usage Data is used to track you.
- **Users say [User].**
  - Praise: the Garmin flow, and pushing workouts from ChatGPT.
  - Complaints: the planner produced 0 lb sets even with a 1RM set; buried notes ([reviews](https://apps.apple.com/us/app/lifttrack-strength-training/id6736655105?see-all=reviews)).
- **For GymSmarter.**
  - Copy: the Accept/Skip review and approval cards.
  - Beat it on: chat that persists, edits to today's sets with Undo, honest status when a cap is hit, and a confirm or Undo on Discard.
  - Coach tools must never destroy history.
  - See Proposed brief change 3.

#### Fitbod
- **What it is [Doc].**
  - iPhone (iOS 18+), Watch, Android and Wear OS.
  - US prices are listed as Monthly $12.99 and $15.99 and Yearly $79.99 and $95.99. The FAQ gives $15.99/mo and $95.99/yr on the web, with a 7-day trial ([FAQ](https://fitbod.me/faqs/)).
  - Rated 4.8 from 287K US (16K GB); v8.35.1 (6 Oct 2026) ([App Store](https://apps.apple.com/us/app/fitbod-gym-fitness-planner/id1041517543); [GB](https://apps.apple.com/gb/app/fitbod-gym-fitness-planner/id1041517543)).
- **Notable [Doc].**
  - Generates each session from history, equipment and an estimated recovery of 0–100% per muscle, which can be overridden. Day-one loads are conservative, and RIR is used to calibrate ([how Fitbod works, updated 2026-10-08](https://help.fitbod.me/hc/en-us/articles/360004429814-How-Fitbod-Creates-Your-Workout)).
  - Gym locations, each with its own units ([gyms](https://help.fitbod.me/hc/en-us/articles/360006427453-Sharing-a-Workout-Gym-Location-Settings)).
  - The plate calculator covers barbell and plate-loaded machines, but the same article's FAQ says barbell only ([plates](https://help.fitbod.me/hc/en-us/articles/360007700013-Plate-Calculator)).
  - A Live Activity ([widget](https://help.fitbod.me/hc/en-us/articles/360058341233-iOS-Widget)).
  - Generated workouts can be completed offline; PRs and full history need the server ([offline](https://help.fitbod.me/hc/en-us/articles/360006572594-Can-I-use-Fitbod-without-an-internet-connection)).
  - **Injuries and Limitations** excludes exercises that stress the chosen area, and then "Update Plan" applies to future workouts; "not medical advice" ([injuries](https://help.fitbod.me/hc/en-us/articles/37629269518103-Injuries-and-Limitations)).
  - **Any refresh, including a background import from Health, Strava or Fitbit, regenerates the workout and replaces edits made before Start** ([refreshes](https://help.fitbod.me/hc/en-us/articles/42333470514455-Why-did-my-workout-change-Understanding-workout-refreshes)).
  - The US listing describes no voice coaching or charts. It mentions Apple Health, Strava, Fitbit and Watch integration, and a "Workout Insights" event with coaching tips. Every release note since July 2026 says only "Bug fixes and improvements".
  - Usage Data is used to track you.
- **Users say [User].**
  - Praise: gym profiles, "does the work for me".
  - Complaints:
    - It "regularly expects you to … double". The developer replied that this isn't expected behaviour ([GB](https://apps.apple.com/gb/app/fitbod-gym-fitness-planner/id1041517543?see-all=reviews)).
    - A 30 kg warm-up ([AU](https://apps.apple.com/au/app/fitbod-gym-fitness-planner/id1041517543?see-all=reviews)).
    - Weights reset after an injury.
    - Users want to edit logs "without inserting any AI logic".
    - Watch freezes ([US](https://apps.apple.com/us/app/fitbod-gym-fitness-planner/id1041517543?see-all=reviews)).
    - The coach gives "a generic sentence".
    - Trials auto-converted to an annual charge ([Trustpilot](https://www.trustpilot.com/review/fitbod.me)).
    - Loads below the empty bar, and 17.5 on a machine that goes 15→20. This is an r/xxfitness post from 2024, read in pass 1 through a third-party mirror. Reddit can't be fetched, so it's **unverified**, and nothing below relies on it alone.
- **For GymSmarter.**
  - Add tests that an import never changes planned or pending sets, and that loads are never below the empty bar or between steps.
  - Keep the pre-injury baseline.
  - Explain each number.
  - Let Ben switch coach commentary off (rule 1).

#### Gravl
- **What it is [Doc].**
  - iOS 16.4+ with a standalone Watch app, Android/Wear OS, and about 70 Garmin models ([Garmin](https://gravl.ai/help/gravl-on-your-garmin-watch)).
  - $14.99/mo, $34.99/3 mo, and yearly $59.99, $79.99 or $89.99. Rated 4.9 from 5.8K US (332 GB); v1.53.4 (5 Oct 2026) ([App Store](https://apps.apple.com/us/app/personal-trainer-gravl/id6450921637); [GB](https://apps.apple.com/gb/app/personal-trainer-gravl/id6450921637)).
- **Notable [Doc].**
  - Published progression rules ([blog, 16 Jul 2026](https://gravl.ai/blog/how-gravl-algorithm-works)):
    - e1RM from every set;
    - a rep ladder, then one equipment step;
    - e1RM rises at most about 10% per session;
    - easing after more than 2 weeks off;
    - deloads excluded.
  - A **"Why 40 kg today?"** sheet per exercise. "Adjust all recommended weights" (down by up to 60%) **can't be undone** ([science](https://gravl.ai/help/gravl-science-understand-your-recommended-weights)).
  - Multiple gyms, stacks read from a photo, machine 1RMs per gym, and **no gym switch during a workout** ([gyms](https://gravl.ai/help/gravl-gym-set-up-profiles-and-available-equipment)).
  - **Injury UX** ([injury](https://gravl.ai/help/train-around-an-injury)):
    - flags movements, not muscles;
    - labels workouts "Adjusted for injuries";
    - tags exercises "May hurt", with "Add anyway";
    - asks "Does this still hurt?" every two weeks;
    - says "No safe workout available" when nothing fits;
    - doesn't diagnose.
    The listing adds injury-aware workout explanations (1.53).
  - Failed saves retry automatically (1.53.x).
  - A REST API and an MCP server ([gravl.ai](https://gravl.ai/)).
  - A single "Strength Score" tracks progress (site). Trainer videos can be downloaded for offline use. Effort can be rated on cardio exercises (1.53.4). History export (1.44) (GB listing).
  - **Voice:** in-workout coaching is described as "set logging, rest timers, weight suggestions, exercise swaps", with no voice. **No pause on phone calls is documented.** Pass 1's claim of one was unsupported and has been removed.
  - Identifiers are used to track you.
- **Users say [User].**
  - Praise: works around shoulder and back problems; "I switched from Fitbod".
  - Complaints: no EZ or short-bar types; it sends you back and forth between stations; freezes during search and swaps; cardio doesn't count ([reviews](https://apps.apple.com/us/app/personal-trainer-gravl/id6450921637?see-all=reviews)).
- **For GymSmarter.**
  - The best reference for explaining each target and for pain UX.
  - Do better: a gym switch mid-workout.
  - Avoid global adjustments that can't be undone (rules 2 and 5).
  - Send its rules to the training-researcher as candidates, not facts.

#### SensAI
- **What it is [Doc].**
  - iOS 26+, with a Watch companion since 1.1.5. $6.99/mo or $69.99/yr. Rated 4.6 from 37 US (1 GB); v1.1.6 (30 Sep 2026) ([App Store](https://apps.apple.com/us/app/id6738963099); [GB](https://apps.apple.com/gb/app/sensai-fitness-sensei/id6738963099)).
  - SensAI publishes many "reviews" of its rivals, so treat its blogs as biased.
- **Notable [Doc].**
  - An LLM coach ("same technology behind ChatGPT and Claude"; [FAQ](https://www.sensai.fit/faq)).
  - Smart Swap/Modify during a workout, quick-action chips, interactive cards, and a memories indicator.
  - A **change-summary card** when the coach changes settings (1.1.6).
  - Editing a set updates matching upcoming sets.
  - The programme regenerates every week.
  - Logging works offline: "AI features and fetching new plans need internet" (GB listing).
  - You can enter pain, injuries or limitations for the coach (1.1.1). Changes are typed: "Just type what you need".
  - The coach reads HRV, sleep and resting heart rate from Apple Health. No file import is documented (GB listing).
  - Label: email and name are linked to you; no tracking.
- **Users say [User]** ([US reviews](https://apps.apple.com/us/app/id6738963099?see-all=reviews); dates as shown, no years):
  - Praise: easy to change things by asking.
  - Complaints:
    - "An AI trainer that forgets the training plan": "the AI removed the carries without putting halos in the trackable workout" ("2d ago").
    - If an exercise isn't in the library, "you can't add it" (Aug 11).
    - "you can get better recommendations for less money with one of the chat bots" (Sep 14).
- **For GymSmarter.**
  - [Inference] Chat during the workout is no longer a differentiator by itself.
  - Copy the chips, cards, memory indicator and change summaries.
  - The coach must never claim a change without a committed action.
  - Avoid weekly regeneration (rule 3).

#### JuggernautAI
- **What it is [Doc].**
  - iPhone/iPad (15.6+), no Watch; Android.
  - $34.99/mo or $349.99/yr on the web, with a 2-week trial. Rated 4.8 from 5.7K US (306 GB) ([App Store](https://apps.apple.com/us/app/juggernautai/id1515756471); [site](https://www.juggernautai.app/)).
  - Rebuilt in 3.0.0 (11 Aug 2026, per the version history on the [GB listing](https://apps.apple.com/gb/app/juggernautai/id1515756471); latest 3.0.12, 24 Sep 2026), adding a readiness score and a Live Activity rest timer.
- **Notable [Doc].**
  - A readiness check-in, and adjustment at set, day, week and block level ([help 3](https://help.jtsstrength.com/en/articles/3-how-juggernautai-is-individualized-to-you)).
  - Suggests a weight **range**, and you place yourself in it from how the warm-ups felt ([help 2](https://help.jtsstrength.com/en/articles/2-all-about-rpe-and-rir)).
  - Separate automatic rest for main lifts and accessories (3.0.3).
  - No in-app chat.
  - Offline use and import/export aren't documented on the GB listing or in the help collections ([help](https://help.jtsstrength.com/en/)). A "Rehab & Injury Workarounds" help collection exists.
  - Data is used to track you.
- **Users say [User].** Complaints: too light (2021–22); warm-ups ignore the readiness cap; timer notifications "inconsistent" (2023, before the rebuild) ([reviews](https://apps.apple.com/us/app/juggernautai/id1515756471?see-all=reviews)).
- **For GymSmarter.**
  - Show the basis of each load (e1RM or training max, with its date) and let Ben correct it.
  - Test that warm-ups obey caps and pain blocks.
  - The range-from-warm-ups pattern is a playbook candidate.

#### RP Hypertrophy
- **What it is [Doc].**
  - A native iOS app since Dec 2025, plus a web app.
  - $34.99/mo or $299.99/yr, with no trial; a 30-day refund applies to purchases on the website only ([site](https://rpstrength.com/hypertrophy-app)).
  - Rated 4.3 from 239 US (23 GB); v1.7.0 (1 Oct 2026) ([App Store](https://apps.apple.com/us/app/rp-hypertrophy/id1555614554); [GB](https://apps.apple.com/gb/app/rp-hypertrophy/id1555614554)).
- **Notable [Doc].**
  - Pump, soreness and workload feedback drive load and sets each week.
  - Muscle priorities.
  - 250+ technique videos and a Meso Builder.
  - No AI.
  - The GB listing doesn't mention gym profiles, a rest timer, import/export, offline use or pain handling.
  - The label says Usage Data is used to track you.
- **Users say [User].**
  - The joint-pain parameter "doesn't do anything"; "35+$ a month for something this simple" ([Trustpilot](https://www.trustpilot.com/review/renaissanceperiodization.com)).
  - Users want per-side logging, a rest timer and a cardio log (App Store).
- **For GymSmarter.**
  - A pain input must visibly change something (`halted_pain`, PainFlagNote).
  - A low-effort pump/soreness rating is an optional signal.

#### Dr. Muscle
- **What it is [Doc].**
  - iOS, Android and web. The App Store lists $49.99/mo or $399.99/yr ([App Store](https://apps.apple.com/us/app/dr-muscle-ai-personal-trainer/id1073943857)).
  - The vendor lists $49/mo or $389/yr, plus a free plan ([vendor](https://dr-muscle.com/what-makes-dr-muscle-different/)).
  - The label lists only an email address, not linked to you. History can be viewed online.
- **Notable [Doc].**
  - A plateau deload per exercise (halve the sets, −10% load).
  - Rest-pause by default.
  - Lighter sessions after breaks.
  - AI chat that the vendor says is reviewed by a human. The App Store describes chat with "your human coach" instead.
  - Its changelog fixed "AI chat not responding" (8 Sep 2026) ([changelog](https://dr-muscle.com/chat-ai-trainer/)).
- **For GymSmarter.**
  - Send the deload and post-break rules to the training-researcher as candidates.
  - The chat outages reinforce rule 1.

#### Planfit
- **What it is [Doc].**
  - iOS 15.1+ and Android; Watch on Premium.
  - The planner and log are free. Premium costs $11.99–$14.99/mo or $79.99–$89.99/yr. Rated 4.8 from 8.2K US (1.4K GB) ([App Store](https://apps.apple.com/us/app/id1511876936)).
- **Notable [Doc].**
  - Plans are matched to "9M+ pieces of equipment mapped".
  - Spoken guidance: "Audio guidance talks you through each set, rep, and rest period" ([site](https://planfit.ai/)).
  - Several 2026 releases fixed voice cutting out and stopping in the background (3.226.7, 3.232.7).
  - Its web guides have "How it should feel" and "Signs you're off" sections ([deadlift](https://planfit.ai/en/exercise/deadlift)).
- **Users say [User].** In Airplane mode "it simply doesn't work at all"; the coach "repeats itself between sets"; the rest timer resets ([justuseapp](https://justuseapp.com/en/app/1511876936/planfit-gym-fitness-planner/reviews), [App Store](https://apps.apple.com/us/app/id1511876936?see-all=reviews)).
- **For GymSmarter.**
  - Rule 1 is a real differentiator.
  - Background spoken cues are fragile, so keep them an opt-in experiment (brief v0.2).
  - Don't repeat cues.
  - Add an optional `cues.feel` line.
  - Avoid diagnostic framing (rule 9).

#### MyLiftingCoach
- **What it is [Doc].**
  - iOS 26+. The AI needs an iPhone 15 Pro or later with Apple Intelligence.
  - Pro costs $14.99/mo or $128.99/yr. Rated 4.2 from 5 ([App Store](https://apps.apple.com/app/id6756319402)).
- **Notable [Doc].**
  - An on-device Apple Intelligence coach that works offline (2.6.0, Dec 2025).
  - Warns before changes in the middle of a programme.
  - The label declares tracking, despite a "100% PRIVATE" claim for the AI.
- **For GymSmarter.** [Inference] Apple's on-device model is a possible future offline route for coach explanations. It needs a feasibility spike and is not recommended now (Opportunity #18).

#### GymBuddy (gymbuddy.io)
- A marketing site only, with no App Store link or price found ([site](https://www.gymbuddy.io/)).
- It's a visual reference only, already covered in `docs/research/gymbuddy-visual-reference.md`.
- Its screenshot recommends exercises after surgery, which conflicts with rule 9. No change needed.

### C. Voice-first and auto-capture newcomers

#### RepTalk
- **What it is [Doc].** iPhone; free with a monthly voice allowance; not enough ratings to display.
- **Notable [Doc].**
  - Logs by voice in English or Arabic.
  - "Review and edit every parsed value before saving", and it flags uncertainty instead of guessing.
  - Stores locally and syncs later.
  - Audio data is linked to you, and data is used to track you ([App Store](https://apps.apple.com/app/id6759191361)).
- **For GymSmarter.**
  - Validates the confirm card for `parseSpokenSet` with flagged fields.
  - [Inference] On-device speech avoids uploading audio.

#### Copper
- **What it is [Doc].**
  - iPhone (iOS 18+) and Watch. $12.99/mo or $39.99/yr after a 14-day trial.
  - The pricing copy has an invalid date ("6/31/2026"). One rating ([App Store](https://apps.apple.com/app/id6745196643)).
- **Notable [Doc].**
  - Records from the Watch between sets, with several exercises per recording.
  - Gemini models (cloud) extract the data in about 3 s.
  - Imports Strong, Hevy and Fitbod CSVs.
- **For GymSmarter.**
  - Watch capture belongs in build step 7.
  - [Inference] Queued voice must show as pending, not parsed (rule 1).

#### Ray: AI Personal Trainer
- **What it is [Doc].**
  - iOS 18+, Watch. Premium Access is listed at $19.99, $39.99 and $119.99, with periods not shown. Rated 4.8 from 302 US (1 GB); v1.1.37 (9 Oct 2026) ([App Store](https://apps.apple.com/us/app/id6474633735); [GB](https://apps.apple.com/gb/app/ray-ai-personal-trainer/id6474633735)).
  - Support for users in the UK and Australia was added in 1.1.27 (11 Aug, year not shown).
  - The label says purchases and identifiers are used to track you.
- **Notable [Doc].** A spoken coach during the workout, with "clear audio cues" for each rep; memory you can edit; adjusts for reported injuries such as shoulder pain; an incoming phone call pauses the workout (1.1.22, 1 Jul, year not shown).
- **Users say [User]** ([US reviews](https://apps.apple.com/us/app/id6474633735?see-all=reviews)):
  - "it says it's making the change but the workout stays exactly the same" (Apr 24, year not shown). The developer replied that they're "working on improving these features right now".
  - "my progress reset back to week one" (Aug 10, year not shown).
  - It needs "being able to adjust workout time while in the workout" (1 Oct 2025).
- **For GymSmarter.** The clearest evidence for tying coach text to committed actions (rules 2 and 5).

#### Amrap
- **What it is [Doc].**
  - iPhone, iOS 18+. $19.99/mo, $59.99/6 mo or $99.99/yr. Rated 4.8 from 32 US (2 GB); v3.0.7 (2 Oct 2026) ([App Store](https://apps.apple.com/us/app/id6758109776); [GB](https://apps.apple.com/gb/app/amrap-gym-coach-workout-log/id6758109776)).
  - The label says purchases, contact info, identifiers, usage data and diagnostics are used to track you.
- **Notable [Doc].** A "voice-led gym coach": "You speak and it listens, logs and talks back at you, right in your ear". Programmes are built through conversation, and it adjusts weights and reps during the session. Offline use and where processing happens aren't stated.
- **Users say [User]** ([US reviews](https://apps.apple.com/us/app/id6758109776?see-all=reviews); no years shown; the reviews run Feb–Jun, [Inference] 2026):
  - "your gym better have good WiFi" (Apr 6).
  - "When the weight it recommends isn't available, it adjusts the reps" (Mar 4).
- **For GymSmarter.** On-device speech plus a deterministic parser keeps voice logging offline (brief v0.2).

#### Motra (formerly Train Fitness; new in pass 2)
- **What it is [Doc].** "Train Fitness has rebranded to Motra." Based in Toronto. No price or App Store ID is given on the site ([site](https://motra.com/)).
- **Notable [Doc, vendor claims].**
  - Detects 470+ exercises automatically from Apple Watch motion.
  - Uses acceleration, velocity and tempo to adjust weight. The page's wording is garbled, so this is a paraphrase.
  - AI-generated workouts, recovery insights and a community feed.
- **For GymSmarter.** Watch auto-capture belongs in build step 7, and wearables are parked (v0.9). Velocity-based loading is out of scope.

### D. Human coaching services

#### Caliber
- **What it is [Doc].**
  - A free logger on iPhone and Android. Plus costs $9–$12/mo or $36–$72/yr.
  - Rated 4.84 from 5,998 US (545 GB); v5.16.1 (8 Sep 2026) ([App Store](https://apps.apple.com/us/app/caliber-strength-training/id1482405410); [workout app](https://caliberstrong.com/workout-app/)).
- **Notable [Doc].**
  - A first-party MCP server for ChatGPT and Claude (5.15.0, 20 Jul 2026).
  - Offline Mode.
  - Data export (format undocumented).
  - A Strength Score.
- **Users say [User].** The relative-strength score is "more confusing and discouraging than helpful" ([reviews](https://apps.apple.com/us/app/caliber-strength-training/id1482405410?see-all=reviews)).
- **For GymSmarter.**
  - AI that reads your history is now common, so the coach has to act during the session.
  - Avoid composite scores (rule 6).

#### Trainwell
- **What it is [Doc].**
  - $149/mo, billed in 3-month increments. "No AI bots pretending to care" ([site](https://www.trainwell.net/)).
  - Rated 4.9 from 5,542 US ([lookup](https://itunes.apple.com/lookup?id=1466445684&country=us)). In the GB store with 208 ratings; v32.3.0 (6 Oct 2026). Whether the coaching service runs in the UK is unknown.
- **Notable [Doc].**
  - Watch motion tracking for the human trainer ([help](https://help.trainwell.net/en/articles/2749120)).
  - A Live Activity on the Lock Screen and Dynamic Island (31.5.0, 31 Mar 2026).
  - Fixes for offline startup ([App Store](https://apps.apple.com/us/app/trainwell-personal-training/id1466445684)).
- **Users say [User].** Coaches were "slack-y with advancing my workout difficulty" (2024) ([Trustpilot](https://www.trustpilot.com/review/trainwell.net)).
- **For GymSmarter.**
  - Offers driven by signals, plus the fallback rule, mean progress doesn't depend on someone's attention.
  - [Inference] Whether rest notifications reach a paired Watch needs a device test.

#### Ladder
- **What it is [Doc].**
  - iPhone, Watch and web; no Android. PRO costs $29.99/mo or $179.99/yr ([pricing](https://www.joinladder.com/pricing)).
  - Rated 4.95 from 205,582 US ([lookup](https://itunes.apple.com/lookup?id=1502936453&country=us)) and 4.92 from 15,498 GB; v4.14.0 (6 Oct 2026, new settings and meal reminders).
- **Notable [Doc].**
  - Team plans written by a coach, "not algorithm-generated".
  - In-ear coach audio that ducks Spotify or Apple Music ([llms.txt](https://www.joinladder.com/llms.txt)).
  - Coach audio now returns after a phone call during a workout. Pass 1 dated this 4.13.0 (12 Sep 2026); the US listing now shows it under 4.13.1.
  - Plateau alerts per movement, with mute (4.10.0, 6 Jul 2026).
  - Offline downloads (4.13.1).
  - A "built-in timer"; no Live Activity is documented.
  - Identifiers are used to track you ([App Store](https://apps.apple.com/us/app/ladder-strength-training-plans/id1502936453)).
- **For GymSmarter.**
  - Plateau offers with a per-movement mute (playbook rule 8, offer only).
  - Add ducking and resume-after-call to the audio tests.

#### Future (not in the UK store)
- **What it is [Doc].**
  - US only, and absent from the GB App Store ([GB lookup](https://itunes.apple.com/lookup?id=6450921637,1502936453,1466445684,1288178982,1482405410,6670271875&country=gb)). $199/mo, or prepaid at $537 for 3 months, $1,014 for 6 or $1,788 for 12 ([pricing FAQ](https://faq.future.co/en/articles/12073382-membership-plans-pricing), 5 Feb 2026).
  - Rated 4.87 from 10,718 US ([lookup](https://itunes.apple.com/lookup?id=1288178982&country=us)).
- **Notable [Doc].**
  - Future decided not to launch its AI-trainer beta for members ([Athletech, 19 Jun 2026](https://athletechnews.com/future-pulls-the-plug-on-ai-personal-training-commits-to-human-coaches/)).
  - In-workout controls: Report Your Reps, Adjust Your Weight, Flag/swap, Repeat Cues and Exercise History ([workout FAQ](https://faq.future.co/en/articles/12073331-what-should-i-expect-from-a-future-pro-workout)).
- **Users say [User].** Coaches carry 85–100+ clients; injury concerns were ignored (2022) ([Trustpilot](https://www.trustpilot.com/review/future.co)).
- **For GymSmarter.**
  - [Inference] "AI personal trainer" alone isn't a moat.
  - Copy the compact set of in-workout controls.
  - Rule 9 is a visible difference.
  - Ben can't use it in the UK.

### E. Wearable and OS platforms (wearables are parked, v0.9)

#### Apple Workout Buddy (watchOS 27)
- **What it is [Doc].**
  - Free. Needs watchOS 27, an Apple Intelligence iPhone and Bluetooth headphones, with the device and Siri language set to English or Spanish ([support](https://support.apple.com/guide/watch/use-workout-buddy-apd65c7938e6/watchos)).
  - Apple says Apple Intelligence is "not available in all regions or languages", and that Siri AI won't initially be available in the EU. [Inference] The UK isn't excluded.
  - Works without the iPhone on Series 9 or later ([newsroom, 9 Sep 2026](https://www.apple.com/newsroom/2026/09/apple-advances-health-and-fitness-capabilities-using-apple-intelligence/)).
- **Notable [Doc].**
  - Covers "Functional and Traditional Strength Training" among other workout types.
  - It offers:
    - encouragement based on your history and the current workout;
    - milestones;
    - pace, distance and duration insights;
    - a summary at the end;
    - mute with a swipe (support).
  - No load coaching is described.
  - The Readiness score is limited to Series 12 and Ultra 4.
  - Apple reportedly scaled back "Project Mulberry" ([9to5Mac](https://9to5mac.com/2026/02/05/apple-reportedly-scales-back-plans-for-ai-powered-health-coach/)).
- **Users say.** Pass 1 quoted a press review calling it "a cheerleader" (CNET via Yahoo). That couldn't be re-opened, so it has been dropped in favour of Apple's own description above.
- **For GymSmarter.**
  - Copy its sparse cues and one-gesture mute.
  - Don't assume an Apple readiness signal exists (rule 6).

#### WHOOP Coach and Strength Trainer
- **What it is [Doc].**
  - Needs a WHOOP band. Memberships cost $199, $239 or $359/yr according to a third party ([trackervs](https://trackervs.com/pricing/whoop-pricing/); **third-party, unverified**: whoop.com returned 403).
  - Rated 4.81 from 85,447 ([lookup](https://itunes.apple.com/lookup?id=933944389&country=us)).
- **Notable [third-party press].**
  - AI builds strength workouts from words or a screenshot (beta) ([G&W](https://gadgetsandwearables.com/2026/02/22/whoop-ai-beta/)).
  - Muscular load ([G&W](https://gadgetsandwearables.com/2026/05/22/whoop-strength-trainer-2/)).
  - Memory, with toggles per entry ([G&W](https://gadgetsandwearables.com/2026/05/08/whoop-memory/)).
- **Users say [User].** Forum users, Jun–Jul 2026, ask for ([request](https://www.community.whoop.com/t/request-true-ai-strength-coach-better-workout-flow-and-weight-tracking/15450), [2.0](https://www.community.whoop.com/t/unlock-strength-trainer-potential-2-0/15185), [agentic logging](https://www.community.whoop.com/t/allow-coach-to-agentically-log-strength-exercises/13984)):
  - a persistent plan the coach works from;
  - RPE per set;
  - a Live Activity with Start Set and Next Set;
  - AI without leaving the workout.

  They also complain that logging is too slow and that agentic logging didn't work.
- **For GymSmarter.** [Inference] This is GymSmarter's design requested almost point by point. The failure mode to avoid is regenerating standalone sessions. Copy the per-memory toggles.

#### Garmin Connect+ and Garmin Coach
- **What it is [Doc].** Connect+ costs $6.99/mo or $69.99/yr ([press](https://www.garmin.com/en-US/newsroom/press-release/wearables-health/elevate-your-health-and-fitness-goals-with-garmin-connect/)). Coach plans are free ([blog](https://www.garmin.com/en-US/blog/?p=35760)).
- **Notable [Doc].**
  - Rep counts detected automatically, which you can edit on the phone mid-session.
  - Third-party apps can't write strength sets ("addSet() does not exist") ([the5krunner](https://the5krunner.com/2026/03/24/garmin-connect-plus-strength-apps/)).
  - Garmin acquired TrainingPeaks and TrainHeroic (22 Jul 2026) ([press](https://www.garmin.com/en-US/newsroom/press-release/corporate/garmin-acquires-trainingpeaks-and-trainheroic-leading-endurance-and-strength-training-platforms-for-athletes-and-coaches/)).
- **Users say [User].** Active Intelligence "continues to restate thin insights" ([the5krunner, updated 8 Oct 2026](https://the5krunner.com/2026/04/20/garmin-connect-plus-review/)).
- **For GymSmarter.**
  - GymSmarter stays Ben's strength record.
  - Avoid scheduled "insight" pushes (rule 3).

#### Oura Advisor
- **What it is [Doc].** Membership costs $5.99/mo or $69.99/yr ([support](https://support.ouraring.com/hc/en-us/articles/4409086524819)).
- **Notable [Doc].** Saved memories you can review and delete, a tone setting, and a check-in frequency setting ([blog](https://ouraring.com/blog/oura-advisor/)).
- **For GymSmarter.**
  - Copy memory review/delete and a check-in frequency that defaults to "only when asked or on a clear signal" (rule 3).
  - A health memory should become a pain flag (rule 9).

#### Google Health (Fitbit) Coach
- **What it is [Doc].**
  - Premium costs $9.99/mo or $79.99/yr, and the coach is "available in certain countries" ([App Store](https://apps.apple.com/us/app/google-health-fitbit/id462638897)).
  - The public preview (27 Oct 2025) began in the US on Android for eligible Premium users, with iOS "soon" ([public preview](https://blog.google/products-and-platforms/devices/fitbit/personal-health-coach-public-preview/)). The UK isn't mentioned, and its current availability is unverified.
  - The iOS preview needed a Fitbit or Pixel Watch ([iDropNews](https://www.idropnews.com/news/fitbit-ai-coach-ios-apple-health-plus-scaling-back/259712/)).
- **Notable [Doc].**
  - A Gemini coach that builds multi-week plans, including strength, and accounts for the equipment you have.
  - It adjusts for "My knee is bugging me".
  - Deleting a chat stops it informing the coach ([hands-on](https://blog.google/products-and-platforms/devices/fitbit/hands-on-personal-health-coach-features/)).
- **Press [unverified].** Lifehacker reportedly said it "keeps forgetting goals" and "can't do math well enough to keep a workout under 30 minutes" ([Lifehacker](https://lifehacker.com/health/i-used-fitbits-ai-for-a-week-and-ive-never-had-a-worse-coach)). This is known only from a pass-1 search summary; the article wasn't opened, so nothing relies on it.
- **For GymSmarter.**
  - Domain code computes time budgets; the coach only sets priorities.
  - Copy chat deletion.

#### Samsung Health
- Current Galaxy Watches need Google Play services, which iOS doesn't support ([Samsung](https://www.samsung.com/ca/support/mobile-devices/what-phones-are-compatible-with-your-samsung-smartwatch/), 11 Sep 2026). So it can't reach Ben's iPhone.
- Its single composite scores ([press](https://www.samsungmobilepress.com/articles/galaxy-watch-ai-health-features)) reinforce brief §3: keep cardio and lifting separate.

### F. Hybrid and endurance (tracked for completeness only)

#### Runna (owned by Strava)
- **What it is [Doc].** $19.99/mo or $119.99/yr ([pricing](https://www.runna.com/pricing)). Rated 4.8 from 35K ([App Store](https://apps.apple.com/us/app/runna-running-training-plans/id1594204443)).
- **Notable [Doc].**
  - "Strength sessions sit outside the adaptive running plans". There are no custom sessions or swaps, and a manual strength log records duration only ([support](https://support.runna.com/en/articles/15624879-adding-strength-training-to-your-runna-plan)).
  - Duplicate activities are matched on start time within 60 s, and duplicates are excluded from totals ([duplicates](https://support.runna.com/en/articles/9776737-handling-duplicate-activities)).
- **Users say [User].**
  - The strength workouts are "pretty lame" ([Trustpilot](https://ie.trustpilot.com/review/runna.com)).
  - Praise: "I love that it does NOT adapt to my watch sleep/body battery" ([App Store](https://apps.apple.com/us/app/runna-running-training-plans/id1594204443?see-all=reviews)).
- **For GymSmarter.**
  - Strength is second-class in endurance apps [Inference].
  - Reuse the dedupe rule for any later FIT import (step 6).

#### Strava (strength)
- A strength log, and data from partner apps since 21 May 2026 ([press](https://press.strava.com/articles/strava-overhauls-strength-experience-with-expanded-partner-ecosystem-new-workout-log-and-muscle-maps)).
- The API policy (effective 1 Jun 2026) bans AI use of API data (§5.3), but lets subscribers bring their own AI through the Strava MCP (§3.5) ([policy](https://www.strava.com/legal/api_policy)).
- No change for GymSmarter; brief line 122 already covers this.

#### TrainingPeaks
- Premium costs $19.99/mo or $134.99/yr ([App Store](https://apps.apple.com/us/app/trainingpeaks-plan-train-lift/id408047715)). Now owned by Garmin.
- [User] UserVoice requests ask for Strong-like logging and CSV import from Strong, Hevy and Liftin without duplicates. One user "still uses Strong" ([UserVoice](https://peaksware.uservoice.com/forums/106657-trainingpeaks-customer-feedback/suggestions/48991325-strength-metrics)).
- [Inference] Putting strength on its TSS scale goes against brief §3.

#### Athletica
- $19.90/mo or $189/yr ([pricing](https://www.athletica.ai/pricing)).
- [Doc] Strength is logged through Garmin strength mode or a comment field ([HYROX guide](https://athletica.ai/getting-started-hyrox-athletica/)).
- [Doc] "The AI Coach does not automatically modify your training", while the plan engine adapts on its own ([smarter HYROX](https://athletica.ai/smarter-hyrox-training/)).
- [User] "a lot of bugs/quirks of AI" ([App Store](https://apps.apple.com/us/app/athletica-ai-training-plans/id6737747559)).
- This answers the brief's open question: its gym set tracking is shallow (Proposed brief change 1).

#### HYBRD
- **What it is [Doc].** iOS 18+, with many price points. Rated 4.8 from 764 US (31 GB) ([App Store](https://apps.apple.com/us/app/hybrd-get-stronger-and-faster/id6670271875)).
- **Notable [Doc].**
  - The "Brain" coach keeps chat history, reschedules in weekly check-ins, and "can edit completed workouts".
  - Logs from text or photos; custom gyms; Live Activities.
  - Its OAuth MCP exposes `update_completed_workout` and `delete_workout` with no documented confirmation or undo ([tools](https://www.hybrd.com/docs/tools)).
  - ChatGPT is reached through Codex on a paid plan ([MCP](https://www.hybrd.com/mcp)).
- **For GymSmarter.**
  - The closest hybrid AI product.
  - [Inference] GymSmarter's edge has to be guarded, reversible changes plus loads that match the equipment.
  - Its hosted-MCP route conflicts with our local architecture with no HTTP layer.

#### ROXFIT, Repz and HYBRID (Hybrid Performance Method)
- **ROXFIT** ([App Store](https://apps.apple.com/app/id6476465403)) analyses HYROX race splits and has an AI builder (text, voice or photo). One user found every workout logged to Apple Health as a run.
- **Repz** ([App Store](https://apps.apple.com/us/app/id6759493559)) is a HYROX plan app with a "hotel dumbbells" equipment preset and automatic substitutions.
- **HYBRID (HPM)** ([App Store](https://apps.apple.com/us/app/-/id1532118021)) logs sets with RPE, RIR and %1RM inside coach-written programmes. It was last updated Sep 2023, and users report connection errors.
- **For GymSmarter.** The only transferable idea is a travel-gym preset whose substitutions re-snap to that gym's equipment (rule 4; already in `gym-editor.md`).

### G. Exercise guides and connected hardware

#### Muscle & Motion (Strength Training)
- **What it is [Doc].** $14.99/mo or $89/yr. Rated 4.9 from 7.8K ([App Store](https://apps.apple.com/us/app/strength-training-by-m-m/id1302056349)).
- **Notable [Doc].**
  - 1,200+ exercises with 3D animation, with muscles colour-coded as prime movers, synergists, stabilisers and antagonists.
  - Common mistakes listed for every exercise.
  - Offline mode (vendor).
- **Users say [User].** Praise for the "common mistakes"; complaints about broken search and uneven detail ([reviews](https://apps.apple.com/us/app/strength-training-by-m-m/id1302056349?see-all=reviews)).
- **For GymSmarter.**
  - Keep two levels of muscle emphasis (exercise-guides-v2).
  - Consider a static "Don't" frame for 3–5 high-risk lifts later.

#### MuscleWiki (API)
- [Doc] 1,943 exercises, all with video ([API](https://api.musclewiki.com/)).
- [Doc] The terms say "video and image assets may not be stored for offline playback", and it is billed per call ([FAQ](https://api.musclewiki.com/faq)).
- It's incompatible with rule 1. Add it to the "don't use" list in `exercise-bank-and-visuals.md`.

#### Nike Training Club and Gymshark Training
- **NTC** is free, with no update since 19 May (year not shown). The label declares location and sensitive info used to track ([App Store](https://apps.apple.com/us/app/id301521403)).
  - [User] "Videos aren't as useful in hotel gyms and it is easier to swipe back and forth" ([reviews](https://apps.apple.com/us/app/id301521403?see-all=reviews)).
- **Gymshark Training** "will no longer be updated" and is no longer on Android ([support, 27 Jul 2026](https://support.gymshark.com/en/articles/11185911-the-gymshark-training-app)).
- **For GymSmarter.**
  - Never depend on hosted exercise media; keep guides bundled.
  - Keep guides out of the logging loop.

#### Tempo and Tonal (connected hardware)
- **Tempo** gives camera form feedback only with its own colour-coded weights and hardware ([FAQ](https://support.tempo.fit/support/solutions/articles/151000154612-tempo-move-faqs)).
- **Tonal** adjusts resistance per rep and has an AI assistant called "Tia" ([site](https://www.tonal.com/)).
- **For GymSmarter.**
  - Keep automatic form scoring deferred (brief line 157).
  - [Inference] Even hardware companies now ship an AI assistant, so having a coach isn't the edge.

### H. Also noted (one line each, not scored)

From vendor pages checked in the critic pass (2026-10-09). None changes a recommendation.
- **Freeletics:** gym and weights training with an adaptive "Coach", by Freeletics GmbH ([site](https://www.freeletics.com/en/)).
- **Bevel:** AI coach chat "grounded in your own metrics", lift logging, and generated workouts and plans ([site](https://www.bevel.health/)).
- **Setgraph:** a logger with an "AI Workout Generator"; no price shown ([site](https://setgraph.app/)).
- **Peloton IQ:** camera rep counting, form feedback and Suggested Weights with the Digital Weight Rack on Cross Training hardware. "No additional charge", but a membership is required ([site](https://www.onepeloton.com/peloton-iq)).
- **Centr:** "Centr x HYROX Official Equipment" and "HYROX-certified training" ([site](https://centr.com/hyrox)). Listed for completeness only (HYROX is not a special case).
- **Third Space app** (Ben's likely gym): v6.7.2 (28 Sep 2026); 4.8 from 3.9K GB. Video programmes, attendance streaks and bookings. No workout logging, AI, Health integration or equipment information is listed ([GB](https://apps.apple.com/gb/app/third-space/id1440461613)).
- **Not checked yet:** Apple Fitness+, TrainHeroic (Garmin-owned since 22 Jul 2026, see Garmin), Smartgym, Zing.

## Cross-app complaints

These are examples, not a representative survey. They come from App Store reviews, Trustpilot, forums and GitHub; Reddit was unreachable and web search was unavailable in pass 2. "Several apps" below means the reports come from more than one app, not that they are frequent. Each theme lists its evidence, then what follows for GymSmarter.

1. **Wrong or unexplained weights.** Reported against AI and algorithm apps more than any other theme in this sample.
   - Evidence:
     - Fitbod: expects you to "double" and suggests a 30 kg warm-up. Loads below the empty bar come from an unverified Reddit post (see Fitbod).
     - JuggernautAI: too light.
     - LiftTrack: 0 lb.
     - MacroFactor: dumbbells the user doesn't own.
     - Alpha: weights mismatched after a gym switch.
   - For GymSmarter: snap and bound every number, show its basis, and act only on request or a clear signal (rules 3 and 4).
2. **AI that talks but doesn't act, or claims changes that didn't happen.**
   - Evidence:
     - Ray: "says it's making the change".
     - SensAI: forgets the plan.
     - Athletica: only comments.
     - Fitbod: "generic sentence".
     - Planfit: repeats itself.
     - WHOOP: agentic logging broken.
   - For GymSmarter: reply text comes only from committed actions (rules 2 and 5).
3. **AI creep and unwanted re-planning.**
   - Evidence:
     - Fitbod regenerates on background imports and replaces edits made before Start.
     - Users ask to edit logs "without … AI logic".
     - Hevy reviewer: would leave if AI became opt-out-only.
     - Runna praised for *not* adapting to body battery.
   - For GymSmarter: AI is opt-in and quiet; manual edits never trigger re-planning (brief §12).
4. **Rest alerts missed, muted or too subtle.**
   - Evidence:
     - Alpha: "too subtle".
     - MacroFactor: "going silent".
     - FitNotes 2: fails when locked; Live Activity is opt-in.
     - StrongLifts: says silent mode mutes the chime ([doc](https://support.stronglifts.com/article/39-timer)).
     - JuggernautAI (2023) and Planfit: timer resets.
     - Strong: needed three notification fixes in 2026.
   - For GymSmarter: the layered alert must be proven on the device, including silent mode and Focus.
5. **Equipment differs between gyms.**
   - Evidence: Alpha; Liftosaur #282; Gravl blocks the switch; Hevy "equipment weights vary between gyms".
   - For GymSmarter: build `setActiveGym` with re-snap (GE7).
6. **Sync, accounts and data loss.**
   - Evidence:
     - Strong: a second account; disappearing templates.
     - Hevy: Watch sync.
     - MacroFactor: lost sessions.
     - Boostcamp: a session lost when the screen locked (2022).
     - Gravl: needed save retries.
     - Planfit and Amrap: fail offline.
   - For GymSmarter: local-first with no account; defer the Watch.
7. **Lock-in.**
   - Evidence:
     - Strong's export can't be re-imported.
     - MacroFactor imports no history.
     - TrainingPeaks users want CSV import.
   - For GymSmarter: a tested restore round-trip; FitNotes import; a portable export.
8. **Weak pain handling.**
   - Evidence:
     - RP's pain input "doesn't do anything".
     - Fitbod reset weights after an injury.
     - Runna's injury plans are generic.
     - Future's coach ignored an injury.
   - For GymSmarter: a pain flag visibly stops progression, and the coach never diagnoses (rule 9).
9. **Friction in the logging flow.**
   - Evidence:
     - Fitbod: the reps field jumps to weight.
     - Alpha: jumps after the last set; "remove" needs a choice about future workouts.
     - Hevy: a deletion bug.
     - Liftosaur: the "apply" trap.
     - LiftTrack: Discard with "no second step".
   - For GymSmarter: today-only by default, Undo everywhere.
10. **Composite scores that demotivate.**
    - Evidence: Caliber's relative strength; Garmin's "thin insights"; MacroFactor's e1RM rising when lifts get lighter.
    - For GymSmarter: like-for-like trends, with estimates labelled (rule 6).
11. **Paywalls and trial billing.**
    - Evidence:
      - Billing complaints about Fitbod, Runna, Dr. Muscle, Planfit and Future.
      - Free caps: Strong (3 routines), FitNotes 2 (12 workouts) and Liftin' (5 a month).
      - Logging needs a subscription in StrongLifts and GymStreak.
    - For GymSmarter: not applicable. It's a personal app with no subscription.

## What GymSmarter already does differently

An honest comparison, separating what's built from what's only designed.

| Area | GymSmarter status | Nearest competitors | Verdict |
|---|---|---|---|
| vs **ChatGPT used directly** (Ben's realistic alternative) | Text coach designed; ChatGPT-plan route unproven on the iPhone; voice is on-device only | ChatGPT voice mode (Ben already pays for Pro); Hevy's free ChatGPT app saves plans | **Unproven.** The claimed gains (live set context, code-checked loads, Undo, offline logging) must be shown in the baseline check (Opportunity #5) |
| Offline logging with no account | **Built.** No network is used anywhere (critic-pass-1, scenario 8) | FitNotes, FitNotes 2, Liftosaur and Alpha ("Works fully offline") are also local or offline. MacroFactor has only a limited offline mode. Strong and Arvo need an account. Planfit and Amrap fail offline [User] | Done right, but **not unique** |
| Loads on real equipment (plates, per-hand dumbbells, stacks, assisted; min/max; snap down; reps at the ceiling) | **Built** in the domain, with a minimal gym editor. Blocker: Repeat at a gym without the equipment (slice-3 B1) | MacroFactor, Gravl, Alpha and Liftosaur are close. Arvo claims plates per gym (vendor). Hevy and Strong have barbell-only calculators | **At parity with the best.** [Inference] An explicit max per machine plus an explicit load convention is stricter than MacroFactor (no max field), Arvo (none documented) and Hevy (single vs double dumbbells unsolved) |
| Gym switch mid-workout, offered as a proposal that re-snaps pending sets | **Designed** (GE7), not built | Gravl blocks the switch; Liftosaur doesn't re-snap; Arvo has profiles per gym but no switch is documented | Not found elsewhere (absence of evidence) |
| Coach changes as proposals: today vs future, Apply/Undo, rejected if stale | **Designed** only. Only the S1 sign-in spike exists (Developer screen) | Arvo: chat edits workouts and logs sets; Undo is documented only for plan activation. LiftTrack approval cards (no undo documented). Hevy Trainer's scope prompt. SensAI change summaries. MyLiftingCoach's mid-programme warnings | The **full combination** isn't documented elsewhere, but **Arvo is close**. **Unproven until built** |
| Coach through Ben's ChatGPT Pro | Designed; the route is unproven on the iPhone | Hevy's free ChatGPT app; Liftosaur, Caliber, LiftTrack, Gravl, Arvo and HYBRD MCPs; Arvo's in-app GPT-5 | External AI over your history is common. **The claim is the live set context** |
| A labelled no-AI fallback | **Built** (`Built-in rule (coach not connected)`) | MacroFactor and Alpha are rule-based; Athletica separates its plan engine from its chat; Arvo documents none | Good, but not unique |
| Pain flag stops progression for that movement | **Built** (check-in → `halted_pain`); pain flagged mid-workout is designed | Gravl, Fitbod, Hevy Trainer and JEFIT swap or warn; none documents a stop to load progression | A narrow difference. **Gravl's UX is richer** |
| "Your data" vs "Coaching knowledge" split | Approved (v0.7); restore is simplified for now to a whole-database swap | No equivalent found (absence of evidence) | Matters for Ben's control; not a visible feature |
| Original animated guides with muscle focus | **Built**: 10 draft guides. The v2 review has one blocker | Hevy 400+; Alpha 795 real-gym videos; MacroFactor 600+ from three angles; JEFIT 1,400+; StrengthLog 500+ free; Muscle & Motion 3D anatomy | **Well behind on breadth.** Ahead only on bundled offline guides fitted to Ben's lifts |
| FitNotes import | **Designed** (preview, mapping, undo, results row by row); blocked until Ben provides an export | FitNotes 2 imports FitNotes; Liftosaur has the best import UX; MacroFactor has none | The design matches the best; not built |
| No subscription, ads or tracking | True by construction | Every commercial peer has a paid tier; 20+ labels declare tracking | Real for Ben, but it isn't a feature that competes |
| **Where GymSmarter is behind today** | Live Activity (failed probe), routines (Repeat only), Progress (placeholder), coach, voice, import, Overview table, Watch | Hevy, Strong, Alpha, MacroFactor and FitNotes 2 have all of the core ones | The core is the gap, not the AI |

## Opportunities for GymSmarter (Recommendations)

Ranked by value to Ben divided by effort, then by fit with where the build is now (steps 2–3, first milestone). The effort sizes are guesses; the developer should re-estimate them. Pass 2 changes to the ranking:
- New #5 (baseline check).
- Exclusion flags moved from #5 to #9, and marked low evidence.
- Time remaining is now #10 and re-cited to the brief.
- Strong-format CSV moved from #10 to #11, because it's inference only.

**1. Get the rest Live Activity working: on by default, showing the next set, target and plate line, and prove each alert layer, including in silent mode.**
- Effort: M.
- Build order: first milestone (v0.2). Already designed in `lock-screen-and-alerts.md` §2.1.
- Evidence [Doc]: the Live Activity is now standard.
  - Hevy (free) ([Live Activity](https://www.hevyapp.com/features/live-activity/)).
  - Strong 6.5.0 (12 Aug 2026), JuggernautAI 3.0.0 (11 Aug 2026), Alpha 6.6, MacroFactor 1.2.1, FitNotes 2 v13 and Trainwell 31.5.0.
  - Arvo 1.2 and GymStreak, both new in pass 2.
- Evidence [User]: alerts get missed.
  - Alpha "too subtle"; MacroFactor "going silent"; FitNotes 2 needs a settings toggle.
  - StrongLifts' docs say silent mode mutes the chime.
- Status: the deadline and notification are built. The Live Activity failed on probe build 7 (App Group), and a retest is pending (`device-tests/morning-checklist.md` R1/R2).
- If the retest fails again, the fallback is an actionable rest notification (see #14).
- Rules: CLAUDE.md milestone; rule 1.

**2. Add an acceptance-test pack built from competitor failures.**
- Effort: S.
- Build order: now (step 2), with the coach tests at step 4.
- Tests:
  - (a) An import never changes planned or pending sets (Fitbod refresh).
  - (b) No target below the empty bar, between dumbbell or stack steps, or at 0 (LiftTrack, MacroFactor; Fitbod's case is unverified).
  - (c) Warm-ups obey equipment caps and pain blocks (JuggernautAI).
  - (d) Editing a logged set never restarts rest (MacroFactor).
  - (e) Discard needs a confirmation or Undo (LiftTrack: "no second step").
  - (f) Deleting one set never removes another (Hevy).
  - (g) Repeat at a gym without the equipment never keeps an impossible load (slice-3 B1).
- Rules: 2, 4 and 5.

**3. Show "Why this number?" on every target on the set card, not only on Summary and coach changes.**
- Effort: S.
- Build order: step 2.
- Content: the basis (last comparable set and its date), the rule, the equipment snap, and any pain hold.
- Evidence [Doc]:
  - Gravl's "Why 40 kg today?" ([science](https://gravl.ai/help/gravl-science-understand-your-recommended-weights)).
  - Liftosaur's "Why is the weight adjusted?" ([progressions](https://www.liftosaur.com/features/progressions)).
  - MacroFactor's help articles explaining high reps.
  - The contrast case is Fitness AI's unexplained "automatically optimizes".
- Evidence [User]: JuggernautAI's "update your max" problem.
- Status: `Why?` is designed for the Summary `Next time` and for coach changes (`workout-summary.md`, `coach-adjustments.md`) but not for the target on the active set.
- Rules: rule 3 ("recorded with its reason"); rule 6.

**4. Get Ben's FitNotes export now (the CSV and the `.fitnotes` backup) and finish the import.**
- Effort: M (blocked until Ben provides the files).
- Build order: step 3, brought forward (critic-pass-1 #5).
- Additions to the existing design: Liftosaur-style sanity flags (implausible loads, future dates), and a per-date comparison when a date already has a workout.
- Evidence [User]: MacroFactor's lack of history import is its users' "only complaint".
- Evidence [Doc]:
  - FitNotes 2 imports the Android database ([changelog](https://getfitnotes.com/changelog/)).
  - Liftosaur imports with preview, sanity flags and undo ([import/export](https://www.liftosaur.com/features/import-export)).
  - Arvo imports history from other apps (1.3.7).
- Rules: rule 8 and brief §5.

**5. New: a baseline check against "ChatGPT used directly" before the coach is built.**
- Effort: S (about 30 minutes of Ben's time, with no build work).
- Build order: now, before step 4.
- Method: with his own ChatGPT Pro account (no new sign-up), Ben runs brief scenarios 1 (bench 115 × 4 at RPE 10), 2 (uses earlier history), 4 (20 minutes left) and 10 (pain), using voice mode in the gym or at a desk. For each he notes:
  - how much he had to re-explain;
  - whether the loads were achievable on his gym's equipment;
  - whether anything could change his log;
  - whether it worked with no signal.
  Optionally he repeats it with Hevy's free @hevy app, which needs a Hevy account, so it's Ben's choice.
- Evidence:
  - [User] SensAI reviewer: "better recommendations for less money with one of the chat bots".
  - [Doc] Hevy's ChatGPT app is free and writes plans into Hevy; Ben already has Pro (CHANGELOG v0.6); ChatGPT has Advanced Voice Mode (GB listing).
  - [Doc] Arvo and SensAI already sell in-session AI.
- Why now: it is the only cheap way to test the "Proposed advantage" hypothesis. Researchers can't sign up for competitors, so only Ben can run comparisons (brief, "Validation before claiming it is better").
- Rules: brief "Validation"; rule 1 (honest claims).

**6. Build the mid-workout gym switch that re-snaps pending loads as a proposal (GE7), and fix Repeat B1 with the same code path.**
- Effort: M.
- Build order: step 2.
- Evidence:
  - [Doc] Gravl blocks the switch.
  - [Doc] Liftosaur doesn't re-snap (#282).
  - [Doc] Arvo has profiles per gym, but no switch is documented.
  - [User] Alpha "the weights … didn't match up"; Hevy "equipment weights vary between gyms".
- Rules: rule 4; brief §10 hotel-gym scenario.

**7. A coach honesty contract for build step 4.**
- Effort: S (spec and tests).
- Build order: step 4.
- Contract:
  - Reply text that mentions a change is rendered from the committed action's result.
  - The coach never says something changed without a versioned action in that turn.
  - There are no coach tools that destroy history.
- Evidence [User]: Ray, SensAI, Planfit and WHOOP.
- Evidence [Doc]:
  - Liftosaur's MCP and LiftTrack's connectors can delete workouts.
  - HYBRD exposes `update_completed_workout`.
  - Arvo's chat and MCP write workouts and log sets with no documented confirm or undo.
- Rules: 2 and 5. Add as a validation scenario (Proposed brief change 5).

**8. Pain-flag UX.**
- Effort: S–M.
- Build order: the picker tag at step 2; the coach parts at step 4.
- Features:
  - A "May hurt" tag with confirmation in the exercise picker.
  - A two-weekly "Still hurts?" review that Ben clears explicitly.
  - Pre-injury history kept as the reference, with no reset.
  - Any re-entry load offered only as a proposal after Ben clears the flag. Its rule must come from the training-researcher.
- Evidence [Doc]: Gravl ([injury](https://gravl.ai/help/train-around-an-injury)); Fitbod's "Update Plan".
- Evidence [User]: RP "doesn't do anything"; Fitbod reset weights.
- Rule 9: never diagnose.

**9. Per-set exclusion flags (spotted, pain, technique break, different equipment) that keep a set out of PRs, e1RM and progression. Low evidence.**
- Effort: S–M.
- Build order: step 2–3, before Progress.
- Evidence [Doc]: there is precedent for keeping some sets out of stats.
  - Strong's warm-up sets are "not counted in metrics" ([warm-up](https://help.strongapp.io/article/171-warm-up-calculator)).
  - FitNotes 2 excludes warm-ups from stats ([changelog](https://getfitnotes.com/changelog/)).
  - StrengthLog doesn't document this.
- Evidence [User]: one Hevy review wants injured or spotted sets excluded ([GB](https://apps.apple.com/gb/app/hevy-workout-tracker-gym-log/id1458862350?see-all=reviews)). MacroFactor's e1RM complaint is about the calculation, not exclusion, so it no longer counts here.
- [Inference] The value rests mainly on rule 6 (like-for-like comparisons), not on demand from competitors' users.
- Needs Ben (Proposed brief change 4).

**10. An in-workout "about N min left" line from a deterministic `estimateRemainingDuration`, then a coach "shorten" proposal.**
- Effort: S for the line, M for shortening.
- Build order: step 2, then step 4.
- Evidence:
  - [Brief] This is already a requirement: §4 "Include time remaining" and validation scenario 4. Critic-pass-1 found it still a gap during the workout. The pre-workout estimate is designed in `today.md` and `workout-builder.md`.
  - [User] One Ray reviewer asks to "adjust workout time while in the workout" (1 Oct 2025; [US reviews](https://apps.apple.com/us/app/id6474633735?see-all=reviews)).
  - Competitor evidence is otherwise weak. Pass 1's "Fitbod's time-boxed routines are praised" had no direct quote, and the Lifehacker line about Google's coach is unverified; neither is relied on.

**Further opportunities**

| # | Opportunity | Effort | Build order | Evidence |
|---|---|---|---|---|
| 11 | Export a Strong-compatible CSV alongside the native format (Ben's call) | S | step 3 | **Inference only.** Strong's CSV is imported by FitNotes 2 and Copper (and Hevy, unverified); lock-in theme 7. Nothing shows Ben wants to leave (Proposed brief change 6) |
| 12 | Add to the Swift audio-session device tests: duck music under cues, resume after a phone call or Siri, route to AirPods | S | step 1 spike / step 5 | Ladder 4.13.x (coach audio returns after a call); Planfit background-voice fixes; Liftosaur's routing fixes; Ray 1.1.22 pauses the workout on a call |
| 13 | A stall (plateau) offer with a per-movement mute (playbook rule 8 already approved) | S–M | step 4 | Ladder plateau alerts with mute (4.10.0); Dr. Muscle's plateau deload; StrongLifts' deload after failures |
| 14 | Complete a set from the lock screen: a Live Activity button or, if the App Group keeps failing under SideStore, an actionable rest notification (StrongLifts' long-press pattern) | M–L, feasibility unknown | after #1 | Hevy and Liftosaur do it from the Live Activity; StrongLifts from the notification; WHOOP users ask for it. [Inference] A notification action is delivered to the app process and may not need the App Group. Any write still goes through operation IDs (rule 5). Needs a device test |
| 15 | Plate order that minimises plate changes across sets | S–M | later | **Low evidence:** one GitHub issue (Liftosaur #199) |
| 16 | Ordering and substitution that prefer the current station | S–M | step 4 (`rankSubstitutions`) | **Low evidence:** one Gravl review |
| 17 | An optional one-line `cues.feel` on rich catalogue entries; pain-like wording stays in `safety.stopIf` | S | catalogue | **Weak:** Planfit's "How it should feel"; Muscle & Motion's "common mistakes" praise |
| 18 | A spike on Apple's **on-device** model only, as an offline route for coach explanations | L | later spike | MyLiftingCoach (on-device). **Private Cloud Compute is out of scope:** it needs an entitlement, and ADR 0004 allows only entitlements a free Apple ID can sign (Liftin's PCC use is not a precedent for us) unless a new ADR changes distribution. Any on-device route must be labelled as a separate, weaker coach with honest status, never shown as the ChatGPT coach (rule 1). Bridging is unverified |
| 19 | Stack photo → proposed ranges for Ben to confirm | L | steps 6–7 | MacroFactor "Scan with AI"; Gravl "Import from photo"; Arvo's equipment scanner. **Rule 7:** the image goes only through Ben's configured AI route, with its status visible and never a paid fallback. The result stays a proposal (rule 2) |

**Avoid** (each is evidenced above):
- social feeds;
- tracking SDKs;
- composite readiness or strength scores;
- AI-generated exercise instructions;
- depending on hosted media (Gymshark is frozen; MuscleWiki's terms forbid offline use);
- weekly automatic regeneration (SensAI);
- global adjustments that can't be undone (Gravl);
- scheduled "insight" pushes (Garmin);
- coach cues that repeat (Planfit);
- write tools for external AIs with no confirm or undo (Liftosaur, HYBRD, Arvo);
- calling an AI "offline" or "client-side" when it uses a cloud model (Arvo);
- putting logging behind a paywall (StrongLifts, GymStreak); not applicable to us, but it confirms rule 1.

**Unknowns only a real device test can settle:**
- Whether the Live Activity works under SideStore free provisioning once the App Group fix is in (retest R1/R2).
- Whether an interactive Live Activity button can commit a set while the phone is locked, including how the intent reaches the SQLite writer.
- Whether an actionable rest notification (long-press with reps) can commit a set without the App Group, and survives a force-close.
- Whether rest notifications mirror to a paired Apple Watch.
- Whether AlarmKit's loud mode is available on a free-provisioned build.
- Whether an Expo/Swift module can reach Apple's on-device Foundation Models. PCC is out of scope (see #18).
- Ducking and resume after a call or Siri, and AirPods routing, in the Swift audio module.

**Unknowns only Ben can settle (they need accounts or his data):**
- How Arvo, SensAI and GymStreak actually behave in a session: whether chat edits can be undone, and whether loads respect machine maxes.
- How ChatGPT voice mode performs on scenarios 1, 2, 4 and 10 (#5).
- Whether OpenAI's health features are available in the UK on his account.

## Proposed brief changes (for Ben to approve)

These contradict or extend the brief. They change nothing until Ben approves; approved changes then go in `docs/brief/CHANGELOG.md`.

1. **Refresh the "Competitors and lessons" table.** It is out of date. Proposed rows:
   - **First row (new): ChatGPT used directly (Ben's current setup).** Voice mode and memory on his Pro plan, plus a logger; Hevy's free ChatGPT app saves plans into Hevy. Lesson: GymSmarter's coach must beat this inside the session (live set state, loads checked against equipment, Undo, offline logging), or it isn't worth building. Test with Opportunity #5.
   - **Hevy:** a free ChatGPT app that reads history and *writes plans to Hevy*; sending workouts to ChatGPT and Claude (3.1.12, Sep 2026); Trainer (Pro) with Injury Management and a scope prompt for swaps; a free interactive Live Activity.
   - **Liftosaur:** an MCP that can log, edit and delete workouts and edit gyms, with no undo documented.
   - **LiftTrack:** approval cards; phone tracking since Sep 2026.
   - **Athletica:** answers the brief's question: gym set tracking is shallow (a comment field or Garmin strength mode).
   - **Add:**
     - **Arvo** (in-session AI that edits workouts and logs sets; plates per gym; Undo only for plan activation; "client-side AI" contradicted by its privacy policy; vendor claims, 2 GB ratings);
     - Gravl ("Why X kg today?", machine 1RMs per gym, the best pain UX);
     - Alpha Progression (set-by-set deterministic targets, gym min/max/interval);
     - MacroFactor Workouts (rule-based, multi-range stacks);
     - SensAI (in-session LLM chat with change-summary cards);
     - HYBRD (hybrid AI coach whose MCP can edit completed workouts).
   - Link to this file instead of duplicating it.
2. **Rewrite "Proposed advantage": ON HOLD (recommended).**
   - Pass 2 checked Arvo and the ChatGPT baseline as far as public docs allow. Arvo narrows the claim but doesn't break it, and the baseline can only be tested by Ben (#5). Recommendation: keep the current brief text until Ben has run #5, then decide.
   - If Ben wants to approve now, this narrowed wording replaces pass 1's. Pass 1's version said "data that never leaves the phone without Ben's action", which was too loose. The new wording matches `coach-adjustments.md` (path B: "no AI call is made, until Ben taps Adjust") and `coach-sheet.md` CS4 (no queued sending):

     > *"The combination: a coach that sees the live session and acts only through typed, version-checked proposals that are rejected if stale and can be undone; loads that are always achievable on the selected gym, bounded by each machine's max, including after a gym switch mid-workout; an honest, labelled no-AI fallback; and training data that is sent to OpenAI only when Ben asks the coach or taps Adjust. Arvo, SensAI and Hevy + ChatGPT each cover parts of this. It is a hypothesis to validate with the matched scenarios and the ChatGPT baseline check, not a proven outcome."*
3. **Update "What LiftTrack's Max does".** The sources conflict:
   - The 6.3.0 release notes (3 Oct 2026) claim a Coach tab, approval cards for workout and training-max changes, one-off scheduling via Max, ChatGPT or Claude, and memory across longer conversations.
   - The help pages dated 26 Sep 2026 still say there are no schedule changes and that chat clears on restart.
   - Also new: phone tracking (6.1.1), the "Next time" Accept/Skip review, ChatGPT and Claude connectors that can permanently delete workouts, and Discard with "no second step".
   - Record both sides as unresolved.
4. **§1 Workout logging (low evidence; Ben's call):** add per-set exclusion flags (spotted, pain, technique break, different equipment). Flagged sets stay in history but are left out of PRs, e1RM, `Last` and progression. Warm-ups are already excluded. The precedent is warm-up exclusion in Strong and FitNotes 2; user demand rests on one review.
5. **"Validation before claiming it is better":** add scenarios and fix one sentence.
   - (11) **Plan continuity:** asked to change next week, the coach edits the saved routine and its progression state; it doesn't generate standalone sessions (WHOOP and SensAI complaints).
   - (12) **No phantom changes:** the coach never says it changed something unless a committed, versioned action exists in that turn (Ray).
   - (13) **Imports never re-plan:** importing a file (or, later, Health data) never changes planned or pending sets (Fitbod refresh behaviour).
   - (14) **Baseline:** scenarios 1, 2, 4 and 10 are also run in ChatGPT voice mode on Ben's own account, and the results are recorded next to GymSmarter's.
   - **Sentence fix:** "Run matched scenarios against our version and, when account access is available, the competing products" should say that only Ben can run competitor scenarios, because researchers don't sign up for accounts.
6. **§5 Data foundation (optional, Ben's call; inference only):** export a Strong-compatible CSV alongside the native format for portability.

No changes are proposed for HYROX, wearables or Strava. Ben's decisions (CHANGELOG 9 Oct, v0.9) stand, and brief line 122 already covers the Strava MCP exception.

## Revision log

- **Pass 1 (9 Oct 2026):** first version, covering 48 apps.
- **Pass 2 (9 Oct 2026),** applying `completeness-critic.md`. Web search was unavailable, so everything comes from direct fetches. Raw notes are in the session scratchpad (`competitors/landscape-pass2.md`).
  - **Added:**
    - Arvo, and the summary's headline claim narrowed;
    - a "ChatGPT used directly" baseline (row, section and Opportunity #5);
    - GymStreak, Fitness AI, StrongLifts, StrengthLog, Lyfta and Motra;
    - one-line notes on Freeletics, Bevel, Setgraph, Peloton IQ, Centr and the Third Space app.
  - **UK view:** GBP prices and GB vs US rating counts. Future is marked as not in the GB store and moved down. UK notes added for Trainwell, Ray, Google's coach, Workout Buddy, Claude and ChatGPT health.
  - **Cells filled:**
    - Strong Guides ✓;
    - FitNotes Android Guides ✗;
    - MacroFactor Offline partial, and its I/E footnote;
    - JEFIT Voice partial;
    - privacy for RP ✗, Dr. Muscle ✓, Ray ✗ and Amrap ✗.
  - **Re-sourced:** Hevy, Liftosaur, JEFIT, Strong, Gravl and MacroFactor Endur and Analytics; Liftin', Alpha and Boostcamp Wear; SensAI Privacy; Ladder Rest/LA.
  - **Downgraded to `?`:** unsourced cells, mostly Analytics, Builder, Wear and Endur for newer or smaller apps. In table B, `?` became `n/a` for parked wearable and hybrid rows.
  - **Sourcing fixes:**
    - Dropped: Hevy's "needs internet" anecdote, the Workout Buddy "cheerleader" quote, and Gravl "pauses on calls".
    - Labelled unverified: the Fitbod mirror post, the Lifehacker quotes, and WHOOP's prices from a third party.
    - Added review links and "year not shown" for SensAI, Ray, Amrap, Alpha and JEFIT.
    - Added dates for Hevy 3.1.12 and JuggernautAI 3.0.0.
    - Updated versions for Ladder (4.14.0) and Trainwell (32.3.0).
  - **Opportunities:**
    - Re-ranked: new #5; exclusion flags moved to #9 (low evidence); time remaining is #10 (cited to the brief); Strong CSV moved to #11 (inference only).
    - #14 gains the notification fallback. #18 rules out PCC under ADR 0004. #19 gains a rule 7 note.
    - #15–#17 marked as low or weak evidence.
  - **Brief changes:** Proposed change 2 is on hold, with a narrowed wording; the first-row baseline and the Validation sentence fix were added.
  - **Not done:**
    - Hevy, Strong, LiftTrack and JuggernautAI offline remain unknown.
    - Boostcamp and JEFIT import/export remain unknown.
    - Alpha, Fitbod and Gravl pain/voice remain partly unknown.
    - Tempo, Tonal and Gymshark privacy weren't checked.
    - OpenAI's health features weren't verified (403).
    - Apple Fitness+, TrainHeroic, Smartgym and Zing weren't checked.
    - GB prices for Ladder, Planfit, Caliber, Trainwell, Dr. Muscle and HYBRD weren't fetched.
