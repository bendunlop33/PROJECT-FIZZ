import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { defaultTodayControls, type TodayDay } from '@fizz/domain';

import { breakdownLabel, MAX_DAY_SEGMENTS, TIME_LABELS, todayActions, todayCardReducer, todaySegments, todayTitle, type TodayCardState } from '../src/today/today-view';

/**
 * Today (v2) screen (workout-builder-v3 §2.0, §2.0.8; prototypes/today-v2.html): the day control's
 * segments and VoiceOver labels, the card's selection reducer, and source
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

  it('title is the weekday', () => {
    expect(todayTitle('2026-10-20T08:00:00.000Z', 'Europe/London')).toBe('Tuesday');
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
    // The check-in route carries the committed version, pinned in the Start's write (integrity S1).
    expect(start).toContain("navigation.navigate('CheckIn', { mode: 'start', gymId: g.gymId, coachDraftOf: c.draftId, coachDraftVersion: c.version })");
    expect(start).not.toContain('WorkoutOverview');
    expect(start).not.toContain('Builder');
  });

  it('Edit → `BuilderWorkout` { draftId, back: Today } (no Set up, review V1); Build your own → `BuilderSetup`; no placeholder or route guard (the builder is in this build)', () => {
    expect(screen).toContain("navigation.navigate('BuilderWorkout', { draftId: c.draftId, back: 'Today' })");
    expect(screen).toContain("navigation.navigate('BuilderSetup'");
    // The builder's routes are in this build: no placeholder toast, no route guard.
    expect(screen).not.toContain('routeAvailable');
    expect(read('today/today-view.ts')).not.toMatch(/isn.t in this build/);
  });

  it('the card is the service’s: the screen never builds, fits or progresses a workout itself', () => {
    expect(screen).toContain('services.todaySession.card(');
    for (const banned of ['buildFromSetup', 'fitToMinutes', 'assembleTodayDraft', 'mixItUpShortlist', 'nextTargetsFor', 'snapPlanToGym']) {
      expect(screen).not.toContain(banned);
      expect(parts).not.toContain(banned);
    }
  });

  it('honest AI status: no canned coach text; the shared coach bar shows the builder coach’s reach; heard words go to askSetup, the bar opens the coach sheet', () => {
    expect(screen).not.toMatch(/✦ Coach:/);
    // The shared bar (its status word is `BUILDER_STATUS_WORD[reach]`: `Offline`, `Coach not connected`).
    expect(screen).toContain('<CoachAskBar');
    expect(screen).toMatch(/services\.builderCoach\s*\.status\(\)/);
    expect(screen).toContain("services.builderCoach.askSetup({ words, opId: newUuid(), from: 'today' })");
    expect(screen).toContain("navigation.navigate('Coach', { entry: { kind: 'today' }, focus: true })");
    expect(screen).not.toContain('AskPill');
    // The nudge's offer is applied only through applyNudge / skipNudge (rule 3; the day is marked done).
    expect(screen).toContain('services.builderCoach.applyNudge(');
    expect(screen).toContain('services.builderCoach.skipNudge(');
    // The nudge reviews the controls on the card now and its offer is keyed on them (wiring S1, integrity S2).
    expect(screen).toContain('services.todaySession.review(session, { dayKey: selection.dayKey, controls: selection.controls }');
    expect(screen).not.toContain('session.initial[selection.dayKey] ?? selection.controls');
    expect(screen).toContain('nudge.key === nudgeKey');
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
    // Strip cells: seven equal columns (flex 1, basis 0), each ≥ 44 pt at 375 pt (20 pt margins, 2 pt gaps, the divider).
    expect(parts).toMatch(/flex: 1,\s*flexBasis: 0,\s*minWidth: 0,/);
    expect((375 - 2 * 20 - 6 * 2 - 1) / 7).toBeGreaterThanOrEqual(44);
    // The Time row (shared with Your workout since 22 Oct; its note per fit-to-time's 22 Oct revision): one adjustable element.
    expect(parts).toContain('<TimeNoteRow');
    expect(read('ui/time-stepper.tsx')).toContain('<TimeStepper minutes={minutes} onStep={onStep} />');
    expect(read('ui/time-stepper.tsx')).toContain("accessibilityRole=\"adjustable\"");
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

  it('no plan: an edited card keeps the Main lift chips (review S2); Edit’s op ID is cleared once saved (review S6)', () => {
    const card = parts.slice(parts.indexOf('export function SessionCard('));
    const noPlan = card.slice(card.indexOf('{view.lean ? ('));
    const rest = noPlan.slice(noPlan.indexOf(') : ('));
    expect(rest.indexOf('TODAY_V2_COPY.mainLift')).toBeGreaterThan(-1);
    expect(rest.indexOf('TODAY_V2_COPY.mainLift')).toBeLessThan(rest.indexOf('view.edited === null ?'));
    const edit = screen.slice(screen.indexOf('async function editCard()'), screen.indexOf('function buildYourOwn()'));
    expect(edit).toContain('startOps.current.delete(editKey)');
    expect(edit).toContain('session.equipmentVersion');
  });

  it('no plan: the Other sessions stay a day control after one is picked, with Build your own (review S3)', () => {
    expect(screen).toContain("todaySegments({ days: session.others, others: [], nextKey: null");
    expect(screen).toContain("noPlan: session?.status === 'no_plan', cardShown: view !== null");
    // A picked Other session keeps Build your own (secondary beside the card's Start).
    expect(todayActions({ openWorkout: false, read: 'ready', noPlan: true, cardShown: true, upNext: false }).buildYourOwn).toBe('secondary');
  });

  it('no plan is compact (§2.0.4; Ben 21 Oct): `No plan` and `Set up a plan ›` on one row, Other sessions as chips, Build your own primary beside ＋ Activity', () => {
    const block = screen.slice(screen.indexOf('const sessionBlock = '), screen.indexOf('return (\n    <View style={{ flex: 1, backgroundColor'));
    const noPlan = block.slice(block.indexOf('view === null ? ('), block.indexOf(') : (', block.indexOf('view === null ? (')));
    expect(noPlan).toContain('TODAY_V2_COPY.noPlan');
    expect(noPlan).toContain('TODAY_V2_COPY.setUpPlan');
    expect(noPlan).toContain('<OtherSessionChips');
    // The old tall list (one 52 pt row per session, then Empty workout) is gone.
    expect(noPlan).not.toContain('session.others.map(');
    expect(noPlan).not.toContain('<PrimaryButton');
    const chips = parts.slice(parts.indexOf('export function OtherSessionChips('), parts.indexOf('// The session card'));
    expect(chips).toContain("flexWrap: 'wrap'");
    expect(chips).toContain('minHeight: theme.target.min.height');
    expect(chips).toContain('accessibilityRole="button"');
    expect(chips).toContain('chip(\'empty\', emptyLabel, onEmpty)');
    const bottom = screen.slice(screen.indexOf("{actions.buildYourOwn === 'primary' ? ("));
    expect(bottom.slice(0, 400)).toContain('<PrimaryButton label={TODAY_V2_COPY.buildYourOwn}');
    expect(todayActions({ openWorkout: false, read: 'ready', noPlan: true, cardShown: false, upNext: false })).toEqual({ gymRow: true, failed: false, upNext: false, buildYourOwn: 'primary', emptyWorkout: false });
  });

  it('a failed read of Today’s session says Couldn’t load with Try again, never `No plan` (as Library, review planview S5)', () => {
    const hook = screen.slice(screen.indexOf('function useTodaySessionData('));
    expect(hook).not.toContain('.catch(() => null)');
    expect(hook).toContain('setFailed(bad)');
    expect(screen).toContain('actions.failed ? <StatusLine');
    expect(screen).toContain('TODAY_SCREEN_COPY.sessionFailed');
    const svc = read('services/today-session.ts');
    expect(svc).toContain('await repos().planDrafts.applied(p.id);');
    expect(svc).not.toContain('planDrafts.applied(p.id).catch');
    expect(svc).toContain('await repos().routines.listByOwner(p.id));');
  });

  it('session area actions by state (review today-fix-21oct B1, S2, S3, S4): a failed read still offers Build your own (primary) and Empty workout; the gym chip shows while loading and after a failure; No plan with Up next makes it the main action', () => {
    const failed = todayActions({ openWorkout: false, read: 'failed', noPlan: false, cardShown: false, upNext: false });
    expect(failed).toEqual({ gymRow: true, failed: true, upNext: false, buildYourOwn: 'primary', emptyWorkout: true });
    const loading = todayActions({ openWorkout: false, read: 'loading', noPlan: false, cardShown: false, upNext: false });
    expect(loading).toMatchObject({ gymRow: true, failed: false, buildYourOwn: null });
    const withNext = todayActions({ openWorkout: false, read: 'ready', noPlan: true, cardShown: false, upNext: true });
    expect(withNext).toMatchObject({ upNext: true, buildYourOwn: 'secondary' });
    // A picked Other session replaces Up next with its card.
    expect(todayActions({ openWorkout: false, read: 'ready', noPlan: true, cardShown: true, upNext: true }).upNext).toBe(false);
    // With a plan the fallback never shows (the service gives none either).
    expect(todayActions({ openWorkout: false, read: 'ready', noPlan: false, cardShown: true, upNext: true }).upNext).toBe(false);
    expect(todayActions({ openWorkout: true, read: 'failed', noPlan: true, cardShown: false, upNext: true })).toEqual({ gymRow: false, failed: false, upNext: false, buildYourOwn: null, emptyWorkout: false });
    // The screen draws what this says: the Up next row starts it in one tap through Today's one Start (gym, alerts,
    // check-in gate, op ID kept per intent), never the overview (OV11).
    expect(screen).toContain("void start({ kind: 'routine', routineId: upNext.routineId })");
    expect(screen).toContain("void start({ kind: 'next', sourceSessionId: upNext.sourceSessionId })");
    expect(screen).toContain("navigation.navigate('CheckIn', { mode: 'start', gymId: g.gymId, ...of });");
    expect(screen).not.toContain("navigate('WorkoutOverview'");
    // (D8) Changed on Your workout (by Ben, or a coach change he applied in chat): `· edited`, and its draft starts.
    expect(screen).toContain('accessibilityLabel={TODAY_SCREEN_COPY.upNextLabel(upNextTitle)}');
    expect(screen).toContain('upNext.edited != null ? `${upNext.title} · ${TODAY_V2_COPY.edited}` : upNext.title');
    expect(screen).toContain('if (upNext.edited != null) void startUpNextDraft(upNext.edited);');
    expect(screen).toContain("{actions.emptyWorkout ? (");
  });

  it('the header clears the status bar: the safe-area top inset pads the scroll content (Ben 21 Oct: Wednesday ran under the clock)', () => {
    expect(screen).toContain("import { useSafeAreaInsets } from 'react-native-safe-area-context';");
    expect(screen).toContain('const insets = useSafeAreaInsets();');
    expect(screen).toContain("paddingTop: insets.top + theme.space['3']");
    // Every Today state, the error screen too (review today-fix-21oct S1): no fixed top padding left.
    const errorScreen = screen.slice(screen.indexOf("if (data.state === 'error') {"), screen.indexOf('const { gym, view: todayView'));
    expect(errorScreen).toContain("paddingTop: insets.top + theme.space['3']");
    expect(screen).not.toContain("paddingTop: theme.space['8']");
    // A bare tab screen has no navigation controller, so `automatic` never insets it; Today pads itself.
    expect(screen).toContain('contentInsetAdjustmentBehavior="never"');
    expect(screen).not.toContain('contentInsetAdjustmentBehavior="automatic"');
  });

  it('header is one line (§2.0.2, prototype `.hdr`): day name left (shrinks to fit), compact `✦ Coach` + mic right; the gym chip on the session row', () => {
    const header = parts.slice(parts.indexOf('export function TodayHeader('), parts.indexOf('// The 7-day strip'));
    expect(header).toContain("flexDirection: 'row'");
    expect(header).not.toContain('flexWrap');
    expect(header).toContain('numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}');
    expect(header).not.toContain('gym');
    const call = screen.slice(screen.indexOf('<TodayHeader'), screen.indexOf('{strip.length > 0'));
    expect(call).toContain('<CoachAskBar');
    expect(call).toMatch(/page="today"\s+compact/);
    expect(call).not.toContain('GymChip');
    const row = screen.slice(screen.indexOf('const gymRow = '));
    expect(row.indexOf('<Eyebrow>{TODAY_V2_COPY.session}</Eyebrow>')).toBeGreaterThan(0);
    expect(row.indexOf('<Eyebrow>{TODAY_V2_COPY.session}</Eyebrow>')).toBeLessThan(row.indexOf('<GymChip'));
  });

  it('strip labels: centred, one line, shrink to fit (no `…`), pill colours from strip-style', () => {
    const strip = parts.slice(parts.indexOf('function StripPill('), parts.indexOf('/** A day’s sheet'));
    expect(strip).toContain('{...STRIP_LABEL_FIT}');
    expect(strip).toContain('align="center"');
    expect(strip).toContain('stripPillStyle(item, theme)');
    expect(strip).not.toContain('status.done.subtle');
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
