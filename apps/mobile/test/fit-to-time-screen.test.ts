import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { howLongSheet, stepFitMinutes, type FitView, type OverviewRow, type WorkoutOverview } from '@fizz/domain';

import { bringBackOf, FIT_COPY, fitCardCollapsed, fitHeaderSuffix, howLongOpen, timeTile } from '../src/workout/fit-view';
import { listHeaderText } from '../src/workout/overview-edits';

/**
 * Fit to time on the overview screen (fit-to-time.md §3, §7, FT-C1, FT-C18):
 * the pure screen rules (tile, header, Bring back, card fold, sheet state),
 * and source checks: the screen and components compute nothing, call no
 * coach in this build, show no animation (Reduce Motion), carry icon + word
 * for status, and the page's Start stays its only filled pill.
 */

const SRC = join(__dirname, '..', 'src');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const fit = (over: Partial<FitView> = {}): FitView => ({
  editId: 'fit-1',
  minutes: 45,
  by: 'built_in',
  actionId: null,
  status: 'fitted',
  title: 'Fitted to 45 min',
  beforeAfter: '≈ 60 → 45 min',
  beforeMinutes: 60,
  afterMinutes: 45,
  beforeSeconds: 3600,
  afterSeconds: 2670,
  lines: ['Cable fly · skipped'],
  tileLabel: 'Time · fit 45',
  accessibilityLabel: 'Fitted to 45 minutes. About 60 minutes to about 45 minutes. Cable fly skipped.',
  collapsed: 'Fitted to 45 min · ≈ 45 min',
  ...over,
});
const view = (over: Partial<WorkoutOverview> = {}): Pick<WorkoutOverview, 'estimate' | 'fit' | 'exerciseCount' | 'editCount'> => ({
  estimate: { minutes: 60, seconds: 3600 },
  fit: null,
  exerciseCount: 5,
  editCount: 0,
  ...over,
});

describe('the TIME tile is the How long? button (FT1, FT-C1)', () => {
  it('`TIME` with no fit; `Time · fit 45` with a clock once fitted; one VoiceOver element ending How long?', () => {
    expect(timeTile(view(), 'Time')).toEqual({ label: 'Time', clock: false, accessibilityLabel: 'Time, about 60 minutes. How long?' });
    expect(timeTile(view({ estimate: { minutes: 45, seconds: 2670 }, fit: fit() }), 'Time')).toEqual({ label: 'Time · fit 45', clock: true, accessibilityLabel: 'Time, about 45 minutes, fitted to 45. How long?' });
    expect(timeTile(view({ estimate: null }), 'Time')).toBeNull();
  });

  it('the sheet opens on the live fit’s length (`Change`), else the domain’s default; Other steps 5 min within 15–180', () => {
    expect(howLongOpen(null)).toEqual({ chosen: null, other: false, info: false });
    expect(howLongOpen(fit({ minutes: 30 }))).toEqual({ chosen: 30, other: false, info: false });
    const s = howLongSheet({ nowSeconds: 3600, nowMinutes: 60, unfittedSeconds: 3600, fitMinutes: null, chosen: null, coachAvailable: false });
    expect(s.selected).toBe(45);
    expect(stepFitMinutes(15, -5)).toBe(15);
    expect(stepFitMinutes(180, 5)).toBe(180);
    expect(stepFitMinutes(45, 5)).toBe(50);
  });
});

describe('the list and the rows with a fit (§3.3)', () => {
  it('`5 exercises · fitted`, `5 exercises · 2 edited · fitted`', () => {
    expect(listHeaderText(view({ fit: fit() }))).toBe('5 exercises · fitted');
    expect(listHeaderText(view({ fit: fit(), editCount: 2 }))).toBe('5 exercises · 2 edited · fitted');
    expect(listHeaderText(view())).toBe('5 exercises');
    expect(fitHeaderSuffix(view({ fit: fit() }))).toBe('fitted');
  });

  it('Bring back on a fit-skipped row is Ben’s sets edit at its count; on a skipped row, the skip’s Undo', () => {
    const row = (edit: OverviewRow['edit']): Pick<OverviewRow, 'edit' | 'slotKey'> => ({ edit, slotKey: 'slot-1' });
    expect(bringBackOf(row({ kind: 'skipped', editId: 'fit-1', fitKeep: 3 }))).toEqual({ kind: 'keep', slotKey: 'slot-1', workingSets: 3 });
    expect(bringBackOf(row({ kind: 'skipped', editId: 'skip-1' }))).toEqual({ kind: 'undo', editId: 'skip-1' });
    expect(bringBackOf(row(null))).toBeNull();
  });

  it('the card folds after the first scroll and stays folded until tapped', () => {
    expect(fitCardCollapsed(false, 0)).toBe(false);
    expect(fitCardCollapsed(false, 40)).toBe(true);
    expect(fitCardCollapsed(true, 0)).toBe(true);
    expect(FIT_COPY.toast(45)).toBe('Fitted to 45 min');
  });
});

describe('source checks', () => {
  const screen = read('screens/workout/WorkoutOverviewScreen.tsx');
  const ui = read('ui/fit.tsx');

  it('the screen never trims, plans or estimates: it sends `trimToFit` / `clearFit` and shows the domain’s views', () => {
    expect(code(screen)).not.toMatch(/fitPlanToMinutes|planWithTodayEdits|estimateRemainingDuration|fitMinutesOf|withSkipped/);
    expect(code(screen)).toMatch(/services\.overview\.trimToFit\(\{ \.\.\.b, minutes \}\)/);
    expect(code(screen)).toMatch(/services\.overview\.clearFit\(b\)/);
    expect(code(screen)).toMatch(/howLongSheet\(\{/);
    expect(code(ui)).not.toMatch(/services|fetch\(/);
  });

  it('static: no animation, spinner or progress in the sheet or the card (Reduce Motion, §3.4)', () => {
    expect(code(ui)).not.toMatch(/Animated|LayoutAnimation|withTiming|withSpring|ActivityIndicator/);
  });

  it('status carries icon and word: `Coach offline` with wifi.slash, the card with clock, TRIMMED with clock', () => {
    expect(ui).toMatch(/<Icon name="wifi\.slash"[^>]*\/>\s*<AppText[^>]*>\s*\{sheet\.ask\.caption\}/);
    expect(ui).toMatch(/<Icon name="clock"/);
    expect(read('ui/overview.tsx')).toMatch(/marker\.glyph === 'clock'\s*\?\s*'clock'/);
  });

  it('the page’s Start stays its only filled pill: the card uses outline pills; the sheet’s filled button is inside its modal', () => {
    const card = ui.slice(ui.indexOf('export function FitCard'));
    expect(card).not.toMatch(/<PrimaryButton\b/);
    expect(card).not.toMatch(/backgroundColor: (pressed \? [^:]+ : )?theme\.colors\.accent\b/);
    const sheet = ui.slice(ui.indexOf('export function HowLongSheet'), ui.indexOf('function StepButton'));
    expect(sheet).toMatch(/<BottomCard visible=\{visible\}/);
  });

  it('controls are at least 44 pt: the tile column, the info button, the steps and the collapsed card', () => {
    expect(read('ui/overview.tsx')).toMatch(/accessibilityRole="button" accessibilityLabel=\{b\.accessibilityLabel\}[^\n]*minHeight: 44/);
    expect(ui).toMatch(/accessibilityLabel=\{FIT_COPY\.paceInfo\}[^\n]*width: 44, height: 44/);
    expect(ui).toMatch(/width: 44, height: 44, borderRadius: theme\.radius\.pill/);
    expect(ui).toMatch(/minHeight: 52/);
  });

  it('the built-in trim never calls the coach in this build: Ask coach is disabled with `Coach offline`', () => {
    expect(code(screen)).toMatch(/coachAvailable: false/);
    expect(code(screen)).not.toMatch(/requestTodayFit/);
  });
});
