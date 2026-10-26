import { ActivitySchema, WeekPlanSchema, type Activity, type Routine, type WeekPlan } from '@fizz/schemas';
import type { ActivityChange, WeekPlanChange } from '@fizz/domain';
import type { Database } from './database';
import { decodeDocument, DocumentRepository, erase, listDocuments, ROUTINE_SPEC, saveDocumentIn, type DocumentSpec, type DocumentTable } from './documents';
import type { SqlExecutor } from './driver';

/**
 * (Ben, 20 Oct) Activities (runs, rides, swims, sport) and this week's
 * shape (week overrides), migration 26. Your data, owner-scoped (rule 10),
 * in backups like every Your-data table. Every write is decided by the
 * domain against the row as stored inside the transaction: versioned, a
 * repeated op ID changes nothing (rule 5), all or nothing.
 */

export const ACTIVITY_SPEC: DocumentSpec<Activity> = {
  table: 'activities',
  schema: ActivitySchema,
  columns: (a) => ({ owner_id: a.ownerId, local_date: a.fields.date, deleted: a.deletedAtUtc === null ? 0 : 1 }),
};

export const WEEK_PLAN_SPEC: DocumentSpec<WeekPlan> = {
  table: 'week_plans',
  schema: WeekPlanSchema,
  columns: (w) => ({ owner_id: w.ownerId, week_monday: w.weekMonday, status: w.status, proposal_action_id: w.proposalActionId }),
};

export const ACTIVITY_DOCUMENT_TABLES: readonly DocumentTable[] = [erase(ACTIVITY_SPEC), erase(WEEK_PLAN_SPEC)];

export type ActivityWrite =
  | { status: 'written' | 'replayed'; activity: Activity }
  | { status: 'stale'; activity: Activity | null }
  | { status: 'invalid'; reason: string }
  | { status: 'missing' };

async function getActivityIn(q: SqlExecutor, id: string): Promise<Activity | null> {
  const row = await q.getFirst('SELECT * FROM activities WHERE id = ?', [id]);
  return row ? decodeDocument(ACTIVITY_SPEC, row) : null;
}

/** Save a decided activity change inside a caller's transaction (the coach store's record write uses this too). */
export async function saveActivityChangeIn(tx: SqlExecutor, ownerId: string, c: ActivityChange): Promise<ActivityWrite> {
  switch (c.kind) {
    case 'duplicate':
      return { status: 'replayed', activity: c.current };
    case 'stale':
      return { status: 'stale', activity: c.current };
    case 'invalid':
      return { status: 'invalid', reason: c.reason };
    case 'write': {
      if (c.next.ownerId !== ownerId) throw new Error('Activity owner differs from the store owner');
      if (c.expectedVersion === null) {
        // A retried add with the same ID: the first one stands.
        const have = await getActivityIn(tx, c.next.id);
        if (have !== null) return have.ownerId === ownerId && have.opIds.some((o) => c.next.opIds.includes(o)) ? { status: 'replayed', activity: have } : { status: 'stale', activity: have.ownerId === ownerId ? have : null };
      }
      const r = await saveDocumentIn(tx, ACTIVITY_SPEC, c.next, c.expectedVersion);
      return r.ok ? { status: 'written', activity: c.next } : { status: 'stale', activity: await getActivityIn(tx, c.next.id) };
    }
  }
}

export class SqliteActivities extends DocumentRepository<Activity> {
  constructor(db: Database) {
    super(db, ACTIVITY_SPEC);
  }

  /** Live (not deleted) activities dated in [`from`, `to`) (local dates). */
  listBetween(ownerId: string, from: string, to: string): Promise<Activity[]> {
    return this.listWhere('owner_id = ? AND deleted = 0 AND local_date >= ? AND local_date < ?', [ownerId, from, to]);
  }

  /** (Ben, 26 Oct) The newest local date of a live activity before `before`, or null: History's `Show more`. */
  async latestDateBefore(ownerId: string, before: string): Promise<string | null> {
    const row = await this.db.read((q) => q.getFirst<{ d: string | null }>('SELECT max(local_date) AS d FROM activities WHERE owner_id = ? AND deleted = 0 AND local_date < ?', [ownerId, before]));
    return row?.d ?? null;
  }

  /** Every activity (deleted ones too), for backups' counts and tests. */
  listByOwner(ownerId: string): Promise<Activity[]> {
    return this.listWhere('owner_id = ?', [ownerId]);
  }

  /** A new activity. A retry with the same ID and op ID replays. */
  add(ownerId: string, change: ActivityChange): Promise<ActivityWrite> {
    return this.db.write((tx) => saveActivityChangeIn(tx, ownerId, change));
  }

  /** An edit, delete or Undo, decided against the stored row inside the write. */
  change(ownerId: string, id: string, make: (current: Activity) => ActivityChange): Promise<ActivityWrite> {
    return this.db.write(async (tx): Promise<ActivityWrite> => {
      const current = await getActivityIn(tx, id);
      if (current === null || current.ownerId !== ownerId) return { status: 'missing' };
      return saveActivityChangeIn(tx, ownerId, make(current));
    });
  }
}

export type WeekPlanWrite = { status: 'written' | 'replayed'; week: WeekPlan } | { status: 'stale' } | { status: 'invalid'; reason: string } | { status: 'missing' };

class Conflict extends Error {}

export class SqliteWeekPlans extends DocumentRepository<WeekPlan> {
  constructor(db: Database) {
    super(db, WEEK_PLAN_SPEC);
  }

  /** The owner's week changes for a week (any status). */
  listForWeek(ownerId: string, weekMonday: string): Promise<WeekPlan[]> {
    return this.listWhere('owner_id = ? AND week_monday = ?', [ownerId, weekMonday]);
  }

  /** The week change Apply made from one proposal, if any. */
  async byProposal(ownerId: string, proposalActionId: string): Promise<WeekPlan | null> {
    const rows = await this.listWhere('owner_id = ? AND proposal_action_id = ?', [ownerId, proposalActionId]);
    return rows[0] ?? null;
  }

  /**
   * Apply: the week change and its merged days' workouts, together or not at
   * all. `make` gets this week's changes as stored inside the transaction.
   */
  apply(ownerId: string, weekMonday: string, make: (current: readonly WeekPlan[]) => WeekPlanChange): Promise<WeekPlanWrite> {
    return this.db
      .write(async (tx): Promise<WeekPlanWrite> => {
        const current = await listDocuments(tx, WEEK_PLAN_SPEC, 'owner_id = ? AND week_monday = ?', [ownerId, weekMonday]);
        return this.saveChange(tx, ownerId, make(current));
      })
      .catch((e: unknown) => {
        if (e instanceof Conflict) return { status: 'stale' as const };
        throw e;
      });
  }

  /** Undo of an Apply, decided against the stored week change and its workouts. */
  undo(ownerId: string, id: string, make: (current: WeekPlan, routines: ReadonlyMap<string, Routine | null>) => WeekPlanChange): Promise<WeekPlanWrite> {
    return this.db
      .write(async (tx): Promise<WeekPlanWrite> => {
        const row = await tx.getFirst('SELECT * FROM week_plans WHERE id = ?', [id]);
        const current = row === null ? null : decodeDocument(WEEK_PLAN_SPEC, row);
        if (current === null || current.ownerId !== ownerId) return { status: 'missing' };
        const routines = new Map<string, Routine | null>();
        for (const m of current.made) {
          const r = await tx.getFirst('SELECT * FROM routines WHERE id = ?', [m.routineId]);
          const routine = r === null ? null : decodeDocument(ROUTINE_SPEC, r);
          routines.set(m.routineId, routine !== null && routine.ownerId === ownerId ? routine : null);
        }
        return this.saveChange(tx, ownerId, make(current, routines));
      })
      .catch((e: unknown) => {
        if (e instanceof Conflict) return { status: 'stale' as const };
        throw e;
      });
  }

  private async saveChange(tx: SqlExecutor, ownerId: string, c: WeekPlanChange): Promise<WeekPlanWrite> {
    switch (c.kind) {
      case 'duplicate':
        return { status: 'replayed', week: c.current };
      case 'stale':
        return { status: 'stale' };
      case 'invalid':
        return { status: 'invalid', reason: c.reason };
      case 'write': {
        if (c.next.ownerId !== ownerId) throw new Error('Week plan owner differs from the store owner');
        for (const r of c.routines) {
          if (r.next.ownerId !== ownerId) throw new Error('Routine owner differs from the store owner');
          if (!(await saveDocumentIn(tx, ROUTINE_SPEC, r.next, r.expectedVersion)).ok) throw new Conflict();
        }
        if (!(await saveDocumentIn(tx, WEEK_PLAN_SPEC, c.next, c.expectedVersion)).ok) throw new Conflict();
        return { status: 'written', week: c.next };
      }
    }
  }
}
