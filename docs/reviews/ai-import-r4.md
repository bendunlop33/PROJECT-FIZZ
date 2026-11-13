VERDICT: PASS

# Review r4: import from any app (AI layout)

Branch `claude/ai-import` at `b4a25b8`, diffed against `claude/gracious-knuth-joxqpw`. This round covers the r3 fixes since `2778782` (`docs/reviews/ai-import-r3.md`): `f2523e1` (B1), `38cf8a7` (N1), `8ede173` (N8, N9), `252329b` (N2, N3), `9721f0b` (N4–N7, ADR 0026) and `b4a25b8` (§9.3.3). It also includes a fresh adversarial pass on the cancel, stop and consent paths (rule 7, Q2), rule 8, rule 5 and rule 6. Independent reviewer, 13 Oct 2026.

## What was checked

- Run by the reviewer in `/home/user/wt-ai-import`:
  - `npm run typecheck`: exit 0.
  - `npm run lint`: exit 0.
  - `npx vitest run --maxWorkers=2`: 290 files passed, 5429 tests passed, 1 todo, exit 0.
- Read in full: the r3→r4 diff, plus `layout-service.ts` (`propose`, `stopSession`, `discard`, `readAgain`, `layoutCommitting`, `confirmSession`, `closeRequest`, `reusable`, `replay`), the commit path in `import-service.ts`, `useLayoutCancel.tsx`, `layout-leave.ts`, `ImportNewLayoutScreen.tsx`, every `navigation.*` exit from `ImportLayoutCheckScreen`, `ImportPreviewScreen` and `ImportRunScreen`, `useScreenData`, `plan-model-port.ts` and `responses.ts` (does an abort before the fetch stop the send?), and the ADR 0026 and §9.3.3 edits.
- Probe: a throwaway test, deleted and never committed. It used the in-memory request store from `import-layout-requests.test.ts` and called `discard` + `stop` from inside the `proposed` record write. **Result:** `{status: 'proposed', reused: false}`. The record was stored as `proposed` with `closedAt: null`, and choosing the same file again gave `reused: true`. Only one request was sent. See S1.
- Fixtures: synthetic only (`strong-new-kg`, `liftosaur-like`, `spreadsheet-wide`). No real export is in the diff.

## r3 findings: status

| r3 | Status |
|---|---|
| **B1** Cancel/back/swipe while reading still sends and reuses | **Fixed.** `discard` and `readAgain` now call `stopSession` before dropping the session (`layout-service.ts:685-692`, `:651-655`). `propose` also treats a dropped session as stopped (`:766`) at each check: after `reusable` (`:777`), before the record (`:787`), after the record write (`:819`) and after the answer (`:840`). Three new tests cover it: before the send (`requests 0`, then `reused: false` with a new request), after the send with a provider that ignores the abort (answer thrown away, `signal.aborted`, not reused), and `Read with the coach again` mid-start. The real port checks `signal.aborted` after the token refresh and before `streamResponse` (`plan-model-port.ts`), so an abort during the refresh never reaches the fetch. One narrow window remains (S1). |
| N1 request closed at confirm | **Fixed.** It now closes in `layoutCommitting` (`import-service.ts:1047`), after the stale-version and backup checks and before `createJob`. Tests cover a force-close on the preview (reused, nothing sent twice) and commit → Undo → reopen (not reused). See N1 below for the ordering. |
| N2 offline doesn't re-enable | **Fixed.** A 15 s reload plus a foreground reload run only while the consent is showing and the coach is `offline`/`unavailable`. `useScreenData` keeps the old value while reloading, so the screen doesn't flash. The test is a source check only (N3 below). |
| N3 `not_eligible`/`region` as `not connected` | **Fixed.** This is now its own state, with mapping, copy and a fix link. No route switch (rule 7). |
| N4 `sampleJson` not stored | **Fixed.** It is stored on the request, capped at 500,000, and the test checks it byte for byte against the message sent and its hash. The table is already in Your data (`data-domains.ts:50`), so backup and delete cover it. Nothing logs it. |
| N5 `seen.negativeNames` unread | **Documented** as provenance in ADR 0026 §13, with the decision passed to the PM. Acceptable. |
| N6 unit in set headers | **Fixed** (`read.ts` `loadHeaderToken`). Headers that disagree, or one with no unit, still ask. |
| N7 range counted twice | **Fixed** and tested (`max: 140`). |
| N8 stale unit answer | **Fixed.** Assigning the unit role clears `answers.unit`, and Undo restores it. There is an end-to-end test. |
| N9 `.catch` on leave | **Fixed.** |

## Rules

- **Rule 7 / Q2 (nothing sent after Ben leaves).** Holds. Every leave path (Cancel, back, swipe, `Read with the coach again`, and `Stop`) marks the read stopped before any await. The send happens synchronously after the last `stopped()` check. The adapter refuses an already-aborted signal before `fetch`. There is no API-key path or route switch. `not_eligible` points to the connection screen only.
- **Rule 8 (file is data).** Holds. `sampleJson` is stored as an opaque string and never shown, parsed as instructions or logged. The new strings are fixed copy.
- **Rule 5 (versioned, idempotent, Undo).** Holds, apart from S1's millisecond window. The request closes at commit, after the stale-`layoutVersion` refusal, so a refused commit doesn't close it. Undo doesn't bring a committed layout back as a suggestion. Request updates stay versioned (`expected` version on every `storeRequest`).
- **Rule 6.** Holds. The unit comes only from a unit cell, Ben's answer, or a header that names it. When set headers disagree, the question is asked.
- **Rule 10.** `sampleJson` is in `import_layout_requests`, which is Your data.

## Blocking

None.

## Should fix

### S1. Cancel during the `proposed` record write still leaves a reusable layout

- **Where:** `apps/mobile/src/import/layout-service.ts:840` (the last `stopped()` check) → `:865` `await done({ state: 'proposed', ... })` → `:866` `adoptSpec`. `discard` (`:685-692`) runs `closeRequest(s)` while `s.request` is still `null`, so it closes nothing.
- **Failure scenario.**
  - The answer arrives and passes `stopped()` and validation.
  - While the `proposed` row is being written (one SQLite write), Ben taps Cancel or swipes back.
  - `discard` stops and drops the session, and `closeRequest` finds no request yet.
  - The write completes as `proposed` with `closedAt: null`. `adoptSpec` attaches it to the detached session.
  - The next time he chooses the same file, `reusable()` gives `reused: true`, which is the layout he walked away from.
  - The reviewer's probe reproduces this (above).
  - Nothing more is sent, and Ben still has to go through Check the layout before anything imports, so this isn't blocking. It does contradict ADR 0026 §13 ("a late answer is stored as `stopped`, never as a reusable layout") and §9.3.3's "never reused".
- **Fix.**
  - After `await done({state: 'proposed'})`, check `stopped()` again. If the read was stopped, write `closedAt` (or re-store it as `failed/stopped`) and return `{status: 'failed', reason: 'stopped'}`.
  - The same applies to the `replay`/`!created.ok` path for completeness.
  - Add a test with the timed fake store: call `discard` from the `proposed` write, then assert `failed/stopped` and `reused: false` on reopen.

## Nits

- **N1.** `layoutCommitting` runs before `createJob` (`import-service.ts:1047`). If `createJob` then fails (`another_import`, `layout_changed` thrown by the saved-layout check), the request is already closed, so after a force-close the same file needs a new send. Ben would tap the consent again, so nothing is sent silently. Moving the call after `created.ok` would keep it reusable.
- **N2.** The `sampleJson` field is kept on a record that is `failed/stopped` before anything went out (Stop during the `sent` write, `:819`). It is labelled "the exact text sent", but this text never left the phone. Null it in that branch, or say "text prepared" in the doc.
- **N3.** The N2 test (`import-layout-cancel.test.ts`, "reads the coach's state again") only greps the source. It is acceptable for the wiring, but `coachRecheckMs` plus one harness test of `newTable` flipping from `offline` to `ready` would pin the behaviour.
- **N4.** `packages/schemas/src/import-layout.ts:250-256`: the new `IMPORT_SAMPLE_JSON_MAX` sits between `ImportLayoutRequestSchema`'s JSDoc and the schema, so the schema's doc now attaches to the constant. Move the constant above the comment.
- **N5.** The 15 s recheck calls `coach.availability()`, which may try a token refresh each time while offline or `unavailable`. That's harmless, but on a real device check that it doesn't record a provider failure on each tick or lengthen the one-minute offline hold.

## Spec issues (for the PM or designer, not the code)

1–6 from r2 and 7 from r3 are still open. r3 item 8 (§9.3.3 Cancel = Stop) is **done** in `b4a25b8`.

9. **§9.3.2 needs a `not_eligible` row.** The new copy is `Coach: this account can't be used` / `Needs the coach · this account can't be used` with `Connect the coach ›`. It comes from system-states §3.2 but isn't in the import spec yet, and the ADR flags it for the designer.
10. **§9.6.4 `sampleJson` location.** The spec puts it with the job's provenance. The build keeps it on the request and links the two by operation ID (ADR 0026 §13 N4). The spec should say which one.
11. **N5 decision.** The negative-weight question is asked on every import instead of "when not seen before" (§9.6.4). The PM should pick one and update the spec.

## Acceptance checks: changes since r3

| Check | Status |
|---|---|
| `Stop` and Cancel/back/swipe during reading cancel the request and throw away a late answer (§9.3.3) | Met, apart from S1's write window. |
| 54 Undo; a walked-away layout isn't reused | Met (S1 aside). |
| Force-close on the preview reuses the layout, nothing sent twice | Met. |
| §9.3.2 `Read with the coach` re-enables when the connection returns | Met (15 s and on foreground). |
| 44 Unit asked with no unit word (now including set-column headers) | Met. |
| §9.6.4 exact text sent kept | Met (on the request). |
| Others | As in r3. |
