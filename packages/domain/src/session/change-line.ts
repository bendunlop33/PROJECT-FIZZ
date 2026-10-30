import type { CoachTarget, Load, RepRange } from '@fizz/schemas';

import { formatNumber, repRangeText, rirOfRpe } from '../display';

/**
 * (Ben, 30 Oct; redesign-27oct §E2) One `Next time` change as one line: from → to. Pure presentation of values that
 * already exist (the last working target and the next one); it never decides a change.
 */

/** One side of a change: the target and its working-set count (null: not known, sets aren't shown). */
export interface ChangeSide {
  target: CoachTarget;
  sets: number | null;
  /** An `added` load on a plate-loaded machine: the plates, not `BW +` (reads `kg`, never `+`). */
  plates?: true;
}

export interface FromToLine {
  /** `100 → 102.5 kg`, `3×10 → 3×12`, `24 → 26 kg ea`, `100×5 → 102.5×5 kg`, `3 → 4 sets`; or the target alone. */
  text: string;
  /** VoiceOver: `100 to 102.5 kilograms`. */
  spoken: string;
  /** Nothing differs between the sides (or there is no `from`): `text` is the target alone. */
  same: boolean;
}

const ARROW = ' → ';

/** A piece of a line, shown and spoken. */
export interface LineText {
  text: string;
  spoken: string;
}
type Num = LineText;

function isBodyweight(load: Load | null): boolean {
  return load === null || load.convention === 'bodyweight';
}

/** The number as shown with its sign: `102.5`, `+10` for an added load (not plates). */
function num(load: Load, plates: boolean): Num {
  const n = formatNumber(load.value);
  if (load.convention === 'added' && !plates) return { text: `+${n}`, spoken: `plus ${n}` };
  return { text: n, spoken: n };
}

/** The unit and convention after the numbers: `kg`, `lb`, `kg ea`, `kg assist`. Always explicit (CLAUDE.md). */
function unit(load: Load): Num {
  const word = load.unit === 'kg' ? 'kilograms' : 'pounds';
  switch (load.convention) {
    case 'per_hand':
      return { text: `${load.unit} ea`, spoken: `${word} each` };
    case 'assistance':
      return { text: `${load.unit} assist`, spoken: `${word} of assistance` };
    case 'total':
    case 'stack':
    case 'added':
    case 'bodyweight':
      return { text: load.unit, spoken: word };
  }
}

function reps(r: RepRange): Num {
  return { text: repRangeText(r), spoken: r.min === r.max ? String(r.min) : `${String(r.min)} to ${String(r.max)}` };
}

function sameReps(a: RepRange | null, b: RepRange | null): boolean {
  return (a === null && b === null) || (a !== null && b !== null && a.min === b.min && a.max === b.max);
}

function sameUnit(a: Load, b: Load): boolean {
  return a.unit === b.unit && a.convention === b.convention;
}

/** A target on its own: `102.5×5 kg`, `26×10 kg ea`, `12 reps`, `BW`. */
function alone(t: CoachTarget, plates: boolean): Num {
  const r = t.reps === null ? null : reps(t.reps);
  if (isBodyweight(t.load) || t.load === null) return r === null ? { text: 'BW', spoken: 'bodyweight' } : { text: `${r.text} reps`, spoken: `${r.spoken} reps` };
  const n = num(t.load, plates);
  const u = unit(t.load);
  if (r === null) return { text: `${n.text} ${u.text}`, spoken: `${n.spoken} ${u.spoken}` };
  return { text: `${n.text}×${r.text} ${u.text}`, spoken: `${n.spoken} ${u.spoken} for ${r.spoken}` };
}

function rir(t: CoachTarget): Num | null {
  if (t.rpe == null) return null;
  const v = formatNumber(rirOfRpe(t.rpe));
  return { text: `RIR ${v}`, spoken: `RIR ${v}` };
}

function join(parts: readonly (Num | null)[]): Num {
  const kept = parts.filter((p): p is Num => p !== null);
  return { text: kept.map((p) => p.text).join(' · '), spoken: kept.map((p) => p.spoken).join(', ') };
}

/**
 * `from → to` in the fewest words. Only what changed is named: load only `100 → 102.5 kg`; reps only `3×10 → 3×12`
 * (with the set count when known, else `8 → 10 reps`); sets only `3 → 4 sets`; load and reps `100×5 → 102.5×6 kg`.
 * A set change beside a load change adds ` · 4 sets`. A changed target RIR adds ` · RIR 2`. Different units or
 * conventions on the two sides spell both sides in full. With no `from`, or nothing different, the target alone.
 */
export function fromToLine(from: ChangeSide | null, to: ChangeSide): FromToLine {
  const t = to.target;
  const plates = to.plates === true;
  const effort = from !== null && (t.rpe ?? null) !== (from.target.rpe ?? null) ? rir(t) : null;
  if (from === null) {
    const a = join([alone(t, plates), rir(t)]);
    return { ...a, same: true };
  }
  const f = from.target;
  const fl = isBodyweight(f.load) ? null : f.load;
  const tl = isBodyweight(t.load) ? null : t.load;
  // Loads on both sides that can't be compared as numbers (kg → lb, plates → stack, none → some) or a rep target
  // on one side only: both sides in full.
  const loadsComparable = (fl === null && tl === null) || (fl !== null && tl !== null && sameUnit(fl, tl));
  const repsComparable = (f.reps === null) === (t.reps === null);
  if (!loadsComparable || !repsComparable) {
    const a = alone(f, from.plates === true);
    const b = alone(t, plates);
    const sets = from.sets !== null && to.sets !== null && from.sets !== to.sets ? { text: `${String(to.sets)} sets`, spoken: `${String(to.sets)} sets` } : null;
    const line = join([{ text: `${a.text}${ARROW}${b.text}`, spoken: `${a.spoken} to ${b.spoken}` }, sets, effort]);
    return { ...line, same: false };
  }
  const loadChanged = fl !== null && tl !== null && fl.value !== tl.value;
  const repsChanged = !sameReps(f.reps, t.reps);
  const setsChanged = from.sets !== null && to.sets !== null && from.sets !== to.sets;
  if (!loadChanged && !repsChanged && !setsChanged && effort === null) return { ...alone(t, plates), same: true };
  const ranged = (f.reps !== null && f.reps.min !== f.reps.max) || (t.reps !== null && t.reps.min !== t.reps.max);
  // A range is said `6 to 8`, so the arrow is a pause then `to` when either side has one.
  const arrowSpoken = ranged ? ', to ' : ' to ';
  const setsPart: Num = { text: `${String(to.sets ?? 0)} sets`, spoken: `${String(to.sets ?? 0)} sets` };
  if (fl !== null && tl !== null && fl.value !== tl.value) {
    const a = num(fl, from.plates === true);
    const b = num(tl, plates);
    const u = unit(tl);
    const main: Num =
      repsChanged && f.reps !== null && t.reps !== null
        ? { text: `${a.text}×${reps(f.reps).text}${ARROW}${b.text}×${reps(t.reps).text} ${u.text}`, spoken: `${a.spoken} for ${reps(f.reps).spoken}${arrowSpoken}${b.spoken} for ${reps(t.reps).spoken} ${u.spoken}` }
        : { text: `${a.text}${ARROW}${b.text} ${u.text}`, spoken: `${a.spoken} to ${b.spoken} ${u.spoken}` };
    return { ...join([main, setsChanged ? setsPart : null, effort]), same: false };
  }
  if (repsChanged && f.reps !== null && t.reps !== null) {
    const ra = reps(f.reps);
    const rb = reps(t.reps);
    const main: Num =
      from.sets !== null && to.sets !== null
        ? { text: `${String(from.sets)}×${ra.text}${ARROW}${String(to.sets)}×${rb.text}`, spoken: `${String(from.sets)} sets of ${ra.spoken}${arrowSpoken}${String(to.sets)} sets of ${rb.spoken}` }
        : { text: `${ra.text}${ARROW}${rb.text} reps`, spoken: `${ra.spoken}${arrowSpoken}${rb.spoken} reps` };
    return { ...join([main, effort]), same: false };
  }
  if (setsChanged && from.sets !== null && to.sets !== null) {
    const main: Num = { text: `${String(from.sets)}${ARROW}${String(to.sets)} sets`, spoken: `${String(from.sets)} to ${String(to.sets)} sets` };
    return { ...join([main, effort]), same: false };
  }
  // Only the target RIR changed.
  return { ...join([alone(t, plates), effort]), same: false };
}

/**
 * (Ben, 30 Oct) An exercise's `Exercises done` line from its counted working sets: `3×8 @ 80 kg` when every set was
 * the same, `8, 8, 7 @ 80 kg` at one load, else `4 sets · best 102.5×5 kg`; bodyweight `3×15` / `15, 12, 10`. Null
 * when the sets can't be said this way (no reps, mixed units or conventions): the caller keeps the full results.
 */
export function doneLine(sets: readonly { load: Load | null; reps: number | null }[], o: { plates?: boolean; direction: 'resistance' | 'assistance' }): LineText | null {
  if (sets.length === 0 || sets.some((s) => s.reps === null)) return null;
  const repsOf = sets.map((s) => s.reps ?? 0);
  const allReps = repsOf.every((r) => r === repsOf[0]);
  const n = String(sets.length);
  const repsList = { text: repsOf.map(String).join(', '), spoken: repsOf.map(String).join(', ') };
  const loads = sets.map((s) => (isBodyweight(s.load) ? null : s.load));
  if (loads.every((l) => l === null)) {
    return allReps ? { text: `${n}×${String(repsOf[0])}`, spoken: `${n} sets of ${String(repsOf[0])}` } : { text: repsList.text, spoken: `${repsList.spoken} reps` };
  }
  const first = loads[0];
  if (first == null || loads.some((l) => l === null || !sameUnit(l, first))) return null;
  const u = unit(first);
  const plates = o.plates === true;
  if (loads.every((l) => l?.value === first.value)) {
    const at = num(first, plates);
    if (allReps) return { text: `${n}×${String(repsOf[0])} @ ${at.text} ${u.text}`, spoken: `${n} sets of ${String(repsOf[0])} at ${at.spoken} ${u.spoken}` };
    return { text: `${repsList.text} @ ${at.text} ${u.text}`, spoken: `${repsList.spoken} reps at ${at.spoken} ${u.spoken}` };
  }
  // The best set: heaviest (least assisted), then most reps.
  let best = 0;
  sets.forEach((s, i) => {
    const a = s.load?.value ?? 0;
    const b = sets[best]?.load?.value ?? 0;
    const harder = o.direction === 'resistance' ? a > b : a < b;
    if (harder || (a === b && (s.reps ?? 0) > (sets[best]?.reps ?? 0))) best = i;
  });
  const top = sets[best];
  if (top?.load == null || top.reps === null) return null;
  const at = num(top.load, plates);
  return { text: `${n} sets · best ${at.text}×${String(top.reps)} ${u.text}`, spoken: `${n} sets, best ${at.spoken} ${u.spoken} for ${String(top.reps)}` };
}
