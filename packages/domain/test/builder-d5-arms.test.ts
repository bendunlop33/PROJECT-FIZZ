import { describe, expect, it } from 'vitest';
import { buildFromSetup, mixForDay, slotsOf, type BuilderWorkout } from '../src/index';
import { context, info, pool } from './builder-v3-fixture';

/**
 * D5 (Ben, 22–23 Oct): the builder picks by broad groups (`Arms` = biceps + triceps, `Core`). An Arms count
 * alternates its parts, triceps first on a pressing day, biceps first otherwise; forearm work is never picked.
 */

const ctx = context();
const arms = (w: BuilderWorkout) => slotsOf(w.blocks).map((s) => info(s.exerciseId)).filter((i) => i?.group === 'Arms').map((i) => i?.part);

describe('Arms picks (D5)', () => {
  it('chest day: triceps first; back day: biceps first; both alternate', () => {
    const chest = buildFromSetup({ minutes: 999, mainLiftExerciseId: 'bench', supersets: false, groups: [{ group: 'Chest', count: 3 }, { group: 'Arms', count: 3 }] }, pool, ctx).workout;
    expect(arms(chest)).toEqual(['triceps', 'biceps', 'triceps']);
    const back = buildFromSetup({ minutes: 999, mainLiftExerciseId: null, supersets: false, groups: [{ group: 'Back', count: 2 }, { group: 'Arms', count: 2 }] }, pool, ctx).workout;
    expect(arms(back).sort()).toEqual(['biceps', 'triceps']);
    expect(slotsOf(back.blocks).find((s) => info(s.exerciseId)?.group === 'Arms')?.exerciseId).toBe('curl');
  });

  it('a day with only Arms picks biceps first; `armParts` keeps one part only', () => {
    const only = buildFromSetup({ minutes: 999, mainLiftExerciseId: null, supersets: false, groups: [{ group: 'Arms', count: 4 }] }, pool, ctx).workout;
    expect(arms(only).sort()).toEqual(['biceps', 'biceps', 'triceps', 'triceps']);
    const tri = buildFromSetup({ minutes: 999, mainLiftExerciseId: 'bench', supersets: false, groups: [{ group: 'Chest', count: 2 }, { group: 'Arms', count: 3 }], armParts: ['triceps'] }, pool, ctx);
    expect(arms(tri.workout)).toEqual(['triceps', 'triceps']);
    expect(tri.short).toEqual(['Arms']);
  });

  it('`add biceps` on a chest day (+1 Arms) gives the pushdown a curl', () => {
    const mix = mixForDay('chest', []);
    expect(mix).toEqual([{ group: 'Chest', count: 4 }, { group: 'Arms', count: 1 }, { group: 'Core', count: 1 }]);
    const plus = mix.map((g) => (g.group === 'Arms' ? { ...g, count: g.count + 1 } : g));
    const w = buildFromSetup({ minutes: 999, mainLiftExerciseId: 'bench', supersets: false, groups: plus }, pool, ctx).workout;
    expect(arms(w)).toEqual(['triceps', 'biceps']);
  });
});
