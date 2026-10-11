import { formatNumber, loadText, NBSP, repRangeText, setNumbersText, toMs } from '@fizz/domain';
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

/** `95 kg × 8`, `95 kg × 6–8`, `10–15 reps`, `22.5 kg each`. */
export function targetPhrase(t: CoachTarget | null): string {
  if (t === null) return '—';
  const load = loadPart(t.load);
  const reps = t.reps === null ? null : repRangeText(t.reps);
  if (load !== null && reps !== null) return `${load}${TIMES}${reps}`;
  if (load !== null) return load;
  if (reps !== null) return `${reps}${NBSP}reps`;
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
    return `${formatNumber(bl.value)} → ${loadPart(al) ?? ''}${reps}`;
  }
  if (sameLoad && !sameReps && after.reps !== null && before.reps !== null) {
    return `${targetPhrase(before)} → ${repRangeText(after.reps)}`;
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

function adjustSlot(exercises: readonly ExerciseTargetChanges[]): { title: string; detail: string } {
  const numbers = allSetNumbers(exercises);
  if (exercises.length > 1) {
    const list = exercises.map((e) => `${e.exerciseName} ${setNumbersText(e.changes.map((c) => c.setNumber)).replace(/^sets? /, '')}`).join(' · ');
    return { title: `Coach adjusted ${String(numbers.length)} sets`, detail: list };
  }
  const ex = exercises[0];
  const p = ex ? partsOf(ex) : { name: '', changed: [], removed: [], added: [] };
  const title = `Coach adjusted ${setNumbersText(numbers)}`;
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

function failureOr(record: ActionRecord, fallback: string): string {
  return record.failure ?? fallback;
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
          const slot = adjustSlot(d.exercises);
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
      const text = `Out of date: ${failureOr(record, 'your workout changed')}. Nothing changed.`;
      return make(status, text, text);
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
