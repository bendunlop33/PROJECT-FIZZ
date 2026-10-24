import type { DeleteItem } from '@fizz/domain';

/**
 * One operation ID per intent (rule 5; delete-workouts review S4, N2): the
 * same action on the same workouts at the same versions reuses its ID, so
 * a double tap or `Try again` comes back as a duplicate, never as a false
 * stale. A different selection, or the same workouts at new versions (after
 * a restore, say), is a new intent with a new ID.
 */
export function intentKey(kind: string, items: readonly DeleteItem[]): string {
  return `${kind}|${items
    .map((i) => `${i.sessionId}@${String(i.expectedVersion)}`)
    .sort()
    .join(',')}`;
}

export class IntentOps {
  private readonly ids = new Map<string, string>();

  constructor(private readonly mint: () => string) {}

  /** The op ID for this intent, minted once. */
  for(kind: string, items: readonly DeleteItem[]): string {
    const key = intentKey(kind, items);
    const found = this.ids.get(key);
    if (found !== undefined) return found;
    const id = this.mint();
    this.ids.set(key, id);
    return id;
  }
}
