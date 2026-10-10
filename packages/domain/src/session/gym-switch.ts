import type {
  ChangeGymSlot,
  CommandOf,
  EquipmentInstance,
  Exercise,
  GymChange,
  GymChangeSetBefore,
  Load,
  PlannedSet,
  SessionAggregate,
  SessionExercise,
  SetValues,
  WeightUnit,
  WorkoutSet,
  ZonedTimestamp,
} from '@fizz/schemas';
import { MAX_GYM_CHANGES } from '@fizz/schemas';
import { formatNumber, repRangeText } from '../display';
import { isLoadAchievable } from '../equipment';
import { equipmentRowLine } from '../gym-editor';
import type { HistorySession } from '../progression';
import { toMs } from '../time';
import { deriveId, stableStringify } from '../stable';
import { toScaled } from '../units';
import { appendToSnapshot, currentGymEquipment, equipmentOfRow, rowIsAtCurrentGym } from './equipment-snapshot';
import { buildExecutionOrder } from './order';
import { intendedOf, plannedSnapOf, snapPlanToGym, sourceOf, type SnapResult, type SnapSlotInput, type SnapSlotResult } from './snap';
import { cardNoteText, loadWords, type NoteLine } from './snap-text';

/**
 * Mid-workout gym switch and `[Use changes today]` (gym-switch.md, GE7,
 * ADR 0019). `buildGymSwitchProposal` is `setActiveGym`'s pure core: it
 * fits every pending set to the chosen gym with `snapPlanToGym` and returns a
 * `Checks`-authored, `Today only` proposal plus the card that shows it.
 * Nothing changes until Ben taps `Switch`; then the reducer applies
 * `change_gym` in one transaction, or rejects it as stale. Done sets keep
 * their row, gym and equipment (GS6), and Undo restores everything exactly
 * while nothing has changed since.
 */

export type GymChangeMode = 'gym_switch' | 'equipment_update';

// ---------------------------------------------------------------------------
// Parts: an exercise split across gyms is one block of rows (GS6, GS-S4).

/** The first row of the exercise block a row belongs to. */
export function partRootOf(exercises: readonly SessionExercise[], rowId: string): string {
  const byId = new Map(exercises.map((e) => [e.id, e]));
  let cur = byId.get(rowId);
  const seen = new Set<string>();
  while (cur?.continuesFromId !== undefined && !seen.has(cur.id)) {
    seen.add(cur.id);
    const parent = byId.get(cur.continuesFromId);
    if (!parent) break;
    cur = parent;
  }
  return cur?.id ?? rowId;
}

/** The rows of a block, in workout order. */
export function partsOf(exercises: readonly SessionExercise[], rowId: string): SessionExercise[] {
  const root = partRootOf(exercises, rowId);
  return exercises.filter((e) => partRootOf(exercises, e.id) === root).sort((a, b) => a.order - b.order);
}

/** Live sets of a whole block in execution order (set numbers run across parts). */
export function blockSets(state: SessionAggregate, rowId: string): WorkoutSet[] {
  const order = buildExecutionOrder(state.exercises, state.sets);
  const pos = new Map(order.map((id, i) => [id, i]));
  const parts = partsOf(state.exercises, rowId);
  return parts.flatMap((p) =>
    state.sets
      .filter((s) => s.sessionExerciseId === p.id && s.status !== 'deleted')
      .sort((a, b) => (pos.get(a.id) ?? a.index + 1e6) - (pos.get(b.id) ?? b.index + 1e6)),
  );
}

/** A continuation row whose sets all moved back (after an Undo): nothing to show. */
export function isEmptyPart(state: Pick<SessionAggregate, 'sets'>, row: SessionExercise): boolean {
  return row.continuesFromId !== undefined && !state.sets.some((s) => s.sessionExerciseId === row.id && s.status !== 'deleted');
}

// ---------------------------------------------------------------------------
// Binding (GS7) and exclusions (GS11)

/**
 * What a gym change is bound to: the gym, the snapshot, every row's
 * equipment and every set's status, version and row. Logging, correcting,
 * undoing, skipping, deleting or adding a set, or any change to a target,
 * changes it; changing the active set, editing a draft or adjusting the rest
 * timer doesn't.
 */
export function planFingerprint(state: SessionAggregate): string {
  return deriveId(
    `plan:${stableStringify({
      gym: state.session.gymId,
      snapshot: state.session.equipmentSnapshot.map((e) => [e.id, e.version]),
      rows: state.exercises.map((e) => [e.id, e.equipmentId, e.equipmentVersion ?? null, e.unit, e.loadConvention, e.continuesFromId ?? null, e.order]),
      sets: state.sets.map((s) => [s.id, s.status, s.version, s.sessionExerciseId]),
    })}`,
  );
}

export type ExclusionReason = 'other_side' | 'timed';

/**
 * Pending sets a switch never refits (GS11): the other side of a half-logged
 * unilateral set (it stays with its logged side's equipment) and a set
 * whose work timer is running or paused.
 */
export function excludedFromSwitch(state: SessionAggregate): Map<string, ExclusionReason> {
  const out = new Map<string, ExclusionReason>();
  for (const s of state.sets) {
    if (s.status !== 'pending' || s.pairedWithSetId === null) continue;
    const partner = state.sets.find((p) => p.id === s.pairedWithSetId);
    if (partner?.status === 'completed') out.set(s.id, 'other_side');
  }
  const wi = state.workInterval;
  if (wi !== null && (wi.status === 'running' || wi.status === 'paused')) out.set(wi.setId, 'timed');
  return out;
}

// ---------------------------------------------------------------------------
// Proposal and card

export interface ChangeLine {
  exerciseName: string;
  /** `sets 3–4`, `set 2`, `sets 1, 3`: numbered across the exercise's parts. */
  setsLabel: string;
  /** `Target 32.5 → 20 kg each × 8–10`, or the current target when the load is dropped. */
  target: string;
  /** `→ 12 reps, no load target` for a dropped load; null otherwise. */
  after: string | null;
  notes: NoteLine[];
  /** VoiceOver: the whole line in words (gym-switch §4.7). */
  accessibilityLabel: string;
}

export interface GymSwitchCard {
  title: string;
  action: 'Switch' | 'Apply';
  author: 'Checks';
  scope: 'Today only';
  /** `⚠ Hotel · Lisbon has no equipment set up yet, …` */
  lead: NoteLine | null;
  /** Always first: logged sets, excluded sets, a replaced draft. */
  notChanged: string[];
  lines: ChangeLine[];
  /** `No change: Lateral raise, Face pull.` */
  unchanged: string | null;
  /** The one-line variants (§2.3): nothing changes, or nothing left. */
  summary: string | null;
  /** `ⓘ Hotel · Lisbon's dumbbells are typical values, not checked.` */
  unchecked: NoteLine | null;
  /** True when any target changes (voice can confirm only a card where this is false, GS9). */
  changesTargets: boolean;
  /** Lines shown on the card; the rest are on the review sheet (≥ 5 lines, §2.4). */
  visibleLines: number;
  /** `Review all 6 changes ›` when the card is cut short. */
  reviewLabel: string | null;
}

export interface GymSwitchProposal {
  kind: 'change_gym';
  author: 'checks';
  scope: 'this_session';
  mode: GymChangeMode;
  sessionId: string;
  fromGymId: string | null;
  toGymId: string;
  toGymName: string;
  /** Applied only while the workout still has this gym and fingerprint (GS7). */
  expected: { gymId: string | null; fingerprint: string };
  actionId: string;
  snapshot: EquipmentInstance[];
  slots: ChangeGymSlot[];
  snap: SnapResult;
  card: GymSwitchCard;
  /** Sets whose edited draft can't be set up there (GS12). */
  draftsToReplace: string[];
}

export interface GymSwitchInput {
  aggregate: SessionAggregate;
  mode: GymChangeMode;
  /** The chosen gym and its equipment as saved now (`getEquipmentSnapshot`). */
  gym: { id: string; name: string; equipment: readonly EquipmentInstance[] };
  /** Names of the gyms this workout used, for card wording. */
  gymNames: Readonly<Record<string, string>>;
  /** Catalogue info for each exercise in the workout (kinds it can use). Missing = the row's own kind only. */
  exercises: ReadonlyMap<string, Pick<Exercise, 'id' | 'name' | 'compatibleEquipment' | 'defaultLoadConvention'>>;
  painFlagged: ReadonlySet<string>;
  lastUsedHere?: (exerciseId: string) => string | null;
  ownerUnit: WeightUnit;
  /** IDs for the action and continuation rows. */
  newId: () => string;
}

function sameLoad(a: Load | null, b: Load | null): boolean {
  if (a === null || b === null) return a === b;
  return a.unit === b.unit && a.convention === b.convention && toScaled(a.value) === toScaled(b.value);
}

/**
 * A draft can stay only if this equipment can make it, in the same unit and
 * convention (GS12). `equipmentGone`: the exercise had equipment and the new
 * gym has none for it, so no load can be set up there.
 */
export function draftFits(draft: SetValues, eq: EquipmentInstance | null, unit: WeightUnit, convention: SessionExercise['loadConvention'], equipmentGone: boolean): boolean {
  const l = draft.load;
  if (l === null) return true;
  if (l.convention === 'bodyweight') return convention === 'bodyweight';
  if (l.unit !== unit || l.convention !== convention) return false;
  if (eq === null) return !equipmentGone;
  return isLoadAchievable(l, eq);
}

function setsLabel(numbers: readonly number[]): string {
  const sorted = [...numbers].sort((a, b) => a - b);
  if (sorted.length === 1) return `set ${String(sorted[0])}`;
  const first = sorted[0] ?? 0;
  const last = sorted[sorted.length - 1] ?? 0;
  const contiguous = sorted.every((n, i) => n === first + i);
  return contiguous ? `sets ${String(first)}–${String(last)}` : `sets ${sorted.join(', ')}`;
}

function changeTarget(
  cur: Load | null,
  next: Load | null,
  reps: PlannedSet['reps'],
  ctx: { before: EquipmentInstance | null; after: EquipmentInstance | null },
): { target: string; after: string | null } {
  const r = reps ? ` × ${repRangeText(reps)}` : '';
  if (next === null) {
    return { target: cur ? `Target ${loadWords(cur, ctx.before)}${r}` : `Target${r}`, after: `→ ${reps ? `${repRangeText(reps)} reps, ` : ''}no load target` };
  }
  if (cur === null) return { target: `Target ${loadWords(next, ctx.after)}${r}`, after: null };
  // `32.5 → 20 kg each` when only the number changes; otherwise both in full (`22.5 kg each → 45 lb each`).
  const numberOnly = cur.unit === next.unit && cur.convention === next.convention && (cur.convention === 'total' || cur.convention === 'per_hand' || cur.convention === 'stack');
  const before = numberOnly ? formatNumber(cur.value) : loadWords(cur, ctx.before);
  return { target: `Target ${before} → ${loadWords(next, ctx.after)}${r}`, after: null };
}

function spoken(line: Omit<ChangeLine, 'accessibilityLabel'>): string {
  const words = (t: string) => t.replaceAll('→', 'to').replaceAll('×', ',').replaceAll('–', ' to ').replaceAll(' kg', ' kilograms').replaceAll(' lb', ' pounds');
  return [`${line.exerciseName}, ${words(line.setsLabel)}.`, `${words(line.target)}.`, line.after ? `${words(line.after)}.` : null, ...line.notes.map((n) => n.text)]
    .filter((x): x is string => x !== null)
    .join(' ');
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** Kinds that read as "dumbbells", "plates" … in the unchecked line. */
function itemWord(eq: EquipmentInstance): string {
  return eq.kind === 'dumbbells' ? 'dumbbells' : eq.name;
}

/**
 * `setActiveGym`'s pure core: the proposal to fit this workout's pending sets
 * to `gym` (gym-switch §6.2). Completed sets aren't listed and never change.
 */
export function buildGymSwitchProposal(input: GymSwitchInput): GymSwitchProposal {
  const state = input.aggregate;
  const session = state.session;
  const excluded = excludedFromSwitch(state);
  const rows = [...state.exercises].sort((a, b) => a.order - b.order);

  const slotInputs: SnapSlotInput[] = [];
  for (const row of rows) {
    const pending = state.sets.filter((s) => s.sessionExerciseId === row.id && s.status === 'pending' && !excluded.has(s.id)).sort((a, b) => a.index - b.index);
    if (pending.length === 0) continue;
    const eq = equipmentOfRow(session.equipmentSnapshot, row);
    const info = input.exercises.get(row.exerciseId);
    const first = pending.find((s) => s.planned.snap !== undefined);
    const source = sourceOf(first?.planned.snap, eq);
    slotInputs.push({
      slotId: row.id,
      exercise: {
        id: row.exerciseId,
        name: row.exerciseName,
        compatibleEquipment: info?.compatibleEquipment ?? (source ? [source.kind] : []),
        defaultLoadConvention: info?.defaultLoadConvention ?? row.loadConvention,
      },
      sourceEquipment: source,
      unit: row.unit,
      convention: row.loadConvention,
      sets: pending.map((s) => ({ id: s.id, setType: s.setType, intended: intendedOf(s.planned), current: s.planned.load, reps: s.planned.reps, durationS: s.planned.durationS })),
    });
  }

  const snap = snapPlanToGym({
    mode: input.mode,
    slots: slotInputs,
    gym: { id: input.gym.id, name: input.gym.name, equipment: input.gym.equipment },
    ...(input.lastUsedHere ? { lastUsedHere: input.lastUsedHere } : {}),
    painFlagged: input.painFlagged,
    ownerUnit: input.ownerUnit,
  });

  const slots: ChangeGymSlot[] = snap.slots.map((slot) => ({
    sessionExerciseId: slot.slotId,
    continuationId: input.newId(),
    equipmentId: slot.equipment?.id ?? null,
    unit: slot.unit,
    loadConvention: slot.convention,
    sets: slot.sets.map((s) => ({ setId: s.id, load: s.load, snap: plannedSnapOf(s, slot, input.mode, input.gym.id) })),
  }));

  const draftsToReplace: string[] = [];
  for (const slot of snap.slots) {
    for (const s of slot.sets) {
      const set = state.sets.find((x) => x.id === s.id);
      if (set?.draft && !draftFits(set.draft, slot.equipment, slot.unit, slot.convention, slot.mapping === 'not_here')) draftsToReplace.push(s.id);
    }
  }

  return {
    kind: 'change_gym',
    author: 'checks',
    scope: 'this_session',
    mode: input.mode,
    sessionId: session.id,
    fromGymId: session.gymId,
    toGymId: input.gym.id,
    toGymName: input.gym.name,
    expected: { gymId: session.gymId, fingerprint: planFingerprint(state) },
    actionId: input.newId(),
    snapshot: [...input.gym.equipment],
    slots,
    snap,
    card: buildCard(input, snap, excluded, draftsToReplace),
    draftsToReplace,
  };
}

function buildCard(input: GymSwitchInput, snap: SnapResult, excluded: ReadonlyMap<string, ExclusionReason>, draftsToReplace: readonly string[]): GymSwitchCard {
  const state = input.aggregate;
  const session = state.session;
  const gymName = input.gym.name;
  const fromName = session.gymId === null ? 'the last gym' : (input.gymNames[session.gymId] ?? 'the last gym');
  const backTo = (session.gymChanges ?? []).some((c) => c.kind === 'change' && c.fromGymId === input.gym.id);
  const title = input.mode === 'equipment_update' ? `Use updated ${gymName}` : backTo ? `Switch back to ${gymName}` : `Switch to ${gymName}`;
  const numberOf = (setId: string): number => {
    const set = state.sets.find((s) => s.id === setId);
    return set ? blockSets(state, set.sessionExerciseId).findIndex((s) => s.id === setId) + 1 : 0;
  };

  const notChanged: string[] = [];
  const logged = state.sets.filter((s) => s.status === 'completed').length;
  if (logged > 0) notChanged.push(logged === 1 ? '1 logged set stays as it is.' : `${String(logged)} logged sets stay as they are.`);
  for (const [setId, why] of excluded) {
    const set = state.sets.find((s) => s.id === setId);
    const row = set ? state.exercises.find((e) => e.id === set.sessionExerciseId) : undefined;
    if (!set || !row) continue;
    // The other side is named by its prescribed set (the side already logged).
    const n = String(numberOf(why === 'other_side' ? (set.pairedWithSetId ?? setId) : setId));
    notChanged.push(
      why === 'timed'
        ? `${row.exerciseName} set ${n} is running. It stays as it is.`
        : `${set.side === 'right' ? 'Right' : 'Left'} side of ${row.exerciseName} set ${n} stays on ${fromName}’s equipment, to match its ${set.side === 'right' ? 'left' : 'right'} side.`,
    );
  }
  const active = session.activeSetId;
  if (active !== null && draftsToReplace.includes(active)) {
    const set = state.sets.find((s) => s.id === active);
    const n = String(numberOf(active));
    const edit = set?.draft?.load ? ` (${loadWords(set.draft.load)})` : '';
    notChanged.push(`Your edit on set ${n}${edit} can’t be set up here. Set ${n} will use the new target.`);
  }

  const lines: ChangeLine[] = [];
  const unchangedNames: string[] = [];
  for (const slot of snap.slots) {
    const changed = slot.sets.filter((s) => s.changed);
    if (changed.length === 0) {
      if (!unchangedNames.includes(slot.exerciseName)) unchangedNames.push(slot.exerciseName);
      continue;
    }
    lines.push(changeLine(state, slot, changed.map((s) => s.id), numberOf));
  }
  const pendingCount = snap.slots.reduce((n, s) => n + s.sets.length, 0);
  const changesTargets = lines.length > 0;
  const summary =
    pendingCount === 0
      ? `No sets left to update. Anything you add uses ${gymName}’s equipment.`
      : !changesTargets
        ? `${gymName} has everything for your ${String(pendingCount)} remaining ${plural(pendingCount, 'set', 'sets')}. Targets stay as they are.`
        : null;
  const usable = input.gym.equipment.filter((e) => e.availability === 'available');
  const lead =
    input.mode === 'gym_switch' && usable.length === 0
      ? { tone: 'warning' as const, text: `${gymName} has no equipment set up yet, so remaining load targets are removed.` }
      : null;
  const uncheckedItems = snap.slots.flatMap((s) => (s.equipment?.detailsSource === 'preset' ? [s.equipment] : []));
  const firstUnchecked = uncheckedItems[0];
  const unchecked = firstUnchecked
    ? { tone: 'info' as const, text: `${gymName}’s ${itemWord(firstUnchecked)} ${firstUnchecked.kind === 'dumbbells' ? 'are' : 'is'} typical values, not checked.` }
    : null;
  const many = lines.length >= 5;
  return {
    title,
    action: input.mode === 'equipment_update' ? 'Apply' : 'Switch',
    author: 'Checks',
    scope: 'Today only',
    lead,
    notChanged,
    lines,
    unchanged: changesTargets && unchangedNames.length > 0 ? `No change: ${unchangedNames.join(', ')}.` : null,
    summary,
    unchecked,
    changesTargets,
    visibleLines: many ? 3 : lines.length,
    reviewLabel: many ? `Review all ${String(lines.length)} changes ›` : null,
  };
}

function changeLine(state: SessionAggregate, slot: SnapSlotResult, changedIds: readonly string[], numberOf: (id: string) => number): ChangeLine {
  const results = slot.sets.filter((s) => changedIds.includes(s.id));
  // The line names the hardest changed set (working sets first), like the notes.
  const setOf = (id: string) => state.sets.find((s) => s.id === id);
  const working = results.filter((r) => setOf(r.id)?.setType !== 'warmup');
  const pool = working.length > 0 ? working : results;
  const top = pool[pool.length - 1] ?? results[0];
  const reps = top ? (setOf(top.id)?.planned.reps ?? null) : null;
  const row = top ? state.exercises.find((e) => e.id === setOf(top.id)?.sessionExerciseId) : undefined;
  const { target, after } = changeTarget(top?.current ?? null, top?.load ?? null, reps, {
    before: row ? equipmentOfRow(state.session.equipmentSnapshot, row) : null,
    after: slot.equipment,
  });
  const notes = slot.notes
    .filter((n) => n.kind !== 'rounded' || results.some((r) => r.outcome === 'rounded'))
    .map((n) => cardNoteText(n, slot))
    .filter((n): n is NoteLine => n !== null);
  const base = { exerciseName: slot.exerciseName, setsLabel: setsLabel(changedIds.map(numberOf)), target, after, notes };
  return { ...base, accessibilityLabel: spoken(base) };
}

/** The `change_gym` command for `Switch` (one opId per tap intent; `Try again` reuses it). */
export function changeGymCommand(p: GymSwitchProposal, opId: string, at: ZonedTimestamp): CommandOf<'change_gym'> {
  return { type: 'change_gym', at, opId, actionId: p.actionId, mode: p.mode, toGymId: p.toGymId, snapshot: p.snapshot, expected: p.expected, slots: p.slots };
}

/** True when the workout no longer matches what the proposal was checked against (Out of date, GS7). */
export function isProposalStale(p: GymSwitchProposal, state: SessionAggregate): boolean {
  return state.session.id !== p.sessionId || state.session.status !== 'active' || state.session.gymId !== p.expected.gymId || planFingerprint(state) !== p.expected.fingerprint;
}

/**
 * The gyms a workout was at, in order (an undone switch doesn't count; a
 * same-gym `[Use changes today]` isn't a move). One entry for a workout that
 * never switched.
 */
export function gymRouteIds(session: Pick<SessionAggregate['session'], 'gymId' | 'gymChanges'>): string[] {
  const changes = session.gymChanges ?? [];
  const first = changes[0];
  if (first === undefined) return session.gymId === null ? [] : [session.gymId];
  const kept: GymChange[] = [];
  for (const c of changes) {
    if (c.kind === 'undo') {
      const i = kept.findIndex((k) => k.actionId === c.undoOf);
      if (i >= 0) kept.splice(i, 1);
    } else if (c.mode === 'gym_switch') kept.push(c);
  }
  const ids = [first.fromGymId, ...kept.map((c) => c.toGymId)].filter((x): x is string => x !== null);
  return ids.filter((x, i) => i === 0 || ids[i - 1] !== x);
}

/** The change Undo would revert: the latest entry, if it's a change and not yet undone. */
export function latestUndoableGymChange(state: SessionAggregate): GymChange | null {
  const last = state.session.gymChanges?.at(-1);
  return last?.kind === 'change' && last.before !== undefined ? last : null;
}

// ---------------------------------------------------------------------------
// Applying (reducer helpers; pure)

export type GymApply =
  | { ok: true; state: SessionAggregate; entry: GymChange }
  | { ok: false; code: 'stale_version' | 'invalid_values' | 'equipment_not_found' | 'set_not_pending' | 'exercise_not_found' | 'gym_change_not_found'; message: string };

const bad = (code: Extract<GymApply, { ok: false }>['code'], message: string): GymApply => ({ ok: false, code, message });

/** A row on the latest version of its item (no pin). */
function latestVersionOf(row: SessionExercise): SessionExercise {
  const next = { ...row };
  delete next.equipmentVersion;
  return next;
}

function sameEquipment(row: SessionExercise, snapshot: readonly EquipmentInstance[], slot: ChangeGymSlot, eq: EquipmentInstance | null): boolean {
  const current = equipmentOfRow(snapshot, row);
  return row.unit === slot.unit && row.loadConvention === slot.loadConvention && (current?.id ?? null) === (eq?.id ?? null) && (current?.version ?? null) === (eq?.version ?? null);
}

/** gym-switch §4.3 as one state change. Rejects stale or unachievable input (rules 4 and 5). */
export function applyChangeGym(state: SessionAggregate, cmd: CommandOf<'change_gym'>): GymApply {
  const session = state.session;
  if (cmd.mode === 'gym_switch' && cmd.toGymId === session.gymId) return bad('invalid_values', 'The workout is already at that gym.');
  if (cmd.mode === 'equipment_update' && cmd.toGymId !== session.gymId) return bad('invalid_values', 'Updated equipment can only be used at the workout’s own gym.');
  if (cmd.expected.gymId !== session.gymId || cmd.expected.fingerprint !== planFingerprint(state)) {
    return bad('stale_version', 'Out of date. Your workout changed since this was checked.');
  }
  if (cmd.snapshot.some((e) => e.gymId !== cmd.toGymId)) return bad('invalid_values', 'That equipment belongs to another gym.');
  // A change and its Undo are two records; refuse one that couldn't be undone (review N5).
  if ((session.gymChanges?.length ?? 0) + 2 > MAX_GYM_CHANGES) return bad('invalid_values', 'This workout has changed gym too many times. Finish it and start a new one at this gym.');

  const excluded = excludedFromSwitch(state);
  const pending = state.sets.filter((s) => s.status === 'pending' && !excluded.has(s.id));
  const slotOfSet = new Map<string, ChangeGymSlot>();
  for (const slot of cmd.slots) {
    const row = state.exercises.find((e) => e.id === slot.sessionExerciseId);
    if (!row) return bad('exercise_not_found', 'Exercise not found in this workout.');
    for (const item of slot.sets) {
      const set = state.sets.find((s) => s.id === item.setId);
      if (!set || set.sessionExerciseId !== row.id) return bad('invalid_values', 'A set in the change isn’t in that exercise.');
      if (set.status !== 'pending' || excluded.has(set.id)) return bad('set_not_pending', 'Only sets not done yet can change.');
      if (slotOfSet.has(set.id)) return bad('invalid_values', 'A set appears twice in the change.');
      slotOfSet.set(set.id, slot);
    }
  }
  if (slotOfSet.size !== pending.length) return bad('invalid_values', 'Every set not done yet must be fitted to the new gym.');

  // Rule 4: every target is achievable on its slot's equipment at the new gym.
  const equipmentFor = new Map<string, EquipmentInstance | null>();
  for (const slot of cmd.slots) {
    let eq: EquipmentInstance | null = null;
    if (slot.equipmentId !== null) {
      eq = cmd.snapshot.find((e) => e.id === slot.equipmentId) ?? null;
      if (!eq || eq.availability !== 'available') return bad('equipment_not_found', 'That equipment isn’t at this gym.');
      if (eq.unit !== slot.unit || eq.loadConvention !== slot.loadConvention) return bad('invalid_values', `Targets on ${eq.name} must be in ${eq.unit} (${eq.loadConvention}).`);
    }
    equipmentFor.set(slot.sessionExerciseId, eq);
    // An exercise that had equipment and has none here can't carry a load target: nothing here
    // can check it (rule 4; review M1). `snapPlanToGym` drops those loads; so must any other caller.
    const row = state.exercises.find((e) => e.id === slot.sessionExerciseId);
    for (const item of slot.sets) {
      const l = item.load;
      if (l === null) continue;
      if (eq === null && l.convention !== 'bodyweight') {
        const set = state.sets.find((s) => s.id === item.setId);
        const hadEquipment = (row?.equipmentId ?? null) !== null || (set?.planned.snap?.intendedOn?.equipmentId ?? null) !== null;
        if (hadEquipment) return bad('invalid_values', 'There’s no equipment here to check that load against.');
      }
      if (l.unit !== slot.unit || l.convention !== slot.loadConvention) return bad('invalid_values', 'A target is in the wrong unit or convention for its equipment.');
      if (eq !== null && !isLoadAchievable(l, eq)) return bad('invalid_values', `${loadWords(l)} can’t be made on ${eq.name}.`);
    }
  }

  const { snapshot, newerVersionOf } = appendToSnapshot(session.equipmentSnapshot, cmd.snapshot);
  // Rows on an item that gained a newer version keep resolving the one they used (GS-S3).
  let exercises: SessionExercise[] = state.exercises.map((e) =>
    e.equipmentId !== null && e.equipmentVersion === undefined && newerVersionOf.has(e.equipmentId) ? { ...e, equipmentVersion: newerVersionOf.get(e.equipmentId) ?? 1 } : e,
  );
  const before: { exercises: SessionExercise[]; sets: GymChangeSetBefore[] } = { exercises: exercises.map((e) => ({ ...e })), sets: [] };
  const moveTo = new Map<string, string>();
  const inserted: { after: string; row: SessionExercise }[] = [];
  for (const slot of cmd.slots) {
    const row = exercises.find((e) => e.id === slot.sessionExerciseId);
    if (!row) return bad('exercise_not_found', 'Exercise not found in this workout.');
    const eq = equipmentFor.get(slot.sessionExerciseId) ?? null;
    if (sameEquipment(row, snapshot, slot, eq)) continue; // only targets change
    const target = { equipmentId: eq?.id ?? null, unit: slot.unit, loadConvention: slot.loadConvention };
    const keepsOld = state.sets.some((s) => s.sessionExerciseId === row.id && (s.status === 'completed' || s.status === 'skipped' || (s.status === 'pending' && excluded.has(s.id))));
    const ids = slot.sets.map((x) => x.setId);
    if (keepsOld) {
      // GS6: done sets keep their row and equipment; the pending ones continue on a new row.
      if (exercises.some((e) => e.id === slot.continuationId) || inserted.some((x) => x.row.id === slot.continuationId)) return bad('invalid_values', 'That exercise ID is already used.');
      inserted.push({ after: row.id, row: latestVersionOf({ ...row, id: slot.continuationId, ...target, continuesFromId: row.id }) });
      for (const id of ids) moveTo.set(id, slot.continuationId);
      continue;
    }
    const parent = row.continuesFromId === undefined ? undefined : exercises.find((e) => e.id === row.continuesFromId);
    if (parent && sameEquipment(parent, snapshot, slot, eq)) {
      // Back on the equipment of the part before: the sets rejoin it.
      for (const id of ids) moveTo.set(id, parent.id);
      continue;
    }
    exercises = exercises.map((e) => (e.id === row.id ? latestVersionOf({ ...e, ...target }) : e));
  }
  // Continuation rows sit right after the row they continue; order is renumbered to match.
  const ordered: SessionExercise[] = [];
  for (const e of [...exercises].sort((a, b) => a.order - b.order)) {
    ordered.push(e);
    for (const ins of inserted.filter((x) => x.after === e.id)) ordered.push(ins.row);
  }
  exercises = ordered.map((e, i) => (e.order === i ? e : { ...e, order: i }));

  const changedSetIds: string[] = [];
  const draftsReplaced: string[] = [];
  const sets = state.sets.map((s) => {
    const slot = slotOfSet.get(s.id);
    if (!slot) return s;
    const item = slot.sets.find((x) => x.setId === s.id);
    if (!item) return s;
    before.sets.push({ id: s.id, sessionExerciseId: s.sessionExerciseId, planned: s.planned, draft: s.draft });
    const eq = equipmentFor.get(slot.sessionExerciseId) ?? null;
    const planned: PlannedSet = { ...s.planned, load: item.load };
    if (item.snap === null) delete planned.snap;
    else planned.snap = item.snap;
    if (!sameLoad(item.load, s.planned.load)) changedSetIds.push(s.id);
    let draft = s.draft;
    const hadEquipment = state.exercises.find((e) => e.id === s.sessionExerciseId)?.equipmentId != null;
    if (draft !== null && !draftFits(draft, eq, slot.unit, slot.loadConvention, hadEquipment && eq === null)) {
      draft = null;
      draftsReplaced.push(s.id);
    }
    return { ...s, sessionExerciseId: moveTo.get(s.id) ?? s.sessionExerciseId, planned, draft, version: s.version + 1 };
  });

  const next: SessionAggregate = {
    ...state,
    exercises,
    sets,
    session: { ...session, gymId: cmd.toGymId, equipmentSnapshot: snapshot, version: session.version + 1 },
  };
  const entry: GymChange = {
    actionId: cmd.actionId,
    opId: cmd.opId,
    kind: 'change',
    mode: cmd.mode,
    at: cmd.at,
    fromGymId: session.gymId,
    toGymId: cmd.toGymId,
    afterFingerprint: planFingerprint(next),
    changedSetIds,
    draftsReplaced,
    equipment: cmd.snapshot.map((e) => ({ id: e.id, version: e.version })),
    before,
  };
  return { ok: true, state: { ...next, session: { ...next.session, gymChanges: [...(session.gymChanges ?? []), entry] } }, entry };
}

/** gym-switch §4.5: restore the gym, rows, targets and drafts exactly, only while nothing changed since. */
export function applyUndoChangeGym(state: SessionAggregate, cmd: CommandOf<'undo_change_gym'>): GymApply {
  const changes = state.session.gymChanges ?? [];
  const entry = changes.find((c) => c.actionId === cmd.actionId && c.kind === 'change');
  if (!entry?.before || entry.fromGymId === null) return bad('gym_change_not_found', 'That gym change wasn’t found.');
  if (changes.at(-1) !== entry) return bad('stale_version', 'Can’t undo: the gym changed again since the switch.');
  if (cmd.expectedFingerprint !== entry.afterFingerprint || planFingerprint(state) !== entry.afterFingerprint) {
    return bad('stale_version', 'Can’t undo: your workout changed since the switch.');
  }
  const beforeRows = new Map(entry.before.exercises.map((e) => [e.id, e]));
  let tail = Math.max(-1, ...entry.before.exercises.map((e) => e.order));
  // Rows are never deleted (the store keeps every row): a continuation this change made is left empty, after the rest.
  const exercises = [...entry.before.exercises, ...state.exercises.filter((e) => !beforeRows.has(e.id)).map((e) => ({ ...e, order: (tail += 1) }))];
  const beforeSets = new Map(entry.before.sets.map((s) => [s.id, s]));
  const sets = state.sets.map((s) => {
    const b = beforeSets.get(s.id);
    return b ? { ...s, sessionExerciseId: b.sessionExerciseId, planned: b.planned, draft: b.draft, version: s.version + 1 } : s;
  });
  const next: SessionAggregate = { ...state, exercises, sets, session: { ...state.session, gymId: entry.fromGymId, version: state.session.version + 1 } };
  const undo: GymChange = {
    actionId: `undo:${entry.actionId}`,
    opId: cmd.opId,
    kind: 'undo',
    mode: entry.mode,
    at: cmd.at,
    fromGymId: entry.toGymId,
    toGymId: entry.fromGymId,
    undoOf: entry.actionId,
    afterFingerprint: planFingerprint(next),
    changedSetIds: entry.changedSetIds,
    draftsReplaced: [],
  };
  return { ok: true, state: { ...next, session: { ...next.session, gymChanges: [...changes, undo] } }, entry: undo };
}

// ---------------------------------------------------------------------------
// Helpers for the service layer (pure)

/**
 * Whether an unsaved entry still fits its set's equipment now (GS12; review M3): after a
 * switch, an edit the new gym can't make is replaced by the new target, like a stored draft.
 */
export function editFitsCurrentEquipment(state: SessionAggregate, setId: string, values: SetValues): boolean {
  const set = state.sets.find((s) => s.id === setId);
  const row = set ? state.exercises.find((e) => e.id === set.sessionExerciseId) : undefined;
  if (!set || !row) return true;
  const eq = equipmentOfRow(state.session.equipmentSnapshot, row);
  const gone = row.equipmentId === null && (set.planned.snap?.intendedOn?.equipmentId ?? null) !== null;
  return draftFits(values, eq, row.unit, row.loadConvention, gone);
}

/** GS3 step 2: the item an exercise last used at this gym (logged in the app, not imported). */
export function lastUsedAtGym(history: readonly HistorySession[], gymId: string): string | null {
  const here = history.filter((h) => !h.imported && h.gymId === gymId && h.equipmentId !== null && h.sets.length > 0);
  here.sort((a, b) => toMs(b.performedAtUtc) - toMs(a.performedAtUtc));
  return here[0]?.equipmentId ?? null;
}

/** `Why?` on the switch card (gym-switch §4.2): what the check used, every note, what didn't change. No AI. */
export function gymSwitchEvidence(p: GymSwitchProposal): { used: string[]; checks: string[]; notChanged: string[] } {
  const usable = p.snapshot.filter((e) => e.availability === 'available');
  return {
    used:
      usable.length === 0
        ? [`${p.toGymName} has no equipment set up.`]
        : usable.map((e) => `${e.name}: ${equipmentRowLine(e)}${e.detailsSource === 'preset' ? ' (typical values, not checked)' : ''}`),
    checks: p.card.lines.flatMap((l) => l.notes.map((n) => `${l.exerciseName}: ${n.text}`)),
    notChanged: [...p.card.notChanged, ...(p.card.unchanged ? [p.card.unchanged] : [])],
  };
}

/**
 * `Add set` after a switch on an exercise whose row is on another gym's item
 * (gym-switch §4.3): a continuation row at the current gym, with the copied
 * target fitted by `snapPlanToGym`. Null when the row is at the current gym
 * (a plain `add_set` copies the target as before).
 */
export function buildAddSetContinuation(
  state: SessionAggregate,
  sessionExerciseId: string,
  ctx: {
    exercise: Pick<Exercise, 'id' | 'name' | 'compatibleEquipment' | 'defaultLoadConvention'> | null;
    gymName: string;
    painFlagged: ReadonlySet<string>;
    ownerUnit: WeightUnit;
    lastUsedHere?: (exerciseId: string) => string | null;
    newId: () => string;
  },
): NonNullable<CommandOf<'add_set'>['continuation']> | null {
  const row = state.exercises.find((e) => e.id === sessionExerciseId);
  if (!row || rowIsAtCurrentGym(state.session, row) || state.session.gymId === null) return null;
  const template = state.sets.filter((s) => s.sessionExerciseId === row.id && s.status !== 'deleted').sort((a, b) => a.index - b.index).at(-1);
  if (!template) return null;
  const source = sourceOf(template.planned.snap, equipmentOfRow(state.session.equipmentSnapshot, row));
  const snap = snapPlanToGym({
    mode: 'gym_switch',
    slots: [
      {
        slotId: row.id,
        exercise: {
          id: row.exerciseId,
          name: row.exerciseName,
          compatibleEquipment: ctx.exercise?.compatibleEquipment ?? (source ? [source.kind] : []),
          defaultLoadConvention: ctx.exercise?.defaultLoadConvention ?? row.loadConvention,
        },
        sourceEquipment: source,
        unit: row.unit,
        convention: row.loadConvention,
        sets: [{ id: template.id, setType: template.setType, intended: intendedOf(template.planned), current: template.planned.load, reps: template.planned.reps, durationS: template.planned.durationS }],
      },
    ],
    gym: { id: state.session.gymId, name: ctx.gymName, equipment: currentGymEquipment(state.session) },
    ...(ctx.lastUsedHere ? { lastUsedHere: ctx.lastUsedHere } : {}),
    painFlagged: ctx.painFlagged,
    ownerUnit: ctx.ownerUnit,
  });
  const slot = snap.slots[0];
  const fitted = slot?.sets[0];
  if (!slot || !fitted) return null;
  const planned: PlannedSet = { ...template.planned, load: fitted.load };
  const fit = plannedSnapOf(fitted, slot, 'gym_switch', state.session.gymId);
  if (fit === null) delete planned.snap;
  else planned.snap = fit;
  return { id: ctx.newId(), equipmentId: slot.equipment?.id ?? null, unit: slot.unit, loadConvention: slot.convention, planned };
}
