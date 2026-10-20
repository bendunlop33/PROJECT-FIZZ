import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Merge of the design pass (20 Oct) with weekflex and lift targets: the
 * newer sheets and coach cards use the design pass's shared chrome. Source
 * checks (no renderer in this lane); the keyboard on device is on Ben's
 * checklist.
 */

const SRC = join(__dirname, '..', 'src');
const read = (f: string) => readFileSync(join(SRC, f), 'utf8');

describe('ActivitySheet on the scrolling BottomCard', () => {
  const src = read('screens/activity/ActivitySheet.tsx');
  it('Save, Delete and the error sit in the pinned footer, not the scroll', () => {
    const footer = src.indexOf('footer={');
    const body = src.indexOf('<KeyboardDoneAccessory nativeID={ACTIVITY_ACCESSORY_ID}');
    expect(footer).toBeGreaterThan(-1);
    expect(body).toBeGreaterThan(footer);
    expect(src.indexOf('<PrimaryButton label={ACTIVITY_COPY.save}')).toBeLessThan(body);
    expect(src.indexOf('<DangerTextButton label={ACTIVITY_COPY.delete}')).toBeLessThan(body);
    expect(src.match(/<PrimaryButton /g)?.length).toBe(1);
  });
  it('time and distance keypads have the Done / Next bar', () => {
    expect(src.match(/inputAccessoryViewID=\{ACTIVITY_ACCESSORY_ID\}/g)?.length).toBe(2);
    expect(src).toContain("onNext={focused === 'minutes' ? () => distanceField.current?.focus() : null}");
  });
});

describe('LiftTargetSheet keeps Save fixed while its fields scroll', () => {
  const src = read('lift-targets/LiftTargetSheet.tsx');
  it('scroll={false} with its own ScrollView, buttons after it', () => {
    expect(src).toContain('<BottomCard visible={visible} onClose={onClose} scroll={false}>');
    expect(src.indexOf('<PrimaryButton label="Save"')).toBeGreaterThan(src.indexOf('</ScrollView>'));
    expect(src).toContain('inputAccessoryViewID={LIFT_TARGET_ACCESSORY_ID}');
  });
});

describe('Week cards use the coach card frame', () => {
  const src = read('screens/coach/WeekCards.tsx');
  it('CoachCardFrame and CardActions, no local card style', () => {
    expect(src.match(/<CoachCardFrame>/g)?.length).toBe(2);
    expect(src.match(/<CardActions>/g)?.length).toBe(2);
    expect(src).not.toContain('cardStyle');
  });
});
