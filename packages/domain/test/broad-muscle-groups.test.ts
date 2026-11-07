import { describe, expect, it } from 'vitest';

import { MUSCLE_GROUPS } from '@fizz/schemas';

import { BROAD_GROUP_MUSCLES, BROAD_MUSCLE_GROUPS, broadGroupOfFilters, NO_FILTERS, withBroadGroup } from '../src';

/** (D5, Ben 22–23 Oct) Library › Exercises' muscle chips: All + six broad groups over the 11 detailed ones. */
describe('broad muscle groups for the Library chip row', () => {
  it('every detailed group sits in exactly one broad group, so nothing is reachable only under All', () => {
    const all = BROAD_MUSCLE_GROUPS.flatMap((g) => [...BROAD_GROUP_MUSCLES[g]]);
    expect([...all].sort()).toEqual([...MUSCLE_GROUPS].sort());
    expect(new Set(all).size).toBe(all.length);
  });

  it('a chip round-trips; All is null; muscles that aren’t one broad group read as no chip', () => {
    for (const g of BROAD_MUSCLE_GROUPS) expect(broadGroupOfFilters(withBroadGroup(NO_FILTERS, g))).toBe(g);
    expect(broadGroupOfFilters(NO_FILTERS)).toBeNull();
    expect(broadGroupOfFilters({ ...NO_FILTERS, muscles: ['Quads'] })).toBeNull();
    expect(broadGroupOfFilters({ ...NO_FILTERS, muscles: ['Calves', 'Glutes', 'Hamstrings', 'Quads'] })).toBe('Legs');
    expect(withBroadGroup({ ...NO_FILTERS, equipment: ['barbell'], muscles: ['Chest'] }, null)).toEqual({ ...NO_FILTERS, equipment: ['barbell'] });
  });
});
