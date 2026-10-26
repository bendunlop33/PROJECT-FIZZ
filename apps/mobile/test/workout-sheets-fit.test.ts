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
      // Review S1: the keyboard-avoiding frame alone lifts the bar; a second inset doubled it.
      expect(src).toContain('<SheetKeyboardAvoidingView');
      expect(src).not.toContain('automaticallyAdjustKeyboardInsets>');
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
  it('Why? and Check due are underlined in D; the chevron only where the look uses it', () => {
    const src = read('TargetWhyPanel.tsx');
    expect(src).toContain("style={underline ? { textDecorationLine: 'underline', textDecorationColor: theme.colors['border.control'] } : undefined}");
    expect(src).toContain("{chevron ? <Icon name={open ? 'chevron.up' : 'chevron.down'}");
    expect(src).toContain("style={theme.components.linkAffordance === 'underline' ? { textDecorationLine: 'underline'");
  });
});
