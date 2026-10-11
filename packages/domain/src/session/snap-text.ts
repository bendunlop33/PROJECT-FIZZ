import type { EquipmentInstance, Load, PlannedSnap, WeightUnit } from '@fizz/schemas';
import { formatNumber, loadText, NBSP, type LoadContext } from '../display';
import { getAchievableLoads, loadsByDifficulty } from '../equipment';
import { boundWords, convertedWords, noLoadWords, roundedWords, withWas } from './fit-words';
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

function inUnitWord(eq: EquipmentInstance | null, unit: WeightUnit): string {
  switch (eq?.kind) {
    case 'dumbbells':
      return `Dumbbells here are in ${unit}.`;
    case 'barbell':
    case 'plate_loaded_machine':
      return `Plates here are in ${unit}.`;
    case 'weight_stack':
    case 'assisted_stack':
      return `The stack here is in ${unit}.`;
    case 'bodyweight_station':
    case undefined:
      return `Loads here are in ${unit}.`;
  }
}

type SlotInfo = Pick<SnapSlotResult, 'equipment' | 'exerciseName' | 'sourceEquipment' | 'unit'>;

/** A change line's note on the switch card (`ⓘ` facts, `⚠` for a dropped load or pain). */
export function cardNoteText(note: SnapNote, slot: SlotInfo): NoteLine | null {
  const top = note.top;
  const here = slot.equipment;
  const src = kindCtx(slot.sourceEquipment?.kind);
  switch (note.kind) {
    case 'rounded':
      return { tone: 'info', text: 'Rounded down to the nearest load here.' };
    case 'capped':
      return top.load ? { tone: 'info', text: `Capped: the most here is ${loadWords(top.load, here)}.` } : null;
    case 'converted':
      return { tone: 'info', text: `${inUnitWord(slot.equipment, slot.unit)} Rounded down.` };
    case 'restored':
      return { tone: 'info', text: 'Back to the planned load.' };
    case 'pain':
      return { tone: 'warning', text: `Pain flag on ${slot.exerciseName}: no increases.` };
    case 'dropped': {
      const from = top.intended ? loadWords(top.intended, src) : 'the planned load';
      switch (note.reason) {
        case 'not_here':
          // No swap exists in the app yet (gym-switch GS5 is deferred), so the card doesn't offer one.
          return { tone: 'warning', text: `No ${note.equipmentName ?? 'equipment for it'} here. Enter your own load, or skip it after switching.` };
        case 'convention_mismatch':
          return { tone: 'warning', text: `This is a different kind of machine, so ${from} isn’t converted.` };
        case 'lightest_is_harder':
          return { tone: 'warning', text: `The lightest here is ${note.lightest ? loadWords(note.lightest, here) : 'heavier'}, heavier than planned.` };
        case 'no_achievable_loads':
          return { tone: 'warning', text: `${note.equipmentName ?? 'The equipment'} here can’t make any load as set up.` };
        case 'unit_not_convertible':
          return { tone: 'warning', text: `Plan says ${from}. Nothing here can check it in ${slot.unit}.` };
        case 'pain_flag':
          return null; // said once by the `pain` note
      }
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
  const planWas = plan ? ` Plan was ${plan}.` : '';
  switch (snap.outcome) {
    case 'exact':
    case 'rounded':
    case 'restored':
      return null;
    case 'capped':
      return load ? { tone: 'info', text: `Capped: the most here is ${loadWords(load, ctx.equipment)}.${planWas}` } : null;
    case 'converted':
      return load && plan ? { tone: 'info', text: `Rounded from ${plan} to ${loadWords(load, ctx.equipment)} to match this gym.` } : null;
    case 'dropped': {
      const at = ctx.gymName ? ` at ${ctx.gymName}` : ' here';
      switch (snap.reason) {
        case 'not_here':
          return { tone: 'warning', text: `No ${snap.intendedOn?.name ?? 'equipment for it'}${at}.${planWas}` };
        case 'lightest_is_harder': {
          const easiest = ctx.equipment ? loadsByDifficulty(getAchievableLoads(ctx.equipment))[0] : undefined;
          const lightest = easiest === undefined || !ctx.equipment ? null : loadWords({ value: easiest, unit: ctx.equipment.unit, convention: ctx.equipment.loadConvention }, ctx.equipment);
          return { tone: 'warning', text: `The lightest here is ${lightest ?? 'heavier than planned'}${plan ? `, heavier than the plan’s ${plan}` : ''}.` };
        }
        case 'convention_mismatch':
          return { tone: 'warning', text: `No load target: this is a different kind of machine.${planWas}` };
        case 'no_achievable_loads':
          return { tone: 'warning', text: `No load target: ${ctx.equipment?.name ?? 'the equipment'} can’t make any load as set up.${planWas}` };
        case 'unit_not_convertible':
          return { tone: 'warning', text: `No load target: nothing here can check it in ${ctx.unit}.${planWas}` };
        case 'pain_flag':
          return { tone: 'warning', text: `No load target while the pain flag is on.${planWas}` };
        case undefined:
          return null;
      }
    }
  }
}
