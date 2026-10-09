/**
 * The "How to" view of an exercise (ADR 0013): animated guide, key positions,
 * cues and common mistakes, all from the bundled catalogue (Coaching
 * knowledge, CLAUDE.md rule 10; nothing here is about Ben). Pure: screens
 * render the result and never read catalogue files themselves.
 */
import {
  bundledGuides,
  catalogueExerciseId,
  lazyBundledCatalogue,
  MUSCLE_TO_GROUP,
  type GuideLibrary,
  type LazyCatalogue,
  type LoadedGuide,
} from '@fizz/catalogue';
import { keyFrameStops, type KeyFrameStop } from '@fizz/catalogue/figure';

export interface HowToSources {
  catalogue: LazyCatalogue;
  guides: GuideLibrary;
}

let bundled: HowToSources | undefined;

/** The shipped catalogue and guides (memoised, so per-sources caches persist). */
export function bundledHowToSources(): HowToSources {
  bundled ??= { catalogue: lazyBundledCatalogue(), guides: bundledGuides() };
  return bundled;
}

export const DRAFT_GUIDE_LABEL = 'Draft guide';

/** Every guide shows `Draft guide` until Ben approves it (research §5.6); `checked` is still a draft to him. */
export function guideDraftLabel(status: LoadedGuide['guide']['review']['status']): string | null {
  return status === 'approved' ? null : DRAFT_GUIDE_LABEL;
}

/**
 * Whether there is anything to show: a bundled guide, or a rich entry's
 * cues. Cheap (no validation), so the picker can ask for every row.
 */
export function hasHowTo(catalogueKey: string | null | undefined, src: HowToSources): boolean {
  if (catalogueKey === null || catalogueKey === undefined) return false;
  return src.guides.keys.has(catalogueKey) || src.catalogue.tierHint(catalogueKey) === 'rich';
}

const idMaps = new WeakMap<HowToSources, Map<string, string>>();

/**
 * The catalogue key behind an exercise ID, among exercises that have a
 * how-to (catalogue IDs are UUIDv5 of the key, ADR 0011). Only those few
 * keys are hashed, once per sources object.
 */
export function howToKeyForExerciseId(exerciseId: string, src: HowToSources): string | null {
  let map = idMaps.get(src);
  if (map === undefined) {
    map = new Map();
    const keys = new Set([...src.guides.keys, ...[...src.catalogue.keys].filter((k) => src.catalogue.tierHint(k) === 'rich')]);
    for (const key of keys) map.set(catalogueExerciseId(key), key);
    idMaps.set(src, map);
  }
  return map.get(exerciseId) ?? null;
}

export interface HowToGuide {
  loaded: LoadedGuide;
  /** `Draft guide` until Ben approves this guide. */
  draftLabel: string | null;
  /** The player's single VoiceOver label: what the movement looks like. */
  accessibilityLabel: string;
  /** Key positions, also the Reduce Motion frames. */
  stops: KeyFrameStop[];
}

export interface HowToView {
  title: string;
  /** `Main muscles: Quads · Glutes` (filter-group words). */
  muscles: string | null;
  guide: HowToGuide | null;
  setup: readonly string[];
  execution: readonly string[];
  mistakes: readonly string[];
  /** An honest line when something is missing or couldn't be read. */
  notice: string | null;
}

export function buildHowToView(input: { name: string; catalogueKey: string | null }, src: HowToSources): HowToView {
  const key = input.catalogueKey;
  const entryLoad = key === null ? null : src.catalogue.entry(key);
  const entry = entryLoad?.ok === true ? entryLoad.entry : null;
  const title = entry?.name ?? input.name;
  const guideLoad = key !== null && src.guides.keys.has(key) ? src.guides.load(key) : null;

  let guide: HowToGuide | null = null;
  if (guideLoad?.ok === true) {
    const g = guideLoad.value.guide;
    guide = {
      loaded: guideLoad.value,
      draftLabel: guideDraftLabel(g.review.status),
      accessibilityLabel: `Animated guide for ${title}. ${g.a11y.summary}`,
      stops: keyFrameStops(guideLoad.value.prepared),
    };
  }

  const rich = entry?.tier === 'rich' ? entry : null;
  const muscles = entry ? [...new Set(entry.primaryMuscles.map((m) => MUSCLE_TO_GROUP[m]))].join(' · ') : '';

  let notice: string | null = null;
  if (entryLoad?.ok === false && entryLoad.reason === 'invalid') notice = `Couldn’t read the how-to for ${title}.`;
  else if (guideLoad?.ok === false) notice = rich ? `The animated guide for ${title} couldn’t be read. The cues below still apply.` : `Couldn’t read the how-to for ${title}.`;
  else if (!guide && !rich) notice = `No how-to for ${title} yet.`;

  return {
    title,
    muscles: muscles === '' ? null : `Main muscles: ${muscles}`,
    guide,
    setup: rich?.cues.setup ?? [],
    execution: rich?.cues.execution ?? [],
    mistakes: rich?.cues.faults ?? [],
    notice,
  };
}

/** How to's player region and notices once the player's fate is known. */
export interface HowToLayout {
  /** Show the guide player (there is a guide and it hasn't failed). */
  showPlayer: boolean;
  /** Honest one-line notices, in order, above the cues. */
  notices: string[];
}

/**
 * `playerFailed`: Skia couldn't load, the player threw while rendering, or a
 * bake task threw (review S1). The screen then drops the player and keeps
 * everything else, with one line saying so. Never a blank screen, never a crash.
 */
export function howToLayout(view: HowToView, playerFailed: boolean): HowToLayout {
  const notices = view.notice === null ? [] : [view.notice];
  if (view.guide === null) return { showPlayer: false, notices };
  if (!playerFailed) return { showPlayer: true, notices };
  const hasText = view.guide.stops.length > 0 || view.setup.length > 0 || view.execution.length > 0 || view.mistakes.length > 0;
  const failure = hasText ? 'The animated guide couldn’t be shown. The cues below still apply.' : 'The animated guide couldn’t be shown.';
  return { showPlayer: false, notices: [failure, ...notices] };
}
