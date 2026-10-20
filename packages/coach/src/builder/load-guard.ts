import {
  BUILDER_SET_RULES,
  checkProposedLoad,
  compareDifficulty,
  getAchievableLoads,
  loadDirection,
  loadsByDifficulty,
  roundContextOf,
  roundDownHere,
  type BuilderContext,
  type BuilderSlot,
  type LoadReferences,
} from '@fizz/domain';

/**
 * The guardrail on every load the coach asks for in the builder (rule 3,
 * rule 4, rule 9; workout-builder-v3 §5 "Code checks"). Pure. A coach load
 * goes through `checkProposedLoad` (ceilings `capE` / `capLastTop` 1.2, one
 * more step only when Ben asked heavier, the pain hold) when there is
 * history, and is then rounded DOWN to what this gym can load (never past a
 * machine's max). A pain-flagged movement never gets heavier.
 */

export type GuardResult = { ok: true; value: number; notes: string[] } | { ok: false; note: string };

export interface BuilderLoadGuard {
  /** Check a working load (in the slot's unit) the coach asked for. */
  check(slot: BuilderSlot, requested: number, opts: { askedHeavier: boolean }): GuardResult;
  /** The working load `steps` steps heavier or lighter than `from` on this gym's item; null when there's none. */
  step(slot: BuilderSlot, from: number, dir: 'heavier' | 'lighter', steps: number): number | null;
}

export interface LoadGuardDeps {
  ctx: Pick<BuilderContext, 'loads'>;
  /** `loadReferences` for the exercise at today's gym (Ben's history), or null when none was read. */
  refs: (exerciseId: string) => LoadReferences | null;
  /** An active pain flag covering the movement (`shoulder flagged 6 Oct`), else null. */
  pain: (exerciseId: string) => string | null;
}

const EPS = 1e-6;
/** Free weights with no item to step on (added weight, a bodyweight lift's belt): 2.5 kg / 5 lb. */
const FREE_STEP = { kg: 2.5, lb: 5 } as const;

const fmt = (v: number): string => String(Math.round(v * 100) / 100);

export function createBuilderLoadGuard(deps: LoadGuardDeps): BuilderLoadGuard {
  const step = (slot: BuilderSlot, from: number, dir: 'heavier' | 'lighter', steps: number): number | null => {
    const input = deps.ctx.loads(slot.exerciseId);
    const rc = roundContextOf(input);
    const n = Math.max(1, Math.round(steps));
    if (rc.equipment !== null) {
      const ordered = loadsByDifficulty(getAchievableLoads(rc.equipment));
      if (ordered.length === 0) return null;
      const d = loadDirection(rc.convention);
      // The easiest-to-hardest index of the load now (or the hardest one no harder than it).
      let at = -1;
      for (let i = 0; i < ordered.length; i += 1) if (compareDifficulty(ordered[i] ?? 0, from, d) <= EPS) at = i;
      const next = dir === 'heavier' ? (at < 0 ? 0 : at + n) : at - n;
      if (next < 0 || next >= ordered.length) return null;
      return ordered[next] ?? null;
    }
    if (rc.free) {
      const s = FREE_STEP[rc.unit] * n;
      const v = dir === 'heavier' ? from + s : from - s;
      return v < 0 ? null : v;
    }
    return null;
  };

  const check = (slot: BuilderSlot, requested: number, opts: { askedHeavier: boolean }): GuardResult => {
    const input = deps.ctx.loads(slot.exerciseId);
    const rc = roundContextOf(input);
    const pain = deps.pain(slot.exerciseId);
    const now = topLoad(slot);
    const d = loadDirection(rc.convention);
    if (pain !== null && now !== null && compareDifficulty(requested, now, d) > EPS) return { ok: false, note: `Not heavier: ${pain}` };
    const notes: string[] = [];
    let value = requested;
    const refs = deps.refs(slot.exerciseId);
    if (refs !== null && refs.convention === rc.convention && refs.unit === rc.unit) {
      const working = slot.rows.find((r) => r.type !== 'warmup');
      const c = checkProposedLoad(
        { value: requested, unit: rc.unit, convention: rc.convention, basis: null },
        { repsMin: working?.reps ?? slot.repRange.min, repsMax: Math.max(working?.reps ?? slot.repRange.max, slot.repRange.max), targetRpe: working?.rpe ?? BUILDER_SET_RULES.workRpe },
        refs,
        { pain: pain === null ? null : { text: pain }, askedHeavier: opts.askedHeavier },
      );
      if ((c.source === 'coach' || c.source === 'coach_est') && c.load !== null) {
        // The check may round to the nearest load; the builder only ever rounds DOWN from what was asked (§3.1).
        value = compareDifficulty(c.load.value, requested, d) > 0 ? requested : c.load.value;
        notes.push(...c.notes.filter((n) => !n.includes('→') && !n.includes('converted')));
      } else {
        return { ok: false, note: `Not changed: ${c.notes[0] ?? 'no reference for that load'}` };
      }
    }
    // Rule 4: down to what this gym can load, never past the item's max; the pain hold caps it (rule 9).
    const r = roundDownHere(value, rc);
    if (r === null) return { ok: false, note: 'Not changed: no weight this light here' };
    if (r.bounded === 'max') notes.push(`capped at machine max ${fmt(r.value)} ${r.unit}`);
    if (r.capped === 'pain' && pain !== null) notes.push(`held · ${pain}`);
    return { ok: true, value: r.value, notes };
  };

  return { check, step };
}

/** A slot's working (top) load: its Top set, else its first working set. */
export function topLoad(slot: Pick<BuilderSlot, 'rows'>): number | null {
  const t = slot.rows.find((r) => r.type === 'top') ?? slot.rows.find((r) => r.type !== 'warmup');
  return t?.load ?? null;
}
