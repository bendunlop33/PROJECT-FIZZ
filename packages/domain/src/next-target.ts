import type { CheckIn, EquipmentInstance, Load, LoadConvention, Measurement, PainFlag, PlannedSet, ProgressionRule, SetType, WeightUnit } from '@fizz/schemas';
import { compareDifficulty, loadDirection, stepLoad } from './equipment';
import { formatNumber } from './display';
import { cushionReps, cushionWhy, pickLikeForLike, resolveContext, type ContextExposure, type MusclesOf, type ResolvedContext, type WorkContext } from './in-session-fatigue';
import { painMentionedNotFlagged, painStatusFor } from './checkin';
import { builtInDefaultRule, ruleCategory, type RuleExerciseInfo } from './default-rule';
import { calculateNextTargets, latestJudgedSession, type EarlierWorkNote, type HistorySession, type NextTargets, type NextTargetsInput, type PainStatus } from './progression';
import { aimReps, PERSONAL_REPS, personalRepRange, personalRuleName, ruleRepsFact, typicalReps, type PersonalRepsKind, type RuleReps } from './rep-range';
import { ruleTargetProvenance, type RuleProvenanceInput } from './target-provenance';

/**
 * One place that decides an exercise's next targets with the built-in rule,
 * used both by the Summary's `Next time` and when that exercise is next added
 * to a workout (review workout-loop S3, PM decision: prefill, labelled
 * `built-in rule`). Computed from the same inputs each time rather than
 * stored, so a later correction (brief scenario 5) changes the next targets
 * too, and nothing can go stale.
 */

/** PM decision (review SP3): `Pain` with no movement chosen holds every exercise of that workout. */
export function unspecifiedPain(checkIn: Pick<CheckIn, 'reasons' | 'painFlagIds' | 'recordedAt' | 'deletedAtUtc'> | null): PainStatus {
  if (checkIn === null || checkIn.deletedAtUtc !== undefined || !painMentionedNotFlagged(checkIn)) return { active: false, reportedAtUtc: null };
  return { active: true, reportedAtUtc: checkIn.recordedAt.utc };
}

export interface NextTargetRequest {
  ownerId: string;
  exerciseId: string;
  exerciseName: string;
  measurement: Measurement;
  unit: WeightUnit;
  convention: LoadConvention;
  equipment: EquipmentInstance | null;
  /** Catalogue info for the default rule's category; null = unknown (accessory range). */
  exercise: RuleExerciseInfo | null;
  /** The exercise's own rule (routine), else the built-in default applies. */
  rule: ProgressionRule | null;
  /** Working sets to aim for (this workout's, or the last comparable workout's). */
  workingSets: number;
  history: readonly HistorySession[];
  painFlags: readonly PainFlag[];
  /** Pain mentioned without a movement in the workout the targets come from. */
  sessionPain: PainStatus;
  /** See `NextTargetsInput.fitLater` (Start next session from a FitNotes workout). */
  fitLater?: boolean;
  /** See `NextTargetsInput.comparableEquipmentIds` (other items of the same kind and bar mass). */
  comparableEquipmentIds?: ReadonlySet<string>;
  /**
   * (Reps from history, 21 Oct) The exercise is a secondary lift in this workout: a main barbell lift's
   * built-in rule is read as a compound lift's, so its reps follow Ben's last session (a barbell row after
   * the main lift at his usual 12, not 3–6).
   */
  accessory?: boolean;
  /** (Ben, 23 Oct) Ben applied the rule's stall reset on the Summary (`NextTargetsInput.acceptReset`). */
  acceptReset?: boolean;
  /**
   * (SF1–SF3, Ben 8 Nov) Today's context for this exercise (`earlierWorkOf` on the workout it will be done in, or the
   * workout whose order the next one repeats) and the muscles of every exercise. Absent: no like-for-like reading.
   */
  fatigue?: { today: WorkContext | null; musclesOf: MusclesOf };
}

/** The rule and the rule input for a request (the built-in default unless the routine names a rule). */
function baseOf(req: NextTargetRequest): { input: NextTargetsInput; base: ProgressionRule; category: ReturnType<typeof ruleCategory> } {
  const own = ruleCategory(req.exercise, req.equipment?.kind ?? null, req.convention);
  const category = req.accessory === true && own === 'main_barbell' ? 'compound' : own;
  const base = req.rule ?? builtInDefaultRule(req.ownerId, req.unit, req.workingSets, category);
  const flagged = painStatusFor(req.painFlags, req.exerciseId);
  const pain = flagged.active ? flagged : req.sessionPain;
  const input: NextTargetsInput = {
    exerciseName: req.exerciseName,
    measurement: req.measurement,
    history: req.history,
    rule: base,
    equipment: req.equipment,
    unit: req.unit,
    convention: req.convention,
    pain,
    ...(req.fitLater === true ? { fitLater: true } : {}),
    ...(req.comparableEquipmentIds !== undefined ? { comparableEquipmentIds: req.comparableEquipmentIds } : {}),
    ...(req.acceptReset === true ? { acceptReset: true } : {}),
  };
  return { input, base, category };
}

function coreTargets(req: NextTargetRequest, history: readonly HistorySession[], holdLoad: boolean): { result: NextTargets; rule: ProgressionRule } {
  const { input: all, base, category } = baseOf(req);
  const input: NextTargetsInput = { ...all, history, ...(holdLoad ? { holdLoad: true as const } : {}) };
  if (req.measurement !== 'reps' || base.method !== 'double_progression') return { result: calculateNextTargets(input), rule: base };
  // Reps from history (21 Oct): the built-in rule's range follows Ben's last session of this exercise, except
  // on a main barbell lift (its top set / back-offs scheme) or a rule of his own (`fixed`).
  const latest = latestJudgedSession(input);
  const last = latest === null ? null : typicalReps(latest.reps);
  const personal = req.rule === null && category !== 'main_barbell';
  const loadable = (req.equipment?.loadConvention ?? req.convention) !== 'bodyweight';
  const plan = (p: { range: { min: number; max: number }; kind: PersonalRepsKind }) => {
    const moved = p.kind === 'history' || p.kind === 'toward_goal';
    // A loaded lift's cap is never below the range (more reps there means more load); bodyweight keeps room to add reps.
    const cap = loadable ? Math.max(base.ceilingRepCap, p.range.max) : Math.max(base.ceilingRepCap, p.range.max + PERSONAL_REPS.width);
    const rule: ProgressionRule = moved ? { ...base, repRange: p.range, ceilingRepCap: cap, name: personalRuleName(p.range, base.maxRpeToProgress) } : base;
    return { p, rule, result: calculateNextTargets({ ...input, rule }) };
  };
  let planned = plan(personal ? personalRepRange(base.repRange, last, base.ceilingRepCap, loadable) : { range: { ...base.repRange }, kind: 'fixed' as const });
  // Review S1: moving toward the goal cuts reps so the load can rise. When it can't (equipment max, a jump too
  // big, no assistance left), the range stays at his reps as on bodyweight, so he holds there instead of regressing.
  if (planned.p.kind === 'toward_goal' && (planned.result.decision === 'increase_reps' || planned.result.decision === 'ceiling_reached')) {
    planned = plan(personalRepRange(base.repRange, last, base.ceilingRepCap, false));
  }
  const { p, rule, result } = planned;
  const first = result.sets.find((s) => s.setType !== 'warmup');
  const aim = aimReps(result.decision, first?.reps ?? p.range, last, latest === null ? null : { from: latest.load, to: first?.load?.value ?? null, direction: latest.direction }, latest?.effortOk ?? true);
  const reps: RuleReps = { last, goal: { ...base.repRange }, range: p.range, kind: p.kind, aim };
  const fact = ruleRepsFact(reps);
  const explanation = fact === null ? result.explanation : { ...result.explanation, facts: [fact, ...result.explanation.facts] };
  return { result: { ...result, explanation, reps }, rule };
}

/**
 * The next targets for one exercise. With `fatigue` (SF1–SF3, Ben 8 Nov) the reference is like for like: the newest
 * exposure done after a similar amount of same-muscle work (SF2). With none, the newest exposure in another context,
 * and when today has ≥ 2 more earlier sets than it had, SF3's cushion: the same load, 1–2 reps fewer, `est.`, no
 * load step (one achievable step easier only below the range bottom). A pain hold (rule 9, SF9) reads every
 * exposure, as before. Nothing here raises a load.
 */
export function nextTargetsFor(req: NextTargetRequest): { result: NextTargets; rule: ProgressionRule } {
  const plain = () => coreTargets(req, req.history, false);
  const f = req.fatigue;
  if (f === undefined || req.measurement !== 'reps') return plain();
  const { input } = baseOf(req);
  if (input.pain.active) return plain();
  const today = resolveContext(f.today, req.exerciseId, f.musclesOf);
  if (today.p === null) return plain();
  const ctxOf = (h: HistorySession): ResolvedContext => resolveContext(h.context, req.exerciseId, f.musclesOf);
  // Only exposures the rule could judge on today's equipment, unit and convention can be a basis.
  const exposures: ContextExposure[] = [];
  for (const h of req.history) {
    if (h.context === undefined || h.copy === true) continue;
    if (latestJudgedSession({ ...input, history: [h] }) === null) continue;
    exposures.push({ sessionId: h.sessionId, performedAtUtc: h.performedAtUtc, context: ctxOf(h) });
  }
  const pick = pickLikeForLike(today, exposures);
  if (pick.kind === 'all') return plain();
  const only = (ids: ReadonlySet<string>) => req.history.filter((h) => ids.has(h.sessionId) && h.context !== undefined);
  const note = (basis: EarlierWorkNote['basis'], ref: ContextExposure | null): EarlierWorkNote => ({
    todayP: today.p ?? 0,
    muscle: today.muscle,
    reference: ref === null ? null : { sessionId: ref.sessionId, performedAtUtc: ref.performedAtUtc, p: ref.context.p ?? 0, sameMuscleSuperset: ref.context.sameMuscleSuperset },
    basis,
  });
  const exposureOf = (sessionId: string | undefined): ContextExposure | null => exposures.find((e) => e.sessionId === sessionId) ?? null;
  if (pick.kind === 'comparable') {
    const comp = coreTargets(req, only(pick.sessionIds), false);
    const ref = exposureOf(comp.result.basedOnSessionIds[0]);
    const out = { ...comp, result: { ...comp.result, earlierWork: note('comparable', ref) } };
    if (pick.stale === null) return out;
    // SF2 stale: the newer exposure in another context also gives a target; the lower load wins.
    const others = exposures.filter((e) => !pick.sessionIds.has(e.sessionId)).map((e) => e.sessionId);
    const alt = fromOther(req, today, only(new Set(others)), pick.stale, cushionReps(today.p, pick.stale.context.p ?? 0), note);
    return easierFirstLoad(alt.result, out.result) ? { ...alt, result: { ...alt.result, earlierWork: { ...(alt.result.earlierWork as EarlierWorkNote), staleLower: true } } } : out;
  }
  return fromOther(req, today, only(pick.sessionIds), pick.reference, pick.cushion, note);
}

/** Targets read from another context's exposures: SF3's cushion when today has ≥ 2 more earlier sets, else the rule as is. */
function fromOther(
  req: NextTargetRequest,
  today: ResolvedContext,
  history: readonly HistorySession[],
  reference: ContextExposure,
  cushion: 0 | 1 | 2,
  note: (basis: EarlierWorkNote['basis'], ref: ContextExposure | null) => EarlierWorkNote,
): { result: NextTargets; rule: ProgressionRule } {
  if (cushion === 0) {
    const r = coreTargets(req, history, false);
    return { ...r, result: { ...r.result, earlierWork: note('other', reference) } };
  }
  const held = coreTargets(req, history, true);
  const { input } = baseOf(req);
  const ref = latestJudgedSession({ ...input, history });
  const last = ref === null ? null : typicalReps(ref.reps);
  if (held.result.decision !== 'hold' || last === null) return { ...held, result: { ...held.result, earlierWork: note('other', reference) } };
  const rule = held.rule;
  const bottom = rule.method === 'double_progression' ? rule.repRange.min : rule.topSet.repRange.min;
  const aim = last - cushion;
  const stepDown = aim < bottom;
  const planned = Math.max(aim, bottom);
  const eq = req.equipment;
  const convention = eq?.loadConvention ?? req.convention;
  const easier = (l: Load | null): Load | null => {
    if (!stepDown || l === null || l.convention === 'bodyweight' || eq === null) return l;
    const r = stepLoad(l.value, eq, loadDirection(convention) === 'assistance' ? 'increase' : 'decrease');
    return r.ok ? { ...l, value: r.value } : l;
  };
  const sets = held.result.sets.map((s) => (s.setType === 'warmup' ? s : { ...s, load: easier(s.load), reps: s.setType === 'backoff' ? s.reps : { min: planned, max: planned } }));
  const first = sets.find((s) => s.setType !== 'warmup');
  const loadText = first?.load == null || first.load.convention === 'bodyweight' ? 'bodyweight' : formatNumber(ref?.load ?? first.load.value);
  const why = cushionWhy(today, reference.context, loadText, last, planned);
  const reps: RuleReps | undefined = held.result.reps === undefined ? undefined : { ...held.result.reps, aim: planned };
  return {
    rule,
    result: {
      ...held.result,
      sets,
      ...(reps !== undefined ? { reps } : {}),
      explanation: { summary: why, facts: held.result.explanation.facts.filter((x) => !x.startsWith('Reps follow')) },
      earlierWork: { ...note('cushion', reference), cushion: { reps: cushion, stepDown, lastReps: last, aim: planned } },
    },
  };
}

/** Whether `a`'s first working load is easier than `b`'s (both loaded, same unit). */
function easierFirstLoad(a: NextTargets, b: NextTargets): boolean {
  const la = a.sets.find((s) => s.setType !== 'warmup')?.load ?? null;
  const lb = b.sets.find((s) => s.setType !== 'warmup')?.load ?? null;
  if (la === null || lb === null || la.unit !== lb.unit || la.convention === 'bodyweight') return false;
  return compareDifficulty(la.value, lb.value, loadDirection(la.convention)) < 0;
}

const PLANNABLE = new Set<NextTargets['decision']>(['increase_load', 'increase_reps', 'hold', 'hold_after_miss', 'reduce_load', 'ceiling_reached', 'halted_pain']);

/**
 * Planned sets for an exercise being added, from its next targets. Null when
 * the rule has nothing to say (no history, unsupported, no feasible load):
 * the exercise then starts with one empty set, as before.
 *
 * With `why` (the history and equipment the targets were worked out from),
 * each set also records its provenance for `Why?` (active-workout §2.12):
 * the basis workout, the rule's own words and the equipment step, stored
 * now so the card never re-runs the rule to explain it.
 */
export function plannedSetsFromTargets(t: NextTargets, why?: Omit<RuleProvenanceInput, 'result'>): { setType: SetType; planned: PlannedSet }[] | null {
  if (!PLANNABLE.has(t.decision) || t.sets.length === 0 || t.loadFeasibility === 'infeasible') return null;
  return t.sets.map((s) => ({
    setType: s.setType,
    planned: {
      load: s.load,
      reps: s.reps,
      durationS: null,
      rpe: null,
      rir: null,
      source: 'built_in_rule' as const,
      ...(why ? { provenance: ruleTargetProvenance({ ...why, result: t }, s) } : {}),
    },
  }));
}
