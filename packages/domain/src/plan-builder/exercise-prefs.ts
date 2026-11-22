import { PLAN_BUILDER_LIMITS, PLAN_LIMITS, type PlanBuilderAnswers, type PlanDraft, type ZonedTimestamp } from '@fizz/schemas';

import { pbPrefLikes } from './engine';
import { pbNotPreferred } from './plan-swap';
import { PB_PREF_QUESTIONS } from './tables';

/**
 * (Ben, 2 Nov: "I don't like leg extensions, take them out") One exercise's preference, set or cleared, on the plan
 * builder's **Any preferences** (the plan in use's answers: `prefs`, `likes`, `never`). These are the same answers the
 * builder, Plan › Muscles' Rebalance and the plan swap read (`pbNotPreferred`), so the coach and Plan setup can never
 * disagree. Pure.
 *
 * - `not_preferred`: in `never`, out of `likes`; a question whose pick holds it goes back to `No preference`
 *   (`either`), with the pick's other exercises kept as likes. Nothing else becomes preferred or not preferred.
 * - `preferred`: in `likes`, out of `never` (a like beats an unpicked option, as on Plan setup).
 * - `none`: out of `likes` and `never`; a question whose *other* pick made it not preferred goes back to `either`, with
 *   that pick's exercises kept as likes.
 *
 * `pbSetPlanPrefs` writes the result on the plan in use: every builder version's answers (so an Undo of a later plan
 * edit can't silently bring the old preference back), the days untouched, one versioned write (rule 5).
 */

export type ExercisePreference = 'not_preferred' | 'preferred' | 'none';

/** The preference parts of the answers: what this change reads and writes, and what its Undo puts back. */
export type PbPrefParts = Pick<PlanBuilderAnswers, 'prefs' | 'likes' | 'never'>;

export function pbPrefPartsOf(a: PbPrefParts): PbPrefParts {
  return { prefs: { ...a.prefs }, likes: [...a.likes], never: [...a.never] };
}

/** Where an exercise stands on these answers (catalogue keys, or an exercise ID for one of his own). */
export function pbExercisePreferenceOf(a: PbPrefParts, key: string): ExercisePreference {
  if (pbNotPreferred(a).has(key)) return 'not_preferred';
  return pbPrefLikes(a).includes(key) ? 'preferred' : 'none';
}

const without = (list: readonly string[], key: string): string[] => list.filter((k) => k !== key);
const withKey = (list: readonly string[], key: string): string[] => (list.includes(key) ? [...list] : [...list, key]);

/** The question options (catalogue keys) an answer picks; `either` or unanswered: none. */
function pickedOf(qId: string, a: PbPrefParts): string[] {
  const q = PB_PREF_QUESTIONS.find((x) => x.id === qId);
  const ans = a.prefs[qId];
  if (q === undefined || ans === undefined || ans === 'either') return [];
  return typeof ans === 'object' ? [ans.other] : [...q.opts[ans]];
}

export type PbSetPreferenceResult = { kind: 'ok'; parts: PbPrefParts } | { kind: 'already' } | { kind: 'too_many' };

/** The answers with `key` set to `pref`; `already` when it already is, `too_many` past the likes/never limit. */
export function pbSetExercisePreference(a: PbPrefParts, key: string, pref: ExercisePreference): PbSetPreferenceResult {
  if (pbExercisePreferenceOf(a, key) === pref && (pref !== 'none' || (!a.likes.includes(key) && !a.never.includes(key)))) return { kind: 'already' };
  let prefs = { ...a.prefs };
  let likes = without(a.likes, key);
  let never = without(a.never, key);
  if (pref === 'not_preferred') {
    never = withKey(never, key);
    for (const qId of Object.keys(prefs)) {
      const picked = pickedOf(qId, { ...a, prefs });
      if (!picked.includes(key)) continue;
      prefs = { ...prefs, [qId]: 'either' };
      for (const k of picked) if (k !== key) likes = withKey(likes, k);
    }
  } else if (pref === 'preferred') {
    likes = withKey(likes, key);
  } else {
    for (const q of PB_PREF_QUESTIONS) {
      const picked = pickedOf(q.id, { ...a, prefs });
      const listed = q.opts.some((o) => o.includes(key)) || picked.includes(key);
      if (!listed || picked.length === 0) continue;
      // Its pick (or the other pick that made it not preferred) goes back to `No preference`; the rest of the pick
      // stays liked, so nothing else changes.
      prefs = { ...prefs, [q.id]: 'either' };
      for (const k of picked) if (k !== key) likes = withKey(likes, k);
    }
  }
  if (likes.length > PLAN_BUILDER_LIMITS.maxLikes || never.length > PLAN_BUILDER_LIMITS.maxLikes) return { kind: 'too_many' };
  return { kind: 'ok', parts: { prefs, likes, never } };
}

export function samePrefParts(a: PbPrefParts, b: PbPrefParts): boolean {
  const norm = (p: PbPrefParts) => JSON.stringify([Object.entries(p.prefs).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)), [...p.likes].sort(), [...p.never].sort()]);
  return norm(a) === norm(b);
}

/** The preference parts of the plan in use's answers (its current builder version); null: not a builder plan in use. */
export function pbPlanPrefParts(plan: Pick<PlanDraft, 'status' | 'applied' | 'versions' | 'currentVersion'>): PbPrefParts | null {
  if (plan.status !== 'applied' || plan.applied === null) return null;
  const answers = plan.versions.find((v) => v.n === plan.currentVersion)?.builder?.answers;
  return answers === undefined ? null : pbPrefPartsOf(answers);
}

export type PbSetPlanPrefsChange =
  | { kind: 'write'; next: PlanDraft; expectedVersion: number }
  | { kind: 'duplicate'; current: PlanDraft }
  /** The plan moved on since it was read, or its preferences aren't `onlyIf` any more (an Undo after another change). */
  | { kind: 'stale'; current: PlanDraft }
  | { kind: 'invalid'; current: PlanDraft; reason: 'not_a_builder_plan' };

/**
 * The plan in use with these preference parts on every builder version (the days, loads and weeks untouched). On the
 * version read (`expectedVersion`, rule 5), once per `opId`; `onlyIf`: only while its preferences are exactly these
 * (Undo: as the change left them).
 */
export function pbSetPlanPrefs(current: PlanDraft, input: { expectedVersion: number | null; opId: string; at: ZonedTimestamp; parts: PbPrefParts; onlyIf?: PbPrefParts }): PbSetPlanPrefsChange {
  if (current.opIds.includes(input.opId)) return { kind: 'duplicate', current };
  if (input.expectedVersion !== null && current.version !== input.expectedVersion) return { kind: 'stale', current };
  const now = pbPlanPrefParts(current);
  if (now === null) return { kind: 'invalid', current, reason: 'not_a_builder_plan' };
  if (input.onlyIf !== undefined && !samePrefParts(now, input.onlyIf)) return { kind: 'stale', current };
  const parts = pbPrefPartsOf(input.parts);
  const versions = current.versions.map((v) => (v.builder === undefined ? v : { ...v, builder: { ...v.builder, answers: { ...v.builder.answers, ...parts } } }));
  const next: PlanDraft = { ...current, versions, opIds: [...current.opIds, input.opId].slice(-PLAN_LIMITS.maxOps), version: current.version + 1, updatedAtUtc: input.at.utc };
  return { kind: 'write', next, expectedVersion: current.version };
}
