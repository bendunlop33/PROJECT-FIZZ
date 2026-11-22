import { directMuscleGroup } from '@fizz/domain';
import type { Exercise, Routine } from '@fizz/schemas';

import type { AppServices } from '../src/services/app-services';
import type { Harness } from './harness';
import type { Launched } from './render/render-screen';

/**
 * (Ben, 1 Nov) Ben's 6-day PPL A/B from the real plan builder (focus Muscle), at a commercial gym, applied, with every
 * biceps-led exercise taken out of its workouts (his own `Every week` removes): a plan with no curls.
 */
export async function bensPlanNoCurls(h: Harness): Promise<{ s: AppServices; launched: Launched; days: Map<string, string>; isBicepsLed: (id: string) => Promise<boolean> }> {
  const launched = await h.launch();
  const s = launched.services;
  await s.setup.saveUnits('kg');
  const draft = s.coachingKnowledge.buildGymDraft('commercial', 'kg');
  await s.setup.saveGym({ gymId: h.ids(), name: 'Main Gym', draft: { ...draft, items: draft.items.map((i) => ({ ...i, ticked: true })) } });
  await s.setup.complete();
  const session = await s.planBuilder.open();
  if (session === null) throw new Error('no builder');
  const built = await s.planBuilder.save(session, { ...session.answers, split: 'ppl' as const, sessions: 6, schedule: 'set' as const, days: [0, 1, 2, 3, 4, 5], focus: 'muscle' as const }, null, h.ids());
  if (!built.ok) throw new Error('not built');
  const applied = await s.planBuilder.apply({ planId: built.planId, versionN: built.versionN, expectedVersion: built.version, opId: h.ids() });
  if (!applied.ok) throw new Error('not applied');
  const days = new Map(((await s.plans.active())?.days ?? []).map((d) => [d.name, d.routineId]));
  const isBicepsLed = async (id: string): Promise<boolean> => {
    const pool: Exercise[] = await s.coachingKnowledge.exercises();
    const e = pool.find((x) => x.id === id);
    return e !== undefined && directMuscleGroup(e) === 'Biceps';
  };
  const template = async (routineId: string): Promise<Routine> => {
    const r = (await s.routines.editor({ routineId, gymId: null }))?.routine;
    if (r == null) throw new Error('no template');
    return r;
  };
  for (const id of [days.get('Pull A') ?? '', days.get('Pull B') ?? '']) {
    for (const e of (await template(id)).exercises) {
      if (!(await isBicepsLed(e.exerciseId))) continue;
      const now = await template(id);
      const r = await s.plans.editDayEveryWeek({ routineId: id, expectedVersion: now.version, opId: h.ids(), edit: { kind: 'remove', rowId: e.id, fromExerciseId: e.exerciseId, toExerciseId: null, afterRowId: null } });
      if (!r.ok) throw new Error(r.message);
    }
  }
  return { s, launched, days, isBicepsLed };
}
