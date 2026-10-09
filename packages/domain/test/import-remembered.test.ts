import { describe, expect, it } from 'vitest';
import type { AliasTarget, ExerciseAlias } from '@fizz/schemas';
import { aliasUses, rememberedAnswer, rememberedAnswers } from '../src';

/** What earlier imports still say about a name: Undo import takes back what that import taught (review r5 S2). */
const A = '00000000-0000-4000-8000-00000000a001';
const B = '00000000-0000-4000-8000-00000000a002';
const C = '00000000-0000-4000-8000-00000000a003';
const row: AliasTarget = { kind: 'exercise', exerciseId: '00000000-0000-4000-8000-00000000e001' };
const curl: AliasTarget = { kind: 'exercise', exerciseId: '00000000-0000-4000-8000-00000000e002' };
type Stored = Pick<ExerciseAlias, 'nameKey' | 'target' | 'perHand' | 'jobId' | 'uses'>;

describe('remembered answers (review r5 S2)', () => {
  it('an alias stored before uses were kept counts as one use by the import that wrote it', () => {
    expect(aliasUses({ target: row, perHand: 'one', jobId: A })).toEqual([{ jobId: A, target: row, perHand: 'one' }]);
    expect(aliasUses({ target: row, jobId: A })).toEqual([{ jobId: A, target: row }]);
    expect(rememberedAnswer({ target: row, perHand: 'one', jobId: A }, new Set([A]))).toBeNull();
  });

  it('the newest use still in effect gives the exercise; the newest one that said anything gives the dumbbell answer', () => {
    const alias: Stored = {
      nameKey: 'zottman curl',
      target: curl,
      perHand: 'both',
      jobId: C,
      uses: [
        { jobId: A, target: row, perHand: 'one' },
        { jobId: B, target: curl, perHand: 'both' },
        { jobId: C, target: curl },
      ],
    };
    expect(rememberedAnswer(alias, new Set())).toEqual({ target: curl, perHand: 'both' });
    // B undone: its "both" is taken back; A's "one" applies again (C said nothing about the dumbbells).
    expect(rememberedAnswer(alias, new Set([B]))).toEqual({ target: curl, perHand: 'one' });
    // B and C undone: A's exercise and answer.
    expect(rememberedAnswer(alias, new Set([B, C]))).toEqual({ target: row, perHand: 'one' });
    // Every import that taught it undone: nothing remembered, so the name is matched or asked again (DX6).
    expect(rememberedAnswer(alias, new Set([A, B, C]))).toBeNull();
  });

  it('an answer Ben cleared stays cleared; an undone clear brings the earlier answer back', () => {
    const alias: Stored = {
      nameKey: 'dumbbell row',
      target: row,
      jobId: B,
      uses: [
        { jobId: A, target: row, perHand: 'one' },
        { jobId: B, target: row, perHand: null },
      ],
    };
    expect(rememberedAnswer(alias, new Set())).toEqual({ target: row, perHand: null });
    expect(rememberedAnswer(alias, new Set([B]))).toEqual({ target: row, perHand: 'one' });
  });

  it('builds the context’s names and dumbbell answers, leaving out what undone imports taught', () => {
    const stored: Stored[] = [
      { nameKey: 'front dumbbell raise', target: curl, jobId: A, uses: [{ jobId: A, target: curl }] },
      { nameKey: 'zottman curl', target: curl, perHand: 'both', jobId: B, uses: [{ jobId: A, target: curl, perHand: 'one' }, { jobId: B, target: curl, perHand: 'both' }] },
      { nameKey: 'zumba', target: { kind: 'skip' }, jobId: B, uses: [{ jobId: B, target: { kind: 'skip' } }] },
    ];
    const all = rememberedAnswers(stored, new Set());
    expect([...all.aliases.keys()]).toEqual(['front dumbbell raise', 'zottman curl', 'zumba']);
    expect([...all.perHandAnswers]).toEqual([['zottman curl', 'both']]);
    const undoneB = rememberedAnswers(stored, new Set([B]));
    expect([...undoneB.aliases.keys()]).toEqual(['front dumbbell raise', 'zottman curl']);
    expect([...undoneB.perHandAnswers]).toEqual([['zottman curl', 'one']]);
    const undoneA = rememberedAnswers(stored, new Set([A]));
    expect([...undoneA.aliases.keys()]).toEqual(['zottman curl', 'zumba']);
    expect([...undoneA.perHandAnswers]).toEqual([['zottman curl', 'both']]);
  });
});
