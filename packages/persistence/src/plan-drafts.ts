import { PlanDraftSchema, type Exercise, type PlanDraft, type Routine } from '@fizz/schemas';
import { expirePlanDraft, type PlanApplyChange, type PlanControlChange, type PlanEndChange, type PlanLifeChange, type PlanUndoChange } from '@fizz/domain';
import type { Database } from './database';
import { decodeDocument, DocumentRepository, erase, EXERCISE_SPEC, listDocuments, ROUTINE_SPEC, saveDocumentIn, type DocumentSpec, type DocumentTable } from './documents';
import type { SqlExecutor } from './driver';

/**
 * Coach-built multi-day plans (19 Oct, migration 20). Your data,
 * owner-scoped. The coach's own write (a new plan or version) goes through
 * the coach store with its `ActionRecord` in one transaction (`CoachWrite`
 * kind `plan_draft`). Ben's Apply and Undo come here: the plan and every
 * workout they make, change or delete in one transaction, decided by the
 * domain against what is stored (rule 5), so a force-close leaves either
 * all of it or none.
 */

export const PLAN_DRAFT_SPEC: DocumentSpec<PlanDraft> = {
  table: 'plan_drafts',
  schema: PlanDraftSchema,
  columns: (p) => ({ owner_id: p.ownerId, status: p.status, expires_at_utc: p.expiresAtUtc }),
};

export const PLAN_DRAFT_DOCUMENT_TABLES: readonly DocumentTable[] = [erase(PLAN_DRAFT_SPEC)];

export async function getPlanDraftIn(q: SqlExecutor, id: string): Promise<PlanDraft | null> {
  const row = await q.getFirst('SELECT * FROM plan_drafts WHERE id = ?', [id]);
  return row ? decodeDocument(PLAN_DRAFT_SPEC, row) : null;
}

/** What Apply or Undo did. `changed_since`: a workout it would touch was changed by Ben since; nothing was written. */
export type PlanWrite =
  | { status: 'written' | 'replayed'; plan: PlanDraft; routines: Routine[] }
  | { status: 'stale' | 'closed'; plan: PlanDraft }
  | { status: 'changed_since'; plan: PlanDraft; names: string[] }
  | { status: 'missing' }
  | { status: 'invalid'; reason: string };

class Conflict extends Error {}

export class SqlitePlanDrafts extends DocumentRepository<PlanDraft> {
  constructor(db: Database) {
    super(db, PLAN_DRAFT_SPEC);
  }

  listByOwner(ownerId: string): Promise<PlanDraft[]> {
    return this.listWhere('owner_id = ?', [ownerId]);
  }

  /** The applied plan in use, newest Apply first (normally one). */
  async applied(ownerId: string): Promise<PlanDraft | null> {
    const rows = await this.listWhere("owner_id = ? AND status = 'applied'", [ownerId]);
    return rows.sort((a, b) => ((a.applied?.atUtc ?? '') < (b.applied?.atUtc ?? '') ? 1 : -1))[0] ?? null;
  }

  /**
   * (Plan builder) A new open plan Ben built himself, with no coach turn behind it. Idempotent: the plan's ID follows
   * from the Build's op ID, so a retry after a force-close finds the plan already there (`replayed`).
   */
  create(ownerId: string, plan: PlanDraft): Promise<PlanWrite> {
    return this.db.write(async (tx): Promise<PlanWrite> => {
      if (plan.ownerId !== ownerId) return { status: 'invalid', reason: 'owner' };
      const current = await getPlanDraftIn(tx, plan.id);
      if (current !== null) return current.ownerId === ownerId ? { status: 'replayed', plan: current, routines: [] } : { status: 'missing' };
      const r = await saveDocumentIn(tx, PLAN_DRAFT_SPEC, plan, null);
      return r.ok ? { status: 'written', plan, routines: [] } : { status: 'stale', plan };
    });
  }

  /** A versioned write the domain decided against the stored plan (a coach version is the coach store's). */
  write(ownerId: string, id: string, change: (current: PlanDraft) => PlanLifeChange): Promise<PlanWrite> {
    return this.db.write(async (tx): Promise<PlanWrite> => {
      const current = await getPlanDraftIn(tx, id);
      if (current === null || current.ownerId !== ownerId) return { status: 'missing' };
      const c = change(current);
      switch (c.kind) {
        case 'duplicate':
          return { status: 'replayed', plan: c.current, routines: [] };
        case 'stale':
          return { status: 'stale', plan: c.current };
        case 'closed':
          return { status: 'closed', plan: c.current };
        case 'invalid':
          return { status: 'invalid', reason: c.reason };
        case 'write': {
          const r = await saveDocumentIn(tx, PLAN_DRAFT_SPEC, c.next, c.expectedVersion);
          return r.ok ? { status: 'written', plan: c.next, routines: [] } : { status: 'stale', plan: current };
        }
      }
    });
  }

  /**
   * Apply: the plan's workouts made, the workouts it takes out of the
   * rotation changed, and the plan marked applied, together or not at all.
   * `make` gets the plan and Ben's workouts as stored inside the transaction.
   */
  apply(ownerId: string, planId: string, make: (current: PlanDraft, routines: readonly Routine[], applied: readonly PlanDraft[]) => PlanApplyChange, exercises: readonly Exercise[] = []): Promise<PlanWrite> {
    return this.db
      .write(async (tx): Promise<PlanWrite> => {
        const current = await getPlanDraftIn(tx, planId);
        if (current === null || current.ownerId !== ownerId) return { status: 'missing' };
        const routines = await listDocuments(tx, ROUTINE_SPEC, 'owner_id = ?', [ownerId]);
        const applied = await listDocuments(tx, PLAN_DRAFT_SPEC, "owner_id = ? AND status = 'applied' AND id != ?", [ownerId, planId]);
        const c = make(current, routines, applied);
        switch (c.kind) {
          case 'duplicate':
            return { status: 'replayed', plan: c.current, routines: (c.current.applied?.made ?? []).flatMap((m) => routines.filter((r) => r.id === m.routineId)) };
          case 'stale':
            return { status: 'stale', plan: c.current };
          case 'closed':
            return { status: 'closed', plan: c.current };
          case 'write': {
            // Catalogue exercises the plan names, saved as Ben's rows only with the Apply itself (review S4).
            for (const e of exercises) {
              if ((await tx.getFirst('SELECT id FROM exercises WHERE id = ?', [e.id])) !== null) continue;
              if (!(await saveDocumentIn(tx, EXERCISE_SPEC, e, null)).ok) throw new Conflict();
            }
            for (const r of c.create) {
              if (r.ownerId !== ownerId) throw new Error('Routine owner differs from the store owner');
              if (!(await saveDocumentIn(tx, ROUTINE_SPEC, r, null)).ok) throw new Conflict();
            }
            for (const u of c.update) if (!(await saveDocumentIn(tx, ROUTINE_SPEC, u.next, u.expectedVersion)).ok) throw new Conflict();
            for (const o of c.supersede) if (!(await saveDocumentIn(tx, PLAN_DRAFT_SPEC, o.next, o.expectedVersion)).ok) throw new Conflict();
            if (!(await saveDocumentIn(tx, PLAN_DRAFT_SPEC, c.next, c.expectedVersion)).ok) throw new Conflict();
            return { status: 'written', plan: c.next, routines: [...c.create, ...c.update.map((u) => u.next)] };
          }
        }
      })
      .catch(async (e: unknown) => {
        if (!(e instanceof Conflict)) throw e;
        const plan = await this.get(planId);
        return plan === null ? { status: 'missing' as const } : { status: 'stale' as const, plan };
      });
  }

  /** Undo of an Apply: the plan's workouts deleted, the others back in the rotation, the plan open again; all or nothing. */
  undo(ownerId: string, planId: string, make: (current: PlanDraft, routines: ReadonlyMap<string, Routine | null>, plans: ReadonlyMap<string, PlanDraft | null>) => PlanUndoChange): Promise<PlanWrite> {
    return this.db
      .write(async (tx): Promise<PlanWrite> => {
        const current = await getPlanDraftIn(tx, planId);
        if (current === null || current.ownerId !== ownerId) return { status: 'missing' };
        const ids = [...(current.applied?.made.map((m) => m.routineId) ?? []), ...(current.applied?.rotationOff.map((o) => o.routineId) ?? [])];
        const routines = new Map<string, Routine | null>();
        for (const id of ids) {
          const row = await tx.getFirst('SELECT * FROM routines WHERE id = ?', [id]);
          const r = row === null ? null : decodeDocument(ROUTINE_SPEC, row);
          routines.set(id, r !== null && r.ownerId === ownerId ? r : null);
        }
        await addPlanTemplates(tx, ownerId, planId, routines);
        const plans = new Map<string, PlanDraft | null>();
        for (const s of current.applied?.superseded ?? []) {
          const o = await getPlanDraftIn(tx, s.planId);
          plans.set(s.planId, o !== null && o.ownerId === ownerId ? o : null);
        }
        const c = make(current, routines, plans);
        switch (c.kind) {
          case 'duplicate':
            return { status: 'replayed', plan: c.current, routines: [] };
          case 'stale':
            return { status: 'stale', plan: c.current };
          case 'changed_since':
            return { status: 'changed_since', plan: c.current, names: c.names };
          case 'write': {
            for (const u of c.update) if (!(await saveDocumentIn(tx, ROUTINE_SPEC, u.next, u.expectedVersion)).ok) throw new Conflict();
            for (const o of c.restore) if (!(await saveDocumentIn(tx, PLAN_DRAFT_SPEC, o.next, o.expectedVersion)).ok) throw new Conflict();
            if (!(await saveDocumentIn(tx, PLAN_DRAFT_SPEC, c.next, c.expectedVersion)).ok) throw new Conflict();
            return { status: 'written', plan: c.next, routines: c.update.map((u) => u.next) };
          }
        }
      })
      .catch(async (e: unknown) => {
        if (!(e instanceof Conflict)) throw e;
        const plan = await this.get(planId);
        return plan === null ? { status: 'missing' as const } : { status: 'stale' as const, plan };
      });
  }

  /**
   * `End plan` and its Undo (Ben, 19 Oct): the plan and the workouts it takes
   * out of (or puts back in) the rotation, together or not at all. `make`
   * gets the plan, its workouts as stored inside the transaction, and whether
   * another plan is applied now (Undo of End is stale then).
   */
  endOrResume(ownerId: string, planId: string, make: (current: PlanDraft, routines: ReadonlyMap<string, Routine | null>, otherApplied: boolean) => PlanEndChange): Promise<PlanWrite> {
    return this.db
      .write(async (tx): Promise<PlanWrite> => {
        const current = await getPlanDraftIn(tx, planId);
        if (current === null || current.ownerId !== ownerId) return { status: 'missing' };
        const routines = new Map<string, Routine | null>();
        // The plan's workouts, and (20 Oct) the ones its Apply took out of the rotation: End puts those back.
        for (const id of [...(current.applied?.made.map((m) => m.routineId) ?? []), ...(current.applied?.rotationOff.map((o) => o.routineId) ?? [])]) {
          if (routines.has(id)) continue;
          const row = await tx.getFirst('SELECT * FROM routines WHERE id = ?', [id]);
          const r = row === null ? null : decodeDocument(ROUTINE_SPEC, row);
          routines.set(id, r !== null && r.ownerId === ownerId ? r : null);
        }
        await addPlanTemplates(tx, ownerId, planId, routines);
        const other = await tx.getFirst("SELECT id FROM plan_drafts WHERE owner_id = ? AND status = 'applied' AND id != ?", [ownerId, planId]);
        const c = make(current, routines, other !== null);
        switch (c.kind) {
          case 'duplicate':
            return { status: 'replayed', plan: c.current, routines: [] };
          case 'stale':
            return { status: 'stale', plan: c.current };
          case 'changed_since':
            return { status: 'changed_since', plan: c.current, names: c.names };
          case 'write': {
            for (const u of c.update) if (!(await saveDocumentIn(tx, ROUTINE_SPEC, u.next, u.expectedVersion)).ok) throw new Conflict();
            if (!(await saveDocumentIn(tx, PLAN_DRAFT_SPEC, c.next, c.expectedVersion)).ok) throw new Conflict();
            return { status: 'written', plan: c.next, routines: c.update.map((u) => u.next) };
          }
        }
      })
      .catch(async (e: unknown) => {
        if (!(e instanceof Conflict)) throw e;
        const plan = await this.get(planId);
        return plan === null ? { status: 'missing' as const } : { status: 'stale' as const, plan };
      });
  }

  /**
   * (Ben, 20 Oct) `Make next`, pause, resume and their Undo: one versioned
   * write on the plan in use, decided by the domain against the plan and
   * Ben's workouts as stored inside the transaction (rule 5).
   */
  control(ownerId: string, planId: string, make: (current: PlanDraft, routines: readonly Routine[]) => PlanControlChange): Promise<PlanWrite> {
    return this.db.write(async (tx): Promise<PlanWrite> => {
      const current = await getPlanDraftIn(tx, planId);
      if (current === null || current.ownerId !== ownerId) return { status: 'missing' };
      const routines = await listDocuments(tx, ROUTINE_SPEC, 'owner_id = ?', [ownerId]);
      const c = make(current, routines);
      switch (c.kind) {
        case 'duplicate':
          return { status: 'replayed', plan: c.current, routines: [] };
        case 'stale':
          return { status: 'stale', plan: c.current };
        case 'invalid':
          return { status: 'invalid', reason: c.reason };
        case 'write': {
          const r = await saveDocumentIn(tx, PLAN_DRAFT_SPEC, c.next, c.expectedVersion);
          return r.ok ? { status: 'written', plan: c.next, routines: [] } : { status: 'stale', plan: current };
        }
      }
    });
  }

  /** The 14-day expiry of open plans, run on read. Returns the plans it closed. */
  expire(ownerId: string, nowUtc: string): Promise<PlanDraft[]> {
    return this.db.write(async (tx) => {
      const rows = await tx.getAll("SELECT * FROM plan_drafts WHERE owner_id = ? AND status = 'open' AND expires_at_utc <= ?", [ownerId, nowUtc]);
      const closed: PlanDraft[] = [];
      for (const row of rows) {
        const p = decodeDocument(PLAN_DRAFT_SPEC, row);
        const next = expirePlanDraft(p, nowUtc);
        if (next === null) continue;
        if ((await saveDocumentIn(tx, PLAN_DRAFT_SPEC, next, p.version)).ok) closed.push(next);
      }
      return closed;
    });
  }
}

/**
 * (v3 §4.2, review b3-data S4) The plan's live templates its Apply didn't
 * make (saved for it since, e.g. a new main lift from the builder): Undo
 * deletes them and End takes them out of the rotation with the plan's own.
 */
async function addPlanTemplates(tx: SqlExecutor, ownerId: string, planId: string, routines: Map<string, Routine | null>): Promise<void> {
  const rows = await listDocuments(tx, ROUTINE_SPEC, "owner_id = ? AND json_extract(data, '$.planDay.planId') = ? AND json_extract(data, '$.deletedAtUtc') IS NULL", [ownerId, planId]);
  for (const r of rows) if (!routines.has(r.id)) routines.set(r.id, r);
}
