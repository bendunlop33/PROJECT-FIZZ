# Third Space (thirdspace.london): visual reference and "Direction D: Premium"

Checked 2026-10-09. Researcher agent. **We borrow patterns only.** We must not copy Third Space's name, logo (the "III" mark or the wordmark), photography, screenshots or exact layouts. Every token value proposed below is our own, inspired by their direction and not sampled 1:1.

Evidence tags: **[Doc]** means read directly from a source (page text, SVG source, file metadata, image content). **[Inference]** means my judgement, including any hex I estimated by eye from a JPEG. **[Reports]** means third-party descriptions.

## Summary

- **Third Space's look:** a monochrome core of true black and white (the logo SVGs are pure `black`/`white` fills) with warm off-white light surfaces. One warm coral/salmon highlight is used sparingly. A sharp, high-contrast serif carries the brand's voice and a geometric sans handles the UI, with uppercase, letter-spaced section labels. Their primary buttons are monochrome pills (white on black, or black on off-white), not coral.
- **Typefaces:** the 2018 award entry by the brand agency Without embeds **GT Sectra** (Grilli Type) and **Circular Std** (Lineto). The 2024 app relaunch screenshots look like the same pairing. Both are **commercial fonts that need a paid app licence**, so we won't use them. I could not read their live CSS (the site renders without exposing stylesheets to my tools), so the current web fonts are unconfirmed.
- **Proposed Direction D: Premium** (dark default): warm near-black `#0D0C0B` / `#181615` / `#23201E`, porcelain text `#F3EEE8`, and **one porcelain accent `#EDE5DA` with near-black text on it**. Light mode: warm paper `#F6F3EF` / `#FFFFFF`, ink text `#15120F`, ink accent `#1A1714`. Every text pair passes 4.5:1. An optional **D-Clay** variant uses a coral-clay accent (`#E8A285` dark / `#9C4A2E` light), but `status.danger` then has to move to a crimson to stay distinct.
- **Type direction:** keep SF Pro for everything functional and all numbers (tabular). Make it feel premium through restraint: Semibold rather than Bold, and tracked uppercase used only for section labels at 16pt. An optional open-licence display serif (**Newsreader**, OFL; alternative **Instrument Serif**, OFL) would be used only for non-numeric headings such as the summary headline.
- **Brief:** no change is required, because D fits §12 ("calm charcoal ... one clear accent"). There are 2 small **proposed brief/ADR items**: a wording tweak allowing a neutral accent, and an ADR if a bundled display font is adopted. See the "Proposed brief changes" section.

## Recommendations

1. **Designer: mock the Active set and Summary screens in D (porcelain) and D-Clay next to the current A**, then compare them on Ben's iPhone in a dim gym and in daylight. My recommendation is **D (porcelain)**. It matches how Third Space actually uses colour (monochrome primary action, coral only as a highlight), and it avoids the clay-versus-danger clash.
2. **Adopt the transferable "premium" rules now, whichever palette wins** (§5): warm neutrals instead of blue-grey, Semibold rather than Bold, hairline dividers, more vertical whitespace above the focal element, pill-shaped chips, tracked-caps section labels at 16pt or larger, and no decorative imagery.
3. **Keep SF Pro and tabular numerals.** A display serif is optional and limited to 2–3 non-numeric places (Summary headline, Today greeting/date line, empty states). If Ben wants it, bundle **Newsreader** (OFL) via the `expo-font` config plugin and record an ADR. Don't use GT Sectra or Circular (paid licences), and don't bundle Apple's New York font files.
4. **Fix three D-specific risks in the spec** (§6.3): links need a chevron or underline, because accent text looks almost the same as body text. `chart.selected` needs a shape difference from the trend line. Selected chips need a check icon, because `accent.subtle` is close to `bg.raised`.
5. **Don't copy:** the "III" mark or any Roman-numeral or stacked-serif-bar app icon, the full-bleed lifestyle photography, their screen layouts, or their coral exactly (D-Clay is deliberately shifted). Avoid their dim future-day letters too (§3.2), which look below contrast.

---

## 1. Sources and method

| What | URL | Tag |
|---|---|---|
| Homepage text, nav, CTAs, agency credits | https://www.thirdspace.london/ (fetched 2026-10-09) | Doc |
| Rendered homepage (logo asset URLs, hero) | https://r.jina.ai/https://www.thirdspace.london/ (2026-10-09) | Doc |
| Yoast head data (og:image, schema logo, no `theme-color`) | https://www.thirdspace.london/wp-json/yoast/v1/get_head?url=https://www.thirdspace.london/ (2026-10-09) | Doc |
| WP REST root (WordPress on WP Engine, Yoast, HubSpot; no theme slug exposed) | https://www.thirdspace.london/wp-json/ (2026-10-09) | Doc |
| Logo SVGs | https://www.thirdspace.london/wp-content/uploads/2024/09/mobile-logo.svg, …/mobile-logo-dark.svg, …/2024/07/art_1.svg, …/2024/08/art_1.svg (2026-10-09) | Doc |
| og:image (photography style) | https://www.thirdspace.london/wp-content/uploads/2024/10/@RichMaciverPhoto_2023_11_09_ThirdSpace_Day23505-scaled.webp (2026-10-09) | Doc (image) |
| Brand agency case study (Without) | https://without.studio/work/third-space/ and https://without.studio/work/third-space-digital/ (2026-10-09) | Doc |
| DBA Design Effectiveness Awards entry, 2019 Silver (Without, © 2018, 11 pages incl. identity spreads, swatches, embedded fonts) | https://effectivedesign.org.uk/sites/default/files/419%20-%20Third%20Space%20Rebrand.pdf and https://effectivedesign.org.uk/winners/2019/silver/third-space-rebrand (2026-10-09) | Doc |
| Website build agency | https://www.plugandplaydesign.co.uk/work/third-space/ (2026-10-09) | Doc |
| App Store listing (v6.7.2, 28 Sep 2026; 4.8★, 3.9k ratings) | https://apps.apple.com/gb/app/third-space/id1440461613 and https://itunes.apple.com/lookup?id=1440461613&country=gb (2026-10-09) | Doc |
| App screenshots "App_relaunch_01–05" and icon | mzstatic URLs from the lookup API, e.g. https://is1-ssl.mzstatic.com/image/thumb/PurpleSource221/v4/bc/f8/d8/bcf8d8ea-9602-718e-4dad-381b4d8cc1cc/App_relaunch_01_1290x2752.jpg/600x1280bb.jpg (2026-10-09) | Doc (image); hexes Inference |
| Club interiors (Moorgate, Studio RHE) | https://www.e-architect.com/london/third-space-moorgate-london-gym (2026-10-09) | Reports |
| Font licences | https://www.grillitype.com/typeface/gt-sectra, https://www.grillitype.com/information, https://lineto.com/typefaces/circular, https://developer.apple.com/fonts/ (2026-10-09) | Doc |
| Open-licence alternatives | https://raw.githubusercontent.com/google/fonts/main/ofl/newsreader/METADATA.pb, https://raw.githubusercontent.com/google/fonts/main/ofl/instrumentserif/METADATA.pb (2026-10-09) | Doc |
| Expo custom fonts | https://docs.expo.dev/develop/user-interface/fonts/ (2026-10-09) | Doc |
| Third-party tech profile (may be stale) | https://builtwith.com/thirdspace.london (2026-10-09) | Reports |

**Limits:**
- I could not read the live site's CSS, `@font-face` rules or CSS variables. WebFetch returns converted Markdown without `<head>`, theme paths guessed under `/wp-content/themes/` returned 404, the WP REST theme endpoints need authentication (401), and web.archive.org is blocked for my fetch tool. **So no current-site hex or font value comes from CSS.**
- No `meta theme-color` is set (Yoast head data has none) [Doc].
- BuiltWith lists no web-font service, only Ionicons [Reports, possibly stale].
- Colour evidence therefore comes from: (a) logo SVG fills [Doc], (b) Illustrator swatch metadata and embedded font names in the agency's award PDF [Doc, 2018], and (c) my eyeball estimates from App Store screenshots and the PDF pages [Inference].
- No account, trial or sign-in was used.

## 2. Brand background [Doc]

- The rebrand was by **Without** (London/Dublin). Their case study says: "In 2015 gym membership in London was declining by 4% p/a." … "We called this 'training for life'". Their services covered brand identity, interior direction, photography, website design and more (without.studio, 2026-10-09).
- The award entry gives the launch as **Dec 2015**. The aim was to reposition Third Space as "an aspirational investment for London's urban elite: intelligent, design-led, holistic" (PDF p.5). The logo is "based on serif typography atypical to the sector. Feels intelligent" (PDF p.7). Spaces moved "away from ranks of televisions to evocative materials and interactive light-walls" (PDF p.7).
- Without later did a **member app (focused on experience)** and a new website (focused on acquisition) under the "Third Space Digital" project. The client quote reads: "We needed our digital space to reflect the quality and experience that people get in our physical clubs" (without.studio/work/third-space-digital, 2026-10-09). The current WordPress site was built by Plug & Play ("a new luxury website", plugandplaydesign.co.uk).
- The App Store screenshots are titled "App_relaunch", and one caption reads "A brand-new look, designed for performance." Screen content is dated Sept 2024 – Feb 2025 [Doc: images].

## 3. Visual findings

### 3.1 Colour

| Role | Value | Evidence |
|---|---|---|
| Logo, light-on-dark | `#FFFFFF` (`fill="white"`) | **Doc**: mobile-logo.svg, art_1.svg (2024/07) |
| Logo, dark-on-light / schema logo | `#000000` (`fill="black"`) | **Doc**: mobile-logo-dark.svg, art_1.svg (2024/08) |
| App icon | White serif "III" on pure black | **Doc**: icon image |
| App screen background (dark) | ≈ `#000000` (true black) | Inference (screenshots) |
| App card fill | ≈ `#1A1A1A`–`#1E1E1E` | Inference |
| App secondary chip fill | ≈ `#3A3A3A` | Inference |
| App secondary text | ≈ `#8E8E8E`–`#9A9A9A` | Inference |
| App warm highlight (activity-day dots, success check badge, sheet dot) | ≈ `#F2987E` coral/salmon | Inference |
| App light sheet background | ≈ `#F8F5F2` warm off-white | Inference |
| App primary button on the light sheet | ≈ `#1A1A1A` near-black pill, white label | Inference |
| 2018 identity: coral swatches | `#E56A5F`, `#FF9882` (swatch group "ts1") | **Doc**: PDF swatch metadata (PDF pages also show a salmon ≈ `#F0957A` in use) |
| 2018 identity: other "ts1" swatches | `#F2CB00` (yellow, visible as a band on the 2015 website mock-up), `#3300CC` (violet) | **Doc**: PDF metadata. Usage unclear |
| 2018 identity: neutrals | grey ramp `#252525` → `#F2F2F2`, plus black and white | **Doc**: PDF metadata |
| 2018 charts | muted blue-grey bars ≈ `#ADC4CF` | Inference (PDF pp.8–9) |
| Interiors (Moorgate) | "corrugated metal … bold pops of orange", "metal, tinted mirror, and ceppo stone", changing rooms "ceppo stone and rich wine colour" | Reports (e-architect, 2026-10-09) |

**Light vs dark use [Inference from screenshots and the PDF]:**
- **Dark** is the default app surface: true black, near-black cards, white type, and a white pill for the selected state.
- **Light** appears as a warm off-white bottom sheet (guest-pass confirmation) with black serif headline, grey body and a black pill button.
- The 2018 print identity is mostly white paper with black serif and coral accents, plus black panels for emphasis.
- Coral is a **highlight, not the action colour**: primary actions are monochrome in both modes.

### 3.2 Typography

- **Embedded fonts in the agency's award PDF [Doc: file metadata]:** GT Sectra Fine Regular, GT Sectra Display Bold, GT Sectra Regular, Circular Std Book, Portrait Text Bold. Usage visible in the PDF [Doc: page images]:
  - Serif headlines in sentence case ("Training for life", the large pull-quotes).
  - Very large serif figures in coral ("38%", "£2m").
  - Small geometric-sans uppercase labels with wide letter-spacing ("TURNOVER GROW BY", "THE BRIEF").
  - Geometric-sans body text.
- **2024 app relaunch [Inference: visual match, not confirmed by source]:**
  - A sharp, high-contrast serif for the emotional greeting ("Good Morning Lauren, / you're on a 4 week streak. / Keep it up.", with the second line in grey) and for the sheet headline ("Your Guest Pass has been sent!").
  - A geometric sans resembling Circular for everything functional.
  - **Uppercase, letter-spaced section labels and nav titles** ("MY BOOKINGS", "YOUR ACTIVITY"), roughly +10–15% tracking, medium/semibold weight.
  - Screen titles otherwise in sentence-case sans ("Choose your session").
- **Website [Doc: rendered text]:** sentence-case headings ("Training *for* life", "World-class facilities"), with italic emphasis on one word in the hero. CTAs are sentence case ("Find your club", "Book a tour").
- **Hierarchy pattern [Inference]:** one serif statement per screen at most. Everything else is a calm sans at 2–3 sizes. Caps labels mark sections, not actions.
- **Licences [Doc]:**
  - **GT Sectra** is a commercial Grilli Type family (GT Sectra, Fine, Display; released 2013). Embedding it in an app needs Grilli's **App licence**, priced by the number of developers/computers. Trial fonts have a reduced character set and are meant for mock-ups and testing (grillitype.com/information).
  - **Circular** is a commercial Lineto family (Buy Family / Trial / Pricing pages; the licence text isn't on the typeface page) (lineto.com).
  - For a free personal app, neither is appropriate unless Ben buys a licence.

### 3.3 Layout, mood, imagery, iconography, motion

- **Whitespace [Doc: images; sizes are Inference]:**
  - The app home leaves roughly 20% of the screen height empty between the top bar and the serif greeting. The greeting is the focal element.
  - Side margins are about 24pt at a 390pt width.
  - Section gaps are large (~32pt), and cards are spaced ~16pt apart.
- **Components [Doc: images; details are Inference]:**
  - Cards: rounded ~16–20pt, near-black fill, no border.
  - Chips and segmented controls: full pills. The selected chip is a **white fill with black text**; unselected chips are a grey fill or a 1pt grey outline with white text.
  - Date strip: the selected day is a tall white capsule.
  - Primary button: a full-width pill.
  - Numbered steps: small circular dark badges.
  - Progress: a thin 2pt line at the top of a flow.
  - Hairline dividers between list rows and below headers.
- **Iconography [Inference]:** thin-line icons (back chevron, location pin, check in an outlined circle, magnifier) at about 1–1.5pt stroke weight. No filled glyph style, and no colour on icons except the coral highlight.
- **Photography [Doc: images]:** full-bleed, dark, moody, theatrical lighting. The og:image shows a kettlebell athlete under white cross-shaped light fixtures on a black ceiling. Class cards carry photos with white text overlaid. The 2018 campaign was "Shot by a travel, rather than fitness, photographer" (PDF p.7). **We have no photography and shouldn't add stock photos.** In our app, typography and numbers carry the mood instead [Inference].
- **Copy tone [Doc]:** confident, warm, short ("Seamlessly find, book and manage classes.", "Training for life").
- **Motion:** no source documents their motion. BuiltWith lists Flickity (carousels) and IntersectionObserver, possibly from an older build [Reports]. An app release note fixed "a carousel issue where swiping the personalised home page would snap back" (6.5.1) [Doc]. Nothing to borrow here; our motion rules (≤200 ms, no decorative animation) stay.
- **Accessibility signals [Doc]:**
  - The App Store says "The developer has not yet indicated which accessibility features this app supports".
  - v6.7.2 (28 Sep 2026) notes "Accessibility improvements to the classes tab".
  - In the activity card, the future weekday letters and the "September 2024" caption look like dark grey on near-black, probably below 4.5:1 [Inference]. **Don't copy that dimming.**

## 4. User feedback (light-touch; this is a visual report)

The App Store reviews concern club facilities and classes, plus "the many app issues that the club has" (Beth Bradbury, 3 Sep 2024) [Doc: App Store, 2026-10-09]. I found no feedback about the visual design itself. Ben's request is an aesthetic preference, so user feedback isn't decisive here.

## 5. What makes it read "premium": transferable principles

Each item is [Inference] grounded in the evidence above.

1. **Restraint in colour.** The interface is almost entirely black, white and warm greys. The single warm highlight appears in tiny doses (dots, a badge). Premium comes from the absence of colour, not from gold.
2. **Monochrome primary action.** The most important button is the highest-contrast neutral (white on black / black on paper), not a brand hue. This fits our one-accent rule exactly.
3. **Warm neutrals, not blue-greys.** Their off-whites lean warm (paper, stone), and the interiors use ceppo stone, metal and wine. Our current navy (`#0F1620`) and slate text read "tech/utility". A warm black reads "hospitality".
4. **Two voices of type.** A serif carries emotion and identity in 1 line per screen; a neutral sans carries function. They are never mixed within a line, and numbers in UI are never serif.
5. **Tracked uppercase as quiet signposting.** Small caps with wide letter-spacing label sections. Body, buttons and names stay sentence case.
6. **Space as a luxury.** The focal element gets generous empty space above it. There are fewer elements per screen and larger gaps between groups rather than more dividers.
7. **Flat, soft surfaces.** No shadows or gradients in the UI (gradients appear only in the marketing backdrops). Separation comes from small fill steps, hairlines and rounded corners. Chips and buttons are pills.
8. **Thin-line icons, few of them.** Icons stay out of the way and are never decorative.
9. **Confident, short copy.** Short declarative sentences, no exclamation-heavy hype (one "!" in a success sheet).

What we deliberately **don't** take: photography-led layouts, a serif logo or "III"-style mark, low-contrast greyed text, marketing gradients, and streak/gamified copy as a headline (it conflicts with our calm, non-nagging tone and adds no logging value).

## 6. Proposed "Direction D: Premium" tokens (our own values)

### 6.1 Tokens (D, recommended: porcelain accent)

Status colours are **unchanged** (they still pass and remain the only saturated hues).

| Token | Dark (default) | Light | Note |
|---|---|---|---|
| `color.bg.canvas` | `#0D0C0B` | `#F6F3EF` | Warm near-black (not `#000`, to limit OLED smear) / warm paper |
| `color.bg.surface` | `#181615` | `#FFFFFF` | |
| `color.bg.raised` | `#23201E` | `#EEE9E3` | |
| `color.border.divider` | `#302C29` | `#DDD6CE` | Decorative only (below 3:1 on purpose) |
| `color.border.control` | `#75706A` | `#857D75` | ≥ 3:1 on canvas, surface and raised |
| `color.text.primary` | `#F3EEE8` | `#15120F` | Porcelain / ink |
| `color.text.secondary` | `#B5ADA5` | `#57504A` | Warm grey |
| `color.text.tertiary` | `#948C84` | `#6B645D` | Hints only; never on `accent.subtle` |
| `color.accent` | `#EDE5DA` | `#1A1714` | Porcelain (dark) / ink (light) |
| `color.accent.pressed` | `#D6CCBF` | `#3A3530` | |
| `color.accent.subtle` | `#2B2724` | `#ECE5DC` | Active-set row background |
| `color.on.accent` | `#0D0C0B` | `#FFFFFF` | |
| `color.status.*` (+ `.subtle`) | unchanged | unchanged | Re-checked below |
| `color.scrim` | `#000000` at 55% | `#15120F` at 30% | Slightly stronger in dark because the canvas is darker |

**Mirrors (§2.2):**
- `icon.canvas` → `#0D0C0B`; `icon.mark` → `#EDE5DA`. The mark must not be a Roman numeral, stacked serif bars or any serif monogram.
- `widget.accent` → `#EDE5DA` / `#1A1714`.
- `launch.*` follow canvas and accent.

### 6.2 Contrast (WCAG 2.x relative luminance)

My hand calculation used the WCAG 2.x formula on the exact hex values, rounded to 2 decimals. **Re-check in a contrast tool before shipping.**

| Pair (dark) | Ratio | Pair (light) | Ratio |
|---|---|---|---|
| text.primary on canvas | 16.9:1 | text.primary on surface | 18.7:1 |
| text.primary on surface | 15.6:1 | text.primary on canvas | 16.9:1 |
| text.primary on raised | 14.0:1 | text.primary on raised | 15.5:1 |
| text.secondary on canvas | 8.8:1 | text.secondary on surface | 7.9:1 |
| text.secondary on surface | 8.1:1 | text.secondary on canvas | 7.2:1 |
| text.secondary on raised | 7.3:1 | text.secondary on raised | 6.6:1 |
| text.tertiary on canvas | 5.9:1 | text.tertiary on surface | 5.8:1 |
| text.tertiary on surface | 5.5:1 | text.tertiary on canvas | 5.3:1 |
| text.tertiary on raised | 4.9:1 (lowest; hints only) | text.tertiary on raised | 4.8:1 |
| text.tertiary on accent.subtle | 4.5:1 → **keep the rule: don't** | text.tertiary on accent.subtle | 4.7:1 (rule still applies) |
| on.accent on accent (Log) | 15.7:1 | on.accent (white) on accent (Log) | 17.9:1 |
| on.accent on accent.pressed | 12.3:1 | on.accent on accent.pressed | 12.1:1 |
| accent on canvas / surface (links, icons) | 15.7 / 14.4:1 | accent on surface / canvas | 17.9 / 16.1:1 |
| text.primary on accent.subtle | 12.8:1 | text.primary on accent.subtle | 14.9:1 |
| text.secondary on accent.subtle | 6.7:1 | text.secondary on accent.subtle | 6.3:1 |
| border.control on canvas / surface / raised | 4.0 / 3.7 / 3.3:1 (non-text ≥ 3:1) | border.control on surface / canvas / raised | 4.0 / 3.7 / 3.4:1 |
| status.done / warning / danger on canvas | ≈ 9.5 / 11.0 / 7.7:1 | status.* on surface (white, unchanged) | unchanged (≈ 5.0 / 5.9 / 6.5:1) |

The dark status ratios are scaled from design-system §2's existing figures, because the new canvas and surface are darker than the old ones. So the ratios can only rise [Inference, arithmetic].

### 6.3 Risks specific to D, and the fixes

1. **Accent ≈ text colour.** In both modes the accent is almost the same as `text.primary`, so accent-coloured text can't signal "link" by colour. Fix: links and text buttons (`Undo`, `Why? ›`, `Adjust`) always carry a chevron, an icon or an underline. The existing `SecondaryButton` outline already marks a control.
2. **Charts:** `chart.selected` (accent) would look the same as `chart.line` (text.primary). Fix under D: the selected point is the 10pt ring **plus** a filled centre in `bg.canvas` and a dashed vertical guide in `accent`. Alternatively, alias `chart.line` to `text.secondary` in D only. The designer picks one.
3. **Selected chips:** `accent.subtle` is only a small step from `bg.raised` (dark 1.1:1, light ≈ 1.0:1). Fix: selected chips add a `checkmark` and a 1.5pt `border.control`. Alternatively, use Third Space's pattern of an inverted fill (accent fill, on.accent text), but **only off the workout screen**, so Log stays the only accent-filled control there.
4. **Active set:** the porcelain left bar has no hue difference from done values. The existing icon, the "Now" label and the background already cover this. Test it at arm's length.
5. **Glare:** a large porcelain Log button in a dim gym may glare [Inference]. `#EDE5DA` is about 7% less luminous than `#F3EEE8`, which helps a little. This needs an on-device check (same open question as palette B).
6. **D vs GymBuddy palette B:** D is warm (espresso blacks, stone greys, paper light mode). B is cool zinc. If Ben likes both, choose one; don't mix them.

### 6.4 Optional variant D-Clay (coral-inspired accent)

Use this only if Ben specifically wants a visible Third-Space-like warm colour. It swaps 4 tokens and needs a `status.danger` change for harmony:

| Token | Dark | Light | Check |
|---|---|---|---|
| `color.accent` | `#E8A285` | `#9C4A2E` | Dark: on.accent `#0D0C0B` on it 9.3:1; accent on canvas 9.3:1, on surface 8.5:1. Light: white on it 6.1:1; accent on canvas 5.5:1 |
| `color.accent.pressed` | `#CF8A6E` | `#7E3A23` | on.accent 7.0:1 / white 8.3:1 |
| `color.accent.subtle` | `#3A2620` | `#F6E6DE` | text.primary on it 12.3:1 / 15.4:1; light accent text on it 5.0:1 |
| `color.on.accent` | `#0D0C0B` | `#FFFFFF` | |
| `color.status.danger` (**changed**) | `#FF6F8E` | `#B0174A` | Dark on canvas 7.4:1; light white-on 6.9:1. Moves danger from ≈ 4° to ≈ 345° hue, away from clay at ≈ 15–18°. `danger.subtle` needs re-tinting to match (designer) |

D-Clay risk [Inference]: a coral Log button can read as "warning/destructive" to some eyes. Clay also sits between danger red and warning amber, so status hues become less distinct even after the shift. This is why porcelain is the recommendation.

### 6.5 Type direction for iOS

| Topic | Proposal | Evidence / constraint |
|---|---|---|
| UI face | **SF Pro (system)**, unchanged: no `fontFamily`, Dynamic Type, tabular numerals for all loads, reps and times | Expo: "On iOS, it's SF Pro" by default [Doc: docs.expo.dev fonts]. Apple's SF licence forbids embedding font files ("You may not embed the Apple Font…"), so use the system font and never bundle it [Doc: developer.apple.com/fonts] |
| Weights | Move `type.title1` from Bold to **Semibold**. Keep `timerDisplay` / `loadDisplay` Semibold. Headline stays Semibold; body Regular | [Inference] Premium restraint, matching Third Space's lighter display weights. Bold Text accessibility still steps everything up one weight |
| Tracking | Leave SF's built-in optical tracking alone for body and titles. New token **`type.sectionLabel`**: 16/20, Semibold, uppercase via `textTransform`, `letterSpacing` +1.0pt (about +6%), `text.secondary`, scales with Callout | Their caps labels are tiny with ~0.1–0.15em tracking [Inference]. We keep our 16pt minimum, so less tracking is needed. Use it only for section headers (e.g. `THIS WEEK`, `NEXT TIME`), never for exercise names, buttons, numbers or anything over ~3 words |
| Display serif (optional) | **Newsreader** (Production Type, **OFL**, variable `opsz` 6–72 and `wght` 200–800). Use it for 2–3 non-numeric headings only: the Summary headline, the Today date/greeting line, empty-state titles. Size 28–34, weight ~400–500, `opsz` high | OFL metadata [Doc: google/fonts]. Bundle it via the `expo-font` config plugin (TTF/OTF; on iOS the family name comes from the file and the PostScript name is recommended) [Doc: Expo fonts] |
| Serif alternative | **Instrument Serif** (OFL, Regular + Italic only): a more condensed, editorial display face, closer to GT Sectra Display's sharpness | [Doc: google/fonts]. A single weight limits Bold Text handling; that would need a fallback to SF Pro Semibold |
| Not chosen | GT Sectra / Circular: paid app licences [Doc]. Apple **New York**: Apple exposes it as the system *serif design* through native font descriptors, not as a `fontFamily` name. Reaching it from React Native would need native code, and bundling the downloadable files is not covered by any app-embedding licence I could find | [Doc: developer.apple.com/fonts; Inference on React Native access, unverified on device] |
| Rules for the serif | Never for numbers, loads, timers, buttons or anything Ben reads mid-set. It must honour Dynamic Type via font scaling with a `maxFontSizeMultiplier` like other display tokens. If it fails a device check, drop it and nothing else changes | Design-system §1.2, §3 |

**Layout tweaks for D [Inference], all optional:**
- `PrimaryButton` radius `radius.pill` instead of `radius.md` (pill CTAs are a strong part of the Third Space look).
- Non-workout screens use a 20pt side margin (`space.screen` = 20). Workout screens keep 16.
- Add `space.6`–`space.8` above the focal element on Today and Summary.
- Icons: SF Symbols at `.light`/`.regular` weight outside the workout screen; keep `.semibold` on workout controls for legibility.

## 7. Proposed brief changes (for Ben to approve)

No change is required, because D fits brief §12 ("calm charcoal or navy background with one clear accent"). Two optional items:

1. **Brief §12 wording** (same tweak the GymBuddy report suggested): "calm charcoal, warm near-black or navy background with one clear accent (which may be a neutral light/dark accent)".
2. **If the display serif is adopted:** record an ADR ("Bundled OFL display font for non-numeric headings"). It adds a bundled asset and the `expo-font` config plugin, and it slightly reverses design-system §3's "system font only". It needs a pinned font version and its OFL licence file stored in the repo.

The choice of palette (A current / B monochrome / D premium / D-Clay) is a **design-system** decision for Ben via the designer, not a brief change.

## 8. Unknowns (need a device test or Ben's input)

- Third Space's **current** web CSS colours and fonts. A browser devtools check would settle this, but my tools couldn't read the stylesheets.
- Whether Ben means the app, the website, or the clubs' interiors. The interiors lean metal, stone, wine and orange rather than black and coral.
- Porcelain Log button glare in dim light versus the current blue. This needs an on-device side-by-side.
- Whether Newsreader renders well at our heading sizes, scales with Dynamic Type in our React Native setup, and handles Bold Text acceptably. This needs a device check in a development build (it doesn't work in Expo Go).
- Whether `textTransform: 'uppercase'` labels are read naturally by VoiceOver (they should be, because the source string stays sentence case). Quick device check.
