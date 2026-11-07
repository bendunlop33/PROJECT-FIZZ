VERDICT: CHANGES NEEDED

# Review r3: import from any app (AI layout)

Branch `claude/ai-import` at `1dde803`, diffed against `claude/gracious-knuth-joxqpw`. This round covers the r2 fixes since `65ff557` (`docs/reviews/ai-import-r2.md`): `11de081` (S1), `7277fd2` (S2), `1773747` (S3) and `1dde803` (ADR 0026). Reviewed against Ben's 12 Oct direction, Q1–Q3, `docs/design/data-import-export.md` §9, `docs/research/ai-import.md`, ADR 0016, ADR 0026 and the build plan. Independent reviewer, 13 Oct 2026.

## What was checked

- Run by the reviewer in `/home/user/wt-ai-import`:
  - `npm run typecheck`: exit 0.
  - `npm run lint`: exit 0.
  - `npx vitest run` (default suite): 290 files passed, 5416 tests passed, 1 todo, exit 0.
- Read in full: the r2→r3 diff (`read.ts`, `review.ts`, `roles.ts`, `layout-leave.ts`, `useLayoutCancel.tsx`, `views.ts`, `import-service.ts`, `ImportRunScreen.tsx`, `ImportNewLayoutScreen.tsx`, `ImportLayoutCheckScreen.tsx`, `ImportLayoutRoleScreen.tsx`), the new and changed tests, and the ADR edit. Re-read `layout-service.ts` `propose`, `stop`, `discard`, `readAgain` and `confirmSession`, plus every `navigation.*` call in `screens/import/` to see which removals fire `beforeRemove`.
- Probed with a throwaway mobile test (deleted, not committed) using the real harness and `SpyLayoutPort` with synthetic `strong-new-kg`:
  1. Start `proposeImportMapping`, then before it resolves run what Cancel does on the Reading screen: `leaveLayoutScreen(..., GO_BACK)` (from `beforeRemove`) and then `stop(layoutId)` (from the unmount effect). **Result:** `{"status":"proposed","reused":false}` with `requests 1`. Choosing the same file again gives `{"status":"proposed","reused":true}` with no new request. See B1.
  2. Control, the r2 behaviour: `stop(layoutId)` alone. **Result:** `{"status":"failed","reason":"stopped"}`, `requests 0`.
- Fixtures: the new tests build rows from the synthetic `liftosaur-like` and inline made-up CSV. No real export is in the diff.

## r2 findings: status

| r2 | Status |
|---|---|
| S1 a stuck row blocks the whole import | **Fixed.** A blank cell in a unit column is unreadable with the fixed reason `No weight unit` (`read.ts:129`). A file whose slash dates come in both orders now asks the order (`roles.ts:151`), and rows that don't fit are listed as `Date doesn't fit the layout (<cell>)`. The 95% rule decides. There are domain tests (1 in 40, 1 in 8, an unconfirmed unit column, both-order dates, a saved-layout typo) and a mobile end-to-end test from preview to commit. |
| S2 no `Cancel` | **Built, but it opens a regression.** Cancel, back and the swipe go through `beforeRemove` → `discard`, and only the New file layout → Check hand-off keeps the session. The navigation tests with the real `StackRouter` are good. On the Reading screen, `discard` runs before the unmount `stop` and deletes the session, so `stop` finds nothing to stop. See B1. |
| S3 stale-session commit copy | **Fixed.** There is a separate `layout_session_changed` reason with the copy `The layout changed. Check it again.`, and `popTo('ImportLayoutCheck')` keeps Ben's answers. A test shows nothing is sent again. The saved-layout copy is unchanged. |
| N1–N7 | Open, carried below. N5 still matters (see N1 below). |

## Rules

- **Rule 7 (route).** Unchanged and sound: one forced tool on the coach's ChatGPT-plan port, no API-key path, and an honest `unavailable`.
- **Rule 8 (file is data).** Holds. The new problem strings are fixed text. The only file text in them is a slash-date cell (`Date doesn't fit the layout (11/21/2025)`), shown as data. No model text is shown or stored.
- **Rule 6.** Holds. A blank unit cell is never filled from neighbouring rows or the header of another column. It is listed as not read.
- **Rules 2 and 5.** Commit, Undo and the version checks hold. B1 breaks "Stop before send sends nothing" and "a walked-away layout is never reused" on one path.
- **Rule 10.** No new storage. Untouched.
- **Q2 consent.** B1 sends the sample after Ben has left the screen.
- **Copy.** It is minimal. `Check the layout` as a Run-screen button and `No weight unit` are new strings for spec issue 4.

## Blocking

### B1. Cancel, back or swipe while `Reading the layout` no longer stops the request: the sample is sent after Ben left, and the layout he walked away from is reused next time

- **Where:**
  - `apps/mobile/src/screens/import/useLayoutCancel.tsx:21-26` calls `leaveLayoutScreen` → `discard` on `beforeRemove`.
  - `apps/mobile/src/import/layout-service.ts:670-676` (`discard`): `s.inflight?.abort()`, then `sessions.delete(layoutId)`. It never sets `s.run.stopped`.
  - `ImportNewLayoutScreen.tsx:47-53`: the unmount effect then calls `stop(layoutId)`. `stop` (`layout-service.ts:553-557`) looks the session up by ID, finds nothing, and does nothing.
  - `propose` (`layout-service.ts:737-843`) keeps a reference to the detached session. It checks only `run.stopped` at `:763`, `:794` and `:815`.
- **Failure scenario.**
  - Ben taps `Read with the coach`, sees `Reading the layout`, and changes his mind. He taps `Cancel` (or swipes back) while `propose` is still in its pre-send awaits: profile, block check, request lookup, `reusable`, `coachStatus()` and `coach.availability()`, which may refresh the ChatGPT token over the network, and the request-record write.
  - `inflight` is still null, so nothing is aborted. `run.stopped` stays false, so the column names and up to 30 rows go to ChatGPT after he left.
  - The answer is validated and stored as `proposed` with `closedAt: null`, then adopted onto the deleted session.
  - The next time he chooses the same file, `reusable()` adopts that layout (`reused: true`), which is exactly what r2 S2 set out to prevent.
  - The reviewer's probe reproduces this: `requests 1`, then `reused: true`. Before this round the unmount `stop` alone gave `failed/stopped` with `requests 0`, so this is a regression of r1 S5 introduced by the S2 fix.
  - If `inflight` is already set, the abort does cancel the request. The late-answer guard still depends on `run.stopped`, so a provider that ignores the signal would have its answer kept.
- **Why blocking.** Cancel and Stop are Ben's way to withdraw the Q2 send, and the stored-layout reuse is the rule-5 guarantee r2 S2 fixed. Both fail silently on a normal gesture during a wait that can take seconds.
- **Fix.**
  - In `discard` (and `readAgain`), set `s.run.stopped = true` before `abort()` and before deleting the session, in effect calling `stop` first.
  - Have `propose` treat a session that is no longer in `sessions` as stopped (`sessions.get(layoutId) !== s` → `done({state: 'failed', failure: 'stopped'})`).
  - Optionally have `discard` close the request record written by an in-flight `propose`, since `s.request` is still null at that point.
  - Add a test in `import-layout-cancel.test.ts`: start `proposeImportMapping`, run `leaveLayoutScreen(GO_BACK)` then `stop` before it resolves, and assert `requests 0`, `failed/stopped`, and `reused: false` with a new request when the same file is chosen again. Add a second case with a port that delays its first event, so the cancel lands after `inflight` is set.

## Should fix

None new beyond the carried nits.

## Nits

- **N1 (r2 N5, open, now more visible).** `confirmSession` closes the request even when `openLayout` doesn't return a preview (`layout-service.ts:364-365`). A force-close between confirm and commit loses the reusable layout, so reopening the file sends again. Close only on `preview`, or at commit.
- **N2 (r1 N1, open).** `ImportNewLayoutScreen` reads the coach state only on focus, so an offline `Read with the coach` doesn't re-enable on reconnect (§9.3.2).
- **N3 (r1 N2, open).** `importCoachStateOf` maps `not_eligible` and `region` to `not connected`.
- **N4 (r1 N4, open).** `sampleJson` (§9.6.4) isn't stored, only its hash. Store it or note the change in the ADR.
- **N5 (r1 N7, open).** `seen.negativeNames` is written but never read.
- **N6 (r2 N6, open).** `loadsInCells` asks `Weight unit` even when the set columns' headers carry a unit (`Set 1 (kg)`).
- **N7 (r2 N7, open).** The unit question's `range` pushes load-column values twice (`review.ts:189-191`).
- **N8.** `unitFor` (`read.ts:124`) still prefers a stored `answers.unit` over `No weight unit` for a blank cell in a unit column. No unit question is asked while a unit column exists, so this only happens with an answer left over from before a role change. It is Ben's own answer, not a guess, so this is a nit. Clearing `answers.unit` when a unit column is assigned would make it exact.
- **N9.** `useLayoutCancel` fires `void leaveLayoutScreen(...)`. `closeRequest` swallows store errors, so nothing rejects today. A `.catch` would keep it that way if `discard` changes.

## Spec issues (for the PM or designer, not the code)

1–6 from r2 are still open and not repeated here: §9.5 names model text, AI6 zone storage, the S3 schema gate, JEFIT sections, the reuse key wording, and the API-key rows to remove per Q3.

7. **New copy for the designer:**
   - `<n> rows can't be read with this layout.`
   - `Read with the coach again` on every coach layout
   - `No weight unit` and `Date doesn't fit the layout (<cell>)` as row reasons
   - `The layout changed. Check it again.` with a `Check the layout` button on the import screen
   - Cancel, back and swipe all meaning "drop this layout" on New file layout and Check the layout. This is built, and §9 should say so.
8. **§9.3.3 should say what Cancel during `Reading the layout` means.** It should be the same as `Stop`: nothing sent if it hasn't gone, a late answer thrown away, and never reused. B1 is the code failing this, but the spec currently only names `Stop`.

## Acceptance checks: changes since r2

| Check | Status |
|---|---|
| 44 Unit asked with no unit word | Met. A blank cell in a unit column is listed as `No weight unit`. |
| 46 / AI5 Day/month order | Met, including files with both orders (asked; rows that don't fit are listed). |
| `Stop` cancels the request and throws away a late answer (`data-import-export.md:1805,1862`) | **Not met** for Cancel, back or swipe during reading (B1). The `Stop` button itself still meets it. |
| 53 Stale `layoutVersion` | Met, with the right copy and route back. |
| 54 Undo; the layout isn't reused | Met for Cancel on Check the layout. Not met for Cancel during reading (B1). |
| Others | As in r2 |
