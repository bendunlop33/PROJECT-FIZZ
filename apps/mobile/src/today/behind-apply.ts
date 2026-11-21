import type { AppServices } from '../services/app-services';
import type { TodayBehindLonger, TodaySessionData } from '../services/today-session';

/**
 * (Ben, 21 Nov: MS3 amended) The built-in longer choice on `N days behind · Adjust today?` (no AI): Apply makes the
 * top missed day today's (`Make next`, as the usual choice does, when it isn't today's card already), saves its card
 * as today's Your workout, then writes the extras onto that draft as one versioned, undoable write (the builder's
 * `applyCoachWorkout`: idempotent on its op ID, refused once the draft moved on, rule 5). Undo takes both back.
 * Nothing done is touched: the draft isn't started.
 */

export type BehindLongerApplied = { ok: true; draftId: string; undo: () => Promise<boolean> } | { ok: false; message: string };

const FAILED = 'Couldn’t change today. Try again.';

export async function applyBehindLonger(s: Pick<AppServices, 'todaySession' | 'plans' | 'builder'>, data: TodaySessionData, longer: TodayBehindLonger, newId: () => string): Promise<BehindLongerApplied> {
  const b = data.behind;
  if (b === null) return { ok: false, message: FAILED };
  let pinned: { opId: string; version: number } | null = null;
  if (b.builtIn !== null && b.builtIn.dayKey === longer.dayKey) {
    if (data.planVersion === null) return { ok: false, message: FAILED };
    const opId = newId();
    const r = await s.plans.makeNext({ planId: b.planId, routineId: b.builtIn.routineId, expectedVersion: data.planVersion, opId });
    if (!r.ok) return { ok: false, message: r.message };
    pinned = { opId, version: r.plan.version };
  }
  const unpin = async (): Promise<boolean> => {
    if (pinned === null) return true;
    const u = await s.plans.undoControl({ planId: b.planId, targetOpId: pinned.opId, expectedVersion: pinned.version, opId: newId() }).catch(() => null);
    return u?.ok === true;
  };
  const fail = async (message: string): Promise<BehindLongerApplied> => {
    await unpin();
    return { ok: false, message };
  };
  const fresh = await s.todaySession.load().catch(() => null);
  const controls = fresh?.initial[longer.dayKey];
  if (fresh == null || controls === undefined) return fail(FAILED);
  const c = await s.todaySession.commit(fresh, { dayKey: longer.dayKey, controls }, newId()).catch(() => null);
  if (c === null || !c.ok) return fail(c?.message ?? FAILED);
  const snap = await s.builder.read(c.draftId).catch(() => null);
  if (snap === null) return fail(FAILED);
  const workout = s.todaySession.withBehindExtras(fresh, snap.workout, longer.extras);
  const applyOp = newId();
  const w = await s.builder.applyCoachWorkout({ draftId: c.draftId, expectedVersion: snap.version, workout, minutes: Math.max(snap.setup.minutes, longer.minutes), opId: applyOp }).catch(() => null);
  if (w === null || !w.ok) return fail(FAILED);
  return {
    ok: true,
    draftId: c.draftId,
    undo: async () => {
      const u = await s.builder.undo(c.draftId, applyOp, newId()).catch(() => null);
      const draftBack = u !== null && (u.status === 'written' || u.status === 'replayed');
      return draftBack && (await unpin());
    },
  };
}
