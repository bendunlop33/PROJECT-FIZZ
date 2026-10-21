import { slotsOf, workingCount } from '@fizz/domain';
import type { BuilderGroup } from '@fizz/schemas';

import type { BuilderSnapshot } from './builder-service';
import type { CoachBarStatus } from './builder-view';

/**
 * Coach review on Your workout (workout-builder-v3 §2.9). The coach stream
 * supplies the content through an injected `BuilderReviewProvider` (verdict,
 * suggestions, `For next <day> day` notes, all fact-checked there); this
 * stream renders it. With no provider, a failed review, or the coach
 * offline or not connected, the sheet shows only what code counts (sets
 * per group, the compound/isolation mix) and the honest status word: no
 * verdict, no suggestions, no notes, never a canned reply (rule 1).
 * `Reviewing…` shows only while a review call is in flight (review B5).
 */

/** `failed`: connected, but the review call didn't give a usable answer; shown as `Not reviewed` (rule 1: never `Coach not connected`). */
export type BuilderReviewStatus = 'reviewed' | 'reviewing' | 'not_reviewed' | 'failed' | 'offline' | 'not_connected';

/** Why there is no coach review (behind `Why?`). */
export const REVIEW_WHY = {
  unavailable: 'Coach review isn’t available in this build.',
  failed: 'The coach didn’t answer. Try again later.',
} as const;

/** One suggestion or `Add back` / `Update plan day` line: a proposal with its own button (Undo after). */
export interface BuilderReviewAction {
  id: string;
  text: string;
  /** The one-line reason under it. */
  reason: string | null;
  /** `Swap`, `Add`, `Update`. */
  apply: string;
  /** Refused because an exercise it touches changed (`Out of date`). */
  outOfDate?: true;
}

/** The review as the sheet renders it. Counts, variety and the Plan section are code's; verdict, suggestions and notes the coach's. */
export interface BuilderReview {
  status: BuilderReviewStatus;
  verdict: string | null;
  counts: { group: string; sets: number; trained: boolean }[];
  variety: string | null;
  plan: { title: string; lines: { ok: boolean; text: string }[]; actions: BuilderReviewAction[] } | null;
  suggestions: BuilderReviewAction[];
  /** `For next Chest day`: ticked by default, saved on Done (Your data). */
  nextNotes: { id: string; text: string; ticked: boolean }[];
  nextNotesTitle: string | null;
  /** `Not reviewed`: the reason, behind `Why?`. */
  whyNot?: string | null;
}

export interface BuilderReviewProvider {
  review: (draftId: string, signal?: AbortSignal) => Promise<BuilderReview>;
  apply: (draftId: string, actionId: string, opId: string) => Promise<{ ok: true; undoOpId: string | null } | { ok: false; message: string }>;
  /** Done (or swipe down): the ticked notes are saved. `notSaved`: the note IDs that failed (`Not saved`). */
  saveNotes: (draftId: string, noteIds: readonly string[], opId: string) => Promise<{ ok: boolean; saved?: number; notSaved?: string[] }>;
}

let provider: BuilderReviewProvider | null = null;

/** Registered at app start (`createBuilderReviewProvider`, the coach's review). Null: the code-only review with an honest status. */
export function setBuilderReviewProvider(p: BuilderReviewProvider | null): void {
  provider = p;
}

export function builderReviewProvider(): BuilderReviewProvider | null {
  return provider;
}

const CORE: readonly BuilderGroup[] = ['Chest', 'Back', 'Shoulders', 'Legs', 'Biceps', 'Triceps', 'Abs'];

/**
 * The status a review opens with: the coach's own state when it isn't
 * connected; `not_reviewed` with no provider (nothing will arrive); else
 * `reviewing` while the call runs.
 */
export function reviewStartStatus(coach: CoachBarStatus, hasProvider: boolean): BuilderReviewStatus {
  if (coach !== 'ok') return coach;
  return hasProvider ? 'reviewing' : 'not_reviewed';
}

/**
 * Coach review on Your workout: the code-only facts at once, then the
 * provider's review. A missing provider or a failed call ends `Not
 * reviewed`, never a status that suggests a review is coming (rule 1).
 */
export async function runReview(snap: BuilderSnapshot, coach: CoachBarStatus, provider: BuilderReviewProvider | null, show: (r: BuilderReview) => void): Promise<BuilderReview> {
  const status = reviewStartStatus(coach, provider !== null);
  const facts = { ...reviewFacts(snap, status), ...(status === 'not_reviewed' ? { whyNot: REVIEW_WHY.unavailable } : {}) };
  show(facts);
  if (provider === null) return facts;
  // The provider is asked offline too: its counts (per muscle focus) and Plan section (with `Add back`) are code's
  // and need no coach; with no coach it returns no verdict, suggestions or notes (§2.9, rule 1).
  const r = await provider.review(snap.draftId).catch(() => null);
  const out: BuilderReview = r === null ? { ...facts, status: 'failed', whyNot: REVIEW_WHY.failed } : r.status === 'failed' ? { ...r, whyNot: r.whyNot ?? REVIEW_WHY.failed } : r;
  show(out);
  return out;
}

/** What code counts for the review (§2.9): working sets per group in this workout, and the mix. */
export function reviewFacts(snap: BuilderSnapshot, status: BuilderReviewStatus): BuilderReview {
  const sets = new Map<BuilderGroup, number>();
  let compound = 0;
  let isolation = 0;
  for (const s of slotsOf(snap.workout.blocks)) {
    const f = snap.facts[s.exerciseId];
    if (f?.group != null) sets.set(f.group, (sets.get(f.group) ?? 0) + workingCount(s));
    if (f?.compound === true) compound += 1;
    else isolation += 1;
  }
  const dayGroups = snap.setup.groups.map((g) => g.group);
  // The day's groups in Set up order, then any other group the workout trains.
  const shown = [...dayGroups, ...CORE.filter((g) => sets.has(g) && !dayGroups.includes(g))];
  return {
    status,
    verdict: null,
    counts: shown.map((g) => ({ group: g, sets: sets.get(g) ?? 0, trained: (sets.get(g) ?? 0) > 0 })),
    variety: compound + isolation === 0 ? null : `${String(compound)} compound · ${String(isolation)} isolation`,
    plan: null,
    suggestions: [],
    nextNotes: [],
    nextNotesTitle: null,
  };
}

/** The sheet's header word (§2.9): `● Coach`, `Reviewing…`, `Not reviewed`, `Offline`, `Coach not connected`. */
export function reviewHeaderWord(s: BuilderReviewStatus): string {
  switch (s) {
    case 'reviewed':
      return '● Coach';
    case 'reviewing':
      return 'Reviewing…';
    case 'not_reviewed':
    case 'failed':
      return 'Not reviewed';
    case 'offline':
      return 'Offline';
    case 'not_connected':
      return 'Coach not connected';
  }
}

/** One count chip: `✓ Chest 6` trained, `· Abs` missing (icon plus text, not colour alone). */
export function countText(c: BuilderReview['counts'][number]): string {
  return c.trained ? `✓ ${c.group} ${String(c.sets)}` : `· ${c.group}`;
}

/**
 * The sheet after Apply on one of its actions: an applied one goes (the others stay usable, §2.9); one refused as
 * out of date says so (`Out of date`) and stays.
 */
export function reviewAfterApply(r: BuilderReview, actionId: string, ok: boolean): BuilderReview {
  const mark = (a: BuilderReviewAction): BuilderReviewAction => (a.id === actionId ? { ...a, outOfDate: true } : a);
  const keep = (a: BuilderReviewAction): boolean => a.id !== actionId;
  return {
    ...r,
    suggestions: ok ? r.suggestions.filter(keep) : r.suggestions.map(mark),
    plan: r.plan === null ? null : { ...r.plan, actions: ok ? r.plan.actions.filter(keep) : r.plan.actions.map(mark) },
  };
}
