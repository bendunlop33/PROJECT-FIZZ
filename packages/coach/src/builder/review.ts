import { infoOrDefault, slotsOf, workingCount, workingRestS, type BuilderContext, type BuilderGroupName, type BuilderSlot, type BuilderWorkout } from '@fizz/domain';
import type { EquipmentInstance, ReviewWorkoutArgs, WeightUnit, LoadConvention } from '@fizz/schemas';
import { checkClaims, claimFacts, workoutClaimCheck, type ClaimBase, type ClaimExtra } from './claims';
import { CORE_FOCI, focusSets } from './focus';
import { builderLoadText, type BuilderCoachEnv, type BuilderCoachSnapshot, type EditOutcome } from './edit-ops';
import { topLoad } from './load-guard';
import { makeBuilderProposal, type BuilderProposal } from './proposal';
import type { ReviewEdit } from './review-context';

/**
 * Coach review (workout-builder-v3 §2.9; Ben, 20 Oct: "the coach writes the
 * verdict, suggestions and notes; code works out and checks every fact").
 * Pure. `reviewFacts` recounts everything from the workout and the plan
 * day; `checkReview` turns the coach's `review_workout` call into what the
 * sheet may show: its verdict and reasons only when every number in them is
 * one of code's, its suggestions as proposals with code-made lines, and its
 * notes as code-worded lines (a target note's load checked and rounded down).
 */

/** The plan day the workout came from (template), as the review compares it (§2.9 Plan section). */
export interface ReviewPlanDay {
  /** `4-day split`. */
  planName: string;
  /** `13 Oct` (code-formatted by the caller from the plan's start). */
  since: string;
  /** This workout's day. */
  dayName: string;
  /** The plan's next day and its place (`Chest`, 1 of 4). */
  nextDayName: string;
  nextDayNumber: number;
  dayCount: number;
  /** The template's own length (`plan 60`). */
  minutes: number;
  mainLiftExerciseId: string | null;
  exercises: readonly { exerciseId: string; workingSets: number }[];
}

export type ReviewPlanLineKey = 'is_next' | 'minutes' | 'main_lift' | 'planned_exercises' | 'working_sets';

export interface ReviewPlanLine {
  key: ReviewPlanLineKey;
  ok: boolean;
  /** `Chest is next (day 1 of 4)`, `5 of 6 planned · missing Cable crunch`. */
  text: string;
  actual: number | null;
  planned: number | null;
  exerciseIds: string[];
}

export interface BuilderReviewFacts {
  /** `✓ Upper chest 6`, `· Abs` (sets 0). */
  coverage: { focus: string; sets: number }[];
  /** `2 compound · 4 isolation · free weights and machines`. */
  variety: string;
  compound: number;
  isolation: number;
  workingSets: number;
  /** Working sets per group, direct (the exercise's own group; Legs by part), for the stored record. */
  groupSets: { group: BuilderGroupName; part: string | null; sets: number }[];
  plan: { title: string; lines: ReviewPlanLine[]; missing: string[]; added: string[]; /** Planned exercises whose working sets differ from the plan's. */ setsDiffer: string[]; differs: boolean } | null;
  /** Code's own suggestions: `Add back <name>` (max 2), each a proposal. */
  addBack: { exerciseId: string; name: string; workingSets: number }[];
}

export interface ReviewFactsInput {
  snapshot: BuilderCoachSnapshot;
  ctx: BuilderContext;
  /** The day's groups in Set up order (coverage); empty: the workout's own groups. */
  groups: readonly BuilderGroupName[];
  plan: ReviewPlanDay | null;
  /** The item the exercise is done on here (`SlotLoadInput.equipment`), for the variety line. */
  equipmentOf?: (exerciseId: string) => EquipmentInstance | null;
}

const MACHINE_KINDS: ReadonlySet<EquipmentInstance['kind']> = new Set(['weight_stack', 'plate_loaded_machine', 'assisted_stack']);

/** `reviewFacts`: every count the review shows, recounted from the workout (never the model's). */
export function reviewFacts(input: ReviewFactsInput): BuilderReviewFacts {
  const { ctx, snapshot } = input;
  const slots = slotsOf(snapshot.workout.blocks);
  const info = (s: BuilderSlot) => infoOrDefault(ctx.info, s.exerciseId);
  const groups = input.groups.length > 0 ? [...input.groups] : [...new Set(slots.map((s) => info(s).group))];
  const raw = focusSets(slots, ctx);
  // (D5) Arms is biceps + triceps: a day that trains one of them (a chest day's pushdown) isn't short of the other.
  const armsDone = CORE_FOCI.Arms.filter((f) => (raw.get(f) ?? 0) > 0);
  const foci = [...new Set(groups.flatMap((g) => (g === 'Arms' && armsDone.length > 0 ? armsDone : CORE_FOCI[g])))];
  const coverage = foci.map((focus) => ({ focus, sets: raw.get(focus) ?? 0 }));

  const compound = slots.filter((s) => info(s).role === 'compound').length;
  const isolation = slots.length - compound;
  const machines = slots.filter((s) => {
    const e = input.equipmentOf?.(s.exerciseId) ?? ctx.loads(s.exerciseId).equipment;
    return e !== null && MACHINE_KINDS.has(e.kind);
  }).length;
  const kit = slots.length === 0 ? '' : machines === 0 ? 'all free weights' : machines === slots.length ? 'all machines and cables' : 'free weights and machines';
  const variety = [`${String(compound)} compound`, `${String(isolation)} isolation`, ...(kit === '' ? [] : [kit])].join(' · ');
  const workingSets = slots.reduce((m, s) => m + workingCount(s), 0);

  const bySet = new Map<string, { group: BuilderGroupName; part: string | null; sets: number }>();
  for (const s of slots) {
    const i = info(s);
    const part = i.group === 'Legs' || i.group === 'Arms' ? i.part : null;
    const k = `${i.group}|${part ?? ''}`;
    const cur = bySet.get(k) ?? { group: i.group, part, sets: 0 };
    cur.sets += workingCount(s);
    bySet.set(k, cur);
  }

  let plan: BuilderReviewFacts['plan'] = null;
  const addBack: BuilderReviewFacts['addBack'] = [];
  if (input.plan !== null) {
    const p = input.plan;
    const name = (id: string) => infoOrDefault(ctx.info, id).name;
    const have = new Set(slots.map((s) => s.exerciseId));
    const plannedIds = p.exercises.map((e) => e.exerciseId);
    const missing = plannedIds.filter((id) => !have.has(id));
    const added = slots.map((s) => s.exerciseId).filter((id) => !plannedIds.includes(id));
    const kept = plannedIds.length - missing.length;
    const mainNow = slots.find((s) => s.main)?.exerciseId ?? null;
    const plannedSets = p.exercises.reduce((m, e) => m + e.workingSets, 0);
    const lines: ReviewPlanLine[] = [
      {
        key: 'is_next',
        ok: p.dayName === p.nextDayName,
        text: `${p.nextDayName} is next (day ${String(p.nextDayNumber)} of ${String(p.dayCount)})`,
        actual: null,
        planned: p.nextDayNumber,
        exerciseIds: [],
      },
      { key: 'minutes', ok: Math.abs(snapshot.minutes - p.minutes) <= 5, text: `${String(snapshot.minutes)} min (plan ${String(p.minutes)})`, actual: snapshot.minutes, planned: p.minutes, exerciseIds: [] },
      {
        key: 'main_lift',
        ok: mainNow === p.mainLiftExerciseId,
        text:
          mainNow === p.mainLiftExerciseId
            ? mainNow === null
              ? 'No main lift'
              : `Main lift ${name(mainNow)}`
            : `${mainNow === null ? 'No main lift' : `Main lift ${name(mainNow)}`} (plan ${p.mainLiftExerciseId === null ? 'none' : name(p.mainLiftExerciseId)})`,
        actual: null,
        planned: null,
        exerciseIds: [mainNow, p.mainLiftExerciseId].filter((x): x is string => x !== null),
      },
      {
        key: 'planned_exercises',
        ok: missing.length === 0 && added.length === 0,
        text:
          missing.length === 0 && added.length === 0
            ? `All ${String(plannedIds.length)} planned`
            : [`${String(kept)} of ${String(plannedIds.length)} planned`, ...(missing.length > 0 ? [`missing ${missing.map(name).join(', ')}`] : []), ...(added.length > 0 ? [`added ${added.map(name).join(', ')}`] : [])].join(' · '),
        actual: kept,
        planned: plannedIds.length,
        exerciseIds: [...missing, ...added],
      },
      { key: 'working_sets', ok: Math.abs(workingSets - plannedSets) <= 2, text: `${String(workingSets)} working sets (plan ${String(plannedSets)})`, actual: workingSets, planned: plannedSets, exerciseIds: [] },
    ];
    // `Update plan day` (§2.8): the exercises, the main lift or a planned exercise's working sets differ; loads never (§9 Q11).
    const setsDiffer = p.exercises.filter((e) => {
      const s = slots.find((x) => x.exerciseId === e.exerciseId);
      return s !== undefined && workingCount(s) !== e.workingSets;
    }).map((e) => e.exerciseId);
    plan = { title: `${p.planName} · since ${p.since}`, lines, missing, added, setsDiffer, differs: missing.length > 0 || added.length > 0 || setsDiffer.length > 0 || mainNow !== p.mainLiftExerciseId };
    for (const id of missing.slice(0, 2)) addBack.push({ exerciseId: id, name: name(id), workingSets: p.exercises.find((e) => e.exerciseId === id)?.workingSets ?? 3 });
  }

  return { coverage, variety, compound, isolation, workingSets, groupSets: [...bySet.values()], plan, addBack };
}

/** Code's fact lines as text: what the coach is given, and the numbers its words are checked against. */
export function reviewFactLines(f: BuilderReviewFacts): string[] {
  return [
    ...f.coverage.map((c) => (c.sets > 0 ? `✓ ${c.focus} ${String(c.sets)}` : `· ${c.focus}`)),
    f.variety,
    `${String(f.workingSets)} working sets`,
    ...(f.plan === null ? [] : [f.plan.title, ...f.plan.lines.map((l) => `${l.ok ? '✓' : '!'} ${l.text}`)]),
  ];
}

// ---------------------------------------------------------------------------
// The coach's part, checked

export interface ReviewSuggestion {
  /** Stable within the review: `<reviewId>:s<i>`. */
  id: string;
  /** `Swap`, `Add`, `Delete`, `Superset`, `Unlink`, `Move`, `Apply`. */
  action: string;
  proposal: BuilderProposal;
}

export type ReviewNote =
  | { id: string; kind: 'text'; text: string }
  | { id: string; kind: 'target'; exerciseId: string; text: string; value: number; unit: WeightUnit; convention: LoadConvention; reps: number | null };

/**
 * (Ben, 23 Oct) The coach's comment on one of Ben's own edits: code's edit line, the coach's words after the number
 * check, and its offer (a proposal, Apply / Skip, version-fenced, Undo after), if any.
 */
export interface ReviewEditNote {
  /** `<reviewId>:c<i>`; the offer's proposal has the same ID. */
  id: string;
  editId: string;
  /** Code's line for the edit (`Barbell bench press top 100 → 110 kg`). */
  edit: string;
  comment: string | null;
  offer: ReviewSuggestion | null;
}

export interface CheckedReview {
  verdict: string | null;
  /** (Ben, 23 Oct) Comments on his own edits, in the order of the edits. */
  edits: ReviewEditNote[];
  suggestions: ReviewSuggestion[];
  notes: ReviewNote[];
  /** Sentences hidden for a number not in the facts (`Why?` → `Not shown`). */
  hidden: string[];
  /** Whether everything shown passed the number check (always true: what failed is hidden). */
  numbersChecked: true;
  /**
   * (Ben, 23 Oct) Suggestions code left out because they would put a near-duplicate in the workout
   * (`Dumbbell shrug: like Barbell shrug`), for `Why?`.
   */
  leftOut: string[];
}

const ACTION: Readonly<Record<string, string>> = { swap: 'Swap', add: 'Add', remove: 'Delete', superset: 'Superset', unlink: 'Unlink', move: 'Move' };

/** The claim check's base for a review: code's facts and the plan's totals, never IDs or memories (B2). `extra`: the review context's per-exercise facts (Ben, 23 Oct). */
export function reviewClaimBase(f: BuilderReviewFacts, input: { ctx: BuilderContext; minutes: readonly number[]; plan: ReviewPlanDay | null; words?: string; extra?: readonly ClaimExtra[] }): ClaimBase {
  const p = input.plan;
  const kept = f.plan?.lines.find((l) => l.key === 'planned_exercises');
  return {
    ctx: input.ctx,
    minutes: input.minutes,
    plan:
      p === null
        ? null
        : {
            minutes: p.minutes,
            workingSets: p.exercises.reduce((m, e) => m + e.workingSets, 0),
            exercises: p.exercises.length,
            pairs: [[p.nextDayNumber, p.dayCount], ...(kept?.actual != null && kept.planned != null ? [[kept.actual, kept.planned] as [number, number]] : [])],
          },
    ...(input.words === undefined ? {} : { words: input.words }),
    ...(input.extra === undefined ? {} : { extra: input.extra }),
  };
}

const sign = (v: number): number => (Math.abs(v) < 1e-6 ? 0 : v > 0 ? 1 : -1);

/**
 * Whether a change takes one of Ben's own edits back (in part or whole): his raised load, sets, reps, RPE or rest
 * lowered again (or his lowered one raised), his added exercise removed, his removed one added back, his swap swapped
 * back, his length moved back. Code's check behind "never just undo his edit without a reason" (Ben, 23 Oct).
 */
export function revertsEdit(e: ReviewEdit, snapshot: BuilderCoachSnapshot, outcome: EditOutcome, env: BuilderCoachEnv): boolean {
  if (e.cause !== 'ben') return false;
  const before = slotsOf(snapshot.workout.blocks);
  const after = slotsOf(outcome.workout.blocks);
  const was = before.find((x) => x.key === e.slotKey);
  const now = after.find((x) => x.key === e.slotKey);
  const has = (id: string | null) => id !== null && after.some((x) => x.exerciseId === id);
  const against = (a: number | null, b: number | null): boolean => e.before !== null && e.after !== null && a !== null && b !== null && sign(b - a) !== 0 && sign(b - a) === -sign(e.after - e.before);
  const rpeOf = (x: BuilderSlot | undefined) => x?.rows.find((r) => r.type === 'top')?.rpe ?? x?.rows.find((r) => r.type !== 'warmup')?.rpe ?? null;
  const repsOf = (x: BuilderSlot | undefined) => x?.rows.find((r) => r.type === 'top')?.reps ?? x?.rows.find((r) => r.type !== 'warmup')?.reps ?? null;
  const restOf = (x: BuilderSlot | undefined, w: BuilderWorkout) => (x === undefined ? null : workingRestS(x, env.ctx.info, w.restLevel, env.ctx.restDefaultsS));
  switch (e.kind) {
    case 'minutes':
      return against(snapshot.minutes, outcome.minutes);
    case 'added':
      return was !== undefined && now === undefined;
    case 'removed':
      return has(e.fromExerciseId);
    case 'swapped':
      return now?.exerciseId !== e.exerciseId && has(e.fromExerciseId);
    case 'sets':
      return was !== undefined && now !== undefined && against(workingCount(was), workingCount(now));
    case 'load':
      return was !== undefined && now !== undefined && against(topLoad(was), topLoad(now));
    case 'reps':
      return against(repsOf(was), repsOf(now));
    case 'rpe':
      return against(rpeOf(was), rpeOf(now));
    case 'rest':
      return against(restOf(was, snapshot.workout), restOf(now, outcome.workout));
  }
}

/** A reason grounded in code's facts: words that passed the number check with a number in them, or the pain flag. */
const grounded = (shown: string | null): boolean => shown !== null && (/\d/.test(shown) || /\b(?:pain|flag(?:ged)?|hurt)/i.test(shown));

/**
 * `checkReview`: what of the coach's review may show. Every number is checked against the fact it names.
 * (Ben, 23 Oct) `edits`: Ben's own edits (`reviewEdits`); the coach's comments name them by ID. An offer that takes
 * one of his edits back shows only with a reason grounded in code's facts (a checked number, or the pain flag);
 * otherwise the offer is dropped and the comment stays. Pain-flagged lifts are never made heavier or harder (the
 * edit ops' guard), and every load is rounded down to what this gym can load and capped (rule 4).
 */
export function checkReview(input: { reviewId: string; args: ReviewWorkoutArgs; snapshot: BuilderCoachSnapshot; env: BuilderCoachEnv; claims: ClaimBase; edits?: readonly ReviewEdit[] | null }): CheckedReview {
  const hidden: string[] = [];
  const check = workoutClaimCheck(input.snapshot.workout, input.claims);
  const verdict = check(input.args.verdict, null);
  hidden.push(...verdict.hidden);
  const edits = input.edits ?? [];
  const leftOut: string[] = [];
  const seen = new Set<string>();
  /** The proposal for `ops`, or null when it changes nothing, repeats one shown, or undoes his edit with no grounded reason. */
  const offer = (id: string, ops: ReviewWorkoutArgs['suggestions'][number]['ops'], words: string): { suggestion: ReviewSuggestion | null; shown: string | null } => {
    const r = makeBuilderProposal({ id, snapshot: input.snapshot, ops, words, check, env: input.env });
    hidden.push(...r.hidden);
    if (r.proposal === null) return { suggestion: null, shown: r.reason };
    // (Ben, 23 Oct) Never suggest two near-duplicates in one workout (a second shrug, the dumbbell twin of a curl):
    // left out with its words, for `Why?`.
    if (r.outcome.nearDuplicates.length > 0) {
      for (const [had, added] of r.outcome.nearDuplicates) leftOut.push(`${added}: like ${had}`);
      return { suggestion: null, shown: null };
    }
    if (edits.some((e) => revertsEdit(e, input.snapshot, r.outcome, input.env)) && !grounded(r.reason)) return { suggestion: null, shown: r.reason };
    const key = r.proposal.lines.join('\n');
    if (seen.has(key)) return { suggestion: null, shown: r.reason };
    seen.add(key);
    const first = ops[0]?.op ?? '';
    return { suggestion: { id: r.proposal.id, action: ops.length === 1 ? (ACTION[first] ?? 'Apply') : 'Apply', proposal: r.proposal }, shown: r.reason };
  };

  const editNotes: ReviewEditNote[] = [];
  const commented = new Set<string>();
  input.args.editComments.forEach((c, i) => {
    const e = edits.find((x) => x.id === c.editId);
    if (e === undefined || commented.has(e.id)) return;
    commented.add(e.id);
    const id = `${input.reviewId}:c${String(i)}`;
    if (c.ops.length > 0) {
      const o = offer(id, c.ops, c.comment);
      if (o.shown === null && o.suggestion === null) return;
      editNotes.push({ id, editId: e.id, edit: e.text, comment: o.shown, offer: o.suggestion });
      return;
    }
    const words = check(c.comment, null);
    hidden.push(...words.hidden);
    if (words.shown === null) return;
    editNotes.push({ id, editId: e.id, edit: e.text, comment: words.shown, offer: null });
  });
  // In the order of his edits.
  editNotes.sort((a, b) => edits.findIndex((x) => x.id === a.editId) - edits.findIndex((x) => x.id === b.editId));

  const suggestions: ReviewSuggestion[] = [];
  input.args.suggestions.forEach((s, i) => {
    const o = offer(`${input.reviewId}:s${String(i)}`, s.ops, s.reason);
    if (o.suggestion !== null) suggestions.push(o.suggestion);
  });

  const notes: ReviewNote[] = [];
  const slots = slotsOf(input.snapshot.workout.blocks);
  input.args.nextNotes.forEach((n, i) => {
    const id = `${input.reviewId}:n${String(i)}`;
    if (n.target !== null) {
      const t = n.target;
      const slot = slots.find((s) => s.exerciseId === t.exerciseId || s.key === t.exerciseId);
      if (slot === undefined) return;
      const value = t.unit === slot.unit ? t.value : t.unit === 'kg' ? t.value * 2.20462 : t.value / 2.20462;
      const g = input.env.loads.check(slot, value, { askedHeavier: false });
      if (!g.ok) return;
      const name = infoOrDefault(input.env.ctx.info, slot.exerciseId).name;
      const top = slot.main ? 'top set' : 'working sets';
      notes.push({ id, kind: 'target', exerciseId: slot.exerciseId, text: `${name} ${top}: ${builderLoadText(g.value, slot.unit, slot.convention)} next`, value: g.value, unit: slot.unit, convention: slot.convention, reps: t.reps });
      return;
    }
    const c = checkClaims(n.text, claimFacts([input.snapshot.workout], input.claims));
    hidden.push(...c.hidden);
    if (c.shown === null || c.hidden.length > 0) return;
    notes.push({ id, kind: 'text', text: c.shown });
  });

  return { verdict: verdict.shown, edits: editNotes, suggestions, notes, hidden, numbersChecked: true, leftOut: [...new Set(leftOut)] };
}
