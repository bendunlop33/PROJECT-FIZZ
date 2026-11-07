import type { Memory } from '@fizz/schemas';
import { toMs } from '../time';

/**
 * The Memory screen's lists (coach-memory §2.1, backlog §4.3). Pure. Memory
 * is Your data and only about Ben (CM9).
 *
 * - **Waiting**: the coach's suggestions, newest first. They are never sent to
 *   the coach (CM1). After 14 days without an answer they drop off (CM3),
 *   worked out at read time; the record stays as it was. A suggestion whose
 *   words are already saved isn't shown.
 * - **Saved**: confirmed memories (what the coach is sent), newest first.
 * Forgotten and not-saved memories aren't listed (decided conservatively,
 * 11 Oct: the screen is for what the coach may use and what waits for Ben).
 */

export const SUGGESTION_DAYS = 14;

export interface MemoryList {
  waiting: Memory[];
  saved: Memory[];
}

/** A `suggested` memory still waiting for Ben: younger than `SUGGESTION_DAYS` (CM3). An older one has dropped off. */
export function suggestionInDate(m: Pick<Memory, 'status' | 'createdAtUtc'>, nowUtc: string): boolean {
  return m.status === 'suggested' && toMs(nowUtc) - toMs(m.createdAtUtc) < SUGGESTION_DAYS * 86_400_000;
}

export function memoryList(memories: readonly Memory[], nowUtc: string): MemoryList {
  const savedKeys = new Set(memories.filter((m) => m.status === 'active').map((m) => m.contentKey));
  const newest = (a: Memory, b: Memory) => (a.updatedAtUtc < b.updatedAtUtc ? 1 : a.updatedAtUtc > b.updatedAtUtc ? -1 : a.id.localeCompare(b.id));
  return {
    waiting: memories
      .filter((m) => !savedKeys.has(m.contentKey) && suggestionInDate(m, nowUtc))
      .sort(newest),
    saved: memories.filter((m) => m.status === 'active').sort(newest),
  };
}

/** A suggestion Ben can still Save: waiting, in date, and not already saved in other words. */
export function memoryCanBeSaved(m: Memory, all: readonly Memory[], nowUtc: string): boolean {
  return memoryList(all, nowUtc).waiting.some((w) => w.id === m.id);
}

/** Memory text as Ben typed it: trimmed, single spaces, 1–200 characters; null when empty or too long. */
export function cleanMemoryText(text: string): string | null {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length === 0 || t.length > 200 ? null : t;
}
