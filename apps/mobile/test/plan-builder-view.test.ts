import { describe, expect, it } from 'vitest';

import { pbDefaultAnswers, pbWithSessions } from '@fizz/domain';

import { goalsRowValue, prefQuestions, prefsRowValue, rotatesLine, splitBoxes, targetChoices, weekRowValue } from '../src/plan-builder/plan-builder-view';

/** The plan builder's screen values (minimal copy; numbers from the engine). */

const a = pbDefaultAnswers({ sessions: 4, minutes: 60 });

describe('plan builder view', () => {
  it('the ✦ split follows the sessions until Ben picks one; Profile’s split when it fits', () => {
    expect(splitBoxes(a, null).find((b) => b.selected)?.label).toBe('✦ Upper / Lower');
    expect(splitBoxes(pbWithSessions(a, 5), null).find((b) => b.selected)?.label).toBe('✦ Push / Pull / Legs');
    expect(splitBoxes(a, 'body').find((b) => b.selected)?.label).toBe('✦ Chest / Legs / Shoulders / Back');
    const picked = splitBoxes({ ...a, split: 'full' }, null);
    expect(picked.find((b) => b.selected)?.label).toBe('Full body');
    expect(picked.find((b) => b.label.startsWith('✦'))?.key).toBe('ul');
  });

  it('a split that doesn’t fill the week rotates', () => {
    expect(rotatesLine(pbWithSessions(a, 5), null)).toBe('Rotates · next week starts Legs');
    expect(rotatesLine(a, null)).toBeNull();
  });

  it('rows on Your plan show the answers it was built from', () => {
    expect(goalsRowValue({ ...a, priorities: ['Back', 'Arms'] })).toBe('6 weeks · Standard · Balanced · ★ Back, Arms');
    expect(weekRowValue({ ...a, supersets: true, minutes: 45 })).toBe('4 days · 45 min · supersets');
    expect(prefsRowValue({ ...a, prefs: { flat: 1, row: 'either' }, likes: ['cable-fly'] })).toBe('2 set');
  });

  it('Hips is asked only with a legs priority or a hips target; targets need an exercise here', () => {
    expect(prefQuestions(a).flatMap((g) => g.questions).some((q) => q.id === 'hips')).toBe(false);
    expect(prefQuestions({ ...a, priorities: ['Legs'] }).flatMap((g) => g.questions).some((q) => q.id === 'hips')).toBe(true);
    expect(prefQuestions(a).map((g) => g.group)).toEqual(['Chest', 'Legs', 'Back', 'Shoulders']);
    const all = targetChoices(() => true);
    expect(all).toContain('Rear delts');
    // No forearm exercise in the catalogue yet: never offered.
    expect(all).not.toContain('Forearms');
    expect(targetChoices((k) => k !== 'cable-woodchop')).not.toContain('Obliques');
  });
});
