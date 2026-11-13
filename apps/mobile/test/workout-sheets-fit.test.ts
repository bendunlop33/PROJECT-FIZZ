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
    it(`${f}: the note has the Done bar`, () => {
      expect(flat(src)).toMatch(/maxLength=\{NOTE_MAX\} inputAccessoryViewID=\{NUMBER_ACCESSORY_ID\}/);
    });
  }
});

describe('the past sheet keeps Delete set at the end; the live sheets have none (Ben, 2 Nov)', () => {
  it('EditSetScreen: Delete set last, behind the past sheet’s sections; PlannedSetEdit: no Delete, Insert or Do next', () => {
    const edit = read('EditSetScreen.tsx');
    expect(edit).toContain("{shows.has('delete') ? (");
    expect(edit.indexOf('<DangerTextButton label="Delete set"')).toBeGreaterThan(edit.indexOf('label="Note"'));
    const planned = read('PlannedSetEdit.tsx');
    for (const gone of ['label="Delete set"', 'label="Insert set after"', 'label="Do next"', 'label="Range"', "'+ Weight'", 'targetRpeChips', 'NumberStepper']) expect(planned).not.toContain(gone);
  });
});

describe('Finish sheet (2.2; redesign 27 Oct §E1)', () => {
  const src = read('FinishSheet.tsx');
  it('a bottom card: the sets line under the title; Finish, Keep going and Discard pinned at the bottom; a past log’s times scroll', () => {
    expect(src).toContain('<BottomCard');
    const header = src.slice(src.indexOf('header={'), src.indexOf('footer={'));
    const footer = src.slice(src.indexOf('footer={'), src.indexOf('</BottomCard>'));
    expect(header).toContain('{finishLine(model)}');
    expect(footer).toContain('<PrimaryButton label="Finish"');
    expect(footer).toContain('<SecondaryButton label="Keep going"');
    expect(footer).toContain('<DangerTextButton label="Discard workout"');
    expect(footer.indexOf('label="Finish"')).toBeLessThan(footer.indexOf('label="Keep going"'));
    expect(src.slice(src.indexOf('</>\n      }\n    >'))).toContain('<WorkoutTimesRows');
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
  it('Why? is underlined in D; the chevron only where the look uses it (no `Check due` link since Ben, 9 Nov)', () => {
    const src = read('TargetWhyPanel.tsx');
    expect(src).toContain("style={underline ? { textDecorationLine: 'underline', textDecorationColor: theme.colors['border.control'] } : undefined}");
    expect(src).toContain("{chevron ? <Icon name={open ? 'chevron.up' : 'chevron.down'}");
    expect(src).not.toContain('Check due');
  });
});
