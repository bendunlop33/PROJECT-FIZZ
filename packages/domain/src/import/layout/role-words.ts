import type { LayoutRole, UnitToken, WeightUnit } from '@fizz/schemas';

/**
 * Header words (AI3, AI4; evidence rule (c)). A header **names** a role when
 * code's word list matches it, exactly one column matches that role, and the
 * header has no target word. Only then is a role filled in without Ben's
 * `Use this`. Matching is on the header as written, lower-cased, with unit
 * tokens and punctuation dropped. The list is short on purpose: a missing
 * word only means the role is asked (a `Check`), never guessed.
 */

const UNIT_WORDS: Readonly<Record<string, WeightUnit>> = { kg: 'kg', kgs: 'kg', lb: 'lb', lbs: 'lb' };

/** Lower-case words of a header cell (letters, digits, `#` and `%`). */
export function headerWords(header: string): string[] {
  return header
    .toLowerCase()
    .replace(/_/g, ' ')
    .split(/[^a-z0-9#%]+/)
    .filter((w) => w !== '');
}

/** A unit word that is a whole word of the header (`Weight (kg)`, `weight_lbs`). Null when none, or both kg and lb. */
export function headerUnitToken(header: string): UnitToken | null {
  const found = headerWords(header).filter((w): w is UnitToken => w in UNIT_WORDS);
  const units = new Set(found.map((w) => UNIT_WORDS[w]));
  if (units.size !== 1) return null;
  return found[0] ?? null;
}

export function unitOfToken(token: string): WeightUnit | null {
  return UNIT_WORDS[token.toLowerCase()] ?? null;
}

/** A cell that is a unit word (`kg`, `KGS`, `lb`, `lbs`), else null. Code maps these; the model never does. */
export function unitWord(cell: string): WeightUnit | null {
  return UNIT_WORDS[cell.trim().toLowerCase()] ?? null;
}

const TARGET_WORDS = new Set(['target', 'targets', 'required', 'planned', 'plan', 'goal', 'goals', 'prescribed']);

/** The header holds a target word (`Target`, `Required`, `Planned`, `Goal`, `%1RM`): never a result role (AI4, check 9). */
export function hasTargetWord(header: string): boolean {
  if (/%\s*1\s*rm|1\s*rm\s*%/i.test(header)) return true;
  return headerWords(header).some((w) => TARGET_WORDS.has(w));
}

/** Role families: `date` and `start_time` are one family (the date format tells them apart). */
export type RoleFamily = Exclude<LayoutRole, 'start_time'>;

export function familyOf(role: LayoutRole): RoleFamily {
  return role === 'start_time' ? 'date' : role;
}

const PHRASES: readonly [RoleFamily, readonly string[]][] = [
  ['date', ['date', 'day', 'workout date', 'start time', 'starttime', 'start', 'datetime', 'date time', 'workout datetime', 'mydate']],
  ['workout', ['workout #', 'workout#', 'workout number', 'workout id', 'workout no', 'session #', 'session id', 'session number']],
  ['exercise', ['exercise', 'exercise name', 'exercise title', 'movement', 'lift', 'ename']],
  ['load', ['weight', 'load']],
  ['unit', ['unit', 'units', 'weight unit']],
  ['reps', ['reps', 'rep', 'repetitions']],
  ['sets_reps', ['sets x reps', 'setsxreps', 'sets reps']],
  ['set_type', ['set order', 'set type', 'set kind', 'type', 'set index', 'set number', 'set #', 'set#']],
  ['rpe', ['rpe']],
  ['notes', ['notes', 'note', 'comment', 'comments', 'workout notes', 'exercise notes', 'description']],
];

/** The role family the header's words name, or null. Unit tokens are dropped first (`Weight (kg)` names Load). */
export function namedFamily(header: string): RoleFamily | null {
  const words = headerWords(header).filter((w) => !(w in UNIT_WORDS));
  const phrase = words.join(' ');
  if (/^set \d{1,2}$/.test(phrase)) return 'one_set';
  for (const [family, list] of PHRASES) if (list.includes(phrase)) return family;
  return null;
}

/** Roles that write a value into a stored set (a target column can't take them; AI4). */
export function isResultRole(role: LayoutRole): boolean {
  return role !== 'notes' && role !== 'not_imported' && role !== 'workout';
}

/** Roles several columns may hold. */
export function isMultiRole(role: LayoutRole): boolean {
  return role === 'notes' || role === 'not_imported' || role === 'one_set' || role === 'workout' || role === 'set_type';
}

/**
 * Columns whose header names each family, for the "exactly one column"
 * rule. `one_set` (`Set 1…Set 4`) may be named by several.
 */
export function namedColumns(header: readonly string[]): Map<RoleFamily, number[]> {
  const out = new Map<RoleFamily, number[]>();
  header.forEach((h, i) => {
    const f = namedFamily(h);
    if (f === null) return;
    out.set(f, [...(out.get(f) ?? []), i]);
  });
  return out;
}

/** Whether column `index`'s header names `role` (AI3): the word list, one column (except `Set n` and set number or type), no target word. */
export function headerNamesRole(header: readonly string[], index: number, role: LayoutRole, named: Map<RoleFamily, number[]> = namedColumns(header)): boolean {
  const h = header[index];
  if (h === undefined || hasTargetWord(h)) return false;
  const family = familyOf(role);
  if (namedFamily(h) !== family) return false;
  const cols = named.get(family) ?? [];
  // `Set 1…Set 4` and a set-number column beside a set-type one (Hevy) may be several.
  return family === 'one_set' || family === 'set_type' || cols.length === 1;
}
