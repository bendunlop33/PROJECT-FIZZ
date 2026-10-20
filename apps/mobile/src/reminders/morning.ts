import { localDateOf, MORNING_REMINDER_PREFIX, morningReminderSchedule, reminderOn, type MorningReminderSettings, type PlannedReminder, type UpNextForecast } from '@fizz/domain';

import type { AlertPermission } from '../alerts/notifier';

/**
 * Morning reminder (Ben, 20 Oct 2026): keeps the phone's pending local
 * notifications equal to `morningReminderSchedule`. Recomputed on launch,
 * return to the foreground, any write that can move Up next (finish, discard,
 * plan, routines, gym), a settings change and a zone change. Local
 * notifications only; nothing here blocks or fails logging (rule 1).
 *
 * During a workout (review morning-20oct S1, S2) a refresh only takes today's
 * reminder off (one cheap read and one cancel): no forecast, no routine
 * previews while Ben logs. The full recompute follows Finish or Discard. A
 * settings change (`force`) recomputes in full even then.
 */

export interface ReminderPort {
  permission(): Promise<AlertPermission>;
  /** The iOS prompt (only from Ben turning the reminder on). */
  request(): Promise<AlertPermission>;
  /** Identifiers of every pending morning reminder (any `fizz.morning.` one, from this run or not). */
  pending(): Promise<string[]>;
  schedule(r: PlannedReminder): Promise<void>;
  cancel(identifier: string): Promise<void>;
}

export interface MorningReminderDeps {
  port: ReminderPort;
  forecast: () => Promise<UpNextForecast>;
  settings: () => MorningReminderSettings;
  nowMs: () => number;
  tz: () => string;
  /** A workout is in progress (started, not finished or discarded). Unreadable: treated as none. */
  workoutActive: () => Promise<boolean>;
}

const isMorning = (id: string): boolean => id.startsWith(MORNING_REMINDER_PREFIX);
const sameIds = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n');

export function createMorningReminders(deps: MorningReminderDeps) {
  let chain: Promise<void> = Promise.resolve();
  /** What was last made pending in this run; a refresh that plans the same list writes nothing. */
  let appliedKey: string | null = null;
  let lastError: string | null = null;
  let lastPlanned: PlannedReminder[] = [];

  /** Mid-workout: take today's reminder off if it is still pending; the rest waits for Finish or Discard. */
  async function quietToday(): Promise<void> {
    const id = `${MORNING_REMINDER_PREFIX}${localDateOf(deps.nowMs(), deps.tz())}`;
    if (!(await deps.port.pending()).includes(id)) return;
    await deps.port.cancel(id);
    lastPlanned = lastPlanned.filter((p) => p.identifier !== id);
    appliedKey = null;
  }

  async function run(force: boolean): Promise<void> {
    try {
      if (!force && (await deps.workoutActive().catch(() => false))) {
        await quietToday();
        lastError = null;
        return;
      }
      const settings = deps.settings();
      const permission = settings.on === null ? await deps.port.permission().catch((): AlertPermission => 'undetermined') : 'granted';
      const on = reminderOn(settings, permission);
      const forecast = on ? await deps.forecast() : null;
      const planned = forecast === null ? [] : morningReminderSchedule(deps.nowMs(), deps.tz(), { ...settings, on }, forecast);
      const key = JSON.stringify(planned.map((p) => [p.identifier, p.fireAtLocal, p.title, p.body]));
      // What iOS really has pending, not only what this run last wrote (review S5): a purge or a reset reschedules.
      const pending = (await deps.port.pending()).filter(isMorning);
      if (key === appliedKey && sameIds(pending, planned.map((p) => p.identifier))) return;
      for (const id of pending) await deps.port.cancel(id);
      for (const p of planned) await deps.port.schedule(p);
      appliedKey = key;
      lastPlanned = planned;
      lastError = null;
    } catch (e) {
      // Next refresh replaces everything again.
      appliedKey = null;
      lastError = e instanceof Error ? e.message : String(e);
    }
  }

  return {
    /** Recompute and reschedule (mid-workout: only today's comes off, unless `force`); serial, never throws. */
    refresh(opts: { force?: boolean } = {}): Promise<void> {
      chain = chain.then(() => run(opts.force === true));
      return chain;
    },
    get planned(): readonly PlannedReminder[] {
      return lastPlanned;
    },
    get lastError(): string | null {
      return lastError;
    },
  };
}

export type MorningReminders = ReturnType<typeof createMorningReminders>;

/** The settings screen's one line when iOS won't show notifications (minimal copy). */
export const NOTIFICATIONS_OFF_LINE = 'Notifications are off in iPhone Settings';

/** Show `Notifications are off in iPhone Settings` + `Open Settings`: on, and iOS says no. */
export function showNotificationsOff(on: boolean, permission: AlertPermission | 'unknown'): boolean {
  return on && permission === 'denied';
}

/**
 * Ben turns the reminder on: ask iOS only now, and only if it can still ask.
 * The choice is saved either way (a later Allow in iPhone Settings starts it).
 */
export async function turnReminderOn(port: Pick<ReminderPort, 'permission' | 'request'>): Promise<AlertPermission> {
  const now = await port.permission();
  return now === 'undetermined' ? port.request() : now;
}

/**
 * The switch (review S4): Ben's choice is saved first, then iOS is asked
 * (only when it still can). Off saves and asks nothing. Returns the
 * permission to show, or null when nothing was asked.
 */
export async function toggleMorningReminder(next: boolean, deps: { save: (on: boolean) => void; port: Pick<ReminderPort, 'permission' | 'request'> }): Promise<AlertPermission | null> {
  deps.save(next);
  if (!next) return null;
  return turnReminderOn(deps.port).catch((): AlertPermission => 'denied');
}

/**
 * Keeps a screen's permission line current (review S6): read now and on every
 * return to the app (Ben may have just allowed it in iPhone Settings).
 * Returns the unsubscribe.
 */
export function watchPermission(deps: { read: () => Promise<AlertPermission>; onActive: (fn: () => void) => () => void; set: (p: AlertPermission) => void }): () => void {
  let alive = true;
  const read = () => {
    void deps
      .read()
      .then((p) => {
        if (alive) deps.set(p);
      })
      .catch(() => undefined);
  };
  read();
  const off = deps.onActive(read);
  return () => {
    alive = false;
    off();
  };
}

/** A tap on a notification opens Today (Ben, 20 Oct): a morning reminder's, once set up, with no workout on screen. */
export function morningTapOpensToday(t: { identifier: string; setupDone: boolean; navReady: boolean; currentRoute: string | null }): boolean {
  return isMorning(t.identifier) && t.setupDone && t.navReady && t.currentRoute !== 'Workout';
}

/**
 * What the Host does on each event (review S4), without React: launch, a
 * settings change (`force`), a write a screen reported (after `settleMs`, so a
 * burst is one refresh), and a return to the foreground (at once). Zone
 * changes are picked up on launch and foreground only; one while the app
 * stays open waits for the next of those (review N3).
 */
export function createReminderTriggers(deps: { refresh: (opts?: { force?: boolean }) => Promise<void>; settleMs: number; setTimer: (fn: () => void, ms: number) => unknown; clearTimer: (t: unknown) => void }) {
  let timer: unknown = null;
  let force = false;
  const soon = (f: boolean) => {
    force = force || f;
    if (timer !== null) deps.clearTimer(timer);
    timer = deps.setTimer(() => {
      timer = null;
      const opts = { force };
      force = false;
      void deps.refresh(opts);
    }, deps.settleMs);
  };
  return {
    launched: () => {
      soon(false);
    },
    settingsChanged: () => {
      soon(true);
    },
    dataChanged: () => {
      soon(false);
    },
    foreground: () => {
      void deps.refresh();
    },
    dispose: () => {
      if (timer !== null) deps.clearTimer(timer);
      timer = null;
    },
  };
}

/** `watchPermission`'s `onActive` from React Native's `AppState` (passed in, so this file stays free of React Native). */
export function onAppActive(appState: { addEventListener: (type: 'change', fn: (state: string) => void) => { remove: () => void } }): (fn: () => void) => () => void {
  return (fn) => {
    const sub = appState.addEventListener('change', (state) => {
      if (state === 'active') fn();
    });
    return () => {
      sub.remove();
    };
  };
}
