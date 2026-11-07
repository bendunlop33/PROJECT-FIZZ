import {
  applyEquipmentForm,
  assumedTag,
  equipmentRowLine,
  gymEditLanded,
  gymEditWrites,
  makeFullNeedsDumbbellStep,
  notHereExerciseIds,
  planGymLearn,
  planMakeFullGym,
  planNotHere,
  planPutBack,
  planRevertGymEdit,
  selectDefaultGym,
  stableStringify,
  type EquipmentForm,
  type GymEdit,
  type GymLearn,
} from '@fizz/domain';
import { deleteDocumentIn, EQUIPMENT_SPEC, GYM_SPEC, listDocuments, saveDocumentIn, type SqlExecutor, type SqliteRepositories, type Store } from '@fizz/persistence';
import type { EquipmentInstance, Exercise, Gym, UserProfile, WeightUnit, ZonedTimestamp } from '@fizz/schemas';

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
  /** Ben's exercise or the bundled catalogue's row (`Not at this gym`, the gym screen's names). */
  exercise?: (id: string) => Promise<Exercise | null>;
  newId?: () => string;
}

/** (ADR 0029) The result of a quick gym change, with what Undo needs. */
export type GymEditOutcome = { ok: true; edit: GymEdit; duplicate: boolean } | { ok: false; reason: 'nothing' | 'stale' | 'failed'; message: string };

export interface GymRow {
  gym: Gym;
  items: number;
  /** Items still assumed (preset values Ben hasn't confirmed; ADR 0029). */
  unchecked: number;
}

export interface EquipmentRow {
  equipment: EquipmentInstance;
  line: string;
  unchecked: boolean;
  /** `Assumed` until Ben confirms or edits it (ADR 0029). */
  tag: string | null;
}

export interface GymDetail {
  gym: Gym;
  equipment: EquipmentRow[];
  inUseByWorkout: boolean;
  /** The unit new items are made in: the gym's items', else Ben's. */
  unit: WeightUnit;
  /** `Make full gym`: null when a full gym would add nothing; else whether it asks `Dumbbells go up in` first. */
  makeFull: { needsDumbbellStep: boolean } | null;
  /** Exercises Ben marked `Not at this gym`, with `Put back`. */
  notHere: { exerciseId: string; name: string }[];
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

  const newId = (): (() => string) => {
    const make = ctx.newId;
    if (make === undefined) throw new Error('gym services need newId');
    return make;
  };

  async function currentOf(tx: SqlExecutor, edit: GymEdit) {
    const gyms = await listDocuments(tx, GYM_SPEC, 'id = ?', [edit.gymId]);
    const items = await listDocuments(tx, EQUIPMENT_SPEC, 'gym_id = ?', [edit.gymId]);
    const byId = new Map(items.map((e) => [e.id, e]));
    return { gym: gyms[0] ?? null, equipment: (id: string) => byId.get(id) ?? null };
  }

  class Stale extends Error {}

  async function writeAll(tx: SqlExecutor, w: ReturnType<typeof gymEditWrites>) {
    if (w.gym !== null && !(await saveDocumentIn(tx, GYM_SPEC, w.gym.next, w.gym.expectedVersion)).ok) throw new Stale();
    for (const e of w.equipment) if (!(await saveDocumentIn(tx, EQUIPMENT_SPEC, e.next, e.expectedVersion)).ok) throw new Stale();
  }

  /**
   * One edit in one transaction, every record version-checked (rule 5). A
   * repeat of an edit that already landed (double tap, retry) is a duplicate.
   */
  async function applyEdit(edit: GymEdit): Promise<GymEditOutcome> {
    const store = ctx.store?.();
    const p = await ctx.profile();
    const mine = (edit.gym === null || edit.gym.after.ownerId === p?.id) && edit.equipment.every((e) => e.after.ownerId === p?.id && e.after.gymId === edit.gymId);
    if (!store || !p || !mine) return { ok: false, reason: 'failed', message: FAILED };
    try {
      return await store.db.write(async (tx) => {
        if (gymEditLanded(edit, await currentOf(tx, edit))) return { ok: true as const, edit, duplicate: true };
        await writeAll(tx, gymEditWrites(edit));
        return { ok: true as const, edit, duplicate: false };
      });
    } catch (e) {
      return e instanceof Stale ? { ok: false, reason: 'stale', message: 'The gym changed. Try again.' } : { ok: false, reason: 'failed', message: FAILED };
    }
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

    async detail(gymId: string): Promise<GymDetail | null> {
      const gym = await ownGym(gymId);
      if (!gym) return null;
      const p = await ctx.profile();
      const active = p ? await repos().sessions.getActive(p.id).catch(() => null) : null;
      const all = await repos().equipment.listByGym(gymId);
      const live = all.filter((e) => e.availability !== 'retired');
      const equipment = live.map((e) => ({ equipment: e, line: equipmentRowLine(e), unchecked: e.detailsSource === 'preset', tag: assumedTag(e) }));
      const unit = live[0]?.unit ?? p?.preferredUnit ?? 'kg';
      const probe = planMakeFullGym({ gym, equipment: all, unit, dumbbellStep: unit === 'kg' ? 2.5 : 5, atUtc: ctx.now().utc, newId: () => '00000000-0000-4000-8000-000000000000' });
      const notHere: { exerciseId: string; name: string }[] = [];
      for (const id of notHereExerciseIds(all)) notHere.push({ exerciseId: id, name: (await ctx.exercise?.(id).catch(() => null))?.name ?? 'Exercise' });
      return {
        gym,
        equipment,
        inUseByWorkout: active?.session.gymId === gymId,
        unit,
        makeFull: probe.kind === 'nothing_to_add' ? null : { needsDumbbellStep: makeFullNeedsDumbbellStep(gym, all) },
        notHere: notHere.sort((a, b) => a.name.localeCompare(b.name)),
      };
    },

    /**
     * `Make full gym` (ADR 0029): keeps every item Ben has and adds the rest
     * of a full gym, assumed. One transaction; `undoEdit` takes it back.
     */
    async makeFull(req: { gymId: string; dumbbellStep: number }): Promise<GymEditOutcome> {
      const gym = await ownGym(req.gymId);
      if (!gym) return { ok: false, reason: 'failed', message: 'That gym wasn’t found.' };
      const all = await repos().equipment.listByGym(req.gymId);
      const p = await ctx.profile();
      const unit = all.find((e) => e.availability === 'available')?.unit ?? p?.preferredUnit ?? 'kg';
      let plan: ReturnType<typeof planMakeFullGym>;
      try {
        plan = planMakeFullGym({ gym, equipment: all, unit, dumbbellStep: req.dumbbellStep, atUtc: ctx.now().utc, newId: newId() });
      } catch {
        return { ok: false, reason: 'failed', message: FAILED };
      }
      if (plan.kind === 'nothing_to_add') return { ok: false, reason: 'nothing', message: 'Already a full gym.' };
      return applyEdit(plan.edit);
    },

    /** `Not at this gym` on an exercise (mid-workout ⋯): its items here are marked not for it. Undo: `undoEdit`. */
    async markNotHere(req: { gymId: string; exerciseId: string }): Promise<GymEditOutcome> {
      const gym = await ownGym(req.gymId);
      const exercise = await ctx.exercise?.(req.exerciseId).catch(() => null);
      if (!gym || !exercise) return { ok: false, reason: 'failed', message: FAILED };
      const plan = planNotHere({ exercise, equipment: await repos().equipment.listByGym(req.gymId), atUtc: ctx.now().utc });
      if (plan.kind === 'none_needed') return { ok: false, reason: 'nothing', message: `${exercise.name} needs no equipment.` };
      if (plan.kind === 'already') return { ok: false, reason: 'nothing', message: `${exercise.name}: already not here.` };
      return applyEdit(plan.edit);
    },

    /** `Put back` on the gym screen. */
    async putBack(req: { gymId: string; exerciseId: string }): Promise<GymEditOutcome> {
      const gym = await ownGym(req.gymId);
      if (!gym) return { ok: false, reason: 'failed', message: FAILED };
      const name = (await ctx.exercise?.(req.exerciseId).catch(() => null))?.name ?? 'Exercise';
      const edit = planPutBack({ exerciseId: req.exerciseId, exerciseName: name, equipment: await repos().equipment.listByGym(req.gymId), atUtc: ctx.now().utc });
      return edit === null ? { ok: false, reason: 'nothing', message: `${name} is already back.` } : applyEdit(edit);
    },

    /** `Add 22 kg dumbbells here?` / `Leg extension goes up in 7 kg?` (ADR 0029): the change on the gym as saved now. */
    async learn(learn: GymLearn): Promise<GymEditOutcome> {
      const eq = await repos().equipment.get(learn.equipmentId);
      if (!eq || !(await ownGym(eq.gymId))) return { ok: false, reason: 'failed', message: FAILED };
      const edit = planGymLearn(eq, learn, ctx.now().utc, newId(), await repos().equipment.listByGym(eq.gymId));
      return edit === null ? { ok: false, reason: 'nothing', message: 'Already saved.' } : applyEdit(edit);
    },

    applyEdit: (edit: GymEdit) => applyEdit(edit),

    /** Undo of a quick gym change: each record back as a new version, only while nothing changed since (rule 5). */
    async undoEdit(edit: GymEdit): Promise<{ ok: true } | { ok: false; message: string }> {
      const store = ctx.store?.();
      if (!store) return { ok: false, message: FAILED };
      try {
        return await store.db.write(async (tx) => {
          const current = await currentOf(tx, edit);
          const plan = planRevertGymEdit(edit, current, ctx.now().utc);
          if (plan === 'changed_since') return { ok: false as const, message: 'Can’t undo: the gym changed since.' };
          await writeAll(tx, plan);
          for (const r of plan.remove) if (!(await deleteDocumentIn(tx, EQUIPMENT_SPEC, r.id, r.expectedVersion))) throw new Stale();
          return { ok: true as const };
        });
      } catch {
        return { ok: false, message: FAILED };
      }
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
