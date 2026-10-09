/**
 * Muscle names for How to (guides v2 §5.3) and the muscle focus of an entry
 * and its guide (§4). Plain words first, the gym term in brackets, so Ben
 * reads "front of thighs (quads)". Pure; Coaching knowledge only.
 *
 * The Muscle filter chips keep their group words (`MUSCLE_TO_GROUP`); this
 * table is for How to only.
 */
import type { CatalogueEntry } from './entry-schema';
import type { Guide } from './figure/guide-schema';
import { focusViewOf, resolveFocus, type FocusView, type MuscleDefinition } from './figure/muscle-map';
import type { Muscle } from './vocab';

/** Plain phrase and gym term (null when they are the same word). */
export const MUSCLE_PLAIN: Record<Muscle, { plain: string; term: string | null }> = {
  abductors: { plain: 'outer hips', term: 'abductors' },
  abs: { plain: 'abs', term: null },
  adductors: { plain: 'inner thighs', term: 'adductors' },
  biceps: { plain: 'front of upper arms', term: 'biceps' },
  brachialis: { plain: 'front of upper arms', term: 'brachialis' },
  calves: { plain: 'calves', term: null },
  chest: { plain: 'chest', term: null },
  core: { plain: 'core', term: null },
  forearms: { plain: 'forearms', term: null },
  front_delts: { plain: 'front of shoulders', term: 'front delts' },
  glutes: { plain: 'glutes', term: null },
  grip: { plain: 'grip', term: null },
  hamstrings: { plain: 'back of thighs', term: 'hamstrings' },
  lats: { plain: 'sides of upper back', term: 'lats' },
  obliques: { plain: 'sides of waist', term: 'obliques' },
  quads: { plain: 'front of thighs', term: 'quads' },
  rear_delts: { plain: 'back of shoulders', term: 'rear delts' },
  side_delts: { plain: 'side of shoulders', term: 'side delts' },
  spinal_erectors: { plain: 'lower back', term: 'spinal erectors' },
  traps: { plain: 'top of shoulders', term: 'traps' },
  triceps: { plain: 'back of upper arms', term: 'triceps' },
  upper_back: { plain: 'upper back', term: null },
  upper_chest: { plain: 'upper chest', term: null },
};

/** `front of thighs (quads)` — the In lists column of §5.3. */
export function musclePlainLabel(m: Muscle): string {
  const p = MUSCLE_PLAIN[m];
  return p.term === null ? p.plain : `${p.plain} (${p.term})`;
}

/** `front of thighs` — the Short column (the Not shown line). */
export function muscleShortLabel(m: Muscle): string {
  return MUSCLE_PLAIN[m].plain;
}

const capitalise = (s: string): string => (s === '' ? s : s.charAt(0).toUpperCase() + s.slice(1));

/** Muscles sharing a plain phrase merge: `front of upper arms (biceps, brachialis)`. */
function mergedItems(ms: readonly Muscle[], short: boolean): { plain: string; terms: string[] }[] {
  const items: { plain: string; terms: string[] }[] = [];
  for (const m of ms) {
    const p = MUSCLE_PLAIN[m];
    let item = items.find((i) => i.plain === p.plain);
    if (item === undefined) {
      item = { plain: p.plain, terms: [] };
      items.push(item);
    }
    if (!short && p.term !== null && !item.terms.includes(p.term)) item.terms.push(p.term);
  }
  return items;
}

/** `Front of thighs (quads), glutes`: first item capitalised, the rest lower case. */
export function formatMuscleList(ms: readonly Muscle[], opts: { short?: boolean } = {}): string {
  const text = mergedItems(ms, opts.short === true)
    .map((i) => (i.terms.length > 0 ? `${i.plain} (${i.terms.join(', ')})` : i.plain))
    .join(', ');
  return capitalise(text);
}

/** VoiceOver wording: `front of thighs, quads, and glutes` (no brackets read out). */
export function spokenMuscleList(ms: readonly Muscle[], opts: { short?: boolean } = {}): string {
  const parts = mergedItems(ms, opts.short === true).map((i) => [i.plain, ...i.terms].join(', '));
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1] ?? ''}`;
}

export interface MuscleFocus {
  /** The guide's view (null: no guide, nothing drawn). */
  view: FocusView | null;
  /** Primary muscles as listed, drawn or not (`Feel it most`). */
  strong: Muscle[];
  /** Secondary muscles as listed, drawn or not (`Also works`). */
  soft: Muscle[];
  /** Listed muscles coloured on the figure. */
  drawn: Muscle[];
  /** Listed muscles not coloured: the view can't show them, or the guide hides them. Also stay in `strong`/`soft`. */
  notShown: Muscle[];
  side: 'near' | 'far' | 'both';
  workPhase: readonly { from: number; to: number }[] | null;
}

/**
 * The muscle focus of an entry and its guide (§4.1, §11). The muscles come
 * from the catalogue entry only; the guide decides what its view can show.
 * Every listed muscle stays in its text list (§4.7), drawn or not; the ones
 * not coloured are also in `notShown`. Without a guide nothing is drawn and
 * every muscle is still listed.
 */
export function muscleFocusFor(entry: Pick<CatalogueEntry, 'primaryMuscles' | 'secondaryMuscles'>, guide: Pick<Guide, 'view' | 'seenFrom' | 'focus'> | null): MuscleFocus {
  const muscles = { primary: entry.primaryMuscles, secondary: entry.secondaryMuscles };
  if (guide === null) {
    const r = resolveFocus(muscles, undefined, 'side');
    return { view: null, strong: r.strong, soft: r.soft, drawn: [], notShown: [], side: 'near', workPhase: null };
  }
  const view = focusViewOf(guide);
  const r = resolveFocus(muscles, guide.focus, view);
  return { view, strong: r.strong, soft: r.soft, drawn: r.drawn, notShown: r.notShown, side: r.side, workPhase: guide.focus?.workPhase ?? null };
}

/** One legend line (§5.3, design-system §9.58). */
export interface LegendLine {
  /** `definition`: the tint-only line for faint violet muscle groups (§4.11.8). */
  kind: 'most' | 'also' | 'definition' | 'notShown';
  label: string;
  list: string;
  /** Show the ● / ◐ swatch: at least one muscle on this line is drawn. Never for `notShown`. */
  swatch: boolean;
  /** One VoiceOver element per line. */
  accessibilityLabel: string;
}

const NOT_SHOWN_LABEL: Record<FocusView, string> = {
  side: 'Not shown from this side:',
  front: 'Not shown from the front:',
  back: 'Not shown from behind:',
};

/**
 * Muscle definition's tint-only legend line (guides v2 §4.11.8). Faint groups
 * are "other muscles", never inactive, unused or resting: the catalogue
 * doesn't say how much they work (rule 6). Neutral definition has no line.
 */
export const DEFINITION_TINT_LEGEND = { label: 'Faint violet:', list: 'other muscles, for reference' } as const;

/**
 * `Feel it most:` (every primary) / `Also works:` (every secondary) /
 * `Faint violet:` (only while `tint` definition is drawn; pass the effective
 * mode) / `Not shown from this side:` (the listed muscles not coloured, which
 * also stay on their own line); empty when the entry lists no muscles.
 */
export function muscleLegend(focus: MuscleFocus, opts: { notShown?: boolean; definition?: MuscleDefinition } = {}): LegendLine[] {
  const lines: LegendLine[] = [];
  const drawn = new Set(focus.drawn);
  if (focus.strong.length > 0) {
    lines.push({ kind: 'most', label: 'Feel it most:', list: formatMuscleList(focus.strong), swatch: focus.strong.some((m) => drawn.has(m)), accessibilityLabel: `Feel it most: ${spokenMuscleList(focus.strong)}.` });
  }
  if (focus.soft.length > 0) {
    lines.push({ kind: 'also', label: 'Also works:', list: formatMuscleList(focus.soft), swatch: focus.soft.some((m) => drawn.has(m)), accessibilityLabel: `Also works: ${spokenMuscleList(focus.soft)}.` });
  }
  // Tint draws only with a guide and the entry's muscles, so the line never explains violet that isn't there.
  if (opts.definition === 'tint' && focus.view !== null && lines.length > 0) {
    const { label, list } = DEFINITION_TINT_LEGEND;
    lines.push({ kind: 'definition', label, list, swatch: false, accessibilityLabel: `${label} ${list}.` });
  }
  if (opts.notShown !== false && focus.view !== null && focus.notShown.length > 0) {
    const label = NOT_SHOWN_LABEL[focus.view];
    const list = formatMuscleList(focus.notShown, { short: true }).toLowerCase();
    lines.push({ kind: 'notShown', label, list, swatch: false, accessibilityLabel: `${label} ${spokenMuscleList(focus.notShown, { short: true })}.` });
  }
  return lines;
}
