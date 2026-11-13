# Other LLM providers (Claude, OpenAI key, Gemini, on-device) and a model picker

Researcher: `researcher` agent, 19 Oct 2026. Background research for Ben's request of 20 Oct; nothing is to be built yet. All sources checked **2026-10-19**. Labels: **[Doc]** official docs, **[Reports]** third-party or anecdotal, **[Inference]** my reasoning, **[Code]** read in this repo.

## Summary

1. Claude can only be used with a **separately billed Anthropic API key**. A Claude.ai Pro/Max sign-in is forbidden for third-party apps. Gemini consumer sign-in is also forbidden, so Gemini means an API key too, and only on the paid tier, because free-tier data is used for training.
2. The coach's `CoachModelPort` is already mostly provider-neutral. The OpenAI-specific parts are in `packages/providers/src/openai` and `plan-model-port.ts`. Adding a provider means writing one adapter per provider, not rewriting the coach.
3. **Biggest catch:** Claude Opus 5.5 and Sonnet 5.5 **reject forced tool choice**, but the coach forces every step (`tool_choice: required`) and some named calls. On Claude, the coach would need `auto` plus its existing text backstop. Claude's strict-schema limits (16 union-typed parameters per request) probably also clash with our nullable-everywhere schemas.
4. Apple Foundation Models is free, offline and supports tool calling, but its 4,096-token context can't hold the coach context. It fits only narrow helper roles.
5. **Proposed brief changes** are at the end: replace "one shared OpenAI adapter" with a provider port, and record that forced tool choice is not portable.

## Recommendations

1. Keep the ChatGPT-plan route as the default. Add providers only after spike S3 proves the plan-route tool loop, so the port is shaped around something that works.
2. Next: one **Anthropic Messages adapter** behind a neutral `ModelProvider` port (about 4–6 days with tests). An OpenAI API key reuses the existing adapter with a different credential (about 1 day). Gemini comes after that, and only if Ben asks for it.
3. Pick a model **per role**: Build/plan, Mid-workout, Import. Never fall back across providers automatically (rule 7). If the chosen provider fails, show its honest status, for example `Claude · key invalid`.
4. Foundation Models: spike it as an offline helper for parsing a spoken or typed set and for short chip turns. Do not use it as a coach.

---

## 1. Options

| | How Ben connects | Allowed for a personal third-party app? | Cost |
|---|---|---|---|
| **ChatGPT plan** (current) | Loopback OAuth, ADR 0012 | Documented for "personal projects that run locally"; iPhone unproven ([ai-access-and-voice.md](ai-access-and-voice.md)) | Plan allowance |
| **Claude API key** | Paste a Console key, stored in Keychain | Yes. Subscription login **no**: "Anthropic does not permit third-party developers to offer Claude.ai login … or to route requests through Free, Pro, or Max plan credentials"; developers "may not collect, store, or intermediate Claude.ai credentials" [Doc](https://code.claude.com/docs/en/legal-and-compliance) | Pay per token |
| **OpenAI API key** | Paste key | Yes. API data "not used to train" by default; abuse logs kept up to 30 days [Doc](https://developers.openai.com/api/docs/guides/your-data) | Pay per token |
| **Gemini API key** | Paste key | Paid tier yes. Free tier: Google uses content "to provide, improve, and develop", human reviewers may read it, "Do not submit … personal information"; only paid services for apps offered in the EEA; 18+ [Doc](https://ai.google.dev/gemini-api/terms). Consumer sign-in **no**: using Gemini CLI OAuth from third-party software "is a violation" [Doc](https://www.geminicli.com/docs/resources/tos-privacy) | Pay per token; free tier unsuitable |
| **Apple Foundation Models** | None (on device) | Yes (Apple framework) | Free, offline |

### Estimated monthly cost

Assumes ~3.1M input and 0.2M output tokens a month, the usage model in [ai-access-and-voice.md](ai-access-and-voice.md) §3, uncached. Reasoning tokens are extra, so these are lower bounds. [Inference]

| Model | List price (in/out per 1M) | ~Month |
|---|---|---|
| Claude Haiku 5.5 | $0.10 / $0.50 | ~$0.40 (+30% tokenizer) |
| Claude Sonnet 5.5 | $2 / $10 | ~$8–11 |
| Claude Opus 5.5 | $4 / $20 | ~$16–21 |
| Gemini 3.8 Flash | $0.75 / $3.75 until 31 Dec, then doubles | ~$3, then ~$6 |
| Gemini 4 Argon | $2 / $10 until 30 Nov, then doubles | ~$8, then ~$16 |

Sources: Claude prices, and the note that 4.7+ tokenizers produce "approximately 30% more tokens" [Doc](https://platform.claude.com/docs/en/about-claude/pricing). Gemini prices [Doc](https://ai.google.dev/gemini-api/docs/pricing). OpenAI key prices are in the earlier note.

## 2. Capabilities against our tool contracts

| | Claude Messages API | Gemini API | Foundation Models |
|---|---|---|---|
| Tools | Client tools, `tool_use` → `tool_result`; `disable_parallel_tool_use` [Doc](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview) | Function calling; modes `auto/any/none/validated`, `allowed_tools`; "keep active set to 10–20 tools" [Doc](https://ai.google.dev/gemini-api/docs/function-calling) | `Tool` protocol; "no more than three to five tools per request" [Doc](https://developer.apple.com/documentation/foundationmodels/managing-the-context-window) |
| Forcing a tool | **Opus 5.5, Sonnet 5.5: `any`/`tool` return 400.** Use `auto` + strict. Haiku 5.5 and Opus 5 accept forcing, but "a forced call skips thinking" [Doc](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools) | `any` mode | n/a |
| Strict schemas | `strict: true`, grammar-constrained. No `minimum/maximum/minLength`; `additionalProperties:false`. Per request: **20 strict tools, 24 optional params, 16 union-typed params**, "Schema is too complex" 400 [Doc](https://platform.claude.com/docs/en/build-with-claude/structured-outputs) | "Only a subset of the OpenAPI schema"; complex schemas may be rejected in `any` mode [Doc](https://ai.google.dev/gemini-api/docs/function-calling) | `@Generable` Swift types, "strong guarantees" [Doc](https://developer.apple.com/documentation/foundationmodels) |
| Effort | `output_config.effort` low…max. Opus/Haiku 5.5 default `medium`, Sonnet 5.5 `high`; affects tool calls too [Doc](https://platform.claude.com/docs/en/build-with-claude/effort) | `thinking_level` minimal/low/medium/high, depending on model [Doc](https://ai.google.dev/gemini-api/docs/thinking) | none |
| History quirks | Thinking blocks must be passed back "complete and unmodified" with tool results [Doc](https://platform.claude.com/docs/en/build-with-claude/thinking). `max_tokens` is required. `system` is top-level | Stateless mode: "MUST always resend all thought blocks exactly as they were received" [Doc](https://ai.google.dev/gemini-api/docs/thinking) | 4,096-token session context [Doc](https://developer.apple.com/documentation/foundationmodels/managing-the-context-window) |
| Data | Retained data "never used for model training without your express permission" [Doc](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention) | Paid: not used to improve products, logged for abuse detection [Doc](https://ai.google.dev/gemini-api/terms) | Stays on device |

**Streaming and latency.** Claude and Gemini both stream over SSE, so `expo/fetch` streamed bodies work as they do for OpenAI ([Expo](https://docs.expo.dev/versions/latest/sdk/expo/)). No CORS problem, because this isn't a browser. Latency from the phone is unmeasured; spike S3's timing harness can be reused per provider. [Inference]

**iOS, Expo and SideStore.** API-key routes need no server, no entitlement and no native code; they are plain HTTPS from JS. Foundation Models needs Swift (our own Expo module, like `audio-coach`) or the community `@react-native-ai/apple`, which requires iOS 26+ and pre-registered tools ([AI SDK docs](https://ai-sdk.dev/providers/community-providers/react-native-apple)). Apple says there is no official RN binding ([forum](https://developer.apple.com/forums/thread/833676)) [Reports]. I found no entitlement for the on-device model; the prebuild entitlement check would confirm it. Private Cloud Compute needs a managed entitlement, so it is out of reach on free provisioning ([earlier note](ai-access-and-voice.md)) [Inference]. Ben's iPhone 17 on iOS 26 supports Apple Intelligence ([ADR 0004](../decisions/0004-free-distribution-sidestore.md)).

**Foundation Models fit [Inference].** A live coach turn carries instructions, about 1.5k tokens of tool schemas and the 60-entry add list (about 1.8k; [ADR 0027](../decisions/0027-coach-v3.md)), which is already past 4,096. The model is suitable for:
- turning "too easy, go up" or a spoken set into a typed candidate that the existing deterministic checks then validate;
- short labelled offline replies.

It is not suitable for Build or Import. Its answers must be labelled `On-device`, never presented as the coach (rule 1).

## 3. What currently depends on OpenAI [Code]

- **Request shape.** `PlanResponsesRequest`, the plan-route forbidden-field guard, `store:false`/`stream:true`, Responses SSE event names, and the `call_id` item format.
- **Every step forces a tool.** `tool_choice: 'required'` runs on every step (`turn.ts`, `fit.ts`, `import-reader.ts`), a named function is forced for the build nudge, and import uses one forced emit function. This breaks on Opus and Sonnet 5.5. `turn.ts` already treats an ignored `required` as text shown as the message, so `auto` degrades safely, but more turns would end without a tool call.
- **Strict schemas.** `strictify` makes every property required and optionals nullable. `packages/schemas/src/coach.ts` has about 110 `.optional()`/`.nullable()` uses. A full live-turn tool set probably exceeds Claude's 16 union and 20 strict-tool limits [Inference; count it in a test].
- **Reasoning effort.** `reasoning.effort` plus the per-model `supported/rejected` memory. Claude and Gemini need their own field names, and in Claude a top-level effort change breaks the cache.
- **Model and error handling.** The model list comes from `/v1/models` `visibility:"list"`. Claude would need a curated or `/v1/models` list. Error kinds such as `usage_limit` (subscription codes) and `not_eligible` are plan-specific.
- **History.** `ModelInputItem` has no slot for opaque thinking or signature blocks, which Claude and Gemini require.
- **UI.** Labels such as "Using ChatGPT plan" and "Manage usage".

The coach-level `ModelEvent`/`ModelRequest` and the Zod-first tool registry are already neutral, which is good.

## 4. Provider abstraction (proposal)

- **Port.** `ModelProvider { id, capabilities(model), listModels(), stream(req) }` in `packages/providers`. The adapters are `openai-responses` (plan or key credential), `anthropic-messages`, later `gemini`, and `apple-on-device` (native).
- **Capabilities, per model:** `forcedToolChoice: none|any|named`, `strictLimits {tools, optional, unions}`, `effortLevels`, `needsMaxTokens`, `contextTokens`, `opaqueReasoningReplay`, `offline`, `billing: plan|paid|free-local`. They are detected at runtime and remembered, the way `reasoningCapabilityOf` is now.
- **Neutral history.** Add an opaque `{ type:'provider_state', provider, blob }` item that each adapter replays verbatim and others ignore. A history from one provider is never replayed into another mid-turn.
- **Tool schema adaptation.** One Zod source, with per-provider emitters (OpenAI strict, Claude strict subset, Gemini OpenAPI subset). If Claude's limits are hit, set `strict:true` only on write tools and leave reads non-strict, with Zod still validating every call.
- **Model picker per role.** Settings → Coach connection lists connected providers. Each role (Build/plan, Mid-workout, Import) picks `provider · model`. A model that disappears shows "not available" (ADR 0027 S7). There is no silent swap and no cross-provider fallback.
- **Honest labels.** Short status words only: `ChatGPT plan`, `Claude · paid`, `On-device`. The paid label appears on the first send of each session. Details go behind "Why?" (CLAUDE.md UI-copy rule).
- **Credentials.** Keys go in `expo-secure-store` with `WHEN_UNLOCKED_THIS_DEVICE_ONLY` and a per-provider keychain service. Never in backups or export (rule 7, rule 10).
- **Tests.** Contract tests run the same scripted coach scenarios against each adapter using recorded SSE fixtures. Also: schema-emitter snapshots with limit counters; a test that no failure maps to another provider; a test that keys never appear in logs or exports.

## 5. Ranked recommendation and effort [Inference]

| Rank | Item | Effort |
|---|---|---|
| 1 | Provider port refactor (no behaviour change) | 1–2 days |
| 2 | Claude API key adapter, Messages API | 4–6 days (forced-tool rework, schema emitter, thinking replay) |
| 3 | OpenAI API key credential on the existing adapter | ~1 day; mainly useful if the plan route fails S1 |
| 4 | Foundation Models helper spike (Swift module, one `@Generable` set parser) | 3–5 days |
| 5 | Gemini paid-key adapter | 3–4 days |
| — | Mistral (free plan may train on data; [Reports](https://help.mistral.ai/en/articles/455207-can-i-opt-out-of-my-input-or-output-data-being-used-for-training)); OpenRouter (Chat Completions only, extra intermediary [Doc](https://openrouter.ai/docs/guides/features/tool-calling)); Ollama on a Mac (not phone-only) | Not recommended |

## 6. Unknowns only an end-to-end test can settle

1. Whether Claude Sonnet or Opus 5.5 with `auto` reliably calls `reply` or a tool on every coach step, compared with Haiku 5.5 forced.
2. Whether our real tool set passes Claude's strict compiler, and what per-turn latency looks like on gym cellular.
3. Foundation Models: quality on gym phrases, behaviour with Apple Intelligence off, and whether an entitlement is needed.

## 7. Open questions for Ben

1. Do you want to pay for Claude API use, separately from any Claude.ai subscription? If so, should there be a monthly cap you set in the Anthropic Console?
2. Which roles would you put on Claude: build only, or mid-workout too?
3. Are you OK sending training history to Anthropic or Google under their API terms?
4. Are you in the EEA or UK? This affects Gemini tier rules.
5. Should this wait until the ChatGPT-plan spike result?

## Proposed brief changes

Proposals only; Ben approves.

1. **v0.2 header and §5/§8.** Change "one shared OpenAI Responses adapter" to "a provider port. The OpenAI Responses adapter serves the plan and key routes; an Anthropic Messages adapter is optional; on-device Apple models are an offline helper only."
2. **§2.** Add: "Gemini consumer sign-in is not allowed for third-party apps. A Gemini key must be paid tier, because free-tier data is used for training."
3. **Coach design (ADR 0020, PM decision 10 Oct).** Record that "every step calls exactly one function" relies on forced tool choice, which Claude Opus and Sonnet 5.5 reject. The text backstop must stay a supported path, not just a fallback.
