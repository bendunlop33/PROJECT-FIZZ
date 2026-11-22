import type { CoachModelPort, ModelEvent, ModelRequest } from '../src/model-port';

/**
 * A scripted model for tests: each `stream` call plays the next step's events
 * and records the request, so tests can assert which tools a turn offered and
 * what was sent. No network.
 */
export class ScriptedCoachModel implements CoachModelPort {
  readonly requests: ModelRequest[] = [];
  private step = 0;

  constructor(private readonly steps: readonly (readonly ModelEvent[])[]) {}

  async *stream(request: ModelRequest): AsyncIterable<ModelEvent> {
    this.requests.push(request);
    const events = this.steps[this.step] ?? [{ type: 'error', error: 'unavailable', detail: 'script exhausted' } as const];
    this.step += 1;
    for (const e of events) {
      if (request.signal?.aborted === true) {
        yield { type: 'error', error: 'cancelled' };
        return;
      }
      await Promise.resolve();
      yield e;
    }
  }

  /** Tool names the model was offered in each request. */
  offeredTools(): string[][] {
    return this.requests.map((r) => r.tools.map((t) => t.name));
  }
}

/** Split a reply into small chunks, the way a stream delivers it (mid-word, mid-number). */
export function chunked(text: string, size = 7): ModelEvent[] {
  const out: ModelEvent[] = [];
  for (let i = 0; i < text.length; i += size) out.push({ type: 'text_delta', delta: text.slice(i, i + size) });
  return out;
}
