import { PLAN_DAY_HEX, type PlanDayColour, type PlanDayColourKey, type WeekTile, type WeekTileMark } from '@fizz/domain';

import { progressPalette, withAlpha } from '../reviews/palette';
import type { ResolvedTheme } from '../theme';

/**
 * (Redesign v3 option B, Ben 27 Oct) Today's week tiles, pure so they are tested without a renderer: seven equal
 * tiles ≈64 pt tall with ≈7 pt gaps; done days tinted light green (Progress's done fill), planned days transparent with
 * a 1 pt outline, other days the faint shaded surface; today outlined 1.5 pt in the primary text colour. Marks are
 * 7 pt: a filled dot per done session in its plan day's colour, a hollow ring per activity, an empty ring in the
 * session's colour for a planned one. Colour is never the only signal (each tile's VoiceOver label says it).
 */

export const TILE_LAYOUT = { height: 64, gap: 7, radius: 10, letterSize: 11, dateSize: 15, mark: 7, markGap: 3, todayBorder: 1.5, plannedBorder: 1 } as const;

/** Plan-day colours: Progress's shared palette (`PLAN_DAY_HEX`, checked for colour-blind separation), so Today and the calendar agree. */
const HUE_OF: Readonly<Record<PlanDayColourKey, PlanDayColour>> = { push: 'orange', pull: 'blue', legs: 'violet', upper: 'aqua', lower: 'crimson', full: 'amber', neutral: 'neutral' };
export const PLAN_DAY_COLOURS: Readonly<Record<PlanDayColourKey, { dark: string; light: string }>> = {
  push: PLAN_DAY_HEX[HUE_OF.push],
  pull: PLAN_DAY_HEX[HUE_OF.pull],
  legs: PLAN_DAY_HEX[HUE_OF.legs],
  upper: PLAN_DAY_HEX[HUE_OF.upper],
  lower: PLAN_DAY_HEX[HUE_OF.lower],
  full: PLAN_DAY_HEX[HUE_OF.full],
  neutral: PLAN_DAY_HEX[HUE_OF.neutral],
};

/** Activities (rings): the run tint Today's strip used. */
export const ACTIVITY_COLOUR = { dark: '#7FB2E5', light: '#1F5F99' } as const;

export function markColour(mark: Pick<WeekTileMark, 'colour'>, theme: Pick<ResolvedTheme, 'scheme'>): string {
  return mark.colour === 'activity' ? ACTIVITY_COLOUR[theme.scheme] : PLAN_DAY_COLOURS[mark.colour][theme.scheme];
}

export interface TileStyle {
  backgroundColor: string;
  borderWidth: number;
  borderColor: string;
  dateColor: 'text.primary' | 'text.secondary' | 'text.tertiary';
}

export function tileStyle(tile: Pick<WeekTile, 'state' | 'today' | 'past'>, theme: Pick<ResolvedTheme, 'colors' | 'scheme'>): TileStyle {
  const pal = progressPalette(theme);
  const bg = tile.state === 'done' ? pal.doneFill : tile.state === 'planned' ? 'transparent' : withAlpha(theme.colors['text.primary'], theme.scheme === 'dark' ? 0.05 : 0.04);
  if (tile.today) return { backgroundColor: bg, borderWidth: TILE_LAYOUT.todayBorder, borderColor: theme.colors['text.primary'], dateColor: 'text.primary' };
  if (tile.state === 'planned') return { backgroundColor: bg, borderWidth: TILE_LAYOUT.plannedBorder, borderColor: theme.colors['border.control'], dateColor: 'text.primary' };
  return { backgroundColor: bg, borderWidth: 0, borderColor: 'transparent', dateColor: tile.past || tile.state === 'done' ? 'text.secondary' : 'text.primary' };
}

/** A mark's drawing: a filled dot, or a ring (1.5 pt) in its colour. */
export function markStyle(mark: WeekTileMark, theme: Pick<ResolvedTheme, 'scheme'>): { backgroundColor: string; borderWidth: number; borderColor: string } {
  const c = markColour(mark, theme);
  return mark.shape === 'dot' ? { backgroundColor: c, borderWidth: 0, borderColor: c } : { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: c };
}
