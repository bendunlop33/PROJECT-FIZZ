# 0012: Providers package and the in-app loopback for "Sign in with ChatGPT" (spike S1)

**Status:** Proposed, 2026-10-09 (developer, spike S1; for review). Built but **not yet run on a device**: whether S1 passes is decided by Ben's iPhone test, not by this ADR.

## Context
Ben has ChatGPT Pro and wants to know whether his plan can power the coach (research [ai-access-and-voice.md](../research/ai-access-and-voice.md) §1, spike S1; design [ai-connection.md](../design/ai-connection.md)). OpenAI's "Sign in with ChatGPT" for local apps has no mobile or custom-scheme option: the redirect must be `http://127.0.0.1:<port>/auth/callback` (scheme, host and path fixed; never `localhost`) and the app must run a listener. First registration uses `client_id=dynamic_agent_client` plus a persisted `ext_agent_host_id`; the callback returns an issued `client_id` to reuse. Requests on the plan must be `store:false`, `stream:true`, without `temperature`, `max_output_tokens`, `previous_response_id` and other listed fields.

Facts re-checked against the official pages on 2026-10-09, beyond the research note: authorize `https://auth.openai.com/api/accounts/authorize`, token `…/api/accounts/oauth/token`, revocation from the discovery document (`…/api/accounts/oauth/revoke`); a `nonce` is required and the ID token must be checked (issuer, audience = issued client ID, expiry, nonce); `GET /v1/models` returns `models[]` with `slug`, `display_name`, `visibility` (not `data[].id`); refresh omits `scope`, uses the issued client ID, and must be serialized because refresh tokens rotate; `earliest_refresh_at` may be sent; specific refresh error codes mean "sign in again".

## Decision

### `packages/providers` (pure TypeScript)
- No React Native, Expo or DOM imports. `fetch`, randomness/SHA-256, the Keychain vault, the loopback listener and the clock are injected ports; tests use fakes (102 tests, mocked fetch).
- `authorize`: PKCE S256 (RFC 7636 vector tested), fresh state/nonce/verifier per attempt, `agent_name_hint` only on first registration, `id_token_hint`/`login_hint` only on reauthorization, callback validation (state first, `access_denied`, missing issued client ID, mismatched client ID).
- `tokens`: code exchange (no client secret), refresh with rotation, revocation, ID-token claim checks. **The RS256 signature is not verified** (no JWKS/RSA in this package yet). The token comes straight from the token endpoint over TLS, which OIDC Core §3.1.3.7 accepts for the code flow, but OpenAI's guide asks for JWKS verification: this must be closed before the coach ships.
- `credentials`: two Keychain items. *Registration* (host ID `urn:uuid:…`, issued client ID, email, subject) is created before the first sign-in and kept on Disconnect, as OpenAI's sign-out guidance says. *Tokens* are one item, so access token, expiry, scopes and the rotated refresh token are replaced together. `TokenRefresher` shares one in-flight refresh between callers and deletes tokens only on a confirmed-unusable refresh token; network and 5xx failures keep them.
- `responses`: one Responses client for both the ChatGPT-plan route and a future personal key (research proposal 3). The request type only has `model`, `input`, `instructions`, function `tools`, `tool_choice`, `parallel_tool_calls`; `store:false`/`stream:true` are always set last; a runtime guard also rejects forbidden fields, system-role messages and hosted tools. Success only on `response.completed`.
- `errors`: one `ProviderFailure` shape with a `kind` per documented code (`usage_limit`, `not_eligible`, `unavailable`, `unsupported_capability`, `route_not_supported`, `invalid_user`, `scope_not_authorized`), the direct-admission 401/403/503 bodies, and refresh errors. `region` is a **heuristic** (a 403 whose diagnostic text mentions region/country): OpenAI documents no stable region code. No mapping ever suggests switching to a paid route.
- `sign-in-test`: the S1 orchestrator. Each step reports what happened; later steps are `skipped` after a failure. Without `chatgpt.tokens.use.direct` no tokens are stored (design acceptance 3). `not_eligible` and `usage_limit` stop the run with no retry and no second OAuth. A forced refresh is not attempted before `earliest_refresh_at`, so the test never risks the new session. The export masks the email and never contains tokens, codes, state, nonce or challenge (tested).

### iOS loopback: new local Expo module `apps/mobile/modules/loopback-auth`
- Research option A. Swift, Network.framework `NWListener` with `requiredLocalEndpoint = 127.0.0.1:<port>` (1455 first, OpenAI's example; else any free port), started before the sheet opens.
- The module opens `ASWebAuthenticationSession` itself (not `expo-web-browser`). Reason: `ASWebAuthenticationSession` only matches custom schemes or `https` host/path; `expo-web-browser` would pass `http` as the callback scheme, whose behaviour is undocumented. Here the session gets a callback scheme that is never used, so it ends only when the listener receives `GET /auth/callback` (the module replies with a small page and cancels the sheet), when Ben cancels, or at the 5-minute timeout (`timing.signInTimeout`).
- A UIKit background task is held while the sheet is open, and the listener re-listens once on the same port if it fails, to survive a short switch to another app (e.g. for a 2FA code). The listener log records connections and request paths, never the query.
- A separate module rather than adding to `audio-coach`, so the audio-session owner stays single-purpose and this spike can be removed cleanly if S1 fails.
- **No entitlements, no Info.plist keys.** Loopback is expected to be outside Local Network privacy (no `NSLocalNetworkUsageDescription`); the device test confirms. The prebuild entitlement check passes (only the existing App Group).

### Dependencies
- `expo-crypto` **57.0.3** (SDK 57 bundled version) for the system CSPRNG and SHA-256. Hermes has no `crypto.getRandomValues`, and state, nonce and verifier must not use `Math.random`. No entitlement.
- `expo/fetch` (already part of `expo`) for streamed bodies; `expo-secure-store` (already pinned) with `WHEN_UNLOCKED_THIS_DEVICE_ONLY` and its own keychain service `fizz.chatgpt`.

### Screen
- Developer → `ChatGPT sign-in test` only. The product Coach connection screens (ai-connection.md) wait for the S1 result. The probe's S1 row stays `not implemented`; App status says nothing about the coach until the device test passes.

## Consequences
- A new cloud `.ipa` build is needed (new Swift module and `expo-crypto`). The Swift module was written without a Mac and is first compiled by macOS CI.
- If S1 fails on the device, the design's "ChatGPT sign-in doesn't work on iPhone yet" state applies (AC4) and the module can be deleted. Option C (sign in on another computer and transfer) needs its own decision (AC4: Ben has a Windows laptop).
- Open before the coach uses this route: JWKS signature verification; the product Coach connection UI (first-use notice, Manage usage, model choice, `getAiCapabilities`); whether top-level function tools work or must be grouped in namespaces (the preview page mentions namespaces; S3 tests it).
- Unknowns only the device can settle: whether the sheet's browser can reach the app's 127.0.0.1 listener; whether OpenAI grants `chatgpt.tokens.use.direct` to this registration and Ben's plan; whether port 1455 binds; whether iOS shows a Local Network prompt; behaviour when switching apps mid-sign-in; the real models list and latency; refresh after an hour (S4).

## Amendment (2026-10-09, review slice-3-and-s1 S7)
- Refreshes are serialised **per vault**, not per `TokenRefresher` instance: every refresher on the same vault joins one in-flight refresh, so parallel callers never send a rotated refresh token twice.
- Tokens granted but not kept (scope missing, a different account) are revoked straight away; the step says whether revocation was confirmed.
- The listener start can't hang: the Swift module fails `startListener` after 10 s if the listener never becomes ready (e.g. stuck in `.waiting`), and the orchestrator stops waiting after 15 s and stops the listener. A failed re-listen during sign-in ends the attempt at once (`The loopback listener stopped during sign-in`) instead of waiting for the 5-minute timeout. The Swift changes are first compiled by macOS CI.
- Still open before the coach uses this route: JWKS signature verification. *(10 Oct, ADR 0019 review fixes: built in `openai/jwks.ts` and run in both the S1 test and the product connection; it closes once the S1 test's ID token step shows `Checked: RS256 signature against OpenAI's JWKS` on Ben's iPhone.)*
