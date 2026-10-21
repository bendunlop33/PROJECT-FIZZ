import { formatNumber, groupLabel, NBSP, reviewFactLines, WEEKLY_REVIEW, type ReviewTemplate, type TemplateEdit, type WeeklyFacts } from '@fizz/domain';
import { builderGroupOfMuscleGroup, type ReviewProposal, type WeeklyReviewArgs, type WeightUnit } from '@fizz/schemas';
import { checkClaims, claimLower, exerciseNames, type ClaimFacts, type SessionClaims } from './claims';

/**
 * The weekly review's coach part, checked (workout-builder-v3 §6.1 weekly, §6.2; Ben 20–21 Oct). Pure.
 * Code counts everything; the coach adds a verdict, a few lines and at most 2 plan tweaks. Every number
 * in its words must be the fact it names (`checkClaims`, the builder's strict claim check): a sentence
 * with a wrong one is hidden whole. A tweak is only ever an offer (Apply / Skip) on an exercise already
 * in one of the plan's days, never pain-flagged (rule 9), 1–8 working sets, at most 2 from now.
 */

/** Code's fact lines for the coach: what the card shows, plus the plan and range numbers behind them. */
export function weeklyFactTexts(f: WeeklyFacts): string[] {
  const out = reviewFactLines(f);
  for (const g of f.groups) {
    const parts = [`${String(g.sets)} sets`, g.planned === null ? null : `plan ${String(g.planned)}`, g.range === null ? null : `goal range ${String(g.range.min)}–${String(g.range.max)}`].filter((x): x is string => x !== null);
    out.push(`${groupLabel(g.group)}: ${parts.join(', ')}`);
  }
  for (const l of f.lifts) {
    if (l.points.length < 2) continue;
    const unit = l.unit === null ? 'reps' : l.unit;
    out.push(`${l.name} by session: ${l.points.map((p) => formatNumber(p.value)).join(', ')} ${unit}${l.metric === 'e1rm' ? ' (est. 1RM)' : ''}`);
    if (l.target !== null) out.push(`${l.name} target: ${formatNumber(l.target.value)} ${unit}${l.was === null ? '' : `, was ${formatNumber(l.was.value)}`}`);
  }
  for (const w of f.weeks) out.push(`Week of ${w.monday}: ${w.planned === null ? `${String(w.workouts)} workouts` : `${String(w.done)} of ${String(w.planned)} sessions`}, ${String(w.runs)} runs`);
  return out.map((t) => t.replaceAll(NBSP, ' '));
}

const near = (a: number, b: number): boolean => Math.abs(a - b) < 0.011;
function add(set: Set<number>, ...vs: (number | null | undefined)[]): void {
  for (const v of vs) if (v !== null && v !== undefined && Number.isFinite(v) && ![...set].some((x) => near(x, v))) set.add(v);
}

/** The numbers each fact names, for the claim check. Never IDs, memories or the model's own words. */
export function weeklyClaimFacts(f: WeeklyFacts): ClaimFacts {
  const entities: ClaimFacts['entities'] = [];
  const entity = (names: readonly string[]) => {
    const e = { names: [...new Set(names.map(claimLower))], sets: new Set<number>(), exercises: new Set<number>(), reps: new Set<number>(), rpe: new Set<number>(), loads: [] as { value: number; unit: WeightUnit }[], estimates: [] as { value: number; unit: WeightUnit }[] };
    entities.push(e);
    return e;
  };
  let legs = 0;
  for (const g of f.groups) {
    const e = entity([groupLabel(g.group), g.group]);
    add(e.sets, g.sets, g.planned, g.range?.min, g.range?.max);
    if (builderGroupOfMuscleGroup(g.group) === 'Legs') legs += g.sets;
  }
  if (f.groups.some((g) => builderGroupOfMuscleGroup(g.group) === 'Legs')) add(entity(['legs', 'leg']).sets, legs);
  for (const l of f.lifts) {
    const e = entity(exerciseNames(l.name));
    for (const p of l.points) {
      add(e.reps, p.reps);
      if (l.unit !== null) {
        // An est. 1RM is never a load Ben lifted (rule 6; review b3-wave3-truth B1): its own list.
        (l.metric === 'e1rm' ? e.estimates : e.loads).push({ value: p.value, unit: l.unit });
        if (p.load !== null) e.loads.push({ value: p.load.value, unit: p.load.unit });
      } else add(e.reps, p.value);
    }
    if (l.target !== null && l.unit !== null) {
      e.loads.push({ value: l.target.value, unit: l.unit });
      add(e.reps, l.target.reps);
    }
    if (l.was !== null && l.unit !== null) (l.was.isEstimate ? e.estimates : e.loads).push({ value: l.was.value, unit: l.unit });
  }
  const rpe = entity(['rpe', 'average rpe']);
  if (f.rpe !== null) {
    add(rpe.rpe, f.rpe.mean, f.rpe.target);
    add(rpe.sets, f.rpe.mean, f.rpe.target);
  }
  const runs = entity(['runs', 'run', 'km']);
  add(runs.sets, f.runs.count, f.runs.distanceM === null ? null : Math.round(f.runs.distanceM / 100) / 10);
  // Each count against the fact it names (review b3-wave3-truth B2), never one shared pool.
  const set = (...vs: (number | null | undefined)[]): Set<number> => {
    const out = new Set<number>();
    add(out, ...vs);
    return out;
  };
  const sessions: SessionClaims = {
    plain: set(f.week.done, f.week.planned, f.week.workouts),
    missed: set(f.missedCount > 0 ? f.missedCount : null),
    stalled: set(...f.stalled.map((s) => s.sessions)),
    feel: { easy: set(f.feel.easy > 0 ? f.feel.easy : null), good: set(f.feel.good > 0 ? f.feel.good : null), hard: set(f.feel.hard > 0 ? f.feel.hard : null) },
  };
  const ofPairs: [number, number][] = f.weeks.flatMap((w): [number, number][] => (w.planned === null ? [] : [[w.done, w.planned]]));
  const totalSets = f.groups.reduce((m, g) => m + g.sets, 0);
  return {
    entities,
    workingSets: new Set([totalSets]),
    exercises: new Set(),
    compound: new Set(),
    isolation: new Set(),
    minutes: new Set(),
    ofPairs,
    plan: new Set(),
    ben: new Set(),
    sessions,
    runs: new Set([f.runs.count]),
  };
}

/** Code's own tweak (§6.1 feedback loop): the same edit made twice from a template. */
export function codeProposals(edits: readonly TemplateEdit[], prefix: string): ReviewProposal[] {
  return edits.map((e) => ({
    id: `${prefix}:edit:${e.routineId}:${e.exerciseId}`.slice(0, 128),
    source: 'code',
    change: { kind: 'template_sets', routineId: e.routineId, routineName: e.routineName.slice(0, 120), expectedVersion: e.expectedVersion, exerciseId: e.exerciseId, exerciseName: e.exerciseName.slice(0, 120), fromSets: e.fromSets, toSets: e.toSets },
    reason: `${String(e.toSets)} sets the last ${String(e.sessions)} times`,
    status: 'open',
    actionId: null,
  }));
}

export interface CheckedWeekly {
  verdict: string | null;
  lines: string[];
  /** Sentences hidden for a number not in the facts (kept for `Why?` → `Not shown`). */
  hidden: string[];
  proposals: ReviewProposal[];
  /** Tweaks refused, with why (not shown to Ben; for tests and diagnostics). */
  refused: { routineId: string; exerciseId: string; why: 'not_in_plan' | 'not_in_day' | 'pain' | 'sets' | 'same' | 'duplicate' }[];
}

export function checkWeeklyReview(args: WeeklyReviewArgs, ctx: { facts: WeeklyFacts; templates: readonly ReviewTemplate[]; painFlagged: ReadonlySet<string>; prefix: string; taken: readonly ReviewProposal[] }): CheckedWeekly {
  const claims = weeklyClaimFacts(ctx.facts);
  const hidden: string[] = [];
  const check = (t: string): string | null => {
    const c = checkClaims(t, claims);
    hidden.push(...c.hidden);
    return c.shown;
  };
  const verdict = check(args.verdict);
  const lines = args.lines.map(check).filter((x): x is string => x !== null);
  const proposals: ReviewProposal[] = [];
  const refused: CheckedWeekly['refused'] = [];
  const key = (r: string, e: string) => `${r}|${e}`;
  const seen = new Set(ctx.taken.map((p) => key(p.change.routineId, p.change.exerciseId)));
  args.tweaks.forEach((t, i) => {
    const r = { routineId: t.routineId, exerciseId: t.exerciseId };
    const tpl = ctx.templates.find((x) => x.routineId === t.routineId);
    if (tpl === undefined) return refused.push({ ...r, why: 'not_in_plan' });
    const ex = tpl.exercises.find((x) => x.exerciseId === t.exerciseId);
    if (ex === undefined) return refused.push({ ...r, why: 'not_in_day' });
    if (ctx.painFlagged.has(t.exerciseId)) return refused.push({ ...r, why: 'pain' });
    if (t.workingSets === ex.workingSets) return refused.push({ ...r, why: 'same' });
    if (t.workingSets < WEEKLY_REVIEW.setsMin || t.workingSets > WEEKLY_REVIEW.setsMax || Math.abs(t.workingSets - ex.workingSets) > WEEKLY_REVIEW.maxStep) return refused.push({ ...r, why: 'sets' });
    if (seen.has(key(t.routineId, t.exerciseId))) return refused.push({ ...r, why: 'duplicate' });
    seen.add(key(t.routineId, t.exerciseId));
    proposals.push({
      id: `${ctx.prefix}:coach:${String(i)}`.slice(0, 128),
      source: 'coach',
      change: { kind: 'template_sets', routineId: tpl.routineId, routineName: tpl.name.slice(0, 120), expectedVersion: tpl.version, exerciseId: ex.exerciseId, exerciseName: ex.name.slice(0, 120), fromSets: ex.workingSets, toSets: t.workingSets },
      reason: check(t.reason)?.slice(0, 300) ?? null,
      status: 'open',
      actionId: null,
    });
    return undefined;
  });
  return { verdict: verdict?.slice(0, 200) ?? null, lines: lines.map((l) => l.slice(0, 300)), hidden, proposals, refused };
}
