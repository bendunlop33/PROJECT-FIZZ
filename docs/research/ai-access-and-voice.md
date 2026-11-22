# AI access and voice for the embedded coach

Researcher: `researcher` agent. All sources checked **2026-10-08** unless stated otherwise. Covers brief §2, §3, §8 and §11.

## Summary

1. The documentation does not rule out a native iOS app using Ben's ChatGPT plan through "Sign in with ChatGPT", but it does not confirm it either. The plan-usage flow is documented for "open-source and locally hosted apps" and "personal projects that run locally". It requires a loopback `http://127.0.0.1` redirect and a local listener, and every example is a desktop or CLI app. Whether this works from inside an iPhone app can only be settled by an on-device test.
2. Plan usage covers text only, through the Responses API (`store:false`, `stream:true`, function tools supported). There is no audio input, transcription, Realtime or GPT-Live. Plus and Pro qualify; sources disagree on Go. Model names and limits are not published, so models must be read from `GET /v1/models` at runtime.
3. Voice is cheapest and works offline using on-device Apple speech: SpeechAnalyzer or SFSpeechRecognizer to transcribe, and AVSpeechSynthesizer through `expo-speech` to speak. Cloud speech-to-text, text-to-speech, Realtime and GPT-Live all need a separate paid API key. Realtime and GPT-Live also expect a server to issue short-lived credentials.
4. As a personal API fallback, OpenAI and Claude cost about the same at Ben's usage. Roughly $5–9 a month for a mid-tier model, under $0.50 for small models, and about $1–2 a month extra for cloud speech replies. Both providers' function and tool calling fit the restricted tool registry. Claude Pro/Max subscriptions cannot be used by a third-party app; only a Claude API key is allowed.
5. **Proposed brief changes are included** (see the end of this file): a deterministic offline parser for spoken sets, one OpenAI Responses adapter shared by the ChatGPT-plan and API-key routes, Realtime pushed back to an explicit later decision, and a stated Anthropic restriction.

## Recommendations

1. **Build first:** one `ResponsesTextProvider` in `packages/providers` that follows the ChatGPT-plan restrictions (`store:false`, `stream:true`, no `temperature`/`max_output_tokens`/`previous_response_id`, function tools only, app-managed history). Only the credential source differs between the ChatGPT-plan route and a personal OpenAI key. Add a Claude adapter behind the same interface later.
2. **Spike the ChatGPT-plan route on Ben's iPhone before the coach work in build step 4**, using the plan below. Do not let manual logging depend on it.
3. **First voice release on device only:** on-device speech-to-text with `contextualStrings` or custom vocabulary for exercise names and numbers, a deterministic set parser in `packages/domain`, and `expo-speech` for scripted set cues and short coach replies. No API key and no backend needed.
4. **Defer Realtime and GPT-Live** until the turn-based loop has proven useful in the gym. When added, it needs a separately funded OpenAI key and a decision on how short-lived credentials are issued (see the brief changes).
5. **No automatic paid fallback.** The ChatGPT help page says an app may spend credits after plan limits only when the user explicitly allows it. Default that off, and treat `subscription_sharing_usage_limit_exceeded` as "coach paused", never as a reason to switch routes.
6. Do **not** reuse third-party "ChatGPT OAuth" projects that borrow another tool's client registration, such as `openai-oauth`. Register through the documented `dynamic_agent_client` flow, or not at all.

---

## 1. Using Ben's ChatGPT plan through "Sign in with ChatGPT"

### Documented facts

| Topic | What the official documentation says | Source |
|---|---|---|
| Who may use plan usage | "ChatGPT plan usage is available to open-source projects, personal projects that run locally, and selected private apps." Paid or remotely hosted apps must use the interest form. | [Cookbook](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt), [Open-source overview](https://developers.openai.com/siwc/token-sharing-open-source) |
| Commercial/identity-only | "Sign in with ChatGPT is currently available to selected commercial partners through a limited trial"; plan usage "available to all open-source partners and selected private clients". | [Quickstart](https://developers.openai.com/siwc/quickstart) |
| Eligible plans | Developer docs: "Eligible ChatGPT Plus and Pro users". Help Center (via search snippet; page returned 403 to the fetcher): plan usage "only available with Plus and Pro"; "All users can connect their account with supported open source tools". A secondary report says the Help Center lists Go. **Conflicting, unresolved.** | [Quickstart](https://developers.openai.com/siwc/quickstart), [Help Center 20001542](https://help.openai.com/en/articles/20001542-using-your-chatgpt-plan-in-other-apps-and-sites) |
| Usage pool | Eligible requests count toward the "ChatGPT Work and Codex usage" in the plan. Users can set a per-app weekly limit and review usage in ChatGPT settings. Credits are spent after limits only if explicitly allowed. | Help Center (search snippet, above) |
| Models | No list is published. Call `GET https://api.openai.com/v1/models` with the access token, keep entries where `visibility == "list"`, and show `display_name`. Examples use `gpt-6.1-sol`. | [Models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference) |
| Limits | No numbers are published. Errors: `subscription_sharing_usage_limit_exceeded` (429; do not guess a reset time, because an app-specific cap may apply), `subscription_sharing_usage_unavailable`, `subscription_sharing_user_not_eligible` (403; do not retry or loop OAuth), and region-policy 403s. | [Errors and recovery](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery) |
| Endpoint | Only `POST https://api.openai.com/v1/responses`. Do not use ChatGPT `backend-api`. | [Models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference) |
| Request restrictions | `store:false`, `stream:true`. Use `instructions` or developer messages; system-message items are rejected. These fields must be omitted: `background`, `conversation`, `max_output_tokens`, `max_tool_calls`, `metadata`, `moderation`, `prompt`, `prompt_cache_retention`, `safety_identifier`, `temperature`, `top_p`, `truncation`, `user` and others. Omit `previous_response_id` over HTTP. | [Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations) |
| Tools | Function and custom tools are supported, including namespaces. Not supported: image generation, file search, Code Interpreter, computer use, hosted MCP/connectors and `tool_search`. | Preview limitations |
| Inputs | Text, images and files (where the model accepts them). "Audio/video input, the Files upload API, and the transcription API are not supported by this flow." | Preview limitations |
| OAuth | First sign-in uses `client_id=dynamic_agent_client` plus an opaque persisted `ext_agent_host_id` (`urn:uuid:` is accepted). The callback returns an issued `client_id` (`oaiapp_…`) to reuse. Scopes: `openid profile email offline_access resource.invoke chatgpt.tokens.use.direct`, resource `https://api.openai.com/v1`. PKCE, with no client secret or API key. Inference is authorized only if `chatgpt.tokens.use.direct` was granted. | [Registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in) |
| Redirect | HTTP loopback `http://127.0.0.1:<port>/auth/callback`. "Do not substitute with `localhost`." The port may vary; scheme, host and path must not. **No custom-scheme or mobile option is documented.** | Registration and sign-in |
| Tokens | Access token lasts 1 hour. Refresh token lasts 30 days and rotates (a new 30-day token on each refresh, with no fixed chain limit). Replace access token, expiry, scopes and refresh token together. | [Token reference](https://developers.openai.com/siwc/token-sharing-open-source/token-reference) |
| Signing in elsewhere | For open-source apps on a remote VM, the documented pattern is: complete OAuth on a local machine, copy the credential file over a secure channel, and keep the VM's own host ID. Per-host usage attribution and revocation for transferred sessions are "not yet available". | [Self-hosted VMs](https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms) |
| What it does not grant | No access to ChatGPT conversations, memory or other account context. | Open-source overview |
| UI requirements | "Continue with ChatGPT" button; a first-use "You're using your ChatGPT plan" modal; a "Using ChatGPT plan" indicator with a "Manage usage" link near the composer; "Manage usage" as the main action on limit errors. | [UI/UX guidelines](https://developers.openai.com/siwc/ui-ux-guidelines) |

### Answers to the questions

- **Can a privately installed iOS app use it?** *Not documented either way.* Eligibility wording ("personal projects that run locally", "locally hosted") fits a single-user app on Ben's own phone with no server. That is my reading, not OpenAI's ruling. Every documented example is a desktop, Electron or CLI client. The mobile problem is technical: the redirect must reach a loopback listener inside the app.
- **Native mobile client permitted?** The documentation names no platform and excludes none. The only explicit exclusions are "paid or remotely hosted" apps.
- **Backend needed?** Not for the open-source/local flow. "You don't need a client secret or an API key" ([Cookbook](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt)), and the client exchanges the code itself. The website variant uses a backend, but that does not apply here.
- **Plans:** Plus and Pro are documented. Go is unclear. Treat Free as ineligible for plan inference. Business and Enterprise are not mentioned, and a workspace may block it (the `user_not_eligible` 403).
- **Models and limits:** Read at runtime. No published quota exists, so the app must handle 429s gracefully.

### Inference: possible iOS sign-in approaches (all unproven)

| Option | How | Risk |
|---|---|---|
| A. In-app loopback listener plus ASWebAuthenticationSession | Native module opens a socket on `127.0.0.1:<ephemeral>` and opens the auth URL in `ASWebAuthenticationSession`. The browser sheet redirects to the in-app listener, and the app closes the session itself. | `ASWebAuthenticationSession.Callback` only matches custom schemes or `https` host/path ([Apple](https://developer.apple.com/documentation/authenticationservices/aswebauthenticationsession/callback)). Completion would rely on the listener, not the callback. It is unknown whether the sheet's browser process can reach the app's loopback socket. Expo has no built-in local HTTP server module, so a small native module is needed. |
| B. Same as A but using Safari | Opening Safari puts the app in the background. | iOS may suspend the listener, so this is likely to fail. Not recommended. |
| C. Sign in on a Mac, transfer to the phone | A tiny companion script on Ben's Mac completes OAuth with the same registration, then the credential is moved to the phone (for example by QR code or AirDrop into Keychain), with the phone's own host ID kept. | Mirrors the documented VM pattern, but that guide is written for open-source apps on VMs. Per-host revocation is "not yet available". This puts a refresh token on a transfer channel. |

## 2. Voice: what is needed beyond the ChatGPT plan

The ChatGPT-plan route **cannot** carry audio. Every voice part is either on-device or separately funded.

### Speech-to-text

| Option | Facts | Cost or key | Source |
|---|---|---|---|
| Apple SpeechAnalyzer (`SpeechTranscriber`, `DictationTranscriber`, `SpeechDetector`) | New Speech framework API. Assets managed by `AssetInventory`. Custom vocabulary via `AnalysisContext` and `SFSpeechLanguageModel`. | Free, on-device | [Apple Speech](https://developer.apple.com/documentation/speech) |
| Apple SFSpeechRecognizer via `expo-speech-recognition` (community, jamsch) | Wraps SFSpeechRecognizer plus AVAudioEngine. Supports `requiresOnDeviceRecognition` (only if the device supports it), `contextualStrings` ("seems to work better on iOS") and `iosCategory`. Needs a config plugin and dev build. **No SpeechAnalyzer support mentioned.** | Free. Server mode sends audio to Apple. | [GitHub](https://github.com/jamsch/expo-speech-recognition) |
| `@react-native-ai/apple` (Callstack) | Transcription on iOS 26+ with downloaded language assets | Free, on-device | [AI SDK provider](https://ai-sdk.dev/v5/providers/community-providers/react-native-apple) |
| OpenAI `gpt-4o-mini-transcribe` / `gpt-transcribe` / `gpt-4o-transcribe` | $0.003 / $0.0045 / $0.006 per minute | Separate OpenAI API key | [OpenAI pricing](https://developers.openai.com/api/docs/pricing) |
| Anthropic | No speech API on the pricing page | n/a | [Claude pricing](https://platform.claude.com/docs/en/about-claude/pricing) |

### Text-to-speech

| Option | Facts | Cost or key | Source |
|---|---|---|---|
| `expo-speech` (SDK 57) | Device TTS with voice selection (`Default` or `Enhanced` quality), rate and pitch, `stop()`. iOS `useApplicationAudioSession:false` gives a separate session handling interruptions and ducking. **No sound when the phone is in silent mode** on physical iOS devices. Background playback is not covered. Works in Expo Go. | Free, offline | [Expo docs](https://docs.expo.dev/versions/latest/sdk/speech/) |
| OpenAI `gpt-4o-mini-tts` / `tts-1` | $0.60 per 1M text-input tokens plus $12 per 1M audio-output tokens / $15 per 1M characters | Separate OpenAI key | [OpenAI pricing](https://developers.openai.com/api/docs/pricing) |

### Live speech-to-speech

| Option | Facts | Cost | Source |
|---|---|---|---|
| OpenAI Realtime (`gpt-realtime-2.1`, `-mini`) over WebRTC | Server mints short-lived keys via `/v1/realtime/client_secrets` using a standard key; client posts SDP to `/v1/realtime/calls`. "Standard API keys … on the server". | mini audio: $10 in / $20 out per 1M audio tokens; full model: $32 / $64 | [Voice WebRTC](https://developers.openai.com/api/docs/guides/voice-webrtc), [pricing](https://developers.openai.com/api/docs/pricing) |
| OpenAI GPT-Live (`gpt-live-1`) | Full-duplex. `POST /v1/live/sessions` (WebRTC via your server). Function calling and delegation to a backend Responses model. `v1/realtime` is not supported. Starting a WebRTC session bills 15 s up front. | $0.05/min billed per second, **plus** backend model tokens | [GPT-Live 1](https://developers.openai.com/api/docs/models/gpt-live-1), [Voice WebRTC](https://developers.openai.com/api/docs/guides/voice-webrtc) |
| React Native transport | `react-native-webrtc` plus `@config-plugins/react-native-webrtc`; dev build only. A known Expo 50+ `event-target-shim` conflict needs a Metro fix. Only community demos exist for OpenAI Realtime in RN, with no official guide. | n/a | [VideoSDK guide](https://blogs.videosdk.live/integrate-videosdk-with-expo-react-native), [OpenAI community](https://community.openai.com/t/tool-calling-in-react-native-with-the-openai-webrtc-realtime-api/1130376) |

Inference: for a single-user app, a key held in Ben's iPhone Keychain could mint the short-lived credentials itself, with no server. That goes against OpenAI's "on the server" guidance, which is written for distributed clients. The risk is limited to Ben's own key on his own device. Ben should decide this explicitly rather than have it assumed.

### On-device model for parsing (optional)

Apple Foundation Models: on-device model with tool calling and guided (typed) generation. It needs an Apple Intelligence-capable device, has a **4,096-token context per session**, works offline, and has no usage limit. Apple recommends "no more than three to five tools per request" ([Apple](https://developer.apple.com/documentation/foundationmodels), [context window](https://developer.apple.com/documentation/foundationmodels/managing-the-context-window)). Private Cloud Compute (iOS 27+) gives 32K context and a daily per-user quota, but requires a **managed entitlement with eligibility requirements** ([Apple](https://developer.apple.com/documentation/foundationmodels/adding-server-side-intelligence-with-private-cloud-compute)). Inference: too small to be the coach, but it could be an offline fallback for turning ambiguous spoken phrases into a typed `SetCandidate`. Lower priority than a deterministic parser.

## 3. Personal API fallback: costs and tool calling

### Usage model (assumptions, not measurements)

- 4 workouts a week × 30 coach turns = **~520 turns a month**.
- Each turn averages 1.5 model calls (tool loop). Each call has ~4,000 input tokens (instructions ~1k, tool schemas ~1.5k, session context and recent messages ~1.5k), so **~6,000 input tokens per turn**. Output is **~375 tokens per turn**.
- Monthly totals: **~3.1M input tokens, ~0.2M output tokens.** About 60% of input is assumed to be a cached prefix.
- Spoken coach replies: ~200 characters each → ~104k characters a month. Spoken set cues: ~1k characters per workout.
- Spoken input: ~5 s per turn → ~45 min a month.

### Estimated monthly cost (USD list prices, checked 2026-10-08)

| Route | Prices (in / cached / out per 1M tokens) | ~Monthly cost |
|---|---|---|
| OpenAI `gpt-6.1-sol` | $2 / $0.10 / $10 | ~$4.70 cached; ~$8.20 uncached |
| OpenAI `gpt-6-luna` | $0.10 / $0.01 / $0.50 | ~$0.25 |
| Claude Sonnet 5.5 | $2 / write $2.50, read $0.10 / $10 | ~$5.30 cached; ~$8.20 uncached |
| Claude Haiku 5.5 (≤100k prompt) | $0.10 / write $0.125, read $0.01 / $0.50 | ~$0.30 |
| Claude Opus 5.5 | $4 / write $5, read $0.20 / $20 | ~$10.60 cached; ~$16.50 uncached |
| Cloud speech-to-text, `gpt-4o-mini-transcribe` | $0.003/min | ~$0.15 |
| Cloud TTS of coach replies, `tts-1` | $15 per 1M characters | ~$1.60 |
| Set cues | Use `expo-speech` | $0 |
| GPT-Live, if used for ~5 min per workout | $0.05/min plus backend tokens | ~$4 plus tokens; ~$24 at 30 min per workout |

Notes: Claude 4.7 and later tokenizers produce "approximately 30% more tokens for the same text", so add about 30% to the Claude rows ([Claude pricing](https://platform.claude.com/docs/en/about-claude/pricing)). Tool use adds 286 system-prompt tokens per Claude 5.5 call. These are estimates only. `recordPersonalApiUsage` must reconcile against actual usage reported in each response.

### Does provider tool calling fit the restricted tool registry? Yes.

- **OpenAI:** `strict:true` makes calls follow the schema. Strict mode needs `additionalProperties:false`, every field listed as required, and nullable types for optional fields. `allowed_tools` limits which tools are callable per turn without changing the cached tool list. `parallel_tool_calls:false` allows at most one call per turn. Guidance is to keep fewer than 20 functions at turn start ([Function calling](https://developers.openai.com/api/docs/guides/function-calling)). The brief's 12 tools fit. On the ChatGPT-plan route, function tools and namespaces are supported; `tool_search` and hosted MCP are not.
- **Anthropic:** Client tools run in our app. `strict:true` gives schema conformance, `tool_choice` supports `disable_parallel_tool_use` ([Tool use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview)).
- Design implication (inference): define tools once in `packages/schemas` as JSON Schema generated from the discriminated-union types, using a strict-compatible subset. Map them to OpenAI `function` and Claude `input_schema`. Allow one tool call per model step so operation IDs and version checks stay simple. Use `allowed_tools` (OpenAI) or a per-turn subset (Claude) to hide write tools when no active session exists.

### Anthropic subscription access

Not allowed: "Anthropic does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, or Max plan credentials". Developers must use Console API keys ([Claude Code legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)). A Claude route for this app means a separately billed API key.

## 4. Recommended route and feasibility spike

**Build first:** an OpenAI Responses adapter restricted to ChatGPT-plan rules, with two credential sources (ChatGPT OAuth or Ben's own key), streamed through `expo/fetch`. Pair it with on-device speech. Claude API is a second adapter. Realtime and GPT-Live come later.

`expo/fetch` reads streamed response bodies and is the global `fetch` on iOS in SDK 57, so it can carry the Responses stream ([Expo](https://docs.expo.dev/versions/latest/sdk/expo/)). Tokens go in `expo-secure-store` (Keychain; use `WHEN_UNLOCKED_THIS_DEVICE_ONLY` so they do not migrate through backups) ([Expo SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/)).

### Spike plan (about 2–3 days, dev build on Ben's iPhone)

| # | Step | Pass criterion |
|---|---|---|
| S1 | Native module: loopback listener on `127.0.0.1:<ephemeral>`. Open the auth URL (`dynamic_agent_client`, persisted `urn:uuid` host ID, PKCE, full scopes) in `ASWebAuthenticationSession`. | Callback reaches the in-app listener. Issued `client_id` saved. Granted scopes include `chatgpt.tokens.use.direct`. |
| S1b | Only if S1 fails: Option C (sign in on the Mac, transfer to the phone). Record why S1 failed. | Phone refreshes the token with its own host ID and makes a call. |
| S2 | `GET /v1/models` | Record which models Ben's plan exposes. |
| S3 | Streaming `POST /v1/responses` with `store:false`, two strict function tools (`get_active_session`, `log_set`), app-managed history | Correct tool call → local execution → tool result → streamed reply. Measure time to first token and total time (median and p90 over 20 turns). |
| S4 | Refresh after the 1-hour expiry; force-close and relaunch; revoke in ChatGPT settings | Silent refresh. After revocation, an honest "disconnected" state with no paid fallback. |
| S5 | Trigger or simulate `usage_limit_exceeded` and `user_not_eligible` | UI shows "Manage usage" and does not retry in a loop. |
| S6 | Speech: on-device transcription with `contextualStrings` (exercise names, "kilos", RPE) on 30 recorded gym-noise utterances ("one fifteen", "a hundred and five", "RPE eight and a half") | Record word and number accuracy and whether recognition is truly on-device (flight mode). |
| S7 | `expo-speech` cue while music plays, with AirPods, with the silent switch on, with the screen locked | Record ducking, the silent-mode behaviour (documented: no sound) and background behaviour. |
| S8 | Same tool loop through Ben's API key (only if he chooses to create one) | The same adapter code passes S3, and usage is recorded. |

Write the outcome as an ADR (`docs/decisions/`) choosing the default text route.

## Unknowns that only an end-to-end test can settle

1. Whether OpenAI grants `chatgpt.tokens.use.direct` to a private, non-open-source iOS client registered through `dynamic_agent_client`, and whether Ben's plan (tier and region) is eligible.
2. Whether an `ASWebAuthenticationSession` redirect to `http://127.0.0.1` reaches a listener inside the app.
3. Real quotas and how fast coach turns use the shared "Work and Codex" allowance.
4. Which models are exposed, and their latency from a phone on gym Wi-Fi or cellular.
5. On-device recognition accuracy for numbers and units in a noisy gym, and whether `expo-speech-recognition` (SFSpeechRecognizer) is good enough or a SpeechAnalyzer native module is worth writing.
6. Spoken cues with the silent switch on, when locked or in the background, and with Bluetooth route changes.
7. Whether the ChatGPT-plan preview restrictions change. It is labelled a preview.

## Evidence classes

- **Documented fact:** the tables in sections 1–3 with official URLs (OpenAI developer docs, Apple docs, Expo docs, Anthropic docs).
- **Search snippet or secondary source (lower confidence):** OpenAI Help Center wording (the fetcher got 403), the possible Go eligibility, per-app weekly cap range, GPT-Live launch date, RN WebRTC setup.
- **Inference (not proven):** iOS sign-in options A–C, that a phone app counts as "locally run", the cost estimates, the Keychain-held Realtime key, and Foundation Models as a parser.

No user-feedback research was needed for this feasibility question. The brief's competitor section already covers AI coaching in competitor apps.

## Proposed brief changes

These are for Ben to approve; nothing has been applied.

1. **§2 table, "Own ChatGPT plan" row:** add "Plus or Pro (Go unconfirmed); models discovered at runtime via `/v1/models`; no published quota. Redirect is loopback `127.0.0.1` only, so the iOS feasibility is unproven until spike S1 passes." Add that the "Use credits after limits" option must stay off unless Ben explicitly enables it (supports CLAUDE.md rule 7).
2. **§2 functions:** `beginAiConnection` for this mode is local PKCE plus loopback, not a server transaction. Add `listAvailableModels(connectionId)`. Note that the access token lasts 1 hour and the refresh token 30 days, rotating.
3. **§5/§8 providers:** state that the ChatGPT-plan route and a personal OpenAI key share **one Responses adapter**. Requests always follow the preview restrictions (`store:false`, streaming, no `temperature`/`max_output_tokens`, app-managed history), so switching routes changes only the credential. Brevity of replies must therefore be set in the instructions, not with `max_output_tokens`.
4. **§3 voice:** make the first-release turn-based route explicitly **on-device**: Apple speech recognition with custom vocabulary, plus `expo-speech` (AVSpeechSynthesizer). Make `parseSpokenSet` a **deterministic parser in `packages/domain`**, so simple spoken set logs work with no network and no AI (CLAUDE.md rule 1). Call the LLM only for free-form or ambiguous requests. Note that `expo-speech` is silent when the phone's silent switch is on.
5. **§3 Realtime:** add GPT-Live (`gpt-live-1`, $0.05/min plus backend tokens) alongside Realtime as a candidate. Record that both need a separately funded key, and that OpenAI expects short-lived credentials to be issued by a server. For a single-user app Ben must choose between a minimal private credential-minting service and a Keychain-held key with documented risk. Move it out of build step 5 into an explicit later decision.
6. **§2 external/other providers:** add that Claude Free/Pro/Max subscriptions cannot be used by this app. Claude is available only through a separately billed API key.
7. **§11:** replace "Own-account AI eligibility … supported models, limits" with the specific unknowns list above. Add "OpenAI Help Center plan eligibility (Go) to recheck".

## Sources (all checked 2026-10-08)

- https://developers.openai.com/siwc/quickstart
- https://developers.openai.com/siwc/token-sharing-open-source
- https://developers.openai.com/siwc/token-sharing-open-source/sign-in
- https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference
- https://developers.openai.com/siwc/token-sharing-open-source/token-reference
- https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery
- https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations
- https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms
- https://developers.openai.com/siwc/ui-ux-guidelines
- https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt
- https://help.openai.com/en/articles/20001542-using-your-chatgpt-plan-in-other-apps-and-sites (search snippet; direct fetch returned 403)
- https://developers.openai.com/api/docs/pricing
- https://developers.openai.com/api/docs/guides/voice-webrtc
- https://developers.openai.com/api/docs/models/gpt-live-1
- https://developers.openai.com/api/docs/guides/function-calling
- https://platform.claude.com/docs/en/about-claude/pricing
- https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview
- https://code.claude.com/docs/en/legal-and-compliance
- https://developer.apple.com/documentation/speech
- https://developer.apple.com/documentation/authenticationservices/aswebauthenticationsession/callback
- https://developer.apple.com/documentation/foundationmodels
- https://developer.apple.com/documentation/foundationmodels/managing-the-context-window
- https://developer.apple.com/documentation/foundationmodels/adding-server-side-intelligence-with-private-cloud-compute
- https://docs.expo.dev/versions/latest/sdk/speech/
- https://docs.expo.dev/versions/latest/sdk/expo/
- https://docs.expo.dev/versions/latest/sdk/securestore/
- https://github.com/jamsch/expo-speech-recognition
- https://ai-sdk.dev/v5/providers/community-providers/react-native-apple
- https://blogs.videosdk.live/integrate-videosdk-with-expo-react-native (community)
- https://community.openai.com/t/tool-calling-in-react-native-with-the-openai-webrtc-realtime-api/1130376 (community)
