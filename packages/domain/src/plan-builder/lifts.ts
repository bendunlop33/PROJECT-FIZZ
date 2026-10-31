import type { PlanLiftCheck, WeightUnit } from '@fizz/schemas';
import { convertMass } from '../units';
import { toMs } from '../time';
import { inKitUnit, kitHasFormula, kitNearest, pbAt6, pbE1rm, type PlanKit } from './loads';
import { PB_BALANCE, PB_SIMILAR } from './tables';

/**
 * Check your lifts (§1a, D6). Pure. A main lift is `recent` (a set in the last 8 weeks), `stale` (none in 8 weeks),
 * or has no history: then an estimate from his closest similar lift (est.), or nothing. Week 1 starts from the same
 * 6-rep estimate the page shows, a step lighter when estimated, or stale and not confirmed (`light`).
 */

export const PB_STALE_DAYS = 56;
const DAY_MS = 86_400_000;

/** One exercise's own record, from Ben's logs (imported history counts, §2). */
export interface PbHistory {
  /** The newest session's heaviest working set; null: never done. */
  last: { value: number; unit: WeightUnit; reps: number; atUtc: string } | null;
  /** Sessions with it, older ones (beyond 8 weeks) counting half. */
  sessions: number;
  /** Times it was skipped or swapped out. */
  skips: number;
}

export type PbKitOf = (key: string) => PlanKit | 'bodyweight' | null;
export type PbHistoryOf = (key: string) => PbHistory | null;

export type PbLiftFrom =
  | { kind: 'history'; value: number; unit: WeightUnit; reps: number; atUtc: string }
  | { kind: 'entered'; value: number; unit: WeightUnit; reps: number }
  | { kind: 'similar'; fromKey: string; value: number; unit: WeightUnit; reps: number; index: number };

export interface PbLiftStart {
  key: string;
  /** The unit of `six` and `oneRm` (the lift's item here). */
  unit: WeightUnit;
  status: 'recent' | 'stale' | 'confirmed' | 'entered' | 'estimated' | 'none';
  /** The 6-rep weight (kit unit); null: nothing to go on. */
  six: number | null;
  /** Est. 1RM, nearest achievable (kit unit); null: nothing. */
  oneRm: number | null;
  /** An estimate (rule 6, shown est.). */
  estimate: boolean;
  /** Week 1 goes one achievable step lighter. */
  light: boolean;
  /** Ben should look at it: stale and not confirmed, or no history and not entered. */
  open: boolean;
  from: PbLiftFrom | null;
  /** The similar lifts it can be estimated from here, best first (`Other lift`). */
  sources: { index: number; fromKey: string; value: number; unit: WeightUnit; reps: number; six: number | null }[];
}

export function pbIsStale(atUtc: string, nowMs: number): boolean {
  return nowMs - toMs(atUtc) > PB_STALE_DAYS * DAY_MS;
}

/** The similar-lift estimates for `key` at its kit, in the table's order, each from a source with history. */
function sources(key: string, kit: PlanKit, historyOf: PbHistoryOf): PbLiftStart['sources'] {
  const out: PbLiftStart['sources'] = [];
  for (const [index, s] of (PB_SIMILAR[key] ?? []).entries()) {
    const h = historyOf(s.from)?.last ?? null;
    if (h === null || !(h.value > 0)) continue;
    const e1 = inKitUnit(kit, pbE1rm(h.value, h.reps) * s.f, h.unit);
    out.push({ index, fromKey: s.from, value: h.value, unit: h.unit, reps: h.reps, six: kitNearest(kit, e1 / 1.2) });
  }
  return out;
}

/** Where a main lift starts (§1a, D6). Null when it isn't loadable here (bodyweight, assisted, not at this gym). */
export function pbLiftStart(key: string, kitOf: PbKitOf, historyOf: PbHistoryOf, check: PlanLiftCheck | undefined, nowMs: number): PbLiftStart | null {
  const kit = kitOf(key);
  if (kit === null || kit === 'bodyweight' || !kitHasFormula(kit)) return null;
  const src = sources(key, kit, historyOf);
  const one = (kg: number, reps: number, unit: WeightUnit): number | null => kitNearest(kit, inKitUnit(kit, pbE1rm(kg, reps), unit));
  if (check?.kind === 'entered') {
    const kg = inKitUnit(kit, check.value, check.unit);
    return { key, unit: kit.unit, status: 'entered', six: pbAt6(kit, kg, check.reps), oneRm: one(check.value, check.reps, check.unit), estimate: false, light: false, open: false, from: { kind: 'entered', value: check.value, unit: check.unit, reps: check.reps }, sources: src };
  }
  const last = historyOf(key)?.last ?? null;
  if (last !== null && last.value > 0) {
    const stale = pbIsStale(last.atUtc, nowMs);
    const confirmed = stale && check?.kind === 'confirmed';
    const kg = inKitUnit(kit, last.value, last.unit);
    return {
      key,
      unit: kit.unit,
      status: confirmed ? 'confirmed' : stale ? 'stale' : 'recent',
      six: pbAt6(kit, kg, last.reps),
      oneRm: one(last.value, last.reps, last.unit),
      estimate: false,
      light: stale && !confirmed,
      open: stale && !confirmed,
      from: { kind: 'history', ...last },
      sources: src,
    };
  }
  const want = check?.kind === 'similar' ? check.source : null;
  const pick = (want === null ? undefined : src.find((s) => s.index === want)) ?? src[0];
  if (pick === undefined || pick.six === null) return { key, unit: kit.unit, status: 'none', six: null, oneRm: null, estimate: false, light: false, open: true, from: null, sources: src };
  return {
    key,
    unit: kit.unit,
    status: 'estimated',
    six: pick.six,
    oneRm: kitNearest(kit, pick.six * 1.2),
    estimate: true,
    light: true,
    // An estimate Ben picked (`Use` / `Other lift`) needs nothing more; an untouched one still shows the amber dot.
    open: check?.kind !== 'similar',
    from: { kind: 'similar', fromKey: pick.fromKey, value: pick.value, unit: pick.unit, reps: pick.reps, index: pick.index },
    sources: src,
  };
}

/** Check your lifts is shown only when a main lift has no history or none in 8 weeks (§1a). */
export function pbNeedsLiftCheck(lifts: readonly (PbLiftStart | null)[]): boolean {
  return lifts.some((l) => l !== null && (l.status === 'stale' || l.status === 'none' || l.status === 'estimated'));
}

export type PbBalanceWord = 'Below' | 'In range' | 'Above';

/** Strength balance (§1a): each lift's est. 1RM ÷ bench's against its usual band; bench against the band the others imply. */
export function pbStrengthBalance(lifts: readonly PbLiftStart[], benchKey = 'barbell-bench-press'): { key: string; ratio: number | null; word: PbBalanceWord }[] {
  // In kg throughout, so a lift on a lb item compares with bench on a kg bar.
  const e1 = (l: PbLiftStart): number | null => (l.six === null ? null : (l.unit === 'kg' ? l.six : convertMass({ value: l.six, unit: l.unit }, 'kg').value) * 1.2);
  const bench = lifts.find((l) => l.key === benchKey);
  const b = bench === undefined ? null : e1(bench);
  if (b === null || !(b > 0)) return [];
  const word = (v: number, lo: number, hi: number): PbBalanceWord => (v < lo ? 'Below' : v > hi ? 'Above' : 'In range');
  const others = lifts.flatMap((l) => {
    const band = PB_BALANCE[l.key];
    const v = e1(l);
    if (l.key === benchKey || band === undefined || v === null) return [];
    // Per-hand dumbbells: the band is per hand (DB shoulder press 0.22–0.30 × bench).
    const r = v / b;
    return [{ key: l.key, ratio: r, word: word(r, band[0], band[1]), lo: v / band[1], hi: v / band[0] }];
  });
  if (others.length === 0) return [];
  const lo = others.reduce((t, o) => t + o.lo, 0) / others.length;
  const hi = others.reduce((t, o) => t + o.hi, 0) / others.length;
  return [{ key: benchKey, ratio: null, word: word(b, lo, hi) }, ...others.map((o) => ({ key: o.key, ratio: o.ratio, word: o.word }))];
}
