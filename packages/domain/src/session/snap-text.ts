import type { EquipmentInstance, Load, PlannedSnap, WeightUnit } from '@fizz/schemas';
import { formatNumber, loadText, NBSP, type LoadContext } from '../display';
import { boundWords, convertedWords, droppedWords, noLoadWords, roundedWords, withWas } from './fit-words';
import type { SnapNote, SnapSlotResult } from './snap';

/**
 * Fixed wording for `snapPlanToGym` results (gym-switch.md §5). The same
 * result reads "here" on the switch card (its title names the gym), names the
 * gym on the set card, and says "last time" in Repeat. Never model text.
 */

export type NoteTone = 'info' | 'warning';
export interface NoteLine {
  tone: NoteTone;
  text: string;
}

/** A load as plain text (`32.5 kg each`, `50 kg stack`, `Assist 30 kg`). */
export function loadWords(l: Load, equipment: LoadContext = null): string {
  return loadText(l, l.convention, equipment).replaceAll(NBSP, ' ');
}

const INSTANCE_KINDS: ReadonlySet<string> = new Set(['barbell', 'plate_loaded_machine', 'dumbbells', 'weight_stack', 'assisted_stack', 'bodyweight_station']);

/** Equipment context for load wording (`40 kg plates` on a plate-loaded machine). */
function kindCtx(kind: string | undefined): LoadContext {
  return kind !== undefined && INSTANCE_KINDS.has(kind) ? { kind: kind as EquipmentInstance['kind'] } : null;
}

type SlotInfo = Pick<SnapSlotResult, 'equipment' | 'exerciseName' | 'sourceEquipment' | 'unit'>;

/** A change line's note on the switch card (`ⓘ` facts, `⚠` for a dropped load or pain), in the short fit words. */
export function cardNoteText(note: SnapNote, slot: SlotInfo): NoteLine | null {
  const top = note.top;
  const here = slot.equipment;
  const src = kindCtx(slot.sourceEquipment?.kind);
  switch (note.kind) {
    case 'rounded':
      return { tone: 'info', text: roundedWords() };
    case 'capped':
      return top.load ? { tone: 'info', text: boundWords('max', loadWords(top.load, here), false) } : null;
    case 'converted':
      return { tone: 'info', text: 'Converted · rounded' };
    case 'restored':
      return { tone: 'info', text: 'Back to plan' };
    case 'pain':
      return { tone: 'warning', text: droppedWords('pain_flag', { unit: slot.unit }) };
    case 'dropped': {
      if (note.reason === 'pain_flag') return null; // said once by the `pain` note
      const assisted = top.intended?.convention === 'assistance';
      const asked = top.intended ? (assisted ? `${formatNumber(top.intended.value)} ${top.intended.unit}` : loadWords(top.intended, src)) : null;
      // No swap exists in the app yet (gym-switch GS5 is deferred), so the card doesn't offer one.
      return { tone: 'warning', text: droppedWords(note.reason, { equipmentName: note.equipmentName, unit: top.intended?.unit ?? slot.unit, requested: asked, assisted }) };
    }
  }
}

function amountText(top: SnapNote['top']): string {
  if (top.reps !== null) return ` × ${top.reps.min === top.reps.max ? String(top.reps.min) : `${String(top.reps.min)}–${String(top.reps.max)}`}`;
  if (top.durationS !== null) return ` for ${String(top.durationS)} s`;
  return '';
}

/** Repeat's notes (routines.md §2.4): the same results, worded as "last time" (short fit words, `fit-words.ts`). */
export function repeatNoteText(note: SnapNote, slot: SlotInfo): string | null {
  const top = note.top;
  const here = slot.equipment;
  const src = kindCtx(slot.sourceEquipment?.kind);
  const last = top.intended ? loadWords(top.intended, src) : null;
  switch (note.kind) {
    case 'rounded':
      return last ? roundedWords({ was: 'last time', load: last }) : null;
    case 'capped':
      return top.load && last ? withWas(boundWords('max', loadWords(top.load, here), false), 'last time', last) : null;
    case 'converted':
      return top.load && last ? convertedWords(last) : null;
    case 'restored':
    case 'pain':
      return null;
    case 'dropped': {
      if (note.reason === 'pain_flag') return null;
      const assisted = top.intended?.convention === 'assistance';
      const asked = assisted && top.intended ? `${formatNumber(top.intended.value)} ${top.intended.unit}` : last;
      const words = noLoadWords(note.reason, { equipmentName: note.equipmentName, unit: top.intended?.unit ?? slot.unit, requested: asked, assisted });
      if (note.reason === 'lightest_is_harder') return words;
      return withWas(words, 'last time', last === null ? null : `${last}${amountText(top)}`);
    }
  }
}

/**
 * The set card's `SnapNote` (gym-switch §2.5): read from the stored
 * `planned.snap`, so it reads the same after a relaunch (check 70). Only
 * capped, converted and dropped fits show one; a plain rounding or a restore
 * is in `Why?` only.
 */
export function setSnapNote(
  snap: PlannedSnap | undefined,
  load: Load | null,
  ctx: { gymName: string | null; equipment: EquipmentInstance | null; unit: WeightUnit },
): NoteLine | null {
  if (snap === undefined) return null;
  const plan = snap.intended ? loadWords(snap.intended, kindCtx(snap.intendedOn?.kind)) : null;
  switch (snap.outcome) {
    case 'exact':
    case 'rounded':
    case 'restored':
      return null;
    case 'capped':
      return load ? { tone: 'info', text: withWas('Max here', 'plan', plan) } : null;
    case 'converted':
      return load && plan ? { tone: 'info', text: convertedWords(plan) } : null;
    case 'dropped': {
      // The full sentence is in `Why?` (the `Equipment` row); the card says only what's missing.
      switch (snap.reason) {
        case 'not_here':
          return { tone: 'warning', text: withWas(`No load target · no ${(snap.intendedOn?.name ?? 'equipment for it').toLowerCase()} here`, 'plan', plan) };
        case 'lightest_is_harder':
          return { tone: 'warning', text: withWas('No load target · lightest here is heavier', 'plan', plan) };
        case 'convention_mismatch':
          return { tone: 'warning', text: 'No load target · different machine' };
        case 'no_achievable_loads':
          return { tone: 'warning', text: 'No load target · no loads set up' };
        case 'unit_not_convertible':
          return { tone: 'warning', text: `No load target · no ${ctx.unit} equipment` };
        case 'pain_flag':
          return { tone: 'warning', text: 'No load target · pain flag' };
        case undefined:
          return null;
      }
    }
  }
}
