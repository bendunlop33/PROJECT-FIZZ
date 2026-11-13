/**
 * (Ben, 27 Oct) Superset labels for a day's slots in order: each run of two or more slots with the same letter is a
 * superset, lettered A, B, … in the day's order (`A1`, `A2`); null for one on its own.
 */
export function supersetLabels(slots: readonly { supersetGroup: string | null }[]): (string | null)[] {
  const out: (string | null)[] = slots.map(() => null);
  let letter = 0;
  for (let i = 0; i < slots.length; ) {
    const g = slots[i]?.supersetGroup ?? null;
    let j = i + 1;
    while (g !== null && j < slots.length && slots[j]?.supersetGroup === g) j += 1;
    if (j - i > 1) {
      const l = String.fromCharCode(65 + (letter % 26));
      for (let k = i; k < j; k += 1) out[k] = `${l}${String(k - i + 1)}`;
      letter += 1;
    }
    i = j;
  }
  return out;
}

