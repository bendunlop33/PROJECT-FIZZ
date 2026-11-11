import {
  checkNoteCoachAnswer,
  convertMass,
  currentGymEquipment,
  deriveId,
  equipmentForExercise,
  HK_STRENGTH_TYPES,
  isArchivedExercise,
  KG_PER_LB,
  localDateOf,
  localTimeUtcMs,
  clockText,
  matchNoteExercise,
  noteGym,
  noteRowsText,
  noteSetsOf,
  parseNoteWorkout,
  rankNoteCandidates,
  roundToStep,
  toIso,
  toMs,
  type CommandOutcome,
  type NoteCandidate,
  type PastedLine,
  type NoteSet,
  type NoteWorkout,
} from '@fizz/domain';
import { buildNoteMatchRequest, requestNoteMatches, type CoachModelPort, type NoteMatchPayload } from '@fizz/coach';
import type { SqliteRepositories, Store } from '@fizz/persistence';
import type { Exercise, ImportCoachUnavailable, Load, SessionAggregate, SessionCommand, SetType, UserProfile, ZonedTimestamp } from '@fizz/schemas';

import { importCoachStateOf } from './layout-service';


/**
 * (Ben, 11 Nov) `Paste` in Log a past workout: "The app wasn't working on Tuesday, so I wrote the workout in Apple
 * Notes." Orchestration only; reading the note, warm-ups and matching are pure (`@fizz/domain` note-workout).
 *
 * - **Offline first (rule 1).** `read` needs nothing but the phone: code reads every number and matches names to his
 *   history and the catalogue. The coach (`askCoach`) is optional, after the review is already showing.
 * - **One route (rule 7).** The coach request uses the coach's ChatGPT-plan port and the coach's own status, as the
 *   import layout request does. One request per operation ID: a repeat sends nothing and gets the same answer.
 * - **Data, not instructions (rule 8).** The note goes only as JSON data; the answer can only map names to IDs from
 *   the list sent or propose sets for lines code couldn't read; code checks it and Ben confirms in review.
 * - **Ben's values (rule 4).** Loads are logged as written (converted only when the gym's item is in the other unit).
 * - `open` starts a normal past log (no clock) with every set done, idempotent by its operation ID; Finish, Undo and
 *   delete are the workout's own. Nothing is written before `open`.
 */

export interface NoteServiceDeps {
  repos: () => SqliteRepositories;
  store: () => Store;
  now: () => ZonedTimestamp;
  profile: () => Promise<UserProfile | null>;
  catalogueExercises: () => readonly Exercise[];
  catalogueAliases: (catalogueKey: string) => readonly string[];
  coach: { availability: () => Promise<{ status: string; model: string | null }>; model?: () => CoachModelPort };
  workout: {
    start: (req: { gymId: string; opId: string; checkIn: null; pastStart: ZonedTimestamp; pastName?: string }) => Promise<{ ok: true; aggregate: SessionAggregate } | { ok: false; error: { code: string; message: string } }>;
    addExercise: (req: { sessionId: string; exerciseId: string; equipmentId: string | null; opId: string; plan?: { setType: SetType; planned: { load: Load | null; reps: { min: number; max: number } | null; durationS: null; rpe: null; rir: null } }[]; warmupsAsGiven?: boolean }) => Promise<CommandOutcome>;
    dispatch: (sessionId: string, command: SessionCommand) => Promise<CommandOutcome>;
  };
  /** Coach request limit (tests). */
  timeoutMs?: number;
}

export const NOTE_COPY = {
  entry: 'Paste',
  title: 'Paste',
  placeholder: 'Paste your workout',
  read: 'Read',
  nothing: 'Couldn’t read that',
  choose: 'Choose',
  open: 'Open workout',
  checking: 'Checking with coach…',
  coachMark: 'Coach',
  failed: 'Couldn’t open. Try again.',
  openWorkout: 'Finish the open workout first.',
} as const;

export interface NotePreviewExercise {
  index: number;
  header: string;
  lines: PastedLine[];
  rowsText: string;
  sets: NoteSet[];
  exerciseId: string | null;
  exerciseName: string | null;
  /** Code is sure of the name (or Ben picked it); otherwise it's a suggestion for him to check. */
  sure: boolean;
  /** The coach changed the name from code's. */
  byCoach: boolean;
  /** The coach thinks it's one of his own he hasn't added (`Add your own` with this name). */
  ownName: string | null;
}

export interface NotePreview {
  text: string;
  title: string | null;
  /** The workout's local date. */
  date: string;
  startMs: number;
  tz: string;
  gym: { id: string; name: string } | null;
  exercises: NotePreviewExercise[];
}

export type NoteReadResult = { kind: 'nothing' } | { kind: 'preview'; preview: NotePreview };
export type NoteCoachResult = { kind: 'answered'; preview: NotePreview } | { kind: 'unavailable'; reason: ImportCoachUnavailable } | { kind: 'failed' };
export type NoteOpenResult = { ok: true; sessionId: string } | { ok: false; message: string };

const HISTORY_DAYS = 365;
const SHORTLIST = 6;

export function createNoteService(deps: NoteServiceDeps) {
  const repos = deps.repos;
  /** Coach requests by operation ID: a repeat (double tap, re-render) sends nothing. In memory for this run. */
  const asked = new Map<string, Promise<NoteCoachResult>>();

  async function candidates(p: UserProfile): Promise<{ list: NoteCandidate[]; byId: Map<string, Exercise> }> {
    const [saved, aliases] = await Promise.all([repos().exercises.list().catch(() => [] as Exercise[]), repos().imports.aliases(p.id).catch(() => [])]);
    const mine = saved.filter((e) => (e.ownerId === null || e.ownerId === p.id) && !isArchivedExercise(e) && e.measurement === 'reps');
    const have = new Set(mine.map((e) => e.id));
    const all = [...mine, ...deps.catalogueExercises().filter((e) => !have.has(e.id) && e.measurement === 'reps')];
    const ownNames = new Map<string, string[]>();
    for (const a of aliases) if (a.target.kind === 'exercise') ownNames.set(a.target.exerciseId, [...(ownNames.get(a.target.exerciseId) ?? []), a.name]);
    const nowMs = toMs(deps.now().utc);
    const done = await repos()
      .sessions.listFinishedBetween(p.id, toIso(nowMs - HISTORY_DAYS * 86_400_000), toIso(nowMs + 1))
      .catch(() => []);
    const sessions = new Map<string, number>();
    const top = new Map<string, number>();
    // Oldest first, so the latest workout's top set is the one kept.
    for (const w of done) {
      for (const ex of w.exercises) {
        if (ex.removed !== undefined) continue;
        const sets = w.sets.filter((s) => s.sessionExerciseId === ex.id && s.status === 'completed');
        if (sets.length === 0) continue;
        sessions.set(ex.exerciseId, (sessions.get(ex.exerciseId) ?? 0) + 1);
        const kg = Math.max(0, ...sets.map((s) => (s.actual?.load ? (s.actual.load.unit === 'kg' ? s.actual.load.value : s.actual.load.value * KG_PER_LB) : 0)));
        if (kg > 0) top.set(ex.exerciseId, kg);
      }
    }
    const list = all.map(
      (e): NoteCandidate => ({
        exerciseId: e.id,
        name: e.name,
        aliases: [...(e.catalogueKey ? deps.catalogueAliases(e.catalogueKey) : []), ...(ownNames.get(e.id) ?? [])],
        convention: e.defaultLoadConvention,
        sessions: sessions.get(e.id) ?? 0,
        lastTopKg: top.get(e.id) ?? null,
      }),
    );
    return { list, byId: new Map(all.map((e) => [e.id, e])) };
  }

  /** The start: the sheet's time on the note's date; with no time picked, a Health strength workout's start that day. */
  async function startOf(p: UserProfile, date: string, sheetStartMs: number, startPicked: boolean): Promise<number> {
    const tz = p.timezone;
    const [h, m] = clockText(sheetStartMs, tz).split(':').map(Number);
    const fallback = localTimeUtcMs(date, h ?? 18, m ?? 0, tz);
    if (startPicked) return fallback;
    const from = localTimeUtcMs(date, 0, 0, tz);
    const samples = await deps
      .store()
      .repos.health.workoutSamples(p.id, toIso(from - 86_400_000), toIso(from + 2 * 86_400_000))
      .catch(() => []);
    const that = samples.filter((s) => HK_STRENGTH_TYPES.has(s.activityType) && localDateOf(toMs(s.startUtc), tz) === date).sort((a, b) => a.startUtc.localeCompare(b.startUtc));
    const first = that[0];
    return first === undefined ? fallback : Math.floor(toMs(first.startUtc) / 60_000) * 60_000;
  }

  function exerciseRows(workout: NoteWorkout, ranked: (i: number) => { exerciseId: string | null; sure: boolean }, nameOf: (id: string | null) => string | null): NotePreviewExercise[] {
    return workout.exercises
      .map((ex, index) => ({ ex, index }))
      .filter(({ ex }) => ex.lines.length > 0)
      .map(({ ex, index }) => {
        const m = ranked(index);
        return { index, header: ex.header, lines: ex.lines, rowsText: noteRowsText(ex), sets: noteSetsOf(ex), exerciseId: m.exerciseId, exerciseName: nameOf(m.exerciseId), sure: m.sure, byCoach: false, ownName: null };
      });
  }

  return {
    /** Read a pasted note (code only, offline). Nothing is written. */
    async read(req: { text: string; sheetStartMs: number; startPicked: boolean }): Promise<NoteReadResult> {
      const p = await deps.profile();
      if (p === null) return { kind: 'nothing' };
      const workout = parseNoteWorkout(req.text, p.preferredUnit);
      if (workout === null) return { kind: 'nothing' };
      const tz = p.timezone;
      const nowMs = toMs(deps.now().utc);
      // A date in the future (a typo) is not used: the sheet's date stands.
      const noteDay = workout.date !== null && localTimeUtcMs(workout.date, 0, 0, tz) <= nowMs ? workout.date : null;
      const date = noteDay ?? localDateOf(req.sheetStartMs, tz);
      let startMs = await startOf(p, date, req.sheetStartMs, req.startPicked);
      if (startMs > nowMs) startMs = Math.floor(nowMs / 60_000) * 60_000;
      const gyms = await repos()
        .gyms.listByOwner(p.id)
        .catch(() => []);
      const gym = noteGym(workout.location, gyms);
      const { list, byId } = await candidates(p);
      const rows = exerciseRows(
        workout,
        (i) => {
          const ex = workout.exercises[i];
          return ex === undefined || ex.header === '' ? { exerciseId: null, sure: false } : matchNoteExercise(ex, list);
        },
        (id) => (id === null ? null : (byId.get(id)?.name ?? null)),
      );
      if (rows.every((r) => r.sets.length === 0)) return { kind: 'nothing' };
      return { kind: 'preview', preview: { text: req.text, title: workout.title, date, startMs, tz, gym: gym === null ? null : { id: gym.id, name: gym.name }, exercises: rows } };
    },

    /**
     * The coach's optional check of the review (Ben, 11 Nov): one request per `opId`. Returns the review with the
     * names it changed marked and sets read from lines code couldn't, or why not. Never blocks `open`.
     */
    askCoach(req: { preview: NotePreview; opId: string; signal?: AbortSignal }): Promise<NoteCoachResult> {
      const seen = asked.get(req.opId);
      if (seen !== undefined) return seen;
      const run = (async (): Promise<NoteCoachResult> => {
        const p = await deps.profile();
        if (p === null) return { kind: 'failed' };
        const a = await deps.coach.availability().catch(() => ({ status: 'not_connected', model: null }));
        const port = deps.coach.model?.();
        const state = importCoachStateOf(a.status, port !== undefined && (a.status !== 'ok' || a.model !== null));
        if (state !== 'ready' || port === undefined || a.model === null) return { kind: 'unavailable', reason: state === 'ready' ? 'not_connected' : state };
        const workout = parseNoteWorkout(req.preview.text, p.preferredUnit);
        if (workout === null) return { kind: 'failed' };
        const { list, byId } = await candidates(p);
        const offered = new Map<number, string[]>();
        const payload: NoteMatchPayload = { exercises: [] };
        for (const [i, ex] of workout.exercises.entries()) {
          if (ex.header === '' && !ex.lines.some((l) => l.kind === 'unread')) continue;
          const ranked = rankNoteCandidates(ex, list);
          const done = list.filter((c) => c.sessions > 0 && !ranked.includes(c)).sort((x, y) => y.sessions - x.sessions);
          const short = [...ranked.slice(0, SHORTLIST), ...done.slice(0, 4)];
          offered.set(
            i,
            short.map((c) => c.exerciseId),
          );
          payload.exercises.push({
            name: ex.header,
            sets: noteRowsText({ lines: ex.lines.filter((l) => l.kind === 'row') }),
            unread: ex.lines.flatMap((l) => (l.kind === 'unread' ? [l.text] : [])),
            candidates: short.map((c) => ({ id: c.exerciseId, name: c.name, done: c.sessions > 0 })),
          });
        }
        if (payload.exercises.length === 0) return { kind: 'failed' };
        const reply = await requestNoteMatches(port, buildNoteMatchRequest(payload, a.model), { ...(req.signal === undefined ? {} : { signal: req.signal }), ...(deps.timeoutMs === undefined ? {} : { timeoutMs: deps.timeoutMs }) });
        if (!reply.ok) {
          const e = reply.error;
          if (e === 'network') return { kind: 'unavailable', reason: 'offline' };
          if (e === 'usage_limit') return { kind: 'unavailable', reason: 'limit' };
          if (e === 'auth_expired') return { kind: 'unavailable', reason: 'signed_out' };
          return { kind: 'failed' };
        }
        const checked = checkNoteCoachAnswer(workout, offered, reply.answer);
        const exercises = req.preview.exercises.map((row): NotePreviewExercise => row);
        const byIndex = new Map(exercises.map((r) => [r.index, r] as const));
        const out: NotePreviewExercise[] = [];
        for (const [i, ex] of workout.exercises.entries()) {
          const c = checked[i];
          const prev = byIndex.get(i);
          const lines = c?.lines ?? ex.lines;
          if (prev === undefined && !lines.some((l) => l.kind === 'row')) continue;
          const base: NotePreviewExercise = prev ?? { index: i, header: ex.header, lines, rowsText: '', sets: [], exerciseId: null, exerciseName: null, sure: false, byCoach: false, ownName: null };
          const changed = c?.exerciseId !== null && c?.exerciseId !== undefined && c.exerciseId !== base.exerciseId;
          const exerciseId = changed ? (c.exerciseId ?? null) : base.exerciseId;
          out.push({
            ...base,
            lines,
            rowsText: noteRowsText({ lines }),
            sets: noteSetsOf({ lines }),
            exerciseId,
            exerciseName: exerciseId === null ? null : (byId.get(exerciseId)?.name ?? base.exerciseName),
            sure: changed ? false : base.sure,
            byCoach: changed || base.byCoach,
            ownName: exerciseId === null || !base.sure ? (c?.ownName ?? null) : null,
          });
        }
        return { kind: 'answered', preview: { ...req.preview, exercises: out.filter((r) => r.sets.length > 0) } };
      })();
      asked.set(req.opId, run);
      return run;
    },

    /**
     * Start the past log with every set done, as Ben reviewed it. `picks`: exercises he chose in review, by row index.
     * Idempotent by `opId` (a retry finds the same workout, rows and logs). Refused while a row has no exercise.
     */
    async open(req: { preview: NotePreview; picks: Readonly<Record<number, string>>; gymId: string; opId: string }): Promise<NoteOpenResult> {
      const p = await deps.profile();
      if (p === null) return { ok: false, message: NOTE_COPY.failed };
      const rows = req.preview.exercises.filter((r) => r.sets.length > 0).map((r) => ({ ...r, exerciseId: req.picks[r.index] ?? r.exerciseId }));
      if (rows.length === 0 || rows.some((r) => r.exerciseId === null)) return { ok: false, message: NOTE_COPY.failed };
      const started = await deps.workout.start({
        gymId: req.gymId,
        opId: req.opId,
        checkIn: null,
        pastStart: { utc: toIso(req.preview.startMs), tz: req.preview.tz },
        ...(req.preview.title === null ? {} : { pastName: req.preview.title }),
      });
      if (!started.ok) return { ok: false, message: started.error.code === 'session_already_active' ? NOTE_COPY.openWorkout : NOTE_COPY.failed };
      const sessionId = started.aggregate.session.id;
      const catalogue = new Map(deps.catalogueExercises().map((e) => [e.id, e] as const));
      let state: SessionAggregate = started.aggregate;
      for (const [n, row] of rows.entries()) {
        const exerciseId = row.exerciseId ?? '';
        const exercise = (await repos().exercises.get(exerciseId).catch(() => null)) ?? catalogue.get(exerciseId) ?? null;
        if (exercise === null) return { ok: false, message: NOTE_COPY.failed };
        const addOp = `${req.opId}:ex:${String(n)}`;
        let rowId = state.processedOps[addOp]?.createdIds?.[0] ?? null;
        if (rowId === null) {
          const equipmentId = await equipmentFor(p, exercise, state);
          const unit = equipmentId === null ? p.preferredUnit : (currentGymEquipment(state.session).find((e) => e.id === equipmentId)?.unit ?? p.preferredUnit);
          const convention = equipmentId === null ? exercise.defaultLoadConvention : (currentGymEquipment(state.session).find((e) => e.id === equipmentId)?.loadConvention ?? exercise.defaultLoadConvention);
          const plan = row.sets.map((s) => ({ setType: s.setType as SetType, planned: { load: loadFor(s, unit, convention), reps: { min: s.reps, max: s.reps }, durationS: null, rpe: null, rir: null } }));
          const added = await deps.workout.addExercise({ sessionId, exerciseId, equipmentId, opId: addOp, plan, warmupsAsGiven: true });
          if (!added.ok) return { ok: false, message: NOTE_COPY.failed };
          state = added.aggregate;
          rowId = state.processedOps[addOp]?.createdIds?.[0] ?? state.exercises.at(-1)?.id ?? null;
        }
        const ex = state.exercises.find((e) => e.id === rowId);
        if (ex === undefined) return { ok: false, message: NOTE_COPY.failed };
        const sets = state.sets.filter((s) => s.sessionExerciseId === ex.id && s.status !== 'deleted').sort((a, b) => a.index - b.index);
        for (const [k, set] of sets.entries()) {
          const s = row.sets[k];
          if (s === undefined || set.status === 'completed') continue;
          const values = { load: loadFor(s, ex.unit, ex.loadConvention), reps: s.reps, durationS: null, rpe: null, rir: null };
          const logged = await deps.workout.dispatch(sessionId, { type: 'log_set', at: deps.now(), opId: `${req.opId}:log:${String(n)}:${String(k)}`, setId: set.id, values, restTimerId: deriveId(`${set.id}:rest`) });
          if (!logged.ok) return { ok: false, message: NOTE_COPY.failed };
          state = logged.aggregate;
        }
      }
      return { ok: true, sessionId };
    },
  };

  /** The item he used for it last at this gym, else the gym's first that fits; none for bodyweight. */
  async function equipmentFor(p: UserProfile, exercise: Exercise, state: SessionAggregate): Promise<string | null> {
    const here = equipmentForExercise(exercise, currentGymEquipment(state.session));
    if (here.length === 0) return null;
    const latest = await repos()
      .sessions.latestFinished(p.id)
      .catch(() => null);
    const used = latest?.exercises.find((e) => e.exerciseId === exercise.id)?.equipmentId ?? null;
    return here.find((e) => e.id === used)?.id ?? here[0]?.id ?? null;
  }
}

/** A note set's load in the row's unit and convention, as written (converted only across units, to 0.01). */
function loadFor(s: NoteSet, unit: Load['unit'], convention: Load['convention']): Load | null {
  if (s.bodyweight || s.load === null) return convention === 'bodyweight' ? null : { value: 0, unit, convention };
  const value = s.unit === unit ? s.load : roundToStep(convertMass({ value: s.load, unit: s.unit }, unit).value, 0.01);
  // A load on a bodyweight row is added weight.
  return { value, unit, convention: convention === 'bodyweight' ? 'added' : convention };
}

export type NoteService = ReturnType<typeof createNoteService>;
