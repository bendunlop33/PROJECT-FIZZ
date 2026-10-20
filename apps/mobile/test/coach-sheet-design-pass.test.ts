import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { AT_BOTTOM_SLOP, isAtBottom, replyText, stampedKeys, stickToEnd, type ThreadRow } from '../src/coach/sheet-view';

/**
 * Design pass batch 4 (Ben approved 20 Oct): the coach sheet. The transcript
 * stays put when Ben has scrolled up; the keyboard leaves room for the
 * conversation; cards share one frame and one action language. Pure parts are
 * tested here; the rest are source checks (the feel goes on Ben's checklist).
 */

const SRC = join(__dirname, '..', 'src');
const flat = (s: string) => s.replace(/\s+/g, ' ');
const screen = flat(readFileSync(join(SRC, 'screens', 'coach', 'CoachSheetScreen.tsx'), 'utf8'));
const card = flat(readFileSync(join(SRC, 'screens', 'coach', 'CoachCard.tsx'), 'utf8'));
const build = flat(readFileSync(join(SRC, 'screens', 'coach', 'BuildCards.tsx'), 'utf8'));
const plan = flat(readFileSync(join(SRC, 'screens', 'coach', 'PlanCard.tsx'), 'utf8'));
const ui = flat(readFileSync(join(SRC, 'ui', 'workout.tsx'), 'utf8'));

describe('4.1 sticky end', () => {
  it('at the end within the slop; scrolled up is not', () => {
    expect(isAtBottom({ contentOffsetY: 600, contentHeight: 1000, viewportHeight: 400 })).toBe(true);
    expect(isAtBottom({ contentOffsetY: 600 - AT_BOTTOM_SLOP, contentHeight: 1000, viewportHeight: 400 })).toBe(true);
    expect(isAtBottom({ contentOffsetY: 300, contentHeight: 1000, viewportHeight: 400 })).toBe(false);
  });

  it('a Why? opened higher up doesn’t jump; something new does; never over the starter chips', () => {
    expect(stickToEnd({ atBottom: false, added: false, starters: false })).toBe(false);
    expect(stickToEnd({ atBottom: false, added: true, starters: false })).toBe(true);
    expect(stickToEnd({ atBottom: true, added: false, starters: false })).toBe(true);
    expect(stickToEnd({ atBottom: true, added: true, starters: true })).toBe(false);
  });
});

describe('replies and times', () => {
  it('sentences join with a space; a heading or a list item keeps its line break', () => {
    expect(replyText(['Good set.', 'Keep 100 kg.'])).toBe('Good set. Keep 100 kg.');
    expect(replyText(['Next time:', '- Bench 100 kg', '- Row 60 kg'])).toBe('Next time:\n- Bench 100 kg\n- Row 60 kg');
    expect(replyText(['Two options:', '1. Lighter', '2) Fewer sets'])).toBe('Two options:\n1. Lighter\n2) Fewer sets');
    // Text split around an action token stays on one line.
    expect(replyText(['I’ve set', 'for today.'])).toBe('I’ve set for today.');
    expect(replyText([])).toBe('');
  });

  it('a time once per run of the same minute', () => {
    const rows: ThreadRow[] = [
      { kind: 'ben', key: 'a', text: 'hi', spoken: false, atUtc: '18:02', tz: 'z' },
      { kind: 'tools', key: 't', lines: ['Read history'] },
      { kind: 'coach', key: 'b', sentences: ['Hi.'], atUtc: '18:02', tz: 'z' },
      { kind: 'ben', key: 'c', text: 'more', spoken: false, atUtc: '18:09', tz: 'z' },
    ];
    expect([...stampedKeys(rows, (utc) => utc)]).toEqual(['a', 'c']);
  });
});

describe('sheet layout (source checks)', () => {
  it('4.2 keyboard up: footer on the keyboard, Sees chip hidden and its panel closed, the route a short label', () => {
    expect(screen).toContain("paddingBottom: keyboardUp ? theme.space['2'] : insets.bottom + theme.space['2']");
    expect(screen).toContain('{keyboardUp ? null : ( <Pressable accessibilityRole="button" accessibilityLabel="What the coach can see"');
    expect(screen).toContain('if (keyboardUp) setSees(null);');
    expect(screen).toContain('{route !== null && keyboardUp ? ( <AppText variant="label" color="text.secondary" numberOfLines={1}> {route.text}');
  });

  it('4.3 the Sees panel scrolls within 35% of the window', () => {
    expect(screen).toContain('maxHeight={Math.round(windowHeight * 0.35)}');
    expect(screen).toContain('<ScrollView style={{ maxHeight,');
  });

  it('4.8 header: title is a header capped at 1.5×; the list has its own header, dates and an empty state; the speaker is a switch', () => {
    expect(screen).toContain('accessibilityRole="header" maxFontSizeMultiplier={1.5}');
    expect(screen).toContain('Conversations </AppText>');
    expect(screen).toContain('No conversations');
    expect(screen).toContain('formatWhen(toMs(t.updatedAtUtc)');
    expect(screen).not.toContain('<TextButton label="Back"');
    expect(screen).toContain("accessibilityRole={toggle === undefined ? 'button' : 'switch'}");
  });

  it('nits: tools behind a Tools link (not lower-cased), composer height scales with text size', () => {
    expect(screen).not.toContain('toLowerCase()');
    expect(screen).toContain('label="Tools"');
    expect(screen).toContain('maxHeight: Math.round(140 * Math.min(Math.max(fontScale, 1), 2))');
  });
});

describe('4.5–4.9 chips and cards', () => {
  it('Chip has disabled (dimmed, no press scale, a11y state) and onSurface', () => {
    expect(ui).toContain('accessibilityState={{ selected, disabled }}');
    expect(ui).toContain('opacity: disabled ? 0.45 : 1');
    expect(ui).toContain("const idle = onSurface ? theme.colors['bg.raised'] : theme.colors['bg.surface'];");
  });

  it('build and question chips sit on the card; LENGTH no longer deselects; a disabled tap says Needs the coach', () => {
    expect(build).toContain('onPress={() => { setMinutes(l.minutes); }}');
    expect(build).toContain('<Chip key={a.catalogueId ?? a.label} onSurface disabled={disabled} onDisabledPress={showReason}');
    expect(screen).toContain("disabledReason: status?.canSend !== true ? BUILD_COPY.needsCoach : null");
  });

  it('one action language: Apply, Add, Save and Adjust are pill buttons; Why? left, Undo right; rows wrap', () => {
    for (const l of ['Apply', 'Add', 'Save']) expect(card).toContain(`<SecondaryButton label="${l}"`);
    expect(screen).toContain('<SecondaryButton label={offerLabel(row.input.offer)} onPress={onAccept} />');
    expect(card).toContain('<CardActions>');
    const change = build.slice(build.indexOf('<CardActions>'));
    expect(change.indexOf('BUILD_COPY.why')).toBeLessThan(change.indexOf('BUILD_COPY.undo'));
    expect(plan).toContain('<CardActions>');
  });

  it('every card uses the shared frame; plan rows are two lines', () => {
    expect(card).toContain('<CoachCardFrame>');
    expect(build).toContain('const Frame = CoachCardFrame;');
    expect(plan).toContain('<CoachCardFrame>');
    expect(plan).toContain("[r.scheme, r.load, ...r.marks].filter((x) => x !== '').join(' · ')");
  });
});
