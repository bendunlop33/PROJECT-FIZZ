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
/** On the text sections when no guide player is showing (spec §8.9 P5). */
export const DRAFT_TEXT_LABEL = 'Draft';

type ReviewStatus = LoadedGuide['guide']['review']['status'];

/**
 * `Draft guide` until Ben approves the guide **and** its catalogue entry
 * (research §5.6, spec §8.9 P5); `checked` is still a draft to him. Pass
 * `entryStatus: null` when no entry was read (nothing of it is shown).
 */
export function guideDraftLabel(guideStatus: ReviewStatus, entryStatus: ReviewStatus | null = null): string | null {
  return guideStatus === 'approved' && (entryStatus === null || entryStatus === 'approved') ? null : DRAFT_GUIDE_LABEL;
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
  /** `Draft guide` until Ben approves this guide and its catalogue entry. */
  draftLabel: string | null;
  /** The player's single VoiceOver label, the same for the animation and the still view (P4). */
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
  /** The entry's safety notes and `Stop the set if:` lines (P1). Reference text; never a diagnosis (rule 9). */
  safety: { notes: readonly string[]; stopIf: readonly string[] };
  /** `Draft` for the text sections when they are shown without the player's `Draft guide` tag (P5). */
  textDraftLabel: string | null;
  /** The catalogue entry exists but failed validation (its cues aren't shown). */
  entryUnreadable: boolean;
  /** An honest line when something is missing or couldn't be read. */
  notice: string | null;
}

export function buildHowToView(input: { name: string; catalogueKey: string | null }, src: HowToSources): HowToView {
  const key = input.catalogueKey;
  const entryLoad = key === null ? null : src.catalogue.entry(key);
  const entry = entryLoad?.ok === true ? entryLoad.entry : null;
  const entryUnreadable = entryLoad?.ok === false && entryLoad.reason === 'invalid';
  const title = entry?.name ?? input.name;
  const guideLoad = key !== null && src.guides.keys.has(key) ? src.guides.load(key) : null;
  // A basic entry may have no review block: it isn't approved either.
  const entryStatus: ReviewStatus | null = entry === null ? null : (entry.review?.status ?? 'draft');

  let guide: HowToGuide | null = null;
  if (guideLoad?.ok === true) {
    const g = guideLoad.value.guide;
    guide = {
      loaded: guideLoad.value,
      draftLabel: guideDraftLabel(g.review.status, entryStatus),
      accessibilityLabel: `Exercise guide for ${title}. ${g.a11y.summary}`,
      stops: keyFrameStops(guideLoad.value.prepared),
    };
  }

  const rich = entry?.tier === 'rich' ? entry : null;
  const muscles = entry ? [...new Set(entry.primaryMuscles.map((m) => MUSCLE_TO_GROUP[m]))].join(' · ') : '';

  let notice: string | null = null;
  if (entryUnreadable) notice = guide ? `Couldn’t read the cues for ${title}. The guide above still applies.` : `Couldn’t read the how-to for ${title}.`;
  else if (guideLoad?.ok === false) notice = rich ? `The animated guide for ${title} couldn’t be read. The cues below still apply.` : `Couldn’t read the how-to for ${title}.`;
  else if (!guide && !rich) notice = `No how-to for ${title} yet.`;

  // Text shown without the player: the key positions (from the guide) and the entry's cues.
  const textDraft = (guide !== null && guide.draftLabel !== null && guide.stops.length > 0) || (rich !== null && rich.review.status !== 'approved');

  return {
    title,
    muscles: muscles === '' ? null : `Main muscles: ${muscles}`,
    guide,
    setup: rich?.cues.setup ?? [],
    execution: rich?.cues.execution ?? [],
    mistakes: rich?.cues.faults ?? [],
    safety: { notes: rich?.safety.notes ?? [], stopIf: rich?.safety.stopIf ?? [] },
    textDraftLabel: textDraft ? DRAFT_TEXT_LABEL : null,
    entryUnreadable,
    notice,
  };
}

/** How to's player region and notices once the player's fate is known. */
export interface HowToLayout {
  /** Show the guide player (there is a guide and it hasn't failed). */
  showPlayer: boolean;
  /** Honest one-line notices, in order, above the text sections. */
  notices: string[];
  /** `Draft` above the text sections; null while the player shows `Draft guide` itself. */
  textDraftLabel: string | null;
}

/**
 * `playerFailed`: Skia couldn't load, the player threw while rendering, or a
 * bake task threw (review S1). The screen then drops the player and keeps
 * everything else, with one line saying so. Never a blank screen, never a crash.
 */
export function howToLayout(view: HowToView, playerFailed: boolean): HowToLayout {
  const notices = view.notice === null ? [] : [view.notice];
  if (view.guide === null) return { showPlayer: false, notices, textDraftLabel: view.textDraftLabel };
  if (!playerFailed) return { showPlayer: true, notices, textDraftLabel: null };
  const stops = view.guide.stops.length > 0;
  let failure: string;
  if (view.entryUnreadable) {
    // The entry notice says "the guide above still applies"; with no player that's no longer true.
    failure = stops ? `The animated guide couldn’t be shown and the cues for ${view.title} couldn’t be read. The key positions below still apply.` : `Couldn’t read the how-to for ${view.title}.`;
    return { showPlayer: false, notices: [failure], textDraftLabel: view.textDraftLabel };
  }
  const hasText = stops || view.setup.length > 0 || view.execution.length > 0 || view.mistakes.length > 0 || view.safety.notes.length > 0;
  failure = hasText ? 'The animated guide couldn’t be shown. The cues below still apply.' : 'The animated guide couldn’t be shown.';
  return { showPlayer: false, notices: [failure, ...notices], textDraftLabel: view.textDraftLabel };
}
