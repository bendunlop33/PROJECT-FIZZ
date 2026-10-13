import { describe, expect, it } from 'vitest';

import { NUMERAL_MIN, numeralEms, openRowWidth, stepperNumeralSize, stepperTexts, TILE_GAP, TILE_PADDING_H, tileFit, type TileSpec } from '../src/workout/tile-fit';

/**
 * The open row's tiles (review B1, WT-D13, WT40): with 52 pt − / + buttons,
 * LOAD and REPS can't sit side by side at 375 or 390 pt without clipping, so
 * they stack; a numeral is never clipped at any text size.
 */

const XXXL = 1.353; // iOS xxxLarge (23/17)
const AX3 = 2.353; // AX3 (40/17)
const on = (value: number) => ({ enabled: true, value });
const off = { enabled: false };

const load = (v: number, up: number | null, down: number | null): TileSpec => ({ flex: 1.35, texts: stepperTexts(v, down === null ? off : on(down), up === null ? off : on(up), 3), unit: null });
const reps = (v: number): TileSpec => ({ flex: 1, texts: stepperTexts(v, on(v - 1), on(v + 1), 2), unit: null });
const time = (s: number): TileSpec => ({ flex: 1, texts: stepperTexts(s, on(s - 5), on(s + 5), 2), unit: 's' });

/** Every numeral fits its tile in the chosen layout (a generous estimate of SF Pro tabular digits). */
function expectNoClip(rowWidth: number, tiles: TileSpec[], step: number, fit: { stacked: boolean; numeralSize: number }): void {
  const total = tiles.reduce((a, t) => a + t.flex, 0);
  for (const t of tiles) {
    const w = fit.stacked || tiles.length === 1 ? rowWidth : ((rowWidth - TILE_GAP * (tiles.length - 1)) * t.flex) / total;
    const longest = Math.max(...t.texts.map(numeralEms));
    const unit = t.unit === null ? 0 : numeralEms(` ${t.unit}`) * 18 * 1.4;
    expect(longest * fit.numeralSize + unit, `${t.texts.join('/')} in ${String(Math.round(w))} pt`).toBeLessThanOrEqual(w - TILE_PADDING_H - 2 * step);
  }
}

describe('open row width (the first frame, before onLayout)', () => {
  it('390 pt leaves 315 pt for the tiles, 375 pt leaves 300', () => {
    expect(openRowWidth(390)).toBe(315);
    expect(openRowWidth(375)).toBe(300);
  });
});

describe('tileFit: LOAD + REPS (WT-D13, WT40)', () => {
  for (const width of [375, 390]) {
    for (const [name, scale] of [
      ['default', 1],
      ['xxxLarge', XXXL],
    ] as const) {
      it(`${String(width)} pt at ${name}: 102.5 and 142.5 stack and are never clipped`, () => {
        const row = openRowWidth(width);
        for (const v of [100, 102.5, 142.5]) {
          const tiles = [load(v, v + 2.5, v - 2.5), reps(12)];
          const fit = tileFit({ rowWidth: row, tiles, stepSize: 52, fontScale: scale, ax: false });
          expect(fit.stacked, String(v)).toBe(true);
          expect(fit.numeralSize).toBeGreaterThanOrEqual(NUMERAL_MIN);
          expectNoClip(row, tiles, 52, fit);
        }
      });
    }
  }

  it('the full numeral size when stacked at the default size (38 pt), scaled at xxxLarge', () => {
    const tiles = [load(102.5, 105, 100), reps(8)];
    expect(tileFit({ rowWidth: openRowWidth(390), tiles, stepSize: 52, fontScale: 1, ax: false })).toEqual({ stacked: true, numeralSize: 38 });
    expect(tileFit({ rowWidth: openRowWidth(390), tiles, stepSize: 52, fontScale: XXXL, ax: false })).toEqual({ stacked: true, numeralSize: 51 });
  });

  it('a wide window keeps them side by side, shrinking the numeral to fit and never below 28 pt', () => {
    const tiles = [load(102.5, 105, 100), reps(8)];
    const wide = tileFit({ rowWidth: 600, tiles, stepSize: 52, fontScale: 1, ax: false });
    expect(wide).toEqual({ stacked: false, numeralSize: 38 });
    expectNoClip(600, tiles, 52, wide);
    const tight = tileFit({ rowWidth: 400, tiles, stepSize: 52, fontScale: 1, ax: false });
    expect(tight.stacked).toBe(false);
    expect(tight.numeralSize).toBeGreaterThanOrEqual(NUMERAL_MIN);
    expect(tight.numeralSize).toBeLessThan(38);
    expectNoClip(400, tiles, 52, tight);
  });

  it('AX1+ always stacks, with 60 pt buttons, and a long load still fits', () => {
    for (const width of [375, 390]) {
      const row = openRowWidth(width);
      const tiles = [load(142.5, 145, 140), reps(10)];
      const fit = tileFit({ rowWidth: row, tiles, stepSize: 60, fontScale: AX3, ax: true });
      expect(fit.stacked).toBe(true);
      expectNoClip(row, tiles, 60, fit);
    }
  });
});

describe('tileFit: one tile, and other pairs', () => {
  it('reps only (bodyweight) and TIME only keep one full-width tile at full size', () => {
    expect(tileFit({ rowWidth: openRowWidth(375), tiles: [reps(12)], stepSize: 52, fontScale: 1, ax: false })).toEqual({ stacked: false, numeralSize: 38 });
    const t = [time(45)];
    const fit = tileFit({ rowWidth: openRowWidth(375), tiles: t, stepSize: 52, fontScale: XXXL, ax: false });
    expect(fit.stacked).toBe(false);
    expectNoClip(openRowWidth(375), t, 52, fit);
  });

  it('LOAD + TIME at 375 stacks rather than clip `120 s`', () => {
    const tiles = [load(20, 22.5, 17.5), time(120)];
    const fit = tileFit({ rowWidth: openRowWidth(375), tiles, stepSize: 52, fontScale: 1, ax: false });
    expect(fit.stacked).toBe(true);
    expectNoClip(openRowWidth(375), tiles, 52, fit);
  });

  it('an empty value still reserves room for its digits', () => {
    expect(stepperTexts(null, off, off, 3)).toEqual(['—', '000']);
    expect(stepperTexts(97.5, on(95), on(100), 3)).toEqual(['97.5', '95', '100', '000']);
  });
});

describe('stepperNumeralSize: Focus and Edit set REPS beside LOAD (F9)', () => {
  // Focus at 375 pt: 343 pt row, 12 pt gap, LOAD flex 1.4, REPS flex 1 → ~138 pt REPS tile, 44 pt − / +.
  const repsTile = ((375 - 32 - 12) * 1) / 2.4;
  const fits = (size: number, text: string, tileWidth: number, step: number) => numeralEms(text) * size + 6 <= tileWidth - TILE_PADDING_H - 2 * step;

  it('shrinks the numeral so 10 or more reps are never cut to one digit', () => {
    for (const v of [10, 12, 15, 20, 99]) {
      const size = stepperNumeralSize({ tileWidth: repsTile, texts: [String(v), ...stepperTexts(v, on(v - 1), on(v + 1), 2)], unit: null, stepSize: 44, fontScale: 1 });
      expect(fits(size, String(v), repsTile, 44), `${String(v)} at ${String(size)} pt`).toBe(true);
    }
  });

  it('a typed second digit is part of the fit before the value updates', () => {
    const size = stepperNumeralSize({ tileWidth: repsTile, texts: ['10', ...stepperTexts(1, off, on(2), 2)], unit: null, stepSize: 44, fontScale: 1 });
    expect(fits(size, '10', repsTile, 44)).toBe(true);
  });

  it('keeps the full 38 pt when there is room, scaled with text size up to 1.8x', () => {
    expect(stepperNumeralSize({ tileWidth: 343, texts: ['8', '00'], unit: null, stepSize: 44, fontScale: 1 })).toBe(38);
    expect(stepperNumeralSize({ tileWidth: 343, texts: ['8', '00'], unit: null, stepSize: 44, fontScale: 3 })).toBeLessThanOrEqual(38 * 1.8);
  });

  it('leaves room for a unit (kg, s)', () => {
    const tile = ((375 - 32 - 12) * 1.4) / 2.4;
    const size = stepperNumeralSize({ tileWidth: tile, texts: ['102.5', '100', '105', '000'], unit: 'kg', stepSize: 44, fontScale: 1 });
    expect(numeralEms('102.5') * size + numeralEms(' kg') * 18 + 6).toBeLessThanOrEqual(tile - TILE_PADDING_H - 88);
  });
});
