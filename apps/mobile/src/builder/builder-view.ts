import { canAddWarmup, cardioValuesText, clampBuilderRest, fitNoteOf, isTimedRow, liveTime, slotsOf, spokenDistance, spokenDuration, TODAY_V2_COPY, workingCount, type BuilderSetRow, type BuilderSlot, type GroupCount, type RestKind } from '@fizz/domain';
import { BUILD_LIMITS, type BuilderGroup } from '@fizz/schemas';

import type { BuilderSnapshot, SetupFacts, SetupInput, TodayOptions } from './builder-service';
import { loadSpoken, loadText, REST_STEP_S, restText, SET_TYPE_LABEL, type PopupRestRow, type PopupSetRow, type PopupView } from '../ui/exercise-popup-model';
import { swapPainConfirm } from '../ui/swap-sheet-model';

/**
 * What the builder's screens show (workout-builder-v3 §2.2–§2.8,
 * prototypes/workout-builder-v3.html). Pure: values and actions only
 * (minimal copy, CLAUDE.md); every number comes from the service.
 */

export const SETUP_COPY = {
  title: 'Set up',
  bar: 'Describe the workout',
  /** The coach's fill couldn't be written (Set up closed, or the write failed). */
  notFilled: 'Couldn’t save. Try again.',
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
  rename: 'Rename',
  delete: 'Delete',
  deleted: (label: string) => `Deleted ${label}`,
} as const;

export const WORKOUT_COPY = {
  back: '‹ Set up',
  /** A coach suggestion applied from Coach review (§2.6 `Applied · Undo`). */
  applied: 'Applied',
  /** Done on Coach review: a ticked note couldn't be saved. */
  notSaved: 'Not saved',
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
  /** (Redesign v3 §A9) Your workout's `⋯` item for earlier unused edits. */
  useEarlierEdits: 'Use earlier edits',
  notHere: 'Not at this gym',
  checkIn: 'Check-in',
  skip: 'Skip',
  outOfDate: 'Out of date',
  addAnyway: 'Add anyway',
  reload: 'Reload',
  /** (§7) `⋯` for a workout that isn't a plan day: `Save to Workouts`. */
  more: 'More',
  saveToWorkouts: 'Save to Workouts',
  saved: (name: string) => `Saved ${name}`,
  nothingToSave: 'Nothing to save',
} as const;

/** (22 Oct) Your workout's Time row and the detail behind its note (minimal copy: values and actions). */
export const TIME_COPY = {
  label: 'Time',
  undo: 'Undo',
  done: 'Done',
  /** (Ben, 23 Oct) The carry-over offer's Apply. */
  carryOver: 'Carry over',
} as const;

const trim = (n: number): string => String(Math.round(n * 100) / 100);

// The pop-up's model, values and words are shared with the active workout (workout-table-v3 §7).
export { KEY_STEPS, loadSpoken, loadText, nextField, REST_STEP_S, restText, SET_TYPE_LABEL, SET_TYPES, type PopupRestRow, type PopupSetRow, type PopupView } from '../ui/exercise-popup-model';

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
  /** `Not at this gym` (§2.3 `Gym changed`, nothing here could replace it). */
  notHere: boolean;
  /** (Ben, 23 Oct: one editor) What blocks Save on a saved workout (`Can’t save distance yet`); absent or null: nothing. */
  issue?: string | null;
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

/** (22 Oct) Your workout's Time: `Time · −1 exercise ›  [−] 45 min [+]`, the same control as Today's. */
export interface TimeRowView {
  /** (Ben, 27 Oct) The live estimate of the workout on the page (`liveTime`): the number shown. */
  minutes: number;
  /** The length it is held to (the set-up's, or the one Time last fitted to). */
  length: number;
  /** The estimate is past the length (Ben's own edits): the number in the warning tone. */
  over: boolean;
  /** `45 min`. */
  valueText: string;
  /** The biggest change a live fit made, after the label in light orange (`−1 exercise`, `−2 sets`, `shorter rests`); null: none. */
  note: string | null;
  /** Everything it changed, behind the note: `Shorter rests`, `Incline DB press 3 → 2 sets`, `Dropped Triceps pushdown`. */
  lines: string[];
  /** The detail's `Undo`: back to this length and the workout as it was before the first change; null: nothing to undo. */
  undoMinutes: number | null;
  /** What `−` and `+` fit to: the next 5-minute step from the estimate past the length (`liveTime`); null at a limit. */
  less: number | null;
  more: number | null;
  /** VoiceOver for the note: `Time changes: −1 exercise`. */
  noteLabel: string | null;
}

export interface WorkoutPageView {
  title: string;
  time: TimeRowView;
  /** `⚠ Over 20 min` when even the minimum is over the length. */
  overLine: string | null;
  topHeader: string;
  rounds: WorkoutRoundView[];
  empty: boolean;
  startEnabled: boolean;
  canAdd: boolean;
  /** `Not applied: Hammer curl with Cable fly`, and what `Add anyway` adds (the exercises not in the workout). */
  notApplied: { text: string; add: string[] }[];
}

const topRowOf = (s: BuilderSlot) => s.rows.find((r) => r.type === 'top') ?? s.rows.find((r) => r.type !== 'warmup') ?? null;

/** (22 Oct) A timed or cardio set's target as the overview showed it: `0:45`, `20:00 · 5,000 m`, `5,000 m`. */
export function timedText(r: Pick<BuilderSetRow, 'durationS' | 'distanceM'>): string {
  return cardioValuesText({ durationS: r.durationS ?? null, distanceM: r.distanceM ?? null });
}

/** VoiceOver's words for it: `45 seconds`, `20 minutes, 5 kilometres`. */
export function timedSpoken(r: Pick<BuilderSetRow, 'durationS' | 'distanceM'>): string {
  return [r.durationS === undefined ? null : spokenDuration(r.durationS), r.distanceM === undefined ? null : spokenDistance(r.distanceM)].filter((x): x is string => x !== null).join(', ');
}

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
        // A timed or cardio set shows its time and distance (and a load only when it has one).
        const timed = top !== null && isTimedRow(top) ? top : null;
        const topLoad = loadText(top?.load ?? null, s.unit, s.convention, snap.unit);
        const topText = timed === null ? topLoad : timed.load === null ? timedText(timed) : `${timedText(timed)} · ${topLoad}`;
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
        const spoken = [label, name, superset ? 'superset' : null, s.main ? 'main lift' : null, `${String(n)} ${n === 1 ? 'set' : 'sets'}`, warm > 0 ? `plus ${String(warm)} warm-up` : null, timed !== null ? timedSpoken(timed) : `top set ${loadSpoken(top?.load ?? null, s.unit, s.convention)}`, f?.mayHurt === true ? WORKOUT_COPY.mayHurt : null, f?.notHere === true ? WORKOUT_COPY.notHere : null].filter((x): x is string => x !== null);
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
          notHere: f?.notHere === true,
          linkedToNext: superset && si < b.slots.length - 1,
          accessibilityLabel: spoken.join(', '),
          actions,
        };
      }),
    };
  });
  return {
    title: `${snap.setup.dayName} · about ${String(snap.minutes)} min`,
    time: timeRowView(snap),
    overLine: snap.over ? `⚠ Over ${String(snap.setup.minutes)} min` : null,
    topHeader: `${WORKOUT_COPY.topSet} (${snap.unit})`,
    rounds,
    empty: flat.length === 0,
    startEnabled: snap.startable,
    canAdd: flat.length < BUILD_LIMITS.maxExercises,
    notApplied: snap.skipped.map((x) => {
      const op = x.op;
      const n = (id: string) => snap.facts[id]?.name ?? 'Exercise';
      const have = new Set(flat.map((s) => s.exerciseId));
      const add = (ids: string[]) => ids.filter((id) => !have.has(id));
      switch (op.kind) {
        case 'add_slot':
          return { text: `Not applied: ${n(op.slot.exerciseId)}`, add: add([op.slot.exerciseId]) };
        case 'pair':
          return { text: `Not applied: ${n(op.b)} with ${n(op.a)}`, add: add([op.a, op.b]) };
        case 'remove_slot':
          return { text: `Not applied: remove ${n(op.exerciseId)}`, add: [] };
        case 'set_count':
          return { text: `Not applied: ${n(op.exerciseId)} sets`, add: [] };
      }
    }),
  };
}

/**
 * (D3, §2.3a) Today's options on Your workout as the rows show them: the day's main lifts (read on focus) with the
 * draft's own state from the snapshot (`snap.today`), so a write, an Undo or a swipe never leaves a switch or chip
 * behind (review todaylean S1). Null: not a workout Today drafted for a plan day.
 */
export function todayOptionsView(list: TodayOptions | null, snap: BuilderSnapshot): TodayOptions | null {
  const t = snap.today;
  if (list === null || t === null) return null;
  return { mainLifts: list.mainLifts.map((m) => ({ ...m, selected: m.exerciseId === t.mainLiftExerciseId })), accessories: t.accessories, abs: t.abs, supersets: t.supersets };
}

/**
 * (Ben, 26 Oct; app review finding 7) Today's options on Your workout fold into one `Options` row above the table, so
 * the exercises start at the top. Collapsed it shows only what is set: `Bench · Focused · Abs · Supersets` (the main
 * lift only when there is a choice; Abs and Supersets only when on). Values only; the row opens the full controls.
 */
export const OPTIONS_ROW_COPY = { title: 'Options' } as const;

export function todayOptionsSummary(o: TodayOptions): { text: string; accessibilityLabel: string } {
  const main = o.mainLifts.length > 1 ? (o.mainLifts.find((m) => m.selected)?.label ?? null) : null;
  // (Redesign v3 §A8) The collapsed card shows what's on: `Abs · Supersets`.
  const parts = [o.abs ? TODAY_V2_COPY.abs : null, o.supersets ? TODAY_V2_COPY.supersets : null].filter((x) => x !== null);
  const spoken = [
    main === null ? null : `${TODAY_V2_COPY.mainLift} ${main}`,
    o.accessories === null ? null : `${TODAY_V2_COPY.accessories} ${o.accessories === 'focused' ? TODAY_V2_COPY.focused : TODAY_V2_COPY.varied}`,
    `${TODAY_V2_COPY.abs} ${o.abs ? 'on' : 'off'}`,
    `${TODAY_V2_COPY.supersets} ${o.supersets ? 'on' : 'off'}`,
  ].filter((x): x is string => x !== null);
  return { text: parts.join(' · '), accessibilityLabel: `${OPTIONS_ROW_COPY.title}: ${spoken.join(', ')}` };
}

/**
 * The Time row (22 Oct; live estimate, Ben 27 Oct): the workout's estimate, its steps, and what a live fit changed (from the service's `time`). The note is
 * the biggest change: exercises left out, else sets fewer, else supersets, else shorter rests (`fitNoteOf`). Values only.
 */
export function timeRowView(snap: BuilderSnapshot): TimeRowView {
  const length = snap.setup.minutes;
  const name = (id: string) => snap.facts[id]?.name ?? 'Exercise';
  const slotName = (key: string) => name(slotsOf(snap.workout.blocks).find((s) => s.key === key)?.exerciseId ?? '');
  // One wording with Today's card (fit-to-time 22 Oct revision): rests, supersets the fit made, sets, exercises left out.
  const { note, lines } = fitNoteOf(snap.time?.changes ?? [], name, slotName);
  // (Ben, 27 Oct) The number is the workout on the page (`snap.minutes`, the shared estimate), live after every edit.
  // (Ben, 28 Oct) `+` makes the workout on the page longer: it steps from the estimate (`fitWorkoutToTime` grow).
  const live = liveTime({ estimate: snap.minutes, length, floor: Math.min(length, snap.fullMinutes ?? length), growFromEstimate: true });
  return {
    minutes: live.minutes,
    length,
    over: live.over,
    valueText: TODAY_V2_COPY.minutesValue(live.minutes),
    note,
    lines,
    // Hidden at the length it goes back to (as Today's card's Undo).
    undoMinutes: note === null || snap.time === null || snap.time.fromMinutes === length ? null : snap.time.fromMinutes,
    less: live.less,
    more: live.more,
    noteLabel: note === null ? null : `Time changes: ${note}`,
  };
}

// ---------------------------------------------------------------------------
// Exercise pop-up (§2.4)

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
  let w = 0;
  const work = workingCount(slot);
  const rows = slot.rows.map((r, i): PopupSetRow => {
    const mark = r.type === 'warmup' ? 'W' : String((n += 1));
    const spokenName = r.type === 'warmup' ? `Warm-up ${String((w += 1))}` : `Set ${mark}`;
    const kgText = loadText(r.load, slot.unit, slot.convention, slot.unit);
    // (22 Oct) A timed or cardio set: its time and distance in Reps, as saved; not typed over here.
    const timed = isTimedRow(r);
    return {
      key: String(i),
      index: i,
      mark,
      type: r.type,
      typeText: SET_TYPE_LABEL[r.type],
      reps: timed ? null : r.reps,
      repsText: timed ? timedText(r) : r.repsMax === undefined ? String(r.reps) : `${String(r.reps)}–${String(r.repsMax)}`,
      kgText,
      load: r.load,
      rpeText: r.rpe === null ? '–' : trim(r.rpe),
      rpe: r.rpe,
      done: false,
      editable: !timed,
      noRpe: r.type === 'warmup',
      canDelete: r.type === 'warmup' || work > 1,
      // The builder keeps sets in type order (warm-ups first): no set drag here.
      canMoveUp: false,
      canMoveDown: false,
      draggable: false,
      accessibilityLabel: `${spokenName}, ${SET_TYPE_LABEL[r.type]}, ${timed ? timedSpoken(r) : `${r.repsMax === undefined ? String(r.reps) : `${String(r.reps)} to ${String(r.repsMax)}`} reps`}, ${loadSpoken(r.load, slot.unit, slot.convention)}${r.rpe === null ? '' : `, RIR ${trim(Math.max(0, 10 - r.rpe))}`}`,
      spokenName,
    };
  });
  const types = new Set(slot.rows.map((r) => r.type));
  const superset = (block?.slots.length ?? 1) > 1;
  const rests: (Omit<PopupRestRow, 'canMinus' | 'canPlus'> & { kind: RestKind | 'round' })[] = superset
    ? [{ kind: 'round', label: 'After each round', seconds: restOf('round'), text: restText(restOf('round')) }]
    : [
        ...(types.has('warmup') ? [{ kind: 'warmup' as const, label: 'Warm-ups' }] : []),
        ...(types.has('top') ? [{ kind: 'top' as const, label: 'Top set' }] : []),
        ...(types.has('backoff') ? [{ kind: 'backoff' as const, label: 'Back-offs' }] : []),
        ...(types.has('working') ? [{ kind: 'working' as const, label: 'Working sets' }] : []),
        ...(types.has('drop') ? [{ kind: 'before_drop' as const, label: 'Before drop' }] : []),
      ].map((x) => ({ ...x, seconds: restOf(x.kind), text: restText(restOf(x.kind)) }));
  const steps = (x: Omit<PopupRestRow, 'canMinus' | 'canPlus'> & { kind: RestKind | 'round' }): PopupRestRow => ({ ...x, canMinus: clampBuilderRest(x.kind, x.seconds - REST_STEP_S) < x.seconds, canPlus: clampBuilderRest(x.kind, x.seconds + REST_STEP_S) > x.seconds });
  const has = (name: WorkoutRowView['actions'][number]['name']) => row?.actions.some((a) => a.name === name) === true;
  return {
    name: f?.name ?? 'Exercise',
    works: f?.works ?? null,
    kgHeader: slot.unit === 'kg' ? 'Kg' : 'Lb',
    rows,
    canAddWarmup: canAddWarmup(slot),
    canAddSet: work < BUILD_LIMITS.maxWorkingSets,
    rests: rests.map(steps),
    canMoveUp: has('move_up'),
    canMoveDown: has('move_down'),
    canSupersetNext: has('superset_next'),
    canUnlink: has('unlink'),
    mayHurt: f?.mayHurt === true,
    canSwap: true,
    deleteLabel: WORKOUT_COPY.delete,
    canDeleteExercise: true,
  };
}

/** (22 Oct) Where the pop-up's `How to` and `History` go, as the overview's rows had them; null: no link. */
export interface PopupLinks {
  howTo: { catalogueKey: string; name: string } | null;
  /** This gym's item for the exercise, else a series at this gym (ExerciseProgress). */
  history: { exerciseId: string; name: string; equipmentId?: string; gymId?: string } | null;
}

/**
 * (Rule 9; 22 Oct review) `Add anyway` on a `Not applied` line asks first when what it adds is flagged `May hurt`, as
 * the Swap and Add sheets do: `Cable fly may hurt` · `Choose another` / `Add anyway`. Null: nothing flagged. Pure.
 */
export function addAnywayConfirm(snap: Pick<BuilderSnapshot, 'facts'>, exerciseIds: readonly string[]): ReturnType<typeof swapPainConfirm> {
  const flagged = exerciseIds.filter((id) => snap.facts[id]?.mayHurt === true).map((id) => snap.facts[id]?.name ?? 'Exercise');
  return flagged.length === 0 ? null : swapPainConfirm({ name: flagged.join(' and '), mayHurt: true, painLine: null }, 'Add');
}

/**
 * The pop-up's links for one slot: `How to` when the exercise has a guide (`howToOf`, the bundled guides), `History`
 * when Ben has logged it. Pure.
 */
export function popupLinks(snap: BuilderSnapshot, slotKey: string, howToOf: (x: { exerciseId: string; exerciseName: string }) => { catalogueKey: string; name: string } | null): PopupLinks {
  const slot = slotsOf(snap.workout.blocks).find((s) => s.key === slotKey);
  if (slot === undefined) return { howTo: null, history: null };
  const f = snap.facts[slot.exerciseId];
  const name = f?.name ?? 'Exercise';
  const item = snap.items[slotKey] ?? null;
  return {
    howTo: howToOf({ exerciseId: slot.exerciseId, exerciseName: name }),
    history: f?.hasHistory === true ? { exerciseId: slot.exerciseId, name, ...(item === null ? {} : { equipmentId: item }), ...(snap.gymId === null ? {} : { gymId: snap.gymId }) } : null,
  };
}

// ---------------------------------------------------------------------------
// Coach status for Coach review (§2.9): honest, never a canned reply (rule 1). The bar is the shared `CoachAskBar`.

export type CoachBarStatus = 'ok' | 'offline' | 'not_connected';

export function coachStatusOf(status: string): CoachBarStatus {
  if (status === 'ok') return 'ok';
  if (status === 'offline') return 'offline';
  return 'not_connected';
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** `Edits from Mon 19 Oct` (§2.3) for a local date `2026-10-19`. */
/**
 * (Redesign v3 §A9, Ben 27 Oct) Earlier unused edits are offered in Your workout's `⋯`, not as status lines: one item
 * `Use earlier edits`; with more than one, each names its day (`Use edits from Sat 25 Oct`). Newest first as given.
 */
export function earlierEditsMenu(earlier: readonly { draftId: string; localDate: string }[]): { draftId: string; label: string }[] {
  if (earlier.length === 1) return earlier.map((e) => ({ draftId: e.draftId, label: WORKOUT_COPY.useEarlierEdits }));
  return earlier.map((e) => ({ draftId: e.draftId, label: `Use e${editsFromText(e.localDate).slice(1)}` }));
}

export function editsFromText(localDate: string): string {
  const [y = 0, m = 1, d = 1] = localDate.split('-').map(Number);
  // Sakamoto's weekday for the Gregorian calendar (0 = Sunday).
  const t = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
  const yy = m < 3 ? y - 1 : y;
  const w = (yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) + (t[m - 1] ?? 0) + d) % 7;
  return `Edits from ${WEEKDAYS[w] ?? ''} ${String(d)} ${MONTHS[m - 1] ?? ''}`;
}
