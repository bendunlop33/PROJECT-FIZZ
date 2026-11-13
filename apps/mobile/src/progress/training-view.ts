import { PLAN_DAY_HEX, type DayTile, type PlanDayColour, type TileMark, type WeekBar } from '@fizz/domain';

import type { ColorScheme, ColorToken } from '../theme/tokens';

/**
 * (Redesign v3 C3, C4) How Progress › Training draws the domain's tiles, dots and bars: theme tokens and hexes only.
 * Pure; the screen applies them.
 */

export interface TileLook {
  /** Fill: light green on a day with anything logged, the plain tile otherwise; none for a future day. */
  fill: ColorToken | null;
  border: ColorToken | null;
  borderWidth: number;
  day: ColorToken;
  /** Future days are faded. */
  faded: boolean;
}

export function tileLook(tile: Pick<DayTile, 'state' | 'isToday'>, selected: boolean): TileLook {
  const fill: ColorToken | null = tile.state === 'done' ? 'status.done.subtle' : tile.state === 'future' ? null : 'bg.surface';
  // Today outlined; a busy day showing its list under the grid gets the accent; a future day just its edge.
  const border: ColorToken | null = selected ? 'accent' : tile.isToday ? 'text.primary' : tile.state === 'future' ? 'bg.surface' : null;
  const borderWidth = selected ? 2 : tile.isToday ? 1.5 : tile.state === 'future' ? 1 : 0;
  return { fill, border, borderWidth, day: tile.state === 'future' ? 'text.tertiary' : 'text.primary', faded: tile.state === 'future' };
}

/** A dot's colour in this theme; null for a ring (drawn as an outline in the secondary text colour). */
export function markHex(mark: TileMark, scheme: ColorScheme): string | null {
  return mark.kind === 'ring' ? null : dotHex(mark.colour, scheme);
}

export function dotHex(colour: PlanDayColour, scheme: ColorScheme): string {
  return PLAN_DAY_HEX[colour][scheme];
}

export interface BarLook {
  /** 0–1 of the plot height; a week with none keeps a sliver so the week still reads. */
  height: number;
  fill: ColorToken;
}

/** Weeks under the aim are greyed; the week in progress is never judged. */
export function barLook(bar: Pick<WeekBar, 'count' | 'underAim'>, max: number): BarLook {
  const h = max <= 0 ? 0 : bar.count / max;
  return { height: bar.count === 0 ? 0.02 : Math.min(1, h), fill: bar.underAim === true ? 'text.tertiary' : 'accent' };
}
