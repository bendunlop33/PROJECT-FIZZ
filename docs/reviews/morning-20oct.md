# Review: Morning reminder (branch `claude/morning-20oct`, 20 Oct 2026)

**Verdict: CHANGES NEEDED**

Scope: diff `cf777d0..2c557a9` against the merge-base with `claude/gracious-knuth-joxqpw`. Ben's request (20 Oct): "Can we have a notification at say 7am which can be changed on what to train each day?"

## What I ran

- `npm run typecheck`: passes. `npm run lint`: passes.
- `vitest packages/domain/test/morning-reminder.test.ts apps/mobile/test/morning-reminder.test.ts --maxWorkers=2`: 24/24 pass.
- Full suite (`--maxWorkers=2`): see the end of this file.
- A throwaway probe on the real harness (deleted afterwards, not committed) for B1 below.

## What is right

- **No push and no Time Sensitive.** These are local `CALENDAR` triggers with `interruptionLevel: 'active'` (`apps/mobile/src/alerts/notifier.ts:83-95`). The branch doesn't touch `app.config.ts`, the plugins or the entitlements.
- **DST and timezones.** Each trigger uses the local date, hour and minute with no `timezone`, so iOS fires it at wall-clock time in whatever zone the phone is in. `fireAtMs` is used only for filtering and ordering. The DST test (25 Oct, Europe/London) and the Sydney zone test are correct.
- **Cancellation.** Each run cancels every pending `fizz.morning.` ID before scheduling. Rest alerts (`fizz.rest.`) are left alone, and a test proves it. The identifier per local date is stable.
- **Permission.** Ben is asked only when he turns the reminder on (`turnReminderOn`). A refusal isn't asked again. A denied permission shows one line plus Open Settings.
- **Content.** `reminderBody` leaves out unknown parts. "about N min" is the existing estimate. With no Up next, nothing is sent.
- **Settings.** They are stored in device prefs, with defensive parsing field by field. They are left out of backups, which is correct per rule 10, since this is a phone setting.

## Blocking

### B1. Days 2–7 invent sessions from a split Ben may never have chosen (rule 6, spec §3 "simulate Up next forward")

`apps/mobile/src/reminders/forecast.ts:66-70`. When Up next isn't a routine or plan day (`next.routine === null`, the "repeat last workout" path in `workout-services.ts` `next.preview`), the forecast walks `training.buildCard().days`. `buildCard` falls back to the **default Push/Pull/Legs** when Ben has no split (`training-service.ts:166-169`), or when the profile row can't be read.

**Reproduced** on the real harness. One freeform workout (bench press and lat pulldown), with no split and no routines, produced these 7 reminders:

```
2026-10-20  Today: Upper body   about 5 min · Main Gym
2026-10-21  Today: Push         Main Gym
2026-10-22  Today: Pull         Main Gym
2026-10-23  Today: Legs         Main Gym
...
```

The real resolver would show "Upper body" again after Upper body, because Up next repeats the last workout. "Push", "Pull" and "Legs" are names Ben never set up and Today never shows. Even when Ben does have a split, `next_from` Up next doesn't follow split order, so this walk isn't a simulation of Up next. The developer's open question 2 understates the problem.

**Fix:** for `routine === null`, return an empty cycle (only day 1 is reminded), or repeat `next` if that is what the resolver really does. Walk the split only if the resolver itself picks by split day. Never read `buildCard` defaults. Add an app-level test for a freeform user with no split.

## Should fix

### S1. A workout in progress at reminder time still gets "Today: Pull", as a banner with sound

`apps/mobile/src/reminders/MorningReminderHost.tsx:216-230`. A write-triggered refresh is skipped while a workout is active. Starting a workout is itself such a write, so the 07:00 reminder scheduled earlier stays pending. The foreground handler (`notifier.ts:22-31`) shows every non-rest notification with sound.

**Scenario:** Ben starts at 06:50 and logs sets without backgrounding the app. At 07:00 a "Today: Pull" banner and sound play mid-workout. The domain's `trainedToday` skip (`morning-reminder.ts:135`) never gets the chance to run.

**Fix:** when the version bump finds a workout active, cancel today's `fizz.morning.<today>` (one cheap call) or do a single refresh on start. Alternatively, have the notification handler hide morning reminders while a session is active. Add a Host-level test.

### S2. The foreground refresh runs the full forecast mid-workout

`MorningReminderHost.tsx:232-239`. Every `active` transition calls `refresh()` with no active-workout check. That includes unlocking between sets and closing Control Center. For a plan, `readCycle` calls `routines.planned` for **every** plan day, and each call is a full `routineStart` preview (`forecast.ts:53-58`). This contradicts the Host's own comment ("logging never shares the JS thread with a recompute"), and it competes with the first tap after unlock.

**Fix:** during a workout, only remove today's reminder. Defer the full recompute to Finish/Discard. Alternatively, compute the cycle's minutes lazily or cache them per data version.

### S3. Pause is duck-typed and silently assumes a field name

`forecast.ts:36-38`. The spec requires a paused plan to send nothing. `pausedOf` reads an `as`-cast `paused` property that doesn't exist. If `claude/plan-adapt-20oct` reports pause differently, for example as a basis kind or a null Up next with a reason, this keeps returning `false` and a paused plan keeps reminding. Typecheck won't catch it.

**Fix:** treat this as a merge gate. After plan-adapt lands, replace the cast with the real typed field and add an app-level test with a paused plan.

### S4. App-level tests bypass the wiring the spec asked to test

`apps/mobile/test/morning-reminder.test.ts`. The spec §5 scenarios are covered only through `createMorningReminders.refresh()`, called by hand, and pure predicates:

- "finishing a workout reschedules" never goes through `MorningReminderHost`, the `useDataVersion` bump, the 1.5 s settle, or the active-session skip;
- "turning on" never goes through the screen's `toggle`, the save-then-request ordering, or the switch value;
- "denied shows the line" tests `showNotificationsOff(true,'denied')`, not the screen render or the Open Settings action.

The tap → Today path (`AppNavigator.tsx:293-301`) has no test either.

**Fix:** render the Host and the screen with the port injected. This needs `MorningReminderHost` and `MorningReminderScreen` to accept a port instead of importing `expoReminderPort`. Then cover at least:

- the finish → refresh path;
- a write during an active workout (S1);
- the switch on/denied render;
- the tap handler.

### S5. Dedupe in memory can leave iOS out of sync

`apps/mobile/src/reminders/morning.ts:116-117`. `appliedKey` short-circuits when the planned list is unchanged, without checking what iOS really has pending. If pending requests are dropped outside the app (iOS purge, or notifications reset in Settings), nothing is rescheduled until the plan's content changes or the app relaunches.

**Fix:** also compare against `port.pending()`, which is a cheap read, and reschedule when the ID sets differ.

### S6. The permission line goes stale after a round trip to Settings

`MorningReminderScreen.tsx:31-44`. Permission is re-read only on navigation focus. If Ben taps Open Settings, allows notifications and comes back, the screen stays focused, so "Notifications are off in iPhone Settings" stays until he leaves and re-enters.

**Fix:** also re-read on the AppState `active` event.

## Nits

- N1: `MorningReminderScreen.tsx:120-132`. The day chips announce only "Mon" to "Sun" with no selected state in the label. The `accessibilityLabel="Days"` on a non-accessible `View` does nothing. Use full day names plus `accessibilityState.selected`, and give the group `accessibilityRole`.
- N2: `notifier.ts:93`. A time inside a spring-forward gap (for example 01:30 on 29 Mar in London) may never fire as a `UNCalendarNotificationTrigger`. This doesn't affect 07:00. Either clamp the wheel or accept it and note it.
- N3: A zone change while the app stays in the foreground isn't a trigger (only foreground/launch is). This is rare, so a comment is enough.
- N4: A cold launch from a notification tap relies on the initial route, not `getLastNotificationResponseAsync`. That's fine today, but it's unproven on the device and the summary already lists it.
- N5: Commit `2c557a9` combines the UI, Host, port, nav, tests and CHANGELOG. CLAUDE.md asks for small commits.
- N6: `forecast.ts:61`. The rotation order is re-derived (`rotationAtUtc`, then `id`) rather than read from the resolver. If the resolver's tie-break changes, the forecast drifts. Expose the order from the routines service instead.

## Spec issues (for Ben / PM)

- **SP1. Days 2–7 state guesses as fact.** iOS gives a free-provisioned app no background execution, so if Ben skips a day without opening the app, the next morning still says "Today: Pull" when Up next is still Push. The spec accepts this, but the title presents a prediction as fact (rule 6). Options:
  - (a) remind only day 1 plus any day whose session is certain (`only` rotation);
  - (b) use a neutral title for predicted days ("Training today" with the predicted name in the body);
  - (c) accept the risk and record it in the CHANGELOG as an explicit choice.

  Ben should pick.
- **SP2. The "every day" default ignores `daysPerWeek`.** There is no weekday schedule in the model, so with a 4-day plan and the default every-day chips, Ben gets "Today: …" on his rest days, and each of those consumes a predicted session. Consider defaulting the chips from `daysPerWeek`, or asking which days in the turn-on flow.
- **SP3. Default On when permission is already granted.** Ben gets a new daily notification after the update without opting in. This is per the spec, but it is a product call that the CHANGELOG records as "Ben approved" when Ben only asked for the feature. Confirm with Ben.
- **SP4. "Profile › Voice & alerts" doesn't exist.** The row sits in the Voice group. The spec's location is out of date, so update it.

## Full suite

`npx vitest run --maxWorkers=2`: 371 files, 7223 passed, 1 todo. The probe test file was created and deleted outside this count.
