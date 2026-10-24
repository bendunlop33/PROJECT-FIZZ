import { canPair, infoOrDefault, sharedMuscle } from './arrange';
import { nearDuplicateIds } from './similar';
import type { BuilderInfoLookup, BuilderSlot } from './types';

/**
 * What the checks read of a workout: its rounds in order, each with its
 * exercises (a builder block, or the active workout's rounds still to do,
 * keyed by session row; workout-table-v3 §7).
 */
export interface AdviceBlock {
  slots: readonly Pick<BuilderSlot, 'key' | 'exerciseId'>[];
}

/**
 * "Not recommended" checks (workout-builder-v3 §3.8). Fixed, offline, each
 * with a one-line reason and a fix. Advice never blocks or undoes Ben's
 * change; the UI shows the first NEW item after his edit as a toast.
 */

export type BuilderAdvice =
  | { kind: 'isolation_first'; key: string; isolation: AdviceRef; compound: AdviceRef; muscle: string; reason: string; fix: { kind: 'move_first'; slotKey: string; label: string } }
  | { kind: 'heavy_pair'; key: string; a: AdviceRef; b: AdviceRef; reason: string; fix: { kind: 'unlink'; slotKey: string; label: string } }
  | { kind: 'abs_heavy'; key: string; a: AdviceRef; b: AdviceRef; reason: string; fix: { kind: 'unlink'; slotKey: string; label: string } }
  | { kind: 'shared_muscle'; key: string; a: AdviceRef; b: AdviceRef; muscle: string; reason: string; fix: { kind: 'unlink'; slotKey: string; label: string } }
  /** (Ben, 23 Oct) Two near-duplicates in one workout (`nearDuplicate`): advice only, Ben may keep both. */
  | { kind: 'near_duplicate'; key: string; a: AdviceRef; b: AdviceRef; reason: string; fix: { kind: 'remove'; slotKey: string; label: string } };

export interface AdviceRef {
  slotKey: string;
  exerciseId: string;
  name: string;
}

/** §3.8 reason lines. */
export const ADVICE_TEXT = {
  isolationFirst: (muscle: string) => `It tires your ${muscle} before the heavier lift.`,
  heavyPair: 'Two heavy lifts back to back: both get weaker and form slips.',
  absHeavy: 'Ab work between sets tires the bracing that protects your lower back.',
  sharedMuscle: (muscle: string) => `Both work your ${muscle}, so the second one suffers.`,
  moveFirst: (name: string) => `Move ${name} first`,
  unlinkNamed: (name: string) => `Unlink ${name}`,
  unlink: 'Unlink',
  nearDuplicate: (a: string, b: string) => `${a} and ${b} are the same movement for the same muscle: one is enough.`,
  removeNamed: (name: string) => `Remove ${name}`,
} as const;

/** `adviseBuilder`: every current "not recommended" item, in workout order. */
export function adviseBuilder(blocks: readonly AdviceBlock[], info: BuilderInfoLookup): BuilderAdvice[] {
  const out: BuilderAdvice[] = [];
  const flat = blocks.flatMap((b, bi) => b.slots.map((s) => ({ s, bi, i: infoOrDefault(info, s.exerciseId) })));
  const ref = (x: (typeof flat)[number]): AdviceRef => ({ slotKey: x.s.key, exerciseId: x.s.exerciseId, name: x.i.name });

  // Isolation before a compound for the same muscle (different blocks; abs aside).
  for (let a = 0; a < flat.length; a += 1) {
    for (let b = a + 1; b < flat.length; b += 1) {
      const x = flat[a];
      const y = flat[b];
      if (x === undefined || y === undefined || x.bi === y.bi) continue;
      if (x.i.role !== 'isolation' || y.i.role !== 'compound' || x.i.group === 'Core') continue;
      const muscle = x.i.muscles.find((m) => y.i.muscles.includes(m)) ?? (x.i.group === y.i.group ? x.i.group.toLowerCase() : null);
      if (muscle === null) continue;
      out.push({
        kind: 'isolation_first',
        key: `ord:${x.s.key}>${y.s.key}`,
        isolation: ref(x),
        compound: ref(y),
        muscle,
        reason: ADVICE_TEXT.isolationFirst(muscle),
        fix: { kind: 'move_first', slotKey: y.s.key, label: ADVICE_TEXT.moveFirst(y.i.name) },
      });
    }
  }

  // Supersets (pairs and bigger): heavy + heavy, abs + heavy, shared muscle.
  blocks.forEach((block) => {
    if (block.slots.length < 2) return;
    for (let a = 0; a < block.slots.length; a += 1) {
      for (let b = a + 1; b < block.slots.length; b += 1) {
        const p = block.slots[a];
        const q = block.slots[b];
        if (p === undefined || q === undefined) continue;
        const pi = infoOrDefault(info, p.exerciseId);
        const qi = infoOrDefault(info, q.exerciseId);
        const check = canPair({ ...p, main: false }, { ...q, main: false }, info);
        const A: AdviceRef = { slotKey: p.key, exerciseId: p.exerciseId, name: pi.name };
        const B: AdviceRef = { slotKey: q.key, exerciseId: q.exerciseId, name: qi.name };
        const key = `ss:${p.key}+${q.key}`;
        switch (check.reason) {
          case 'heavy_pair':
            out.push({ kind: 'heavy_pair', key, a: A, b: B, reason: ADVICE_TEXT.heavyPair, fix: { kind: 'unlink', slotKey: q.key, label: ADVICE_TEXT.unlinkNamed(qi.name) } });
            break;
          case 'abs_heavy':
            out.push({ kind: 'abs_heavy', key, a: A, b: B, reason: ADVICE_TEXT.absHeavy, fix: { kind: 'unlink', slotKey: q.key, label: ADVICE_TEXT.unlink } });
            break;
          case 'shared_muscle': {
            const muscle = check.muscle ?? sharedMuscle(pi, qi) ?? pi.group.toLowerCase();
            out.push({ kind: 'shared_muscle', key, a: A, b: B, muscle, reason: ADVICE_TEXT.sharedMuscle(muscle), fix: { kind: 'unlink', slotKey: q.key, label: ADVICE_TEXT.unlink } });
            break;
          }
          case 'main':
          case null:
            break;
        }
      }
    }
  });
  // (Ben, 23 Oct) Near-duplicates anywhere in the workout: the later one is the fix.
  for (let a = 0; a < flat.length; a += 1) {
    for (let b = a + 1; b < flat.length; b += 1) {
      const x = flat[a];
      const y = flat[b];
      if (x === undefined || y === undefined || !nearDuplicateIds(x.s.exerciseId, y.s.exerciseId, info)) continue;
      out.push({ kind: 'near_duplicate', key: `dup:${x.s.key}~${y.s.key}`, a: ref(x), b: ref(y), reason: ADVICE_TEXT.nearDuplicate(x.i.name, y.i.name), fix: { kind: 'remove', slotKey: y.s.key, label: ADVICE_TEXT.removeNamed(y.i.name) } });
    }
  }
  return out;
}

/** After Ben's own change: the first advice item that wasn't there before (null = nothing new). His change stays. */
export function adviseAfter(before: readonly BuilderAdvice[], after: readonly BuilderAdvice[]): BuilderAdvice | null {
  const keys = new Set(before.map((a) => a.key));
  return after.find((a) => !keys.has(a.key)) ?? null;
}
