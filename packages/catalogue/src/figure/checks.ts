/**
 * `guide:check` (research §5.6): automatic accuracy and format checks for one
 * guide. Pure: the script passes the parsed file, its byte size and the
 * catalogue entry. A guide that fails any check doesn't ship; passing them is
 * necessary, not sufficient (Ben still approves each guide).
 */
import type { CatalogueEntry } from '../entry-schema';
import { GuideSchema, type Guide, type LimbGroup } from './guide-schema';
import { sampleTimes } from './keyframes';
import { dist, penetrationDepth, lerpVec, v, type Vec } from './math';
import { poseAt, prepareGuide, type Pose, type PreparedGuide } from './pose';
import { ROM_PROFILES, type AngleName } from './rig';
import { BODY_GROUPS, groupContours } from './body';
import { contactVelocity, poseContinuity } from './motion-metrics';
import { adjustProblems, focusViewOf, MUSCLE_REGION_MAP, parseRegion, resolveFocus, type MuscleLevel } from './muscle-map';

export const CHECK_FPS = 30;
export const LIMITS = {
  plantedDrift: 0.005,
  handContact: 0.005,
  floorTolerance: 0.004,
  colliderTolerance: 0.01,
  loopTolerance: 0.002,
  romSlackDeg: 0.5,
  minDurationMs: 2000,
  maxDurationMs: 6000,
  maxBytes: 8 * 1024,
  /** v2 outline overlap reported (not failed) above this (guides v2 §3.2). */
  outlineTolerance: 0.005,
} as const;

export const CHECK_IDS = [
  'schema',
  'exercise-match',
  'keyframe-times',
  'rom',
  'planted-feet',
  'bar-drift',
  'no-penetration',
  'hand-contact',
  'loop-continuity',
  'pose-continuity',
  'contact-velocity',
  'duration',
  'file-size',
  'captions',
  'key-positions',
  'focus',
  'outline-contact',
] as const;
export type CheckId = (typeof CHECK_IDS)[number];

export interface CheckItem {
  id: CheckId;
  ok: boolean;
  /** Passes, but the guide-maker should look (reported as `warn`, never fails the guide). */
  warn?: boolean;
  detail: string;
}

/** One row of the focus table `guide:check` prints and writes to meta.json (guides v2 §4.8). */
export interface FocusRow {
  muscle: string;
  level: MuscleLevel;
  shown: boolean;
}

export interface GuideCheckInput {
  /** Parsed guide.json. */
  raw: unknown;
  /** Size of guide.json on disk. */
  bytes: number;
  /** Directory name the guide lives in (must equal `exerciseKey`). */
  dirKey: string;
  entry: CatalogueEntry | null;
}

export interface GuideCheckReport {
  ok: boolean;
  items: CheckItem[];
  guide: Guide | null;
  frames: number;
  /** Muscle focus table (empty without a rich entry). */
  focus: FocusRow[];
}

const r4 = (n: number): string => n.toFixed(4);

/** Body segments as joint-name pairs (both sides). */
const SEGMENTS: [string, string, LimbGroup | null][] = [
  ['hip', 'lumbarBase', null],
  ['lumbarBase', 'thoraxBase', null],
  ['thoraxBase', 'c7', null],
  ['c7', 'neckTop', null],
  ...(['Near', 'Far'] as const).flatMap((s): [string, string, LimbGroup][] => [
    [`hip${s}`, `knee${s}`, `leg${s}`],
    [`knee${s}`, `ankle${s}`, `leg${s}`],
    [`heel${s}`, `toe${s}`, `leg${s}`],
    [`shoulder${s}`, `elbow${s}`, `arm${s}`],
    [`elbow${s}`, `wrist${s}`, `arm${s}`],
    [`wrist${s}`, `grip${s}`, `arm${s}`],
  ]),
];

function checkRom(guide: Guide, poses: readonly Pose[]): CheckItem {
  const limits = ROM_PROFILES[guide.checks.romProfile][guide.view];
  let worst: { name: AngleName; value: number; t: number; over: number } | null = null;
  const skipped = new Set<AngleName>();
  const declared = new Set<AngleName>(guide.checks.romSkip?.angles ?? []);
  for (const p of poses) {
    for (const [name, value] of Object.entries(p.angles) as [AngleName, number][]) {
      if (declared.has(name)) continue;
      if (p.unchecked.includes(name)) {
        skipped.add(name);
        continue;
      }
      const lim = limits[name];
      const over = Math.max(lim.min - value, value - lim.max);
      if (over > LIMITS.romSlackDeg && (worst === null || over > worst.over)) worst = { name, value, t: p.t, over };
    }
  }
  return worst === null
    ? {
        id: 'rom',
        ok: true,
        detail:
          `All joint angles inside ${guide.checks.romProfile} (${guide.view} view)` +
          (skipped.size > 0 ? `; not checked where foreshortened: ${[...skipped].join(', ')}` : '') +
          (guide.checks.romSkip ? `; skipped by the guide: ${guide.checks.romSkip.angles.join(', ')} (${guide.checks.romSkip.reason})` : ''),
      }
    : { id: 'rom', ok: false, detail: `${worst.name} = ${worst.value.toFixed(1)}° at t=${worst.t.toFixed(3)} (limit ${limits[worst.name].min}…${limits[worst.name].max})` };
}

function checkPlanted(guide: Guide, poses: readonly Pose[]): CheckItem {
  const problems: string[] = [];
  let worstDrift = 0;
  const scroll = guide.ground.scrollPerCycle;
  for (const limb of guide.checks.planted) {
    let anchor: { heel: Vec; toe: Vec; ball: Vec } | null = null;
    let everPlanted = false;
    for (const p of poses) {
      const foot = p.feet.find((f) => f.limb === limb);
      if (foot === undefined || !foot.planted) {
        anchor = null;
        continue;
      }
      everPlanted = true;
      if (foot.wanted !== null && dist(foot.wanted, foot.ankle) > LIMITS.plantedDrift) {
        problems.push(`${limb} can't reach its target at t=${p.t.toFixed(3)} (off by ${r4(dist(foot.wanted, foot.ankle))} H)`);
        break;
      }
      // Ground frame: undo the floor scroll so a foot riding the floor counts as still.
      const g = (q: Vec): Vec => v(q.x + scroll * p.t, q.y);
      const now = { heel: g(foot.heel), toe: g(foot.toe), ball: g(foot.ball) };
      if (anchor === null) {
        anchor = now;
        continue;
      }
      const drift =
        foot.pivot === 'ball' ? dist(anchor.ball, now.ball) : Math.max(dist(anchor.heel, now.heel), dist(anchor.toe, now.toe));
      worstDrift = Math.max(worstDrift, drift);
      if (drift > LIMITS.plantedDrift) {
        problems.push(`${limb} slides ${r4(drift)} H by t=${p.t.toFixed(3)}`);
        break;
      }
    }
    if (!everPlanted) problems.push(`${limb} is listed as planted but never planted`);
  }
  if (guide.checks.planted.length === 0) return { id: 'planted-feet', ok: true, detail: 'No planted feet required' };
  return problems.length === 0
    ? { id: 'planted-feet', ok: true, detail: `${guide.checks.planted.join(', ')} stay put (max drift ${r4(worstDrift)} H ≤ ${LIMITS.plantedDrift})` }
    : { id: 'planted-feet', ok: false, detail: problems.join('; ') };
}

function barPropId(guide: Guide): string | null {
  return guide.checks.barProp ?? guide.props.find((p) => p.type === 'barbell')?.id ?? null;
}

function checkBarDrift(guide: Guide, poses: readonly Pose[]): CheckItem {
  const max = guide.checks.barDriftMax;
  if (max === undefined) return { id: 'bar-drift', ok: true, detail: 'No bar-path limit set' };
  const id = barPropId(guide);
  if (id === null) return { id: 'bar-drift', ok: false, detail: 'barDriftMax is set but there is no bar prop' };
  const xs = poses.map((p) => p.propPoints[id]?.x).filter((x): x is number => x !== undefined);
  if (xs.length !== poses.length) return { id: 'bar-drift', ok: false, detail: `Prop ${id} has no position in some frames` };
  const drift = Math.max(...xs) - Math.min(...xs);
  return { id: 'bar-drift', ok: drift <= max, detail: `${id} drifts ${r4(drift)} H horizontally (limit ${max})` };
}

function checkPenetration(guide: Guide, poses: readonly Pose[]): CheckItem {
  const beside = new Set<LimbGroup>(guide.checks.besideProps ?? []);
  for (const p of poses) {
    const floor = p.groundY - LIMITS.floorTolerance;
    const low: [string, number][] = [
      ...Object.entries(p.points).map(([name, q]): [string, number] => [name, q.y]),
      ...p.feet.flatMap((f): [string, number][] => [[`${f.limb} heel`, f.heel.y], [`${f.limb} toe`, f.toe.y]]),
      ['head', p.head.c.y - p.head.r],
      ...p.solidBottoms.map((y, i): [string, number] => [`prop solid ${i}`, y]),
    ];
    const under = low.find(([, y]) => y < floor);
    if (under) return { id: 'no-penetration', ok: false, detail: `${under[0]} is ${r4(p.groundY - under[1])} H below the floor at t=${p.t.toFixed(3)}` };
    for (const c of p.colliders) {
      for (const [a, b, limb] of SEGMENTS) {
        if (limb !== null && beside.has(limb)) continue;
        const pa = p.points[a];
        const pb = p.points[b];
        if (pa === undefined || pb === undefined) continue;
        for (let i = 0; i <= 8; i += 1) {
          const depth = penetrationDepth(lerpVec(pa, pb, i / 8), c.polygon);
          if (depth > LIMITS.colliderTolerance) {
            return { id: 'no-penetration', ok: false, detail: `${a}–${b} goes ${r4(depth)} H into ${c.propId} at t=${p.t.toFixed(3)}` };
          }
        }
      }
    }
  }
  const note = beside.size > 0 ? ` (${[...beside].join(', ')} pass beside props)` : '';
  return { id: 'no-penetration', ok: true, detail: `Nothing goes through the floor or a bench/seat${note}` };
}

function checkHands(poses: readonly Pose[]): CheckItem {
  let worst = 0;
  let count = 0;
  for (const p of poses) {
    for (const h of p.hands) {
      count += 1;
      const d = dist(h.wanted, h.actual);
      worst = Math.max(worst, d);
      if (!h.reached || d > LIMITS.handContact) {
        return { id: 'hand-contact', ok: false, detail: `${h.limb} misses ${h.prop ?? 'its target'} by ${r4(d)} H at t=${p.t.toFixed(3)}` };
      }
    }
  }
  return { id: 'hand-contact', ok: true, detail: count === 0 ? 'No hand contacts' : `Hands stay on their targets (max ${r4(worst)} H)` };
}

function checkLoop(prepared: PreparedGuide): CheckItem {
  if (prepared.guide.loop === 'pingpong') return { id: 'loop-continuity', ok: true, detail: 'Ping-pong loops are continuous by construction' };
  const a = poseAt(prepared, 0);
  let worst = 0;
  let where = '';
  // t = 1 is the last keyframe exactly; 1 − ε is the last frame actually drawn before the loop restarts.
  for (const b of [poseAt(prepared, 1), poseAt(prepared, 1 - 1e-6)]) {
    for (const [name, p] of Object.entries(a.points)) {
      const q = b.points[name];
      if (q === undefined) continue;
      const d = dist(p, q);
      if (d > worst) {
        worst = d;
        where = name;
      }
    }
    for (const [id, p] of Object.entries(a.propPoints)) {
      const q = b.propPoints[id];
      if (q !== undefined && dist(p, q) > worst) {
        worst = dist(p, q);
        where = id;
      }
    }
  }
  return worst <= LIMITS.loopTolerance
    ? { id: 'loop-continuity', ok: true, detail: `First and last poses match (max ${r4(worst)} H)` }
    : { id: 'loop-continuity', ok: false, detail: `Loop jumps: ${where} moves ${r4(worst)} H between t=1 and t=0` };
}

/** No point jumps at a key, a hold end or the loop seam (ADR 0015, C1). */
function checkPoseContinuity(prepared: PreparedGuide): CheckItem {
  const m = poseContinuity(prepared);
  return m.ok
    ? { id: 'pose-continuity', ok: true, detail: `Nothing jumps at a key, hold end or the loop seam (max ${r4(m.value ?? 0)} H ≤ ${LIMITS.loopTolerance})` }
    : { id: 'pose-continuity', ok: false, detail: `Pose jumps: ${m.where}` };
}

/**
 * A foot keeps its velocity where it lifts off or lands (ADR 0015, C2). Hard
 * once the guide sets `ground.matchFloorSpeed`; before that a jump is a
 * warning, because removing it needs that rule and a re-posed stride together.
 */
function checkContactVelocity(prepared: PreparedGuide): CheckItem {
  const m = contactVelocity(prepared);
  if (m.value === null) return { id: 'contact-velocity', ok: true, detail: 'No foot lifts off or lands' };
  if (m.ok) return { id: 'contact-velocity', ok: true, detail: `Feet lift off and land without a velocity jump (max ${m.value.toFixed(3)} H/s)` };
  if (prepared.guide.ground.matchFloorSpeed === true) return { id: 'contact-velocity', ok: false, detail: `Velocity jump: ${m.where}` };
  return {
    id: 'contact-velocity',
    ok: true,
    warn: true,
    detail: `Velocity jump: ${m.where}; the foot stops dead where it meets the moving floor (fix: ground.matchFloorSpeed with toe-off reach ≤ 0.97)`,
  };
}

function checkKeyTimes(guide: Guide, prepared: PreparedGuide): CheckItem {
  const ks = prepared.keys;
  const first = ks[0];
  const last = ks[ks.length - 1];
  if (first?.t !== 0 || last?.t !== 1) return { id: 'keyframe-times', ok: false, detail: 'Keyframes must start at t=0 and end at t=1' };
  for (let i = 1; i < ks.length; i += 1) {
    const prev = ks[i - 1];
    const cur = ks[i];
    if (prev === undefined || cur === undefined) continue;
    if (cur.t <= prev.t) return { id: 'keyframe-times', ok: false, detail: `Keyframe ${i} is not after keyframe ${i - 1}` };
    if (prev.holdEnd > cur.t + 1e-9) return { id: 'keyframe-times', ok: false, detail: `Keyframe ${i - 1}'s hold runs past keyframe ${i}` };
  }
  return { id: 'keyframe-times', ok: true, detail: `${guide.keyframes.length} keyframes in order` };
}

function checkCaptions(prepared: PreparedGuide): CheckItem {
  const missing = prepared.keys.filter((k) => k.label !== null && k.caption === null).map((k) => k.index);
  if (prepared.guide.a11y.summary.trim() === '') return { id: 'captions', ok: false, detail: 'a11y.summary is empty' };
  if (prepared.keys.every((k) => k.label === null)) return { id: 'captions', ok: false, detail: 'No labelled keyframes' };
  return missing.length === 0
    ? { id: 'captions', ok: true, detail: 'Summary and every labelled keyframe caption present' }
    : { id: 'captions', ok: false, detail: `Labelled keyframes without a caption: ${missing.join(', ')}` };
}

/** Distinct keyframe labels in order of first appearance. */
export function keyframeLabels(prepared: PreparedGuide): string[] {
  const seen: string[] = [];
  for (const k of prepared.keys) if (k.label !== null && !seen.includes(k.label)) seen.push(k.label);
  return seen;
}

function checkKeyPositions(prepared: PreparedGuide, entry: CatalogueEntry | null): CheckItem {
  if (entry?.tier !== 'rich') return { id: 'key-positions', ok: false, detail: 'No rich catalogue entry with a guide brief' };
  const want = entry.guideBrief.keyPositions.map((p) => p.label);
  const got = keyframeLabels(prepared);
  const same = want.length === got.length && want.every((l, i) => l === got[i]);
  return same
    ? { id: 'key-positions', ok: true, detail: `Labels match the brief: ${got.join(' · ')}` }
    : { id: 'key-positions', ok: false, detail: `Brief has ${want.join(' · ')}; guide has ${got.join(' · ')}` };
}

function checkExercise(guide: Guide, dirKey: string, entry: CatalogueEntry | null): CheckItem {
  if (guide.exerciseKey !== dirKey) return { id: 'exercise-match', ok: false, detail: `exerciseKey ${guide.exerciseKey} ≠ folder ${dirKey}` };
  if (entry === null) return { id: 'exercise-match', ok: false, detail: `No catalogue entry ${guide.exerciseKey}` };
  if (entry.tier === 'rich' && entry.guideBrief.view !== guide.view) {
    return { id: 'exercise-match', ok: false, detail: `Brief asks for a ${entry.guideBrief.view} view; guide is ${guide.view}` };
  }
  return { id: 'exercise-match', ok: true, detail: `${entry.name} (${guide.view} view)` };
}

/**
 * Focus overrides (guides v2 §4.8): `hide`, `adjust` and `add` may only name
 * muscles the catalogue entry lists, so the figure never shows a muscle the
 * text doesn't name; adjustments stay within ±0.25 of the map; added regions
 * must parse. Warns when a unilateral front/back-view guide doesn't say which
 * side is working (§4.6).
 */
function checkFocus(guide: Guide, entry: CatalogueEntry | null): { item: CheckItem; rows: FocusRow[] } {
  if (entry === null) return { item: { id: 'focus', ok: guide.focus === undefined, detail: guide.focus === undefined ? 'No entry, no focus' : 'Focus overrides need a catalogue entry' }, rows: [] };
  const listed = new Set<string>([...entry.primaryMuscles, ...entry.secondaryMuscles]);
  const view = focusViewOf(guide);
  const problems: string[] = [];
  const f = guide.focus;
  for (const m of f?.hide ?? []) if (!listed.has(m)) problems.push(`hide: ${m} isn't listed in the entry`);
  for (const [m, adj] of Object.entries(f?.adjust ?? {})) {
    if (!listed.has(m)) problems.push(`adjust: ${m} isn't listed in the entry`);
    const first = MUSCLE_REGION_MAP[m as keyof typeof MUSCLE_REGION_MAP][view]?.[0];
    if (first === undefined) problems.push(`adjust: ${m} has no mapped region in the ${view} view`);
    else for (const p of adjustProblems(first, adj)) problems.push(`adjust ${m}: ${p}`);
  }
  for (const a of f?.add ?? []) {
    if (!listed.has(a.muscle)) problems.push(`add: ${a.muscle} isn't listed in the entry`);
    if (parseRegion(a.region) === null) problems.push(`add ${a.muscle}: can't read region "${a.region}"`);
  }
  const resolved = resolveFocus({ primary: entry.primaryMuscles, secondary: entry.secondaryMuscles }, f, view);
  // strong/soft hold every listed muscle, hidden ones included (§4.7).
  const rows: FocusRow[] = [...resolved.strong.map((m) => ({ m, level: 'strong' as const })), ...resolved.soft.map((m) => ({ m, level: 'soft' as const }))].map(({ m, level }) => ({ muscle: m, level, shown: resolved.drawn.includes(m) }));
  const table = rows.map((r) => `${r.muscle} ${r.level}${r.shown ? '' : ' (not shown)'}`).join(' · ');
  if (problems.length > 0) return { item: { id: 'focus', ok: false, detail: problems.join('; ') }, rows };
  const unilateralFront = guide.view === 'front' && entry.laterality === 'unilateral' && f?.side === undefined;
  return {
    item: { id: 'focus', ok: true, ...(unilateralFront ? { warn: true } : {}), detail: `${view} view: ${table}${unilateralFront ? '; unilateral front/back view without focus.side' : ''}` },
    rows,
  };
}

/**
 * Report-only (guides v2 §3.2): how far the v2 body *outline* goes into the
 * floor or a bench/seat. The pass/fail check above tests the joint
 * centrelines (unchanged, so existing guides still pass); this tells the
 * guide-maker where the fuller silhouette now overlaps, for re-tuning.
 */
function checkOutlineContact(guide: Guide, poses: readonly Pose[]): CheckItem {
  const beside = new Set<string>(guide.checks.besideProps ?? []);
  let worst = { depth: 0, what: '', t: 0 };
  for (const p of poses) {
    for (const g of BODY_GROUPS) {
      if (beside.has(g)) continue;
      for (const pt of groupContours(p.body, g).flat()) {
        const under = p.groundY - pt.y;
        if (under > worst.depth) worst = { depth: under, what: `${g} below the floor`, t: p.t };
        for (const c of p.colliders) {
          const d = penetrationDepth(pt, c.polygon);
          if (d > worst.depth) worst = { depth: d, what: `${g} into ${c.propId}`, t: p.t };
        }
      }
    }
  }
  const tol = LIMITS.outlineTolerance;
  return worst.depth > tol
    ? { id: 'outline-contact', ok: true, warn: true, detail: `v2 outline: ${worst.what} by ${r4(worst.depth)} H at t=${worst.t.toFixed(3)} (report only; tolerance ${tol})` }
    : { id: 'outline-contact', ok: true, detail: `v2 outline stays out of the floor and props (max ${r4(worst.depth)} H)` };
}

export function checkGuide(input: GuideCheckInput): GuideCheckReport {
  const parsed = GuideSchema.safeParse(input.raw);
  if (!parsed.success) {
    const detail = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    return { ok: false, guide: null, frames: 0, focus: [], items: [{ id: 'schema', ok: false, detail }] };
  }
  const guide = parsed.data;
  const prepared = prepareGuide(guide);
  const times = sampleTimes(guide, prepared.keys, CHECK_FPS);
  const poses = times.map((t) => poseAt(prepared, t));
  const focus = checkFocus(guide, input.entry);
  const items: CheckItem[] = [
    { id: 'schema', ok: true, detail: 'guide.json matches format v1' },
    checkExercise(guide, input.dirKey, input.entry),
    checkKeyTimes(guide, prepared),
    checkRom(guide, poses),
    checkPlanted(guide, poses),
    checkBarDrift(guide, poses),
    checkPenetration(guide, poses),
    checkHands(poses),
    checkLoop(prepared),
    checkPoseContinuity(prepared),
    checkContactVelocity(prepared),
    {
      id: 'duration',
      ok: guide.durationMs >= LIMITS.minDurationMs && guide.durationMs <= LIMITS.maxDurationMs,
      detail: `${guide.durationMs} ms (allowed ${LIMITS.minDurationMs}–${LIMITS.maxDurationMs})`,
    },
    { id: 'file-size', ok: input.bytes <= LIMITS.maxBytes, detail: `${input.bytes} bytes (limit ${LIMITS.maxBytes})` },
    checkCaptions(prepared),
    checkKeyPositions(prepared, input.entry),
    focus.item,
    checkOutlineContact(guide, poses),
  ];
  return { ok: items.every((i) => i.ok), items, guide, frames: poses.length, focus: focus.rows };
}
