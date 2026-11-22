import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { catalogueExerciseId, pbNotPreferred, pbPrefLikes } from '@fizz/domain';
import type { PlanBuilderAnswers, Routine } from '@fizz/schemas';

import type { AppServices } from '../src/services/app-services';
import type { ExercisePrefsView } from '../src/services/exercise-prefs-service';
import { CONNECTED, replyWith, StepModel, toolCall } from './coach-model';
import { createHarness, type Harness } from './harness';

/**
 * (Ben, 2 Nov) Profile › Likes & dislikes over real SQLite: the plan in use's Any preferences through the coach's own
 * service (`exercisePrefs`). What Profile writes, Plan setup's Edit plan opens and the coach reads; what Plan setup
 * applies, Profile shows. Versioned (a stale version is refused, nothing written), idempotent (one write per op ID), and
 * a dislike for an exercise in the plan surfaces Plan setup's `In your plan … · Replace` offer. No builder plan: an
 * honest `none`, no second store.
 */

let h: Harness;
let model: StepModel;
beforeEach(() => {
  model = new StepModel([]);
  h = createHarness('2026-11-02T08:00:00.000Z', { coach: { model: () => model, connection: () => Promise.resolve(CONNECTED) } });
});
afterEach(async () => {
  await h.cleanup();
});

const LE = 'machine-leg-extension';

async function template(s: AppServices, routineId: string): Promise<Routine> {
  const r = (await s.routines.editor({ routineId, gymId: null }))?.routine;
  if (r == null) throw new Error('no template');
  return r;
}

async function setUp(): Promise<AppServices> {
  const { services: s } = await h.launch();
  await s.setup.saveUnits('kg');
  const draft = s.coachingKnowledge.buildGymDraft('commercial', 'kg');
  await s.setup.saveGym({ gymId: h.ids(), name: 'Main Gym', draft: { ...draft, items: draft.items.map((i) => ({ ...i, ticked: true })) } });
  await s.setup.complete();
  return s;
}

/** Ben's 6-day PPL from the plan builder, with leg extension in Legs A and Legs B. */
async function bensPlan(s: AppServices): Promise<void> {
  const session = await s.planBuilder.open();
  if (session === null) throw new Error('no builder');
  const built = await s.planBuilder.save(session, { ...session.answers, split: 'ppl' as const, sessions: 6, schedule: 'set' as const, days: [0, 1, 2, 3, 4, 5], prefs: {}, likes: [], never: [] }, null, h.ids());
  if (!built.ok) throw new Error('not built');
  const applied = await s.planBuilder.apply({ planId: built.planId, versionN: built.versionN, expectedVersion: built.version, opId: h.ids() });
  if (!applied.ok) throw new Error('not applied');
  const le = catalogueExerciseId(LE);
  for (const d of ((await s.plans.active())?.days ?? []).filter((x) => x.name.startsWith('Legs'))) {
    const t = await template(s, d.routineId);
    if (t.exercises.some((e) => e.exerciseId === le)) continue;
    const r = await s.plans.editDayEveryWeek({ routineId: d.routineId, expectedVersion: t.version, opId: h.ids(), edit: { kind: 'add', rowId: h.ids(), fromExerciseId: null, toExerciseId: le, afterRowId: null } });
    if (!r.ok) throw new Error(r.message);
  }
}

/** The plan in use's Any preferences, as Plan setup's Edit plan opens them. */
async function planSetupPrefs(s: AppServices): Promise<Pick<PlanBuilderAnswers, 'prefs' | 'likes' | 'never'>> {
  const active = await s.plans.active();
  const session = active === null ? null : await s.planBuilder.open({ editPlanId: active.planId });
  if (session === null) throw new Error('no builder plan');
  return { prefs: session.answers.prefs, likes: session.answers.likes, never: session.answers.never };
}

function ready(v: ExercisePrefsView | null): Extract<ExercisePrefsView, { kind: 'ready' }> {
  if (v?.kind !== 'ready') throw new Error(`not ready: ${JSON.stringify(v)}`);
  return v;
}

describe('Profile › Likes & dislikes (Ben, 2 Nov)', () => {
  it('no plan in use: `none`, and a write is refused (no second store)', async () => {
    const s = await setUp();
    expect(await s.exercisePrefs.view()).toEqual({ kind: 'none', why: 'no_plan' });
    expect(await s.exercisePrefs.set({ exercise: catalogueExerciseId(LE), preference: 'not_preferred', expectedVersion: 1, opId: 'x' })).toMatchObject({ ok: false, reason: 'no_plan' });
  });

  it('Profile add shows in Plan setup’s answers (and the coach’s), with the plan-swap offer; versioned and idempotent', async () => {
    const s = await setUp();
    await bensPlan(s);
    const v0 = ready(await s.exercisePrefs.view());
    expect(v0.notPreferred).toEqual([]);

    // Not preferred from Profile: the picker's exercise ID.
    const r = await s.exercisePrefs.set({ exercise: catalogueExerciseId(LE), preference: 'not_preferred', expectedVersion: v0.version, opId: 'p-le' });
    if (!r.ok) throw new Error(r.line);
    const v1 = ready(r.view);
    expect(v1.version).toBe(v0.version + 1);
    expect(v1.notPreferred).toEqual([{ key: LE, name: 'Leg extension' }]);
    expect((await planSetupPrefs(s)).never).toEqual([LE]);
    // The coach reads the same answers: it calls it already not preferred, no second write.
    model = new StepModel([() => toolCall('set_exercise_preference', { exercise: LE, preference: 'not_preferred', swapTo: null, benAsked: true, benQuote: 'I don’t like leg extensions' }), () => replyWith('Already.')]);
    await s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text: 'I don’t like leg extensions', spoken: false }, turnId: h.ids() });
    expect(ready(await s.exercisePrefs.view()).version).toBe(v1.version);

    // Plan setup's `In your plan: Legs A, Legs B · Replace` offer, from the parts Profile shows.
    const lines = await s.planSwap.inPlan(v1.parts);
    expect(lines.map((l) => [l.name, l.days])).toEqual([['Leg extension', ['Legs A', 'Legs B']]]);
    expect(lines[0]?.replacement).not.toBeNull();

    // A retry of the same op (a double tap, a force-close): no second write.
    expect(await s.exercisePrefs.set({ exercise: catalogueExerciseId(LE), preference: 'not_preferred', expectedVersion: v0.version, opId: 'p-le' })).toMatchObject({ ok: true, view: { version: v1.version } });
    // A stale version: refused, nothing written, the newer state shown.
    const stale = await s.exercisePrefs.set({ exercise: catalogueExerciseId(LE), preference: 'preferred', expectedVersion: v0.version, opId: 'p-stale' });
    expect(stale).toMatchObject({ ok: false, reason: 'stale', view: { version: v1.version } });
    expect(pbNotPreferred(await planSetupPrefs(s)).has(LE)).toBe(true);

    // Liked moves it across (one list or the other); Remove clears it from both.
    const liked = await s.exercisePrefs.set({ exercise: LE, preference: 'preferred', expectedVersion: v1.version, opId: 'p-like' });
    if (!liked.ok) throw new Error(liked.line);
    expect(ready(liked.view)).toMatchObject({ liked: [{ key: LE }], notPreferred: [] });
    expect(await planSetupPrefs(s)).toMatchObject({ likes: [LE], never: [] });
    const removed = await s.exercisePrefs.set({ exercise: LE, preference: 'none', expectedVersion: ready(liked.view).version, opId: 'p-rm' });
    if (!removed.ok) throw new Error(removed.line);
    expect(ready(removed.view)).toMatchObject({ liked: [], notPreferred: [] });
  });

  it('Plan setup’s Edit plan → Profile: a like and a Quad extra pick applied there show in Profile’s lists', async () => {
    const s = await setUp();
    await bensPlan(s);
    const active = await s.plans.active();
    const session = active === null ? null : await s.planBuilder.open({ editPlanId: active.planId });
    if (session?.running == null) throw new Error('no plan in use');
    const answers = { ...session.answers, likes: ['dumbbell-bench-press'], prefs: { ...session.answers.prefs, quads: 1 as const } };
    const applied = await s.planBuilder.applyEdit(session, answers, new Set(), { kind: 'from', week: session.running.week }, h.ids());
    if (!applied.ok) throw new Error(JSON.stringify(applied));
    const v = ready(await s.exercisePrefs.view());
    const parts = await planSetupPrefs(s);
    expect(v.liked.map((x) => x.key).sort()).toEqual([...new Set(pbPrefLikes(parts))].sort());
    expect(v.liked.map((x) => x.key)).toContain('dumbbell-bench-press');
    // The Quad extra pick (Split squat) leaves leg extension out: Profile lists it as not preferred.
    expect(v.notPreferred.map((x) => x.key)).toContain(LE);
    expect(v.notPreferred.map((x) => x.key).sort()).toEqual([...pbNotPreferred(parts)].sort());
    // Removing it from Profile puts the question back to No preference; the pick's exercises stay liked.
    const r = await s.exercisePrefs.set({ exercise: LE, preference: 'none', expectedVersion: v.version, opId: h.ids() });
    if (!r.ok) throw new Error(r.line);
    expect((await planSetupPrefs(s)).prefs.quads).toBe('either');
    expect(ready(r.view).notPreferred.map((x) => x.key)).not.toContain(LE);
  });
});
