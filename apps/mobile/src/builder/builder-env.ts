import {
  builderInfoOf,
  builderWorksOf,
  checkedOnOf,
  equipmentHere,
  doableHere,
  loadReferences,
  nextTargetsFor,
  noReferenceCeiling,
  painFlagCovering,
  painHoldFor,
  planFirstLoads,
  ruleAnchorOf,
  lastSessionE1rm,
  stableStringify,
  deriveId,
  toMs,
  type AnchorLoad,
  type BuilderContext,
  type BuilderExerciseInfo,
  type BuilderPool,
  type DraftCodecContext,
  type HistorySession,
  type LoadReferences,
  type SlotLoadInput,
  type SubstituteContext,
} from '@fizz/domain';
import { builderFocusOf, isBuilderStrength, type BuilderFocus, type BuilderGroup, type CheckedOnRecord, type EquipmentInstance, type Exercise, type PainFlag, type PlanDraft, type Routine, type UserProfile, type ZonedTimestamp } from '@fizz/schemas';
import type { Store } from '@fizz/persistence';

/**
 * What the builder rules read from Ben's data at one gym (workout-builder-v3
 * §3.1, §3.7, §4.1), gathered once per call so the pure rules can stay
 * synchronous. Your data (history, pain flags, coach targets, gyms) and
 * Coaching knowledge (the catalogue) are read separately and never mixed
 * into one store (rule 10).
 *
 * Loads per exercise, in Ben's order (Q12): the coach's saved next-session
 * target → the plan's first-week load (a plan template never done) → the
 * built-in rule's next target → est. max from his own recent sets → none
 * (`Start light`, the item's safe cap). Pain-flagged movements are held to
 * the last comparable working load (rule 9).
 */

export interface BuilderEnv {
  ctx: BuilderContext;
  pool: BuilderPool;
  codec: DraftCodecContext;
  info: (exerciseId: string) => BuilderExerciseInfo | null;
  exercise: (exerciseId: string) => Exercise | null;
  nameOf: (exerciseId: string) => string;
  worksOf: (exerciseId: string) => string | null;
  focusOf: (exerciseId: string) => BuilderFocus | null;
  painFlagged: (exerciseId: string) => boolean;
  /** The pain that holds a movement (`shoulder flagged 6 Oct`), else null (rule 9; the coach's checks name it). */
  painText: (exerciseId: string) => string | null;
  /** The load references read for an exercise (its loads were worked out from them); null when none were read. */
  refsOf: (exerciseId: string) => LoadReferences | null;
  /** This gym has what the exercise needs (`Not at this gym` otherwise, §2.3). */
  doable: (exerciseId: string) => boolean;
  /** The item a slot's loads are worked out on here, by name (`Why this weight?` → `Rounded down: …`). */
  itemNameOf: (exerciseId: string) => string | null;
  /** The last comparable session's top working set, in the slot's unit (for `Why this weight?`). */
  lastTopOf: (exerciseId: string) => { value: number; reps: number } | null;
  /** Exercises of a group this gym has, best first (Ben's history, then the catalogue), pain-flagged ones included (Swap shows `May hurt`). */
  candidates: (group: BuilderGroup) => readonly string[];
  /** Compound lifts whose builder group is one of these (Main lift on a Custom day, §2.2). */
  compoundsOf: (groups: readonly BuilderGroup[]) => readonly string[];
  /** Hash of the gym's items (draft `equipmentVersion`, §4.4). */
  equipmentVersion: string;
  gymId: string | null;
  unit: UserProfile['preferredUnit'];
}

export interface BuilderEnvRequest {
  profile: UserProfile;
  gymId: string | null;
  /** Exercises whose loads must be exact (the draft's, a swap or add target). */
  exerciseIds: readonly string[];
  /** Groups whose pools the build may pick from (their first candidates get exact loads). */
  groups: readonly BuilderGroup[];
  /** A plan template being opened: its first-week loads (§3.1 step 2). */
  template?: Routine | null;
  newKey: (exerciseId: string) => string;
}

export type BuilderEnvPort = (req: BuilderEnvRequest) => Promise<BuilderEnv>;

export interface BuilderEnvDeps {
  store: () => Store;
  now: () => ZonedTimestamp;
  catalogueExercises: () => readonly Exercise[];
}

/** How many of each group's best candidates get exact loads up front (the rest are computed when picked). */
const POOL_EXACT = 10;

export function createBuilderEnv(deps: BuilderEnvDeps): BuilderEnvPort {
  return async (req) => {
    const repos = deps.store().repos;
    const p = req.profile;
    const at = deps.now();
    const nowMs = toMs(at.utc);
    const own = await repos.exercises.list().catch(() => [] as Exercise[]);
    const byId = new Map<string, Exercise>();
    for (const e of deps.catalogueExercises()) byId.set(e.id, e);
    for (const e of own) if (e.archivedAtUtc === undefined) byId.set(e.id, e);
    const gym = req.gymId === null ? null : await repos.gyms.get(req.gymId).catch(() => null);
    const equipment = req.gymId === null ? [] : await repos.equipment.listByGym(req.gymId).catch(() => [] as EquipmentInstance[]);
    const known = new Map<string, EquipmentInstance>();
    for (const g of await repos.gyms.listByOwner(p.id).catch(() => [])) for (const e of await repos.equipment.listByGym(g.id).catch(() => [] as EquipmentInstance[])) known.set(e.id, e);
    const flags: readonly PainFlag[] = await repos.painFlags.listActive(p.id).catch(() => [] as PainFlag[]);
    const snapGym = { id: req.gymId ?? 'no-gym', name: gym?.name ?? 'this gym', equipment };
    const substitute: SubstituteContext = { ownerId: p.id, unit: p.preferredUnit, gym: snapGym, knownEquipment: known, painFlags: flags, sessionPain: { active: false, reportedAtUtc: null }, at };

    const infoCache = new Map<string, BuilderExerciseInfo | null>();
    const info = (id: string): BuilderExerciseInfo | null => {
      if (!infoCache.has(id)) {
        const e = byId.get(id);
        infoCache.set(id, e === undefined || e.archivedAtUtc !== undefined || !isBuilderStrength(e) ? null : builderInfoOf(e));
      }
      return infoCache.get(id) ?? null;
    };
    const painFlagged = (id: string) => painFlagCovering(flags, id, nowMs, at.tz) !== null;
    const here = (e: Exercise) => doableHere(e, snapGym);

    // Recent use (Ben's history first, §3.7): one history read per candidate in the groups asked for.
    const histories = new Map<string, HistorySession[]>();
    const historyOf = async (id: string): Promise<HistorySession[]> => {
      const got = histories.get(id);
      if (got !== undefined) return got;
      const h = await deps.store().listExerciseHistory(p.id, id).catch(() => [] as HistorySession[]);
      histories.set(id, h);
      return h;
    };
    const byGroup = new Map<BuilderGroup, Exercise[]>();
    for (const e of byId.values()) {
      const i = info(e.id);
      if (i === null || !here(e)) continue;
      byGroup.set(i.group, [...(byGroup.get(i.group) ?? []), e]);
    }
    const ranked = new Map<BuilderGroup, string[]>();
    for (const g of new Set(req.groups)) {
      const list = byGroup.get(g) ?? [];
      const lastMs = new Map<string, number>();
      for (const e of list) {
        const h = await historyOf(e.id);
        const newest = h[0];
        if (newest !== undefined) lastMs.set(e.id, toMs(newest.performedAtUtc));
      }
      const ids = list.map((e) => e.id);
      ids.sort((a, b) => (lastMs.get(b) ?? -1) - (lastMs.get(a) ?? -1) || (byId.get(a)?.name ?? '').localeCompare(byId.get(b)?.name ?? ''));
      ranked.set(g, ids);
    }
    const candidates = (g: BuilderGroup): readonly string[] => {
      const r = ranked.get(g);
      if (r !== undefined) return r;
      return (byGroup.get(g) ?? []).map((e) => e.id).sort((a, b) => (byId.get(a)?.name ?? '').localeCompare(byId.get(b)?.name ?? ''));
    };

    // Plan first-week loads for a template never done (§3.1 step 2).
    const firstLoads = new Map<string, AnchorLoad>();
    /** When the plan's loads were set: newer history may replace a lower plan load (builder loads, 21 Oct). */
    let planSetMs: number | null = null;
    const t = req.template ?? null;
    if (t !== null && t.createdFromPlan !== undefined) {
      const plan: PlanDraft | null = await repos.planDrafts.get(t.createdFromPlan.planId).catch(() => null);
      if (plan !== null && plan.ownerId === p.id) {
        const link = t.createdFromPlan;
        const setAt = plan.versions.find((v) => v.n === link.versionN)?.createdAt.utc;
        planSetMs = setAt === undefined ? null : toMs(setAt);
        const ex = new Map<string, Exercise>();
        const hs = new Map<string, HistorySession[]>();
        for (const r of t.exercises) {
          const e = byId.get(r.exerciseId);
          if (e === undefined) continue;
          ex.set(e.id, e);
          hs.set(e.id, await historyOf(e.id));
        }
        for (const [, v] of planFirstLoads({ routine: t, plan, exercises: ex, histories: hs, substitute, nowMs })) {
          const set = v.sets.find((s) => s !== null && s.load !== null && s.reps !== null);
          if (set?.load != null && set.reps !== null) firstLoads.set(v.exerciseId, { value: set.load.value, reps: set.reps.min, rpe: set.rpe ?? 8 });
        }
      }
    }

    const exact = new Set<string>(req.exerciseIds);
    for (const g of new Set(req.groups)) for (const id of candidates(g).slice(0, POOL_EXACT)) exact.add(id);
    const loadCache = new Map<string, SlotLoadInput>();
    const refsCache = new Map<string, LoadReferences>();
    const lastTop = new Map<string, { value: number; reps: number }>();
    const computeLoad = async (id: string): Promise<SlotLoadInput | null> => {
      const e = byId.get(id);
      if (e === undefined) return null;
      const history = await historyOf(id);
      const refs = loadReferences({ exercise: e, history, ctx: substitute, nowMs });
      refsCache.set(id, refs);
      const eq = refs.equipment;
      const flagged = painFlagged(id);
      const latestTop = refs.latest?.top.value ?? null;
      if (refs.latest != null) lastTop.set(id, { value: refs.latest.top.value, reps: refs.latest.top.reps });
      let ruleTarget: AnchorLoad | null = null;
      let coachTarget: AnchorLoad | null = null;
      if (history.length > 0) {
        const newest = history[0];
        const saved = newest === undefined ? [] : await repos.coach.listNextTargets(p.id, newest.sessionId).catch(() => []);
        const mine = saved.find((x) => x.exerciseId === id && x.status === 'saved' && x.target.load !== null);
        if (mine?.target.load != null && mine.target.load.convention === refs.convention) coachTarget = { value: mine.target.load.value, reps: mine.target.reps?.min ?? 8, rpe: mine.target.rpe ?? 8 };
        try {
          // The rule reads the same history as `loadReferences`: other items of the same kind and bar mass too (21 Oct).
          const comparableEquipmentIds = new Set(refs.comparableEquipmentIds ?? []);
          const { result, rule } = nextTargetsFor({ ownerId: p.id, exerciseId: id, exerciseName: e.name, measurement: e.measurement, unit: refs.unit, convention: refs.convention, equipment: eq, exercise: e, rule: null, workingSets: 3, history, painFlags: flags, sessionPain: { active: false, reportedAtUtc: null }, comparableEquipmentIds });
          ruleTarget = ruleAnchorOf(result, rule, refs.convention);
        } catch {
          ruleTarget = null;
        }
      }
      const e1rm = refs.own?.e1rm ?? null;
      const planned = firstLoads.get(id) ?? null;
      const newerThanPlan = planned !== null && planSetMs !== null && refs.latest !== null && toMs(refs.latest.performedAtUtc) > planSetMs;
      return {
        unit: refs.unit,
        convention: refs.convention,
        equipment: eq,
        bodyweightExercise: e.defaultLoadConvention === 'bodyweight',
        gymEquipment: equipment,
        coachTarget,
        planFirstLoad: planned === null ? null : newerThanPlan ? { ...planned, yieldsToHistory: true } : planned,
        ruleTarget,
        e1rm,
        lastE1rm: lastSessionE1rm(refs.own),
        e1rmGapDays: refs.own?.gapDays ?? null,
        startLightCeiling: noReferenceCeiling(eq, refs.patternE1rms),
        painCap: flagged ? latestTop : null,
        historyVersion: refs.historyVersion,
      };
    };
    for (const id of exact) {
      const l = await computeLoad(id);
      if (l !== null) loadCache.set(id, l);
    }
    const loads = (id: string): SlotLoadInput => {
      const got = loadCache.get(id);
      if (got !== undefined) return got;
      // Not read up front (a candidate past the first few): the item and no reference; the service re-reads before keeping it.
      const e = byId.get(id);
      const eq = e === undefined ? null : equipmentHere(e, { gym: snapGym }).equipment;
      return { unit: eq?.unit ?? p.preferredUnit, convention: eq?.loadConvention ?? e?.defaultLoadConvention ?? 'total', equipment: eq, bodyweightExercise: e?.defaultLoadConvention === 'bodyweight', gymEquipment: equipment, coachTarget: null, planFirstLoad: null, ruleTarget: null, e1rm: null, startLightCeiling: noReferenceCeiling(eq), painCap: null };
    };

    const presets = p.restPresets.map((r) => r.seconds);
    const ctx: BuilderContext = { info, loads, newKey: req.newKey, ...(presets.length > 0 ? { restPresetsS: presets } : {}) };
    const pool: BuilderPool = (g) => candidates(g).filter((id) => !painFlagged(id));
    // The one `checkedOnOf` (domain): what Start's re-check compares against, so a builder draft and Today's agree
    // (an lb bar's mass in kg, the slot's convention).
    const checkedOn = (id: string): CheckedOnRecord | null => checkedOnOf(loads(id));
    const codec: DraftCodecContext = { info, catalogueIdOf: (id) => byId.get(id)?.catalogueKey ?? id, checkedOnOf: checkedOn, ...(presets.length > 0 ? { restPresetsS: presets } : {}) };
    return {
      ctx,
      pool,
      codec,
      info,
      exercise: (id) => byId.get(id) ?? null,
      nameOf: (id) => byId.get(id)?.name ?? 'Exercise',
      worksOf: (id) => {
        const e = byId.get(id);
        return e === undefined ? null : builderWorksOf(e);
      },
      focusOf: (id) => {
        const e = byId.get(id);
        return e === undefined ? null : builderFocusOf(e);
      },
      painFlagged,
      painText: (id) => painHoldFor(id, flags, { active: false }, nowMs, at.tz)?.text ?? null,
      refsOf: (id) => refsCache.get(id) ?? null,
      doable: (id) => {
        const e = byId.get(id);
        return e !== undefined && here(e);
      },
      itemNameOf: (id) => {
        const eq = loads(id).equipment;
        return eq === null ? null : eq.name;
      },
      lastTopOf: (id) => lastTop.get(id) ?? null,
      candidates,
      compoundsOf: (groups) =>
        [...byId.values()]
          .filter((e) => {
            const i = info(e.id);
            return i !== null && i.role === 'compound' && groups.includes(i.group) && here(e);
          })
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((e) => e.id),
      equipmentVersion: deriveId(`builder-equipment:${stableStringify(equipment.map((e) => [e.id, e.version]).sort())}`),
      gymId: req.gymId,
      unit: p.preferredUnit,
    };
  };
}
