import {
  PB_CHECK_LIFTS,
  PB_CORE,
  PB_EX,
  PB_EXTRA_LIFTS,
  PB_MAIN_A,
  PB_MAIN_ALT,
  PB_MAIN_B,
  PB_PREF_QUESTIONS,
  PB_SIMILAR,
  addPlanVersion,
  applyPlanEdit,
  pbEditPreview,
  PB_EDIT_COPY,
  pbScopeHas,
  pbWeekDaysOf,
  undoPlanEdit,
  type PbBlockView,
  type PbBlockWeek,
  type PbEditBlock,
  type PbEditScope,
  buildPlanFromAnswers,
  catalogueExerciseId,
  currentPlanVersion,
  deriveId,
  doableHere,
  equipmentHere,
  painFlagCovering,
  pbDefaultAnswers,
  pbAppliedBuilder,
  pbStartingAnswers,
  pbExpect,
  pbPrefSuggestion,
  pbHistoryOf,
  pbKitOfEquipment,
  pbLiftStart,
  pbNeedsLiftCheck,
  pbNewPlanDraft,
  pbPlanIdFor,
  pbPlanVersion,
  pbStartReps,
  pbSameDays,
  planIsOpen,
  stableStringify,
  toMs,
  type PbHistory,
  type PbLiftStart,
  type PbPlan,
  type PlanKit,
} from '@fizz/domain';
import type { Store } from '@fizz/persistence';
import type { EquipmentInstance, Exercise, PainFlag, PlanBuilderAnswers, PlanDayDraft, PlanDraft, UserProfile, WeightUnit, ZonedTimestamp } from '@fizz/schemas';

import { PLAN_COPY, type PlanServices, type PlanWriteOutcome } from './plan-services';
import { editBlockOf, readPlanBlock, slotKits, weekViews } from './plan-edit-read';

/**
 * The plan builder (plan-builder.md; prototype `plan-builder.html`; D7). Offline and deterministic: the engine in
 * `@fizz/domain` builds the plan from Ben's answers, his own records and the selected gym's items; nothing here calls
 * the coach or the network. Build writes an open plan (idempotent on its op ID; a rebuild is a new version, rule 5),
 * so a built plan survives a force-close until it is applied or expires; Apply, Undo, End and Pause are the plan
 * model's own (`plans`), so Today, Library › Your plan and the lean card read it like any plan. Your data only (rule
 * 10): his history, gyms, pain flags and the plan; the catalogue is read for names.
 */

export interface PlanBuilderDeps {
  store: () => Store;
  profile: () => Promise<UserProfile | null>;
  now: () => ZonedTimestamp;
  catalogueExercises: () => readonly Exercise[];
  currentGym: () => Promise<{ id: string; name: string } | null>;
  plans: Pick<PlanServices, 'apply' | 'undo'>;
}

let engineKeyList: string[] | null = null;
/** Every exercise the engine may name: its tables' keys (static tables: worked out once). */
function engineKeys(): string[] {
  engineKeyList ??= allEngineKeys();
  return engineKeyList;
}

function allEngineKeys(): string[] {
  const keys = new Set<string>([
    ...Object.values(PB_EX).flatMap((l) => l.map((x) => x.key)),
    ...Object.values(PB_MAIN_A).flatMap((m) => (m === null ? [] : [m.key])),
    ...Object.values(PB_MAIN_B).map((m) => m.key),
    ...Object.entries(PB_MAIN_ALT).flatMap(([k, l]) => [k, ...l]),
    ...Object.entries(PB_SIMILAR).flatMap(([k, l]) => [k, ...l.map((x) => x.from)]),
    ...PB_PREF_QUESTIONS.flatMap((q) => [...q.opts.flat(), ...q.other]),
    ...Object.values(PB_CORE),
    ...PB_CHECK_LIFTS,
    ...PB_EXTRA_LIFTS,
  ]);
  return [...keys].sort();
}

/** What the builder read once: kits at the gym, his history, pain holds. Synchronous after `open`. */
export interface PlanBuilderSession {
  /**
   * The answers to start from. A new plan (Ben, 23 Oct): his last builder plan's as starting selections (or the
   * finished block's for `Start next block`), else the ✦ answers. `editPlanId`: that plan's.
   */
  answers: PlanBuilderAnswers;
  /** The open builder plan being edited (`editPlanId` only); a new plan has none until Build. */
  draft: { planId: string; version: number; versionN: number } | null;
  /**
   * (Ben, 23 Oct) A built plan left unapplied, offered quietly on the first page (`Continue last draft`), never the
   * landing page. Null: none, or editing.
   */
  lastDraft: { planId: string; version: number; versionN: number; answers: PlanBuilderAnswers } | null;
  /** Where the page opens: `start` (Check your lifts when needed, else Gym goals) for every new plan; `plan` only for `Edit plan`. */
  opensOn: 'start' | 'plan';
  gym: { id: string; name: string } | null;
  /** (Ben, 26 Oct) Ben's own weight unit: tables name it in their header (kg/lb always explicit). */
  unit: WeightUnit;
  profileSplit: 'ppl' | 'body' | null;
  nowMs: number;
  tz: string;
  nameOf: (key: string) => string;
  kitOf: (key: string) => PlanKit | 'bodyweight' | null;
  historyOf: (key: string) => PbHistory | null;
  painHeld: ReadonlySet<string>;
  /** Check your lifts: the four main lifts and his extras that are loadable here. */
  lifts: (answers: PlanBuilderAnswers) => PbLiftStart[];
  needsCheck: boolean;
  build: (answers: PlanBuilderAnswers) => PbPlan;
  /** What to expect in N weeks (est.): each checked lift's weight at the focus's reps, now and at the end. */
  expect: (answers: PlanBuilderAnswers) => ReturnType<typeof pbExpect>;
  /** ✦ on a preference question: the option his history favours, else null. */
  prefSuggestion: (questionId: string) => 0 | 1 | null;
  equipmentVersion: string;
  /**
   * (Ben, 26 Oct) `Edit plan` on the plan in use: nothing is written until `Apply changes`; every change to the answers
   * (Goals, Week, Any preferences, abs) is shown as the Changes card against the plan as it is. Null: a new plan, or
   * an open one (Build writes its versions).
   */
  running: PlanEditSession | null;
}

/** The plan in use being edited: where its block is, and the preview of any answers. */
export interface PlanEditSession {
  planId: string;
  /** The plan's version as read: Apply changes writes against it (rule 5). */
  planVersion: number;
  /** The block week now (1-based) and the plan's length now. */
  week: number;
  weeksNow: number;
  preview: (answers: PlanBuilderAnswers, rejected: ReadonlySet<string>, scope: PbEditScope) => PlanEditView;
}

/** The Changes card and the week strip for an edit. */
export interface PlanEditView {
  items: { id: string; text: string; accepted: boolean }[];
  accepted: number;
  /** `2 of 5`. */
  counted: string;
  /** Every week as it will be (1…the new length); done weeks read-only. */
  views: PbBlockView[];
  /** Weeks the accepted changes reach. */
  changed: number[];
  /** The new length is shorter than the week the plan is in. */
  tooShort: boolean;
  /** Anything to apply (an accepted change, or new answers). */
  canApply: boolean;
}

export type PlanEditOutcome = { ok: true; planId: string; version: number } | { ok: false; reason: 'stale' | 'nothing' | 'too_short' | 'changed_since' | 'missing' | 'failed'; message: string };

export type PlanBuildOutcome = { ok: true; planId: string; version: number; versionN: number } | { ok: false; reason: 'stale' | 'empty' | 'missing' | 'failed' };

type EditWrite = Awaited<ReturnType<Store['repos']['planDrafts']['edit']>>;

function editOutcome(r: EditWrite | null): PlanEditOutcome {
  if (r === null) return { ok: false, reason: 'failed', message: PLAN_COPY.failed };
  switch (r.status) {
    case 'written':
    case 'replayed':
      return { ok: true, planId: r.plan.id, version: r.plan.version };
    case 'nothing':
      return { ok: false, reason: 'nothing', message: PLAN_COPY.stale };
    case 'changed_since':
      return { ok: false, reason: 'changed_since', message: PLAN_COPY.changedSince(r.names) };
    case 'missing':
      return { ok: false, reason: 'missing', message: PLAN_COPY.missing };
    case 'invalid':
    case 'stale':
    case 'closed':
      return { ok: false, reason: 'stale', message: PLAN_COPY.stale };
  }
}

export function createPlanBuilderService(deps: PlanBuilderDeps) {
  const repo = () => deps.store().repos.planDrafts;

  /** The newest open plan made by the builder, else null. */
  async function openDraft(ownerId: string, nowUtc: string): Promise<PlanDraft | null> {
    const all = await repo().listByOwner(ownerId);
    const open = all.filter((p) => planIsOpen(p, nowUtc) && currentPlanVersion(p).builder !== undefined);
    return open.sort((a, b) => toMs(b.updatedAtUtc) - toMs(a.updatedAtUtc))[0] ?? null;
  }

  /**
   * `Set up a plan` (Ben, 23 Oct): always a new plan from the first step, his last builder plan's answers as the
   * starting selections. `fromPlanId` (plan length = block 1): `Start next block ›` on a finished block starts from
   * that plan's answers (a fresh build from his records now; nothing is written until `Build plan`). `editPlanId`:
   * `Edit plan` on that plan (its answers; an open builder plan is edited in place, new versions on Build).
   */
  async function open(opts: { fromPlanId?: string; editPlanId?: string } = {}): Promise<PlanBuilderSession | null> {
    const p = await deps.profile();
    if (p === null) return null;
    const store = deps.store();
    const at = deps.now();
    const nowMs = toMs(at.utc);
    const gym = await deps.currentGym();
    const equipment: EquipmentInstance[] = gym === null ? [] : await store.repos.equipment.listByGym(gym.id);
    const snapGym = { id: gym?.id ?? 'no-gym', name: gym?.name ?? 'this gym', equipment };
    const training = await store.repos.trainingProfiles.get(p.id);
    // Profile › Split as Ben chose it (not the default when he hasn't): ✦ on Your week when it fits; Custom keeps the default.
    const chosen = training?.split?.kind ?? null;
    const profileSplit = chosen === 'ppl' ? 'ppl' : chosen === 'clsb' ? 'body' : null;
    const flags: readonly PainFlag[] = await store.repos.painFlags.listActive(p.id);

    const byId = new Map<string, Exercise>();
    for (const e of deps.catalogueExercises()) byId.set(e.id, e);
    for (const e of await store.repos.exercises.list()) if (e.archivedAtUtc === undefined) byId.set(e.id, e);

    const kits = new Map<string, PlanKit | 'bodyweight' | null>();
    const hist = new Map<string, PbHistory | null>();
    const painHeld = new Set<string>();
    const names = new Map<string, string>();
    const keys = engineKeys();
    // (Perf, 23 Oct: Set up a plan took ~20 s) Every engine lift's history in one read, each workout decoded once
    // (and reused from the store's cache), instead of a full-history read per lift.
    const histories = await store.listExerciseHistories(
      p.id,
      keys.flatMap((k) => (byId.has(catalogueExerciseId(k)) ? [catalogueExerciseId(k)] : [])),
    );
    for (const key of keys) {
      const e = byId.get(catalogueExerciseId(key));
      if (e === undefined) {
        kits.set(key, null);
        continue;
      }
      names.set(key, e.name);
      let kit: PlanKit | 'bodyweight' | null = null;
      if (e.measurement === 'reps' && gym !== null && doableHere(e, snapGym)) {
        if (e.defaultLoadConvention === 'bodyweight') kit = 'bodyweight';
        else {
          const eq = equipmentHere(e, { gym: snapGym }).equipment;
          kit = eq === null ? null : pbKitOfEquipment(eq);
        }
      }
      kits.set(key, kit);
      if (painFlagCovering(flags, e.id, nowMs, at.tz) !== null) painHeld.add(key);
      const sessions = histories.get(e.id) ?? [];
      hist.set(key, pbHistoryOf(sessions, kit === null || kit === 'bodyweight' ? null : kit.convention, nowMs));
    }
    const kitOf = (k: string): PlanKit | 'bodyweight' | null => kits.get(k) ?? null;
    const historyOf = (k: string): PbHistory | null => hist.get(k) ?? null;
    const nameOf = (k: string): string => names.get(k) ?? k;
    // (WU1–WU12) The catalogue facts Start's warm-up planner reads, so the plan's main-lift warm-ups match the workout's.
    const factsOf = (k: string): Exercise | null => byId.get(catalogueExerciseId(k)) ?? null;

    const fromId = opts.editPlanId ?? opts.fromPlanId;
    const from = fromId === undefined ? null : await repo().get(fromId).catch(() => null);
    const owned = from === null || from.ownerId !== p.id ? null : from;
    const fromAnswers = owned === null ? null : (pbAppliedBuilder(owned)?.builder.answers ?? currentPlanVersion(owned).builder?.answers ?? null);
    const editing = opts.editPlanId !== undefined && fromAnswers !== null;
    // (Ben, 26 Oct) `Edit plan` on the plan in use while its block runs: the Changes card, nothing written until Apply.
    const inUse = editing && owned !== null && owned.status === 'applied' ? owned : null;
    const block: PbBlockWeek | null = inUse === null ? null : await readPlanBlock(store, p.id, inUse, nowMs, at.tz);
    const eb: PbEditBlock | null = editBlockOf(block);
    const keepDays = inUse === null || eb === null ? null : pbWeekDaysOf(inUse, eb.week);
    const keep = keepDays === null ? undefined : (i: number): readonly string[] => keepDays.find((d) => d.index === i)?.plan.slots.map((x) => x.catalogueId) ?? [];
    const slotKitOf = inUse === null ? null : await slotKits(store, p.id);
    const exerciseName = (id: string): string => byId.get(id)?.name ?? 'Exercise';
    // Editing an open builder plan writes new versions of it; anything else is a new plan until Build.
    const draft = editing && owned !== null && planIsOpen(owned, at.utc) ? owned : null;
    const v = draft === null ? null : currentPlanVersion(draft);
    const leftover = editing ? null : await openDraft(p.id, at.utc);
    const leftoverV = leftover === null ? null : currentPlanVersion(leftover);
    const starting = fromAnswers ?? pbStartingAnswers(await repo().listByOwner(p.id).catch(() => []));
    const answers = starting ?? pbDefaultAnswers({ sessions: training?.daysPerWeek ?? null, minutes: training?.sessionMinutes ?? null });
    const lifts = (a: PlanBuilderAnswers): PbLiftStart[] =>
      [...PB_CHECK_LIFTS, ...a.extraLifts.filter((k) => !(PB_CHECK_LIFTS as readonly string[]).includes(k))].flatMap((k) => {
        const s = pbLiftStart(k, kitOf, historyOf, a.lifts[k], nowMs);
        return s === null ? [] : [s];
      });
    return {
      answers,
      draft: draft === null || v === null ? null : { planId: draft.id, version: draft.version, versionN: v.n },
      opensOn: editing ? 'plan' : 'start',
      lastDraft: leftover === null || leftoverV?.builder === undefined ? null : { planId: leftover.id, version: leftover.version, versionN: leftoverV.n, answers: leftoverV.builder.answers },
      gym,
      unit: p.preferredUnit,
      profileSplit,
      nowMs,
      tz: at.tz,
      nameOf,
      kitOf,
      historyOf,
      painHeld,
      lifts,
      needsCheck: pbNeedsLiftCheck(lifts(answers)),
      build: (a) => buildPlanFromAnswers({ answers: a, profileSplit, kitOf, historyOf, factsOf, painHeld, nowMs, keep }),
      expect: (a) =>
        pbExpect(
          a,
          lifts(a).flatMap((l) => {
            const kit = kitOf(l.key);
            return kit === null || kit === 'bodyweight' ? [] : [{ start: l, kit }];
          }),
        ),
      prefSuggestion: (q) => pbPrefSuggestion(q, historyOf),
      equipmentVersion: deriveId(`gym-items:${stableStringify(equipment.map((x) => [x.id, x.version]))}`),
      running:
        inUse === null || eb === null || block === null || slotKitOf === null || fromAnswers === null
          ? null
          : {
              planId: inUse.id,
              planVersion: inUse.version,
              week: eb.week,
              weeksNow: fromAnswers.weeks,
              preview: (a, rejected, scope) => {
                const next = editNext(inUse.id, a);
                const pv = pbEditPreview({ plan: inUse, weeksNow: fromAnswers.weeks, weeks: a.weeks, next: next.days, block: eb, rejected, scope, nameOf: exerciseName });
                const views = weekViews({ plan: inUse, answers: a, block, weekDays: pv.weekDays, kitOf: slotKitOf, nameOf: exerciseName, startReps: next.startReps });
                const answersChanged = stableStringify(a) !== stableStringify(fromAnswers);
                return {
                  items: pv.items.map((it) => ({ id: it.id, text: it.text, accepted: !rejected.has(it.id) })),
                  accepted: pv.accepted,
                  counted: `${String(pv.accepted)} of ${String(pv.items.length)}`,
                  views,
                  changed: pv.changed,
                  tooShort: pv.tooShort,
                  canApply: !pv.tooShort && (pv.changed.length > 0 || answersChanged) && pv.weekDays.slice(eb.week - 1).some((_, k) => pbScopeHas(scope, eb.week + k)),
                };
              },
            },
    };

    /** The rebuild for new answers as the plan's own days (its ID seeds the slot keys, so kept exercises match). */
    function editNext(planId: string, a: PlanBuilderAnswers): { days: PlanDayDraft[]; startReps: Record<string, number> } {
      const built = buildPlanFromAnswers({ answers: a, profileSplit, kitOf, historyOf, factsOf, painHeld, nowMs, keep });
      const v = pbPlanVersion({ plan: built, answers: a, kitOf, gymId: gym?.id ?? null, equipmentVersion: 'edit', opId: 'edit', at, planId });
      return { days: v.days, startReps: pbStartReps(built, planId) };
    }
  }

  return {
    open,

    /**
     * `Build plan` (and `Done` from a page opened on Your plan): writes the open plan, idempotent on `opId`. With an
     * open builder plan (`draft`), a new version from the same answers' build; nothing is written when the days are
     * unchanged; a draft that moved since is refused (rule 5).
     */
    async save(s: PlanBuilderSession, answers: PlanBuilderAnswers, draft: PlanBuilderSession['draft'], opId: string): Promise<PlanBuildOutcome> {
      const p = await deps.profile();
      if (p === null) return { ok: false, reason: 'missing' };
      const built = s.build(answers);
      if (built.days.every((d) => d.exercises.length === 0)) return { ok: false, reason: 'empty' };
      const at = deps.now();
      try {
        if (draft === null) {
          const plan = pbNewPlanDraft({ plan: built, answers, kitOf: s.kitOf, ownerId: p.id, gymId: s.gym?.id ?? null, equipmentVersion: s.equipmentVersion, opId, at });
          const r = await repo().create(p.id, plan);
          if (r.status === 'written' || r.status === 'replayed') return { ok: true, planId: r.plan.id, version: r.plan.version, versionN: r.plan.currentVersion };
          return { ok: false, reason: 'failed' };
        }
        const current = await repo().get(draft.planId);
        if (current === null || current.ownerId !== p.id) return { ok: false, reason: 'missing' };
        if (current.opIds.includes(opId)) return { ok: true, planId: current.id, version: current.version, versionN: current.currentVersion };
        const v = pbPlanVersion({ plan: built, answers, kitOf: s.kitOf, gymId: s.gym?.id ?? null, equipmentVersion: s.equipmentVersion, opId, at, planId: draft.planId });
        const now = currentPlanVersion(current);
        if (current.version === draft.version && pbSameDays(v, now) && stableStringify(now.builder?.answers) === stableStringify(answers)) return { ok: true, planId: current.id, version: current.version, versionN: current.currentVersion };
        const r = await repo().write(p.id, draft.planId, (c) => addPlanVersion(c, { version: v, expectedVersion: draft.version, opId, at }));
        if (r.status === 'written' || r.status === 'replayed') return { ok: true, planId: r.plan.id, version: r.plan.version, versionN: r.plan.currentVersion };
        return { ok: false, reason: r.status === 'missing' ? 'missing' : 'stale' };
      } catch {
        return { ok: false, reason: 'failed' };
      }
    },

    /** `Apply plan`: the plan model's Apply (`Replace my workouts`: the plan's days are the rotation; End puts his back). */
    apply(req: { planId: string; versionN: number; expectedVersion: number; opId: string }): Promise<PlanWriteOutcome> {
      return deps.plans.apply({ ...req, mode: 'replace' });
    },

    /** `Plan applied · Undo`: the setup before Apply back, exactly (rule 2, 5). */
    undo(req: { planId: string; expectedVersion: number; opId: string }): Promise<PlanWriteOutcome> {
      return deps.plans.undo(req);
    },

    /**
     * (Ben, 26 Oct) `Apply changes` on the plan in use: the accepted changes to the chosen weeks, as one versioned,
     * idempotent write with the plan's workouts made to match (rule 5). The block week is read again first, and the
     * changes are composed against the plan as stored inside the write, so a newer plan (or a workout finished since
     * the read moved the week) is refused, never applied to it.
     */
    async applyEdit(s: PlanBuilderSession, answers: PlanBuilderAnswers, rejected: ReadonlySet<string>, scope: PbEditScope, opId: string): Promise<PlanEditOutcome> {
      const p = await deps.profile();
      const run = s.running;
      if (p === null || run === null) return { ok: false, reason: 'missing', message: PLAN_COPY.missing };
      const at = deps.now();
      const store = deps.store();
      const plan = await repo().get(run.planId).catch(() => null);
      if (plan === null || plan.ownerId !== p.id) return { ok: false, reason: 'missing', message: PLAN_COPY.missing };
      if (plan.opIds.includes(opId)) return { ok: true, planId: plan.id, version: plan.version };
      const eb = editBlockOf(await readPlanBlock(store, p.id, plan, toMs(at.utc), p.timezone));
      if (eb === null || eb.week !== run.week) return { ok: false, reason: 'stale', message: PLAN_COPY.stale };
      if (answers.weeks < eb.week) return { ok: false, reason: 'too_short', message: PB_EDIT_COPY.tooShort(eb.week) };
      // The session's own build (it keeps each day's exercises as read): what the preview showed.
      const built = s.build(answers);
      const v = pbPlanVersion({ plan: built, answers, kitOf: s.kitOf, gymId: s.gym?.id ?? null, equipmentVersion: s.equipmentVersion, opId, at, planId: plan.id });
      const startReps = pbStartReps(built, plan.id);
      const r = await repo()
        .edit(p.id, plan.id, (current, routines) => {
          const weeksNow = pbAppliedBuilder(current)?.builder.answers.weeks ?? run.weeksNow;
          const pv = pbEditPreview({ plan: current, weeksNow, weeks: answers.weeks, next: v.days, block: eb, rejected, scope, nameOf: s.nameOf });
          return applyPlanEdit(current, { expectedVersion: run.planVersion, opId, at, answers, gymId: s.gym?.id ?? null, equipmentVersion: s.equipmentVersion, weekDays: pv.weekDays, startReps, block: eb, routines });
        })
        .catch(() => null);
      return editOutcome(r);
    },

    /** `Plan updated · Undo`: the plan and its workouts exactly as before the edit, only from the version it left (rule 5). */
    async undoEdit(req: { planId: string; expectedVersion: number; opId: string }): Promise<PlanEditOutcome> {
      const p = await deps.profile();
      if (p === null) return { ok: false, reason: 'missing', message: PLAN_COPY.missing };
      const at = deps.now();
      const r = await repo()
        .edit(p.id, req.planId, (current, routines) => undoPlanEdit(current, { expectedVersion: req.expectedVersion, opId: req.opId, at, routines }))
        .catch(() => null);
      return editOutcome(r);
    },

    /** The plan ID a first Build with `opId` writes (so a retried tap finds it). */
    planIdFor: pbPlanIdFor,
  };
}

export type PlanBuilderService = ReturnType<typeof createPlanBuilderService>;
