import { activityGroupsLine, activityGroupWord, compactSleepText, formatNumber, groupLabel, NBSP, reviewFactLines, WEEKLY_REVIEW, type ReviewTemplate, type TemplateEdit, type WeeklyFacts } from '@fizz/domain';
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
  // (Ben, 27 Oct) Every other activity, grouped (the card's line is cut at three), and Apple Health's raw values:
  // data only (rules 8, 10). Lifting comes first (gym first); none of these are reasons to change loads (rule 3).
  const acts = activityGroupsLine(f.activities, 99);
  if (acts !== null) out.push(`Other activity this week (Ben's and Apple Health's, never lifting): ${acts.all.join(', ')}`);
  if (f.health !== null) {
    const parts = [
      f.health.sleep === null ? null : `average sleep ${compactSleepText(f.health.sleep.avgMin)} over ${String(f.health.sleep.nights)} nights`,
      f.health.restingHr === null ? null : `resting heart rate ${String(f.health.restingHr.start.bpm)} bpm on ${f.health.restingHr.start.date}, ${String(f.health.restingHr.end.bpm)} bpm on ${f.health.restingHr.end.date}`,
    ].filter((x): x is string => x !== null);
    out.push(`From Apple Health (data${f.health.sources.length > 0 ? `, ${f.health.sources.map((x) => JSON.stringify(x)).join(', ')}` : ''}): ${parts.join('; ')}. No score; never a reason to change loads on its own; never diagnose.`);
  }
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
  // (Ben, 27 Oct) Each activity group's count, distance (km) and hours; its minutes join the minutes the coach may name.
  const activityMinutes: number[] = [];
  for (const a of f.activities) {
    const one = activityGroupWord(a.group, 1);
    const many = activityGroupWord(a.group, 2);
    const e = a.group === 'run' ? runs : entity(a.group === 'other' ? ['other activity', 'other activities'] : [one, many]);
    const minutes = a.durationS === null ? null : Math.round(a.durationS / 60);
    add(e.sets, a.count, a.distanceM === null ? null : Math.round(a.distanceM / 100) / 10, minutes === null ? null : Math.floor(minutes / 60), minutes === null ? null : Math.round(minutes / 6) / 10);
    if (minutes !== null) activityMinutes.push(minutes, minutes % 60);
  }
  if (f.health !== null) {
    if (f.health.sleep !== null) {
      const m = f.health.sleep.avgMin;
      add(entity(['sleep', 'slept', 'asleep']).sets, Math.floor(m / 60), Math.round(m / 6) / 10, f.health.sleep.nights);
      activityMinutes.push(m % 60, m);
    }
    if (f.health.restingHr !== null) add(entity(['resting heart rate', 'resting hr', 'rhr', 'bpm']).sets, f.health.restingHr.start.bpm, f.health.restingHr.end.bpm, Math.abs(f.health.restingHr.end.bpm - f.health.restingHr.start.bpm));
  }
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
    minutes: new Set(activityMinutes),
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

/** The coach's ask Ben hasn't answered (open, or out of date without his answer): a fresh tweak may replace it. */
export function unansweredAsk(p: Pick<ReviewProposal, 'source' | 'status'>): boolean {
  return p.source === 'coach' && (p.status === 'open' || p.status === 'stale');
}

/**
 * What a re-run review keeps of the review it replaces (review build-b-21oct S1, progress-v3b-data B1). Ben's
 * answers carry over (applied, skipped, undone, out of date); code's out-of-date suggestions don't, and code's
 * open offer carries over only while this week's facts still hold the same edit (else it goes; review
 * v5offers N1: carried, it keeps its ID, so a re-run doesn't make it again as new and bring `NEW` back); the
 * coach's open asks carry over unanswered. Never an open one on a movement with a pain flag now (rule 9). A
 * carried ask's reason was checked against the old facts, so it is checked again against this week's: a
 * sentence whose number no longer holds is hidden like any other (rule 6).
 */
export function carriedProposals(previous: readonly ReviewProposal[], ctx: { facts: WeeklyFacts; painFlagged: ReadonlySet<string> }): ReviewProposal[] {
  const claims = weeklyClaimFacts(ctx.facts);
  const stillEdited = (p: ReviewProposal): boolean => ctx.facts.edits.some((e) => e.routineId === p.change.routineId && e.exerciseId === p.change.exerciseId && e.fromSets === p.change.fromSets && e.toSets === p.change.toSets);
  return previous
    .filter((p) => (p.status === 'open' ? !ctx.painFlagged.has(p.change.exerciseId) && (p.source === 'coach' || stillEdited(p)) : !(p.status === 'stale' && p.source === 'code')))
    .map((p) => (unansweredAsk(p) && p.reason !== null ? { ...p, reason: checkClaims(p.reason, claims).shown?.slice(0, 300) ?? null } : p));
}

/**
 * This run's coach tweaks into the stored changes, one per routine and exercise: a fresh tweak replaces an
 * unanswered coach ask for the same exercise in its place (the newer data wins); anything Ben answered, and
 * code's, stays and the tweak is dropped. A tweak that replaces an offer stays an offer (`offer`; review
 * v5offers 4: what Ben was asked about never applies itself). At most `max`.
 */
export function mergeCoachAsks(stored: readonly ReviewProposal[], fresh: readonly ReviewProposal[], max = 4): ReviewProposal[] {
  const key = (p: ReviewProposal) => `${p.change.routineId}|${p.change.exerciseId}`;
  const out = [...stored];
  for (const p of fresh) {
    const i = out.findIndex((q) => key(q) === key(p));
    const had = out[i];
    if (had === undefined) out.push(p);
    else if (unansweredAsk(had)) out[i] = had.offer === true ? { ...p, offer: true } : p;
  }
  return out.slice(0, max);
}
