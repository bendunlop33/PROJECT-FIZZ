import { parseRequestedMinutes } from '@fizz/domain';
import { BUILD_LIMITS, BUILDER_GROUPS, type BuilderGroup, type FillSetupArgs } from '@fizz/schemas';
import { bareNumbers, buildMinutesFor } from '../build';

/**
 * Set up from words (workout-builder-v3 §2.6, §5 `fill_setup`; §9 Q4).
 * Pure. Connected, the coach's `fill_setup` arguments are checked here;
 * offline (or coach not connected), `parseSetupWords` reads the same few
 * things straight from Ben's words, with no coach message (rule 1). Either
 * way the result is applied at once with an Undo toast
 * (`Pull · 50 min · supersets on · Undo`, Ben 20 Oct).
 */

export interface SetupMainLiftOption {
  exerciseId: string;
  /** The catalogue entry it came from, when there is one (the model may name either). */
  catalogueId: string | null;
  name: string;
}

export interface SetupDayOption {
  /** `SplitDay.id` (`push`, `chest`, a custom day's ID). */
  id: string;
  /** `Pull`, `Chest`. */
  name: string;
  /** The day's main lifts, the Profile's first (`From Profile`). */
  mainLifts: readonly SetupMainLiftOption[];
  /** The main lift a change to this day brings, as Set up opens it (null: none, a plan template with no main lift). Absent: the first of `mainLifts`. */
  defaultMainLiftExerciseId?: string | null;
}

export interface SetupState {
  dayId: string;
  minutes: number;
  mainLiftExerciseId: string | null;
  supersets: boolean;
  /** Muscle-group rows, display groups (stored as body parts by the builder). */
  groups: readonly { group: BuilderGroup; count: number }[];
}

export interface SetupCoachContext {
  /** Your split first, then Push / Pull / Legs, then custom (§2.2 Day sheet). */
  days: readonly SetupDayOption[];
  current: SetupState;
  /** The recommended groups for a set-up (code's `recommendForSetup`), used when the day changes. */
  recommend: (s: Omit<SetupState, 'groups'>) => { group: BuilderGroup; count: number }[];
}

export type SetupField = 'day' | 'minutes' | 'main_lift' | 'supersets' | 'groups';

export interface SetupFill {
  next: SetupState;
  changed: SetupField[];
  /** `Pull · 50 min · supersets on` (the Undo toast's words). */
  toast: string;
  /** What was left out or clamped, in code's words. */
  notes: string[];
}

export const NOT_UNDERSTOOD_LINE = 'Not understood';
const MAX_PER_GROUP = 4;

const norm = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/[^\p{L}\p{N}' ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function dayOf(ctx: SetupCoachContext, ref: string): SetupDayOption | null {
  const r = norm(ref);
  return ctx.days.find((d) => d.id === ref) ?? ctx.days.find((d) => norm(d.name) === r || norm(d.id) === r) ?? null;
}

function liftOf(day: SetupDayOption, ref: string): SetupMainLiftOption | null {
  return day.mainLifts.find((m) => m.exerciseId === ref || m.catalogueId === ref) ?? day.mainLifts.find((m) => norm(m.name) === norm(ref)) ?? null;
}

/**
 * `checkFillSetup`: the checked set-up, or null when nothing would change.
 * The day must exist; a length Ben said wins over the model's
 * (`buildMinutesFor`); the main lift must be one of the day's (or `none`);
 * counts 0–4 per group (0 takes the row out), at most 10 exercises.
 */
export function checkFillSetup(args: FillSetupArgs, ctx: SetupCoachContext, benWords: string): SetupFill | null {
  const cur = ctx.current;
  const notes: string[] = [];
  const changed: SetupField[] = [];
  const toast: string[] = [];

  let day = ctx.days.find((d) => d.id === cur.dayId) ?? null;
  let dayChanged = false;
  if (args.dayId !== null) {
    const d = dayOf(ctx, args.dayId);
    if (d === null) notes.push(`Not changed: no day called ${args.dayId.slice(0, 30)}`);
    else if (d.id !== cur.dayId) {
      day = d;
      dayChanged = true;
      changed.push('day');
      toast.push(d.name);
    }
  }

  const fromBen = parseRequestedMinutes(benWords);
  const asked = buildMinutesFor({ minutes: cur.minutes, minutesFromBen: fromBen, benNumbers: fromBen === null && args.minutes !== null ? bareNumbers(benWords) : [] }, args.minutes).minutes;
  const minutes = Math.max(BUILD_LIMITS.minMinutes, Math.min(BUILD_LIMITS.maxMinutes, asked));
  const raw = fromBen ?? args.minutes;
  if (minutes !== asked || (raw !== null && (raw < BUILD_LIMITS.minMinutes || raw > BUILD_LIMITS.maxMinutes))) notes.push(`Length ${String(minutes)} min (limit ${String(BUILD_LIMITS.minMinutes)}–${String(BUILD_LIMITS.maxMinutes)})`);
  if (minutes !== cur.minutes) {
    changed.push('minutes');
    toast.push(`${String(minutes)} min`);
  }

  let main = cur.mainLiftExerciseId;
  const dayDefault = day === null ? null : day.defaultMainLiftExerciseId !== undefined ? day.defaultMainLiftExerciseId : (day.mainLifts[0]?.exerciseId ?? null);
  if (dayChanged) main = dayDefault;
  if (args.mainLiftCatalogueId !== null && day !== null) {
    if (norm(args.mainLiftCatalogueId) === 'none') main = null;
    else {
      const m = liftOf(day, args.mainLiftCatalogueId);
      if (m === null) notes.push(`Not changed: that main lift isn't one of ${day.name}'s`);
      else main = m.exerciseId;
    }
  }
  // A new day brings its first main lift; only a different one (or none) is news for the toast.
  const defaultMain = dayChanged ? dayDefault : cur.mainLiftExerciseId;
  if (main !== cur.mainLiftExerciseId) changed.push('main_lift');
  if (main !== defaultMain) toast.push(main === null ? 'no main lift' : (day?.mainLifts.find((m) => m.exerciseId === main)?.name ?? 'main lift'));

  let supersets = cur.supersets;
  if (args.supersets !== null && args.supersets !== cur.supersets) {
    supersets = args.supersets;
    changed.push('supersets');
    toast.push(supersets ? 'supersets on' : 'supersets off');
  }

  const dayId = day?.id ?? cur.dayId;
  const counts = new Map<BuilderGroup, number>();
  const baseGroups = dayChanged ? ctx.recommend({ dayId, minutes, mainLiftExerciseId: main, supersets }) : cur.groups;
  for (const g of baseGroups) counts.set(g.group, g.count);
  const groupToast: string[] = [];
  for (const g of args.groups ?? []) {
    const before = counts.get(g.group) ?? 0;
    const want = g.count ?? before + (g.delta ?? 0);
    const n = Math.max(0, Math.min(MAX_PER_GROUP, want));
    if (n !== want) notes.push(`${g.group}: ${String(n)} (limit 0–${String(MAX_PER_GROUP)})`);
    if (n === before) continue;
    if (n === 0) counts.delete(g.group);
    else counts.set(g.group, n);
    groupToast.push(n === 0 ? `no ${g.group}` : n > before && g.count === null ? `+${String(n - before)} ${g.group}` : `${g.group} ${String(n)}`);
  }
  // Order: the set-up's rows first, new groups after, in the builder's group order.
  const order = [...baseGroups.map((g) => g.group), ...BUILDER_GROUPS.filter((g) => !baseGroups.some((b) => b.group === g))];
  let groups = order.flatMap((g) => {
    const n = counts.get(g);
    return n === undefined ? [] : [{ group: g, count: n }];
  });
  let total = groups.reduce((m, g) => m + g.count, 0);
  while (total > BUILD_LIMITS.maxExercises) {
    const last = [...groups].reverse().find((g) => g.count > 0);
    if (last === undefined) break;
    groups = groups.map((g) => (g === last ? { ...g, count: g.count - 1 } : g)).filter((g) => g.count > 0);
    total -= 1;
  }
  if (groupToast.length > 0 && total === BUILD_LIMITS.maxExercises) notes.push(`At most ${String(BUILD_LIMITS.maxExercises)} exercises`);
  const groupsChanged = JSON.stringify(groups) !== JSON.stringify(cur.groups.map((g) => ({ group: g.group, count: g.count })));
  if (groupsChanged) changed.push('groups');
  toast.push(...groupToast);

  if (changed.length === 0) return null;
  return { next: { dayId, minutes, mainLiftExerciseId: main, supersets, groups }, changed, toast: toast.join(' · '), notes };
}

// ---------------------------------------------------------------------------
// Offline: the words read by code (§9 Q4). No coach message, ever.

const GROUP_WORDS: readonly [RegExp, readonly BuilderGroup[]][] = [
  [/\b(?:biceps?|curls?)\b/, ['Biceps']],
  [/\btriceps?\b/, ['Triceps']],
  [/\b(?:abs|core)\b/, ['Abs']],
  [/\b(?:shoulders?|delts?)\b/, ['Shoulders']],
  [/\b(?:chest|pecs?)\b/, ['Chest']],
  [/\b(?:back|lats?)\b/, ['Back']],
  [/\b(?:legs?|quads?|hamstrings?|glutes?|calf|calves)\b/, ['Legs']],
  [/\barms?\b/, ['Biceps', 'Triceps']],
];

function groupsIn(t: string): BuilderGroup[] {
  const out: BuilderGroup[] = [];
  for (const [re, gs] of GROUP_WORDS) if (re.test(t)) out.push(...gs);
  return [...new Set(out)];
}

const ADD_WORDS = String.raw`(?:add|more|extra|plus|include|with)`;
const NO_WORDS = String.raw`(?:no|skip|without|drop|remove)`;

/** Day words a day's name may be said as (`leg day` → Legs). */
function dayWords(d: SetupDayOption): string[] {
  const n = norm(d.name);
  const out = [n, norm(d.id)];
  if (n.endsWith('s')) out.push(n.slice(0, -1));
  out.push(`${n.endsWith('s') ? n.slice(0, -1) : n} day`);
  return [...new Set(out.filter((w) => w.length > 0))];
}

/**
 * `parseSetupWords`: what code reads from Ben's words with no coach: day,
 * minutes, supersets, main lift and group counts. The same `FillSetupArgs`
 * shape, checked by `checkFillSetup` like the coach's. Null: nothing read
 * (`Not understood`).
 */
export function parseSetupWords(text: string, ctx: SetupCoachContext): FillSetupArgs | null {
  const t = ` ${norm(text)} `;
  let dayId: string | null = null;
  let best = 0;
  for (const d of ctx.days) {
    for (const w of dayWords(d)) {
      const re = new RegExp(String.raw`(?<!\b${ADD_WORDS} |\b${NO_WORDS} )\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\b`);
      if (re.test(t) && w.length > best) {
        dayId = d.id;
        best = w.length;
      }
    }
  }
  const minutes = parseRequestedMinutes(text);
  const supersets = /\b(?:no|without) supersets?\b|\bsupersets? off\b/.test(t) ? false : /\bsupersets?\b/.test(t) ? true : null;
  const day = ctx.days.find((d) => d.id === (dayId ?? ctx.current.dayId)) ?? null;
  let mainLift: string | null = null;
  if (/\bno main lift\b/.test(t)) mainLift = 'none';
  else if (day !== null) {
    const hit = day.mainLifts.filter((m) => norm(m.name).split(' ').some((w) => w.length > 3 && !['barbell', 'dumbbell', 'press', 'machine', 'cable'].includes(w) && new RegExp(String.raw`\b${w}\b`).test(t)));
    if (hit.length === 1 && hit[0] !== undefined) mainLift = hit[0].exerciseId;
  }
  const groups = new Map<BuilderGroup, { delta: number | null; count: number | null }>();
  for (const m of t.matchAll(new RegExp(String.raw`\b${ADD_WORDS} ([\p{L} ]+?)(?= and | ${NO_WORDS} |$| \d)`, 'gu'))) {
    for (const g of groupsIn(m[1] ?? '')) if (!groups.has(g)) groups.set(g, { delta: 1, count: null });
  }
  for (const m of t.matchAll(new RegExp(String.raw`\b${NO_WORDS} ([\p{L}]+)`, 'gu'))) {
    if (/^supersets?$/.test(m[1] ?? '')) continue;
    for (const g of groupsIn(m[1] ?? '')) groups.set(g, { delta: null, count: 0 });
  }
  const groupArgs = [...groups.entries()].map(([group, v]) => ({ group, ...v }));
  if (dayId === null && minutes === null && supersets === null && mainLift === null && groupArgs.length === 0) return null;
  return { dayId, minutes, mainLiftCatalogueId: mainLift, supersets, groups: groupArgs.length === 0 ? null : groupArgs, reply: null };
}
