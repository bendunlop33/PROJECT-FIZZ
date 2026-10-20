import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Design pass batch 2 (Ben approved 20 Oct): set editors and workout sheets.
 * Source checks (no renderer in this lane); how they sit on the keyboard and
 * at AX goes on Ben's device checklist.
 */

const SRC = join(__dirname, '..', 'src', 'screens', 'workout');
const read = (f: string) => readFileSync(join(SRC, f), 'utf8');
const flat = (s: string) => s.replace(/\s+/g, ' ');

describe('Edit set and planned-set edit (2.1)', () => {
  for (const f of ['EditSetScreen.tsx', 'PlannedSetEdit.tsx']) {
    const src = read(f);
    it(`${f}: Save changes sits in a fixed bar on the keyboard, not at the end of the scroll`, () => {
      expect(src).toContain("<ActionBar surface keypadOpen={keyboard} primary={{ label: 'Save changes', disabled: !view.changed && !noteEdited, onPress: () => void save() }} />");
      expect(src).not.toContain('<PrimaryButton label="Save changes"');
      // The bar comes after the scroll, inside the keyboard-avoiding frame.
      expect(src.indexOf('<ActionBar surface')).toBeGreaterThan(src.lastIndexOf('</ScrollView>'));
      expect(src).toContain('{...WORKOUT_KEYBOARD} automaticallyAdjustKeyboardInsets>');
    });
    it(`${f}: the note has the Done bar; Insert and Delete stay at the end`, () => {
      expect(flat(src)).toMatch(/maxLength=\{NOTE_MAX\} inputAccessoryViewID=\{NUMBER_ACCESSORY_ID\}/);
      expect(src).toContain('<DangerTextButton label="Delete set"');
    });
  }
});

describe('Finish sheet (2.2)', () => {
  const src = read('FinishSheet.tsx');
  it('the body scrolls; Finish and Keep going are pinned; Discard stays at the end of the scroll', () => {
    const scroll = src.slice(src.indexOf('<ScrollView'), src.indexOf('</ScrollView>'));
    const footer = src.slice(src.indexOf('</ScrollView>'));
    expect(scroll).toContain('contentContainerStyle={{ flexGrow: 1,');
    expect(scroll).toContain('<View style={{ flex: 1 }} />');
    expect(scroll).toContain('<DangerTextButton label="Discard workout"');
    expect(footer).toContain('<PrimaryButton label="Finish"');
    expect(footer).toContain('<TextButton label="Keep going"');
    expect(footer).toContain("paddingBottom: theme.space['4'] + insets.bottom");
  });
});

describe('Overview sheets (2.3–2.5)', () => {
  it('the reps sheet’s scrim reads Close (it doesn’t save)', () => {
    const reps = read('OverviewEditSheets.tsx');
    const sheet = reps.slice(reps.indexOf('export function RepsSheet'), reps.indexOf('export function', reps.indexOf('export function RepsSheet') + 10));
    expect(sheet).toContain('<BottomCard visible={row !== null} onClose={onClose}>');
    expect(sheet).not.toContain('closeLabel={EDIT_MODE_COPY.done}');
  });
  const overview = read('WorkoutOverviewScreen.tsx');
  it('the Why sheet keeps its name and Close; the panel scrolls', () => {
    const why = overview.slice(overview.indexOf('visible={whyVisible}'), overview.indexOf('</BottomCard>', overview.indexOf('visible={whyVisible}')));
    expect(why).toContain('scroll={false}');
    expect(why).toContain('label={TODAY_EDITS_COPY.close}');
    expect(why).toContain('<ScrollView style={{ flexShrink: 1 }}>{why ? <TargetWhyPanel');
  });
  it('a long gym name stays on one line', () => {
    expect(flat(overview)).toContain('<AppText variant="label" numberOfLines={1} style={{ flexShrink: 1 }}> {page.view.gym?.name ?? OVERVIEW_COPY.addGym}');
  });
});

describe('check-in, gym switch, picker, Why? link (2.6–2.9)', () => {
  it('the pain step puts Flag n under the title and grows it', () => {
    const src = read('CheckInScreen.tsx');
    const pain = src.slice(src.indexOf("case 'pain':"), src.indexOf("case 'ill':"));
    expect(pain).toContain('barFirst');
    expect(flat(pain)).toContain('<View style={{ flex: 1 }}> <PrimaryButton');
    expect(src).toContain('automaticallyAdjustKeyboardInsets');
  });
  it('the switch card’s pills wrap; both sheets clear the home indicator', () => {
    const src = read('GymSwitch.tsx');
    expect(src).toContain("flexDirection: 'row', flexWrap: 'wrap', columnGap: theme.space['3'], rowGap: theme.space['2']");
    expect(flat(src)).toContain('workout grow');
    expect(src.match(/theme\.space\['4'\] \+ insets\.bottom/g)?.length).toBe(2);
  });
  it('the picker: title2 on one line, Cardio beside the search, no bar inset on the keyboard', () => {
    const src = read('ExercisePickerScreen.tsx');
    expect(src).toContain('<AppText variant="title2" accessibilityRole="header" style={{ flex: 1 }} numberOfLines={1}>');
    expect(flat(src)).toMatch(/style=\{\{ flex: 1, minHeight: 48,[^}]*\}\} \/> <Chip label="Cardio"/);
    expect(src).toContain('paddingBottom: keyboard ? 0 : insets.bottom');
  });
  it('Why? and Check due are underlined in D; the chevron only where the look uses it', () => {
    const src = read('TargetWhyPanel.tsx');
    expect(src).toContain("style={underline ? { textDecorationLine: 'underline', textDecorationColor: theme.colors['border.control'] } : undefined}");
    expect(src).toContain("{chevron ? <Icon name={open ? 'chevron.up' : 'chevron.down'}");
    expect(src).toContain("style={theme.components.linkAffordance === 'underline' ? { textDecorationLine: 'underline'");
  });
});
