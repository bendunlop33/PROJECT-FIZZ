import { describe, expect, it } from 'vitest';

import { PLAN_DAY_HEX, PLAN_DAY_HUE_ORDER, planDayColour, planDayHues, type PlanDayColour } from '../src/index';

/**
 * (Redesign v3 C3) One colour per plan day name, shared by Progress's calendar and Today's strip; checked for
 * colour-blind separation (Machado et al. 2009 full-severity simulation, CIEDE2000) and contrast on the day tiles.
 */

describe('planDayHues / planDayColour', () => {
  it('named splits keep their hue whatever the order', () => {
    const ppl = planDayHues(['Push', 'Pull', 'Legs']);
    expect([...ppl.values()]).toEqual(['orange', 'blue', 'violet']);
    expect(planDayHues(['Legs', 'push', ' PULL ']).get('push')).toBe('orange');
    const ul = planDayHues(['Upper', 'Lower', 'Full body']);
    expect([ul.get('upper'), ul.get('lower'), ul.get('full body')]).toEqual(['aqua', 'crimson', 'amber']);
  });

  it('other names take the unused hues in plan order; the same name is one colour', () => {
    const h = planDayHues(['Chest', 'Back', 'Push', 'Arms', 'Chest']);
    expect(h.get('push')).toBe('orange');
    expect(h.get('chest')).toBe('blue');
    expect(h.get('back')).toBe('violet');
    expect(h.get('arms')).toBe('crimson');
    expect(h.size).toBe(4);
  });

  it('more days than hues wrap rather than fail', () => {
    const names = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    const h = planDayHues(names);
    expect(h.size).toBe(7);
    expect(new Set([...h.values()].slice(0, 6)).size).toBe(6);
  });

  it('non-plan workouts are neutral; a day of another plan keeps its named hue', () => {
    expect(planDayColour(null, ['Push', 'Pull', 'Legs'])).toBe('neutral');
    expect(planDayColour('  ', ['Push'])).toBe('neutral');
    expect(planDayColour('Pull', ['Upper', 'Lower'])).toBe('blue');
    expect(planDayColour('Legs', ['Push', 'Pull', 'Legs'])).toBe('violet');
    // Stable: asking twice, or with the plan in another order, gives the same colour.
    expect(planDayColour('Arms', ['Chest', 'Back', 'Arms'])).toBe(planDayColour('Arms', ['Chest', 'Back', 'Arms']));
  });
});

// --- colour science (test-only) -------------------------------------------------

const MACHADO: Record<'protan' | 'deutan' | 'tritan', number[][]> = {
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritan: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};
type Vision = keyof typeof MACHADO | 'normal';
const lin = (c: number): number => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const rgb = (hex: string): [number, number, number] => [lin(parseInt(hex.slice(1, 3), 16)), lin(parseInt(hex.slice(3, 5), 16)), lin(parseInt(hex.slice(5, 7), 16))];
function simulate(hex: string, v: Vision): [number, number, number] {
  const l = rgb(hex);
  if (v === 'normal') return l;
  const m = MACHADO[v];
  const row = (r: number[]) => Math.min(1, Math.max(0, (r[0] ?? 0) * l[0] + (r[1] ?? 0) * l[1] + (r[2] ?? 0) * l[2]));
  return [row(m[0] ?? []), row(m[1] ?? []), row(m[2] ?? [])];
}
function lab([r, g, b]: [number, number, number]): [number, number, number] {
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}
/** CIEDE2000. */
function deltaE([L1, a1, b1]: [number, number, number], [L2, a2, b2]: [number, number, number]): number {
  const rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cb = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
  const ap1 = (1 + G) * a1;
  const ap2 = (1 + G) * a2;
  const Cp1 = Math.hypot(ap1, b1);
  const Cp2 = Math.hypot(ap2, b2);
  const hue = (x: number, y: number) => {
    const h = Math.atan2(y, x) / rad;
    return h < 0 ? h + 360 : h;
  };
  const h1 = hue(ap1, b1);
  const h2 = hue(ap2, b2);
  let dh = h2 - h1;
  if (Cp1 * Cp2 === 0) dh = 0;
  else if (dh > 180) dh -= 360;
  else if (dh < -180) dh += 360;
  const dL = L2 - L1;
  const dC = Cp2 - Cp1;
  const dH = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin((dh * rad) / 2);
  const Lb = (L1 + L2) / 2;
  const Cpb = (Cp1 + Cp2) / 2;
  let hb = h1 + h2;
  if (Cp1 * Cp2 !== 0) {
    if (Math.abs(h1 - h2) > 180) hb += h1 + h2 < 360 ? 360 : -360;
    hb /= 2;
  }
  const T = 1 - 0.17 * Math.cos((hb - 30) * rad) + 0.24 * Math.cos(2 * hb * rad) + 0.32 * Math.cos((3 * hb + 6) * rad) - 0.2 * Math.cos((4 * hb - 63) * rad);
  const SL = 1 + (0.015 * (Lb - 50) ** 2) / Math.sqrt(20 + (Lb - 50) ** 2);
  const SC = 1 + 0.045 * Cpb;
  const SH = 1 + 0.015 * Cpb * T;
  const dTheta = 30 * Math.exp(-(((hb - 275) / 25) ** 2));
  const RC = 2 * Math.sqrt(Cpb ** 7 / (Cpb ** 7 + 25 ** 7));
  const RT = -RC * Math.sin(2 * dTheta * rad);
  return Math.sqrt((dL / SL) ** 2 + (dC / SC) ** 2 + (dH / SH) ** 2 + RT * (dC / SC) * (dH / SH));
}
function minSeparation(colours: readonly PlanDayColour[], mode: 'dark' | 'light'): { min: number; pair: string } {
  let min = Number.POSITIVE_INFINITY;
  let pair = '';
  for (const v of ['normal', 'protan', 'deutan', 'tritan'] as const) {
    for (let i = 0; i < colours.length; i += 1) {
      for (let j = i + 1; j < colours.length; j += 1) {
        const a = colours[i] ?? 'neutral';
        const b = colours[j] ?? 'neutral';
        const d = deltaE(lab(simulate(PLAN_DAY_HEX[a][mode], v)), lab(simulate(PLAN_DAY_HEX[b][mode], v)));
        if (d < min) {
          min = d;
          pair = `${a}/${b} ${v}`;
        }
      }
    }
  }
  return { min, pair };
}
const luminance = (hex: string): number => {
  const [r, g, b] = rgb(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string): number => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return ((x ?? 0) + 0.05) / ((y ?? 0) + 0.05);
};

/** Day tile fills the dots sit on: surface and done-green, for every theme (Navy and Premium, dark and light). */
const TILES = { dark: ['#17202B', '#15301F', '#181615', '#1F2A38'], light: ['#FFFFFF', '#E4F3EA'] } as const;

describe('palette: colour-blind separation and contrast (C3)', () => {
  const sets: { name: string; colours: PlanDayColour[]; min: number }[] = [
    { name: 'Push/Pull/Legs + neutral', colours: ['orange', 'blue', 'violet', 'neutral'], min: 15 },
    { name: 'Upper/Lower + neutral', colours: ['aqua', 'crimson', 'neutral'], min: 15 },
    { name: 'Upper/Lower/Full body + neutral', colours: ['aqua', 'crimson', 'amber', 'neutral'], min: 15 },
    { name: 'first four fallback hues + neutral', colours: [...PLAN_DAY_HUE_ORDER.slice(0, 4), 'neutral'], min: 14 },
  ];
  for (const mode of ['dark', 'light'] as const) {
    for (const s of sets) {
      it(`${s.name} stay apart for normal, protan, deutan and tritan vision (${mode})`, () => {
        const r = minSeparation(s.colours, mode);
        expect(r.min, r.pair).toBeGreaterThanOrEqual(s.min);
      });
    }
    it(`every dot has ≥ 3:1 contrast on the day tiles (${mode})`, () => {
      for (const c of Object.keys(PLAN_DAY_HEX) as PlanDayColour[]) for (const t of TILES[mode]) expect(contrast(PLAN_DAY_HEX[c][mode], t), `${c} on ${t}`).toBeGreaterThanOrEqual(3);
    });
  }
});
