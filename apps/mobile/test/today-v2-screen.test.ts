import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { defaultTodayControls, type TodayDay } from '@fizz/domain';

import { breakdownLabel, MAX_DAY_SEGMENTS, routeAvailable, TIME_LABELS, todayCardReducer, todaySegments, todayTitle, type TodayCardState } from '../src/today/today-view';

/**
 * Today (v2) screen (workout-builder-v3 §2.0, §2.0.8; prototypes/today-v2.html): the day control's
 * segments and VoiceOver labels, the card's selection reducer, the builder routes' guard, and source
 * checks for what the screen must (and must never) do.
 */

const SRC = join(__dirname, '..', 'src');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');

const day = (key: string, name: string, mains: (string | null)[] = ['bench']): TodayDay => ({
  key,
  kind: key.startsWith('other:') ? 'other' : 'plan',
  name,
  planId: key.startsWith('other:') ? null : 'p',
  dayIndex: key.startsWith('other:') ? null : 0,
  splitDayId: name.toLowerCase(),
  templates: mains.map((m, i) => ({ routineId: `r${String(i)}`, version: 1, label: m ?? name, mainLiftExerciseId: m, exerciseIds: [], minutes: 60, absPlan: true, supersetsPlan: true, groups: [{ group: 'Chest', count: 3 }] })),
});
const DAYS = [day('plan:p:0', 'Chest', ['bench', 'incline']), day('plan:p:1', 'Back'), day('plan:p:2', 'Legs'), day('plan:p:3', 'Shoulders')];
const OTHERS = [day('other:full_body', 'Full body'), day('other:upper', 'Upper'), day('other:push', 'Push')];

describe('day control (§2.0.2 region 5)', () => {
  it('plan days in order, NEXT under the next, `⋯` last; VoiceOver `Chest, next, 1 of 5`', () => {
    const { segments, overflow } = todaySegments({ days: DAYS, others: OTHERS, nextKey: 'plan:p:0', selectedKey: 'plan:p:0', paused: false });
    expect(segments.map((s) => s.label)).toEqual(['Chest', 'Back', 'Legs', 'Shoulders', '⋯']);
    expect(segments[0]).toMatchObject({ next: true, selected: true, accessibilityLabel: 'Chest, next, 1 of 5' });
    expect(segments[1]?.accessibilityLabel).toBe('Back, 2 of 5');
    expect(segments[4]?.accessibilityLabel).toBe('Other sessions, 5 of 5');
    expect(overflow).toEqual([]);
  });

  it('`⋯` shows the picked Other session’s name; more than 4 plan days go in `⋯`; paused: none is NEXT', () => {
    const picked = todaySegments({ days: DAYS, others: OTHERS, nextKey: 'plan:p:0', selectedKey: 'other:push', paused: false });
    expect(picked.segments.at(-1)).toMatchObject({ label: 'Push', selected: true, more: true });
    expect(picked.segments.filter((s) => s.selected)).toHaveLength(1);
    const five = todaySegments({ days: [...DAYS, day('plan:p:4', 'Arms')], others: OTHERS, nextKey: null, selectedKey: null, paused: false });
    expect(five.segments).toHaveLength(MAX_DAY_SEGMENTS + 1);
    expect(five.overflow.map((d) => d.name)).toEqual(['Arms']);
    const paused = todaySegments({ days: DAYS, others: OTHERS, nextKey: 'plan:p:0', selectedKey: 'plan:p:0', paused: true });
    expect(paused.segments.some((s) => s.next)).toBe(false);
  });
});

describe('the card’s selection (the five controls, Mix it up, breakdown)', () => {
  const first = DAYS[0];
  if (first === undefined) throw new Error('day');
  const start: TodayCardState = { dayKey: first.key, controls: defaultTodayControls(first, { goal: 'strength' }), open: true, why: true };

  it('a day pick resets that day’s controls and collapses the card', () => {
    const back = DAYS[1];
    if (back === undefined) throw new Error('day');
    const s = todayCardReducer({ ...start, controls: { ...start.controls, minutes: 40, mix: 2 } }, { kind: 'day', dayKey: back.key, initial: defaultTodayControls(back) });
    expect(s).toMatchObject({ dayKey: back.key, open: false, why: false });
    expect(s.controls).toEqual(defaultTodayControls(back));
  });

  it('main lift, accessories, time ±5, abs (plan: on/off), supersets; Mix it up cycles and Undo restores', () => {
    let s = todayCardReducer(start, { kind: 'main_lift', exerciseId: 'incline' });
    expect(s.controls.mainLiftExerciseId).toBe('incline');
    s = todayCardReducer(s, { kind: 'accessories', value: 'varied' });
    expect(s.controls.accessories).toBe('varied');
    s = todayCardReducer(s, { kind: 'minutes', delta: -1 });
    expect(s.controls.minutes).toBe(55);
    s = todayCardReducer(s, { kind: 'abs', planOn: true });
    expect(s.controls.abs).toBe(false);
    s = todayCardReducer(s, { kind: 'abs', planOn: true });
    expect(s.controls.abs).toBeNull();
    s = todayCardReducer(s, { kind: 'supersets' });
    expect(s.controls.supersets).toBe(false);
    s = todayCardReducer(todayCardReducer(s, { kind: 'mix' }), { kind: 'mix' });
    expect(s.controls.mix).toBe(2);
    expect(todayCardReducer(s, { kind: 'mix_undo' }).controls.mix).toBe(0);
    // A main-lift change is a new draft: Mix it up starts over.
    expect(todayCardReducer(s, { kind: 'main_lift', exerciseId: 'bench' }).controls.mix).toBe(0);
    expect(todayCardReducer(s, { kind: 'breakdown' }).open).toBe(false);
    expect(todayCardReducer(s, { kind: 'why' }).why).toBe(false);
  });

  it('VoiceOver: one button for the breakdown, the time stepper adjustable', () => {
    expect(breakdownLabel('Chest', 'Bench', false)).toBe('Chest, Bench, details, collapsed');
    expect(breakdownLabel('Chest', null, true)).toBe('Chest, details, expanded');
    expect(TIME_LABELS.value(60)).toBe('Time, 60 minutes');
    expect([TIME_LABELS.less, TIME_LABELS.more]).toEqual(['5 minutes less', '5 minutes more']);
  });

  it('title is the weekday; the builder routes are checked before navigating', () => {
    expect(todayTitle('2026-10-20T08:00:00.000Z', 'Europe/London')).toBe('Tuesday');
    expect(routeAvailable([{ routeNames: ['Today', 'Library'] }, { routeNames: ['Tabs', 'Workout'] }], 'BuilderWorkout')).toBe(false);
    expect(routeAvailable([{ routeNames: ['Today'] }, { routeNames: ['Tabs', 'BuilderWorkout'] }], 'BuilderWorkout')).toBe(true);
  });
});

describe('source checks (§2.0.8, CLAUDE.md rules 1–3, accessibility)', () => {
  const screen = read('screens/TodayScreen.tsx');
  const parts = read('screens/today/TodaySession.tsx');

  it('Start is one tap: commit then start, the check-in sheet only when due; never the overview or builder', () => {
    const start = screen.slice(screen.indexOf('async function startCard()'), screen.indexOf('async function editCard()'));
    expect(start).toContain('await commitCard(sel, fresh, commitKey)');
    expect(screen).toContain('return services.todaySession.commit(data2, sel, opId);');
    expect(start).toContain('services.todaySession.start');
    expect(start).toContain("navigation.navigate('CheckIn', { mode: 'start', gymId: g.gymId, coachDraftOf: c.draftId })");
    expect(start).not.toContain('WorkoutOverview');
    expect(start).not.toContain('Builder');
  });

  it('Edit → `BuilderWorkout` { draftId }; Build your own → `BuilderSetup`; both guarded until the builder ships', () => {
    expect(screen).toContain("navigation.navigate('BuilderWorkout', { draftId: c.draftId })");
    expect(screen).toContain("navigation.navigate('BuilderSetup'");
    expect(screen.match(/routeAvailable\(navStates\(navigation\), 'Builder(Workout|Setup)'\)/g)).toHaveLength(2);
  });

  it('the card is the service’s: the screen never builds, fits or progresses a workout itself', () => {
    expect(screen).toContain('services.todaySession.card(');
    for (const banned of ['buildFromSetup', 'fitToMinutes', 'assembleTodayDraft', 'mixItUpShortlist', 'nextTargetsFor', 'snapPlanToGym']) {
      expect(screen).not.toContain(banned);
      expect(parts).not.toContain(banned);
    }
  });

  it('honest AI status: no canned coach text; the coach bar says Offline; the mic opens the coach sheet', () => {
    expect(screen).not.toMatch(/✦ Coach:/);
    expect(parts).toContain('TODAY_V2_COPY.offline');
    expect(screen).toContain("navigation.navigate('Coach', { entry: { kind: 'today' }, focus: true })");
    expect(screen).not.toContain('AskPill');
  });

  it('superseded today.md parts are gone (Up next card, Recent, session picker); Resume, stale, check-in and pain lines stay', () => {
    expect(screen).not.toContain('label="Up next"');
    expect(screen).not.toContain('title="Recent"');
    expect(screen).not.toContain('SessionPickerSheet');
    expect(screen).toContain('label="Resume"');
    expect(screen).toContain('Unfinished · ');
    expect(screen).toContain('checkInLine(unlinked)');
    expect(screen).toContain('todayView.painCheck.text');
  });

  it('44 pt targets, VoiceOver for every gesture, lists at accessibility sizes', () => {
    // Small chips keep 44 pt with hitSlop (34 + 5 + 5) inside 44 pt rows with no gap, so slop never reaches the next
    // row (review S9); segments 48; strip cells ≥ 44 wide.
    expect(parts).toContain('const ROW_H = 44;');
    expect(parts).toContain('const HIT = { top: 5, bottom: 5, left: 4, right: 4 } as const;');
    // Abs and Supersets: the whole row is the switch (a View's hitSlop doesn't enlarge an iOS Switch).
    expect(parts).toContain('accessibilityRole="switch"');
    expect(parts).toContain('accessibilityState={{ checked: value }}');
    expect(parts).not.toMatch(/<View hitSlop=\{HIT\}>\s*<Switch/);
    expect(parts).toMatch(/minHeight: 34,[\s\S]*?hitSlop=\{HIT\}|hitSlop=\{HIT\}[\s\S]*?minHeight: 34,/);
    expect(parts).toContain('minHeight: 48,');
    expect(parts).toContain('minWidth: 44,');
    expect(parts).toContain("accessibilityRole=\"adjustable\"");
    expect(parts).toContain('fontScale >= AX_FONT_SCALE');
    expect(parts.match(/if \(ax\) \{/g)).toHaveLength(2);
    // No swipe gestures on Today (§2.0.5): every action is a tap.
    expect(parts).not.toMatch(/PanResponder|Swipeable|onSwipe/);
  });

  it('Resume never waits for the session card: todaySession loads apart, and not while a workout is open (review S1)', () => {
    const screenData = screen.slice(screen.indexOf('useScreenData(async'), screen.indexOf('useTodaySessionData(data.state'));
    expect(screenData).not.toContain('todaySession.load');
    expect(screen).toContain("useTodaySessionData(data.state === 'ready' && !workoutOpen)");
    expect(screen).toContain('if (!enabled) return;');
  });

  it('an edited card keeps the Main lift chips (review S2); Edit’s op ID is cleared once saved (review S6)', () => {
    const card = parts.slice(parts.indexOf('export function SessionCard('));
    expect(card.indexOf('TODAY_V2_COPY.mainLift')).toBeLessThan(card.indexOf('view.edited === null ?'));
    const edit = screen.slice(screen.indexOf('async function editCard()'), screen.indexOf('function buildYourOwn()'));
    expect(edit).toContain('startOps.current.delete(editKey)');
    expect(edit).toContain('session.equipmentVersion');
  });

  it('no plan: the Other sessions stay a day control after one is picked, with Build your own (review S3)', () => {
    expect(screen).toContain("todaySegments({ days: session.others, others: [], nextKey: null");
    expect(screen).toContain("session.status !== 'no_plan' || view !== null");
  });

  it('the scroll position survives re-renders (one ScrollView, never keyed)', () => {
    expect(screen.match(/<ScrollView/g)).toHaveLength(1);
    expect(screen).not.toMatch(/<ScrollView[^>]*key=/);
  });

  it('minimal copy: no reassurance lines or rule labels on Today', () => {
    for (const t of ['Nothing changes unless', 'built-in rule', 'snapped to', 'plan day 1 of', 'Based on', 'From last review']) {
      expect(screen).not.toContain(t);
      expect(parts).not.toContain(t);
    }
  });
});
