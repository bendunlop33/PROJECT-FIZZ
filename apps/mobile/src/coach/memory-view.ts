/**
 * The Memory screen's rows (coach-memory §2.1, backlog §4.3). Pure; minimal
 * copy (CLAUDE.md, 10 Oct): the words, where they came from and the date.
 * Memory is Your data.
 */

import { memoryTextKind } from '@fizz/coach';
import { toMs, type MemoryList } from '@fizz/domain';
import type { Memory } from '@fizz/schemas';

import { formatShortDate } from '../format/dates';

export interface MemoryRowView {
  id: string;
  version: number;
  text: string;
  /** `You asked the coach · Thu 8 Oct`, `Coach suggested · …`, `You · …`, `· edited`. */
  line: string;
  /** A waiting row whose words could be a general rule (CM9 split, review coach-tools r3 N5): `Memory` · `Playbook` instead of `Save`. */
  split: boolean;
}

const SOURCE: Record<NonNullable<Memory['source']>, string> = { ben_asked: 'You asked the coach', coach_suggested: 'Coach suggested', ben_added: 'You' };

export function memoryRow(m: Memory, tz: string): MemoryRowView {
  const edited = (m.edits?.length ?? 0) > 0 ? ' · edited' : '';
  return {
    id: m.id,
    version: m.version,
    text: m.text,
    line: `${SOURCE[m.source ?? 'ben_asked']} · ${formatShortDate(toMs(m.createdAtUtc), tz)}${edited}`,
    split: m.status === 'suggested' && memoryTextKind(m.text) !== 'personal',
  };
}

export interface MemoryScreenView {
  waiting: MemoryRowView[];
  saved: MemoryRowView[];
  /** Nothing saved or waiting. */
  empty: boolean;
}

export function memoryScreenView(list: MemoryList, tz: string): MemoryScreenView {
  return { waiting: list.waiting.map((m) => memoryRow(m, tz)), saved: list.saved.map((m) => memoryRow(m, tz)), empty: list.waiting.length === 0 && list.saved.length === 0 };
}
