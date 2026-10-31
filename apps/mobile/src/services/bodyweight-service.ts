import { bodyweightChart, bodyweightEntries, localDateOf, toMs, type BodyweightChartView, type BodyweightRange } from '@fizz/domain';
import type { Store } from '@fizz/persistence';
import type { HealthWeightSample, TrainingChange, UserProfile, WeightEntry, WeightUnit, ZonedTimestamp } from '@fizz/schemas';

/**
 * (Ben, 27 Oct) Progress's bodyweight card: Ben's dated entries (the training profile's `weights`, Your data: in
 * backups, export and Delete my data) merged with Apple Health's (his entry wins on his days; Health's stay local to
 * this install, not editable here). Every write is one versioned training-profile change with the tap's op ID, so a
 * double tap writes once and a stale screen is refused (rule 5). The newest entry is what the coach and the
 * bodyweight-exercise context read (`latestBodyweight`), so there is no second field to keep in sync.
 */

export interface BodyweightServiceDeps {
  store: () => Store;
  profile: () => Promise<UserProfile | null>;
  now: () => ZonedTimestamp;
  /** The training service's versioned change (one write, op ID, expected version). */
  change: (change: TrainingChange, expectedVersion: number, opId: string) => Promise<{ ok: true } | { ok: false; reason: string }>;
}

export interface BodyweightCard {
  view: BodyweightChartView;
  /** The training profile's version the card was read at (every write is on it). */
  version: number;
  unit: WeightUnit;
  today: string;
  /** Ben's own entries, newest first (editable); Health's are read-only and not listed here. */
  mine: WeightEntry[];
}

export type BodyweightOutcome = { ok: true } | { ok: false; message: string };

const MESSAGE: Readonly<Record<string, string>> = { stale: 'Changed since. Try again.', invalid: 'Check the weight and date.', no_profile: 'Set up your profile first.' };

export function createBodyweightService(deps: BodyweightServiceDeps) {
  async function healthWeights(ownerId: string): Promise<HealthWeightSample[]> {
    try {
      const h = deps.store().repos.health;
      const s = await h.settings(ownerId).catch(() => null);
      return s?.readWeight === true ? await h.weightSamples(ownerId).catch(() => []) : [];
    } catch {
      return [];
    }
  }

  const outcome = (r: { ok: true } | { ok: false; reason: string }): BodyweightOutcome => (r.ok ? { ok: true } : { ok: false, message: MESSAGE[r.reason] ?? 'Couldn’t save. Try again.' });

  return {
    /** The card for a range, or (Progress's period bar) a window; null without a profile. Local reads only. */
    async card(range: BodyweightRange, window: { from: string; to: string } | null = null): Promise<BodyweightCard | null> {
      const owner = await deps.profile();
      if (owner === null) return null;
      const [profile, health] = await Promise.all([deps.store().repos.trainingProfiles.get(owner.id), healthWeights(owner.id)]);
      const today = localDateOf(toMs(deps.now().utc), owner.timezone);
      const unit = owner.preferredUnit;
      const mine = [...(profile?.weights ?? [])].reverse();
      return { view: bodyweightChart(bodyweightEntries(profile?.weights ?? [], health), { range, unit, today, window }), version: profile?.version ?? 1, unit, today, mine };
    },

    /** `＋ Weight`: the op ID is the entry's ID, so a retried Save adds it once. */
    log(req: { value: number; unit: WeightUnit; date: string; opId: string; expectedVersion: number }): Promise<BodyweightOutcome> {
      return deps.change({ kind: 'add_weight', entry: { id: req.opId, date: req.date, value: req.value, unit: req.unit } }, req.expectedVersion, req.opId).then(outcome);
    },

    /** Correct an entry; Undo is the same call with the values it had. */
    edit(req: { entryId: string; value: number; unit: WeightUnit; date: string; opId: string; expectedVersion: number }): Promise<BodyweightOutcome> {
      return deps.change({ kind: 'edit_weight', entryId: req.entryId, value: req.value, unit: req.unit, date: req.date }, req.expectedVersion, req.opId).then(outcome);
    },

    remove(req: { entryId: string; opId: string; expectedVersion: number }): Promise<BodyweightOutcome> {
      return deps.change({ kind: 'delete_weight', entryId: req.entryId }, req.expectedVersion, req.opId).then(outcome);
    },

    /** Undo a delete: the same entry (same ID) back. */
    restore(req: { entry: WeightEntry; opId: string; expectedVersion: number }): Promise<BodyweightOutcome> {
      const e = req.entry;
      return deps.change({ kind: 'add_weight', entry: { id: e.id, date: e.date, value: e.value, unit: e.unit } }, req.expectedVersion, req.opId).then(outcome);
    },
  };
}

export type BodyweightService = ReturnType<typeof createBodyweightService>;
