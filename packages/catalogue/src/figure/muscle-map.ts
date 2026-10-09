/**
 * Muscle focus (guides v2 §4): which body regions are coloured for the
 * muscles a catalogue entry lists. The map is written in the spec's notation
 * (§4.5) and parsed once into typed regions, so the table here can be read
 * against the spec line by line.
 *
 * Notation: `segment.surface s0–s1 dD` (an edge band, surface `front`/`back`
 * in a side view, `lat`/`med` in front/back views) or `segment.face s0–s1 cC
 * wW` (a lens across the segment; `±c` = a mirrored left/right pair on the
 * trunk; `wA>B` = width from A at s0 to B at s1; `cA>B` = centre moving
 * from A to B, e.g. a lat sweeping from the waist out to the armpit), or
 * `hand.full`.
 *
 * `trunk` is the pelvis–lumbar–thorax chain read as one segment, so a muscle
 * that spans the trunk (abs, lower back, lats) is one smooth shape rather
 * than a bead per segment. Its `s` is segment index + local s: pelvis
 * −0.7…1, lumbar 1…2, thorax 2…3 (e.g. `trunk.front 0.3–2.35` runs from
 * pelvis 0.3 to thorax 0.35).
 *
 * Source of truth for *which* muscles: the catalogue entry only (rule 6);
 * a guide can hide, adjust or add regions only for muscles the entry lists.
 */
import type { Muscle } from '../vocab';
import { MUSCLES } from '../vocab';
import type { GuideFocus, RegionAdjust } from './guide-schema';
import { SEGMENT_NAMES, type SegmentName } from './profiles';

export type FocusView = 'side' | 'front' | 'back';
export type MuscleLevel = 'strong' | 'soft';

/** A region's base: one body segment, or `trunk` (the pelvis–lumbar–thorax chain as one). */
export type RegionSeg = SegmentName | 'trunk';

export type RegionSpec =
  | { kind: 'edge'; seg: RegionSeg; surface: 'front' | 'back' | 'lat' | 'med'; s: readonly [number, number]; d: number }
  | { kind: 'face'; seg: RegionSeg; s: readonly [number, number]; c: readonly [number, number]; w: readonly [number, number]; mirror: boolean }
  | { kind: 'hand' };

/** Highest `s` a region may reach: a little past a segment's end, or the top of the trunk chain. */
export const regionMaxS = (seg: RegionSeg): number => (seg === 'trunk' ? 3 : 1.5);

const NUM = String.raw`[+-]?\d*\.?\d+`;

/** `A` or `A>B` (a value that runs from A at s0 to B at s1). */
const pair = (text: string): [number, number] => {
  const [a, b] = text.split('>');
  return [Number(a), Number(b ?? a)];
};
const RANGE = new RegExp(String.raw`^(${NUM})(?:–|\.\.)(${NUM})$`);

/** Parses one region in the map's notation; null if it isn't valid. */
export function parseRegion(text: string): RegionSpec | null {
  const tokens = text.replace(/−/g, '-').trim().split(/\s+/);
  const head = tokens[0];
  if (head === undefined) return null;
  if (head === 'hand.full') return tokens.length === 1 ? { kind: 'hand' } : null;
  const [segName, surface] = head.split('.');
  if (segName !== 'trunk' && !(SEGMENT_NAMES as readonly string[]).includes(segName ?? '')) return null;
  const seg = segName as RegionSeg;
  let s: [number, number] | null = null;
  let d: number | null = null;
  let c: [number, number] | null = null;
  let mirror = false;
  let w: [number, number] | null = null;
  for (const tok of tokens.slice(1)) {
    const range = RANGE.exec(tok);
    if (range) {
      s = [Number(range[1]), Number(range[2])];
    } else if (/^d/.test(tok)) {
      d = Number(tok.slice(1));
    } else if (/^±c/.test(tok)) {
      c = pair(tok.slice(2));
      mirror = true;
    } else if (/^c/.test(tok)) {
      c = pair(tok.slice(1));
    } else if (/^w/.test(tok)) {
      w = pair(tok.slice(1));
    } else {
      return null;
    }
  }
  if (s === null || !(s[0] < s[1]) || [...s].some((x) => !Number.isFinite(x) || x < -1 || x > regionMaxS(seg))) return null;
  if (surface === 'front' || surface === 'back' || surface === 'lat' || surface === 'med') {
    if (d === null || !(d > 0 && d <= 1) || c !== null || w !== null) return null;
    return { kind: 'edge', seg, surface, s, d };
  }
  if (surface === 'face') {
    if (c === null || w === null || d !== null || c.some((x) => !(x >= -1 && x <= 1)) || w.some((x) => !(x > 0 && x <= 1))) return null;
    return { kind: 'face', seg, s, c, w, mirror };
  }
  return null;
}

type Cell = readonly string[] | null;
type Row = { side: Cell; front: Cell; back: Cell };

/**
 * §4.5, as written in the spec (`null` = not shown in that view). A muscle
 * that spans trunk segments is one `trunk` region, so it reads as one calm
 * shape (per-segment lenses read as blotches; review of 9 Oct 2026).
 */
const MAP_TEXT: Record<Exclude<Muscle, 'core'>, Row> = {
  abductors: { side: ['pelvis.face 0–0.95 c-0.05 w0.5'], front: ['pelvis.lat 0–0.9 d0.35'], back: ['pelvis.lat 0.1–1.0 d0.4'] },
  abs: { side: ['trunk.front 0.3–2.35 d0.45'], front: ['trunk.face 0.4–2.4 c0 w0.42'], back: null },
  adductors: { side: null, front: ['thigh.med 0.02–0.55 d0.55'], back: ['thigh.med 0.02–0.45 d0.5'] },
  biceps: { side: ['upperArm.front 0.30–0.88 d0.6'], front: ['upperArm.face 0.30–0.88 c-0.1 w0.6'], back: null },
  brachialis: { side: ['upperArm.face 0.60–0.95 c+0.35 w0.35'], front: ['upperArm.lat 0.60–0.95 d0.3'], back: null },
  calves: { side: ['shank.back 0.08–0.62 d0.7'], front: ['shank.med 0.10–0.50 d0.3', 'shank.lat 0.10–0.45 d0.25'], back: ['shank.face 0.05–0.65 c0 w0.85'] },
  chest: { side: ['thorax.front 0.42–0.86 d0.55'], front: ['thorax.face 0.50–0.88 ±c0.45 w0.55'], back: null },
  forearms: { side: ['forearm.face 0–0.65 c0 w0.8'], front: ['forearm.face 0–0.6 c0 w0.8'], back: ['forearm.face 0–0.6 c0 w0.8'] },
  front_delts: { side: ['upperArm.front -0.10–0.35 d0.7'], front: ['upperArm.face -0.10–0.35 c-0.3 w0.6'], back: null },
  glutes: { side: ['pelvis.back -0.65–0.75 d0.7'], front: null, back: ['pelvis.face -0.65–0.8 ±c0.45 w0.6'] },
  grip: {
    side: ['hand.full', 'forearm.front 0–0.45 d0.5'],
    front: ['hand.full', 'forearm.face 0–0.4 c0 w0.6'],
    back: ['hand.full', 'forearm.face 0–0.4 c0 w0.6'],
  },
  hamstrings: { side: ['thigh.back 0.08–0.88 d0.65'], front: null, back: ['thigh.face 0.10–0.88 c0 w0.7'] },
  lats: {
    side: ['trunk.back 1.45–2.78 d0.5'],
    front: ['thorax.lat 0.25–0.80 d0.25'],
    back: ['trunk.face 1.3–2.88 ±c0.3>0.6 w0.25>0.5'],
  },
  obliques: { side: ['trunk.face 0.6–2.3 c+0.1 w0.5'], front: ['trunk.lat 0.8–2.25 d0.35'], back: ['trunk.lat 0.8–2.25 d0.25'] },
  quads: { side: ['thigh.front 0.05–0.92 d0.75'], front: ['thigh.face 0.05–0.90 c+0.1 w0.7'], back: null },
  rear_delts: { side: ['upperArm.back -0.10–0.35 d0.7'], front: null, back: ['upperArm.face -0.10–0.35 c+0.3 w0.6'] },
  side_delts: { side: ['upperArm.face -0.12–0.40 c0 w0.7'], front: ['upperArm.lat -0.12–0.35 d0.6'], back: ['upperArm.lat -0.12–0.35 d0.6'] },
  spinal_erectors: { side: ['trunk.back 0.6–2.4 d0.4'], front: null, back: ['trunk.face 0.6–2.4 ±c0.2 w0.22'] },
  traps: {
    side: ['thorax.back 0.72–1 d0.55'],
    front: ['thorax.face 0.90–1.0 ±c0.55 w0.5'],
    back: ['thorax.face 0.55–1.0 c0 w0.3>0.7', 'neck.face 0–0.5 c0 w0.6'],
  },
  triceps: { side: ['upperArm.back 0.12–0.85 d0.7'], front: null, back: ['upperArm.face 0.10–0.85 c0 w0.75'] },
  upper_back: { side: ['thorax.back 0.58–0.95 d0.45'], front: null, back: ['thorax.face 0.55–0.95 c0 w0.5'] },
  upper_chest: { side: ['thorax.front 0.70–0.92 d0.45'], front: ['thorax.face 0.72–0.92 ±c0.45 w0.5'], back: null },
};

const join = (...cells: Cell[]): Cell => {
  const all = cells.flatMap((c) => c ?? []);
  return all.length === 0 ? null : all;
};

/**
 * `core`: from the side, one deep band down the front of the trunk (abs and
 * obliques as one calm shape; two overlapping shapes read as blotches). From
 * the front, abs + obliques; from behind, spinal erectors + obliques (§4.5).
 */
export const MUSCLE_REGION_TEXT: Record<Muscle, Row> = {
  ...MAP_TEXT,
  core: {
    side: ['trunk.front 0.4–2.4 d0.75'],
    front: join(MAP_TEXT.abs.front, MAP_TEXT.obliques.front),
    back: join(MAP_TEXT.spinal_erectors.back, MAP_TEXT.obliques.back),
  },
};

const parseCell = (cell: Cell): readonly RegionSpec[] | null => (cell === null ? null : cell.map(parseRegion).filter((r): r is RegionSpec => r !== null));

/** §4.5 as typed regions, keyed by the `Muscle` vocabulary. A test fails on a missing muscle or an unparsable cell. */
export const MUSCLE_REGION_MAP: Record<Muscle, Record<FocusView, readonly RegionSpec[] | null>> = Object.fromEntries(
  MUSCLES.map((m) => {
    const row = MUSCLE_REGION_TEXT[m];
    return [m, { side: parseCell(row.side), front: parseCell(row.front), back: parseCell(row.back) }];
  }),
) as Record<Muscle, Record<FocusView, readonly RegionSpec[] | null>>;

/** Largest change `focus.adjust` may make to any mapped number (§4.8). */
export const MAX_ADJUST = 0.25;

/** A mapped region with `focus.adjust` applied. */
export function adjustRegion(spec: RegionSpec, adj: RegionAdjust): RegionSpec {
  if (spec.kind === 'hand') return spec;
  const s = adj.s ?? spec.s;
  if (spec.kind === 'edge') return { ...spec, s, d: adj.d ?? spec.d };
  return { ...spec, s, c: adj.c === undefined ? spec.c : [adj.c, adj.c], w: adj.w === undefined ? spec.w : [adj.w, adj.w] };
}

/** Problems with an adjust (numbers moved more than `MAX_ADJUST`, or fields the region doesn't have). */
export function adjustProblems(spec: RegionSpec, adj: RegionAdjust): string[] {
  const out: string[] = [];
  const far = (a: number, b: number): boolean => Math.abs(a - b) > MAX_ADJUST + 1e-9;
  if (spec.kind === 'hand') return Object.keys(adj).length > 0 ? ['hand regions have nothing to adjust'] : [];
  if (adj.s && (far(adj.s[0], spec.s[0]) || far(adj.s[1], spec.s[1]))) out.push('s moves more than 0.25');
  if (adj.s && !(adj.s[0] < adj.s[1])) out.push('s must run low to high');
  if (adj.s && adj.s.some((x) => x < -1 || x > regionMaxS(spec.seg))) out.push(`s must stay within −1…${regionMaxS(spec.seg)} on ${spec.seg}`);
  if (spec.kind === 'edge') {
    if (adj.c !== undefined || adj.w !== undefined) out.push('an edge band has no c or w');
    if (adj.d !== undefined && far(adj.d, spec.d)) out.push('d moves more than 0.25');
  } else {
    if (adj.d !== undefined) out.push('a face region has no d');
    if (adj.c !== undefined && (far(adj.c, spec.c[0]) || far(adj.c, spec.c[1]))) out.push('c moves more than 0.25');
    if (adj.w !== undefined && (far(adj.w, spec.w[0]) || far(adj.w, spec.w[1]))) out.push('w moves more than 0.25');
  }
  return out;
}

/** Muscles a figure is given: the catalogue entry's lists (unknown names are ignored). */
export interface MuscleInput {
  primary: readonly string[];
  secondary: readonly string[];
}

export interface FocusRegion {
  muscle: Muscle;
  level: MuscleLevel;
  spec: RegionSpec;
}

export interface ResolvedFocus {
  view: FocusView;
  /** Which limbs carry colour. */
  side: 'near' | 'far' | 'both';
  /** The entry's primary muscles, as listed, drawn or not (§4.7: the text always names them). */
  strong: Muscle[];
  /** The entry's secondary muscles, as listed, drawn or not. */
  soft: Muscle[];
  /** Listed muscles with at least one region in this view. */
  drawn: Muscle[];
  /** Listed muscles not coloured: the view can't show them, or the guide hides them (§4.7), in listed order. */
  notShown: Muscle[];
  regions: FocusRegion[];
}

const known = (xs: readonly string[]): Muscle[] => [...new Set(xs.filter((x): x is Muscle => (MUSCLES as readonly string[]).includes(x)))];

/**
 * Applies §4.3–4.8: strong = primary, soft = secondary (every listed muscle
 * stays in its list, §4.7), `grip` drawn at soft at most, the `core` expansion
 * (already in the map), the guide's `hide`/`adjust`/`add` overrides, and which
 * muscles aren't coloured (`notShown`: no region in this view, or hidden).
 * Overrides naming a muscle the entry doesn't list are ignored here (and fail
 * `guide:check`), so the figure never shows a muscle the text doesn't name.
 */
export function resolveFocus(muscles: MuscleInput, focus: GuideFocus | undefined, view: FocusView): ResolvedFocus {
  const primary = known(muscles.primary);
  const secondary = known(muscles.secondary).filter((m) => !primary.includes(m));
  const hidden = new Set<Muscle>(focus?.hide ?? []);
  const regions: FocusRegion[] = [];
  const drawn: Muscle[] = [];
  const notShown: Muscle[] = [];
  for (const m of [...primary, ...secondary]) {
    if (hidden.has(m)) {
      notShown.push(m);
      continue;
    }
    const level: MuscleLevel = primary.includes(m) && m !== 'grip' ? 'strong' : 'soft';
    const mapped = [...(MUSCLE_REGION_MAP[m][view] ?? [])];
    const adj = focus?.adjust?.[m];
    const first = mapped[0];
    if (adj !== undefined && first !== undefined && adjustProblems(first, adj).length === 0) mapped[0] = adjustRegion(first, adj);
    for (const a of focus?.add ?? []) {
      if (a.muscle !== m) continue;
      const spec = parseRegion(a.region);
      if (spec !== null) mapped.push(spec);
    }
    if (mapped.length === 0) notShown.push(m);
    else {
      drawn.push(m);
      for (const spec of mapped) regions.push({ muscle: m, level, spec });
    }
  }
  const side = focus?.side ?? (view === 'side' ? 'near' : 'both');
  return { view, side, strong: primary, soft: secondary, drawn, notShown, regions };
}

/** The focus view of a guide: side, or front/back for a front-view guide. */
export function focusViewOf(guide: { view: 'side' | 'front'; seenFrom?: 'front' | 'back' | undefined }): FocusView {
  return guide.view === 'side' ? 'side' : (guide.seenFrom ?? 'front');
}
