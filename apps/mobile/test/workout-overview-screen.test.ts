import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { StackRouter, type ParamListBase, type StackNavigationState } from '@react-navigation/routers';
import { describe, expect, it } from 'vitest';

import type { OverviewRow } from '@fizz/domain';
import type { CheckIn } from '@fizz/schemas';

import { openStartedWorkout, popToTabs } from '../src/navigation/actions';
import {
  CHECK_IN_TILES_WIDTH,
  checkInForStart,
  checkInRow,
  checkInRowLayout,
  checkInSheetEnd,
  eyebrowText,
  gymToastText,
  OVERVIEW_COPY,
  overviewLayout,
  panelReducer,
  rowDetail,
  startCheckIn,
  startFailure,
  statStripStacked,
  targetsChanged,
  tileLabel,
} from '../src/workout/overview';

/**
 * The Workout overview screen's own rules (workout-overview.md §2, §3, §8,
 * §9), the route through the stack, and source checks for what must never
 * render (OV8 coach, OV11 resume paths, OV13 one filled pill).
 */
const SRC = join(__dirname, '..', 'src');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');

const checkIn = (score: 1 | 2 | 3 | 4 | 5, id = 'ci-1'): CheckIn =>
  ({ id, ownerId: 'o', version: 1, score, reasons: [], outcome: 'not_started', recordedAt: { utc: '2026-10-10T17:00:00.000Z', tz: 'Europe/London' } }) as unknown as CheckIn;

describe('row panel: one open at a time (§3.8)', () => {
  it('a tap toggles in place; another row moves it; a reload keeps it only if the row is still there', () => {
    expect(panelReducer(null, { kind: 'toggle', rowId: 'a' })).toBe('a');
    expect(panelReducer('a', { kind: 'toggle', rowId: 'a' })).toBeNull();
    expect(panelReducer('a', { kind: 'toggle', rowId: 'b' })).toBe('b');
    expect(panelReducer('a', { kind: 'rows', rowIds: ['a', 'b'] })).toBe('a');
    expect(panelReducer('a', { kind: 'rows', rowIds: ['b'] })).toBeNull();
    expect(panelReducer('a', { kind: 'close' })).toBeNull();
  });
});

describe('inline check-in (§3.9, §2.2, OV2, OV10)', () => {
  const now = '2026-10-10T17:10:00.000Z';
  it('due: no selection, and Start with no score records skipped', () => {
    const row = checkInRow({ kind: 'ask' }, null);
    expect(row).toEqual({ shown: true, selected: null, record: null });
    expect(startCheckIn({ kind: 'ask' }, row, now)).toEqual({ kind: 'skipped', atUtc: now });
  });
  it('reused (< 2 h): shown selected and linked by Start; a score tapped here wins', () => {
    const reused = checkIn(4, 'ci-old');
    const row = checkInRow({ kind: 'reuse', checkIn: reused }, null);
    expect(row.selected).toBe(4);
    expect(startCheckIn({ kind: 'reuse', checkIn: reused }, row, now)).toEqual({ kind: 'answered', checkInId: 'ci-old' });
    const tapped = checkIn(2, 'ci-new');
    expect(checkInRow({ kind: 'reuse', checkIn: reused }, tapped)).toMatchObject({ selected: 2, record: { id: 'ci-new' } });
  });
  it('not due: no row; Start records why it wasn’t asked', () => {
    const off = { kind: 'skip', reason: 'off' } as const;
    expect(checkInRow(off, null).shown).toBe(false);
    expect(startCheckIn(off, checkInRow(off, null), now)).toEqual({ kind: 'not_asked', reason: 'off' });
    const decided = { kind: 'skip', reason: 'already_decided' } as const;
    expect(startCheckIn(decided, checkInRow(decided, null), now)).toBeNull();
  });
  it('VoiceOver reads each tile with its meaning at the ends', () => {
    expect([1, 2, 3, 4, 5].map((n) => tileLabel(n as 1 | 2 | 3 | 4 | 5))).toEqual(['1 of 5, rough', '2 of 5', '3 of 5', '4 of 5', '5 of 5, great']);
  });
});

describe('r2 B1: the check-in Start sends, decided after the score write (§2.2)', () => {
  const now = '2026-10-10T17:10:00.000Z';
  const ask = { kind: 'ask' } as const;
  it('a check-in from the `Check-in ›` sheet the page hasn’t reloaded for: the gate finds it and it is linked', () => {
    expect(checkInForStart({ rendered: ask, tapped: null, gateNow: { kind: 'reuse', checkInId: 'ci-sheet' }, nowUtc: now })).toEqual({ kind: 'answered', checkInId: 'ci-sheet' });
  });
  it('a score tapped on the page wins over the gate', () => {
    expect(checkInForStart({ rendered: ask, tapped: checkIn(2, 'ci-tap'), gateNow: { kind: 'reuse', checkInId: 'ci-other' }, nowUtc: now })).toEqual({ kind: 'answered', checkInId: 'ci-tap' });
  });
  it('nothing new: a due check-in left alone is skipped; a failed gate read falls back to the page', () => {
    expect(checkInForStart({ rendered: ask, tapped: null, gateNow: ask, nowUtc: now })).toEqual({ kind: 'skipped', atUtc: now });
    expect(checkInForStart({ rendered: ask, tapped: null, gateNow: null, nowUtc: now })).toEqual({ kind: 'skipped', atUtc: now });
  });
  it('N1: a reused check-in the page showed stands even if it aged past 2 h while the page was open', () => {
    const reused = { kind: 'reuse', checkIn: checkIn(4, 'ci-old') } as const;
    expect(checkInForStart({ rendered: reused, tapped: null, gateNow: ask, nowUtc: now })).toEqual({ kind: 'answered', checkInId: 'ci-old' });
    expect(checkInForStart({ rendered: reused, tapped: null, gateNow: { kind: 'reuse', checkInId: 'ci-old' }, nowUtc: now })).toEqual({ kind: 'answered', checkInId: 'ci-old' });
  });
  it('no check-in row on the page: the gate isn’t consulted', () => {
    const off = { kind: 'skip', reason: 'off' } as const;
    expect(checkInForStart({ rendered: off, tapped: null, gateNow: { kind: 'reuse', checkInId: 'x' }, nowUtc: now })).toEqual({ kind: 'not_asked', reason: 'off' });
  });
});

describe('the check-in sheet over the overview (§2.2, review S6)', () => {
  it('over the overview, or with no gym to start at, every finishing exit returns to the page; otherwise it starts', () => {
    expect(checkInSheetEnd({ overview: true, gymId: null })).toBe('back_to_overview');
    expect(checkInSheetEnd({ overview: true, gymId: 'g' })).toBe('back_to_overview');
    expect(checkInSheetEnd({ overview: false, gymId: null })).toBe('back_to_overview');
    expect(checkInSheetEnd({ overview: false, gymId: 'g' })).toBe('start_workout');
  });
  it('Done, Skip, Not now, Flag, Train anyway and a 4–5 at the score all finish through start(), which checks the mode first; Skip workout goes to Today', () => {
    const src = read('screens/workout/CheckInScreen.tsx');
    const sheet = src.slice(src.indexOf('function StartCheckIn('), src.indexOf('function EditCheckIn('));
    const startBody = sheet.slice(sheet.indexOf('async function start('), sheet.indexOf('const savedToast'));
    // The mode check comes before any write: over the overview nothing starts.
    expect(startBody.indexOf("checkInSheetEnd({ overview: overview !== undefined, gymId }) === 'back_to_overview'")).toBeGreaterThan(-1);
    expect(startBody.indexOf('navigation.goBack()')).toBeLessThan(startBody.indexOf('services.workout.start('));
    // The only workout start in the sheet is inside start().
    expect(sheet.match(/services\.workout\.start\(/g)).toHaveLength(1);
    const body = (name: string) => sheet.slice(sheet.indexOf(`async function ${name}(`), sheet.indexOf('\n  }\n', sheet.indexOf(`async function ${name}(`)));
    // pickScore (a 4–5 at AX sizes), done (Done), afterPain (Not now, Flag, via flagPain) each end in start().
    for (const name of ['pickScore', 'done', 'afterPain']) expect(body(name)).toContain('await start(');
    expect(body('flagPain')).toContain('await afterPain(');
    expect(sheet).toContain('onPress={() => void afterPain(null)}');
    // Skip and Train anyway call start() directly.
    expect(sheet.match(/void start\(\{ kind: 'answered', checkInId: record\.id \}/g)?.length).toBeGreaterThanOrEqual(2);
    expect(body('skipWorkout')).toContain('popToToday(');
    expect(body('skipWorkout')).not.toContain('start(');
  });
  it('r2 N3/N4: over the overview, Skip’s hint doesn’t promise a start, and a score that fails to save says so on the sheet', () => {
    const src = read('screens/workout/CheckInScreen.tsx');
    expect(src).toContain("accessibilityHint={overview ? 'Keeps your score.' : 'Keeps your score and starts the workout.'}");
    const pick = src.slice(src.indexOf('async function pickScore('), src.indexOf('async function done('));
    expect(pick.indexOf('setError(CHECK_IN_NOT_SAVED)')).toBeGreaterThan(-1);
    expect(pick.indexOf('setError(CHECK_IN_NOT_SAVED)')).toBeLessThan(pick.indexOf('Your workout started as normal'));
  });
  it('r2 N2: no reassurance lead on the score step; Delete confirms with no rule line', () => {
    expect(read('screens/workout/CheckInScreen.tsx')).not.toContain('Nothing changes unless you say so');
    expect(read('screens/workout/WorkoutOverviewScreen.tsx')).not.toContain('Past workouts keep their name');
    expect(read('screens/TodayScreen.tsx')).not.toContain('Past workouts keep their name');
  });
  it('N1: with a saved score to load, the scale waits for it (no second check-in)', () => {
    const src = read('screens/workout/CheckInScreen.tsx');
    expect(src).toContain('disabled={existingId !== null && record === null}');
    expect(src).toContain('if (busy || (existingId !== null && record === null)) return;');
  });
});

describe('words on the page (§3.2, §9)', () => {
  const day = (ms: number) => (ms === Date.parse('2026-10-08T17:00:00.000Z') ? 'Thu 8 Oct' : '?');
  const at = { utc: '2026-10-08T17:00:00.000Z', tz: 'Europe/London' };
  it('eyebrow variants', () => {
    expect(eyebrowText({ kind: 'after', routineName: 'Pull A', at }, day)).toBe('After Pull A · Thu 8 Oct');
    expect(eyebrowText({ kind: 'only' }, day)).toBe('Only routine');
    expect(eyebrowText({ kind: 'rotation_start' }, day)).toBe('Start of your rotation');
    expect(eyebrowText({ kind: 'last_done', at }, day)).toBe('Last done Thu 8 Oct');
    expect(eyebrowText({ kind: 'next_from', at }, day)).toBe('Next session · from Thu 8 Oct');
    expect(eyebrowText({ kind: 'new_routine' }, day)).toBe('New routine');
  });
  it('every fixed string is in the spec’s copy list or states table (minimal copy)', () => {
    const spec = readFileSync(join(__dirname, '..', '..', '..', 'docs', 'design', 'workout-overview.md'), 'utf8');
    const norm = (t: string) => t.replaceAll('’', "'").toLowerCase();
    const copy = norm(spec.slice(spec.indexOf('## 8. States'), spec.indexOf('## 10.')));
    for (const text of Object.values(OVERVIEW_COPY)) expect(copy).toContain(norm(text.replace(/\.$/, '')));
  });
  it('the gym toast counts the rows whose targets changed', () => {
    const row = (exerciseId: string, value: string, detail = '3 × 8'): OverviewRow => ({ exerciseId, load: { value, unit: 'kg', spoken: '', none: false }, detail }) as unknown as OverviewRow;
    const before = [row('a', '100'), row('b', '32'), row('c', '17.5')];
    const after = [row('a', '100'), row('b', '30'), row('c', '—')];
    expect(targetsChanged(before, after)).toBe(2);
    expect(gymToastText('Hotel gym', 2)).toBe('Hotel gym · 2 targets changed');
    expect(gymToastText('Hotel gym', 1)).toBe('Hotel gym · 1 target changed');
    expect(gymToastText('Hotel gym', 0)).toBe('Hotel gym');
  });
});

describe('Dynamic Type and failures (§8, OV14)', () => {
  it('stacks at AX sizes and drops the warm-up fragment first', () => {
    expect(overviewLayout(1).stacked).toBe(false);
    expect(overviewLayout(1.35).stacked).toBe(false);
    expect(overviewLayout(1.65).stacked).toBe(true);
    const row = { detail: '3 × 6–8 · 3 warm-ups', warmups: '3 warm-ups' };
    expect(rowDetail(row, false)).toBe('3 × 6–8 · 3 warm-ups');
    expect(rowDetail(row, true)).toBe('3 × 6–8');
    expect(rowDetail({ detail: '3 × 8', warmups: null }, true)).toBe('3 × 8');
  });
  it('r2 S2: the stat strip stacks at AX, or once a value wrapped at this width and text size (sticky until either changes)', () => {
    expect(statStripStacked({ ax: true, width: 390, fontScale: 1.65, wrappedAt: null })).toBe(true);
    expect(statStripStacked({ ax: false, width: 390, fontScale: 1.235, wrappedAt: null })).toBe(false);
    const wrap = { width: 390, fontScale: 1.235 };
    expect(statStripStacked({ ax: false, width: 390, fontScale: 1.235, wrappedAt: wrap })).toBe(true);
    // Text size or width changed: measure again in columns.
    expect(statStripStacked({ ax: false, width: 390, fontScale: 1, wrappedAt: wrap })).toBe(false);
    expect(statStripStacked({ ax: false, width: 430, fontScale: 1.235, wrappedAt: wrap })).toBe(false);
  });
  it('B2: the check-in row fits by measured width: inline, label over the tiles, or collapsed', () => {
    expect(CHECK_IN_TILES_WIDTH).toBe(274);
    // 390 pt phone, 20 pt margins (350 available), default text: label (~64) + 12 + 274 = 350 fits.
    expect(checkInRowLayout({ available: 350, labelWidth: 64, fontScale: 1 })).toBe('inline');
    // A 375 pt phone at the default size, or xLarge–xxxLarge (×1.12–×1.35, below AX): label over the tiles.
    expect(checkInRowLayout({ available: 335, labelWidth: 64, fontScale: 1 })).toBe('over');
    expect(checkInRowLayout({ available: 350, labelWidth: 86, fontScale: 1.35 })).toBe('over');
    expect(checkInRowLayout({ available: 350, labelWidth: null, fontScale: 1.12 })).toBe('over');
    // AX sizes, or no room even for the tiles: `Check-in ›`.
    expect(checkInRowLayout({ available: 350, labelWidth: 64, fontScale: 1.65 })).toBe('collapsed');
    expect(checkInRowLayout({ available: 270, labelWidth: 40, fontScale: 1 })).toBe('collapsed');
  });
  it('a stale preview re-renders, an active workout goes to Today, anything else says Couldn’t start', () => {
    expect(startFailure('stale_preview')).toEqual({ kind: 'stale' });
    expect(startFailure('session_already_active')).toEqual({ kind: 'active' });
    expect(startFailure('write_failed')).toEqual({ kind: 'failed' });
  });
});

describe('route through the stack (§2.1)', () => {
  const routeNames = ['Tabs', 'WorkoutOverview', 'Workout', 'CheckIn', 'PainFlag', 'HowTo'];
  const router = StackRouter({});
  const options = { routeNames, routeParamList: {}, routeGetIdList: {} };
  type State = StackNavigationState<ParamListBase>;
  const apply = (state: State, action: Parameters<typeof router.getStateForAction>[1]): State => {
    const next = router.getStateForAction(state, action, options);
    if (next === null || next.stale) throw new Error(`action not handled: ${action.type}`);
    return next as State;
  };
  const names = (s: State) => s.routes.map((r) => r.name);
  const navigate = (name: string, params: object = {}) => ({ type: 'NAVIGATE', payload: { name, params } }) as const;

  it('Today → overview → What’s up? → back to the overview → Start leaves [Tabs, Workout]', () => {
    let s = apply(router.getInitialState(options), navigate('WorkoutOverview', { target: { kind: 'next' } }));
    s = apply(s, navigate('CheckIn', { mode: 'overview', checkInId: 'ci-1' }));
    expect(names(s)).toEqual(['Tabs', 'WorkoutOverview', 'CheckIn']);
    s = apply(s, { type: 'GO_BACK' });
    expect(names(s)).toEqual(['Tabs', 'WorkoutOverview']);
    s = apply(s, openStartedWorkout() as unknown as Parameters<typeof router.getStateForAction>[1]);
    expect(names(s)).toEqual(['Tabs', 'Workout']);
  });

  it('Close returns to Today with nothing started; Delete returns to Today with Undo', () => {
    let s = apply(router.getInitialState(options), navigate('WorkoutOverview', { target: { kind: 'routine', routineId: 'r1' } }));
    expect(names(apply(s, { type: 'GO_BACK' }))).toEqual(['Tabs']);
    s = apply(s, popToTabs({ screen: 'Today', params: { toast: 'Deleted Push A', undoRoutine: { id: 'r1', version: 2 } } }));
    expect(names(s)).toEqual(['Tabs']);
    expect(s.routes[0]?.params).toEqual({ screen: 'Today', params: { toast: 'Deleted Push A', undoRoutine: { id: 'r1', version: 2 } } });
  });
});

describe('source checks', () => {
  const screen = read('screens/workout/WorkoutOverviewScreen.tsx');
  const ui = read('ui/overview.tsx');

  it('OV8: coach UI renders only from a stored coach row (row.coach); none means no tag, pill or text', () => {
    // The tag and the Undo / Use coach target pill are gated on `row.coach`, which the domain sets only from stored targets.
    expect(ui).toContain("{row.coach?.state === 'coach' ? <CoachTag /> : null}");
    expect(ui).toContain("const coachLabel = row.coach === null ? null : row.coach.state === 'coach' ? 'Undo' : 'Use coach target';");
    expect(ui).toContain('{coachLabel !== null && onCoach ?');
    expect(screen).not.toMatch(/CoachSlot/);
    // Opening the page never calls the coach: the screen only taps a stored row.
    expect(screen).not.toMatch(/services\.coach\.(?:send|ask|turn|summary|run)/);
    const code = screen.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code.match(/services\.coach\.\w+/g)?.every((m) => m === 'services.coach.tapNextTarget')).toBe(true);
  });

  it('OV13: Start is the only filled pill; a selected tile is accent.subtle + a 2 pt accent border, never an accent fill; ≥ 20 pt from Start', () => {
    expect(screen.match(/<PrimaryButton\b/g)).toHaveLength(1);
    const scale = ui.slice(ui.indexOf('export function CheckInScale'));
    expect(scale).toContain("backgroundColor: on ? theme.colors['accent.subtle']");
    expect(scale).toContain('borderWidth: on ? 2 : 1');
    expect(scale).not.toMatch(/backgroundColor: on \? theme\.colors\.accent\b/);
    expect(screen).toContain("marginTop: row?.shown ? theme.space['5']");
  });

  it('OV11: Resume, the stale card and P6 auto-open never reach the overview', () => {
    expect(read('navigation/initial-state.ts')).not.toContain('WorkoutOverview');
    expect(read('screens/workout/WorkoutScreen.tsx')).not.toContain('WorkoutOverview');
    const today = read('screens/TodayScreen.tsx');
    // Today opens it only through `openOverview`, from Up next, Start next session and routine rows.
    expect(today.match(/navigate\('WorkoutOverview'/g)).toHaveLength(1);
    expect(today.match(/openOverview\(/g)?.length).toBe(5);
  });

  it('OV9: the page makes no network or provider call', () => {
    expect(screen).not.toMatch(/@fizz\/providers|fetch\(/);
    expect(read('services/workout-services.ts')).not.toMatch(/@fizz\/providers|fetch\(/);
  });

  it('B1/S2/S7: Start waits for a score being written; tiles are off while one is; both Starts share one guard and keep one opId per page', () => {
    // r2 B1/S1: the check-in step of Start runs through checkInAtStart (tested on SQLite), with the write still running at the tap.
    expect(screen).toContain('const pending = scoreGuard.running() ? scoreWrite.current : null;');
    expect(screen).toContain('checkInAtStart(');
    expect(screen).toContain("if (decided.kind === 'reasons_open' || !navigation.isFocused()) return;");
    expect(screen).toContain('scoreWrite.current = write;');
    expect(screen).not.toContain('startCheckIn(');
    expect(screen).toContain('disabled={busy || scoring}');
    // r3 S1: both the inline tiles and the AX `Check-in ›` button are off while Start or a score write runs.
    expect(screen.match(/disabled=\{busy \|\| scoring\}/g)).toHaveLength(2);
    expect(screen).toMatch(/OVERVIEW_COPY\.checkIn\} ›`[^\n]*\n\s*disabled=\{busy \|\| scoring\}\n\s*onPress=\{\(\) => \{\n\s*navigation\.navigate\('CheckIn'/);
    // r3 S1: focus is re-checked after the write, right before the stack reset.
    expect(screen).toMatch(/if \(r\.kind === 'started'\) \{\n\s*changed\(\);\n\s*\/\/[^\n]*\n\s*if \(!navigation\.isFocused\(\)\) return;\n\s*navigation\.dispatch\(openStartedWorkout\(r\.outcome/);
    expect(screen).toContain('if (!page || busy || scoreGuard.running()) return;');
    expect(screen.match(/await startGuard\.run\(/g)).toHaveLength(2);
    expect(screen).toContain('startOp.current ??= newUuid();');
    expect(screen).toContain('emptyOp.current ??= newUuid();');
    // The writes themselves live in overview-start.ts (tested on real SQLite); the screen never calls them directly.
    expect(screen).not.toMatch(/services\.overview\.start\(\{|services\.checkIns\.record\(\{/);
  });

  it('B2/OV14: no fixed height or width wraps text that scales; the chip moves under the bar at AX sizes; panel labels stack', () => {
    const sizes = (src: string) => [...src.matchAll(/\b(height|width): (\d+)/g)].map((m) => `${m[1] ?? ''}:${m[2] ?? ''}`);
    // Only icon buttons (44), the superset bar (3), the fade (14) and the tiles (50 × 52; their digit is capped at ×1.4).
    expect(sizes(screen).sort()).toEqual(['height:14', 'height:44', 'height:44', 'width:44', 'width:44']);
    expect(sizes(ui).sort()).toEqual(['height:52', 'width:3', 'width:50']);
    expect(ui).toMatch(/height: 52,[\s\S]*maxFontSizeMultiplier=\{1\.4\}/);
    expect(screen).toContain('minHeight: 48');
    expect(screen).toContain('minHeight: 34');
    expect(screen).toContain('{stacked ? null : gymChip}');
    expect(screen).toContain('{stacked && gymChip ?');
    expect(ui).toContain("flexDirection: stacked ? 'column' : 'row', columnGap");
    expect(ui).toContain('minWidth: stacked ? undefined : 80');
    expect(screen).toContain('checkInRowLayout({ available: rowWidth ??');
    // r2 S2: the strip stacks by a measured wrap, not only at AX.
    expect(ui).toContain('statStripStacked({ ax, width, fontScale, wrappedAt })');
    expect(ui).toContain('e.nativeEvent.lines.length > 1');
  });

  it('Reduce Motion: the panel appears without the height animation', () => {
    expect(screen).toContain('if (!theme.a11y.reduceMotion) LayoutAnimation.configureNext');
  });
});
