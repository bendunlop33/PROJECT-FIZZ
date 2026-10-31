import {
  EquipmentInstanceSchema,
  GymSchema,
  validate,
  type EquipmentInstance,
  type Gym,
  type GymSetup,
  type PlateCount,
  type ValidationIssue,
  type WeightUnit,
} from '@fizz/schemas';
import { BAR_MASS } from './gym-editor';
import { fromScaled, toScaled } from './units';

/**
 * Gym presets (onboarding.md §2.3–2.4, gym-editor.md §6): starting drafts of
 * typical equipment that Ben ticks or unticks. They are Coaching knowledge
 * (general, nothing about Ben); the gym saved from one is Your data.
 *
 * Every number is "typical, not checked" (`detailsSource: 'preset'`, GE1).
 * kg and lb presets are written natively in their unit, never converted
 * (a lb gym has a 45 lb bar, not 20.41 kg).
 */

export type GymPresetId = 'commercial' | 'home_dumbbells' | 'home_barbell' | 'hotel' | 'empty';

/** An equipment record without the fields the gym and owner supply. */
type Omit2<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type EquipmentDraftBody = Omit2<EquipmentInstance, 'id' | 'ownerId' | 'version' | 'createdAtUtc' | 'updatedAtUtc' | 'gymId'>;

export interface GymDraftItem {
  /** Stable within a preset (e.g. `barbell`). */
  key: string;
  label: string;
  ticked: boolean;
  equipment: EquipmentDraftBody;
}

export interface GymDraft {
  /** The preset it came from, or the quick setup (`full`, `small`, `home`; ADR 0029). */
  presetId: GymPresetId | GymSetup;
  unit: WeightUnit;
  items: GymDraftItem[];
}

export interface GymPresetSummary {
  id: GymPresetId;
  title: string;
  subtitle: string | null;
}

/**
 * The most values `loadRange` makes (hang fix, 27 Oct): far above any real rack or stack (the equipment schema keeps
 * 500), so a huge `to` or a tiny `step` from odd stored values throws at once instead of allocating without end.
 */
export const LOAD_RANGE_MAX_VALUES = 10_000;

/** Ascending values from `from` to `to` inclusive, every `step`, without float drift. */
export function loadRange(from: number, to: number, step: number): number[] {
  const a = toScaled(from);
  const b = toScaled(to);
  const s = toScaled(step);
  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(s) || s <= 0 || a <= 0 || b < a) throw new RangeError('loadRange needs 0 < from <= to and step > 0');
  if ((b - a) / s >= LOAD_RANGE_MAX_VALUES) throw new RangeError(`loadRange would make more than ${String(LOAD_RANGE_MAX_VALUES)} values`);
  const out: number[] = [];
  for (let v = a; v <= b; v += s) out.push(fromScaled(v));
  return out;
}

const plates = (masses: readonly number[], count: number): PlateCount[] => masses.map((mass) => ({ mass, count }));

const PLATES = { kg: [25, 20, 15, 10, 5, 2.5, 1.25], lb: [45, 35, 25, 10, 5, 2.5] } as const;
const HOME_PLATES = { kg: [20, 15, 10, 5, 2.5, 1.25], lb: [45, 35, 25, 10, 5, 2.5] } as const;
const BAR = { kg: 20, lb: 45 } as const;

const common = (name: string, unit: WeightUnit) => ({
  name,
  unit,
  movementTags: [] as string[],
  availability: 'available' as const,
  detailsSource: 'preset' as const,
});

type ItemBuilder = (unit: WeightUnit) => Omit<GymDraftItem, 'ticked'>;

const barbell =
  (homePlates: boolean): ItemBuilder =>
  (unit) => ({
    key: 'barbell',
    label: 'Barbell and plates',
    equipment: {
      ...common('Barbell and plates', unit),
      kind: 'barbell',
      loadConvention: 'total',
      barMass: BAR[unit],
      plates: homePlates ? plates(HOME_PLATES[unit], 2) : plates(PLATES[unit], 4),
    },
  });

const dumbbells =
  (kgMax: number, lbMax: number): ItemBuilder =>
  (unit) => ({
    key: 'dumbbells',
    label: 'Dumbbells',
    equipment: {
      ...common('Dumbbells', unit),
      kind: 'dumbbells',
      loadConvention: 'per_hand',
      loads: unit === 'kg' ? loadRange(2.5, kgMax, 2.5) : loadRange(5, lbMax, 5),
    },
  });

const cable =
  (kgMax: number, lbMax: number): ItemBuilder =>
  (unit) => ({
    key: 'cable',
    label: 'Cable station (weight stack)',
    equipment: {
      ...common('Cable station', unit),
      kind: 'weight_stack',
      loadConvention: 'stack',
      stackLoads: unit === 'kg' ? loadRange(5, kgMax, 5) : loadRange(10, lbMax, 10),
      addOns: [],
    },
  });

const assisted: ItemBuilder = (unit) => ({
  key: 'assisted',
  label: 'Assisted pull-up / dip machine',
  equipment: {
    ...common('Assisted pull-up / dip machine', unit),
    kind: 'assisted_stack',
    loadConvention: 'assistance',
    assistanceLoads: unit === 'kg' ? loadRange(5, 70, 5) : loadRange(10, 150, 10),
  },
});

const plateLoaded: ItemBuilder = (unit) => ({
  key: 'plate_loaded',
  label: 'Plate-loaded machine',
  equipment: {
    ...common('Plate-loaded machine', unit),
    kind: 'plate_loaded_machine',
    loadConvention: 'added',
    loadingSides: 2,
    plates: plates(PLATES[unit], 4),
  },
});

const selectorised: ItemBuilder = (unit) => ({
  key: 'selectorised',
  label: 'Selectorised machine',
  equipment: {
    ...common('Selectorised machine', unit),
    kind: 'weight_stack',
    loadConvention: 'stack',
    stackLoads: unit === 'kg' ? loadRange(5, 100, 5) : loadRange(10, 200, 10),
    addOns: [],
  },
});

const pullUpBar: ItemBuilder = (unit) => ({
  key: 'pull_up_bar',
  label: 'Pull-up bar',
  equipment: { ...common('Pull-up bar', unit), kind: 'bodyweight_station', loadConvention: 'bodyweight' },
});

/** (ADR 0030) A bar plus its own plates, at the typical bar weight (`BAR_MASS`, one place for the assumed bar weights). */
const otherBar =
  (kind: 'ez_bar' | 'trap_bar', label: string): ItemBuilder =>
  (unit) => ({
    key: kind,
    label,
    equipment: { ...common(label, unit), kind, loadConvention: 'total', barMass: BAR_MASS[kind][unit], plates: plates(PLATES[unit], 4) },
  });

/** Plates added; the bar's starting weight beside the load (ADR 0030). */
const smith: ItemBuilder = (unit) => ({
  key: 'smith_machine',
  label: 'Smith machine',
  equipment: { ...common('Smith machine', unit), kind: 'smith_machine', loadConvention: 'added', barMass: BAR_MASS.smith_machine[unit], plates: plates(PLATES[unit], 4) },
});

const kettlebells: ItemBuilder = (unit) => ({
  key: 'kettlebells',
  label: 'Kettlebells',
  equipment: { ...common('Kettlebells', unit), kind: 'kettlebell', loadConvention: 'per_hand', loads: unit === 'kg' ? loadRange(4, 32, 4) : loadRange(10, 70, 5) },
});

const bench: ItemBuilder = (unit) => ({
  key: 'bench',
  label: 'Bench',
  equipment: { ...common('Bench', unit), kind: 'bench', loadConvention: 'bodyweight', benchType: 'adjustable' },
});

const rack: ItemBuilder = (unit) => ({
  key: 'rack',
  label: 'Rack',
  equipment: { ...common('Rack', unit), kind: 'rack', loadConvention: 'bodyweight', rackType: 'squat_rack' },
});

interface PresetDef extends GymPresetSummary {
  items: readonly { build: ItemBuilder; ticked: boolean }[];
}

const PRESETS: readonly PresetDef[] = [
  {
    id: 'commercial',
    title: 'Commercial gym',
    subtitle: 'Barbells, dumbbells, cables, machines',
    items: [
      { build: barbell(false), ticked: true },
      { build: dumbbells(40, 100), ticked: true },
      { build: cable(100, 200), ticked: true },
      { build: pullUpBar, ticked: true },
      { build: bench, ticked: true },
      { build: rack, ticked: true },
      { build: assisted, ticked: false },
      { build: plateLoaded, ticked: false },
      { build: selectorised, ticked: false },
      { build: kettlebells, ticked: false },
      { build: otherBar('ez_bar', 'EZ bar'), ticked: false },
      { build: otherBar('trap_bar', 'Trap bar'), ticked: false },
      { build: smith, ticked: false },
    ],
  },
  {
    id: 'home_dumbbells',
    title: 'Home: dumbbells and a bench',
    subtitle: null,
    items: [
      { build: dumbbells(25, 50), ticked: true },
      { build: bench, ticked: true },
    ],
  },
  {
    id: 'home_barbell',
    title: 'Home: barbell, rack and plates',
    subtitle: null,
    items: [
      { build: barbell(true), ticked: true },
      { build: rack, ticked: true },
      { build: bench, ticked: true },
      { build: pullUpBar, ticked: true },
    ],
  },
  {
    id: 'hotel',
    title: 'Hotel or small gym',
    subtitle: null,
    items: [
      { build: dumbbells(25, 50), ticked: true },
      { build: cable(60, 120), ticked: true },
      { build: bench, ticked: true },
    ],
  },
  { id: 'empty', title: 'Start empty', subtitle: null, items: [] },
];

export function listGymPresets(): GymPresetSummary[] {
  return PRESETS.map(({ id, title, subtitle }) => ({ id, title, subtitle }));
}

export function buildPresetDraft(presetId: GymPresetId, unit: WeightUnit): GymDraft {
  const preset = PRESETS.find((p) => p.id === presetId);
  if (!preset) throw new RangeError(`Unknown gym preset: ${presetId}`);
  return { presetId, unit, items: preset.items.map(({ build, ticked }) => ({ ...build(unit), ticked })) };
}

export function toggleDraftItem(draft: GymDraft, key: string): GymDraft {
  return { ...draft, items: draft.items.map((i) => (i.key === key ? { ...i, ticked: !i.ticked } : i)) };
}

export interface MaterialiseRequest {
  name: string;
  ownerId: string;
  gymId: string;
  isDefault: boolean;
  atUtc: string;
  newId: () => string;
  /** (ADR 0029) How the gym was described; saved on the gym. */
  setup?: GymSetup;
}

export type MaterialiseResult =
  | { ok: true; gym: Gym; equipment: EquipmentInstance[] }
  | { ok: false; error: 'name_empty' | 'invalid'; issues: ValidationIssue[] };

/**
 * The ticked items of a draft as records ready to save in one write
 * (`createGymFromDraft`). Validated here, so a bad preset never reaches storage.
 */
export function materialiseGymDraft(draft: GymDraft | null, req: MaterialiseRequest): MaterialiseResult {
  const name = req.name.trim();
  if (name === '') return { ok: false, error: 'name_empty', issues: [{ path: 'name', message: 'Give the gym a name' }] };
  const meta = { ownerId: req.ownerId, version: 1, createdAtUtc: req.atUtc, updatedAtUtc: req.atUtc };
  const gym = validate(GymSchema, { ...meta, id: req.gymId, name, isDefault: req.isDefault, ...(req.setup === undefined ? {} : { setup: req.setup }) });
  if (!gym.ok) return { ok: false, error: 'invalid', issues: gym.issues };
  const equipment: EquipmentInstance[] = [];
  for (const item of draft?.items ?? []) {
    if (!item.ticked) continue;
    const eq = validate(EquipmentInstanceSchema, { ...item.equipment, ...meta, id: req.newId(), gymId: req.gymId });
    if (!eq.ok) return { ok: false, error: 'invalid', issues: eq.issues.map((i) => ({ ...i, path: `${item.key}.${i.path}` })) };
    equipment.push(eq.value);
  }
  return { ok: true, gym: gym.value, equipment };
}
