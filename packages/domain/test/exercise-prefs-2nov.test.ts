import { describe, expect, it } from 'vitest';

import type { PlanBuilderAnswers, PlanDraft } from '@fizz/schemas';

import { applyPlan, buildPlanFromAnswers, pbExercisePreferenceOf, pbNotPreferred, pbNewPlanDraft, pbPlanPrefParts, pbSetExercisePreference, pbSetPlanPrefs, type PbPrefParts } from '../src/index';
import { OWNER, TZ } from './fixtures';
import { HISTORY_OF, KIT_OF, NOW, answers } from './plan-builder-fixture';

/**
 * (Ben, 2 Nov: "I don't like leg extensions, take them out") One exercise's preference on Any preferences (the plan in
 * use's builder answers), set or cleared, and written on the plan with its own versioned Undo.
 */

const LE = 'machine-leg-extension';
const SS = 'dumbbell-bulgarian-split-squat';
const parts = (over: Partial<PbPrefParts> = {}): PbPrefParts => ({ prefs: {}, likes: [], never: [], ...over });
const set = (a: PbPrefParts, key: string, pref: 'not_preferred' | 'preferred' | 'none'): PbPrefParts => {
  const r = pbSetExercisePreference(a, key, pref);
  if (r.kind !== 'ok') throw new Error(r.kind);
  return r.parts;
};

describe('pbSetExercisePreference', () => {
  it('not preferred: into never; nothing else becomes preferred or not preferred', () => {
    const after = set(parts(), LE, 'not_preferred');
    expect(after).toEqual({ prefs: {}, likes: [], never: [LE] });
    expect(pbExercisePreferenceOf(after, LE)).toBe('not_preferred');
    expect(pbExercisePreferenceOf(after, SS)).toBe('none');
  });

  it('not preferred when his own pick holds it (Quad extra → Leg extension): the question goes back to No preference', () => {
    const after = set(parts({ prefs: { quads: 0 } }), LE, 'not_preferred');
    expect(after.prefs.quads).toBe('either');
    expect(pbNotPreferred(after)).toEqual(new Set([LE]));
    // A pick of two exercises (Hips → In/out machines): the other one stays liked.
    const hips = set(parts({ prefs: { hips: 1 } }), 'machine-hip-adduction', 'not_preferred');
    expect(hips).toEqual({ prefs: { hips: 'either' }, likes: ['machine-hip-abduction'], never: ['machine-hip-adduction'] });
    expect(pbExercisePreferenceOf(hips, 'machine-hip-abduction')).toBe('preferred');
  });

  it('preferred: into likes, out of never; a like beats an unpicked option', () => {
    expect(set(parts({ never: [LE] }), LE, 'preferred')).toEqual({ prefs: {}, likes: [LE], never: [] });
    const liked = set(parts({ prefs: { quads: 1 } }), LE, 'preferred');
    expect(pbExercisePreferenceOf(liked, LE)).toBe('preferred');
    expect(liked.prefs.quads).toBe(1);
  });

  it('none (clear): out of never and likes; an other pick that made it not preferred goes back to No preference, that pick still liked', () => {
    expect(set(parts({ never: [LE] }), LE, 'none')).toEqual({ prefs: {}, likes: [], never: [] });
    const cleared = set(parts({ prefs: { quads: 1 } }), LE, 'none');
    expect(cleared).toEqual({ prefs: { quads: 'either' }, likes: [SS], never: [] });
    expect(pbExercisePreferenceOf(cleared, LE)).toBe('none');
    expect(pbExercisePreferenceOf(cleared, SS)).toBe('preferred');
  });

  it('already so: nothing to write; past the limit: refused', () => {
    expect(pbSetExercisePreference(parts({ never: [LE] }), LE, 'not_preferred')).toEqual({ kind: 'already' });
    expect(pbSetExercisePreference(parts({ prefs: { quads: 1 } }), LE, 'not_preferred')).toEqual({ kind: 'already' });
    expect(pbSetExercisePreference(parts(), LE, 'none')).toEqual({ kind: 'already' });
    const full = parts({ never: Array.from({ length: 30 }, (_, i) => `x-${String(i)}`) });
    expect(pbSetExercisePreference(full, LE, 'not_preferred')).toEqual({ kind: 'too_many' });
  });
});

describe('pbSetPlanPrefs: one versioned write on the plan in use, its Undo only from what it left', () => {
  const op = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const at = { utc: '2026-11-02T09:00:00.000Z', tz: TZ };
  function plan(over: Partial<PlanBuilderAnswers> = {}): PlanDraft {
    const a = answers({ split: 'ppl', sessions: 6, schedule: 'set', days: [0, 1, 2, 3, 4, 5], ...over });
    const built = buildPlanFromAnswers({ answers: a, profileSplit: null, kitOf: KIT_OF, historyOf: HISTORY_OF, nowMs: NOW });
    const p = pbNewPlanDraft({ plan: built, answers: a, kitOf: KIT_OF, ownerId: OWNER, gymId: null, equipmentVersion: 'v1', opId: op(1), at });
    const r = applyPlan(p, { expectedVersion: p.version, versionN: p.currentVersion, mode: 'replace', opId: op(2), at, live: [], applied: [] });
    if (r.kind !== 'write') throw new Error(r.kind);
    return r.next;
  }

  it('writes the preferences on the version read, days untouched; a repeat is a duplicate; a stale version is refused', () => {
    const p = plan();
    const before = pbPlanPrefParts(p);
    if (before === null) throw new Error('not a builder plan');
    const after = set(before, LE, 'not_preferred');
    const w = pbSetPlanPrefs(p, { expectedVersion: p.version, opId: op(3), at, parts: after });
    if (w.kind !== 'write') throw new Error(w.kind);
    expect(w.next.version).toBe(p.version + 1);
    expect(pbPlanPrefParts(w.next)).toEqual(after);
    expect(w.next.versions.map((v) => v.days)).toEqual(p.versions.map((v) => v.days));
    expect(pbSetPlanPrefs(w.next, { expectedVersion: w.next.version, opId: op(3), at, parts: after }).kind).toBe('duplicate');
    // Rule 5: written on a version that isn't the one read: refused.
    expect(pbSetPlanPrefs(w.next, { expectedVersion: p.version, opId: op(4), at, parts: after }).kind).toBe('stale');
    // Undo: back only while the preferences are as the change left them.
    const undo = pbSetPlanPrefs(w.next, { expectedVersion: null, opId: op(5), at, parts: before, onlyIf: after });
    if (undo.kind !== 'write') throw new Error(undo.kind);
    expect(pbPlanPrefParts(undo.next)).toEqual(before);
    const moved = set(after, 'machine-leg-press', 'not_preferred');
    const changed = pbSetPlanPrefs(w.next, { expectedVersion: null, opId: op(6), at, parts: moved });
    if (changed.kind !== 'write') throw new Error(changed.kind);
    expect(pbSetPlanPrefs(changed.next, { expectedVersion: null, opId: op(7), at, parts: before, onlyIf: after }).kind).toBe('stale');
  });
});
