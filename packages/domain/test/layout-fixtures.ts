import { readFileSync } from 'node:fs';
import { EMPTY_LAYOUT_ANSWERS, ImportMappingSpecV1Schema, type ImportMappingSpecV1, type ImportProfile, type LayoutAnswers } from '@fizz/schemas';
import { buildLayoutReview, fingerprintOf, readTable, type LayoutReview, type Table } from '../src';

/** Synthetic layout fixtures (fixtures/layouts/README.md): made-up values in published layouts. Never a real export. */
export const layoutText = (name: string): string => readFileSync(new URL(`./fixtures/layouts/${name}`, import.meta.url), 'utf8');
export const layoutSpec = (name: string): unknown => JSON.parse(layoutText(name)) as unknown;
export const tableOf = (name: string): Table => {
  const t = readTable(layoutText(name));
  if (!t) throw new Error(`${name} isn't a table`);
  return t;
};
export const OPTS = { today: '2026-10-12', tz: 'Europe/London' } as const;

export const specOf = (name: string): ImportMappingSpecV1 => ImportMappingSpecV1Schema.parse(layoutSpec(name));

const T = '2026-10-12T09:00:00.000Z';
export const PROFILE_OWNER = '00000000-0000-4000-8000-0000000000a1';
export const profileId = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** A saved layout for a fixture (as a commit would save it). */
export function profileFor(name: string, answers: LayoutAnswers, over: Partial<ImportProfile> = {}): ImportProfile {
  const table = tableOf(`${name}.synthetic.csv`);
  return {
    id: profileId(1),
    ownerId: PROFILE_OWNER,
    version: 1,
    createdAtUtc: T,
    updatedAtUtc: T,
    name,
    kind: 'table',
    fingerprint: fingerprintOf(table),
    spec: specOf(`${name}.spec.json`),
    answers,
    seen: { markers: [], negativeNames: [] },
    uses: [profileId(9)],
    provenance: { proposedBy: 'coach', route: 'chatgpt_plan', model: 'gpt-test', specHash: 'a'.repeat(64), createdAt: { utc: T, tz: 'Europe/London' }, confirmedAt: { utc: T, tz: 'Europe/London' } },
    deletedAt: null,
    ...over,
  };
}

/**
 * Answer every open question the way Ben would (`Workouts I did`, `Use this`
 * on every Check, the first option of each question unless given), for
 * tests of what follows the review.
 */
export function answerAll(name: string, over: Partial<LayoutAnswers> = {}, spec: ImportMappingSpecV1 = specOf(`${name}.spec.json`)): { answers: LayoutAnswers; review: LayoutReview } {
  const table = tableOf(`${name}.synthetic.csv`);
  let answers: LayoutAnswers = { ...EMPTY_LAYOUT_ANSWERS, recordKind: 'done', ...over };
  const first = buildLayoutReview(table, spec, answers, OPTS);
  const roles = { ...answers.roles };
  for (const c of first.columns) if (c.state === 'check') roles[String(c.index)] = c.role;
  const markers = { ...answers.markers };
  const notation = { ...answers.notation };
  for (const q of first.questions) {
    if (q.kind === 'marker' && (q.marker.state === 'check' || q.marker.state === 'question')) markers[q.marker.token] ??= q.marker.suggested ?? 'working';
    if (q.kind === 'notation' && q.answer === null) notation[String(q.column)] ??= q.options[0]?.answer ?? 'sets_x_reps';
  }
  const unitAsked = first.questions.some((q) => q.kind === 'unit');
  const dateAsked = first.questions.some((q) => q.kind === 'date_order');
  answers = {
    ...answers,
    roles,
    markers,
    notation,
    unit: answers.unit ?? (unitAsked ? 'kg' : null),
    dateOrder: answers.dateOrder ?? (dateAsked ? 'day_first' : null),
  };
  return { answers, review: buildLayoutReview(table, spec, answers, OPTS) };
}
