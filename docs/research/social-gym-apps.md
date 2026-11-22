# Social / "Strava for the gym": market, gap, and what it would take

Checked 20 Oct 2026, from fact-checked notes. Reddit was not searched.
Labels: [Doc] official, [User] reviews/forums, [3P] third party, [Inference] my reasoning.
Marks: [C] confirmed today, [X] corrected, [U] unverified, [R] carried over from repo docs.

## Summary
1. No single "Strava for lifting". Hevy is closest (follow feed, friends-only boards, 17M+ users). Liftoff leads on ranks and global boards. Strava itself now covers strength.
2. Nobody credible combines social + challenges + a coach that edits workouts + equipment-aware loads. The gap is real but demand is unproven.
3. Going social would replace three foundations: SideStore distribution, local-only data, and the free ChatGPT-plan coach.
4. Recommendation: stay personal now. Ship a share card first, then spike an upload-only Strava route. A private "Crew" is a later, separate decision for Ben.
5. **Proposed brief changes below** (Strava upload route; scope/ADR change only if Ben wants friends).

## Recommendations
1. **Don't build a social network now.** It conflicts with CLAUDE.md "personal use only", ADR 0004 (free provisioning), and competitor-landscape.md "Avoid: a social feed" (line 301). [Inference]
2. **Stage 0 (Ben approves):** extend backlog line 155 ("Share or export a workout summary (text or CSV)") to add an image card through the iOS share sheet. No accounts, works offline.
3. **Stage 1 spike:** upload-only posting to Ben's own Strava. Prerequisite: **a Strava subscription is required to create an API app** [Doc][C].
4. **Only if Ben wants friends:** a private Crew (10 people or fewer), text-only, friends-only, with consistency and personal-record challenges. About $99/yr plus $0–25/mo, plus AI costs.
5. **A public community is a different product:** a legal entity, privacy policy, moderation and paid AI. Decide separately.

## 1. Is there a "Strava for the gym"?
Short answer: several apps try, none clearly owns it.

| App | What it does | What it doesn't | Source |
|---|---|---|---|
| **Hevy** | Follow feed with likes, comments and media; Discover feed; private profiles; copy workouts and routines; compare stats; leaderboards on 38 lifts, people you follow only. 17M+ users; 4.9 from about 99K US ratings; Pro $2.99/mo, $23.99/yr or $74.99 lifetime [C] | No challenges, clubs or groups [C]. No built-in coach: a programme generator, plus sending workouts to ChatGPT or Claude [R]. No lift verification described [C] | [social](https://www.hevyapp.com/features/social-features/), [leaderboard](https://www.hevyapp.com/features/gym-leaderboard/), [App Store](https://apps.apple.com/us/app/hevy-workout-tracker-gym-log/id1458862350?see-all=reviews), [pricing](https://apppricinglab.com/iap/apple/1458862350) |
| **Liftoff** | Ranks 1–1000 across 9 tiers in 4-month seasons; global leaderboards; follows and feed; community challenges, streaks and quests. 4.8 from about 100K ratings; $3.99–79.99 [C] | AI is food scanning [C]; reviews mention AI workout suggestions [User]. Rank formula criticised as favouring weight [User] | [App Store](https://apps.apple.com/us/app/liftoff-ranked-gym-workouts/id6448081563), [SensAI](https://www.sensai.fit/blog/liftoff-vs-lyfta-vs-hevy-2026) |
| **Lyfta** | Follows, public or private profiles, monthly strength challenges, global leaderboards. 4.8 from 7K ratings [C] | No AI listed. Feed "could benefit from more content variety" [3P] | [App Store](https://apps.apple.com/us/app/lyfta-gym-tracker-planner/id6443740936), [screensdesign](https://screensdesign.com/showcase/lyfta-gym-workout-tracker-log) |
| **WeLift / Strength Club / OverLoad** | Niche ranked apps. Strength Club verifies lifts with an in-app camera and AI form score; OverLoad markets itself as "Strava for lifting" [C/X] | Tiny: 54, 2 and unknown ratings | [WeLift](https://mwm.ai/apps/welift-ranked-lifting/6449750649), [Strength Club](https://mwm.ai/apps/strength-club/6760890099), [OverLoad](https://www.trendhunter.com/trends/overload-fitness) |
| **Strava** | Strength Workout Log, muscle maps and 5 shareables (21 May 2026); 14 partners including Hevy, Fitbod and Liftoff; 195M+ users; guided strength for subscribers from 15 Oct 2026 [C] | No strength-specific challenges announced [C]. API policy bans AI use of Strava data (§5.3) [Doc] | [press](https://press.strava.com/articles/strava-overhauls-strength-experience-with-expanded-partner-ecosystem-new-workout-log-and-muscle-maps), [the5krunner](https://the5krunner.com/2026/10/15/strava-guided-strength-workouts/), [policy](https://www.strava.com/legal/api_policy) |
| **Ladder** | Human coach-led programmes plus team chat. 5.0 from about 210K ratings; $29.99–49.99/mo [C] | No AI [C] | [App Store](https://apps.apple.com/app/id1502936453) |
| **Boostcamp** | 14,000+ programmes; free Community feature with follows, reactions and share cards [X] | Its own comparison page lists the feed as "Not a core feature"; no AI | [features](https://www.boostcamp.app/features), [vs Hevy](https://www.boostcamp.app/vs/hevy) |
| **Fitocracy** | The original gamified lifting social network | Inactive; website offline as of Aug 2024 [X] | [Wikipedia](https://en.wikipedia.org/wiki/Fitocracy) |

## 2. The gap
- **Big apps keep AI and social separate.** Hevy sends workouts out to external LLMs [R]. Liftoff's AI is food scanning. Ladder sells human coaches plus a team [C].
- **The combined offerings are tiny or unshipped.** Gymcircle (one-line AI coach plus Circles) has 5.0 from 6 ratings. GymiaFit (equipment-aware AI plus squads and challenges) is Android-only, with 0 Product Hunt upvotes. Kiwi Fitness listed communities as "future updates" (Jan 2025) [C]. Sources: [Gymcircle](https://apps.apple.com/us/app/gymcircle/id6470938207), [GymiaFit](https://www.hunted.space/product/gymiafit), [Kiwi](https://insider.fitt.co/press-release/kiwi-fitness-introduces-ai-driven-strength-training-app-designed-to-rival-traditional-coaching/).
- **No one combines all four:** social, challenges, a coach that edits today's workout with Undo, and loads snapped to each person's real gym equipment. [Inference]
- **Caution:** an empty quadrant can mean no demand. The proven "community plus coaching" product is human-led (Ladder). [Inference]
- **Users are split on social.** "like a social media platform strictly for working out" and "I love that I can compete with my friends" versus "a blah and sometimes a distraction" and "I also don't use the social piece too much" (Hevy App Store reviews) [User][C].

## 3. What going social would require (proposal; Ben decides)

| Area | Today | Social version | Source |
|---|---|---|---|
| Distribution | Free Apple ID + SideStore (ADR 0004); free team limited to 3 devices, profiles expire after 7 days | Apple Developer Program at $99/yr; TestFlight for up to 10,000 testers; App Store optional | [Doc][C] [programs](https://developer.apple.com/programs/), [compare](https://developer.apple.com/support/compare-memberships/) |
| Accounts | None | Sign in with Apple (meets Guideline 4.8); in-app account deletion (5.1.1(v)); core logging must work without login | [Doc][C] [guidelines](https://developer.apple.com/app-store/review/guidelines/) |
| Backend | Local SQLite only | Opt-in publish layer, not sync. Supabase (free tier pauses after 1 week inactive; Pro $25/mo) or Firebase Spark | [Doc][C] [Supabase](https://supabase.com/pricing), [Firebase](https://firebase.google.com/pricing) |
| Moderation | n/a | Guideline 1.2: filtering, reporting with timely responses, blocking, published contact info. Repeated failures risk removal. Text-only posts reduce the burden [Inference] | [Doc][C] guidelines |
| Health data | Ben's own | Guideline 5.1.3: no ads or data mining on fitness data, and no health data in iCloud (a CloudKit risk). UK ICO treats fitness-tracker data as special category (Article 9). Ben becomes a data controller [Inference] | [Doc][C] guidelines, [ICO](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/special-category-data/what-is-special-category-data/) |
| AI coach | Ben's ChatGPT plan | ChatGPT-plan sign-in is documented for open-source, locally run personal or selected private apps; "paid or remotely hosted" apps join a waitlist. Options: open-source, with each friend bringing their own plan (unproven; spike S1), or Ben pays for API keys. The repo's $5–9/mo figure is Ben's own usage, not per friend [X] | [Doc][C] [cookbook](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt) |
| Data model | Your data / Coaching knowledge (rule 10) | Add a third category, Friends' data. The coach never reads it without the friend's consent [Inference] | CLAUDE.md |

## 4. Staged path (Ben stays the first user; effort is rough inference)

| Stage | What | Accounts? | Effort | Notes |
|---|---|---|---|---|
| 0 | Share card (image) or text from the Summary via the iOS share sheet: lifts, PRs, muscle map. Gym name only if Ben opts in | No | About 2–4 days | Reaches Instagram, WhatsApp and Messages, networks that already exist. Fits current scope |
| 1 | Spike: upload-only to Ben's own Strava (JSON, WeightTraining; `exercise_type`, reps, weight in kg; `activity:write`). Read nothing back, so the §5.3 AI ban may not apply [Inference] | Strava OAuth (Ben only) | About 2–3 days spike | **Needs a Strava subscription to create the API app.** The documented token exchange uses the client secret, with no PKCE, which may be a blocker on device [Doc][C] [uploads](https://developers.strava.com/docs/uploads/), [getting started](https://developers.strava.com/docs/getting-started/) |
| 2 | Private Crew (10 or fewer friends): Sign in with Apple, friends-only text posts, follows, report and block | Yes | About 4–8 weeks | Needs the CLAUDE.md scope change, an ADR replacing 0004, and the $99/yr program |
| 3 | Challenges: sessions per week (with rest days allowed), beat-your-own-record, planned-sets completion %. The coach proposes each person's challenge scaled to their equipment | Yes | About 2–3 weeks on top | Friends-only boards with tap-through; flag implausible jumps; loads must be achievable on the declared gym's equipment (rule 4) |
| 4 | Public community | Yes | A separate product | Legal entity, moderation staff, paid AI, App Store review |

Challenge types, from hardest to easiest to cheat: consistency > own-record > completion % > tonnage > relative strength (GL/DOTS points need bodyweight) [mostly Inference; GL points: [arXiv](https://arxiv.org/html/2503.13040v1)].

## 5. Honest risks
- **Cold start:** feeds need scale. Discover is useless with 10 people; only a crew of people who know each other works. [Inference]
- **Moderation and legal:** Guideline 1.2 duties, plus being controller of friends' special-category health data. [Doc]
- **Cost:** $99/yr plus $0–25/mo backend plus per-friend AI, which has no proven free path. [Doc/Inference]
- **Focus:** the first milestone (Today → Active set → Rest → Summary, plus backup and reliable rest alerts) isn't done yet. Social would delay it. [Inference]
- **Training safety:** leaderboards reward ego lifting, which conflicts with pain-flag and achievable-load rules (4 and 9). Liftoff users already call its ranks "weird" [User]. Leaderboard cheating is a known problem ("5000kg bicep curls", [yomotherboard](https://yomotherboard.com/?p=399468)) [User].
- **Privacy:** Strava's heatmap (2018) and the bodyguard-tracking stories (Oct 2024) came from public-by-default design ([The Register](https://www.theregister.com/2024/10/29/macron_location_strava/)) [3P]. Never share location by default.
- **Competition:** Strava's own strength push (May and Oct 2026) and Hevy's scale make a standalone social app hard to win. [Inference]

## Proposed brief changes (Ben decides)
1. Backlog line 479 rejects "Strava API". Brief line 123 only restricts AI use of Strava data. Proposal: add an **upload-only Strava route** as a candidate pending the Stage 1 spike; reading Strava data stays out. Prerequisite: a Strava subscription.
2. Extend backlog line 155 to include an image share card (Stage 0).
3. Any friend scope (Stage 2+) needs Ben to change CLAUDE.md "personal use only", plus a new ADR replacing ADR 0004. Related: backlog H1 (line 536, "lets hold it for now").
4. Add Liftoff, WeLift, Strength Club, OverLoad and Strava's 15 Oct guided strength launch to competitor-landscape.md.

## Unknowns needing a real test
- Whether the Strava token exchange can work without the client secret on the phone, and whether JSON uploads show in Strava's Workout Log and muscle map.
- How per-dumbbell and assisted loads display on Strava; mapping our catalogue to `exercise_type`.
- Whether Sign in with Apple and push work under a free personal team (officially unconfirmed).
- ChatGPT-plan loopback sign-in on iOS (spike S1).
- How Apple applies 5.1.3(ii) to workout logs in CloudKit.
- Real usage rates of social features in any of these apps; Reddit sentiment (not searched).
