# AI connection (ChatGPT plan, personal OpenAI key, voice key, usage)

> **Revision 2026-10-08 (consolidation).**
> - This file is the **single owner** of API keys, spend caps, usage figures and the coach reply voice. profile-and-settings.md's separate key sheet and coach-voice screen (§2.6.2 there) are withdrawn; `Voice & alerts → Coach replies` opens §2.8 here. Canonical calls: `saveApiKey`, `removeApiKey`, `setSpendCap`, `getPersonalUsageSummary(purpose, month)` (now also returning `requestsWithoutUsage`), `setReplyVoice`.
> - AC3 and profile's PS3 are merged into one decision (open-decisions.md): **by default one key is entered once** (`Use the same key as text` is on whenever a text key exists, storing no second Keychain item); a separate key per purpose stays optional. AC2 and PS4 (in-app monthly caps) are one decision.
> - Credentials are in neither data domain and never in a backup or export (design-system §7.2). `Delete my data` removes them; `Reset coaching knowledge` doesn't.
> - Components merged into design-system: `ConnectionStatusCard` → `StatusCard` §9.41, `RouteOption` → `SettingsRow` radio variant §9.31, `SpendLine` §9.44, `SecureKeyField` §9.45, `timing.signInTimeout` §6.

Status: v0.1 draft, 8 Oct 2026. Covers brief §2 (own account first, personal API fallback, `getAiCapabilities` … `recordPersonalApiUsage`), CHANGELOG v0.2 (AI route), v0.6 (Ben has ChatGPT Pro: text only; opt-in OpenAI voice with his own key), [research ai-access-and-voice.md](../research/ai-access-and-voice.md) (OAuth facts, error codes, OpenAI UI guidelines, spike S1–S8), CLAUDE.md rules 1 and 7, and [device probe build 7](../device-tests/2026-10-08-probe-build7.md) (ChatGPT sign-in S1 **not implemented yet**; Keychain round-trip passes). Tokens: [design-system.md](design-system.md).

Everything here lives in **Profile → Coach → Coach connection**. None of it appears in the workout except the honest one-line states the other specs already define (`Offline`, `Coach not connected`, route line in the coach sheet). OAuth details, tokens and scopes never appear on workout screens (brief §2).

## 1. Purpose

The screen answers **"Is the coach connected, who pays for it, and what happens when it runs out?"**

Primary action by state:

| State | Primary |
|---|---|
| Nothing connected, ChatGPT sign-in supported | `Continue with ChatGPT` |
| Nothing connected, sign-in not supported on iPhone | `Use an OpenAI API key` |
| Connected | none (status screen; `Done` in nav) |
| Key entry | `Check and save key` |

Two separate things are set up here, and the UI keeps them apart:
1. **Text coach** (replies, tools): ChatGPT plan (default) or Ben's OpenAI API key (paid, opt-in).
2. **Coach voice** (spoken replies): Apple voice (default, free, on device) or OpenAI voice with Ben's key (paid, opt-in). Set cues always use Apple voice (rest-state §5). Speech input is always Apple on-device recognition (voice.md §6).

### Design decisions to confirm with Ben (flagged, not yet in the brief)

| # | Decision | Reason |
|---|---|---|
| AC1 | **The route is a setting Ben picks, never a fallback chain.** `Coach uses: ChatGPT plan / OpenAI API key`. Errors pause the coach; they never change this setting. Switching to the paid route needs a confirmation that names the cost | Rule 7 and brief §2: "Ask him to choose another route when unavailable" |
| AC2 | **Two spend caps, both shown.** OpenAI's own budget on the key's project (hard limit, set on OpenAI's site) **and** an in-app monthly cap per purpose (text, voice) that stops requests before they are sent (`checkPersonalSpendCap`). The app's figure is always labelled an **estimate** | v0.6 puts the cap on OpenAI's dashboard; brief §2 puts a personal cap in the app. A normal API key can't read billing, so the app can only estimate from the token counts each response reports |
| AC3 | **Separate key slots for text and voice**, with `Use the same key as text` on the voice slot. Recommend a separate OpenAI project per purpose so each has its own budget on OpenAI's side | v0.6 keeps voice separate from text; separate projects make OpenAI's hard limit per purpose |
| AC4 | **If spike S1 fails, ChatGPT sign-in is shown as unavailable with the reason, not hidden**, and the API key route is offered. Option C from the research (sign in on a computer, move the credential to the phone) is **not designed**: Ben has a Windows laptop, not the Mac the research assumed, and it moves a refresh token over a transfer channel. It needs its own decision | Honest state, and no unreviewed credential transfer |
| AC5 | The OpenAI-required **first-use notice** ("You're using your ChatGPT plan") is shown as the **success step of the sign-in flow** in Profile, never as a modal in the coach sheet or during a workout | Meets the guideline without a full-screen interruption between sets |
| AC6 | **Model choice is explicit.** After sign-in the app lists models from `GET /v1/models` (`visibility == "list"`, `display_name`) and preselects the one the app was tested with, if listed; otherwise the first. If the chosen model disappears, the coach pauses with `Choose model`; it doesn't pick another silently | Models aren't published; a silent model change alters coach behaviour Ben relies on |
| AC7 | API keys are stored in the Keychain with `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, shown only as `sk-…3F9a` after saving, and **not** included in backups. ChatGPT tokens likewise | Research §4; ADR 0005 backups hold training data only |

## 2. Layout

### 2.1 Coach connection, nothing connected (sign-in supported)

```
┌────────────────────────────────────────┐
│ ‹ Coach       Coach connection         │
├────────────────────────────────────────┤
│ Text coach                             │ type.headline
│ ┌────────────────────────────────────┐ │
│ │ ⊘ Not connected                    │ │ icon + word
│ │ Logging, targets, rest timers and  │ │
│ │ built-in progression work without  │ │
│ │ the coach.                         │ │
│ └────────────────────────────────────┘ │
│                                        │
│ Your ChatGPT Plus or Pro plan can run  │ type.callout
│ the coach's text replies. Voice isn't  │
│ included.                              │
│                                        │
│ Use an OpenAI API key instead (paid) › │ text link
│                                        │
│ Coach voice                            │
│ (•) Apple voice     Free · on device   │ see §2.8
│ ( ) OpenAI voice    Paid · not set up  │
│                                        │
├────────────────────────────────────────┤
│ [        Continue with ChatGPT       ] │ PrimaryButton
└────────────────────────────────────────┘
```

The button label follows OpenAI's UI guidelines. It's a plain `PrimaryButton`; no OpenAI logo is used unless OpenAI's guidelines supply an official asset for it.

### 2.2 Before sign-in (explainer sheet, medium detent)

```
┌────────────────────────────────────────┐
│ Connect your ChatGPT plan       Cancel │
│                                        │
│ • The coach's text replies count       │
│   toward your ChatGPT plan's usage.    │
│ • Voice isn't included. Spoken replies │
│   use Apple's voice unless you add an  │
│   OpenAI key.                          │
│ • Fizz can't see your ChatGPT chats or │
│   memory.                              │
│ • Your workouts stay on this phone.    │
│   The coach sends the parts it needs   │
│   to OpenAI to reply.                  │
│ • In ChatGPT's settings, leave using   │
│   credits after limits switched off    │
│   for this app, so the coach stops at  │
│   your plan's limit.                   │
│                                        │
│ A ChatGPT sign-in page opens next. If  │ text.secondary
│ you need a code from another app, have │
│ it ready first.                        │
├────────────────────────────────────────┤
│ [        Continue with ChatGPT       ] │
└────────────────────────────────────────┘
```

The "have the code ready" line exists because switching apps during sign-in can suspend the in-app listener (research §1, option B).

### 2.3 Sign-in handoff (system sheet + loopback)

Sequence, all on the phone:

```
 [Continue] ─► iOS alert: "Fizz" Wants to Use "openai.com" to Sign In  (system)
                 │ Continue                         │ Cancel ─► Cancelled
                 ▼
     ASWebAuthenticationSession sheet (system browser) over the app
     Ben signs in to ChatGPT and approves
                 │ redirect to http://127.0.0.1:<port>/auth/callback
                 ▼
     In-app loopback listener receives code ─► app closes the browser sheet
                 ▼
     "Checking your plan" (§2.4) ─► Connected (§2.5) / failure (§3)
```

- `beginAiConnection(ownerId, 'chatgpt_plan')` starts the local PKCE transaction and listener, then opens the browser sheet. Behind the sheet, the screen shows:

```
│ … Waiting for ChatGPT sign-in          │ static icon
│ Finish signing in on the ChatGPT page. │
│ [ Cancel ]                             │
```

- The listener times out after `timing.signInTimeout` (5 min). Cancel closes the sheet and the listener.
- The system alert wording is Apple's; we can't change it.

### 2.4 Checking (after the redirect)

```
┌────────────────────────────────────────┐
│ Connecting ChatGPT                     │
│                                        │
│ ✓ Signed in as you@example.com         │ step 1
│ … Checking coach access                │ step 2: scope chatgpt.tokens.use.direct
│ ○ Finding available models             │ step 3: GET /v1/models
│                                        │
│ Nothing is used from your plan yet.    │ text.secondary
└────────────────────────────────────────┘
```

Each step is real and shown only while it runs (same rule as workout-builder §3.2). No percentage.

### 2.5 Connected: first-use notice (AC5)

```
┌────────────────────────────────────────┐
│ You're using your ChatGPT plan         │ type.title2
│                                        │
│ The coach's replies now count toward   │
│ your ChatGPT plan. You can set a limit │
│ for this app and see usage in ChatGPT. │
│ Manage usage ›                         │ opens ChatGPT usage settings (browser)
│                                        │
│ Model                                  │
│ (•) GPT-6.1 Sol      tested with Fizz  │ display_name from /v1/models
│ ( ) GPT-6 Luna                         │
│ ( ) …                                  │
│                                        │
│ Voice isn't part of your plan. Spoken  │
│ replies use Apple's voice.             │
├────────────────────────────────────────┤
│ [                Done                ] │ PrimaryButton
└────────────────────────────────────────┘
```

Shown once, on the first successful connection. Model names come from the API; `tested with Fizz` marks the model in the app's config, only if present.

### 2.6 Coach connection, connected (status)

```
┌────────────────────────────────────────┐
│ ‹ Coach       Coach connection         │
├────────────────────────────────────────┤
│ Text coach                             │
│ ┌────────────────────────────────────┐ │
│ │ ✓ Connected · ChatGPT plan         │ │ status.done icon + words
│ │ Signed in as you@example.com       │ │
│ │ Model: GPT-6.1 Sol               › │ │ change model
│ │ This week: 42 coach messages from  │ │ local count, factual
│ │ this phone                         │ │
│ │ Limits are set in ChatGPT.         │ │
│ │ Manage usage ›                     │ │
│ └────────────────────────────────────┘ │
│                                        │
│ Coach uses                             │ AC1
│ (•) ChatGPT plan          Included     │
│ ( ) OpenAI API key        Paid · not   │
│                           set up     › │
│                                        │
│ Coach voice                            │
│ (•) Apple voice     Free · on device   │
│ ( ) OpenAI voice    Paid · not set up  │
│                                        │
│ Disconnect ChatGPT                     │ status.danger text, bottom
└────────────────────────────────────────┘
```

- No quota bar or percentage: OpenAI publishes no limits for this route (research §1). The local message count is the only number shown, and it says what it counts.
- `Model ›` opens the model list (§2.5 list only), refreshed from `listAvailableModels`.

### 2.7 OpenAI API key (text), setup

```
┌────────────────────────────────────────┐
│ ‹ Back   OpenAI API key · text         │
├────────────────────────────────────────┤
│ OpenAI bills you for each coach        │
│ message. About $5–9 a month for a      │ estimate from research §3, dated
│ mid-size model at 4 workouts a week    │
│ (estimate, checked 8 Oct 2026).        │
│                                        │
│ 1. On OpenAI's website, make a project │
│    for Fizz and set its monthly budget.│
│ 2. Create a key in that project and    │
│    paste it here.                      │
│                                        │
│ Key                                    │
│ ┌──────────────────────────────┬─────┐ │
│ │ sk-••••••••••••••••          │Paste│ │ secure field + Paste button
│ └──────────────────────────────┴─────┘ │
│                                        │
│ Stop at (this app's estimate)          │
│ [$2] [✓$5] [$10] [$20] [Other…]        │ ParamChip; per month
│ The app stops sending before this.     │
│ OpenAI's budget is the hard limit.     │
│                                        │
│ Stored in this iPhone's Keychain. Not  │ text.secondary
│ in backups.                            │
├────────────────────────────────────────┤
│ [         Check and save key         ] │ PrimaryButton above keyboard
└────────────────────────────────────────┘
```

- `Check and save key` calls `saveApiKey('text', key, cap, opId)`, which checks the key with `GET /v1/models` (no cost) before storing it. The key never appears again except `sk-…3F9a`.
- After saving, if the ChatGPT plan is the current route, the screen asks once:

```
│ Use your API key for the coach now?    │
│ OpenAI bills you for each message.     │
│ This month: $0.00 of your $5 cap.      │
│ [ Keep ChatGPT plan ]   [ Use API key ]│
```

### 2.8 Coach voice (spoken replies)

```
┌────────────────────────────────────────┐
│ ‹ Coach         Coach voice            │
├────────────────────────────────────────┤
│ Spoken coach replies                   │
│ (•) Apple voice                        │
│     Free, works offline, starts at     │
│     once.                              │
│     Voice: Serena (Enhanced)         › │ installed voices; ▶ Play
│ ( ) OpenAI voice (paid)                │
│     More natural. Needs internet and   │
│     your OpenAI key. Starts a little   │
│     later.                             │
│                                        │
│ Set cues ("Logged 100 kilos for 8")    │
│ always use the Apple voice.            │
│                                        │
│ ── OpenAI voice setup ──────────────── │ shown when OpenAI voice chosen
│ Key                                    │
│ [✓] Use the same key as text           │ only if a text key exists
│ ┌──────────────────────────────┬─────┐ │
│ │ sk-••••••••••••••••          │Paste│ │ hidden when "same key" is on
│ └──────────────────────────────┴─────┘ │
│ Voice: Alloy                         › │ list + ▶ Play sample
│ Stop at (this app's estimate)          │
│ [$1] [✓$2] [$5] [Other…]               │
│ About $1–2 a month at 4 workouts a     │
│ week (estimate, checked 8 Oct 2026).   │
│ If OpenAI voice isn't available, the   │
│ coach uses Apple's voice and says so.  │
├────────────────────────────────────────┤
│ [         Check and save key         ] │ only while setting up
└────────────────────────────────────────┘
```

- Voice names come from OpenAI's documented TTS voice list at build time; the example name is illustrative.
- `▶ Play sample` for OpenAI voice shows `Uses a few characters of your credit (less than 1 cent).` the first time.
- Apple: if no Enhanced or Premium voice is installed, the row reads `Voice: Daniel (Default quality)` with `Download better voices in iOS Settings ›` (opens Settings; the exact path in iOS is verified on device).

### 2.9 Usage and spend (API key routes)

Inside each key's screen, once saved:

```
│ October (estimate)                     │
│ Text   $1.42 of $5.00 · 380 messages   │ tabular; no ring, no bar animation
│ Voice  $0.31 of $2.00 · 96 replies     │
│ Estimated from the usage OpenAI        │ text.secondary
│ reports for each request, at prices    │
│ checked 8 Oct 2026. Your OpenAI bill   │
│ is the final figure.                   │
│ History ›                              │ month list
│                                        │
│ Key sk-…3F9a · added 8 Oct             │
│ [ Replace key ]       Remove key       │ Remove in status.danger
```

A static 4pt bar under each line (filled share in `text.secondary`, no animation) is optional; the text carries the meaning. At ≥ 80% the line gains `⚠ 80% of cap` (warning icon + text).

## 3. States

### 3.1 Text coach: ChatGPT plan

| State | Shows | Coach elsewhere |
|---|---|---|
| Not connected | §2.1 | `Coach not connected` (coach sheet, Talk `Offline`/`Ask`, summary) |
| Sign-in not supported on this iPhone (capability flag `chatgptSignIn: false`, from spike S1) | Card: `⊘ ChatGPT sign-in doesn't work on iPhone yet` · `OpenAI's sign-in for personal apps returns to a local address that this iPhone app can't receive yet. We'll turn it on if a test passes.` · primary `Use an OpenAI API key` · link `Continue without the coach` | `Coach not connected` |
| Explainer | §2.2 | — |
| Waiting for sign-in | §2.3 behind the browser sheet | — |
| Checking | §2.4 | — |
| Connected (first time) | §2.5 | Coach available |
| Connected | §2.6 | Route line `Using ChatGPT plan · Manage usage` |
| Cancelled | Inline `Sign-in cancelled. Nothing was connected.` on §2.1 | — |
| Didn't come back | `The sign-in page didn't return to Fizz.` · `This can happen if you switch apps while signing in.` [Try again]. After 2 failures in a row: also `Signing in may not work on this iPhone yet.` [Use an OpenAI API key] | — |
| Timed out (5 min) | `Sign-in took too long. Nothing was connected.` [Try again] | — |
| Not eligible (`subscription_sharing_user_not_eligible`) | `⊘ This ChatGPT account can't be used by other apps.` · `Plus and Pro plans can, unless a work or school workspace blocks it.` [Use a different account] [Use an OpenAI API key]. **No automatic retry or repeated sign-in** | `Coach not connected` |
| Coach access not granted (scope missing) | `Signed in, but ChatGPT didn't allow coach replies for this app.` [Try again] [Use an OpenAI API key] | `Coach not connected` |
| Region not supported (403 region policy) | `ChatGPT plan use in other apps isn't available in your region.` [Use an OpenAI API key] | `Coach not connected` |
| No network (before sign-in) | `Continue with ChatGPT` disabled, caption `Needs internet` | — |
| Refreshing | Nothing shown (silent) | Unchanged |
| Expired / revoked (refresh fails, 401) | Card `⚠ ChatGPT disconnected` · `Sign in again to use the coach. Your conversations and memory are kept.` [Sign in again] | Coach sheet banner `ChatGPT disconnected…` |
| Usage limit (`subscription_sharing_usage_limit_exceeded`, 429) | Card `⚠ ChatGPT usage limit reached` · `The coach is paused. Logging and built-in targets still work.` · primary `Manage usage` · if a key exists: `Switch coach to your API key (paid) ›`. **No reset time is shown** (an app-specific cap may apply) | Coach sheet banner; `Adjust` outcome `Couldn't reach the coach (limit reached). Nothing changed.`; summary `Built-in rule (coach unavailable)` |
| Usage temporarily unavailable (`subscription_sharing_usage_unavailable`) | `ChatGPT usage isn't available right now. Try again later.` [Try again] | `Couldn't reach the coach…` |
| Model unavailable | `⚠ GPT-6.1 Sol isn't available any more.` [Choose model] (AC6) | Coach paused |
| Disconnect confirm | Alert: `Disconnect ChatGPT? The coach stops until you connect again. Your workouts, conversations and memory stay.` [Disconnect] [Cancel] | — |
| Disconnected | §2.1 with toast `ChatGPT disconnected` | `Coach not connected` |

### 3.2 Text coach: OpenAI API key

| State | Shows |
|---|---|
| Not set up | Row `OpenAI API key · Paid · not set up ›` |
| Entering | §2.7 |
| Checking | Primary shows `Checking…`; field read-only |
| Invalid key (401) | Field warning `OpenAI didn't accept this key. Check you copied all of it.` |
| No model access | `This key works, but its project can't use any chat models. Check the project's model settings on OpenAI.` |
| No network | `Can't check the key without internet.` (the key isn't saved unchecked) |
| Saved, not in use | Row `OpenAI API key · sk-…3F9a · not in use` |
| In use | Route line `Using your OpenAI API key (paid) · $1.42 of $5 this month` |
| Near cap (≥ 80%) | Route line adds `⚠`; status screen `⚠ 80% of cap` |
| Paused at app cap (`checkPersonalSpendCap` refuses) | `Paused: you've reached your $5.00 cap for October.` [Change cap]. Requests are refused **before** sending. **Does not switch to ChatGPT or anything else** |
| OpenAI refuses for billing (`insufficient_quota`) | `OpenAI says this key is out of credit or over its budget.` [Open OpenAI billing ›] |
| Key removed | Route returns to `ChatGPT plan` **only if it's connected**; otherwise `Coach not connected`. Toast `Key removed from this iPhone` |

Switching routes is always Ben's tap on `Coach uses`. Moving **to** the API key shows the cost confirmation (§2.7) every time it's chosen from a paused or limit state, and the first time otherwise.

### 3.3 Coach voice

| State | Shows | Spoken replies use |
|---|---|---|
| Apple voice (default) | §2.8 | Apple |
| Apple, only default-quality voices installed | Row note + `Download better voices…` | Apple |
| OpenAI voice chosen, not set up | Setup section open | Apple until saved |
| OpenAI voice active | `OpenAI voice · Alloy · $0.31 of $2.00 this month` | OpenAI |
| OpenAI voice unavailable now (offline, key fails, cap reached, slow) | Status line `Using Apple voice: <reason>` in Coach voice and once in the voice strip per workout (voice.md §3.2) | Apple, and says so |
| Paused at voice cap | `Voice paused at your $2.00 cap for October. Using Apple voice.` [Change cap] | Apple |

Falling back from the paid voice to the free Apple voice is the only automatic switch in this file. It goes **away** from spending and is always announced (v0.6).

### 3.4 Transitions (text coach)

```
 Not connected ──Continue──► Explainer ──Continue──► Waiting ──redirect──► Checking
      ▲  ▲  │                    │ Cancel               │ cancel/timeout      │
      │  │  │ Use API key        ▼                      ▼                     ├─ ok ─► Connected (first-use) ─► Connected
      │  │  ▼               Not connected        Cancelled / Didn't come back │
      │  │ Key setup ──saved──► Key saved (not in use) ──Use API key──► Key in use
      │  │                                                                     ├─ not eligible / no scope / region ─► Not connected (+reason)
      │  └──────── Disconnect ◄── Connected ──limit──► Limit (paused) ──Manage usage / wait──► Connected
      │                             │ │ refresh fails                 └─ Switch to API key (confirm) ─► Key in use
      └──── Remove key ◄── Key in use ◄┘ model gone ─► Model unavailable ─Choose model─► Connected
                              │ cap ─► Paused at cap ─Change cap / new month─► Key in use
```

The arrow from `Limit` to `Key in use` exists only through Ben's tap and the cost confirmation.

## 4. Interactions

- **Continue with ChatGPT** → explainer → `beginAiConnection` → browser sheet. `completeAiConnection(transactionId, code)` validates state and PKCE, checks the granted scopes include `chatgpt.tokens.use.direct`, stores tokens (Keychain) and the issued `client_id`, then `listAvailableModels`. The persisted `ext_agent_host_id` is reused on later sign-ins (research §1).
- **Manage usage** opens ChatGPT's usage settings in the in-app browser sheet (URL from OpenAI's guidelines). Nothing in the app changes.
- **Model ›** → list → tap selects (`selectModel`), toast `Coach will use GPT-6 Luna`. Takes effect on the next message, never mid-turn.
- **Coach uses** radio → `setTextRoute`. Choosing the API key shows the cost confirmation (§2.7). Choosing the ChatGPT plan when it isn't connected starts sign-in.
- **Paste** pastes from the clipboard into the secure field. The field rejects text that isn't key-shaped (`sk-` prefix) with `That doesn't look like an OpenAI key.`
- **Replace key** opens §2.7 with the field empty; the old key stays in use until the new one passes the check. **Remove key** confirms: `Remove this key from this iPhone? It stays active on OpenAI until you delete it there.` [Remove] [Cancel].
- **Disconnect ChatGPT** → confirm → `disconnectAiConnection` (revokes where supported, deletes tokens). Conversations, memory, workouts stay.
- **Cap chips** → `setSpendCap(purpose, monthlyUsd)`. `Other…` opens a numeric keypad (whole dollars). Lowering the cap below this month's estimate pauses that purpose at once and says so.
- **Voice choice** → `setReplyVoice`. `▶` buttons preview (Apple: free; OpenAI: notice first time).
- **Coach-sheet and workout entry points** (`Connect`, `Connect in Profile`, `Sign in`, `Choose model`, `Change cap`) all deep-link here to the relevant section.
- **Voice equivalents:** none for connection, keys or caps. Saying "use my API key" replies `Change the coach's route in Profile → Coach connection.` (spoken in Conversation mode). Money and credentials are tap-only.
- **Undo:** route switch → switch back (radio). Model change → choose again. Disconnect / remove key → sign in / paste again (confirmed first, no Undo). Cap change → change again.

## 5. Copy

| Element | Text |
|---|---|
| Screen | `Coach connection` · sections `Text coach` · `Coach uses` · `Coach voice` |
| Not connected | `Not connected` · `Logging, targets, rest timers and built-in progression work without the coach.` |
| Plan pitch | `Your ChatGPT Plus or Pro plan can run the coach's text replies. Voice isn't included.` |
| Primary | `Continue with ChatGPT` · `Use an OpenAI API key` · `Check and save key` · `Done` |
| Links | `Use an OpenAI API key instead (paid) ›` · `Continue without the coach` · `Manage usage ›` |
| Explainer | Title `Connect your ChatGPT plan` · bullets as §2.2 · `A ChatGPT sign-in page opens next. If you need a code from another app, have it ready first.` |
| Waiting | `Waiting for ChatGPT sign-in` · `Finish signing in on the ChatGPT page.` |
| Checking | `Connecting ChatGPT` · `Signed in as <email>` · `Checking coach access` · `Finding available models` · `Nothing is used from your plan yet.` |
| First use | `You're using your ChatGPT plan` · `The coach's replies now count toward your ChatGPT plan. You can set a limit for this app and see usage in ChatGPT.` · `Voice isn't part of your plan. Spoken replies use Apple's voice.` · model tag `tested with Fizz` |
| Connected | `Connected · ChatGPT plan` · `Signed in as <email>` · `Model: <display_name>` · `This week: 42 coach messages from this phone` · `Limits are set in ChatGPT.` |
| Route options | `ChatGPT plan · Included` · `OpenAI API key · Paid · not set up` / `Paid · sk-…3F9a` |
| Unsupported | `ChatGPT sign-in doesn't work on iPhone yet` · `OpenAI's sign-in for personal apps returns to a local address that this iPhone app can't receive yet. We'll turn it on if a test passes.` |
| Failures | `Sign-in cancelled. Nothing was connected.` · `The sign-in page didn't return to Fizz.` · `This can happen if you switch apps while signing in.` · `Signing in may not work on this iPhone yet.` · `Sign-in took too long. Nothing was connected.` · `This ChatGPT account can't be used by other apps.` · `Plus and Pro plans can, unless a work or school workspace blocks it.` · `Signed in, but ChatGPT didn't allow coach replies for this app.` · `ChatGPT plan use in other apps isn't available in your region.` · `Needs internet` |
| Expired | `ChatGPT disconnected` · `Sign in again to use the coach. Your conversations and memory are kept.` [Sign in again] |
| Limit | `ChatGPT usage limit reached` · `The coach is paused. Logging and built-in targets still work.` [Manage usage] · `Switch coach to your API key (paid) ›` |
| Unavailable | `ChatGPT usage isn't available right now. Try again later.` |
| Model gone | `<model> isn't available any more.` [Choose model] · toast `Coach will use <model>` |
| Disconnect | `Disconnect ChatGPT` · `Disconnect ChatGPT? The coach stops until you connect again. Your workouts, conversations and memory stay.` [Disconnect] [Cancel] · toast `ChatGPT disconnected` |
| Key screen | Title `OpenAI API key · text` / `OpenAI voice` · `OpenAI bills you for each coach message.` · cost estimate line with date · steps 1–2 · `Key` · `Paste` · `Stop at (this app's estimate)` · `The app stops sending before this. OpenAI's budget is the hard limit.` · `Stored in this iPhone's Keychain. Not in backups.` |
| Key errors | `That doesn't look like an OpenAI key.` · `OpenAI didn't accept this key. Check you copied all of it.` · `This key works, but its project can't use any chat models. Check the project's model settings on OpenAI.` · `Can't check the key without internet.` |
| Switch confirm | `Use your API key for the coach now?` · `OpenAI bills you for each message.` · `This month: $0.00 of your $5 cap.` [Keep ChatGPT plan] [Use API key] |
| Usage | `October (estimate)` · `Text $1.42 of $5.00 · 380 messages` · `Voice $0.31 of $2.00 · 96 replies` · `Estimated from the usage OpenAI reports for each request, at prices checked 8 Oct 2026. Your OpenAI bill is the final figure.` · `⚠ 80% of cap` |
| Cap reached | `Paused: you've reached your $5.00 cap for October.` [Change cap] · voice: `Voice paused at your $2.00 cap for October. Using Apple voice.` |
| Billing refusal | `OpenAI says this key is out of credit or over its budget.` [Open OpenAI billing ›] |
| Remove key | `Remove this key from this iPhone? It stays active on OpenAI until you delete it there.` [Remove] [Cancel] · toast `Key removed from this iPhone` |
| Voice screen | `Spoken coach replies` · `Apple voice` · `Free, works offline, starts at once.` · `OpenAI voice (paid)` · `More natural. Needs internet and your OpenAI key. Starts a little later.` · `Set cues ("Logged 100 kilos for 8") always use the Apple voice.` · `Use the same key as text` · `If OpenAI voice isn't available, the coach uses Apple's voice and says so.` · `Uses a few characters of your credit (less than 1 cent).` · `Download better voices in iOS Settings ›` |
| Voice fallback | `Using Apple voice: no connection` · `…: key not accepted` · `…: voice cap reached` · `…: OpenAI voice too slow` · key removed: `Add a key to use OpenAI voice.` |
| Voice request | `Change the coach's route in Profile → Coach connection.` |

Money is always shown in USD with two decimals (`$1.42`), tabular, and labelled `estimate` wherever it's the app's figure.

## 6. Data needed

Existing (brief §2): `getAiCapabilities(userId)`, `beginAiConnection(userId, mode)`, `completeAiConnection(transactionId, code)`, `resolveInferenceRoute(userId, modality)`, `refreshAiConnection(connectionId)`, `disconnectAiConnection(connectionId)`, `checkPersonalSpendCap(requestId, estimate)`, `recordPersonalApiUsage(requestId, actualUsage)`. Entity `AiConnection` / `PersonalUsage`.

`getAiCapabilities` must return, without secrets: `text: {route: 'chatgpt_plan' | 'api_key' | null, status: 'ok' | 'not_connected' | 'expired' | 'limit' | 'unavailable' | 'not_eligible' | 'no_scope' | 'region' | 'model_gone' | 'cap_reached' | 'billing' | 'offline', model?, email?}`, `voiceOut: {engine: 'apple' | 'openai', status, fallbackReason?}`, `speechIn` (voice.md), `chatgptSignIn: boolean` (spike S1 flag), and per-purpose usage summaries.

**Proposed new (contracts to add; flagged for the developer and Ben):**

| Function | Contract |
|---|---|
| `listAvailableModels(connectionId)` | Research proposal 2. `GET /v1/models`, `visibility == "list"`, returns `{id, displayName, testedWithApp}` |
| `selectModel(connectionId, modelId)` | Applies from the next turn |
| `setTextRoute(ownerId, 'chatgpt_plan' \| 'api_key', confirmation)` | Requires `confirmation: {acknowledgedPaid: true}` when moving to `api_key`. The only way the route changes (AC1) |
| `saveApiKey(purpose: 'text' \| 'voice', key \| {sameAs: 'text'}, capUsd, opId)` | Validates with `GET /v1/models` (and, for voice, that a TTS model is listed), stores in Keychain (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`), returns `{last4}`. Never logs the key |
| `removeApiKey(purpose)` | Deletes from Keychain; resolves the route as §3.2 |
| `setSpendCap(purpose, monthlyUsd)` | In-app cap read by `checkPersonalSpendCap` |
| `getPersonalUsageSummary(purpose, month)` → `{estimateUsd, capUsd, requests, requestsWithoutUsage, priceTableCheckedAt}` (canonical; profile-and-settings' variant withdrawn) | From `recordPersonalApiUsage` rows × the app's dated price table |
| `getLocalCoachMessageCount(ownerId, weekStart)` | The ChatGPT-plan usage line (factual local count) |
| `setReplyVoice({engine, voiceId})`, `previewVoice(engine, voiceId)` | Coach voice; preview through the same spend check |
| `PriceTable` (bundled, dated) | Per model: input, cached input, output per 1M tokens; TTS per 1M characters/tokens; `checkedAt`. Updated with app builds |

## 7. Acceptance checks

1. With nothing connected, the whole workout loop, `Next time` (built-in rule) and rest alerts work; the coach shows `Coach not connected`, never a canned reply.
2. With `chatgptSignIn: false`, the ChatGPT card states it doesn't work on iPhone yet and offers the API key; the `Continue with ChatGPT` button isn't shown as if it might work.
3. (When S1 passes) Sign-in from tap to `You're using your ChatGPT plan` uses the system browser sheet, returns via the loopback listener and closes the sheet without Ben switching apps. Granted scopes are checked; a sign-in without `chatgpt.tokens.use.direct` shows `didn't allow coach replies` and stores no tokens.
4. Cancel in the system alert or browser sheet leaves nothing stored and shows `Sign-in cancelled…`. Backgrounding during sign-in ends in `didn't return to Fizz` (or success), never a hang longer than 5 min.
5. A `user_not_eligible` 403 shows the not-eligible state once; the app makes no further OAuth or inference attempts until Ben taps something (network log).
6. A 429 `usage_limit_exceeded` pauses the coach with `Manage usage`; no request is sent on the API-key route even with a key saved (provider log), and no reset time is displayed.
7. Switching to the API key always requires the cost confirmation from a paused or limit state; the route line then reads `Using your OpenAI API key (paid)…`.
8. With a $5 cap and this month's estimate at $4.99, a request whose reserved estimate exceeds the cap is refused before sending, with `Paused: you've reached your $5.00 cap…`; the route doesn't change.
9. Usage estimates match `recordPersonalApiUsage` totals × the price table (unit test); every money figure on screen carries `estimate` and the price-table date.
10. The key is never shown in full after saving, isn't in a backup file (search the backup JSON), and survives an app relaunch (Keychain).
11. Revoking access in ChatGPT settings, then sending a message, shows `ChatGPT disconnected…` with `Sign in again`; conversations and memory remain.
12. A model removed from `/v1/models` pauses the coach with `Choose model`; no other model is used until Ben picks one.
13. OpenAI voice offline: a coach reply is spoken in the Apple voice and the strip shows `Using Apple voice: no connection` once; set cues are unaffected throughout.
14. The voice slot's `Use the same key as text` stores no second copy in the Keychain. Removing the text key switches spoken replies to the Apple voice and reopens the OpenAI voice setup section with `Add a key to use OpenAI voice.`; nothing is spoken through OpenAI afterwards.
15. Saying "use my API key" changes nothing and gives the Profile instruction.
16. No OAuth, token or scope wording appears on Today, the workout, rest or summary.
17. Every status is icon + word; money and counts use tabular numerals; at AX3 the primary stays visible above the keyboard on the key screen.

## Proposed design-system additions

No new colours.

| Token / component | Value / spec |
|---|---|
| `timing.signInTimeout` | 5 min. Loopback listener and browser sheet close; `Sign-in took too long…` |
| `ConnectionStatusCard` | `bg.surface`, 1pt `border.control`, `radius.md`, padding `space.4`. Line 1 icon + status word (`type.headline`): `checkmark.circle.fill` `status.done` (Connected), `xmark.circle` `text.secondary` (Not connected), `exclamationmark.triangle` `status.warning` (Expired, Limit, Paused, Model gone), `slash.circle` `text.secondary` (Unsupported, Not eligible). Body `type.callout` |
| `RouteOption` | Radio row ≥ 52pt: radio + name (`type.body`) + right-aligned cost word (`Included` / `Free · on device` / `Paid · …`, `type.label`, `text.secondary`). The word `Paid` is always text, never colour |
| `SpendLine` | `type.callout` tabular: `Text $1.42 of $5.00 · 380 messages`; optional static 4pt bar (`bg.raised` track, `text.secondary` fill), no animation; `⚠ 80% of cap` with warning icon at ≥ 80% |
| `SecureKeyField` | `bg.raised`, `radius.sm`, 52pt, masked, trailing `Paste` text button (44pt); after save shows `sk-…3F9a` read-only |

## Cross-links

- [coach-sheet.md](coach-sheet.md): route line, limit/cap/expired/model banners and their deep links here.
- [profile-and-settings.md](profile-and-settings.md) §2.6–§2.7: the Profile rows that open this file (Coach connection; Voice & alerts → Coach replies).
- [onboarding.md](onboarding.md) §2.8: the optional first-run entry to §2.2 and §2.7.
- [data-import-export.md](data-import-export.md) §2.7: `Delete my data` disconnects and removes keys.
- [voice.md](voice.md) §6: speech input engine and the spoken-reply engine switch at runtime.
- [coach-adjustments.md](coach-adjustments.md) §3.1 and [workout-summary.md](workout-summary.md): coach failure lines and `Built-in rule (coach unavailable)`.
- [rest-state.md](rest-state.md) §5: Conversation mode is selectable only when `getAiCapabilities` reports a route; set cues always Apple.
- [today.md](today.md), [active-workout.md](active-workout.md) §4.7: `Offline` / `Ask` / `Coach not connected` states.
- Research: [ai-access-and-voice.md](../research/ai-access-and-voice.md) §1 (OAuth, errors, UI guidelines), §3 (cost estimates), spike S1–S8.
- [design-system.md](design-system.md) §9.2, §9.12, §9.17.
