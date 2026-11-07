import { describe, expect, it } from 'vitest';
import type { Memory } from '@fizz/schemas';
import { cleanMemoryText, memoryCanBeSaved, memoryList } from '../src/index';
import { id } from './fixtures';

const DAY = 86_400_000;
const NOW = '2026-10-20T08:00:00.000Z';
const ago = (days: number) => new Date(Date.parse(NOW) - days * DAY).toISOString();

function memory(n: number, over: Partial<Memory> = {}): Memory {
  return { id: id(n), ownerId: id(1), version: 1, createdAtUtc: ago(1), updatedAtUtc: ago(1), text: `Memory ${String(n)}`, contentKey: `memory:${String(n)}`, status: 'active', quote: 'remember', createdByActionId: id(n + 100), ...over };
}

describe('memoryList (coach-memory §2.1, CM1–CM3)', () => {
  it('saved memories newest first; suggestions wait separately; forgotten and not-saved are left out', () => {
    const list = memoryList(
      [
        memory(1, { updatedAtUtc: ago(5) }),
        memory(2, { updatedAtUtc: ago(1) }),
        memory(3, { status: 'suggested' }),
        memory(4, { status: 'forgotten' }),
        memory(5, { status: 'not_saved' }),
      ],
      NOW,
    );
    expect(list.saved.map((m) => m.id)).toEqual([id(2), id(1)]);
    expect(list.waiting.map((m) => m.id)).toEqual([id(3)]);
  });

  it('a suggestion drops off after 14 days, and one whose words are already saved isn’t shown or saveable', () => {
    const old = memory(6, { status: 'suggested', createdAtUtc: ago(14), updatedAtUtc: ago(14) });
    const fresh = memory(7, { status: 'suggested', createdAtUtc: ago(13), updatedAtUtc: ago(13) });
    const dup = memory(8, { status: 'suggested', contentKey: 'memory:1' });
    const all = [memory(1), old, fresh, dup];
    expect(memoryList(all, NOW).waiting.map((m) => m.id)).toEqual([id(7)]);
    expect(memoryCanBeSaved(old, all, NOW)).toBe(false);
    expect(memoryCanBeSaved(fresh, all, NOW)).toBe(true);
    expect(memoryCanBeSaved(dup, all, NOW)).toBe(false);
  });

  it('cleanMemoryText trims and refuses empty or over-long text', () => {
    expect(cleanMemoryText('  hates   lunges ')).toBe('hates lunges');
    expect(cleanMemoryText('   ')).toBeNull();
    expect(cleanMemoryText('x'.repeat(201))).toBeNull();
  });
});
