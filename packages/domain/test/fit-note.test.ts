import { describe, expect, it } from 'vitest';
import { fitNoteOf, type BuilderFitStep } from '../src/index';

/** One wording for the Time note on Today's card and Your workout (fit-to-time 22 Oct revision, item 4). */
const names: Record<string, string> = { fly: 'Cable fly', pd: 'Triceps pushdown', crunch: 'Cable crunch', curl: 'EZ-bar curl' };
const nameOf = (id: string) => names[id] ?? 'Exercise';
const slotName = (key: string) => nameOf(key.replace(/^k-/, ''));

describe('fitNoteOf', () => {
  it('nothing changed: no note, no lines', () => {
    expect(fitNoteOf([], nameOf, slotName)).toEqual({ note: null, lines: [] });
  });

  it('the biggest change is the note: exercises left out, then sets, then supersets, then rests; the lines list everything, rests first', () => {
    const steps: BuilderFitStep[] = [
      { kind: 'rest', from: 'normal', to: 'shorter' },
      { kind: 'rest', from: 'shorter', to: 'shortest' },
      { kind: 'pair', slotKeys: ['k-pd', 'k-crunch'] },
      { kind: 'drop', slotKey: 'k-fly', exerciseId: 'fly' },
      { kind: 'sets', slotKey: 'k-crunch', exerciseId: 'crunch', from: 3, to: 2 },
    ];
    expect(fitNoteOf(steps, nameOf, slotName)).toEqual({ note: '−1 exercise', lines: ['Minimum rest', 'Superset Triceps pushdown + Cable crunch', 'Dropped Cable fly', 'Cable crunch 3 → 2 sets'] });
    expect(fitNoteOf(steps.filter((s) => s.kind !== 'drop'), nameOf, slotName).note).toBe('−1 set');
    expect(fitNoteOf(steps.filter((s) => s.kind !== 'drop' && s.kind !== 'sets'), nameOf, slotName).note).toBe('supersets');
    expect(fitNoteOf(steps.slice(0, 1), nameOf, slotName)).toEqual({ note: 'medium rest', lines: ['Medium rest'] });
    // (Ben, 27 Oct) The rest levels by their Profile › Training names.
    expect(fitNoteOf([{ kind: 'rest', from: 'shortest', to: 'normal' }], nameOf, slotName)).toEqual({ note: 'standard rest', lines: ['Standard rest'] });
  });

  it('more time on Today: exercises and sets added read with +; an effort step is not listed', () => {
    const steps: BuilderFitStep[] = [
      { kind: 'add', slotKey: 'k-curl', exerciseId: 'curl', why: 'arm' },
      { kind: 'sets', slotKey: 'k-fly', exerciseId: 'fly', from: 3, to: 4 },
      { kind: 'effort', slotKeys: ['k-fly'] },
    ];
    expect(fitNoteOf(steps, nameOf, slotName)).toEqual({ note: '+1 exercise', lines: ['Added EZ-bar curl', 'Cable fly 3 → 4 sets'] });
    expect(fitNoteOf(steps.slice(1), nameOf, slotName).note).toBe('+1 set');
  });
});
