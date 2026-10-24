import type { BuilderFitStep } from './fit';

/**
 * The Time control's note and detail, one wording for Today's card and Your workout (fit-to-time.md 22 Oct revision,
 * item 4: "Honest, without moving the screen"). The note is the biggest change, after `Time` in light orange
 * (`Time · −1 exercise ›`); a tap lists everything combined. Values only (minimal copy).
 */
export const FIT_NOTE_COPY = {
  shorter: 'Shorter rests',
  shortest: 'Shortest rests',
  normal: 'Normal rests',
  sets: (name: string, from: number, to: number) => `${name} ${String(from)} → ${String(to)} sets`,
  dropped: (name: string) => `Dropped ${name}`,
  added: (name: string) => `Added ${name}`,
  paired: (names: readonly string[]) => `Superset ${names.join(' + ')}`,
} as const;

export interface FitNoteView {
  /** `−1 exercise`, `+1 exercise`, `−2 sets`, `+2 sets`, `supersets`, `shorter rests`; null: nothing changed. */
  note: string | null;
  /** Everything it changed, rests first: `Shorter rests`, `Superset Fly + Crunch`, `Fly 3 → 2 sets`, `Dropped Pushdown`. */
  lines: string[];
}

const count = (n: number, one: string, many: string): string => `${String(n)} ${n === 1 ? one : many}`;

/**
 * `fitNoteOf`: the note and detail for a fit's steps. `nameOf` names an exercise; `slotName` names a slot a pair
 * step holds (by its key). An effort step (the workout's `+N min` offer only) isn't Time's and isn't listed.
 */
export function fitNoteOf(steps: readonly BuilderFitStep[], nameOf: (exerciseId: string) => string, slotName: (slotKey: string) => string): FitNoteView {
  let rest: { line: string; note: string } | null = null;
  const pairs: string[] = [];
  const changes: string[] = [];
  let dropped = 0;
  let added = 0;
  let fewer = 0;
  let more = 0;
  for (const st of steps) {
    switch (st.kind) {
      case 'rest':
        rest = st.to === 'shorter' ? { line: FIT_NOTE_COPY.shorter, note: 'shorter rests' } : st.to === 'shortest' ? { line: FIT_NOTE_COPY.shortest, note: 'shortest rests' } : { line: FIT_NOTE_COPY.normal, note: 'normal rests' };
        break;
      case 'pair':
        pairs.push(FIT_NOTE_COPY.paired(st.slotKeys.map(slotName)));
        break;
      case 'sets':
        if (st.to < st.from) fewer += st.from - st.to;
        else more += st.to - st.from;
        if (st.to !== st.from) changes.push(FIT_NOTE_COPY.sets(nameOf(st.exerciseId), st.from, st.to));
        break;
      case 'drop':
        dropped += 1;
        changes.push(FIT_NOTE_COPY.dropped(nameOf(st.exerciseId)));
        break;
      case 'add':
        added += 1;
        changes.push(FIT_NOTE_COPY.added(nameOf(st.exerciseId)));
        break;
      case 'effort':
        break;
    }
  }
  const note =
    dropped > 0
      ? `−${count(dropped, 'exercise', 'exercises')}`
      : added > 0
        ? `+${count(added, 'exercise', 'exercises')}`
        : fewer > 0
          ? `−${count(fewer, 'set', 'sets')}`
          : more > 0
            ? `+${count(more, 'set', 'sets')}`
            : pairs.length > 0
              ? 'supersets'
              : (rest?.note ?? null);
  return { note, lines: [...(rest === null ? [] : [rest.line]), ...pairs, ...changes] };
}
