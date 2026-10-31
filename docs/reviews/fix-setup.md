# Review: fix-setup (claude/fix-setup vs claude/gracious-knuth-joxqpw)

Reviewer: independent reviewer agent, 11 Oct 2026
Commits reviewed: b7d85cb (setup unit lock), 0273c30 (check-in reasons opId)

## Verdict: PASS

Both reported bugs are fixed at the root, and each has at least one test that
fails without its fix. No product rule regresses, and the one new string
(`Gym saved in kg`) fits the minimal-copy convention. The should-fix items
below are an adjacent path with the same symptom as bug 2, plus test strength.
Neither blocks the merge.

## Checks run

| Check | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` | pass |
| `npx vitest run --testTimeout=120000` | 178 files, 3635 passed, 1 todo |
| New tests with the three source files reverted to base (`app-services.ts`, `SetupScreen.tsx`, `CheckInScreen.tsx`) | 3 fail: first-run "refused" (behavioural), first-run source scan, check-in source scan. The check-in integration test **passes** without the fix (see S2) |

## Bug-by-bug

### 1. Units changed after the gym is saved (Ready says lb, loads in kg)

- Root cause: a unit change was accepted after equipment existed in the old unit.
  The fix closes it on both layers:
  - UI: `SetupScreen.tsx:137` locks both unit cards once a gym summary exists and shows `Gym saved in kg`.
  - Service: `app-services.ts:192-198` refuses a different unit while setup is in progress and an unarchived gym exists. A same-unit Continue still returns ok.
- Because of the service guard, a stale screen or a race can't reintroduce the
  mismatch. Ready's `Units: …` comes from local state, which can no longer
  diverge from the profile or the gym.
- Force-close resume: `setupStep` resumes at `data`, where `gym` is `null`, so
  Back is hidden, and `Root.tsx:154` seeds `initialUnit` from the profile. No
  other path reaches Step 1 with a mismatched unit.
- Post-setup unit changes are untouched, because the guard is scoped to
  `completedAtUtc === undefined`.
- Test: `first-run-flow.test.ts`, "Back to units after the gym is saved…". It is
  behavioural and fails on base.

### 2. What's up? change after Back from the pain step dropped as a duplicate

- Root cause: a fixed opId `${recordOp}:reasons` was reused for different
  payloads, and the screen routed on unsaved local state. Both are fixed:
  - `reasonsSubmission` (`check-in-sheet.ts:17`) issues a new opId per distinct
    payload and reuses it only for an identical retry. Rule 5 holds: a retry is
    still idempotent, and a changed payload is a new versioned write.
  - `afterReasonsStep(saved)` routes on the saved record (`CheckInScreen.tsx:383`).
    `afterPain` now routes on `current.reasons` (`:392`).
  - A failed write no longer pretends to succeed. It shows the error and stays
    on the sheet (`:372-378`), and Skip remains available, so logging is never
    blocked (rule 1).
- Tests: `check-in-reasons-op.test.ts` covers the pure helpers (including
  A → B → A and order-insensitivity), plus a source scan and a service-level
  integration test that asserts the stored reasons and un-held loads (62.5 kg).

## Blocking

None.

## Should fix

**S1. Pain → Done → Back → untick Pain → Skip still starts with `reasons=['pain']` and holds every load.** `CheckInScreen.tsx:474`.
Scenario: Ben ticks Pain and taps Done, which saves `['pain']`. He taps Back and
unticks Pain, then taps Skip instead of Done. Skip starts with
`{kind:'answered', checkInId: record.id}`, and that record still holds the
`['pain']` saved by the first Done. `unspecifiedPain` becomes active, so every
exercise's load is held, which is the same impact as bug 2. check-in.md §5
(`Skip` (Step 2)) says Skip "starts with the score only; selected chips and the
note are discarded", but here the earlier Done's chips survive. This path was
already in base, not introduced by this branch. It shares bug 2's root (the
sheet's view of the record goes stale after Back), so it is worth closing in
the same area.
Fix: once a reasons write has been saved, make Skip on Step 2 restore the
pre-Done reasons. That means writing `{reasons: [], note: null}` with a new
opId before starting, or the score-only state captured before the first Done.
Alternatively, have Back from the pain step return to a state where Skip means
"use what is saved", and make the copy say so. Add a test for it.

**S2. The check-in integration test is not a regression guard.** `check-in-reasons-op.test.ts:59-90`.
The test calls `services.checkIns.update` directly with two different opIds, so
it passes on base, because the service was never the bug. The only thing that
fails without the fix is the source scan (`:51-56`), which checks strings rather
than behaviour. Source scans are an existing pattern in this repo, so this is
acceptable. Still, the screen's `done()` sequence (submission → update → route
on saved) could be pulled into a small pure or async helper that takes
`services`. That would let a test drive Pain → Done → Back → change → Done
through the same code the screen runs, and assert `duplicate === false` and the
route.

## Nits

**N1. Stale-write copy says "Showing the latest" but the chips aren't refreshed.** `CheckInScreen.tsx:373-376`.
On `stale`, the code reloads `record` and shows the service's `This check-in
changed. Showing the latest.`, but `reasons` and `note` keep Ben's unsaved
selection. A second Done then reuses the same opId with the new version and
overwrites. This is nearly unreachable for a single user with one sheet. Either
`setReasons(latest.reasons); setNote(latest.note ?? '')`, or accept the
overwrite and use different copy.

**N2. The service-level refusal message is the lock label.** `app-services.ts:197`.
If the service guard ever fires, the warning line reads `Gym saved in kg` with a
warning icon. It is short and true, so this is fine. Noted only because it
doubles as an error string.

**N3. Done-on-write-failure differs from check-in.md §3 "Write failed".**
§3 says the workout starts anyway with `Check-in not saved`, but that row is
written for `recordCheckIn` (Step 1). Done now shows the error and stays on the
sheet, with Skip still one tap away. That is the better behaviour, so it isn't a
defect. The spec row could note it (see Spec issues).

## Rules 1–10 and minimal copy

- Rule 1: logging is never blocked. Skip is always available on Step 2, and a check-in failure only shows a line.
- Rule 2: no completed sets are touched.
- Rule 4: the unit lock keeps loads in the gym's real unit. No conversion or relabelling.
- Rule 5: idempotent retries are kept, and changed payloads are new versioned writes. Stale results are surfaced, not applied.
- Rules 3 and 6–10: not affected.
- Copy: one new string, `Gym saved in kg`, which is a value-style status with no explanation. The `minimal-copy` tests pass. The disabled `ChoiceCard` exposes `accessibilityState.disabled` and dims only the unselected card, so the selected state is still shown by check and border, not by colour alone.

## Spec issues

- check-in.md §3 "Write failed" covers only `recordCheckIn`. It should say what
  `Done` (the reasons update) does on failure or stale: stay on the sheet with
  the error, and leave Skip available.
- check-in.md §5 `Skip` (Step 2) assumes no reasons have been saved yet. The
  Back-from-pain path means some can be (S1), so the spec should say whether
  Skip clears them or keeps them.
