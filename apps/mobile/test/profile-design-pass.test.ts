import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { playbookStatusLine } from '../src/coach/playbook-view';
import { rangeNextField } from '../src/ui/number-text';
import { rateLabel } from '../src/voice/settings';

/**
 * Design pass batch 6, Profile and shared rows (Ben approved 20 Oct). Pure
 * parts tested here; the rest are source checks. VoiceOver reaching the
 * row buttons goes on Ben's device checklist.
 */

const SRC = join(__dirname, '..', 'src');
const flat = (s: string) => s.replace(/\s+/g, ' ');
const read = (...p: string[]) => flat(readFileSync(join(SRC, ...p), 'utf8'));

describe('6.7 Row', () => {
  const layout = read('ui', 'layout.tsx');
  it('with onPress and trailing, the trailing control sits beside the tap target with no chevron', () => {
    expect(layout).toContain('const split = onPress !== undefined && (trailing !== undefined && trailing !== null);');
    expect(layout).toContain('{split ? null : trailing}');
    expect(layout).toContain('{onPress && !disabled && !split ? <Icon name="chevron.right"');
  });
  it('trailingAction is also a VoiceOver action; below, flush and subtitleLines exist', () => {
    expect(layout).toContain('if (trailingAction && name === trailingAction.label) trailingAction.onPress();');
    expect(layout).toContain('below?: ReactNode;');
    expect(layout).toContain('const padX = flush ? 0 : theme.space[\'4\'];');
    expect(layout).toContain('numberOfLines: subtitleLines');
  });
  it('call sites: Memory and Playbook buttons below the text; Clear is an action; past workouts one-line names', () => {
    expect(read('screens', 'profile', 'MemoryScreen.tsx')).toContain('below={');
    expect(read('screens', 'profile', 'PlaybookScreen.tsx')).toContain('below={');
    expect(read('screens', 'profile', 'PainFlagsScreen.tsx')).toContain("trailingAction={{ label: 'Clear',");
    expect(read('screens', 'repeat', 'PastWorkoutsScreen.tsx')).toContain('subtitleLines={1}');
  });
});

describe('6.8 Training details', () => {
  const t = read('screens', 'profile', 'TrainingDetailsScreen.tsx');
  it('Save is always there, disabled until valid; the date is a compact picker up to today', () => {
    expect(t).toContain('<PrimaryButton label={C.save} disabled={save === null}');
    expect(t).toContain('display="compact"');
    expect(t).toContain('maximumDate={noon(today)}');
    expect(t).not.toContain('placeholder="YYYY-MM-DD"');
  });
});

describe('6.9 Voice', () => {
  it('1× not Normal on the chip (spoken as Normal speed); Test in the footer; Speed above the voices', () => {
    expect(rateLabel(1)).toBe('1×');
    expect(rateLabel(0.8)).toBe('0.8×');
    const v = read('screens', 'profile', 'VoiceSettingsScreen.tsx');
    expect(v).toContain("accessibilityLabel={r === 1 ? 'Normal speed'");
    expect(v.indexOf('<SectionHeader title="Speed" />')).toBeLessThan(v.indexOf('<SectionHeader title="Voice" />'));
    expect(v).toContain('<Screen footer={');
  });
});

describe('6.10–6.12', () => {
  it('copy: no rule or reassurance sentences on these screens', () => {
    expect(read('screens', 'gym', 'GymDetailScreen.tsx')).not.toContain('uses this gym as it was when you started');
    const eq = read('screens', 'gym', 'EquipmentEditorScreen.tsx');
    expect(eq).not.toContain('Future workouts use the new setup');
    expect(eq).not.toContain('More assistance = easier');
    expect(eq.match(/As printed on the stack/g)?.length).toBe(1);
    expect(read('screens', 'setup', 'SetupScreen.tsx')).toContain('explanation="About 2 minutes · on this phone"');
  });

  it('App status says the Playbook count the Playbook screen shows', () => {
    const row = { id: 'a', version: 1, text: 'x', label: 'R1', line: '' } as never;
    expect(playbookStatusLine({ toReview: [], approved: [row, row, row], rejected: [] })).toEqual({ text: 'Playbook rules: 3 approved', count: 3 });
    expect(playbookStatusLine({ toReview: [row], approved: [], rejected: [] })).toEqual({ text: 'Playbook rules: none yet', count: 0 });
    // Review S7: the icon follows the count, not the wording.
    expect(read('screens', 'profile', 'AppStatusScreen.tsx')).not.toContain("endsWith('none yet')");
    expect(playbookStatusLine(null)).toBeNull();
    expect(read('screens', 'profile', 'AppStatusScreen.tsx')).not.toContain('not in this build yet" />');
  });

  it('a dumbbell range goes in with Next › From → To → Every', () => {
    expect([0, 1, 2].map(rangeNextField)).toEqual([1, 2, null]);
    expect(read('screens', 'gym', 'EquipmentEditorScreen.tsx')).toContain('<KeyboardDoneAccessory nativeID={RANGE_ACCESSORY_ID} onNext={next === null ? null : () => refs[next].current?.focus()} />');
  });
});
