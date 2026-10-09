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
  'duration',
  'file-size',
  'captions',
  'key-positions',
] as const;
export type CheckId = (typeof CHECK_IDS)[number];

export interface CheckItem {
  id: CheckId;
  ok: boolean;
  detail: string;
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
  for (const p of poses) {
    for (const [name, value] of Object.entries(p.angles) as [AngleName, number][]) {
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
          (skipped.size > 0 ? `; not checked where foreshortened: ${[...skipped].join(', ')}` : ''),
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
  const b = poseAt(prepared, 1);
  let worst = 0;
  let where = '';
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
  return worst <= LIMITS.loopTolerance
    ? { id: 'loop-continuity', ok: true, detail: `First and last poses match (max ${r4(worst)} H)` }
    : { id: 'loop-continuity', ok: false, detail: `Loop jumps: ${where} moves ${r4(worst)} H between t=1 and t=0` };
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

export function checkGuide(input: GuideCheckInput): GuideCheckReport {
  const parsed = GuideSchema.safeParse(input.raw);
  if (!parsed.success) {
    const detail = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    return { ok: false, guide: null, frames: 0, items: [{ id: 'schema', ok: false, detail }] };
  }
  const guide = parsed.data;
  const prepared = prepareGuide(guide);
  const times = sampleTimes(guide, prepared.keys, CHECK_FPS);
  const poses = times.map((t) => poseAt(prepared, t));
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
    {
      id: 'duration',
      ok: guide.durationMs >= LIMITS.minDurationMs && guide.durationMs <= LIMITS.maxDurationMs,
      detail: `${guide.durationMs} ms (allowed ${LIMITS.minDurationMs}–${LIMITS.maxDurationMs})`,
    },
    { id: 'file-size', ok: input.bytes <= LIMITS.maxBytes, detail: `${input.bytes} bytes (limit ${LIMITS.maxBytes})` },
    checkCaptions(prepared),
    checkKeyPositions(prepared, input.entry),
  ];
  return { ok: items.every((i) => i.ok), items, guide, frames: poses.length };
}
