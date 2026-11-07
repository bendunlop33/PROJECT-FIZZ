import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { TodayOptions } from '../src/builder/builder-service';
import { earlierEditsMenu, OPTIONS_ROW_COPY, todayOptionsSummary } from '../src/builder/builder-view';

/** (Ben, 26 Oct; app review finding 7) Your workout's options fold into one `Options` row so the exercises start at the top. */
describe('Your workout · Options row (Ben, 26 Oct)', () => {
  const opts = (o: Partial<TodayOptions> = {}): TodayOptions => ({
    mainLifts: [
      { exerciseId: 'bench', label: 'Bench', selected: true },
      { exerciseId: 'incline', label: 'Incline', selected: false },
    ],
    accessories: 'focused',
    abs: true,
    supersets: false,
    ...o,
  });

  it('(redesign v3 §A8) collapsed, it shows what is on: `Abs · Supersets`', () => {
    expect(todayOptionsSummary(opts()).text).toBe('Abs');
    expect(todayOptionsSummary(opts({ abs: true, supersets: true })).text).toBe('Abs · Supersets');
    expect(todayOptionsSummary(opts({ abs: false, supersets: true, accessories: 'varied' })).text).toBe('Supersets');
    expect(todayOptionsSummary(opts({ mainLifts: [{ exerciseId: 'bench', label: 'Bench', selected: true }], abs: false, accessories: null })).text).toBe('');
  });

  it('VoiceOver hears every option with its state', () => {
    expect(todayOptionsSummary(opts()).accessibilityLabel).toBe('Options: Main lift Bench, Accessories Focused, Abs on, Supersets off');
    expect(OPTIONS_ROW_COPY.title).toBe('Options');
  });

  const page = readFileSync(join(import.meta.dirname, '../src/screens/builder/BuilderWorkoutScreen.tsx'), 'utf8');
  it('the page starts collapsed and the row sits above the table; the five controls are behind it', () => {
    expect(page).toContain('const [optionsOpen, setOptionsOpen] = useState(false);');
    expect(page.indexOf('<OptionsRow')).toBeLessThan(page.indexOf('<WorkoutTable'));
    // The controls are only rendered inside the row, once opened.
    expect(page.match(/<TodayOptionRows /g)?.length).toBe(1);
    expect(page).toContain('accessibilityState={{ expanded: open }}');
    // (Redesign v3 §A8) A clear card: bold label, ≥ 56 pt row.
    expect(page).toContain('const OPTIONS_ROW_MIN_HEIGHT = 56;');
    expect(page).toContain('<AppText variant="headline">{OPTIONS_ROW_COPY.title}</AppText>');
  });

  it('(redesign v3 §A9) no `Edits from …` lines on the page; `Use earlier edits` is in ⋯', () => {
    expect(page).not.toContain('editsFromText');
    expect(page).toContain('...earlierEditsMenu(earlier).map(');
    expect(earlierEditsMenu([{ draftId: 'd1', localDate: '2026-10-25' }])).toEqual([{ draftId: 'd1', label: 'Use earlier edits' }]);
    expect(earlierEditsMenu([{ draftId: 'd1', localDate: '2026-10-25' }, { draftId: 'd2', localDate: '2026-10-24' }]).map((e) => e.label)).toEqual(['Use edits from Sun 25 Oct', 'Use edits from Sat 24 Oct']);
    expect(earlierEditsMenu([])).toEqual([]);
  });
});
