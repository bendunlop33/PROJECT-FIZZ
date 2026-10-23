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
  buildPlanFromAnswers,
  catalogueExerciseId,
  currentPlanVersion,
  deriveId,
  doableHere,
  equipmentHere,
  painFlagCovering,
  pbDefaultAnswers,
  pbExpect,
  pbPrefSuggestion,
  pbHistoryOf,
  pbKitOfEquipment,
  pbLiftStart,
  pbNeedsLiftCheck,
  pbNewPlanDraft,
  pbPlanIdFor,
  pbPlanVersion,
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
import type { EquipmentInstance, Exercise, PainFlag, PlanBuilderAnswers, PlanDraft, UserProfile, ZonedTimestamp } from '@fizz/schemas';

import type { PlanServices, PlanWriteOutcome } from './plan-services';

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

/** Every exercise the engine may name: its tables' keys. */
function engineKeys(): string[] {
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
  /** The answers to start from: the open builder plan's, else the ✦ answers. */
  answers: PlanBuilderAnswers;
  /** An open builder plan resumed (Build was tapped before; Apply wasn't). */
  draft: { planId: string; version: number; versionN: number } | null;
  gym: { id: string; name: string } | null;
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
}

export type PlanBuildOutcome = { ok: true; planId: string; version: number; versionN: number } | { ok: false; reason: 'stale' | 'empty' | 'missing' | 'failed' };

export function createPlanBuilderService(deps: PlanBuilderDeps) {
  const repo = () => deps.store().repos.planDrafts;

  /** The newest open plan made by the builder, else null. */
  async function openDraft(ownerId: string, nowUtc: string): Promise<PlanDraft | null> {
    const all = await repo().listByOwner(ownerId);
    const open = all.filter((p) => planIsOpen(p, nowUtc) && currentPlanVersion(p).builder !== undefined);
    return open.sort((a, b) => toMs(b.updatedAtUtc) - toMs(a.updatedAtUtc))[0] ?? null;
  }

  async function open(): Promise<PlanBuilderSession | null> {
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
    for (const key of engineKeys()) {
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
      const sessions = await deps.store().listExerciseHistory(p.id, e.id);
      hist.set(key, pbHistoryOf(sessions, kit === null || kit === 'bodyweight' ? null : kit.convention, nowMs));
    }
    const kitOf = (k: string): PlanKit | 'bodyweight' | null => kits.get(k) ?? null;
    const historyOf = (k: string): PbHistory | null => hist.get(k) ?? null;
    const nameOf = (k: string): string => names.get(k) ?? k;

    const draft = await openDraft(p.id, at.utc);
    const v = draft === null ? null : currentPlanVersion(draft);
    const answers = v?.builder?.answers ?? pbDefaultAnswers({ sessions: training?.daysPerWeek ?? null, minutes: training?.sessionMinutes ?? null });
    const lifts = (a: PlanBuilderAnswers): PbLiftStart[] =>
      [...PB_CHECK_LIFTS, ...a.extraLifts.filter((k) => !(PB_CHECK_LIFTS as readonly string[]).includes(k))].flatMap((k) => {
        const s = pbLiftStart(k, kitOf, historyOf, a.lifts[k], nowMs);
        return s === null ? [] : [s];
      });
    return {
      answers,
      draft: draft === null || v === null ? null : { planId: draft.id, version: draft.version, versionN: v.n },
      gym,
      profileSplit,
      nowMs,
      tz: at.tz,
      nameOf,
      kitOf,
      historyOf,
      painHeld,
      lifts,
      needsCheck: pbNeedsLiftCheck(lifts(answers)),
      build: (a) => buildPlanFromAnswers({ answers: a, profileSplit, kitOf, historyOf, painHeld, nowMs }),
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
    };
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

    /** The plan ID a first Build with `opId` writes (so a retried tap finds it). */
    planIdFor: pbPlanIdFor,
  };
}

export type PlanBuilderService = ReturnType<typeof createPlanBuilderService>;
