# Device test S1: ChatGPT sign-in (10 Oct 2026, build 83, iOS 26.6.1)

**Result: PASS, all 12 steps.** Ben's ChatGPT Pro account.

- Loopback listener 127.0.0.1:1455, redirect http://127.0.0.1:1455/auth/callback, sheet returned in 7.4 s.
- Existing registration reused (issued client ID oaiapp_…jYXG); PKCE token exchange, no client secret.
- Scopes granted: chatgpt.tokens.use.direct email offline_access openid profile resource.invoke.
- Tokens in Keychain (WHEN_UNLOCKED_THIS_DEVICE_ONLY), access token 60 min, refresh rotates.
- GET /v1/models: 7 models (gpt-6.1-sol, gpt-6-astra, gpt-6-sol, gpt-6-luna, gpt-5.6-sol, gpt-5.6-terra, gpt-5.6-luna).
- Responses stream: "OK" from gpt-6.1-sol, first text 4.2 s, 24 in / 5 out tokens, store:false, stream:true.
- Open item (ADR 0012): ID token RS256 signature not checked against JWKS.

Unblocks build step 4 (embedded text coach).
