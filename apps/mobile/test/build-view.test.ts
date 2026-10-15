import { describe, expect, it } from 'vitest';

import type { ActionRecord } from '@fizz/schemas';

import { buildBlockOf } from '../src/coach/coach-service';
import { DEFAULT_SPLIT, PRESET_SPLITS } from '@fizz/domain';
import { BUILD_COPY, buildCardView, buildDayChips, draftCardView, draftChangeView, draftWhyView, fromCoachRowText, needsCoachView, pendingBuildView } from '../src/coach/build-view';
import { cardView } from '../src/coach/sheet-view';
import type { CoachDraftCard, CoachDraftRow, SessionList } from '../src/services/workout-services';
import { allRows, isShownRow, pickerRowDetail, pickerRowLabel, pickerSections, todaySessions } from '../src/workout/session-picker';

/**
 * The workout builder's views (workout-builder.md §4, §5.4, §6.6, §7): the
 * Build card, the pending and draft cards, the version card, `Needs the
 * coach` and `FROM COACH`. Pure; every value from code. Minimal copy: no
 * reassurance lines, no rule names, never "routine".
 */

const NOW = { utc: '2026-10-12T17:10:00.000Z', tz: 'Europe/London' };
const clock = () => '18:10';

describe('the Build card (§4.1)', () => {
  it('chips with defaults; `Build` sends the code-made message; the gym line says `⚠ No gym` with no gym', () => {
    const v = buildCardView({ minutes: 45, days: buildDayChips(DEFAULT_SPLIT), dayId: 'push', gymName: 'Main gym' });
    expect(v.lengths.map((l) => [l.label, l.selected])).toEqual([['30', false], ['45', true], ['60', false], ['75', false], ['90', false]]);
    expect(v.focuses.map((f) => f.label)).toEqual(['Push', 'Pull', 'Legs']);
    expect(v.focuses.find((f) => f.selected)?.label).toBe('Push');
    expect(v.message).toBe('Build a 45 min push workout');
    expect(v.gym).toEqual({ text: '⌂ Main gym', warning: false });
    expect(v.buildLabel).toBe('Build a 45 minute push workout');
    expect(v.lengths[1]?.accessibilityLabel).toBe('45 minutes, selected, length');
    const none = buildCardView({ minutes: null, days: [], dayId: null, gymName: null });
    expect(none.message).toBe('Build a workout');
    expect(none.gym).toEqual({ text: BUILD_COPY.noGym, warning: true });
  });

  it('F19: chips are the Settings split’s days, no `Coach picks`; the next day is pre-selected; a custom day names the request', () => {
    const clsb = buildCardView({ minutes: 60, days: buildDayChips({ kind: 'clsb', days: [...PRESET_SPLITS.clsb] }), dayId: 'shoulders', gymName: 'Main gym' });
    expect(clsb.focuses.map((f) => [f.label, f.selected])).toEqual([['Chest', false], ['Legs', false], ['Shoulders', true], ['Back', false]]);
    expect(clsb.message).toBe('Build a 60 min shoulders workout');
    const custom = buildDayChips({ kind: 'custom', days: [{ id: 'a', name: 'Arms', bodyParts: ['Biceps', 'Triceps'] }, { id: 'b', name: 'Legs', bodyParts: ['Quads'] }] });
    expect(custom.map((c) => c.focus)).toEqual(['split_day', 'split_day']);
    const v = buildCardView({ minutes: 45, days: custom, dayId: null, gymName: null });
    expect(v.focuses.find((f) => f.selected)?.label).toBe('Arms');
    expect(v.message).toBe('Build a 45 min Arms workout');
    expect(v.buildLabel).toBe('Build a 45 minute arms workout');
    expect(pendingBuildView({ focus: 'split_day', dayName: 'Arms', minutes: 45, elapsedMs: 0 }).title).toBe('Building Arms · 45 min');
    expect(JSON.stringify(v)).not.toContain('Coach picks');
  });

  it('the pending card counts up with no spinner text (§4.2)', () => {
    expect(pendingBuildView({ focus: 'push', minutes: 45, elapsedMs: 12_400 })).toEqual({ title: 'Building Push · 45 min', elapsed: '0:12' });
    expect(pendingBuildView({ focus: 'coach_picks', minutes: 60, elapsedMs: 75_000 })).toEqual({ title: 'Building Workout · 60 min', elapsed: '1:15' });
  });
});

const card = (over: Partial<CoachDraftCard> = {}): CoachDraftCard => ({ draftId: 'd', versionN: 1, name: 'Push · 45 min', exerciseCount: 6, estimateMinutes: 44, gymName: 'Main gym', leftOut: 1, state: { kind: 'open' }, rationale: null, ...over });

describe('the draft card (§4.2, §6.6): values from the stored draft', () => {
  it('reads `6 exercises · ≈ 44 min · Main gym`, `⚠ 1 left out`, `Open ›`; VoiceOver is one element ending "Open button"', () => {
    const v = draftCardView(card(), clock);
    expect(v).toMatchObject({ title: 'Push · 45 min', line: '6 exercises · ≈ 44 min · Main gym', leftOut: '⚠ 1 left out', open: true, endText: null });
    expect(v.accessibilityLabel).toBe('Coach draft, Push 45 minutes, 6 exercises, about 44 minutes, 1 left out. Open button.');
  });

  it('end states replace `Open ›` with words (§7)', () => {
    expect(draftCardView(card({ state: { kind: 'after_workout' } }), clock)).toMatchObject({ open: false, endText: 'After this workout' });
    expect(draftCardView(card({ state: { kind: 'started', atUtc: NOW.utc, tz: NOW.tz } }), clock)).toMatchObject({ open: false, endText: 'Started 18:10' });
    expect(draftCardView(card({ state: { kind: 'saved', routineId: 'r', routineName: 'Push · 45 min' } }), clock)).toMatchObject({ open: false, endText: 'Saved · Push · 45 min ›', routineId: 'r' });
    expect(draftCardView(card({ state: { kind: 'deleted' } }), clock)).toMatchObject({ open: false, endText: 'Draft deleted' });
    expect(draftCardView(card({ state: { kind: 'replaced', byN: 2 } }), clock)).toMatchObject({ open: false, endText: 'Replaced by v2' });
    // No estimate when it can't be worked out: the count only, never a guess.
    expect(draftCardView(card({ estimateMinutes: null, gymName: null, leftOut: 0 }), clock)).toMatchObject({ line: '6 exercises', leftOut: null });
  });
});

const record = (detail: Partial<Extract<ActionRecord['detail'], { kind: 'build_workout' }>>, status: ActionRecord['status'] = 'committed'): ActionRecord => ({
  actionId: '00000000-0000-4000-8000-000000000001',
  turnId: 't',
  opId: 'op',
  status,
  author: 'coach',
  detail: { kind: 'build_workout', draftId: '00000000-0000-4000-8000-000000000002', versionN: 2, parentN: 1, name: 'Push · 45 min', exerciseCount: 5, leftOut: 0, gymName: null, lines: [], ...detail },
  failure: null,
  reason: null,
  evidenceRefs: [],
  guardNotes: [],
  entityVersions: [],
  undoneBy: null,
  createdAt: NOW,
});

describe('the version card (§5.3): code diff lines, an icon and a glyph each, Undo', () => {
  it('`Version 2`, `≈ 44 → 41 min`, `+ − ✎` lines; Undo while the draft is open', () => {
    const r = record({ lines: [{ change: 'remove', text: '− Barbell bench press' }, { change: 'add', text: '+ DB bench press · 4 × 8–10' }, { change: 'edit', text: '✎ Incline DB press · 3 → 2 sets' }] });
    expect(draftChangeView(r, { before: 44, after: 41 }, { kind: 'open' })).toEqual({
      title: 'Version 2',
      minutes: '≈ 44 → 41 min',
      lines: [
        { icon: 'minus.circle', text: '− Barbell bench press' },
        { icon: 'plus.circle', text: '+ DB bench press · 4 × 8–10' },
        { icon: 'pencil', text: '✎ Incline DB press · 3 → 2 sets' },
      ],
      canUndo: true,
    });
    expect(draftChangeView(r, { before: null, after: 41 }, { kind: 'started', atUtc: NOW.utc, tz: NOW.tz })).toMatchObject({ minutes: null, canUndo: false });
    // A first version has no version card; a refused build has none either.
    expect(draftChangeView(record({ versionN: 1, parentN: null }), { before: null, after: 44 }, { kind: 'open' })).toBeNull();
    expect(draftChangeView(record({}, 'rejected'), { before: null, after: 44 }, { kind: 'open' })).toBeNull();
  });

  it('a committed build in the thread carries its record so the sheet shows the draft card; a refused one is an ordinary card', () => {
    expect(cardView(record({ versionN: 1, parentN: null })).draft?.detail.kind).toBe('build_workout');
    expect(cardView(record({}, 'rejected')).draft).toBeUndefined();
  });
});

describe('`Needs the coach` (§5.4): the reason word, never a stand-in plan', () => {
  it('maps every coach status to one word; only connecting fixes `Not connected` and `Signed out`', () => {
    expect(buildBlockOf('ok')).toBeNull();
    expect(needsCoachView('offline')).toMatchObject({ title: 'Build with coach', line: 'Needs the coach · Offline', connect: false });
    expect(needsCoachView(buildBlockOf('not_connected') ?? 'offline')).toMatchObject({ line: 'Needs the coach · Not connected', connect: true });
    expect(needsCoachView(buildBlockOf('expired') ?? 'offline')).toMatchObject({ line: 'Needs the coach · Signed out', connect: true });
    expect(needsCoachView(buildBlockOf('limit') ?? 'offline').line).toBe('Needs the coach · Usage limit');
    expect(needsCoachView(buildBlockOf('no_model') ?? 'offline').line).toBe('Needs the coach · Choose a model');
    expect(buildBlockOf('region')).toBe('not_connected');
  });
});

describe('`Why this workout` (§4.5)', () => {
  it('r5 B1u: a stored rationale with numbers is re-checked: no digit from the coach is shown under COACH', () => {
    const coachOf = (rationale: string) => draftWhyView({ request: 'push', rationale, checks: [], fitMinutes: 45 }).find((x) => x.heading === 'COACH')?.lines ?? [];
    expect(coachOf('You did 105×8 on Tuesday, so bench leads.')).toEqual([]);
    expect(coachOf('Bench leads; last week you hit 110 for 6.')).toEqual([]);
    expect(coachOf('Bench 102.5 since you hit 102.5 for 8 on Tuesday. Then incline.')).toEqual(['Then incline.']);
    expect(coachOf('Your est. max is 140, so bench at 110.')).toEqual([]);
    expect(coachOf('Bench first. Then eight sets of rows.')).toEqual(['Bench first.']);
  });

  it('Ben’s words quoted, the checked rationale, the length used and the code’s checks', () => {
    expect(draftWhyView({ request: '45 min push, finish with core', rationale: 'Bench first.', checks: ['Overhead press left out · shoulder flagged 6 Oct'], fitMinutes: 45 })).toEqual([
      { heading: 'YOU ASKED', lines: ['“45 min push, finish with core”'] },
      { heading: 'COACH', lines: ['Bench first.'] },
      { heading: 'USED', lines: ['45 min'] },
      { heading: 'CHECKS', lines: ['Overhead press left out · shoulder flagged 6 Oct'] },
    ]);
  });

  it('v2 `LOADS`: each target with its label, code’s line and notes, then the coach’s note quoted (r2 B1r); `USED` reads the head note', () => {
    const why = draftWhyView({
      request: 'build me a push session',
      rationale: null,
      checks: [],
      fitMinutes: 45,
      headNote: 'Push · Bench press · 45 min · last Push 6 days ago',
      loads: [
        { name: 'Bench press', target: '102.5 kg', label: null, quote: '100 for 7 @8 → 102.5', notes: ['last 3: 100×7 @8 → 102.5'], notUsed: null },
        { name: 'Cable fly', target: '12.5 kg', label: 'est.', quote: null, notes: ['est. · first time', '13 → 12.5 (this stack)'], notUsed: null },
        { name: 'Triceps pushdown', target: '27.5 kg', label: 'Rule', quote: null, notes: ['coach load 40 kg too far from last 25 × 12'], notUsed: null },
      ],
      historyUsed: 'both',
    });
    expect(why).toEqual([
      { heading: 'YOU ASKED', lines: ['“build me a push session”'] },
      {
        heading: 'LOADS',
        lines: ['Bench press 102.5 kg', '  ⓘ last 3: 100×7 @8 → 102.5', '  Coach’s note “100 for 7 @8 → 102.5”', 'Cable fly 12.5 kg · est.', '  ⓘ est. · first time', '  ⓘ 13 → 12.5 (this stack)', 'Triceps pushdown 27.5 kg · Rule', '  ⓘ coach load 40 kg too far from last 25 × 12'],
      },
      { heading: 'USED', lines: ['Push · Bench press · 45 min · last Push 6 days ago', 'Logged and FitNotes history'] },
    ]);
  });

  it('WB-L9 / review S4: a coach basis not used is listed under NOT USED; USED names only the history actually read', () => {
    const why = draftWhyView({
      request: 'push',
      rationale: null,
      checks: [],
      fitMinutes: 45,
      loads: [{ name: 'Bench press', target: '102.5 kg', label: null, quote: null, notes: ['last 100×7 @8'], notUsed: 'you hit 110×5 last week' }],
      historyUsed: 'logged',
    });
    expect(why.find((s) => s.heading === 'NOT USED')?.lines).toEqual(['Bench press: “you hit 110×5 last week”']);
    expect(why.find((s) => s.heading === 'USED')?.lines).toEqual(['45 min', 'Logged history']);
    // Nothing from history (first-time estimates only): no history line at all.
    expect(draftWhyView({ request: 'push', rationale: null, checks: [], fitMinutes: 45, historyUsed: null }).find((s) => s.heading === 'USED')?.lines).toEqual(['45 min']);
    expect(draftWhyView({ request: 'push', rationale: null, checks: [], fitMinutes: 45, historyUsed: 'fitnotes' }).find((s) => s.heading === 'USED')?.lines).toEqual(['45 min', 'FitNotes history']);
  });
});

describe('`FROM COACH` in the picker and Today (§4.4, WB29)', () => {
  const draftRow: CoachDraftRow = {
    key: 'coach_draft:d1',
    label: 'Push · 45 min',
    kind: 'named',
    target: { kind: 'coach_draft', draftId: 'd1' },
    routineId: null,
    sourceSessionId: null,
    lastDone: null,
    exerciseCount: 6,
    recommended: false,
    edited: false,
    coachDraft: { createdAt: { utc: '2026-10-12T17:02:00.000Z', tz: 'Europe/London' } },
    draftId: 'd1',
    name: 'Push · 45 min',
    createdAt: { utc: '2026-10-12T17:02:00.000Z', tz: 'Europe/London' },
  };
  const routineRow = { key: 'routine:r1', label: 'Legs A', kind: 'routine' as const, target: { kind: 'routine' as const, routineId: 'r1' }, routineId: 'r1', sourceSessionId: null, lastDone: { utc: '2026-10-08T17:00:00.000Z', tz: 'Europe/London' }, exerciseCount: 5, recommended: true, edited: false };
  const list: SessionList = { upNext: routineRow, workouts: [], fromHistory: [], older: [], recommendedKey: 'routine:r1', fromCoach: [draftRow] };

  it('sits between Up next and `YOUR WORKOUTS`; Today lists it first after Up next; its row says when it was made', () => {
    expect(pickerSections(list).map((s) => [s.title, s.rows.map((r) => r.label)])).toEqual([[null, ['Legs A']], ['From coach', ['Push · 45 min']]]);
    expect(allRows(list).map((r) => r.label)).toEqual(['Legs A', 'Push · 45 min']);
    expect(todaySessions(list, { includeUpNext: false }).rows.map((r) => r.label)).toEqual(['Push · 45 min']);
    expect(pickerRowDetail(draftRow, NOW)).toBe('Today · 6 exercises');
    expect(pickerRowLabel(draftRow, NOW, false)).toBe('Push · 45 min, coach draft, made Today, 6 exercises');
    expect(isShownRow(draftRow, { coachDraftOf: 'd1' })).toBe(true);
    expect(isShownRow(routineRow, { coachDraftOf: 'd1' })).toBe(false);
    expect(fromCoachRowText(draftRow, 'Today 18:02')).toEqual({ title: 'Push · 45 min', detail: 'Today 18:02 · 6 exercises' });
  });
});

describe('minimal copy (CLAUDE.md, 10 Oct)', () => {
  it('no builder string has a reassurance line, a rule name or "routine"', () => {
    const strings = [
      ...Object.values(BUILD_COPY).flatMap((x) => (typeof x === 'string' ? [x] : [])),
      BUILD_COPY.leftOut(1),
      buildCardView({ minutes: 45, days: buildDayChips(DEFAULT_SPLIT), dayId: 'push', gymName: 'Main gym' }).message,
      needsCoachView('offline').line,
      draftCardView(card(), clock).accessibilityLabel,
    ];
    for (const s of strings) {
      expect(s).not.toMatch(/routine|nothing (?:changes|is saved)|unless you|built-in rule|snapped to|don't worry|safe/i);
    }
  });
});
