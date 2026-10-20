import { slotsOf, workingCount } from '@fizz/domain';
import type { BuilderGroup } from '@fizz/schemas';

import type { BuilderSnapshot } from './builder-service';
import type { CoachBarStatus } from './builder-view';

/**
 * Coach review on Your workout (workout-builder-v3 §2.9). The coach stream
 * supplies the content through an injected `BuilderReviewProvider` (verdict,
 * suggestions, `For next <day> day` notes, all fact-checked there); this
 * stream renders it. With no provider, or the coach offline or not
 * connected, the sheet shows only what code counts (sets per group, the
 * compound/isolation mix) and the honest status word: no verdict, no
 * suggestions, no notes, never a canned reply (rule 1).
 */

export type BuilderReviewStatus = 'reviewed' | 'pending' | 'offline' | 'not_connected';

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
}

export interface BuilderReviewProvider {
  review: (draftId: string, signal?: AbortSignal) => Promise<BuilderReview>;
  apply: (draftId: string, actionId: string, opId: string) => Promise<{ ok: true; undoOpId: string | null } | { ok: false; message: string }>;
  /** Done (or swipe down): the ticked notes are saved. */
  saveNotes: (draftId: string, noteIds: readonly string[], opId: string) => Promise<{ ok: boolean }>;
}

let provider: BuilderReviewProvider | null = null;

/** Wired by the coach stream at merge. Null: the code-only review with an honest status. */
export function setBuilderReviewProvider(p: BuilderReviewProvider | null): void {
  provider = p;
}

export function builderReviewProvider(): BuilderReviewProvider | null {
  return provider;
}

const CORE: readonly BuilderGroup[] = ['Chest', 'Back', 'Shoulders', 'Legs', 'Biceps', 'Triceps', 'Abs'];

/** What code counts for the review (§2.9): working sets per group in this workout, and the mix. */
export function reviewFacts(snap: BuilderSnapshot, status: CoachBarStatus): BuilderReview {
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
    status: status === 'ok' ? 'pending' : status,
    verdict: null,
    counts: shown.map((g) => ({ group: g, sets: sets.get(g) ?? 0, trained: (sets.get(g) ?? 0) > 0 })),
    variety: compound + isolation === 0 ? null : `${String(compound)} compound · ${String(isolation)} isolation`,
    plan: null,
    suggestions: [],
    nextNotes: [],
    nextNotesTitle: null,
  };
}

/** The sheet's header word (§2.9): `● Coach`, `Offline`, `Coach not connected`. */
export function reviewHeaderWord(s: BuilderReviewStatus): string {
  switch (s) {
    case 'reviewed':
    case 'pending':
      return '● Coach';
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
