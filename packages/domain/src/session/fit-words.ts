import type { WeightUnit } from '@fizz/schemas';

/**
 * Short fit and snap words shared by every screen that says how a load was
 * fitted to a gym (minimal-copy audit §11): the workout overview's row panel,
 * the set card, the gym-switch card, Repeat and routine Start. The overview's
 * wording is the model. Full sentences, where any remain, are `Why?`-only.
 */

export type DropReason = 'not_here' | 'equipment_not_in_gym' | 'unit_not_convertible' | 'lightest_is_harder' | 'no_achievable_loads' | 'convention_mismatch' | 'pain_flag';

export interface DropWordsInput {
  /** The missing equipment's name (`Barbell`), for `not_here`. */
  equipmentName?: string | null;
  /** The unit nothing here takes, for `unit_not_convertible`. */
  unit: WeightUnit;
  /** The asked-for load in words (`20 kg`), for `lightest_is_harder`. */
  requested?: string | null;
  /** The asked-for load is assistance (easier is more), for `lightest_is_harder`. */
  assisted?: boolean;
}

/**
 * An equipment name mid-sentence: a plain name (`Barbell`, `Smith machine`)
 * reads lower-case, a name with its own capitals (`Rogue Ohio Bar`) keeps
 * the user's casing (review N3).
 */
export function nameInLine(name: string): string {
  return /^[A-Z][^A-Z]*$/.test(name) ? name.charAt(0).toLowerCase() + name.slice(1) : name;
}

/** Why a load target was dropped here: `No barbell here`, `Nothing here takes kg`, `Lightest here is above 20 kg`. */
export function droppedWords(reason: DropReason, input: DropWordsInput): string {
  switch (reason) {
    case 'not_here':
    case 'equipment_not_in_gym':
      return `No ${input.equipmentName ? nameInLine(input.equipmentName) : 'equipment for this'} here`;
    case 'unit_not_convertible':
      return `Nothing here takes ${input.unit}`;
    case 'lightest_is_harder':
      if (input.requested === null || input.requested === undefined) return 'Lightest here is heavier than planned';
      return input.assisted === true ? `Most assistance here is under ${input.requested}` : `Lightest here is above ${input.requested}`;
    case 'no_achievable_loads':
      return 'No loads set up here';
    case 'convention_mismatch':
      return 'Different equipment here';
    case 'pain_flag':
      return 'Pain flag · no increases';
  }
}

/** A load held at the equipment's end: `Max here 30 kg each`, or `Least assistance here 30 kg` on an assisted machine. */
export function boundWords(bound: 'max' | 'min', load: string, assisted: boolean): string {
  if (assisted) return bound === 'max' ? `Most assistance here ${load}` : `Least assistance here ${load}`;
  return bound === 'max' ? `Max here ${load}` : `Min here ${load}`;
}

/** `Converted from 225 lb`. */
export function convertedWords(from: string): string {
  return `Converted from ${from}`;
}

/** `Rounded`, or `Rounded · plan 32.5 kg` with what it was rounded from. */
export function roundedWords(from: { was: string; load: string } | null = null): string {
  return from === null ? 'Rounded' : `Rounded · ${from.was} ${from.load}`;
}

/** Appends ` · plan 32.5 kg` (or `last time`) to a short note when the earlier load is known. */
export function withWas(text: string, was: string, load: string | null): string {
  return load === null ? text : `${text} · ${was} ${load}`;
}

/** A dropped load as a note: `No load target · no barbell here`. */
export function noLoadWords(reason: DropReason, input: DropWordsInput): string {
  const why = droppedWords(reason, input);
  return `No load target · ${why.charAt(0).toLowerCase()}${why.slice(1)}`;
}
