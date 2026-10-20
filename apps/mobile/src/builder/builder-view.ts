import { canAddWarmup, slotsOf, workingCount, type BuilderSlot, type GroupCount, type RestKind } from '@fizz/domain';
import { BUILD_LIMITS, type BuilderGroup, type LoadConvention, type SetType, type WeightUnit } from '@fizz/schemas';

import type { BuilderSnapshot, SetupFacts, SetupInput, StartPrompt } from './builder-service';

/**
 * What the builder's screens show (workout-builder-v3 §2.2–§2.8,
 * prototypes/workout-builder-v3.html). Pure: values and actions only
 * (minimal copy, CLAUDE.md); every number comes from the service.
 */

export const SETUP_COPY = {
  title: 'Set up',
  bar: 'Describe the workout',
  day: 'Day',
  mainLift: 'Main lift',
  variation: 'Variation',
  standard: 'Standard',
  length: 'Length',
  supersets: 'Supersets',
  groups: 'Muscle groups',
  recommended: 'Recommended',
  useRecommended: 'Use recommended',
  addGroup: '＋ Add muscle group',
  total: 'Total',
  next: 'Next: exercises',
  addHint: 'Add a muscle group',
  yourSplit: 'Your split',
  ppl: 'Push / Pull / Legs',
  custom: 'Custom',
  none: 'None',
  fromProfile: 'From Profile',
  offline: 'Offline',
} as const;

export const WORKOUT_COPY = {
  back: '‹ Set up',
  exercise: 'Exercise',
  sets: 'Sets',
  topSet: 'Top set',
  addExercise: '＋ Add exercise',
  bar: 'Ask the coach to change it',
  start: 'Start',
  review: 'Coach review',
  main: 'MAIN',
  mayHurt: 'May hurt',
  delete: 'Delete',
  swap: 'Swap',
  swapExercise: 'Swap exercise',
  moveUp: 'Move up',
  moveDown: 'Move down',
  supersetNext: 'Superset with next',
  unlink: 'Unlink',
  done: 'Done',
  next: 'Next',
  undo: 'Undo',
  why: 'Why?',
  whyWeight: 'Why this weight?',
  warmup: '＋ Warm-up',
  set: '＋ Set',
  rest: 'Rest',
  startLight: 'Start light',
  useEdits: 'Use',
} as const;

export const PROMPT_COPY = {
  title: 'Use these changes for',
  today: 'Today only',
  variation: 'Save as new variation',
  saveAndStart: 'Save and start',
  cancel: 'Cancel',
  limit: 'Limit reached',
} as const;

const trim = (n: number): string => String(Math.round(n * 100) / 100);

/** `1:00`, `3:30` (rest, 15 s steps). */
export function restText(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${String(Math.floor(s / 60))}:${String(s % 60).padStart(2, '0')}`;
}

/** A target load as the table shows it (§2.3): `100`, `30 each`, `25 assist`, `BW`, `BW+10`, `—`; another unit inline (`45 lb`). */
export function loadText(value: number | null, unit: WeightUnit, convention: LoadConvention, headerUnit: WeightUnit): string {
  if (convention === 'bodyweight') return 'BW';
  if (value === null) return '—';
  const u = unit === headerUnit ? '' : ` ${unit}`;
  switch (convention) {
    case 'per_hand':
      return `${trim(value)}${u} each`;
    case 'assistance':
      return `${trim(value)}${u} assist`;
    case 'added':
      return value === 0 ? 'BW' : `BW+${trim(value)}${u}`;
    case 'total':
    case 'stack':
      return `${trim(value)}${u}`;
  }
}

/** Spoken form for VoiceOver: `30 kilograms each`, `25 kilograms assistance`. */
export function loadSpoken(value: number | null, unit: WeightUnit, convention: LoadConvention): string {
  if (convention === 'bodyweight') return 'bodyweight';
  if (value === null) return 'no load yet';
  const u = unit === 'kg' ? 'kilograms' : 'pounds';
  switch (convention) {
    case 'per_hand':
      return `${trim(value)} ${u} each`;
    case 'assistance':
      return `${trim(value)} ${u} assistance`;
    case 'added':
      return `bodyweight plus ${trim(value)} ${u}`;
    case 'total':
    case 'stack':
      return `${trim(value)} ${u}`;
  }
}

// ---------------------------------------------------------------------------
// Set up (§2.2)

export interface SetupGroupRow {
  group: BuilderGroup;
  count: number;
  countText: string;
  canMinus: boolean;
  canPlus: boolean;
}

export interface SetupView {
  dayValue: string;
  mainLiftValue: string;
  /** Null: the Variation row is hidden (no saved variations). */
  variationValue: string | null;
  lengthText: string;
  canShorter: boolean;
  canLonger: boolean;
  supersets: boolean;
  /** `Recommended` tag, or the `Use recommended` link once edited. */
  groupsTag: { kind: 'tag' | 'link'; text: string };
  groups: SetupGroupRow[];
  canAddGroup: boolean;
  totalText: string;
  /** `Recommended for 60 min · 7`, only when Total ≠ the recommendation. */
  recommendedLine: string | null;
  nextEnabled: boolean;
  /** `Add a muscle group` when Custom is empty. */
  hint: string | null;
}

const exercisesText = (n: number) => `${String(n)} ${n === 1 ? 'exercise' : 'exercises'}`;

export function setupView(s: SetupInput, facts: SetupFacts | null, mainLiftName: string | null): SetupView {
  const total = s.groups.reduce((m, g) => m + g.count, 0);
  const rec = facts?.recommended ?? null;
  const variation = s.variationId === null ? SETUP_COPY.standard : (facts?.variations.find((v) => v.id === s.variationId)?.label ?? SETUP_COPY.standard);
  return {
    dayValue: s.dayName,
    mainLiftValue: mainLiftName ?? SETUP_COPY.none,
    variationValue: facts !== null && facts.variations.length > 0 ? variation : null,
    lengthText: `${String(s.minutes)} min`,
    canShorter: s.minutes > BUILD_LIMITS.minMinutes,
    canLonger: s.minutes < BUILD_LIMITS.maxMinutes,
    supersets: s.supersets,
    groupsTag: s.groupsEdited ? { kind: 'link', text: SETUP_COPY.useRecommended } : { kind: 'tag', text: SETUP_COPY.recommended },
    groups: s.groups.map((g) => ({ group: g.group, count: g.count, countText: exercisesText(g.count), canMinus: g.count > 0, canPlus: g.count < 4 && total < BUILD_LIMITS.maxExercises })),
    canAddGroup: (facts?.addable.length ?? 0) > 0 && total < BUILD_LIMITS.maxExercises,
    totalText: exercisesText(total),
    recommendedLine: rec !== null && rec.count > 0 && rec.count !== total ? `Recommended for ${String(s.minutes)} min · ${String(rec.count)}` : null,
    nextEnabled: facts?.canBuild ?? total > 0,
    hint: total === 0 && facts?.template == null ? SETUP_COPY.addHint : null,
  };
}

/** `[−] 60 min [+]`: any minute, ±1 a tap, 15–180 (§2.2). */
export function stepMinutes(s: SetupInput, delta: number): SetupInput {
  return { ...s, minutes: Math.max(BUILD_LIMITS.minMinutes, Math.min(BUILD_LIMITS.maxMinutes, Math.round(s.minutes + delta))) };
}

/** A group's ± (1–4; 0 removes the row). Ben's own counts: `Recommended` becomes `Use recommended`. */
export function stepGroup(s: SetupInput, group: BuilderGroup, delta: number): SetupInput {
  const total = s.groups.reduce((m, g) => m + g.count, 0);
  if (delta > 0 && total >= BUILD_LIMITS.maxExercises) return s;
  const groups = s.groups.flatMap((g): GroupCount[] => {
    if (g.group !== group) return [g];
    const count = Math.max(0, Math.min(4, g.count + delta));
    return count === 0 ? [] : [{ group, count }];
  });
  return { ...s, groups, groupsEdited: true };
}

export function addGroup(s: SetupInput, group: BuilderGroup): SetupInput {
  if (s.groups.some((g) => g.group === group)) return s;
  return { ...s, groups: [...s.groups, { group, count: 1 }], groupsEdited: true };
}

/** `Use recommended`: the recommendation's groups, and the tag again. */
export function applyRecommended(s: SetupInput, rec: SetupFacts['recommended']): SetupInput {
  return { ...s, groups: rec.groups.map((g) => ({ ...g })), groupsEdited: false };
}

/**
 * Rows Set up shows until Ben edits them (§2.2): a loaded template's (or
 * variation's) own groups, else the recommendation. `keep`: a draft is open
 * and its Day, Main lift and Variation are unchanged, so its rows stay as
 * stored (Length and Supersets merge, they never re-pick groups; review B2).
 */
export function withRecommendation(s: SetupInput, facts: Pick<SetupFacts, 'recommended' | 'loaded'>, keep = false): SetupInput {
  if (s.groupsEdited || keep) return s;
  const groups = facts.loaded ?? facts.recommended.groups;
  return { ...s, groups: groups.map((g) => ({ ...g })) };
}

/** Day, Main lift and Variation are the same (Set up's identity; a change rebuilds, §2.3). */
export function sameIdentity(a: Pick<SetupInput, 'dayId' | 'mainLiftExerciseId' | 'variationId'>, b: Pick<SetupInput, 'dayId' | 'mainLiftExerciseId' | 'variationId'>): boolean {
  return a.dayId === b.dayId && a.mainLiftExerciseId === b.mainLiftExerciseId && a.variationId === b.variationId;
}

// ---------------------------------------------------------------------------
// Your workout (§2.3)

export interface WorkoutRowView {
  slotKey: string;
  exerciseId: string;
  /** `1`, `3a`. */
  label: string;
  name: string;
  works: string | null;
  setsText: string;
  /** `+4 W`, or null with no warm-ups. */
  warmText: string | null;
  topText: string;
  main: boolean;
  mayHurt: boolean;
  /** Whether the next row is in the same superset (draw the a→b line). */
  linkedToNext: boolean;
  accessibilityLabel: string;
  actions: { name: 'delete' | 'swap' | 'move_up' | 'move_down' | 'superset_next' | 'unlink'; label: string }[];
}

export interface WorkoutRoundView {
  n: number;
  superset: boolean;
  rows: WorkoutRowView[];
}

export interface WorkoutPageView {
  title: string;
  /** `⚠ Over 20 min` when even the minimum is over the length. */
  overLine: string | null;
  topHeader: string;
  rounds: WorkoutRoundView[];
  empty: boolean;
  startEnabled: boolean;
  canAdd: boolean;
  /** `Not applied: Hammer curl with Cable fly`. */
  notApplied: string[];
}

const topRowOf = (s: BuilderSlot) => s.rows.find((r) => r.type === 'top') ?? s.rows.find((r) => r.type !== 'warmup') ?? null;

export function workoutView(snap: BuilderSnapshot): WorkoutPageView {
  const blocks = snap.workout.blocks.filter((b) => b.slots.length > 0);
  const flat = slotsOf(blocks);
  const rounds = blocks.map((b, bi): WorkoutRoundView => {
    const superset = b.slots.length > 1;
    return {
      n: bi + 1,
      superset,
      rows: b.slots.map((s, si): WorkoutRowView => {
        const f = snap.facts[s.exerciseId];
        const name = f?.name ?? 'Exercise';
        const label = superset ? `${String(bi + 1)}${'abcd'.charAt(si)}` : String(bi + 1);
        const warm = s.rows.filter((r) => r.type === 'warmup').length;
        const top = topRowOf(s);
        const topText = loadText(top?.load ?? null, s.unit, s.convention, snap.unit);
        const at = flat.indexOf(s);
        const nextBlock = blocks[bi + 1];
        const nextIsMain = nextBlock?.slots[0]?.main === true;
        const actions: WorkoutRowView['actions'] = [
          { name: 'delete', label: WORKOUT_COPY.delete },
          { name: 'swap', label: WORKOUT_COPY.swap },
          ...(at > 0 ? [{ name: 'move_up' as const, label: WORKOUT_COPY.moveUp }] : []),
          ...(at < flat.length - 1 ? [{ name: 'move_down' as const, label: WORKOUT_COPY.moveDown }] : []),
          ...(!s.main && nextBlock !== undefined && !nextIsMain && b.slots.length + nextBlock.slots.length <= BUILD_LIMITS.maxSuperset ? [{ name: 'superset_next' as const, label: WORKOUT_COPY.supersetNext }] : []),
          ...(superset ? [{ name: 'unlink' as const, label: WORKOUT_COPY.unlink }] : []),
        ];
        const n = workingCount(s);
        const spoken = [label, name, superset ? 'superset' : null, s.main ? 'main lift' : null, `${String(n)} ${n === 1 ? 'set' : 'sets'}`, warm > 0 ? `plus ${String(warm)} warm-up` : null, `top set ${loadSpoken(top?.load ?? null, s.unit, s.convention)}`, f?.mayHurt === true ? WORKOUT_COPY.mayHurt : null].filter((x): x is string => x !== null);
        return {
          slotKey: s.key,
          exerciseId: s.exerciseId,
          label,
          name,
          works: f?.works ?? null,
          setsText: String(n),
          warmText: warm > 0 ? `+${String(warm)} W` : null,
          topText,
          main: s.main,
          mayHurt: f?.mayHurt === true,
          linkedToNext: superset && si < b.slots.length - 1,
          accessibilityLabel: spoken.join(', '),
          actions,
        };
      }),
    };
  });
  return {
    title: `${snap.setup.dayName} · about ${String(snap.minutes)} min`,
    overLine: snap.over ? `⚠ Over ${String(snap.setup.minutes)} min` : null,
    topHeader: `${WORKOUT_COPY.topSet} (${snap.unit})`,
    rounds,
    empty: flat.length === 0,
    startEnabled: snap.startable,
    canAdd: flat.length < BUILD_LIMITS.maxExercises,
    notApplied: snap.skipped.map((x) => {
      const op = x.op;
      const n = (id: string) => snap.facts[id]?.name ?? 'Exercise';
      switch (op.kind) {
        case 'add_slot':
          return `Not applied: ${n(op.slot.exerciseId)}`;
        case 'pair':
          return `Not applied: ${n(op.b)} with ${n(op.a)}`;
        case 'remove_slot':
          return `Not applied: remove ${n(op.exerciseId)}`;
        case 'set_count':
          return `Not applied: ${n(op.exerciseId)} sets`;
      }
    }),
  };
}

// ---------------------------------------------------------------------------
// Exercise pop-up (§2.4)

export const SET_TYPE_LABEL: Readonly<Record<SetType, string>> = { warmup: 'Warm-up', working: 'Working', top: 'Top set', backoff: 'Back-off', drop: 'Drop' };
export const SET_TYPES: readonly SetType[] = ['warmup', 'working', 'top', 'backoff', 'drop'];

export interface PopupSetRow {
  index: number;
  /** `W` for a warm-up, else the working set's number. */
  mark: string;
  type: SetType;
  typeText: string;
  reps: number;
  kgText: string;
  load: number | null;
  rpeText: string;
  rpe: number | null;
  canDelete: boolean;
  accessibilityLabel: string;
}

export interface PopupRestRow {
  kind: RestKind | 'round';
  label: string;
  seconds: number;
  text: string;
}

export interface PopupView {
  name: string;
  works: string | null;
  kgHeader: string;
  rows: PopupSetRow[];
  canAddWarmup: boolean;
  canAddSet: boolean;
  rests: PopupRestRow[];
  canMoveUp: boolean;
  canMoveDown: boolean;
  canSupersetNext: boolean;
  canUnlink: boolean;
  mayHurt: boolean;
}

/**
 * The pop-up for one slot. `restOf` gives each rest kind's current seconds
 * (Ben's own, else the default the service worked out).
 */
export function popupView(snap: BuilderSnapshot, slotKey: string, restOf: (kind: RestKind | 'round') => number): PopupView | null {
  const flat = slotsOf(snap.workout.blocks);
  const slot = flat.find((s) => s.key === slotKey);
  if (slot === undefined) return null;
  const block = snap.workout.blocks.find((b) => b.slots.includes(slot));
  const row = workoutView(snap).rounds.flatMap((r) => r.rows).find((r) => r.slotKey === slotKey);
  const f = snap.facts[slot.exerciseId];
  let n = 0;
  const work = workingCount(slot);
  const rows = slot.rows.map((r, i): PopupSetRow => {
    const mark = r.type === 'warmup' ? 'W' : String((n += 1));
    const kgText = loadText(r.load, slot.unit, slot.convention, slot.unit);
    return {
      index: i,
      mark,
      type: r.type,
      typeText: SET_TYPE_LABEL[r.type],
      reps: r.reps,
      kgText,
      load: r.load,
      rpeText: r.rpe === null ? '–' : trim(r.rpe),
      rpe: r.rpe,
      canDelete: r.type === 'warmup' || work > 1,
      accessibilityLabel: `${r.type === 'warmup' ? 'Warm-up' : `Set ${mark}`}, ${SET_TYPE_LABEL[r.type]}, ${String(r.reps)} reps, ${loadSpoken(r.load, slot.unit, slot.convention)}${r.rpe === null ? '' : `, RPE ${trim(r.rpe)}`}`,
    };
  });
  const types = new Set(slot.rows.map((r) => r.type));
  const superset = (block?.slots.length ?? 1) > 1;
  const rests: PopupRestRow[] = superset
    ? [{ kind: 'round', label: 'After each round', seconds: restOf('round'), text: restText(restOf('round')) }]
    : [
        ...(types.has('warmup') ? [{ kind: 'warmup' as const, label: 'Warm-ups' }] : []),
        ...(types.has('top') ? [{ kind: 'top' as const, label: 'Top set' }] : []),
        ...(types.has('backoff') ? [{ kind: 'backoff' as const, label: 'Back-offs' }] : []),
        ...(types.has('working') ? [{ kind: 'working' as const, label: 'Working sets' }] : []),
        ...(types.has('drop') ? [{ kind: 'before_drop' as const, label: 'Before drop' }] : []),
      ].map((x) => ({ ...x, seconds: restOf(x.kind), text: restText(restOf(x.kind)) }));
  const has = (name: WorkoutRowView['actions'][number]['name']) => row?.actions.some((a) => a.name === name) === true;
  return {
    name: f?.name ?? 'Exercise',
    works: f?.works ?? null,
    kgHeader: slot.unit === 'kg' ? 'Kg' : 'Lb',
    rows,
    canAddWarmup: canAddWarmup(slot),
    canAddSet: work < BUILD_LIMITS.maxWorkingSets,
    rests,
    canMoveUp: has('move_up'),
    canMoveDown: has('move_down'),
    canSupersetNext: has('superset_next'),
    canUnlink: has('unlink'),
    mayHurt: f?.mayHurt === true,
  };
}

/** Keyboard bar steps (§2.7): reps 1, RPE 0.5; kg comes from this gym's next loadable weight (service). */
export const KEY_STEPS = { reps: 1, rpe: 0.5 } as const;

/** `Next` order: Reps → Kg → RPE → next set's Reps (§2.7). Null at the end. */
export function nextField(rowIndex: number, field: 'reps' | 'kg' | 'rpe', rowCount: number, hasRpe: (i: number) => boolean): { row: number; field: 'reps' | 'kg' | 'rpe' } | null {
  if (field === 'reps') return { row: rowIndex, field: 'kg' };
  if (field === 'kg' && hasRpe(rowIndex)) return { row: rowIndex, field: 'rpe' };
  return rowIndex + 1 < rowCount ? { row: rowIndex + 1, field: 'reps' } : null;
}

// ---------------------------------------------------------------------------
// Start prompt (§2.8)

export interface PromptView {
  title: string;
  lines: string[];
  today: string;
  update: string | null;
  variation: { label: string; enabled: boolean; note: string | null };
  cancel: string;
}

export function promptView(p: StartPrompt): PromptView {
  return {
    title: PROMPT_COPY.title,
    lines: p.lines,
    today: PROMPT_COPY.today,
    update: p.updateLabel,
    variation: { label: PROMPT_COPY.variation, enabled: p.canSaveVariation && !p.variationLimitReached, note: p.variationLimitReached ? PROMPT_COPY.limit : null },
    cancel: PROMPT_COPY.cancel,
  };
}

// ---------------------------------------------------------------------------
// Coach bar (§2.6): honest status, never a canned reply (rule 1)

export type CoachBarStatus = 'ok' | 'offline' | 'not_connected';

export function coachStatusOf(status: string): CoachBarStatus {
  if (status === 'ok') return 'ok';
  if (status === 'offline') return 'offline';
  return 'not_connected';
}

/** The bar's trailing word: nothing when connected; `Offline`; `Coach not connected`. */
export function coachBarWord(s: CoachBarStatus): string | null {
  return s === 'ok' ? null : s === 'offline' ? 'Offline' : 'Coach not connected';
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** `Edits from Mon 19 Oct` (§2.3) for a local date `2026-10-19`. */
export function editsFromText(localDate: string): string {
  const [y = 0, m = 1, d = 1] = localDate.split('-').map(Number);
  // Sakamoto's weekday for the Gregorian calendar (0 = Sunday).
  const t = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
  const yy = m < 3 ? y - 1 : y;
  const w = (yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) + (t[m - 1] ?? 0) + d) % 7;
  return `Edits from ${WEEKDAYS[w] ?? ''} ${String(d)} ${MONTHS[m - 1] ?? ''}`;
}
