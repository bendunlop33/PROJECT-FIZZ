import type { CoachModelPort, ModelEvent, ModelRequest } from '@fizz/coach';
import type { TextCoachState } from '@fizz/providers';

/** A scripted model for the coach tests: each step is computed from the request (so it can name real set IDs and versions). */
export class StepModel implements CoachModelPort {
  readonly requests: ModelRequest[] = [];
  /**
   * The weekly reviews the app starts by itself on open (workout-builder-v3 §6.1): kept apart, answered
   * `unavailable`, so a background review never takes a step scripted for the flow under test. `weekly:
   * true` scripts them like any other request (the weekly review's own tests).
   */
  readonly background: ModelRequest[] = [];
  constructor(
    private readonly steps: ((req: ModelRequest) => ModelEvent[])[],
    private readonly opts: { weekly?: boolean } = {},
  ) {}
  async *stream(request: ModelRequest): AsyncIterable<ModelEvent> {
    if (this.opts.weekly !== true && typeof request.toolChoice === 'object' && request.toolChoice.name === 'weekly_review') {
      this.background.push(request);
      await Promise.resolve();
      yield { type: 'error', error: 'unavailable' };
      return;
    }
    this.requests.push(request);
    const step = this.steps[this.requests.length - 1];
    const events = step === undefined ? [{ type: 'error' as const, error: 'unavailable' as const }] : step(request);
    for (const e of events) {
      await Promise.resolve();
      yield e;
    }
  }
}

export interface ContextWorkout {
  sessionId: string;
  version: number;
  exercises: { sessionExerciseId: string; exerciseId: string; name: string; sets: { setId: string; status: string; target: { load: { value: number; unit: string; convention: string } | null; reps: { min: number; max: number } | null } }[] }[];
}

/** The `YOUR DATA` block's workout, as the model sees it. */
export function contextWorkout(req: ModelRequest): ContextWorkout {
  const block = req.input.find((i) => i.type === 'message' && i.role === 'developer' && i.content.startsWith('YOUR DATA'));
  if (block?.type !== 'message') throw new Error('no context');
  return (JSON.parse(block.content.slice(block.content.indexOf('\n') + 1)) as { workout: ContextWorkout }).workout;
}

export const toolCall = (name: string, args: unknown): ModelEvent[] => [{ type: 'tool_call', callId: `c-${name}`, name, arguments: JSON.stringify(args) }, { type: 'completed' }];
export const replyWith = (message: string): ModelEvent[] => toolCall('reply', { message, offer: null });

/** The model lowers every pending set of the workout's first exercise by 2.5 kg. */
export const lowerPending = (reason = 'Hard.') => (req: ModelRequest): ModelEvent[] => {
  const w = contextWorkout(req);
  const ex = w.exercises[0];
  const pending = ex?.sets.filter((x) => x.status === 'pending') ?? [];
  const lighter = { value: (pending[0]?.target.load?.value ?? 60) - 2.5, unit: 'kg', convention: 'total' };
  return toolCall('edit_today', { baseVersion: w.version, ops: pending.map((x) => ({ op: 'set', setId: x.setId, target: { load: lighter, reps: null } })), reason });
};

/** The summary turn saves 57.5 kg for the workout's first exercise. */
export const saveNextTarget = (value = 57.5) => (req: ModelRequest): ModelEvent[] => {
  const w = contextWorkout(req);
  return toolCall('set_next_session_targets', { sourceSessionId: w.sessionId, sourceVersion: w.version, targets: [{ exerciseId: w.exercises[0]?.exerciseId, target: { load: { value, unit: 'kg', convention: 'total' }, reps: null }, sets: null, reason: 'Heavy.' }] });
};

export const CONNECTED: TextCoachState = { status: 'ok', route: 'chatgpt_plan', email: 'ben@example.com', model: { slug: 'gpt-6.1-sol', displayName: 'GPT-6.1-Sol' } };
