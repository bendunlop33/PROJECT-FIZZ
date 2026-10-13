import {
  applyImportSpec,
  buildImportSample,
  buildLayoutReview,
  detectLayoutFile,
  displacedBy,
  fingerprintOf,
  localDateOf,
  remapLayout,
  roleRefusal,
  stableStringify,
  toMs,
  validateImportSpec,
  type BuiltSample,
  type LayoutReview,
  type NotReadableReason,
  type Table,
} from '@fizz/domain';
import { buildImportLayoutRequest, IMPORT_LAYOUT_INSTRUCTIONS_V1, importLayoutFailure, requestImportLayout, type CoachModelPort } from '@fizz/coach';
import { layoutInUse, sha256Hex, type Store } from '@fizz/persistence';
import {
  EMPTY_LAYOUT_ANSWERS,
  LayoutAnswersSchema,
  validate,
  type ImportCoachUnavailable,
  type ImportLayoutRequest,
  type ImportMappingSpecV1,
  type ImportProfile,
  type LayoutAnswers,
  type LayoutRole,
  type MarkerMeaning,
  type NotationAnswer,
  type SessionAggregate,
  type SpecCheckFailure,
  type UserProfile,
  type WeightUnit,
  type ZonedTimestamp,
} from '@fizz/schemas';
import type { DraftLayout, ImportBlock, ImportService, OpenResult } from './import-service';

/**
 * Import from any app (data-import-export §9, ADR 0026): orchestration only.
 * Detection, the sample, the checks, the review and the reading of every row
 * are pure (`@fizz/domain` import/layout); the request is `@fizz/coach`'s
 * `import-reader` (not a coach turn, AI9); storage is `@fizz/persistence`.
 * No React Native here, so the whole flow runs on Linux against real SQLite.
 *
 * - **Offline first (rule 1).** FitNotes and saved layouts never need the
 *   coach. A new layout with the coach unusable stops with its reason and
 *   sends nothing (check 34).
 * - **One route (rule 7, Q3).** The request uses the coach's ChatGPT-plan
 *   port and the coach's own status. There is no other route to switch to.
 * - **Exactly what Ben saw (AI8, check 36).** The request sends the stored
 *   `sampleJson`; a hash that differs from the one shown is refused.
 * - **Idempotent (rule 5).** A request is stored under its operation ID: a
 *   repeat sends nothing; a layout that arrived before an interruption is
 *   reused. Every layout change bumps `layoutVersion`; a stale one is refused.
 * - **The file is data (rule 8).** The model returns a typed layout only;
 *   code checks it against every row and Ben confirms each `Check`. No model
 *   text is kept or shown (AI11).
 * - Nothing here imports anything: `confirm` opens the shared preview, and
 *   only its commit writes workouts (with `Undo this import`).
 */

/** What the coach port and status are, from the same sources the coach uses (ADR 0026 §1). */
export interface ImportCoachPorts {
  /** The coach's own status (`CoachService.availability`): `ok` with a model, or why not. */
  availability: () => Promise<{ status: string; model: string | null }>;
  /** The ChatGPT-plan model port. Absent: the coach isn't in this build's wiring (not connected). */
  model?: () => CoachModelPort;
}

export interface LayoutServiceDeps {
  store: () => Store;
  now: () => ZonedTimestamp;
  newId: () => string;
  profile: () => Promise<UserProfile | null>;
  activeWorkout: () => Promise<SessionAggregate | null>;
  imports: ImportService;
  coach: ImportCoachPorts;
  /** The request's time limit (tests shorten it). */
  timeoutMs?: number;
}

/** §9.3.2: the coach's state for a layout request. Every state but `ready` sends nothing and switches nothing. */
export interface ImportCoachStatus {
  route: 'chatgpt_plan' | null;
  state: 'ready' | ImportCoachUnavailable;
}

export function importCoachStateOf(status: string, hasPort: boolean): ImportCoachStatus['state'] {
  if (!hasPort) return 'not_connected';
  switch (status) {
    case 'ok':
      return 'ready';
    case 'offline':
      return 'offline';
    case 'expired':
    case 'no_scope':
      return 'signed_out';
    case 'limit':
      return 'limit';
    case 'model_gone':
    case 'no_model':
      return 'model_unavailable';
    default:
      return 'not_connected';
  }
}

export type PreviewImportResult =
  | { kind: 'no_profile' }
  | { kind: 'blocked'; block: ImportBlock }
  /** The built-in FitNotes path, offline (unchanged). */
  | { kind: 'fitnotes'; result: OpenResult }
  | { kind: 'not_readable'; reason: NotReadableReason; firstLine: string | null }
  /** A table nobody has read yet: consent (`New file layout`), or `Needs the coach`. */
  | {
      kind: 'new_table';
      layoutId: string;
      fileName: string;
      columns: number;
      rows: number;
      firstLine: string;
      coach: ImportCoachStatus;
      /** A layout for this exact sample arrived earlier (before an interruption): reused, nothing sent again. */
      reused: boolean;
      /** The last request for this sample was cut off (the app was left or closed): `Interrupted.` */
      interrupted: boolean;
      /** Saved layouts that can't be read (`⚠ Layout "x" is damaged`), never used. */
      damaged: (string | null)[];
    }
  /** A saved layout, same columns, everything answered: straight to the preview, offline. */
  | { kind: 'saved_layout'; layoutId: string; profileName: string; result: OpenResult }
  /** A saved layout, same columns, with something new to answer (a new marker): Check the layout, offline. */
  | { kind: 'saved_layout_review'; layoutId: string; profileName: string }
  /** A saved layout with added or missing columns: Changed columns, offline. */
  | { kind: 'saved_layout_changed'; layoutId: string; profileName: string; added: number[]; missing: string[] };

export type ProposeResult =
  | { status: 'proposed'; layoutVersion: number; reused: boolean }
  | { status: 'rejected'; reasons: SpecCheckFailure[] }
  /** The coach found no sets it can describe: `No sets found in this file.` */
  | { status: 'unsupported' }
  | { status: 'unavailable'; reason: ImportCoachUnavailable }
  | { status: 'failed'; reason: 'timeout' | 'no_layout_returned' | 'interrupted' | 'stopped' | 'provider_error' }
  /** Nothing was sent: a workout is unfinished, the text shown changed, or the file is gone. */
  | { status: 'refused'; reason: 'workout_unfinished' | 'sample_changed' | 'not_found' };

export type LayoutChange =
  | { kind: 'role'; column: number; role: LayoutRole }
  /** `Use this` on a column's `Check`. */
  | { kind: 'confirm'; column: number }
  | { kind: 'record_kind'; answer: 'done' | 'plan' }
  | { kind: 'unit'; answer: WeightUnit }
  | { kind: 'date_order'; answer: 'day_first' | 'month_first' }
  | { kind: 'notation'; column: number; answer: NotationAnswer }
  /** `Use this` (the coach's reading) or `Choose…` on a marker. */
  | { kind: 'marker'; token: string; meaning: MarkerMeaning }
  /** The toast's `Undo`: back to the answers before the last change. */
  | { kind: 'undo' };

export type UpdateResult =
  | { ok: true; layoutVersion: number; review: LayoutReview; displaced: { column: number; header: string }[] }
  | { ok: false; reason: 'stale' | 'not_found' | 'nothing_to_undo' | 'not_a_check' }
  | { ok: false; reason: 'refused'; refusal: 'not_unit_words' | 'target_column' };

export type ConfirmResult =
  | { ok: true; result: OpenResult }
  | { ok: false; reason: 'stale' | 'not_found' | 'not_ready' | 'plan' }
  | { ok: false; reason: 'workout_unfinished'; block: ImportBlock };

export interface LayoutReviewView {
  layoutId: string;
  layoutVersion: number;
  fileName: string;
  kind: 'coach' | 'saved';
  profileName: string | null;
  review: LayoutReview;
  /** The saved layout's answers (`Your answer last time`), when a saved layout is used. */
  saved: LayoutAnswers | null;
  newColumns: number[];
  missing: string[];
  canUndo: boolean;
  header: string[];
}

export interface SampleView {
  json: string;
  hash: string;
  chars: number;
  rows: number;
  columns: BuiltSample['columns'];
  /** Columns Ben switched off (the send line's `and 2 columns hidden`). */
  hiddenCount: number;
  instructions: string;
}

export interface SavedLayoutRow {
  id: string;
  name: string;
  columns: number;
  unit: WeightUnit | null;
  /** Imports still in effect that used it. */
  imports: number;
  lastUsed: ZonedTimestamp | null;
  state: 'in_use' | 'not_in_use' | 'deleted';
  version: number;
}

interface Session {
  id: string;
  ownerId: string;
  file: { name: string; text: string };
  table: Table;
  firstLine: string;
  kind: 'coach' | 'saved';
  /** The saved layout this file uses (same columns), or the one its changed columns came from. */
  profile: ImportProfile | null;
  changed: boolean;
  newColumns: number[];
  missing: string[];
  hidden: number[];
  sample: BuiltSample | null;
  sampleHash: string | null;
  spec: ImportMappingSpecV1 | null;
  specHash: string | null;
  saved: LayoutAnswers | null;
  answers: LayoutAnswers;
  history: LayoutAnswers[];
  layoutVersion: number;
  model: string | null;
  requestsSent: number;
  charsSent: number;
  inflight: AbortController | null;
  /** The current `Read with the coach` tap: `Stop` marks it, whether or not its request has gone out yet. */
  run: { stopped: boolean } | null;
  /** What `previewImport` found for a new table (shown again on the New file layout screen). */
  notes: { interrupted: boolean; damaged: (string | null)[] };
  /** The whole file's checksum: a stored layout is reused only for the same file (review S1). */
  fileHash: string;
  /** The stored request whose layout this session uses: closed when Ben acts on it. */
  request: { ownerId: string; operationId: string } | null;
  /** `Read with the coach again`: never reuse a stored layout; the next tap sends a new request. */
  fresh: boolean;
}

const INSTRUCTIONS_HASH = sha256Hex(IMPORT_LAYOUT_INSTRUCTIONS_V1);

function stripExtension(name: string): string {
  const stem = name.replace(/\.[A-Za-z0-9]{1,5}$/, '').trim();
  return (stem === '' ? 'Import' : stem).slice(0, 80);
}

export function createLayoutService(deps: LayoutServiceDeps) {
  const sessions = new Map<string, Session>();
  /** Requests still running, by layout and operation ID: a repeat while one runs waits for it (rule 5). */
  const proposing = new Map<string, Promise<ProposeResult>>();
  const repos = () => deps.store().repos;

  async function block(): Promise<ImportBlock | null> {
    const a = await deps.activeWorkout().catch(() => null);
    if (!a) return null;
    return { title: a.session.routineName ?? 'Workout', startedAtUtc: a.session.startedAt.utc, tz: a.session.startedAt.tz };
  }

  function opts() {
    const at = deps.now();
    return { today: localDateOf(toMs(at.utc), at.tz), tz: at.tz };
  }

  async function undoneJobs(ownerId: string): Promise<Set<string>> {
    return new Set((await repos().imports.listJobs(ownerId)).filter((j) => j.status === 'reverted').map((j) => j.id));
  }

  /** Saved layouts in use (AI12), and the names of damaged ones. */
  async function liveProfiles(ownerId: string): Promise<{ live: ImportProfile[]; damaged: (string | null)[] }> {
    const { profiles, damaged } = await repos().importProfiles.list(ownerId);
    const undone = await undoneJobs(ownerId);
    return { live: profiles.filter((p) => layoutInUse(p, undone)), damaged: damaged.map((d) => d.name) };
  }

  async function coachStatus(): Promise<ImportCoachStatus> {
    const hasPort = deps.coach.model !== undefined;
    const a = await deps.coach.availability().catch(() => ({ status: 'not_connected', model: null }));
    const state = importCoachStateOf(a.status, hasPort && (a.status !== 'ok' || a.model !== null));
    return { route: state === 'not_connected' ? null : 'chatgpt_plan', state };
  }

  function review(s: Session): LayoutReview {
    return buildLayoutReview(s.table, s.spec, s.answers, { ...opts(), saved: s.saved, newColumns: s.newColumns });
  }

  function reviewView(s: Session): LayoutReviewView {
    return {
      layoutId: s.id,
      layoutVersion: s.layoutVersion,
      fileName: s.file.name,
      kind: s.kind,
      profileName: s.profile?.name ?? null,
      review: review(s),
      saved: s.saved,
      newColumns: s.newColumns,
      missing: s.missing,
      canUndo: s.history.length > 0,
      header: s.table.header,
    };
  }

  function sampleOf(s: Session): BuiltSample {
    const built = buildImportSample(s.table, { hidden: s.hidden });
    s.sample = built;
    s.sampleHash = sha256Hex(built.json);
    return built;
  }

  function adoptSpec(s: Session, spec: ImportMappingSpecV1, model: string | null, request: ImportLayoutRequest | null): void {
    s.request = request === null ? null : { ownerId: request.ownerId, operationId: request.operationId };
    s.spec = spec;
    s.specHash = sha256Hex(stableStringify(spec));
    s.answers = EMPTY_LAYOUT_ANSWERS;
    s.history = [];
    s.layoutVersion = 1;
    s.model = model;
  }

  /** What the preview commits with (ADR 0026 §5). */
  function draftLayout(s: Session, spec: ImportMappingSpecV1, r: LayoutReview): DraftLayout {
    const markers = s.table.records.length === 0 ? [] : r.questions.flatMap((q) => (q.kind === 'marker' ? [q.marker.token] : []));
    // Same columns: this import is another use of the saved layout. Changed columns or a coach layout: a new layout when `Save layout` is on.
    const sameColumns = s.kind === 'saved' && !s.changed && s.profile !== null;
    return {
      kind: s.kind,
      layoutId: s.id,
      profile: sameColumns ? s.profile : null,
      fingerprint: fingerprintOf(s.table),
      spec,
      specHash: s.specHash ?? sha256Hex(stableStringify(spec)),
      layoutVersion: s.layoutVersion,
      answers: s.answers,
      sampleHash: s.kind === 'coach' ? s.sampleHash : null,
      instructionsHash: s.kind === 'coach' ? INSTRUCTIONS_HASH : null,
      model: s.model,
      requestsSent: s.requestsSent,
      charsSent: s.charsSent,
      unit: r.unit.unit,
      unitSource: r.unit.source,
      seen: { markers: [...new Set([...(s.profile?.seen.markers ?? []), ...markers])], negativeNames: [...(s.profile?.seen.negativeNames ?? [])] },
      save: sameColumns ? null : { on: true, name: s.changed && s.profile ? s.profile.name : stripExtension(s.file.name) },
      confirmedAt: deps.now(),
    };
  }

  async function confirmSession(s: Session): Promise<ConfirmResult> {
    const b = await block();
    if (b) return { ok: false, reason: 'workout_unfinished', block: b };
    if (s.spec === null) return { ok: false, reason: 'not_ready' };
    const r = review(s);
    if (r.plan) return { ok: false, reason: 'plan' };
    if (!r.ready) return { ok: false, reason: 'not_ready' };
    const applied = applyImportSpec(s.spec, s.answers, s.table, opts());
    if (applied.pending > 0) return { ok: false, reason: 'not_ready' };
    // The request stays open until the import is committed (`layoutCommitting`) or Ben leaves: a force-close
    // on the preview still finds this layout for the same file, so it isn't sent again (review r3 N1).
    const result = await deps.imports.openLayout(s.file, applied.rows, s.firstLine, draftLayout(s, s.spec, r));
    return { ok: true, result };
  }

  async function storeRequest(record: ImportLayoutRequest, expected: number | null): Promise<void> {
    await repos().importProfiles.saveRequest(record, expected).catch(() => undefined);
  }

  /** Ben acted on this session's layout (`Use this layout`, `Cancel`, `Read with the coach again`): it is never reused. */
  async function closeRequest(s: Session): Promise<void> {
    const ref = s.request;
    if (ref === null) return;
    s.request = null;
    const r = await repos().importProfiles.request(ref.ownerId, ref.operationId).catch(() => null);
    if (!r || r.closedAt !== null) return;
    const at = deps.now();
    await storeRequest({ ...r, closedAt: at, version: r.version + 1, updatedAtUtc: at.utc }, r.version);
  }

  /**
   * A stored layout for this exact sample of this exact file that Ben never
   * acted on (the interrupted case, §9.3.3), checked again against the whole
   * file before it is used (§9.2.4, review S1). Null: nothing to reuse.
   */
  async function reusable(s: Session, ownerId: string): Promise<{ request: ImportLayoutRequest; spec: ImportMappingSpecV1 } | null> {
    if (s.fresh || s.sampleHash === null) return null;
    const r = await repos().importProfiles.proposedFor(ownerId, s.sampleHash, s.fileHash).catch(() => null);
    if (!r?.spec) return null;
    const v = validateImportSpec(r.spec, s.table, opts());
    return v.ok ? { request: r, spec: v.spec } : null;
  }

  const service = {
    getImportCoachStatus: coachStatus,

    /**
     * `Choose file` (§9.3.1): detect on the phone. FitNotes goes to its own
     * preview; a saved layout imports offline; a new table waits for Ben's
     * consent. Nothing is sent here, ever.
     */
    async previewImport(file: { name: string; text: string }): Promise<PreviewImportResult> {
      const p = await deps.profile();
      if (!p) return { kind: 'no_profile' };
      const b = await block();
      if (b) return { kind: 'blocked', block: b };
      const { live, damaged } = await liveProfiles(p.id);
      const d = detectLayoutFile(file.text, live);
      switch (d.kind) {
        case 'fitnotes':
          return { kind: 'fitnotes', result: await deps.imports.open(file) };
        case 'not_readable':
          return { kind: 'not_readable', reason: d.reason, firstLine: d.firstLine };
        case 'new_table':
          break;
        case 'saved_layout':
        case 'saved_layout_changed':
          break;
      }
      const base: Session = {
        id: deps.newId(),
        ownerId: p.id,
        file: { name: file.name.slice(0, 255) || 'Import.csv', text: file.text },
        table: d.table,
        firstLine: (file.text.split(/\r\n?|\n/).find((l) => l.trim() !== '') ?? '').slice(0, 2000),
        kind: 'coach',
        profile: null,
        changed: false,
        newColumns: [],
        missing: [],
        hidden: [],
        sample: null,
        sampleHash: null,
        spec: null,
        specHash: null,
        saved: null,
        answers: EMPTY_LAYOUT_ANSWERS,
        history: [],
        layoutVersion: 1,
        model: null,
        requestsSent: 0,
        charsSent: 0,
        inflight: null,
        run: null,
        notes: { interrupted: false, damaged: [] },
        fileHash: sha256Hex(file.text),
        request: null,
        fresh: false,
      };
      if (d.kind === 'saved_layout' || d.kind === 'saved_layout_changed') {
        const profile = live.find((x) => x.id === d.profileId);
        const remapped = profile && d.kind === 'saved_layout_changed' ? remapLayout(profile.spec, profile.answers, profile.fingerprint.header, d.table.header) : null;
        if (profile && (d.kind === 'saved_layout' || remapped)) {
          const spec = remapped?.spec ?? profile.spec;
          const answers = remapped?.answers ?? profile.answers;
          const s: Session = {
            ...base,
            kind: 'saved',
            profile,
            changed: d.kind === 'saved_layout_changed',
            newColumns: remapped?.added ?? [],
            missing: remapped?.missing ?? [],
            spec,
            // A remapped spec is a different spec: its own hash, so the job and a newly saved layout record what read the rows (review S4).
            specHash: remapped ? sha256Hex(stableStringify(remapped.spec)) : profile.provenance.specHash,
            saved: answers,
            answers,
            model: profile.provenance.model,
          };
          sessions.set(s.id, s);
          if (d.kind === 'saved_layout_changed') return { kind: 'saved_layout_changed', layoutId: s.id, profileName: profile.name, added: s.newColumns, missing: s.missing };
          const r = review(s);
          if (r.ready) {
            const c = await confirmSession(s);
            if (c.ok) return { kind: 'saved_layout', layoutId: s.id, profileName: profile.name, result: c.result };
          }
          return { kind: 'saved_layout_review', layoutId: s.id, profileName: profile.name };
        }
      }
      // A new table: the sample Ben can see, and any layout that already came back for exactly this sample.
      sessions.set(base.id, base);
      sampleOf(base);
      const reused = await reusable(base, p.id);
      if (reused) adoptSpec(base, reused.spec, reused.request.model, reused.request);
      const last = base.sampleHash === null ? null : await repos().importProfiles.latestFor(p.id, base.sampleHash).catch(() => null);
      const interrupted = last?.state === 'sent';
      if (last && interrupted) {
        // Cut off by leaving or closing the app: recorded once, so it shows `Interrupted.` and nothing is imported.
        await storeRequest({ ...last, state: 'failed', failure: 'interrupted', finishedAt: deps.now(), version: last.version + 1, updatedAtUtc: deps.now().utc }, last.version);
      }
      base.notes = { interrupted, damaged };
      return {
        kind: 'new_table',
        layoutId: base.id,
        fileName: base.file.name,
        columns: d.table.header.length,
        rows: d.table.records.length,
        firstLine: base.firstLine,
        coach: await coachStatus(),
        reused: reused !== null,
        interrupted,
        damaged,
      };
    },

    /** The New file layout screen's facts again (the coach's state read now). Null when the session is gone. */
    async newTable(layoutId: string): Promise<Extract<PreviewImportResult, { kind: 'new_table' }> | null> {
      const s = sessions.get(layoutId);
      if (!s) return null;
      return {
        kind: 'new_table',
        layoutId: s.id,
        fileName: s.file.name,
        columns: s.table.header.length,
        rows: s.table.records.length,
        firstLine: s.firstLine,
        coach: await coachStatus(),
        reused: s.spec !== null,
        interrupted: s.notes.interrupted,
        damaged: s.notes.damaged,
      };
    },

    /** §9.2.3 `What's sent`: the literal request text, with Ben's switched-off columns. Notes columns can't be switched on. */
    buildImportSample(layoutId: string, hidden?: readonly number[]): SampleView | null {
      const s = sessions.get(layoutId);
      if (!s) return null;
      if (hidden !== undefined) s.hidden = [...new Set(hidden)].filter((i) => i >= 0 && i < s.table.header.length).sort((a, b) => a - b);
      const built = sampleOf(s);
      return { json: built.json, hash: s.sampleHash ?? '', chars: built.chars, rows: built.rows, columns: built.columns, hiddenCount: built.columns.filter((c) => c.hidden && c.kind !== 'notes').length, instructions: IMPORT_LAYOUT_INSTRUCTIONS_V1 };
    },

    /**
     * `Read with the coach` (§9.4): one request, Ben's tap, with an
     * operation ID and the hash of the text he can see. Never retried on
     * its own; nothing is imported here.
     */
    proposeImportMapping(layoutId: string, sampleHash: string, operationId: string, signal?: AbortSignal): Promise<ProposeResult> {
      const key = `${layoutId}\u0000${operationId}`;
      const running = proposing.get(key);
      if (running) return running;
      const p = propose(layoutId, sampleHash, operationId, signal).finally(() => {
        proposing.delete(key);
      });
      proposing.set(key, p);
      return p;
    },

    /** `Stop`: the request is cancelled and a late answer is thrown away. */
    stop(layoutId: string): void {
      const s = sessions.get(layoutId);
      if (s) stopSession(s);
    },

    getLayoutReview(layoutId: string): LayoutReviewView | null {
      const s = sessions.get(layoutId);
      return s && s.spec !== null ? reviewView(s) : null;
    },

    /** One change on Check the layout. Every change bumps `layoutVersion`; a stale one is refused (rule 5). */
    updateImportLayout(layoutId: string, change: LayoutChange, expectedLayoutVersion: number): UpdateResult {
      const s = sessions.get(layoutId);
      if (!s || s.spec === null) return { ok: false, reason: 'not_found' };
      if (s.layoutVersion !== expectedLayoutVersion) return { ok: false, reason: 'stale' };
      const a = s.answers;
      const cols = review(s).columns;
      let next: LayoutAnswers;
      let displaced: { column: number; header: string }[] = [];
      switch (change.kind) {
        case 'undo': {
          const prev = s.history.at(-1);
          if (!prev) return { ok: false, reason: 'nothing_to_undo' };
          s.history = s.history.slice(0, -1);
          s.answers = prev;
          s.layoutVersion += 1;
          return { ok: true, layoutVersion: s.layoutVersion, review: review(s), displaced: [] };
        }
        case 'role': {
          const refusal = roleRefusal(s.table, change.column, change.role);
          if (refusal) return { ok: false, reason: 'refused', refusal };
          const moved = displacedBy(cols, change.column, change.role);
          displaced = moved.map((c) => ({ column: c, header: s.table.header[c] ?? '' }));
          const roles = { ...a.roles, [String(change.column)]: change.role };
          for (const c of moved) roles[String(c)] = 'not_imported';
          next = { ...a, roles };
          break;
        }
        case 'confirm': {
          const col = cols[change.column];
          if (col?.state !== 'check') return { ok: false, reason: 'not_a_check' };
          next = { ...a, roles: { ...a.roles, [String(change.column)]: col.role } };
          break;
        }
        case 'record_kind':
          next = { ...a, recordKind: change.answer };
          break;
        case 'unit':
          next = { ...a, unit: change.answer };
          break;
        case 'date_order':
          next = { ...a, dateOrder: change.answer };
          break;
        case 'notation':
          next = { ...a, notation: { ...a.notation, [String(change.column)]: change.answer } };
          break;
        case 'marker':
          next = { ...a, markers: { ...a.markers, [change.token.slice(0, 40)]: change.meaning } };
          break;
      }
      const valid = validate(LayoutAnswersSchema, next);
      if (!valid.ok) return { ok: false, reason: 'not_found' };
      s.history = [...s.history, a].slice(-50);
      s.answers = valid.value;
      s.layoutVersion += 1;
      return { ok: true, layoutVersion: s.layoutVersion, review: review(s), displaced };
    },

    /** `Use this layout` / `Continue`: code reads every row and the shared preview opens. Refused while anything is open. */
    async confirmImportLayout(layoutId: string, expectedLayoutVersion: number): Promise<ConfirmResult> {
      const s = sessions.get(layoutId);
      if (!s) return { ok: false, reason: 'not_found' };
      if (s.layoutVersion !== expectedLayoutVersion) return { ok: false, reason: 'stale' };
      return confirmSession(s);
    },

    /** Changed columns → `Read with the coach instead`: the file starts again as a new layout, with its consent. */
    readAsNew(layoutId: string): string | null {
      const s = sessions.get(layoutId);
      if (!s) return null;
      const fresh: Session = { ...s, id: deps.newId(), run: null, inflight: null, kind: 'coach', profile: null, changed: false, newColumns: [], missing: [], spec: null, specHash: null, saved: null, answers: EMPTY_LAYOUT_ANSWERS, history: [], layoutVersion: 1, model: null, request: null };
      sessions.set(fresh.id, fresh);
      sampleOf(fresh);
      return fresh.id;
    },

    /**
     * `Read with the coach again` (§9.3.4, §9.5): the coach's layout is set
     * aside (never reused) and the file starts again at its consent screen.
     * The next `Read with the coach` sends a new request, whatever is stored.
     * Returns the new session's ID; null when the session is gone.
     */
    async readAgain(layoutId: string): Promise<string | null> {
      const s = sessions.get(layoutId);
      if (!s || s.kind !== 'coach') return null;
      stopSession(s);
      await closeRequest(s);
      sessions.delete(layoutId);
      const fresh: Session = { ...s, id: deps.newId(), run: null, inflight: null, spec: null, specHash: null, answers: EMPTY_LAYOUT_ANSWERS, history: [], layoutVersion: 1, model: null, request: null, fresh: true, notes: { interrupted: false, damaged: s.notes.damaged } };
      sessions.set(fresh.id, fresh);
      sampleOf(fresh);
      return fresh.id;
    },

    /** The layout session's current version (the commit refuses a draft made from an older one; check 53). Null when the session is gone. */
    layoutVersionOf(layoutId: string): number | null {
      return sessions.get(layoutId)?.layoutVersion ?? null;
    },

    /** One column's cells as written (the role sheet's `3x8, 5x5, 4x10 …` and row count). File text, data only. */
    columnValues(layoutId: string, column: number): string[] {
      const s = sessions.get(layoutId);
      return s ? s.table.records.map((r) => r.cells[column] ?? '') : [];
    },

    /**
     * The import made with this session's layout is being committed: Ben used
     * the layout, so it is never offered again as the coach's suggestion (an
     * Undo doesn't bring it back; review S1, r3 N1). The session stays.
     */
    async layoutCommitting(layoutId: string): Promise<void> {
      const s = sessions.get(layoutId);
      if (s) await closeRequest(s);
    },

    /** `Cancel`: the layout session is dropped; nothing was saved, and its layout is never reused. */
    async discard(layoutId: string): Promise<void> {
      const s = sessions.get(layoutId);
      if (!s) return;
      // Cancel, back or the swipe while it reads means `Stop` (§9.3.3, review r3 B1): nothing sent if it hasn't gone, a late answer thrown away.
      stopSession(s);
      sessions.delete(layoutId);
      await closeRequest(s);
    },

    // -------------------------------------------------------------------
    // Saved import layouts (§9.2.9)

    async listLayouts(): Promise<{ rows: SavedLayoutRow[]; damaged: { id: string; name: string | null }[] }> {
      const p = await deps.profile();
      if (!p) return { rows: [], damaged: [] };
      const { profiles, damaged } = await repos().importProfiles.list(p.id);
      const jobs = await repos().imports.listJobs(p.id);
      const undone = new Set(jobs.filter((j) => j.status === 'reverted').map((j) => j.id));
      const rows = profiles.map((x): SavedLayoutRow => {
        const used = jobs.filter((j) => x.uses.includes(j.id) && !undone.has(j.id));
        return {
          id: x.id,
          name: x.name,
          columns: x.fingerprint.header.length,
          unit: x.answers.unit ?? null,
          imports: used.length,
          lastUsed: used[0]?.startedAt ?? null,
          state: x.deletedAt !== null ? 'deleted' : layoutInUse(x, undone) ? 'in_use' : 'not_in_use',
          version: x.version,
        };
      });
      return { rows: rows.filter((r) => r.state !== 'deleted'), damaged };
    },

    async getLayout(id: string): Promise<ImportProfile | null> {
      return repos().importProfiles.get(id);
    },

    /** `Delete layout` (toast with `Undo`). Imported workouts stay. */
    async deleteLayout(id: string, expectedVersion: number) {
      return repos().importProfiles.setDeleted(id, expectedVersion, deps.now());
    },

    async undoDeleteLayout(id: string, expectedVersion: number) {
      return repos().importProfiles.setDeleted(id, expectedVersion, null);
    },

    async deleteDamagedLayout(id: string): Promise<boolean> {
      return repos().importProfiles.removeDamaged(id);
    },

    /**
     * The Undo alert's extra line (§9.2.10): the layout this import saved
     * goes too when no other import still in effect uses it. Null otherwise.
     */
    async layoutGoingWith(jobId: string): Promise<string | null> {
      const job = await repos().imports.getJob(jobId);
      const id = job?.layout?.savedProfileId ?? job?.layout?.profileId ?? null;
      if (!job || id === null || job.status === 'reverted') return null;
      const profile = await repos().importProfiles.get(id);
      if (!profile) return null;
      const undone = await undoneJobs(job.ownerId);
      if (!layoutInUse(profile, undone)) return null;
      return layoutInUse(profile, new Set([...undone, jobId])) ? null : profile.name;
    },
  };

  /** `Stop` on one session: the running read is marked stopped and its request cancelled. */
  function stopSession(s: Session): void {
    if (s.run) s.run.stopped = true;
    s.inflight?.abort();
  }

  /** A stored request's result, without sending anything. */
  async function propose(layoutId: string, sampleHash: string, operationId: string, signal?: AbortSignal): Promise<ProposeResult> {
    const s = sessions.get(layoutId);
    if (!s) return { status: 'refused', reason: 'not_found' };
    const run = { stopped: false };
    s.run = run;
    // Read through a function: Stop can mark it at any await below. A session that was dropped
    // (Cancel, back, the swipe, `Read with the coach again`) is stopped too (review r3 B1).
    const stopped = (): boolean => run.stopped || sessions.get(layoutId) !== s;
    const p = await deps.profile();
    if (!p) return { status: 'refused', reason: 'not_found' };
    if (await block()) return { status: 'refused', reason: 'workout_unfinished' };
    // A repeat of the same tap: its stored result, nothing sent.
    const stored = await repos().importProfiles.request(p.id, operationId);
    if (stored) return replay(s, stored);
    const built = s.sample ?? sampleOf(s);
    if (s.sampleHash !== sampleHash) return { status: 'refused', reason: 'sample_changed' };
    // A layout that already arrived for exactly this text (before an interruption): reused, not sent again.
    const reused = await reusable(s, p.id);
    if (stopped()) return { status: 'failed', reason: 'stopped' };
    if (reused) {
      adoptSpec(s, reused.spec, reused.request.model, reused.request);
      return { status: 'proposed', layoutVersion: s.layoutVersion, reused: true };
    }
    const coach = await coachStatus();
    const a = await deps.coach.availability().catch(() => ({ status: 'not_connected', model: null }));
    const port = deps.coach.model?.();
    if (coach.state !== 'ready' || port === undefined || a.model === null) return { status: 'unavailable', reason: coach.state === 'ready' ? 'not_connected' : coach.state };
    // Stopped before anything went out: nothing is sent.
    if (stopped()) return { status: 'failed', reason: 'stopped' };
    const at = deps.now();
    const record: ImportLayoutRequest = {
      id: deps.newId(),
      ownerId: p.id,
      version: 1,
      createdAtUtc: at.utc,
      updatedAtUtc: at.utc,
      operationId,
      sampleHash,
      fileHash: s.fileHash,
      instructionsHash: INSTRUCTIONS_HASH,
      route: 'chatgpt_plan',
      model: a.model,
      chars: built.chars,
      state: 'sent',
      failure: null,
      unavailable: null,
      spec: null,
      reasons: [],
      sentAt: at,
      finishedAt: null,
      closedAt: null,
    };
    const created = await repos().importProfiles.saveRequest(record, null);
    if (!created.ok) {
      const again = await repos().importProfiles.request(p.id, operationId);
      return again ? replay(s, again) : { status: 'refused', reason: 'not_found' };
    }
    const done = (patch: Partial<ImportLayoutRequest>) => storeRequest({ ...record, ...patch, version: 2, updatedAtUtc: deps.now().utc, finishedAt: deps.now() }, 1);
    // `Stop` tapped while the record was written: nothing is sent (review S5).
    if (stopped()) {
      await done({ state: 'failed', failure: 'stopped' });
      return { status: 'failed', reason: 'stopped' };
    }
    const controller = new AbortController();
    s.inflight = controller;
    const onOuter = (): void => {
      controller.abort();
    };
    signal?.addEventListener('abort', onOuter);
    s.requestsSent += 1;
    s.charsSent += built.chars;
    let answer: Awaited<ReturnType<typeof requestImportLayout>>;
    try {
      // Exactly the text shown: the stored sample JSON, byte for byte (check 36).
      answer = await requestImportLayout(port, buildImportLayoutRequest(built.json, a.model), { signal: controller.signal, ...(deps.timeoutMs === undefined ? {} : { timeoutMs: deps.timeoutMs }) });
    } finally {
      s.inflight = null;
      signal?.removeEventListener('abort', onOuter);
    }
    // Stopped while it ran: a late answer is thrown away (§9.3.3).
    if (stopped()) {
      await done({ state: 'failed', failure: 'stopped' });
      return { status: 'failed', reason: 'stopped' };
    }
    if (!answer.ok) {
      const outcome = importLayoutFailure(answer.error);
      if (outcome.kind === 'unavailable') {
        const reason: ImportCoachUnavailable = outcome.reason;
        await done({ state: 'unavailable', unavailable: reason });
        return { status: 'unavailable', reason };
      }
      await done({ state: 'failed', failure: outcome.reason });
      return { status: 'failed', reason: outcome.reason };
    }
    // Code checks the layout against every row before anything is shown (§9.2.4).
    const v = validateImportSpec(answer.spec, s.table, opts());
    if (!v.ok && v.unsupported) {
      await done({ state: 'failed', failure: 'unsupported' });
      return { status: 'unsupported' };
    }
    if (!v.ok) {
      // The reasons are enough: a rejected spec's strings are the model's and are never kept (§9.6.1).
      await done({ state: 'rejected', reasons: v.failures });
      return { status: 'rejected', reasons: v.failures };
    }
    await done({ state: 'proposed', spec: v.spec });
    adoptSpec(s, v.spec, a.model, record);
    return { status: 'proposed', layoutVersion: s.layoutVersion, reused: false };
  }

  function replay(s: Session, r: ImportLayoutRequest): ProposeResult {
    // An operation ID from another file's tap: refused, nothing adopted (review N5).
    if (r.sampleHash !== s.sampleHash) return { status: 'refused', reason: 'sample_changed' };
    switch (r.state) {
      case 'proposed':
        if (r.spec && s.spec === null) adoptSpec(s, r.spec, r.model, r);
        return { status: 'proposed', layoutVersion: s.layoutVersion, reused: true };
      case 'rejected':
        return { status: 'rejected', reasons: r.reasons };
      case 'unavailable':
        return { status: 'unavailable', reason: r.unavailable ?? 'unavailable' };
      case 'failed':
        return r.failure === 'unsupported' ? { status: 'unsupported' } : { status: 'failed', reason: r.failure ?? 'provider_error' };
      case 'sent':
        return { status: 'failed', reason: 'interrupted' };
    }
  }

  return service;
}

export type LayoutService = ReturnType<typeof createLayoutService>;
