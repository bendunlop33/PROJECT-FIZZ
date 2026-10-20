import { activityDetail, ACTIVITY_WORD, cardioValuesText, customExerciseLine, formatDuration, formatNumber, loadText, localDateText, NBSP, repRangeText, setNumbersText, toMs } from '@fizz/domain';
import type { ActionRecord, CoachTarget, ExerciseTargetChanges, Load, NextTargetRow, SetTargetChange } from '@fizz/schemas';

/**
 * `renderActionResult` (coach-contract CC1, §5.1): every line that says
 * something changed is app text built from the saved `ActionRecord`, never
 * from the model's words. Pure. Every number says target or actual and
 * carries its unit and convention.
 */

export type RenderSurface = 'sheet' | 'slot' | 'summary' | 'voice';
export type RenderedStatus = 'committed' | 'proposed' | 'not_done' | 'undone';

export interface RenderedAction {
  status: RenderedStatus;
  /** The line (sheet, summary) or banner line 1 (slot). */
  text: string;
  /** Banner line 2 on the slot surface: `100 → 95 kg × 8`. */
  detail: string | null;
  /** The spoken version (voice strip, TTS). */
  spoken: string;
  /** VoiceOver prefix so app lines are never read as coach text (§8). */
  accessibilityPrefix: 'Saved change.' | 'Suggestion, not applied.' | 'Not done.' | 'Undone.';
}

export interface RenderOptions {
  /** CC5: an earlier action cited through `get_recent_actions`; adds its time. */
  earlier?: boolean;
}

const TIMES = `${NBSP}×${NBSP}`;

function clock(utc: string, tz: string): string {
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tz }).format(toMs(utc));
}

function loadPart(load: Load | null): string | null {
  if (load === null) return null;
  return loadText(load, load.convention);
}

/** A logged set's values: `100 kg × 8 · RPE 8`, `Bodyweight × 12`. */
function chatValues(v: { load: Load | null; reps: number | null; rpe: number | null }): string {
  const load = loadPart(v.load);
  const reps = v.reps === null ? null : String(v.reps);
  const main = load !== null && reps !== null ? `${load}${TIMES}${reps}` : load !== null ? load : reps !== null ? `${reps} reps` : '—';
  return v.rpe === null ? main : `${main} · RPE ${formatNumber(v.rpe)}`;
}

/** ` @ RPE 8` when the target names one (CHANGELOG 2026-10-11), else empty. */
function rpePart(t: CoachTarget): string {
  return t.rpe == null ? '' : ` @${NBSP}RPE${NBSP}${formatNumber(t.rpe)}`;
}

/** `95 kg × 8`, `95 kg × 6–8`, `10–15 reps`, `22.5 kg each`, `95 kg × 8 @ RPE 8`. */
export function targetPhrase(t: CoachTarget | null): string {
  if (t === null) return '—';
  const load = loadPart(t.load);
  const reps = t.reps === null ? null : repRangeText(t.reps);
  const rpe = rpePart(t);
  if (load !== null && reps !== null) return `${load}${TIMES}${reps}${rpe}`;
  if (load !== null) return `${load}${rpe}`;
  if (reps !== null) return `${reps}${NBSP}reps${rpe}`;
  return '—';
}

function sameTarget(a: CoachTarget | null, b: CoachTarget | null): boolean {
  return targetPhrase(a) === targetPhrase(b);
}

/** `100 → 95 kg × 8`, `95 kg × 8 → 6`, or the full `100 kg × 6–8 → 95 kg × 8`. */
export function beforeAfterPhrase(before: CoachTarget | null, after: CoachTarget | null): string {
  if (before === null || after === null) return `${targetPhrase(before)} → ${targetPhrase(after)}`;
  const bl = before.load;
  const al = after.load;
  const sameReps = repText(before) === repText(after);
  const sameLoad = loadPart(bl) === loadPart(al);
  // The spec's banner form (coach-adjustments §2.5): `100 → 95 kg × 8`, the after's reps.
  if (!sameLoad && bl !== null && al !== null && bl.unit === al.unit && bl.convention === al.convention && al.convention !== 'bodyweight') {
    const reps = after.reps === null ? '' : `${TIMES}${repRangeText(after.reps)}`;
    const rpe = after.rpe != null && after.rpe !== (before.rpe ?? null) ? rpePart(after) : '';
    return `${formatNumber(bl.value)} → ${loadPart(al) ?? ''}${reps}${rpe}`;
  }
  if (sameLoad && !sameReps && after.reps !== null && before.reps !== null && (after.rpe ?? null) === (before.rpe ?? null)) {
    return `${targetPhrase({ ...before, rpe: null })} → ${repRangeText(after.reps)}`;
  }
  return `${targetPhrase(before)} → ${targetPhrase(after)}`;
}

function repText(t: CoachTarget): string {
  return t.reps === null ? '' : repRangeText(t.reps);
}

function targetsWord(n: number): string {
  return n === 1 ? '(target)' : '(targets)';
}

// ---------------------------------------------------------------------------
// Spoken forms (coach-adjustments §5.3): units in full, halves in words.

function spokenNumber(v: number): string {
  const whole = Math.trunc(v);
  const frac = Math.round((v - whole) * 100);
  if (frac === 0) return String(whole);
  if (frac === 50) return `${String(whole)} and a half`;
  if (frac === 25) return `${String(whole)} and a quarter`;
  if (frac === 75) return `${String(whole)} and three quarters`;
  return formatNumber(v).replace('.', ' point ');
}

function spokenLoad(load: Load): string {
  if (load.convention === 'bodyweight') return 'bodyweight';
  const unit = load.unit === 'kg' ? 'kilos' : 'pounds';
  const n = `${spokenNumber(load.value)} ${unit}`;
  switch (load.convention) {
    case 'per_hand':
      return `${n} each`;
    case 'assistance':
      return `${n} of assistance`;
    case 'added':
      return `${n} added`;
    case 'stack':
    case 'total':
      return n;
  }
}

function spokenTarget(t: CoachTarget | null): string {
  if (t === null) return '';
  const reps = t.reps === null ? null : t.reps.min === t.reps.max ? String(t.reps.min) : `${String(t.reps.min)} to ${String(t.reps.max)}`;
  if (t.load !== null && reps !== null) return `${spokenLoad(t.load)} for ${reps}`;
  if (t.load !== null) return spokenLoad(t.load);
  return reps === null ? '' : `${reps} reps`;
}

function spokenSets(numbers: readonly number[]): string {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  if (sorted.length === 1) return `Set ${String(sorted[0])}`;
  return `Sets ${sorted.slice(0, -1).join(', ')} and ${String(sorted[sorted.length - 1])}`;
}

/** Generic fallback: no symbols read aloud. */
function speakable(text: string): string {
  return text
    .replace(/\s*\((targets?|actual)\)/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/ × /g, ' for ')
    .replace(/(\d)–(\d)/g, '$1 to $2')
    .replace(/(\d+(?:\.\d+)?) kg/g, (_m, n: string) => `${spokenNumber(Number(n))} kilos`)
    .replace(/(\d+(?:\.\d+)?) lb/g, (_m, n: string) => `${spokenNumber(Number(n))} pounds`)
    .replace(/ → /g, ' to ');
}

// ---------------------------------------------------------------------------
// Today's sets

interface ExerciseParts {
  name: string;
  changed: SetTargetChange[];
  removed: SetTargetChange[];
  added: SetTargetChange[];
}

function partsOf(ex: ExerciseTargetChanges): ExerciseParts {
  return {
    name: ex.exerciseName,
    changed: ex.changes.filter((c) => c.before !== null && c.after !== null),
    removed: ex.changes.filter((c) => c.after === null),
    added: ex.changes.filter((c) => c.before === null && c.after !== null),
  };
}

function allSetNumbers(exercises: readonly ExerciseTargetChanges[]): number[] {
  return exercises.flatMap((e) => e.changes.map((c) => c.setNumber));
}

/** `sets 3–4 to 95 kg × 8` or `set 3 to 95 kg × 8 and set 4 to 92.5 kg × 8`. */
function changedPhrase(changed: readonly SetTargetChange[], joiner: 'to' | 'at'): string {
  const first = changed[0];
  if (first === undefined) return '';
  if (changed.every((c) => sameTarget(c.after, first.after))) {
    return `${setNumbersText(changed.map((c) => c.setNumber))} ${joiner} ${targetPhrase(first.after)}`;
  }
  return changed.map((c) => `set ${String(c.setNumber)} ${joiner} ${targetPhrase(c.after)}`).join(' and ');
}

function exercisePhrases(p: ExerciseParts, mode: 'committed' | 'proposed'): string[] {
  const out: string[] = [];
  if (p.changed.length > 0) out.push(mode === 'committed' ? `changed ${changedPhrase(p.changed, 'to')}` : changedPhrase(p.changed, 'at'));
  for (const r of p.removed) out.push(mode === 'committed' ? `removed set ${String(r.setNumber)}` : `remove set ${String(r.setNumber)}`);
  for (const a of p.added) out.push(`${mode === 'committed' ? 'added' : 'add'} set ${String(a.setNumber)}: ${targetPhrase(a.after)}`);
  return out;
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function adjustLine(exercises: readonly ExerciseTargetChanges[], mode: 'committed' | 'proposed'): string {
  const parts = exercises.map(partsOf);
  const count = allSetNumbers(exercises).length;
  const single = parts.length === 1;
  const body = parts
    .map((p) => {
      const phrases = exercisePhrases(p, mode).join('; ');
      return single ? phrases : `${p.name}: ${phrases}`;
    })
    .join('. ');
  if (mode === 'committed') return `${capitalise(body)} ${targetsWord(count)}.`;
  return `Suggested: ${body} ${targetsWord(count)}. Not applied.`;
}

/** `Coach adjusted sets 2–3`; the built-in rule's change (author `checks`, CA6 revised) reads `Adjusted sets 2–3`. */
function adjustSlot(exercises: readonly ExerciseTargetChanges[], byCoach = true): { title: string; detail: string } {
  const who = byCoach ? 'Coach adjusted' : 'Adjusted';
  const numbers = allSetNumbers(exercises);
  if (exercises.length > 1) {
    const list = exercises.map((e) => `${e.exerciseName} ${setNumbersText(e.changes.map((c) => c.setNumber)).replace(/^sets? /, '')}`).join(' · ');
    return { title: `${who} ${String(numbers.length)} sets`, detail: list };
  }
  const ex = exercises[0];
  const p = ex ? partsOf(ex) : { name: '', changed: [], removed: [], added: [] };
  const title = `${who} ${setNumbersText(numbers)}`;
  const lines: string[] = [];
  const first = p.changed[0];
  if (first !== undefined) {
    lines.push(
      p.changed.every((c) => sameTarget(c.after, first.after) && sameTarget(c.before, first.before))
        ? beforeAfterPhrase(first.before, first.after)
        : p.changed.map((c) => `Set ${String(c.setNumber)} ${beforeAfterPhrase(c.before, c.after)}`).join(' · '),
    );
  }
  for (const r of p.removed) lines.push(`Set ${String(r.setNumber)} removed`);
  for (const a of p.added) lines.push(`Set ${String(a.setNumber)} added: ${targetPhrase(a.after)}`);
  return { title, detail: lines.join(' · ') };
}

function adjustSpoken(exercises: readonly ExerciseTargetChanges[]): string {
  return exercises
    .map((ex) => {
      const p = partsOf(ex);
      const out: string[] = [];
      // Across several exercises each part names its exercise, so "Sets 3 and 4" can't be heard as the wrong lift.
      if (exercises.length > 1) out.push(`${ex.exerciseName}.`);
      const first = p.changed[0];
      if (first !== undefined) {
        if (p.changed.every((c) => sameTarget(c.after, first.after))) out.push(`${spokenSets(p.changed.map((c) => c.setNumber))}: ${spokenTarget(first.after)}.`);
        else for (const c of p.changed) out.push(`Set ${String(c.setNumber)}: ${spokenTarget(c.after)}.`);
      }
      for (const r of p.removed) out.push(`Set ${String(r.setNumber)} removed.`);
      for (const a of p.added) out.push(`Set ${String(a.setNumber)} added: ${spokenTarget(a.after)}.`);
      return out.join(' ');
    })
    .join(' ');
}

// ---------------------------------------------------------------------------
// Next-session targets

function rowPhrase(r: NextTargetRow): string {
  const sets = r.setsAfter !== null && r.setsAfter !== r.setsBefore ? `, ${String(r.setsAfter)} sets` : '';
  return `${r.exerciseName} ${targetPhrase(r.after)}${sets}`;
}

function nextLine(label: string, rows: readonly NextTargetRow[], status: 'committed' | 'proposed'): string {
  // In a committed record only the small rows were saved; bigger rows are suggestions (CA8).
  const saved = status === 'committed' ? rows.filter((r) => r.size === 'small') : [];
  const suggested = status === 'committed' ? rows.filter((r) => r.size === 'bigger') : rows;
  const out: string[] = [];
  if (saved.length > 0) out.push(`Next ${label}: ${saved.map(rowPhrase).join('; ')} ${targetsWord(saved.length)}.`);
  if (suggested.length > 0) out.push(`Suggested for next ${label}: ${suggested.map(rowPhrase).join('; ')} ${targetsWord(suggested.length)}. Not applied.`);
  return out.join(' ');
}

// ---------------------------------------------------------------------------

function quoteText(s: string): string {
  return `“${s}”`;
}

function namesText(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1] ?? ''}`;
}

const PREFIX: Record<RenderedStatus, RenderedAction['accessibilityPrefix']> = {
  committed: 'Saved change.',
  proposed: 'Suggestion, not applied.',
  not_done: 'Not done.',
  undone: 'Undone.',
};

function statusOf(record: ActionRecord): RenderedStatus {
  if (record.status === 'committed') return record.undoneBy === null ? 'committed' : 'undone';
  if (record.status === 'proposed') return 'proposed';
  return 'not_done';
}

function make(status: RenderedStatus, text: string, spoken: string, detail: string | null = null): RenderedAction {
  return { status, text, detail, spoken, accessibilityPrefix: PREFIX[status] };
}

const plural = (n: number, one: string): string => `${String(n)} ${n === 1 ? one : `${one}s`}`;

function failureOr(record: ActionRecord, fallback: string): string {
  return record.failure ?? fallback;
}

/** `Added Lateral raise: 3 × 10 kg each × 10–15 @ RPE 8 · after Bench press.`; cardio: `Added Rowing machine: 1 × 5,000 m.` */
function addedPhrase(a: { exerciseName: string; sets: number; target: CoachTarget | null; durationS: number | null; distanceM?: number | undefined; afterName: string | null; supersetWithName: string | null }): string {
  const each = a.distanceM !== undefined ? cardioValuesText({ durationS: a.durationS, distanceM: a.distanceM }) : a.durationS !== null ? formatDuration(a.durationS) : targetPhrase(a.target);
  const where = a.supersetWithName !== null ? ` · superset with ${a.supersetWithName}` : a.afterName !== null ? ` · after ${a.afterName}` : '';
  return `Added ${a.exerciseName}: ${String(a.sets)}${TIMES}${each}${where}.`;
}

/** `Run · Sat 24 Oct · 18 km · long` (planned: `Planned run`). */
function activityLine(f: { kind: keyof typeof ACTIVITY_WORD; status: 'done' | 'planned'; date: string; durationS: number | null; distanceM: number | null; effort: 'easy' | 'moderate' | 'hard' | 'long' | null }): string {
  const word = ACTIVITY_WORD[f.kind];
  const head = f.status === 'planned' ? `Planned ${word.toLowerCase()}` : word;
  const detail = activityDetail(f);
  return [head, localDateText(f.date), ...(detail === '' ? [] : [detail])].join(' · ');
}

function renderCore(record: ActionRecord, surface: RenderSurface): RenderedAction {
  const d = record.detail;
  const st = record.status;
  const status = statusOf(record);
  switch (d.kind) {
    case 'adjust_pending_sets': {
      const where = setNumbersText(allSetNumbers(d.exercises));
      if (st === 'committed') {
        const spoken = adjustSpoken(d.exercises);
        if (surface === 'slot') {
          const slot = adjustSlot(d.exercises, record.author === 'coach');
          return make(status, slot.title, spoken, slot.detail);
        }
        return make(status, adjustLine(d.exercises, 'committed'), spoken);
      }
      if (st === 'proposed') {
        const text = adjustLine(d.exercises, 'proposed');
        return make(status, text, speakable(text));
      }
      const why = st === 'stale' ? 'your workout moved on' : failureOr(record, 'the change was refused');
      const text = `Couldn't change ${where}: ${why}. Nothing changed.`;
      return make(status, text, st === 'stale' ? 'Your workout moved on. Nothing changed.' : speakable(text));
    }
    case 'edit_today': {
      // Coach v3 (ADR 0027): one card for every change to today's workout, from the saved record.
      // An added exercise reads as `add_exercise_today` did: what was added, its sets and first target.
      let addIndex = 0;
      const structural = d.lines
        .map((l) => {
          if (l.change !== 'add') return `${l.text}.`;
          const a = d.added?.[addIndex];
          addIndex += 1;
          return a === undefined ? `${l.text}.` : addedPhrase(a);
        })
        .join(' ');
      if (st === 'committed') {
        if (d.lines.length === 0) {
          const spoken = adjustSpoken(d.exercises);
          if (surface === 'slot') {
            const slot = adjustSlot(d.exercises, record.author === 'coach');
            return make(status, slot.title, spoken, slot.detail);
          }
          return make(status, adjustLine(d.exercises, 'committed'), spoken);
        }
        const targets = d.exercises.some((e) => partsOf(e).changed.length > 0) ? adjustLine(d.exercises.map((e) => ({ ...e, changes: partsOf(e).changed })).filter((e) => e.changes.length > 0), 'committed') : '';
        const text = [structural, targets].filter((x) => x !== '').join(' ');
        if (surface === 'slot') return make(status, d.lines[0]?.text ?? text, speakable(text), d.lines.length > 1 || targets !== '' ? [...d.lines.slice(1).map((l) => l.text), targets].filter((x) => x !== '').join(' · ') : null);
        return make(status, text, speakable(text));
      }
      if (st === 'proposed') {
        if (d.lines.length === 0) {
          const text = adjustLine(d.exercises, 'proposed');
          return make(status, text, speakable(text));
        }
        const targets = d.exercises.some((e) => partsOf(e).changed.length > 0) ? adjustLine(d.exercises.map((e) => ({ ...e, changes: partsOf(e).changed })).filter((e) => e.changes.length > 0), 'proposed').replace(/^Suggested: /, '').replace(/ Not applied\.$/, '') : '';
        const text = `Suggested: ${[structural, targets].filter((x) => x !== '').join(' ')} Not applied.`;
        return make(status, text, speakable(text));
      }
      if (st === 'stale') return make(status, "Couldn't change today's workout: your workout moved on. Nothing changed.", 'Your workout moved on. Nothing changed.');
      const text = `Couldn't change today's workout: ${failureOr(record, 'the change was refused')}. Nothing changed.`;
      return make(status, text, speakable(text));
    }
    case 'add_exercise_today': {
      // (12 Oct) An exercise added to today's workout because Ben asked: values only, with Undo on the card.
      if (st === 'committed') {
        const text = addedPhrase(d);
        return make(status, text, speakable(text));
      }
      if (st === 'stale') return make(status, 'Not added: your workout moved on.', 'Not added. Your workout moved on.');
      const text = `Couldn't add ${d.exerciseName}: ${failureOr(record, 'it was refused')}. Nothing changed.`;
      return make(status, text, speakable(text));
    }
    case 'rename_workout': {
      // (14 Oct) The live workout renamed because Ben asked: the name only, with Undo on the card.
      if (st === 'committed') {
        const text = `Renamed workout: ${d.after}.`;
        return make(status, text, speakable(text));
      }
      if (st === 'stale') return make(status, 'Not renamed: your workout moved on.', 'Not renamed. Your workout moved on.');
      const text = `Not renamed: ${failureOr(record, 'it was refused')}.`;
      return make(status, text, speakable(text));
    }
    case 'log_set': {
      if (st === 'committed') {
        const text = `Logged set ${String(d.setNumber)} · ${d.exerciseName}: ${chatValues(d.values)} (actual).`;
        return make(status, text, speakable(text));
      }
      if (st === 'stale') return make(status, 'Not logged: your workout moved on.', 'Not logged. Your workout moved on.');
      const text = `Not logged: ${failureOr(record, 'it was refused')}.`;
      return make(status, text, speakable(text));
    }
    case 'correct_set': {
      if (st === 'committed') {
        const text = `Set ${String(d.setNumber)} corrected · ${d.exerciseName}: ${chatValues(d.before)} → ${chatValues(d.after)} (actual).`;
        return make(status, text, speakable(text));
      }
      if (st === 'stale') return make(status, 'Not corrected: your workout moved on.', 'Not corrected. Your workout moved on.');
      const text = `Not corrected: ${failureOr(record, 'it was refused')}.`;
      return make(status, text, speakable(text));
    }
    case 'set_next_session_targets': {
      if (st === 'committed' || st === 'proposed') {
        const text = nextLine(d.workoutLabel, d.rows, st);
        return make(status, text, speakable(text));
      }
      const text = "Couldn't set next targets.";
      return make(status, text, text);
    }
    case 'propose_next_workout_change': {
      const what = d.changes.map((c) => c.text).join('; ');
      if (st === 'proposed') {
        const text = `Suggested for your next ${d.workoutLabel}: ${what}. Not applied.`;
        return make(status, text, speakable(text));
      }
      if (st === 'committed') {
        const text = `Applied for your next ${d.workoutLabel}: ${what}.`;
        return make(status, text, speakable(text));
      }
      // Ben's Not now on a proposal card.
      if (d.proposalId !== undefined && st === 'rejected') {
        const text = `Not applied: ${what}.`;
        return make(status, text, speakable(text));
      }
      if (st === 'stale') return make(status, 'Out of date. Nothing changed.', 'Out of date. Nothing changed.');
      const text = `Couldn't suggest that: ${failureOr(record, 'it was refused')}. Nothing changed.`;
      return make(status, text, speakable(text));
    }
    case 'update_routine': {
      // Ben's own change from today's edits (ADR 0022): the routine, from now on.
      const what = d.changes.map((c) => c.text).join('; ');
      if (st === 'committed') {
        const text = `${d.routineName} changed: ${what}.`;
        return make(status, text, speakable(text));
      }
      const text = `Couldn't change ${d.routineName}: ${failureOr(record, 'it changed since')}. Nothing changed.`;
      return make(status, text, text);
    }
    case 'fit_today': {
      // The coach's fit to time (fit-to-time §5): today only, with Undo on its card.
      if (st === 'committed') {
        const text = `Fitted today to ${String(d.minutes)} min: about ${String(d.beforeMinutes)} to ${String(d.afterMinutes)} min.`;
        return make(status, text, speakable(text));
      }
      const text = `Couldn't fit today to ${String(d.minutes)} min. Nothing changed.`;
      return make(status, text, text);
    }
    case 'build_workout': {
      // workout-builder §4.2, §5.3: the card reads the stored draft; this line is the tool log and `Why?` text.
      if (st === 'committed') {
        const left = d.leftOut > 0 ? ` · ${String(d.leftOut)} left out` : '';
        const text = d.parentN === null ? `Draft ready: ${d.name} · ${plural(d.exerciseCount, 'exercise')}${left}.` : `Version ${String(d.versionN)}: ${d.name} · ${plural(d.exerciseCount, 'exercise')}${left}.`;
        return make(status, text, speakable(text));
      }
      if (st === 'stale') return make(status, 'Out of date. Nothing built.', 'Out of date. Nothing built.');
      const text = `Couldn't build a workout here: ${failureOr(record, 'it failed the checks')}. Nothing saved.`;
      return make(status, text, speakable(text));
    }
    case 'build_plan': {
      // (19 Oct) The plan card reads the stored plan; this line is the tool log and `Why?` text. A proposal: nothing applied.
      if (st === 'committed' || st === 'proposed') {
        const left = d.days.reduce((n, x) => n + x.leftOut, 0);
        const what = `${d.name} · ${d.days.map((x) => x.name).join(', ')}${left > 0 ? ` · ${String(left)} left out` : ''}`;
        const text = d.parentN === null ? `Plan ready: ${what}. Not applied.` : `Version ${String(d.versionN)}: ${what}. Not applied.`;
        return make(status, text, speakable(text));
      }
      if (st === 'stale') return make(status, 'Out of date. Nothing built.', 'Out of date. Nothing built.');
      const text = `Couldn't build a plan here: ${failureOr(record, 'it failed the checks')}. Nothing saved.`;
      return make(status, text, speakable(text));
    }
    case 'pause_plan': {
      // (Ben, 20 Oct) The plan in use paused or resumed because Ben asked, with Undo on the card.
      if (st === 'committed') {
        const text = d.action === 'resume' ? 'Plan resumed.' : d.untilDate === null ? 'Plan paused.' : `Plan paused until ${localDateText(d.untilDate)}.`;
        return make(status, text, speakable(text));
      }
      if (st === 'stale') return make(status, 'Out of date. Nothing changed.', 'Out of date. Nothing changed.');
      const text = `${d.action === 'resume' ? 'Not resumed' : 'Not paused'}: ${failureOr(record, 'it was refused')}.`;
      return make(status, text, speakable(text));
    }
    case 'log_activity': {
      // (Ben, 20 Oct) An activity logged because Ben asked (Undo on the card), or offered (Log on the card).
      const what = activityLine(d.fields);
      if (st === 'committed') {
        const text = `Logged: ${what}.`;
        return make(status, text, speakable(text));
      }
      if (st === 'proposed') {
        const text = `Log ${what}?`;
        return make(status, text, speakable(text));
      }
      if (st === 'stale') return make(status, 'Out of date. Nothing changed.', 'Out of date. Nothing changed.');
      const text = `Not logged: ${failureOr(record, 'it was refused')}.`;
      return make(status, text, speakable(text));
    }
    case 'propose_week': {
      // (Ben, 20 Oct) This week reshaped around a run: always a proposal Ben applies (the card has the before/after list).
      const what = d.after.map((r) => (r.note === null ? r.name : `${r.name} (${r.note})`)).join(', ');
      if (st === 'proposed') {
        const text = `This week: ${what}. Not applied.`;
        return make(status, text, speakable(text));
      }
      if (st === 'stale') return make(status, 'Out of date. Nothing changed.', 'Out of date. Nothing changed.');
      const text = `Couldn't change this week: ${failureOr(record, 'it was refused')}. Nothing changed.`;
      return make(status, text, speakable(text));
    }
    case 'propose_exercise': {
      // (19 Oct) The card's line; whether it was added is read from Ben's exercise list.
      if (st === 'proposed') {
        const text = `New exercise: ${customExerciseLine(d.fields)}`;
        return make(status, text, speakable(text));
      }
      const text = `Not suggested: ${failureOr(record, 'it was refused')}.`;
      return make(status, text, speakable(text));
    }
    case 'build_question': {
      // workout-builder v2 §4.2: the card shows the checked question and its answers; nothing else was written.
      const text = d.question;
      return make(status, text, `${d.question} ${d.answers.map((a) => a.label).join(', ')}.`);
    }
    case 'set_pain_flag': {
      if (st === 'committed') {
        const text = `Pain flag on: ${namesText(d.exerciseNames)} · no increases`;
        return make(status, text, `Pain flag on for ${namesText(d.exerciseNames)}. No increases.`);
      }
      const text = `Couldn't turn the pain flag on: ${failureOr(record, 'it was refused')}. Nothing changed.`;
      return make(status, text, text);
    }
    case 'save_memory': {
      if (st === 'committed') return make(status, `Saved to memory: ${quoteText(d.text)}.`, `Saved to memory: ${d.text}.`);
      if (st === 'proposed') return make(status, `Suggested memory: ${quoteText(d.text)}. Not saved.`, `Suggested memory: ${d.text}. Not saved.`);
      return make(status, "Couldn't save that memory.", "Couldn't save that memory.");
    }
    case 'suggest_memory': {
      if (st === 'proposed') return make(status, `Save to memory? ${quoteText(d.text)}`, `Save to memory? ${d.text}.`);
      return make(status, `Not suggested: ${failureOr(record, 'it was refused')}.`, `Not suggested: ${failureOr(record, 'it was refused')}.`);
    }
    case 'forget_memory': {
      if (st === 'committed') return make(status, `Forgot: ${quoteText(d.text)}`, `Forgot: ${d.text}.`);
      return make(status, "Couldn't forget that memory.", "Couldn't forget that memory.");
    }
    case 'add_playbook_candidate': {
      if (st === 'committed') {
        // `to review` is the honest state; that it isn't used until approved is behind the card's `Why?`.
        return make(status, `Playbook, to review: ${quoteText(d.text)}`, 'Added to your playbook to review.');
      }
      return make(status, "Couldn't add that to your playbook.", "Couldn't add that to your playbook.");
    }
    case 'undo': {
      if (st === 'committed') {
        const restored = d.restored.flatMap((e) => e.changes);
        const first = restored[0];
        let back = '';
        if (first !== undefined && restored.every((c) => sameTarget(c.after, first.after))) back = ` Back to ${targetPhrase(first.after)} ${targetsWord(restored.length)}.`;
        else if (restored.length > 0) back = ` Back to the previous targets for ${setNumbersText(restored.map((c) => c.setNumber))}.`;
        const logged = d.alreadyLogged.length > 0 ? ` ${capitalise(setNumbersText(d.alreadyLogged))} ${d.alreadyLogged.length === 1 ? 'was' : 'were'} already logged.` : '';
        const text = `Undone: ${d.what}.${back}${logged}`;
        // Same branch as the text: one line only when every restored set has the same target (review B4, CC1).
        let spoken = speakable(text);
        if (first !== undefined && restored.every((c) => sameTarget(c.after, first.after))) {
          spoken = `Back to ${spokenTarget(first.after)} for ${spokenSets(restored.map((c) => c.setNumber)).toLowerCase()}.`;
        } else if (restored.length > 0) {
          const multi = d.restored.length > 1;
          spoken = d.restored
            .flatMap((e) => e.changes.map((c) => `${multi ? `${e.exerciseName} set` : 'Set'} ${String(c.setNumber)} back to ${spokenTarget(c.after)}.`))
            .join(' ');
        }
        return make('committed', text, spoken);
      }
      const text = `Couldn't undo: ${failureOr(record, 'it changed since')}.`;
      return make(status, text, text);
    }
  }
}

export function renderActionResult(record: ActionRecord, surface: RenderSurface, options: RenderOptions = {}): RenderedAction {
  const core = renderCore(record, surface);
  const tz = record.createdAt.tz;
  let text = core.text;
  if (options.earlier === true) {
    text += ` · ${clock(record.createdAt.utc, tz)}`;
    if (record.status === 'proposed') text += ' · not applied';
  }
  if (record.undoneBy !== null) text += ` · undone ${clock(record.undoneBy.atUtc, tz)}`;
  return { ...core, text };
}
