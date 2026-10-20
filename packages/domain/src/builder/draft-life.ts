import {
  MAX_WORKOUT_DRAFT_OPS,
  MAX_WORKOUT_DRAFT_VERSIONS,
  builderDraftKeyText,
  slotRev,
  type BuildDay,
  type BuildFocus,
  type BuilderDraftKey,
  type BuilderSetup,
  type DraftPlan,
  type WorkoutDraft,
  type WorkoutDraftVersion,
  type ZonedTimestamp,
} from '@fizz/schemas';
import { coachDraftExpiry, currentDraftVersion, type DraftLifeChange } from '../session/coach-draft';
import { toMs } from '../time';

/**
 * Builder drafts' life (workout-builder-v3 §4.4). Pure; persistence decides
 * these inside the write transaction against the draft as stored.
 *
 * - Manual edits bump `WorkoutDraft.version` in place (the current version's
 *   plan and set-up change); a rebuild (Day, Main lift or Variation changed)
 *   is a new version.
 * - Every write records its op ID: a retry is `duplicate`, nothing more.
 * - Staleness (rule 5): an edit names either the draft version it was made
 *   on, or only the slots it touches with their revisions; it is refused
 *   only when one of those moved.
 * - `undo` on the draft holds the state before the last undoable edit, so
 *   Undo survives a force-close; it applies only at the version that edit
 *   left.
 */

/** What an edit was made on: the draft's version, or (narrower) the slots it touches. */
export type BuilderEditBasis = { version: number } | { slots: readonly { slotKey: string; rev: number }[] };

export interface NewBuilderDraftInput {
  id: string;
  ownerId: string;
  opId: string;
  /** The version's action ID (a UUID derived from the op ID). */
  actionId: string;
  name: string;
  key: BuilderDraftKey;
  setup: BuilderSetup;
  plan: DraftPlan;
  focus: BuildFocus;
  day?: BuildDay;
  gymId: string | null;
  equipmentVersion: string;
  contextHash: string;
  at: ZonedTimestamp;
}

function version(input: { n: number; parentN: number | null; actionId: string; setup: BuilderSetup; plan: DraftPlan; focus: BuildFocus; day?: BuildDay | undefined; gymId: string | null; equipmentVersion: string; contextHash: string; at: ZonedTimestamp }): WorkoutDraftVersion {
  return {
    n: input.n,
    parentN: input.parentN,
    status: 'current',
    actionId: input.actionId,
    turnId: 'manual',
    request: { text: '', minutes: input.setup.minutes, focus: input.focus, gymId: input.gymId, origin: 'builder', ...(input.day === undefined ? {} : { day: input.day }), setup: input.setup },
    rawArgs: '',
    plan: input.plan,
    fitMinutes: input.setup.minutes,
    checks: [],
    rationale: null,
    contextHash: input.contextHash,
    equipmentVersion: input.equipmentVersion,
    createdAt: input.at,
  };
}

/** `newBuilderDraft`: an open builder draft, version 1, its own op ID recorded. */
export function newBuilderDraft(i: NewBuilderDraftInput): WorkoutDraft {
  return {
    id: i.id,
    ownerId: i.ownerId,
    status: 'open',
    name: i.name,
    currentVersion: 1,
    versions: [version({ n: 1, parentN: null, actionId: i.actionId, setup: i.setup, plan: i.plan, focus: i.focus, day: i.day, gymId: i.gymId, equipmentVersion: i.equipmentVersion, contextHash: i.contextHash, at: i.at })],
    sessionId: null,
    startedAtUtc: null,
    routineId: null,
    discardedAtUtc: null,
    opIds: [i.opId],
    createdAt: i.at,
    tz: i.at.tz,
    expiresAtUtc: coachDraftExpiry(i.at.utc),
    version: 1,
    updatedAtUtc: i.at.utc,
    builderKey: i.key,
    undo: null,
  };
}

/** The set-up a builder draft's current version records. */
export function builderSetupOf(d: Pick<WorkoutDraft, 'versions' | 'currentVersion'>): BuilderSetup | null {
  return currentDraftVersion(d).request.setup ?? null;
}

function staleAgainst(current: WorkoutDraft, basis: BuilderEditBasis): boolean {
  if ('version' in basis) return basis.version !== current.version;
  const slots = new Map(currentDraftVersion(current).plan.slots.map((s) => [s.slotKey, slotRev(s)]));
  return basis.slots.some((x) => slots.get(x.slotKey) !== x.rev);
}

function closedOrDue(current: WorkoutDraft, nowUtc: string): boolean {
  return current.status !== 'open' || toMs(nowUtc) >= toMs(current.expiresAtUtc);
}

export interface BuilderDraftEdit {
  opId: string;
  at: ZonedTimestamp;
  basis: BuilderEditBasis;
  plan: DraftPlan;
  setup: BuilderSetup;
  /** The draft's code-made name after the edit (`Chest · Bench`). */
  name?: string;
  /** A rebuild: a new version (§4.4); else the current one changes in place. */
  rebuild?: { actionId: string; focus: BuildFocus; day?: BuildDay; gymId: string | null; equipmentVersion: string; contextHash: string; /** The key for the new Day / Main lift (review B1); Undo puts the old one back. */ key?: BuilderDraftKey };
  /** Keep the state before this edit for Undo (false: the edit clears any older Undo). */
  undoable: boolean;
  /** (§2.3 `Gym changed`) The version's gym moves in place; Undo puts the old one back. */
  gymId?: string | null;
  /** The set-up Undo restores, when it isn't the current one as is (`Gym changed`: it marks the gym kept). */
  undoSetup?: BuilderSetup;
}

/**
 * `builderDraftEdit`: one of Ben's builder writes, decided against the
 * stored draft. `plan` and `setup` are the result the caller computed from
 * the draft it read; a stale basis writes nothing.
 */
export function builderDraftEdit(current: WorkoutDraft, e: BuilderDraftEdit): DraftLifeChange {
  if (current.opIds.includes(e.opId)) return { kind: 'duplicate', current };
  if (current.builderKey === undefined) return { kind: 'invalid', reason: 'not a builder draft' };
  if (closedOrDue(current, e.at.utc)) return { kind: 'closed', current };
  if (staleAgainst(current, e.basis)) return { kind: 'stale', current };
  const cur = currentDraftVersion(current);
  const keyMoved = e.rebuild?.key !== undefined && builderDraftKeyText(e.rebuild.key) !== builderDraftKeyText(current.builderKey);
  const gymMoved = e.rebuild === undefined && e.gymId !== undefined && e.gymId !== cur.request.gymId;
  const before = { currentVersion: current.currentVersion, setup: e.undoSetup ?? cur.request.setup ?? null, plan: cur.plan, ...(keyMoved ? { key: current.builderKey } : {}), ...(gymMoved ? { gymId: cur.request.gymId } : {}) };
  let versions: WorkoutDraftVersion[];
  let currentVersion = current.currentVersion;
  if (e.rebuild !== undefined) {
    const n = Math.max(...current.versions.map((v) => v.n)) + 1;
    const next = version({ n, parentN: current.currentVersion, actionId: e.rebuild.actionId, setup: e.setup, plan: e.plan, focus: e.rebuild.focus, day: e.rebuild.day, gymId: e.rebuild.gymId, equipmentVersion: e.rebuild.equipmentVersion, contextHash: e.rebuild.contextHash, at: e.at });
    versions = [...current.versions.map((v): WorkoutDraftVersion => (v.status === 'current' ? { ...v, status: 'replaced' } : v)), next];
    // Under the cap: the oldest replaced versions go first (the current and its parent stay for Undo).
    while (versions.length > MAX_WORKOUT_DRAFT_VERSIONS) {
      const drop = versions.findIndex((v) => v.status === 'replaced' && v.n !== current.currentVersion);
      if (drop < 0) break;
      versions.splice(drop, 1);
    }
    currentVersion = n;
  } else {
    versions = current.versions.map((v): WorkoutDraftVersion => (v.n === current.currentVersion ? { ...v, plan: e.plan, fitMinutes: e.setup.minutes, request: { ...v.request, minutes: e.setup.minutes, setup: e.setup, ...(gymMoved ? { gymId: e.gymId ?? null } : {}) } } : v));
  }
  const nextVersion = current.version + 1;
  const next: WorkoutDraft = {
    ...current,
    ...(e.name === undefined ? {} : { name: e.name }),
    ...(keyMoved && e.rebuild?.key !== undefined ? { builderKey: e.rebuild.key } : {}),
    versions,
    currentVersion,
    opIds: [...current.opIds, e.opId].slice(-MAX_WORKOUT_DRAFT_OPS),
    version: nextVersion,
    updatedAtUtc: e.at.utc,
    undo: e.undoable ? { opId: e.opId, atVersion: nextVersion, snapshot: before } : null,
  };
  return { kind: 'write', next, expectedVersion: current.version };
}

/** Why Undo can't run: nothing to undo, or something changed since that edit (rule 5). */
export type BuilderUndoRefusal = 'nothing' | 'changed_since';

/**
 * `builderDraftUndo`: puts back the state before the edit `undoOpId`, only
 * while the draft is still at the version that edit left. A rebuild's Undo
 * restores both pages (the previous version becomes current again).
 */
export function builderDraftUndo(current: WorkoutDraft, u: { opId: string; undoOpId: string; at: ZonedTimestamp; /** The name for the restored set-up (code-made). */ name?: string }): DraftLifeChange | { kind: 'refused'; reason: BuilderUndoRefusal; current: WorkoutDraft } {
  if (current.opIds.includes(u.opId)) return { kind: 'duplicate', current };
  if (closedOrDue(current, u.at.utc)) return { kind: 'closed', current };
  const undo = current.undo ?? null;
  if (undo === null || undo.opId !== u.undoOpId) return { kind: 'refused', reason: 'nothing', current };
  if (undo.atVersion !== current.version) return { kind: 'refused', reason: 'changed_since', current };
  const back = undo.snapshot;
  const rebuilt = back.currentVersion !== current.currentVersion && current.versions.some((v) => v.n === back.currentVersion);
  const versions = rebuilt
    ? current.versions.filter((v) => v.n !== current.currentVersion).map((v): WorkoutDraftVersion => (v.n === back.currentVersion ? { ...v, status: 'current' } : v))
    : current.versions.map((v): WorkoutDraftVersion =>
        v.n === current.currentVersion
          ? { ...v, plan: back.plan, ...(back.setup === null ? {} : { fitMinutes: back.setup.minutes, request: { ...v.request, minutes: back.setup.minutes, setup: back.setup, ...(back.gymId === undefined ? {} : { gymId: back.gymId }) } }) }
          : v,
      );
  const next: WorkoutDraft = {
    ...current,
    ...(u.name === undefined ? {} : { name: u.name }),
    ...(back.key === undefined ? {} : { builderKey: back.key }),
    versions,
    currentVersion: rebuilt ? back.currentVersion : current.currentVersion,
    opIds: [...current.opIds, u.opId].slice(-MAX_WORKOUT_DRAFT_OPS),
    version: current.version + 1,
    updatedAtUtc: u.at.utc,
    undo: null,
  };
  return { kind: 'write', next, expectedVersion: current.version };
}
