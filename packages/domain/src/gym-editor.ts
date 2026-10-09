import { EquipmentInstanceSchema, validate, type EquipmentInstance, type PlateCount, type WeightUnit } from '@fizz/schemas';
import { formatNumber } from './display';
import { buildPlateSetup, getAchievableLoads } from './equipment';
import { fromScaled, toScaled } from './units';

/**
 * The minimal gym editor's rules (gym-editor.md §2.4, §5, §7), pure so the
 * screen never computes loads itself. A form is the editable shape of one
 * equipment item; `applyEquipmentForm` turns it back into a validated record
 * (never extrapolating past a max, rule 4). Every load number here is an
 * equipment capability in the item's own unit and convention, never a target.
 */

export interface RangeSpec {
  from: number | null;
  to: number | null;
  step: number | null;
}

export type EquipmentForm =
  | { kind: 'barbell'; name: string; unit: WeightUnit; barMass: number | null; plates: PlateCount[]; maxLoad: number | null }
  | { kind: 'plate_loaded_machine'; name: string; unit: WeightUnit; loadingSides: 1 | 2; plates: PlateCount[]; maxLoad: number | null }
  /** `missing`: values in the range that the rack doesn't have; `extra`: single weights outside it. */
  | { kind: 'dumbbells'; name: string; unit: WeightUnit; range: RangeSpec; missing: number[]; extra: number[] }
  /** `irregular`: the saved stack isn't one even range; kept as-is unless the range is edited. */
  | { kind: 'weight_stack'; name: string; unit: WeightUnit; range: RangeSpec; irregular: number[] | null; addOns: number[] }
  | { kind: 'assisted_stack'; name: string; unit: WeightUnit; range: RangeSpec; irregular: number[] | null }
  | { kind: 'bodyweight_station'; name: string; unit: WeightUnit };

export type EditableKind = EquipmentForm['kind'];

export const EQUIPMENT_KIND_LABEL: Record<EditableKind, string> = {
  barbell: 'Barbell and plates',
  dumbbells: 'Dumbbells',
  weight_stack: 'Cable or weight-stack machine',
  assisted_stack: 'Assisted pull-up / dip machine',
  plate_loaded_machine: 'Plate-loaded machine',
  bodyweight_station: 'Pull-up bar or dip bars',
};

const DEFAULT_PLATES: Record<WeightUnit, number[]> = { kg: [25, 20, 15, 10, 5, 2.5, 1.25], lb: [45, 35, 25, 10, 5, 2.5] };

/** A new, empty form of a kind (typical starting numbers, to be checked by Ben). */
export function newEquipmentForm(kind: EditableKind, unit: WeightUnit): EquipmentForm {
  const kg = unit === 'kg';
  switch (kind) {
    case 'barbell':
      return { kind, name: 'Barbell', unit, barMass: kg ? 20 : 45, plates: DEFAULT_PLATES[unit].map((mass) => ({ mass, count: 0 })), maxLoad: null };
    case 'plate_loaded_machine':
      return { kind, name: 'Plate-loaded machine', unit, loadingSides: 2, plates: DEFAULT_PLATES[unit].map((mass) => ({ mass, count: 0 })), maxLoad: null };
    case 'dumbbells':
      return { kind, name: 'Dumbbells', unit, range: kg ? { from: 2.5, to: 30, step: 2.5 } : { from: 5, to: 60, step: 5 }, missing: [], extra: [] };
    case 'weight_stack':
      return { kind, name: 'Cable station', unit, range: kg ? { from: 5, to: 100, step: 5 } : { from: 10, to: 200, step: 10 }, irregular: null, addOns: [] };
    case 'assisted_stack':
      return { kind, name: 'Assisted pull-up / dip machine', unit, range: kg ? { from: 5, to: 70, step: 5 } : { from: 10, to: 150, step: 10 }, irregular: null };
    case 'bodyweight_station':
      return { kind, name: 'Pull-up bar', unit };
  }
}

/** Ascending, unique values of a range; empty when the range is incomplete or invalid. Capped at 500 values. */
export function rangeValues(r: RangeSpec): number[] {
  if (r.from === null || r.to === null || r.step === null) return [];
  const a = toScaled(r.from);
  const b = toScaled(r.to);
  const s = toScaled(r.step);
  if (a <= 0 || s <= 0 || b < a || (b - a) / s > 499) return [];
  const out: number[] = [];
  for (let v = a; v <= b; v += s) out.push(fromScaled(v));
  return out;
}

function uniqueAscending(values: readonly number[]): number[] {
  return [...new Set(values.map(toScaled))].sort((x, y) => x - y).map(fromScaled);
}

/** The dumbbell rack's loads: the range minus missing weights, plus single weights (gym-editor §2.4.2). */
export function dumbbellLoads(form: Extract<EquipmentForm, { kind: 'dumbbells' }>): number[] {
  const missing = new Set(form.missing.map(toScaled));
  return uniqueAscending([...rangeValues(form.range).filter((v) => !missing.has(toScaled(v))), ...form.extra.filter((v) => v > 0)]);
}

/** If `values` is one even range, that range. */
function asRange(values: readonly number[]): RangeSpec | null {
  const first = values[0];
  const last = values.at(-1);
  if (first === undefined || last === undefined) return null;
  if (values.length === 1) return { from: first, to: last, step: first };
  const step = toScaled(values[1] ?? first) - toScaled(first);
  for (let i = 1; i < values.length; i += 1) if (toScaled(values[i] ?? 0) - toScaled(values[i - 1] ?? 0) !== step) return null;
  return { from: first, to: last, step: fromScaled(step) };
}

/** The most common gap between neighbouring values (the rack's usual step). */
function usualStep(values: readonly number[]): number | null {
  const counts = new Map<number, number>();
  for (let i = 1; i < values.length; i += 1) {
    const d = toScaled(values[i] ?? 0) - toScaled(values[i - 1] ?? 0);
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  let best: [number, number] | null = null;
  for (const [d, n] of counts) if (best === null || n > best[1] || (n === best[1] && d < best[0])) best = [d, n];
  return best === null ? null : fromScaled(best[0]);
}

export function formFromEquipment(eq: EquipmentInstance): EquipmentForm {
  const base = { name: eq.name, unit: eq.unit };
  switch (eq.kind) {
    case 'barbell':
      return { ...base, kind: 'barbell', barMass: eq.barMass, plates: eq.plates.map((p) => ({ ...p })), maxLoad: eq.maxLoad ?? null };
    case 'plate_loaded_machine':
      return { ...base, kind: 'plate_loaded_machine', loadingSides: eq.loadingSides, plates: eq.plates.map((p) => ({ ...p })), maxLoad: eq.maxLoad ?? null };
    case 'dumbbells': {
      const step = usualStep(eq.loads) ?? eq.loads[0] ?? 1;
      const from = eq.loads[0] ?? null;
      const to = eq.loads.at(-1) ?? null;
      const range: RangeSpec = { from, to, step };
      const full = new Set(rangeValues(range).map(toScaled));
      const have = new Set(eq.loads.map(toScaled));
      return {
        ...base,
        kind: 'dumbbells',
        range,
        missing: [...full].filter((v) => !have.has(v)).map(fromScaled),
        extra: eq.loads.filter((v) => !full.has(toScaled(v))),
      };
    }
    case 'weight_stack': {
      const r = asRange(eq.stackLoads);
      return { ...base, kind: 'weight_stack', range: r ?? { from: eq.stackLoads[0] ?? null, to: eq.stackLoads.at(-1) ?? null, step: null }, irregular: r ? null : [...eq.stackLoads], addOns: [...eq.addOns] };
    }
    case 'assisted_stack': {
      const r = asRange(eq.assistanceLoads);
      return { ...base, kind: 'assisted_stack', range: r ?? { from: eq.assistanceLoads[0] ?? null, to: eq.assistanceLoads.at(-1) ?? null, step: null }, irregular: r ? null : [...eq.assistanceLoads] };
    }
    case 'bodyweight_station':
      return { ...base, kind: 'bodyweight_station' };
  }
}

export interface EquipmentMeta {
  id: string;
  ownerId: string;
  gymId: string;
  atUtc: string;
}

export type ApplyFormResult = { ok: true; equipment: EquipmentInstance } | { ok: false; problems: string[] };

const unitWord = (u: WeightUnit) => u;

/**
 * Turn a form into a validated equipment record. `base` is the saved record
 * being edited (null = new). The result is a new version marked `Checked by
 * you` (`detailsSource: 'user'`). Problems use the spec's wording (§5).
 */
export function applyEquipmentForm(form: EquipmentForm, base: EquipmentInstance | null, meta: EquipmentMeta): ApplyFormResult {
  const problems: string[] = [];
  const name = form.name.trim();
  if (name === '') problems.push('Give it a name.');
  const common = {
    id: base?.id ?? meta.id,
    ownerId: base?.ownerId ?? meta.ownerId,
    gymId: base?.gymId ?? meta.gymId,
    version: base ? base.version + 1 : 1,
    createdAtUtc: base?.createdAtUtc ?? meta.atUtc,
    updatedAtUtc: meta.atUtc,
    name: name === '' ? 'Equipment' : name,
    unit: form.unit,
    movementTags: base?.movementTags ?? [],
    availability: base?.availability ?? ('available' as const),
    detailsSource: 'user' as const,
    checkedAtUtc: meta.atUtc,
    ...(base?.make !== undefined ? { make: base.make } : {}),
    ...(base?.model !== undefined ? { model: base.model } : {}),
    ...(base?.station !== undefined ? { station: base.station } : {}),
    ...(base?.notes !== undefined ? { notes: base.notes } : {}),
    ...(base?.minLoad !== undefined ? { minLoad: base.minLoad } : {}),
  };
  const plates = (list: readonly PlateCount[]) => {
    const kept = list.filter((p) => p.count > 0 && p.mass > 0);
    if (new Set(kept.map((p) => toScaled(p.mass))).size !== kept.length) problems.push('Each plate size can appear once.');
    return [...kept].sort((a, b) => b.mass - a.mass);
  };
  const range = (values: number[], what: string) => {
    if (values.length === 0) problems.push(`Add at least one ${what}. Check From, To and Every.`);
    return values;
  };
  let draft: unknown;
  switch (form.kind) {
    case 'barbell': {
      if (form.barMass === null || form.barMass < 0) problems.push('Enter the bar weight.');
      const bar = form.barMass ?? 0;
      if (form.maxLoad !== null && form.maxLoad < bar) problems.push(`Max is below the bar weight (${formatNumber(bar)} ${unitWord(form.unit)}).`);
      draft = { ...common, kind: 'barbell', loadConvention: 'total', barMass: bar, plates: plates(form.plates), ...(form.maxLoad === null ? {} : { maxLoad: form.maxLoad }) };
      break;
    }
    case 'plate_loaded_machine':
      draft = { ...common, kind: 'plate_loaded_machine', loadConvention: 'added', loadingSides: form.loadingSides, plates: plates(form.plates), ...(form.maxLoad === null ? {} : { maxLoad: form.maxLoad }) };
      break;
    case 'dumbbells':
      draft = { ...common, kind: 'dumbbells', loadConvention: 'per_hand', loads: range(dumbbellLoads(form), 'weight') };
      break;
    case 'weight_stack': {
      const loads = form.irregular ?? range(rangeValues(form.range), 'stack position');
      draft = { ...common, kind: 'weight_stack', loadConvention: 'stack', stackLoads: loads, addOns: form.addOns.filter((a) => a > 0) };
      break;
    }
    case 'assisted_stack': {
      const loads = form.irregular ?? range(rangeValues(form.range), 'assistance setting');
      draft = { ...common, kind: 'assisted_stack', loadConvention: 'assistance', assistanceLoads: loads };
      break;
    }
    case 'bodyweight_station':
      draft = { ...common, kind: 'bodyweight_station', loadConvention: 'bodyweight' };
      break;
  }
  if (problems.length > 0) return { ok: false, problems };
  const parsed = validate(EquipmentInstanceSchema, draft);
  if (!parsed.ok) return { ok: false, problems: parsed.issues.map((i) => (i.message.includes('minLoad') ? 'Min is above max.' : i.message)) };
  const eq = parsed.value;
  if (eq.kind !== 'bodyweight_station' && getAchievableLoads(eq).loads.length === 0) {
    return { ok: false, problems: ['This setup can’t make any load. Check the plates, the range and the max.'] };
  }
  return { ok: true, equipment: eq };
}

export interface LoadSummary {
  count: number;
  min: number | null;
  max: number | null;
  usualStep: number | null;
  /** Gaps larger than the usual step, e.g. a missing 30 kg dumbbell: [27.5, 32.5]. */
  gaps: [number, number][];
}

export function summariseLoads(eq: EquipmentInstance): LoadSummary {
  const loads = getAchievableLoads(eq).loads;
  const step = usualStep(loads);
  const gaps: [number, number][] = [];
  if (step !== null) {
    for (let i = 1; i < loads.length; i += 1) {
      const a = loads[i - 1] ?? 0;
      const b = loads[i] ?? 0;
      if (toScaled(b) - toScaled(a) > toScaled(step)) gaps.push([a, b]);
    }
  }
  return { count: loads.length, min: loads[0] ?? null, max: loads.at(-1) ?? null, usualStep: step, gaps };
}

/** `Makes 63 loads: 20–175 kg, total, every 2.5 kg.` (gym-editor §5 Preview). */
export function loadPreviewLine(eq: EquipmentInstance): string {
  if (eq.kind === 'bodyweight_station') return 'Logged as bodyweight (BW).';
  const s = summariseLoads(eq);
  if (s.count === 0 || s.min === null || s.max === null) return 'This setup can’t make any load. Check the plates, the range and the max.';
  const u = eq.unit;
  const span = s.min === s.max ? `${formatNumber(s.min)} ${u}` : `${formatNumber(s.min)}–${formatNumber(s.max)} ${u}`;
  const every = s.usualStep !== null && s.count > 2 ? `, every ${formatNumber(s.usualStep)} ${u}` : '';
  const word = s.count === 1 ? 'load' : 'loads';
  switch (eq.kind) {
    case 'barbell':
      return `Makes ${String(s.count)} ${word}: ${span}, total${every}.`;
    case 'plate_loaded_machine':
      return `Makes ${String(s.count)} ${word}: ${span} plates${every}.`;
    case 'dumbbells':
      return `Makes ${String(s.count)} ${word}: ${span} each.`;
    case 'weight_stack':
      return `Makes ${String(s.count)} ${word}: ${span} stack.`;
    case 'assisted_stack':
      return `Makes ${String(s.count)} ${word}: Assist ${span}.`;
  }
}

/** `Gap: 27.5 → 32.5 kg.` lines for gaps larger than the usual step. */
export function gapLines(eq: EquipmentInstance): string[] {
  if (eq.kind === 'bodyweight_station') return [];
  return summariseLoads(eq).gaps.slice(0, 5).map(([a, b]) => `Gap: ${formatNumber(a)} → ${formatNumber(b)} ${eq.unit}.`);
}

/** `One 1.25 kg plate can't be balanced, so it isn't used.` for odd counts on two-sided loading. */
export function unbalancedPlateHints(plates: readonly PlateCount[], sides: 1 | 2, unit: WeightUnit): string[] {
  if (sides === 1) return [];
  return plates
    .filter((p) => p.count % 2 === 1)
    .map((p) => (p.count === 1 ? `One ${formatNumber(p.mass)} ${unit} plate can’t be balanced, so it isn’t used.` : `One of the ${formatNumber(p.mass)} ${unit} plates can’t be balanced, so it isn’t used.`));
}

/**
 * `Check a load` (gym-editor §2.4.1): the plate breakdown from
 * `buildPlateSetup`, or why it can't be made and the nearest loads.
 */
export function checkLoadText(eq: EquipmentInstance, value: number): string {
  const u = eq.unit;
  const r = buildPlateSetup({ value, unit: u }, eq);
  if (r.ok) return r.perSide.length === 0 ? (eq.kind === 'barbell' ? 'Just the bar.' : 'No plates.') : `${r.sides === 2 ? 'Each side' : 'On the horn'}: ${plateList(r.perSide)}`;
  switch (r.reason) {
    case 'not_plate_loaded':
      return '';
    case 'above_max':
      return `${formatNumber(value)} ${u} is above ${eq.kind === 'barbell' ? 'this bar’s' : 'this machine’s'} limit (${formatNumber(r.nearestBelow ?? 0)} ${u}).`;
    case 'below_base':
      return `${formatNumber(value)} ${u} is below the bar (${formatNumber(eq.kind === 'barbell' ? eq.barMass : 0)} ${u}).`;
    case 'not_achievable': {
      const near = [r.nearestBelow, r.nearestAbove].filter((v): v is number => v !== null).map((v) => `${formatNumber(v)} ${u}`);
      return `${formatNumber(value)} ${u} can’t be made.${near.length > 0 ? ` Nearest: ${near.join(' or ')}.` : ''}`;
    }
  }
}

/** `25 + 15 + 1.25` (heaviest first, repeats written out). */
export function plateList(perSide: readonly PlateCount[]): string {
  return perSide.flatMap((p) => Array.from({ length: p.count }, () => formatNumber(p.mass))).join(' + ');
}

/** A short line for the gym detail row: `20–175 kg · total` / `2.5–30 kg each`. */
export function equipmentRowLine(eq: EquipmentInstance): string {
  if (eq.kind === 'bodyweight_station') return 'Bodyweight (BW)';
  const s = summariseLoads(eq);
  if (s.min === null || s.max === null) return 'Can’t make any load';
  const span = `${formatNumber(s.min)}–${formatNumber(s.max)} ${eq.unit}`;
  switch (eq.kind) {
    case 'barbell':
      return `${span} · total`;
    case 'plate_loaded_machine':
      return `${span} plates`;
    case 'dumbbells':
      return `${span} each${s.gaps.length > 0 ? ` · ${String(s.gaps.length)} ${s.gaps.length === 1 ? 'gap' : 'gaps'}` : ''}`;
    case 'weight_stack':
      return `${span} stack`;
    case 'assisted_stack':
      return `Assist ${span}`;
  }
}
