import { describe, expect, it } from 'vitest';
import { buildFromSetup, slotsOf, type BuilderSetup } from '@fizz/domain';
import { builderFixture as F } from '@fizz/domain/testing';
import {
  NEAR_DUPLICATE_RULE,
  applyBuilderEdits,
  buildEditRequest,
  buildReviewRequest,
  builderWorkoutView,
  createBuilderLoadGuard,
  type BuilderCoachEnv,
  type BuilderCoachExtras,
  type BuilderCoachSnapshot,
} from '../src/index';

/**
 * (Ben, 23 Oct) The coach and near-duplicates: an edit Ben asked for that adds one is flagged (⚠, Apply still
 * works); a review suggestion that adds one is left out (`checkReview`, builder-coach-review.test.ts); the coach is
 * told the rule in COACHING KNOWLEDGE.
 */

const chest: BuilderSetup = { minutes: 60, mainLiftExerciseId: 'bench', supersets: true, groups: [{ group: 'Chest', count: 3 }, { group: 'Arms', count: 1 }, { group: 'Core', count: 1 }] };

function world() {
  const ctx = F.context();
  const w = buildFromSetup(chest, F.pool, ctx).workout;
  const snap: BuilderCoachSnapshot = { draftId: 'd1', draftVersion: 2, dayName: 'Chest', minutes: 60, supersets: true, workout: w, revs: {} };
  const env: BuilderCoachEnv = { ctx, usable: (id) => F.info(id) !== null, pain: () => null, loads: createBuilderLoadGuard({ ctx, refs: () => null, pain: () => null }), askedHeavier: false, mainGroup: 'Chest' };
  const key = (id: string) => slotsOf(w.blocks).find((s) => s.exerciseId === id)?.key ?? '';
  return { ctx, w, snap, env, key };
}

const extras: BuilderCoachExtras = { usable: [], painFlags: [], dayNotes: [], plan: null, goal: null, history: [], memories: [] };

describe('coach edits and near-duplicates (Ben, 23 Oct)', () => {
  it('an add that near-duplicates one in the workout is flagged, not blocked', () => {
    const { snap, env } = world();
    expect(slotsOf(snap.workout.blocks).map((s) => s.exerciseId)).toContain('incline_db');
    const o = applyBuilderEdits(snap, [{ op: 'add', exerciseId: 'incline_bb', afterSlotKey: null, workingSets: 3 }], env);
    expect(o.lines).toEqual(['Add Incline barbell press']);
    expect(o.nearDuplicates).toEqual([['Incline dumbbell press', 'Incline barbell press']]);
    expect(o.warnings.some((w) => /^⚠ Not recommended: Incline (barbell|dumbbell) press and Incline (barbell|dumbbell) press are the same movement for the same muscle: one is enough\.$/.test(w))).toBe(true);
  });

  it('a swap of one twin for the other is no new near-duplicate; an unrelated add has none', () => {
    const { snap, env, key } = world();
    expect(applyBuilderEdits(snap, [{ op: 'swap', slotKey: key('incline_db'), toExerciseId: 'incline_bb' }], env).nearDuplicates).toEqual([]);
    expect(applyBuilderEdits(snap, [{ op: 'add', exerciseId: 'hammer', afterSlotKey: null, workingSets: 3 }], env).nearDuplicates).toEqual([]);
  });

  it('the review and edit requests carry the rule (COACHING KNOWLEDGE, not Your data)', () => {
    const { snap, ctx } = world();
    const view = builderWorkoutView(snap, ctx, 55);
    for (const req of [buildReviewRequest(view, extras, [], 'm'), buildEditRequest(view, extras, 'add another chest exercise', 'm')]) {
      const texts = req.input.flatMap((x) => (x.type === 'message' && typeof x.content === 'string' ? [x.content] : []));
      const knowledge = texts.find((t) => t.startsWith('COACHING KNOWLEDGE')) ?? '';
      expect(knowledge).toContain(JSON.stringify(NEAR_DUPLICATE_RULE).slice(1, -1));
      expect(texts.find((t) => t.startsWith('YOUR DATA')) ?? '').not.toContain('near-duplicate');
      expect(req.instructions).toMatch(/near-duplicate/);
    }
  });
});
