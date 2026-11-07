import type { ExerciseHistoryView, ExerciseRecordsView, LastDaysView, RecentSessionsView } from '@fizz/domain';
import { BUILDER_COACH_TOOL_ARGS, type BuilderCoachToolArgs, type BuilderCoachToolName, type CoachToolName, type WeightUnit } from '@fizz/schemas';
import type { CoachExecutors, ToolCallContext } from '../executors';
import { functionToolDefinition } from '../function-tools';
import type { CoachModelPort, ModelInputItem, ModelRequest } from '../model-port';
import { findTool, type TurnRegistry } from '../registry';
import { parseToolCall } from '../tool-call';
import { DEFAULT_COACH_TIMING, runModelStep, type CoachTiming, type StepOutcome } from '../turn';
import { exerciseNames, type ClaimExtra } from './claims';
import type { BuilderToolAnswer } from './requests';

/**
 * (Ben, 28 Oct: the workout-editor coach "can only see today's workout and a few last-set history entries, not
 * yesterday's full workout log") The builder's edit coach may read Ben's history before it answers, with the
 * main coach's own read tools: `get_recent_sessions` (with a `date` or `daysAgo` for one day), `get_recent_training`
 * and `get_exercise_records`. Restricted the same way as the main coach's: the registry's declarations (read
 * effect, writing nothing, needing no request), its argument schemas (`parseToolCall`) and its executors over the
 * same local port, at most `BUILDER_READ_STEPS` reads, one call a step. Every result goes back labelled Your data,
 * its text data never instructions (rules 8, 10). The answer is still the one builder function, a proposal Ben
 * applies or skips: no new write power.
 */

export const BUILDER_READ_TOOLS: readonly CoachToolName[] = ['get_recent_sessions', 'get_recent_training', 'get_exercise_records'];
/** Reads at most before the builder function is forced. */
export const BUILDER_READ_STEPS = 3;

export interface BuilderReads {
  executors: CoachExecutors;
  /** The executors' context (reads use `now` for `daysAgo`; nothing is written). */
  context: ToolCallContext;
}

/** The read tools the builder's coach is offered: the registry's own, read-only, and only those with an executor. */
export function builderReadRegistry(executors: CoachExecutors): TurnRegistry {
  const tools = BUILDER_READ_TOOLS.flatMap((n) => {
    const t = findTool(n);
    return t !== null && t.effect === 'read' && t.writes.length === 0 && t.needs === 'none' && executors[n] !== undefined ? [t] : [];
  });
  return { tools, withheld: [] };
}

/** One builder function call's arguments, parsed by its schema. */
export function parseBuilderArgs<K extends BuilderCoachToolName>(tool: K, args: string): BuilderToolAnswer<K> {
  let raw: unknown;
  try {
    raw = JSON.parse(args);
  } catch {
    return { ok: false, error: 'invalid_args' };
  }
  const parsed = BUILDER_COACH_TOOL_ARGS[tool].safeParse(raw);
  return parsed.success ? { ok: true, args: parsed.data as BuilderCoachToolArgs[K] } : { ok: false, error: 'invalid_args' };
}

/** A step, tried once more after a transient failure before any answer (as `requestBuilderTool`). */
async function step(port: CoachModelPort, req: ModelRequest, timing: CoachTiming, signal: AbortSignal | undefined): Promise<StepOutcome> {
  const out = await runModelStep(port, req, timing, signal);
  if (out.kind === 'error' && out.transient === true && signal?.aborted !== true) return runModelStep(port, req, timing, signal);
  return out;
}

export interface BuilderReadLog {
  tool: CoachToolName;
  data: unknown;
}

/**
 * The builder request with the read tools: each step the model calls one function (`required`): a read (run,
 * its result sent back) or the builder function (parsed, the answer). The last step forces the builder function.
 * Without reads (none wired), the plain one-function request.
 */
export async function requestBuilderToolWithReads<K extends BuilderCoachToolName>(
  port: CoachModelPort,
  req: ModelRequest,
  tool: K,
  reads: BuilderReads | null,
  opts: { signal?: AbortSignal; timing?: CoachTiming } = {},
): Promise<{ answer: BuilderToolAnswer<K>; reads: BuilderReadLog[] }> {
  const timing = opts.timing ?? DEFAULT_COACH_TIMING;
  const registry = reads === null ? null : builderReadRegistry(reads.executors);
  const readDefs = registry?.tools.map(functionToolDefinition) ?? [];
  const input: ModelInputItem[] = [...req.input];
  const log: BuilderReadLog[] = [];
  for (let i = 0; i <= BUILDER_READ_STEPS; i += 1) {
    const last = i === BUILDER_READ_STEPS || readDefs.length === 0;
    const out = await step(port, { ...req, input: [...input], tools: last ? req.tools : [...req.tools, ...readDefs], toolChoice: last ? { type: 'function', name: tool } : 'required' }, timing, opts.signal);
    if (out.kind === 'error') return { answer: { ok: false, error: out.error }, reads: log };
    if (out.kind !== 'call') return { answer: { ok: false, error: 'no_answer' }, reads: log };
    if (out.name === tool) return { answer: parseBuilderArgs(tool, out.arguments), reads: log };
    if (last || reads === null || registry === null) return { answer: { ok: false, error: 'no_answer' }, reads: log };
    input.push({ type: 'function_call', callId: out.callId, name: out.name, arguments: out.arguments });
    const parsed = parseToolCall(reads.context.turnId, out.name, out.arguments, registry);
    if (!parsed.ok) {
      input.push({ type: 'function_call_output', callId: out.callId, output: JSON.stringify({ status: parsed.error, line: parsed.line }) });
      continue;
    }
    const exec = reads.executors[parsed.call.tool];
    const result = exec === undefined ? null : await exec(parsed.call, reads.context).catch(() => null);
    if (result === null || result.kind !== 'read') {
      input.push({ type: 'function_call_output', callId: out.callId, output: JSON.stringify({ status: 'failed', line: 'Couldn’t read that.' }) });
      continue;
    }
    log.push({ tool: parsed.call.tool, data: result.data });
    input.push({ type: 'function_call_output', callId: out.callId, output: JSON.stringify({ status: 'ok', data: result.data }) });
  }
  return { answer: { ok: false, error: 'no_answer' }, reads: log };
}

// ---------------------------------------------------------------------------
// The claim check's facts from what the coach read (code's own text, so its numbers can be quoted back)

const LOAD = /(\d+(?:\.\d+)?)\s(kg|lb)\b/g;
const REPS = /×\s(\d+)/g;
const RPE = /RPE\s(\d+(?:\.\d+)?)/g;
const SETS = /(?:\((\d+) sets\)|·\s(\d+) sets?\b)/g;

function extraOf(name: string, texts: readonly string[]): ClaimExtra {
  const loads: { value: number; unit: WeightUnit }[] = [];
  const reps: number[] = [];
  const rpe: number[] = [];
  const sets: number[] = [];
  for (const t of texts.slice(0, 40)) {
    for (const m of t.matchAll(LOAD)) loads.push({ value: Number(m[1]), unit: m[2] === 'lb' ? 'lb' : 'kg' });
    for (const m of t.matchAll(REPS)) reps.push(Number(m[1]));
    for (const m of t.matchAll(RPE)) rpe.push(Number(m[1]));
    for (const m of t.matchAll(SETS)) sets.push(Number(m[1] ?? m[2]));
  }
  return { names: exerciseNames(name), loads, reps, rpe, sets };
}

/** `Bench press: 100 kg × 8 (3 sets)` → its name and the sets text. */
function splitLine(line: string): { name: string; text: string } | null {
  const at = line.search(/:\s| · /);
  return at <= 0 ? null : { name: line.slice(0, at), text: line.slice(at) };
}

/** The last 7 days' numbers, per exercise, for the builder claim check. */
export function lastDaysClaimExtras(v: LastDaysView | undefined): ClaimExtra[] {
  if (v === undefined) return [];
  const out: ClaimExtra[] = [];
  for (const d of v.days.slice(0, 10)) {
    for (const w of d.workouts.slice(0, 10)) {
      for (const line of w.exercises.slice(0, 20)) {
        const s = splitLine(line);
        if (s !== null) out.push(extraOf(s.name, [s.text]));
      }
    }
  }
  return out;
}

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;

/** The numbers in what the coach read this ask, per exercise (an e1RM only as an estimate). */
export function readClaimExtras(log: readonly BuilderReadLog[]): ClaimExtra[] {
  const out: ClaimExtra[] = [];
  for (const r of log) {
    if (!isObject(r.data)) continue;
    if (r.tool === 'get_recent_sessions') {
      const v = r.data as unknown as RecentSessionsView;
      for (const s of v.sessions.slice(0, 10)) for (const e of s.exercises.slice(0, 20)) out.push(extraOf(e.name, e.sets));
    } else if (r.tool === 'get_recent_training') {
      const v = r.data as unknown as ExerciseHistoryView;
      if (typeof v.exercise !== 'string') continue;
      const sets = v.sessions.flatMap((s) => s.sets).slice(0, 60);
      out.push({ names: exerciseNames(v.exercise), loads: sets.flatMap((s) => (s.load === null ? [] : [{ value: s.load.value, unit: s.load.unit }])), reps: sets.flatMap((s) => (s.reps === null ? [] : [s.reps])), rpe: sets.flatMap((s) => (s.rpe === null ? [] : [s.rpe])) });
    } else if (r.tool === 'get_exercise_records') {
      const v = r.data as unknown as ExerciseRecordsView;
      if (typeof v.exercise !== 'string') continue;
      const recs = v.records.slice(0, 20);
      out.push({
        names: exerciseNames(v.exercise),
        loads: recs.flatMap((x) => [x.heaviest.load, x.mostReps.load].map((l) => ({ value: l.value, unit: l.unit }))),
        reps: recs.flatMap((x) => [x.heaviest.reps, x.mostReps.reps]),
        estimates: recs.flatMap((x) => (x.bestE1rm === null ? [] : [{ value: x.bestE1rm.value, unit: x.unit }])),
      });
    }
  }
  return out;
}
