import { MAIN_SWAP_COPY } from '@fizz/domain';

/**
 * The Swap / Add sheet's sections (workout-builder-v3 §2.5), shared by the
 * builder and the active workout (workout-table-v3 §7): the exercises of one
 * muscle group this gym has, by focus, each with its works line. No est. max.
 */
export interface ChoiceSection {
  focus: string;
  items: ChoiceItem[];
}

export interface ChoiceItem {
  exerciseId: string;
  name: string;
  works: string | null;
  mayHurt: boolean;
  /** (Rule 9) The flag behind `May hurt`, as the confirm says it: `Shoulder pain flagged 6 Oct.`; null: none or not known. */
  painLine?: string | null;
  /** (Ben, 23 Oct) A near-duplicate of this exercise in the workout (`Barbell shrug`): listed last, `Like Barbell shrug`. */
  similarTo?: string | null;
}

/** The row's second line: `Like Barbell shrug` for a near-duplicate, else the works line. */
export function choiceLine(item: Pick<ChoiceItem, 'works' | 'similarTo'>): string | null {
  return item.similarTo == null ? item.works : `Like ${item.similarTo}`;
}

/** (Ben, 25 Oct) The heading over the ranked suggestions, above the full list. */
export const SWAP_SHEET_COPY = { suggested: 'Suggested' } as const;

/**
 * (Ben, 27 Oct; redesign §E3) Swapping the main lift: the plan's main-lift alternatives (`mainLiftFirst`'s first
 * section, `Main lift`) sit at the very top, before `Recent` and `Suggested`; the rest as ranked. Pure.
 */
export function mainLiftSection(sections: readonly ChoiceSection[]): { main: ChoiceSection | null; rest: ChoiceSection[] } {
  const first = sections[0];
  if (first === undefined || first.focus !== MAIN_SWAP_COPY.heading) return { main: null, rest: [...sections] };
  return { main: first, rest: sections.slice(1) };
}

export const SWAP_PAIN_COPY = {
  cancel: 'Choose another',
  anyway: (actionWord: string) => `${actionWord} anyway`,
  title: (name: string) => `${name} may hurt`,
} as const;

/**
 * (Rule 9; overview-today-edits §3 `Pain confirm`, active-workout §2.14.1) Picking an exercise flagged `May hurt`
 * asks first: `Overhead press may hurt` · `Shoulder pain flagged 6 Oct.` · `Choose another` / `Swap anyway`
 * (`Add anyway` when adding). Null: not flagged, the pick goes straight through. Pure.
 */
export function swapPainConfirm(item: Pick<ChoiceItem, 'name' | 'mayHurt' | 'painLine'>, actionWord: string): { title: string; message: string | null; cancel: string; confirm: string } | null {
  if (!item.mayHurt) return null;
  return { title: SWAP_PAIN_COPY.title(item.name), message: item.painLine ?? null, cancel: SWAP_PAIN_COPY.cancel, confirm: SWAP_PAIN_COPY.anyway(actionWord) };
}
