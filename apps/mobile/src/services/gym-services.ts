import {
  applyEquipmentForm,
  equipmentRowLine,
  selectDefaultGym,
  stableStringify,
  type EquipmentForm,
} from '@fizz/domain';
import { GYM_SPEC, listDocuments, saveDocumentIn, type SqliteRepositories, type Store } from '@fizz/persistence';
import type { EquipmentInstance, Gym, UserProfile, ZonedTimestamp } from '@fizz/schemas';

/**
 * The minimal gym editor's services (gym-editor.md §2.2, §2.4, §4.1): list
 * the gyms, show one gym's equipment, and save an item (versioned,
 * idempotent). Saving never changes a workout in progress: it uses the
 * equipment snapshot taken at its start (§4.9).
 */

export interface GymServicesContext {
  repos: () => SqliteRepositories;
  /** For writes that change several gyms in one transaction (selecting a gym). */
  store?: () => Store;
  now: () => ZonedTimestamp;
  profile: () => Promise<UserProfile | null>;
}

export interface GymRow {
  gym: Gym;
  items: number;
  /** Items still at preset values (`Typical values, not checked`). */
  unchecked: number;
}

export interface EquipmentRow {
  equipment: EquipmentInstance;
  line: string;
  unchecked: boolean;
}

export type EquipmentSave =
  | { ok: true; equipment: EquipmentInstance; previous: EquipmentInstance | null; duplicate: boolean }
  | { ok: false; reason: 'invalid'; problems: string[] }
  | { ok: false; reason: 'unit_locked'; message: string }
  | { ok: false; reason: 'stale'; message: string; latest: EquipmentInstance | null }
  | { ok: false; reason: 'failed'; message: string };

const FAILED = 'Couldn’t save. Try again.';

/** Content that matters for "is this save a repeat?" (not version or timestamps). */
function content(eq: EquipmentInstance): string {
  return stableStringify({ ...eq, version: 0, updatedAtUtc: '', checkedAtUtc: '' });
}

export function createGymServices(ctx: GymServicesContext) {
  const repos = () => ctx.repos();

  async function ownGym(gymId: string): Promise<Gym | null> {
    const p = await ctx.profile();
    const gym = await repos().gyms.get(gymId);
    return p && gym && gym.ownerId === p.id ? gym : null;
  }

  return {
    async list(): Promise<GymRow[]> {
      const p = await ctx.profile();
      if (!p) return [];
      const gyms = (await repos().gyms.listByOwner(p.id)).filter((g) => g.archivedAtUtc === undefined);
      const rows: GymRow[] = [];
      for (const gym of gyms) {
        const items = (await repos().equipment.listByGym(gym.id)).filter((e) => e.availability !== 'retired');
        rows.push({ gym, items: items.length, unchecked: items.filter((e) => e.detailsSource === 'preset').length });
      }
      return rows.sort((a, b) => Number(b.gym.isDefault) - Number(a.gym.isDefault) || a.gym.name.localeCompare(b.gym.name));
    },

    async detail(gymId: string): Promise<{ gym: Gym; equipment: EquipmentRow[]; inUseByWorkout: boolean } | null> {
      const gym = await ownGym(gymId);
      if (!gym) return null;
      const p = await ctx.profile();
      const active = p ? await repos().sessions.getActive(p.id).catch(() => null) : null;
      const equipment = (await repos().equipment.listByGym(gymId))
        .filter((e) => e.availability !== 'retired')
        .map((e) => ({ equipment: e, line: equipmentRowLine(e), unchecked: e.detailsSource === 'preset' }));
      return { gym, equipment, inUseByWorkout: active?.session.gymId === gymId };
    },

    async item(equipmentId: string): Promise<{ equipment: EquipmentInstance; unitLocked: boolean } | null> {
      const eq = await repos().equipment.get(equipmentId);
      if (!eq || !(await ownGym(eq.gymId))) return null;
      return { equipment: eq, unitLocked: await repos().equipment.hasLoggedSets(eq.id) };
    },

    /**
     * Save an item from the editor. `equipmentId` is chosen once per editor
     * visit (a new item's ID too), and `expectedVersion` is the version the
     * editor opened (null = new), so a double tap or retry saves once and an
     * item changed elsewhere is never overwritten (rule 5).
     */
    async save(req: { gymId: string; equipmentId: string; expectedVersion: number | null; form: EquipmentForm }): Promise<EquipmentSave> {
      const p = await ctx.profile();
      const gym = await ownGym(req.gymId);
      if (!p || !gym) return { ok: false, reason: 'failed', message: 'That gym wasn’t found.' };
      try {
        const current = await repos().equipment.get(req.equipmentId);
        if (current && current.gymId !== req.gymId) return { ok: false, reason: 'failed', message: FAILED };
        const base = req.expectedVersion === null ? null : current;
        if (req.expectedVersion !== null && current === null) return { ok: false, reason: 'stale', message: 'This item was removed since you opened it.', latest: null };
        if (base && req.form.unit !== base.unit && (await repos().equipment.hasLoggedSets(base.id))) {
          return {
            ok: false,
            reason: 'unit_locked',
            message: `Has ${base.unit} sets. Add new equipment for ${req.form.unit}.`,
          };
        }
        const built = applyEquipmentForm(req.form, base, { id: req.equipmentId, ownerId: p.id, gymId: req.gymId, atUtc: ctx.now().utc });
        if (!built.ok) return { ok: false, reason: 'invalid', problems: built.problems };
        const saved = await repos().equipment.save(built.equipment, req.expectedVersion);
        if (saved.ok) return { ok: true, equipment: built.equipment, previous: base, duplicate: false };
        // A repeat of a save that already landed is a duplicate, not a conflict.
        const latest = await repos().equipment.get(req.equipmentId);
        if (latest && latest.version === built.equipment.version && content(latest) === content(built.equipment)) {
          return { ok: true, equipment: latest, previous: base, duplicate: true };
        }
        return { ok: false, reason: 'stale', message: 'This item changed since you opened it.', latest };
      } catch {
        return { ok: false, reason: 'failed', message: FAILED };
      }
    },

    /**
     * `selectGym(gymId)` before a workout (workout-overview §6, today.md gym
     * chip): the chosen gym becomes the selected (default) gym. One
     * transaction, versioned; choosing the gym that is already selected
     * writes nothing, so a double tap or a retry is a no-op. Undo selects the
     * previous gym the same way. No session exists yet, so nothing else changes.
     */
    async select(gymId: string): Promise<{ ok: true; previousGymId: string | null; changed: boolean } | { ok: false; message: string }> {
      const p = await ctx.profile();
      const store = ctx.store?.();
      if (!p || !store) return { ok: false, message: 'That gym wasn’t found.' };
      try {
        return await store.db.write(async (tx) => {
          const gyms = (await listDocuments(tx, GYM_SPEC)).filter((g) => g.ownerId === p.id);
          const plan = selectDefaultGym(gyms, gymId, ctx.now().utc);
          if (plan.kind === 'not_found') return { ok: false as const, message: 'That gym wasn’t found.' };
          for (const w of plan.writes) {
            const r = await saveDocumentIn(tx, GYM_SPEC, w.next, w.expectedVersion);
            if (!r.ok) throw new Error('gym changed');
          }
          return { ok: true as const, previousGymId: plan.previousGymId, changed: plan.writes.length > 0 };
        });
      } catch {
        return { ok: false, message: FAILED };
      }
    },

    /** `Undo` on the save toast: the previous content saved again as a new version (nothing is erased). */
    async undoSave(saved: EquipmentInstance, previous: EquipmentInstance): Promise<boolean> {
      const latest = await repos().equipment.get(saved.id);
      if (!latest || latest.version !== saved.version) return false;
      const restored: EquipmentInstance = { ...previous, version: saved.version + 1, updatedAtUtc: ctx.now().utc };
      const r = await repos().equipment.save(restored, saved.version);
      return r.ok;
    },
  };
}

export type GymServices = ReturnType<typeof createGymServices>;
