import { MORNING_REMINDER_PREFIX, morningReminderSchedule, reminderOn, type MorningReminderSettings, type PlannedReminder, type UpNextForecast } from '@fizz/domain';

import type { AlertPermission } from '../alerts/notifier';

/**
 * Morning reminder (Ben, 20 Oct 2026): keeps the phone's pending local
 * notifications equal to `morningReminderSchedule`. Recomputed on launch,
 * return to the foreground, any write that can move Up next (finish, discard,
 * plan, routines, gym), a settings change and a zone change. Local
 * notifications only; nothing here blocks or fails logging (rule 1).
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
}

export function createMorningReminders(deps: MorningReminderDeps) {
  let chain: Promise<void> = Promise.resolve();
  /** What was last made pending in this run; a refresh that plans the same list writes nothing. */
  let appliedKey: string | null = null;
  let lastError: string | null = null;
  let lastPlanned: PlannedReminder[] = [];

  async function run(): Promise<void> {
    try {
      const settings = deps.settings();
      const permission = settings.on === null ? await deps.port.permission().catch((): AlertPermission => 'undetermined') : 'granted';
      const on = reminderOn(settings, permission);
      const forecast = on ? await deps.forecast() : null;
      const planned = forecast === null ? [] : morningReminderSchedule(deps.nowMs(), deps.tz(), { ...settings, on }, forecast);
      const key = JSON.stringify(planned.map((p) => [p.identifier, p.fireAtLocal, p.title, p.body]));
      if (key === appliedKey) return;
      for (const id of await deps.port.pending()) if (id.startsWith(MORNING_REMINDER_PREFIX)) await deps.port.cancel(id);
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
    /** Recompute and reschedule; serial, never throws. */
    refresh(): Promise<void> {
      chain = chain.then(run);
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
