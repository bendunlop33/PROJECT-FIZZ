# GymBuddy (gymbuddy.io): visual and UX reference

Checked 2026-10-08. Researcher agent. Patterns only: we must not copy GymBuddy's name, logo, illustrations, screenshots or exact screens.

## Summary

- Ben means **GymBuddy at gymbuddy.io**, confirmed via the coordinator. It calls itself "Your AI Fitness Coach": a chat-first app covering food logging by chat, adaptive training plans and progress photos. It is not the same as gymbuddy.ai, yourgymbuddy.app or the App Store "Gym Buddy" loggers.
- **Look:** a monochrome dark UI. True-black screens, hairline-bordered rounded cards, white pill buttons with black text, a slate-grey user chat bubble and a geometric sans. There is no brand accent colour; white is the accent. The marketing page puts this in a cream device frame on a warm brown-black page.
- **Evidence is thin.** The site renders client-side and has 3 lines of feature copy and 1 app screenshot. I found no App Store or Play listing, no download links, no pricing, no reviews and no Reddit threads. I can't tell whether a public app exists yet.
- **Worth borrowing:** the monochrome hierarchy (one filled light pill per screen, colour only for status), quick-action pills docked above the chat composer, and structured result cards inside coach replies. All three fit our design system.
- **Conflicts with our rules:** chat as the main surface, an AI that "learns and adjusts" on its own, exercise prescriptions after surgery, and progress-photo analysis. **No brief change is needed.** One optional design-system direction is offered for Ben to choose ("monochrome dark", below).

## Recommendations

1. **Confirm with Ben what he liked**: the website, an app he has installed, or an ad. If he has the app, 3–4 of his own screenshots would be far better evidence than the one marketing image (see Unknowns).
2. **Offer Ben a choice of dark palette** (designer to mock up the Active set screen in both): (A) the current navy + blue accent, unchanged; (B) a new "monochrome dark" direction with near-black surfaces and an off-white accent. Values are in "Design implications". Keep exactly one accent either way.
3. **Adopt 3 patterns now** (designer, coach-sheet.md and design-system.md): a persistent quick-action pill row above the coach composer, a tappable "exercise option" card in coach replies, and a hairline-border card style with nested rows. Details below.
4. **Keep SF Pro.** If Ben specifically likes GymBuddy's rounded geometric type, test a display face for screen titles only. Numerals stay SF Pro tabular.
5. **Do not adopt:** chat as the home or logging surface, unprompted plan adaptation, photo-based body analysis, or exercise prescriptions for post-surgical or injured users.

---

## 1. Which GymBuddy

| Product | Site / listing | What it is | Relevance |
|---|---|---|---|
| **GymBuddy (gymbuddy.io)** | https://www.gymbuddy.io/ | "Your AI Fitness Coach": chat food logging, adaptive training plans, progress photos, coaching | **The one Ben means** (confirmed by coordinator, 2026-10-08) |
| GymBuddy.ai | https://gymbuddy.ai (App Store id6446258027, Play com.gymbuddyai) | AI workout planner plus a trainer web dashboard. Light shadcn-style web UI, slate buttons, robot-mascot logo | Different product. Search tools and AI directories often mix it up with gymbuddy.io |
| GymBuddy (yourgymbuddy.app) | https://yourgymbuddy.app/?locale=en | Training-partner matching plus an AI coach, beta. OG image is navy with an orange dumbbell | Different product |
| GymBuddy: Workout Tracker (Onur Karal) | https://apps.apple.com/us/app/gymbuddy-workout-tracker/id6756788677 | Weekly templates, success/fail/skip per set, 4 progression strategies, "redesigned dark theme" in 1.1.0 | Different product, but the closest feature match to ours |
| Gym Buddy – Workout Log (Razi Katz) | https://apps.apple.com/us/app/gym-buddy-workout-log/id1447925458 | Minimalist logger since 2019, no website | Different product |

**Caution [Inference]:** search summaries and AI directories blend these products. One search result attributed the aiinsightsnews.net review of gymbuddy.ai to gymbuddy.io. Nothing below uses evidence from the other products unless it is labelled.

## 2. Method and limits

- A direct fetch of https://www.gymbuddy.io/ (and `/privacy`, `/terms`, `/pricing`, `/sitemap.xml`, `/manifest.json`, `/robots.txt`) returned only the title "GymBuddy". The site is a client-rendered app shell that serves the same shell for every path. [Doc, fetched 2026-10-08]
- The rendered text came from a public reader proxy (https://r.jina.ai/https://www.gymbuddy.io/). It returned the hero, three feature blocks and two images. `/privacy`, `/terms` and `/pricing` returned no body text. [Doc, 2026-10-08]
- I viewed the two images directly. I could not read the CSS, `theme-color` or `font-family`, so **every hex value below is an eyeball estimate from the rendered screenshot, not from source.** Treat them as approximate.
- No account, sign-up or trial was used.

## 3. What the site says [Doc]

Source: https://r.jina.ai/https://www.gymbuddy.io/ (rendering of https://www.gymbuddy.io/), checked 2026-10-08. Verbatim:

- Title "GymBuddy". Hero: "Your AI Fitness Coach". "Track your food in seconds, get personalized workout plans, and achieve your fitness goals with AI-powered coaching."
- "Quickest Way to Track Food": "Simply chat what you eat. No more scrolling through databases or weighing food. Just type "Had a chicken salad" and you're done."
- "AI-Powered Training Programs": "Get workout plans that adapt to your progress, schedule, and goals. Our AI learns what works for you and adjusts accordingly."
- "Everything in One Place": "Track your nutrition, follow your workouts, monitor your progress photos, and get coaching—all in one simple app."
- Images: `/images/GymBuddy.png` (alt "GymBuddy") and `/images/Injury.png` (alt "GymBuddy App Interface").
- The rendered page had **no** App Store or Play links, pricing, legal text or company name.

An earlier search-engine snippet describes the site as "GymBuddy - Your AI Gym Coach" that builds training plans, analyses progress photos and provides coaching (search result for `"gymbuddy.io"`, 2026-10-08). This suggests the copy has changed over time. [Reports]

## 4. Visual style

### 4.1 App screen (from `/images/Injury.png`, the only app screenshot)

What the screen shows [Doc: image content]:
- A **Chat** screen. Back arrow and large bold title "Chat" at top left, a hairline divider below.
- **User message**: right-aligned bubble, rounded about 14–16pt, filled slate grey, white text.
- **Coach reply**: left-aligned, *not* a filled bubble. It is a near-black card with a 1px cool-grey border, rounded about 14pt. It contains an intro sentence, three **nested exercise cards** and a closing sentence.
- **Nested exercise cards**: dark grey fill, 1px border, rounded about 12pt. Each has a white circular icon badge with a small black dumbbell glyph on the left, a bold title ("Seated Shoulder Press") and a one-line grey subtitle ("Upper body strength").
- **Quick-action row** docked above the composer: two equal-width, fully rounded **white pills with black text and icons**, "Add Food" and "Add Workout".
- **Composer**: a dark grey pill field ("Ask anything…"), a circular dark mic button, then a circular **white** send button with a black paper-plane icon. Hairline dividers separate the message area, the quick-action row and the composer.
- The marketing frame is a phone with a thick **warm cream bezel** on a **warm brown-black** page background.

Estimated palette [Inference: sampled by eye from the PNG, not from CSS; ±a few steps]:

| Role | Approx. hex | Note |
|---|---|---|
| Screen background | `#000000` | True black |
| Reply card fill | `#0A0A0A` | Barely lifted from black |
| Nested card fill | `#1C1C1E` – `#1F1F1F` | |
| Card borders | `#2D3340` – `#374151` | Cool slate hairlines, slightly blue against neutral fills |
| User bubble | `~#4B5563` | Slate grey (close to Tailwind gray-600) |
| Primary text | `#FFFFFF` | |
| Secondary text | `~#9CA3AF` | (close to Tailwind gray-400) |
| Primary pills, send button | `#FFFFFF` fill, `#000000` text | White is the only "accent" |
| Marketing page background | `~#1E1A17` | Warm brown-black |
| Device bezel (marketing only) | `~#EFEBDF` | Warm cream |

The near-match to Tailwind's gray scale hints at a Tailwind/web or React Native stack. [Inference, weak]

Contrast [Inference, my calculation from the estimates]: white on black is 21:1. Grey `#9CA3AF` on `#1F1F1F` is about 6.5:1, which passes AA for body text.

### 4.2 Typography [Inference]

- A **geometric sans** with round bowls, a single-storey look and generous letter spacing at body size. It strongly resembles **DM Sans** (a Google Fonts typeface), but I couldn't confirm the font from CSS.
- Hierarchy: a large bold screen title (about 28pt equivalent), bold card titles, regular body (about 17pt), grey secondary lines. Sentence case throughout. No all-caps labels.
- Numeral style is unknown: the screenshot has no numbers, so I can't tell whether they are tabular.

### 4.3 Shapes, density, imagery, iconography, motion

- **Shapes:** everything is rounded. Cards about 12–16pt, buttons and input fully pill-shaped, icon badges circular. Fill differences are tiny, so 1px hairline borders do most of the work of separating surfaces. [Doc: image; radii are Inference]
- **Density:** medium-low. About 16pt padding inside cards, 8pt gaps between nested cards, one message pair per screen. [Inference]
- **Imagery:** no photos of people or illustrations on the site. The logo image `/images/GymBuddy.png` is a dark charcoal dumbbell glyph on a grey radial vignette. Its embedded C2PA metadata says it was generated by **GPT-4o via ChatGPT / OpenAI API**. [Doc: file metadata, read 2026-10-08] So the brand mark is AI-generated and fairly generic. [Inference]
- **Iconography:** small solid glyphs (dumbbell, food container, mic, paper plane) and a thin back arrow. This looks like one consistent filled icon set. [Inference]
- **Motion:** the site makes no motion or animation claims, and I saw no evidence either way. [Doc: absence in rendered text]
- **Light/dark:** only dark is shown. I found no evidence of a light mode. [Doc: absence]

## 5. UX ideas: borrow vs conflict

| GymBuddy idea | Evidence | Fit with our rules | Verdict |
|---|---|---|---|
| Quick-action pills ("Add Food", "Add Workout") fixed above the composer | Doc: screenshot | Fits. Our coach-sheet CS6 starter chips appear only on an empty thread. A persistent row of 2 deterministic actions is a small extension | **Borrow** (as deterministic actions, see §7) |
| Coach reply contains structured, tappable item cards (icon + title + one-line reason) | Doc: screenshot | Fits. Our coach-sheet §2.6 already has action cards. An "exercise option" card is missing | **Borrow** |
| Reply as a bordered card, not a filled bubble; user message as a bubble | Doc: screenshot | Neutral. It makes the coach's output read as content, not chatter | **Borrow** (styling) |
| One light, filled pill as the primary action on a monochrome screen | Doc: screenshot | Fits our "one accent" principle (design-system §1.6) | **Borrow** (optional palette B) |
| Mic button inside the composer row | Doc: screenshot | Ours already has `Talk` 52pt left of the field (coach-sheet §1.7). Their mic is smaller than our 52pt workout target | Keep ours |
| Logging by chat ("Had a chicken salad") | Doc: site copy | Same idea as our CS5 explicit commands ("Log 100 for 8") with a parsed card and Undo. Food logging is out of scope | Already covered; nutrition **out of scope** |
| Chat as the main screen (the only screenshot is chat) | Doc: screenshot; Inference that it is primary | **Conflicts** with logging speed first. Our logging is Today → Active set; the coach is a sheet | **Don't adopt** |
| "Our AI learns what works for you and adjusts accordingly" | Doc: site copy | **Conflicts** with rule 3 (no constant or unprompted adjustment; future changes are proposals) | **Don't adopt** |
| Exercise recommendations for a user "coming back from appendix surgery", closing with "Listen to your body" | Doc: screenshot | **Conflicts** with rule 9. We stop progression for the affected movement, record a pain/injury flag, never diagnose, and defer return-to-training clearance to a clinician. Recommending specific lifts after surgery goes beyond that | **Don't adopt**. Also a useful negative test case for our coach |
| Progress-photo monitoring and analysis | Doc: site copy ("monitor your progress photos"; search snippet "analyze progress photos") | **Conflicts** with rule 6 if it produces body-composition estimates. Storing photos is out of v1 scope | **Don't adopt** |
| Social or gamification | None seen | n/a | n/a |

## 6. What users say

- **gymbuddy.io: nothing found.** I found no App Store or Play listing, store reviews, Reddit threads (r/fitness, r/weightroom, r/Hevy) or press. Searches for `"gymbuddy.io"`, `site:gymbuddy.io`, the tagline and the food-chat phrase returned only the homepage and other GymBuddy products. [Doc: absence, 2026-10-08]
- The only third-party review of a "GymBuddy" in 2026 (aiinsightsnews.net, 29 Sep 2026) covers **gymbuddy.ai**, not this product. It found "a simpler tool" than the AI-coach marketing suggested. [Reports, different product, for context only]
- The adjacent minimalist logger (Razi Katz Gym Buddy) gets praise for simplicity: "All the bloat and marketing and cross-selling in the big apps just wastes valuable time…" (review 27 Mar 2025). Complaints there: hidden long-press edit/delete, and truncated long exercise names. [Reports, different product.] These match our existing rules: no hidden-gesture-only actions, and exercise names wrap to 2 lines.

## 7. Design implications for us

### 7.1 Palette directions

**A. Keep the current tokens** (design-system.md §2: navy canvas `#0F1620`, blue accent `#5AA9FF`). No work needed. It matches the brief §12 "calm charcoal or navy with one clear accent".

**B. "Monochrome dark" (optional, GymBuddy-inspired, our own values).** It is still one accent, but the accent is off-white rather than blue. This is a pattern, not their palette: neutral greys rather than their slate-blue borders, no cream/brown frame.

| Token | Proposed dark value | Approx. contrast [Inference, my calculation; re-check] |
|---|---|---|
| `color.bg.canvas` | `#0A0A0B` (not pure `#000`, to reduce OLED smear while scrolling) [Inference] | text.primary ≈ 18:1 |
| `color.bg.surface` | `#161618` | text.secondary `#A1A1AA` ≈ 7.1:1 |
| `color.bg.raised` | `#202023` | |
| `color.border.divider` | `#2A2A2E` (decorative only) | |
| `color.border.control` | `#6B6B73` | ≈ 3.4:1 on surface (non-text ≥ 3:1) |
| `color.text.primary` | `#F2F2F2` | |
| `color.text.secondary` | `#A1A1AA` | |
| `color.accent` | `#F2F2F2` (Log button fill, active-set bar) | on.accent `#0B0B0C` ≈ 17:1 |
| `color.accent.subtle` | `#26262A` | |
| Status colours | unchanged (done green, warning amber, danger red) | These become the **only** hues, which makes status even easier to read |

Risks of B [Inference]: (1) with a white accent, the active set can't rely on hue, but our rules already require icon + label + 4pt bar. (2) A large white Log button may glare in a dim gym; check on device. (3) Links can't be "accent-coloured text" in the usual way, so use underline or a chevron. Light mode under B would be a normal light neutral theme with a near-black accent.

### 7.2 Type

- Keep **SF Pro** with tabular numerals for all loads, reps and timers (design-system §3). It is already correct for Dynamic Type.
- If Ben likes the rounded geometric feel, try a **display face for screen titles only**: either a bundled open-licence geometric sans or SF Pro Rounded. Never use it for numbers. Whether Dynamic Type scaling and tabular figures work in Expo needs a device spike. [Inference]
- Borrow the hierarchy: one large bold screen title, bold card titles, single-line grey subtitles, sentence case.

### 7.3 Card style

- Cards on a near-black canvas, with separation from a **1px hairline border plus a very small fill step**, not shadows. Outer cards `radius.lg` (16), nested rows `radius.md` (12). These already match our tokens.
- **Nested row pattern:** circular 36–40pt icon badge, bold title, one-line `text.secondary` reason. Use it for coach exercise options and swap candidates.
- **Coach replies are bordered cards; Ben's messages are filled bubbles** (`bg.raised`). Coach text then reads as reference content.

### 7.4 Borrowable patterns (our versions)

1. **Docked action pills above the coach composer.** Two fixed, context-chosen pills written by us, never by the model (e.g. in a workout: `Log a set`, `Swap exercise`; elsewhere: `Start workout`, `Pain`). Tapping opens the native deterministic flow, so it works offline (rule 1). It extends CS6, which today shows only on an empty thread. Each pill is at least 52pt tall in the workout.
2. **Exercise option cards in coach replies.** When the coach suggests alternatives, it renders `ExerciseOptionRow`s (badge, name, reason such as "Seated, no core bracing"). Tapping one opens a `ChangeReviewCard` (`Today only` / `Future sessions`, Apply/Undo). The model can't apply a swap by listing it (rule 2).
3. **Monochrome hierarchy with one filled light pill per screen** (palette B, if chosen). Everything else is greyscale and hue means status only. This reinforces design-system principles 1.3 and 1.6.
4. **Bordered coach card vs filled user bubble** in the coach sheet (§7.3).
5. **Chat-to-log stays a shortcut, never the main path.** Keep CS5 ("Log 100 for 8" gives a `SetLoggedCard` with Undo), but logging always lives on the Active set screen.

Not borrowed: chat-first home, self-adjusting plans, progress-photo analysis, nutrition logging, exercise prescriptions after surgery, and anything resembling their logo, cream device frame or screenshot layout.

## 8. Proposed brief changes

None required. Brief §12 "Visual direction" already allows "calm charcoal or navy … with one clear accent". Palette B is a design-system option within that wording. If Ben picks B, it is a design-system revision (designer), not a brief change. I'd suggest one optional wording tweak if he chooses B: "calm charcoal, near-black or navy background with one clear accent (which may be a neutral light accent)".

## 9. Unknowns

- Whether gymbuddy.io has a released iOS app. No store link was found, and there may be a waitlist or private beta. Only Ben can say where he saw it.
- The real CSS colours and font. The site is client-rendered and my fetch tools didn't expose stylesheets. A browser devtools check (or Ben's screenshots) would settle this.
- Any logging, progress or settings screens: only the chat screen is public.
- Whether palette B's white Log button is comfortable in dim gym light. This needs an on-device comparison against palette A.

## Sources (all checked 2026-10-08)

- GymBuddy homepage (client-rendered shell): https://www.gymbuddy.io/
- Rendered homepage text via reader proxy: https://r.jina.ai/https://www.gymbuddy.io/
- App screenshot: https://www.gymbuddy.io/images/Injury.png
- Logo image (C2PA metadata, GPT-4o generated): https://www.gymbuddy.io/images/GymBuddy.png
- Empty pages via reader: https://r.jina.ai/https://www.gymbuddy.io/privacy, https://r.jina.ai/https://www.gymbuddy.io/terms, https://r.jina.ai/https://www.gymbuddy.io/pricing
- GymBuddy.ai site and trainer page: https://gymbuddy.ai, https://gymbuddy.ai/trainers. Trainer dashboard screenshot: https://www.datocms-assets.com/28175/1781038425-screenshot-2026-06-09-at-21-52-33.png
- GymBuddy.ai review (different product): https://aiinsightsnews.net/gymbuddy-ai/
- yourgymbuddy.app (different product) and OG image: https://yourgymbuddy.app/?locale=en, https://yourgymbuddy.app/social-image/og
- GymBuddy: Workout Tracker (Onur Karal): https://apps.apple.com/us/app/gymbuddy-workout-tracker/id6756788677
- Gym Buddy – Workout Log (Razi Katz) and reviews: https://apps.apple.com/us/app/gym-buddy-workout-log/id1447925458
- Internal: docs/design/design-system.md §1–§4, docs/design/coach-sheet.md CS5, CS6, §1.7, §2.6, docs/brief/training-app-build-brief.md §12
