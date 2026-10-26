import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { TodayOptions } from '../src/builder/builder-service';
import { OPTIONS_ROW_COPY, todayOptionsSummary } from '../src/builder/builder-view';

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

  it('collapsed, it shows only what is set: main lift (when there is a choice), accessories, Abs/Supersets when on', () => {
    expect(todayOptionsSummary(opts()).text).toBe('Bench · Focused · Abs');
    expect(todayOptionsSummary(opts({ abs: false, supersets: true, accessories: 'varied' })).text).toBe('Bench · Varied · Supersets');
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
  });
});
