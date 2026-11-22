import type { ReviewProposal, Routine, SetTemplate } from '@fizz/schemas';
import { deriveId } from '../stable';
import { WEEKLY_REVIEW } from './weekly';

/**
 * A weekly review's plan tweak (§6.1, §6.2): one exercise of a plan-day template to N working sets. Pure.
 * Extra sets copy the exercise's last working set (its reps, load mode and rest), fewer drop the last ones;
 * warm-ups and every other exercise stay as they are. Loads aren't touched, so nothing needs snapping
 * (rule 4). Refused when the template moved past the version the review saw (rule 5).
 */
export type TemplateSetsChange = { kind: 'write'; next: Routine } | { kind: 'stale'; current: Routine } | { kind: 'invalid'; reason: 'missing_exercise' | 'sets' | 'deleted' };

export function templateWorkingSets(r: Pick<Routine, 'exercises'>, exerciseId: string): number | null {
  const e = r.exercises.find((x) => x.exerciseId === exerciseId);
  return e === undefined ? null : e.setTemplates.filter((t) => t.setType !== 'warmup').length;
}

export function withTemplateWorkingSets(current: Routine, req: { exerciseId: string; toSets: number; expectedVersion: number; opId: string; atUtc: string }): TemplateSetsChange {
  if ((current.deletedAtUtc ?? null) !== null) return { kind: 'invalid', reason: 'deleted' };
  if (current.version !== req.expectedVersion) return { kind: 'stale', current };
  if (!Number.isInteger(req.toSets) || req.toSets < WEEKLY_REVIEW.setsMin || req.toSets > WEEKLY_REVIEW.setsMax) return { kind: 'invalid', reason: 'sets' };
  const i = current.exercises.findIndex((x) => x.exerciseId === req.exerciseId);
  const ex = current.exercises[i];
  if (ex === undefined) return { kind: 'invalid', reason: 'missing_exercise' };
  const working = ex.setTemplates.filter((t) => t.setType !== 'warmup');
  const last = working.at(-1);
  if (last === undefined) return { kind: 'invalid', reason: 'missing_exercise' };
  let templates: SetTemplate[];
  if (req.toSets >= working.length) {
    const extra = Array.from({ length: req.toSets - working.length }, (_, k): SetTemplate => ({ ...last, id: deriveId(`review-set:${req.opId}:${ex.id}:${String(k)}`) }));
    templates = [...ex.setTemplates, ...extra];
  } else {
    const drop = new Set(working.slice(req.toSets).map((t) => t.id));
    templates = ex.setTemplates.filter((t) => !drop.has(t.id));
  }
  const exercises = current.exercises.map((e, k) => (k === i ? { ...e, setTemplates: templates, structureChangedAtUtc: req.atUtc } : e));
  return { kind: 'write', next: { ...current, exercises, version: current.version + 1, updatedAtUtc: req.atUtc, lastOpId: req.opId } };
}

/** `Leg curl on Legs: 3 → 4 sets` (minimal copy: values only). */
export function reviewProposalText(p: Pick<ReviewProposal, 'change'>): string {
  const c = p.change;
  return `${c.exerciseName} on ${c.routineName}: ${String(c.fromSets)} → ${String(c.toSets)} sets`;
}
