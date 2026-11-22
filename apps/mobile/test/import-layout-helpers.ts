import { readFileSync } from 'node:fs';

import type { CoachModelPort, ModelEvent, ModelRequest } from '@fizz/coach';
import type { TextCoachState } from '@fizz/providers';

import type { ImportDraft } from '../src/import/import-service';
import type { LayoutReviewView } from '../src/import/layout-service';
import type { AppServices } from '../src/services/app-services';

/** Synthetic layout fixtures shared with the domain tests (packages/domain/test/fixtures/layouts). Never a real export. */
export const layoutFixture = (name: string): string => readFileSync(new URL(`../../../packages/domain/test/fixtures/layouts/${name}`, import.meta.url), 'utf8');

/** A spy port: records every request and answers each with the next scripted step (none left: `unavailable`). */
export class SpyLayoutPort implements CoachModelPort {
  readonly requests: ModelRequest[] = [];
  constructor(public steps: ((req: ModelRequest) => ModelEvent[])[] = []) {}
  async *stream(request: ModelRequest): AsyncIterable<ModelEvent> {
    this.requests.push(request);
    const step = this.steps[this.requests.length - 1];
    const events: ModelEvent[] = step === undefined ? [{ type: 'error', error: 'unavailable' }] : step(request);
    for (const e of events) {
      if (request.signal?.aborted === true) {
        yield { type: 'error', error: 'cancelled' };
        return;
      }
      await Promise.resolve();
      yield e;
    }
  }
}

export const answerWith =
  (spec: unknown) =>
  (): ModelEvent[] => [{ type: 'heartbeat' }, { type: 'tool_call', callId: 'c1', name: 'submit_import_layout', arguments: JSON.stringify(spec) }, { type: 'completed' }];

export const state = (status: TextCoachState['status']): TextCoachState => ({ status, route: status === 'not_connected' ? null : 'chatgpt_plan', email: 'ben@example.com', model: { slug: 'gpt-test', displayName: 'GPT test' } });

/** Ben's answers on Check the layout: `Workouts I did`, `Use this` on every Check, the first option of each question. */
export function answerLayout(s: AppServices, layoutId: string, over: { unit?: 'kg' | 'lb'; dateOrder?: 'day_first' | 'month_first' } = {}): Promise<LayoutReviewView> {
  const first = s.importLayouts.getLayoutReview(layoutId);
  if (!first) throw new Error('no review');
  let v: LayoutReviewView = first;
  const apply = (change: Parameters<AppServices['importLayouts']['updateImportLayout']>[1]) => {
    const r = s.importLayouts.updateImportLayout(layoutId, change, v.layoutVersion);
    if (!r.ok) throw new Error(r.reason);
    const next = s.importLayouts.getLayoutReview(layoutId);
    if (!next) throw new Error('no review');
    v = next;
  };
  for (const q of v.review.questions) {
    if (q.kind === 'record_kind' && q.answer === null) apply({ kind: 'record_kind', answer: 'done' });
    if (q.kind === 'unit' && q.answer === null) apply({ kind: 'unit', answer: over.unit ?? 'kg' });
    if (q.kind === 'date_order' && q.answer === null) apply({ kind: 'date_order', answer: over.dateOrder ?? 'day_first' });
    if (q.kind === 'notation' && q.answer === null) apply({ kind: 'notation', column: q.column, answer: q.options[0]?.answer ?? 'sets_x_reps' });
    if (q.kind === 'marker' && (q.marker.state === 'check' || q.marker.state === 'question')) apply({ kind: 'marker', token: q.marker.token, meaning: q.marker.suggested ?? 'working' });
    if (q.kind === 'new_column' && q.answer === null) apply({ kind: 'role', column: q.column, role: 'not_imported' });
  }
  for (const c of v.review.columns) if (c.state === 'check') apply({ kind: 'confirm', column: c.index });
  return Promise.resolve(v);
}

/** Ben's answers on the shared preview: suggested names, each dumbbell exercise `each`, barbells `total`. */
export async function answerPreview(s: AppServices, d: ImportDraft): Promise<ImportDraft> {
  let draft = d;
  const step = async (change: Parameters<AppServices['imports']['answer']>[2]) => {
    const r = await s.imports.answer(draft.draftId, draft.mappingVersion, change);
    if (!r.ok) throw new Error(r.reason);
    draft = r.draft;
  };
  for (const n of draft.analysis.names.filter((x) => x.needsAnswer)) await step({ kind: 'name', key: n.key, answer: n.match.exerciseId ? { kind: 'exercise', exerciseId: n.match.exerciseId } : { kind: 'skip' } });
  for (const e of draft.analysis.perHand?.exercises ?? []) if (e.reading === null) await step({ kind: 'per_hand_override', key: e.key, answer: 'each' });
  if (draft.analysis.total?.open) await step({ kind: 'total', answer: 'total' });
  for (const q of draft.analysis.bodyweight) if (q.answer === null) await step({ kind: 'bodyweight', key: q.key, answer: 'added' });
  const open = draft.analysis.valueChecks.filter((v) => v.answer === null).map((v) => v.key);
  if (open.length > 0) await step({ kind: 'value_checks_all', keys: open });
  return draft;
}
