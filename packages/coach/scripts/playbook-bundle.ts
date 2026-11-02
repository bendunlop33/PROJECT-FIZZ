/**
 * Builds `packages/coach/data/playbook-v1.json`, the versioned bundle of the
 * approved playbook rules the coach is sent (ADR 0020 §6), from the rules
 * tables in `docs/training-guides/playbook-v1.md` (v1, then the rules approved 2 Nov). A unit test re-parses the
 * Markdown and fails when the bundle drifts from it.
 *
 * Usage: node --import ./packages/catalogue/scripts/ts-hooks.ts packages/coach/scripts/playbook-bundle.ts [--write]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export type PlaybookUse = 'in_use' | 'not_in_use' | 'code_only';

export interface PlaybookRule {
  id: string;
  short: string;
  appliesWhen: string;
  grade: string;
  use: PlaybookUse;
  /** Why it isn't in use, as sent to the coach. Null when in use. */
  note: string | null;
}

export interface PlaybookBundle {
  formatVersion: 1;
  source: string;
  approved: string;
  rules: PlaybookRule[];
}

/** `**x**` → `x`, `[text](link)` → `text`, `*x*` → `x`. */
function plain(cell: string): string {
  return cell
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Rules 11–13 need the endurance switch, and v1 has no endurance data (ADR 0020 §6). */
const NOT_IN_USE: Record<string, string> = {
  '11': 'not in use: no endurance training logged',
  '12': 'not in use: no endurance training logged',
  '13': 'not in use: no endurance training logged',
};

/** One `## Playbook rules (approved …)` section's table rows, in order. */
function sectionRows(markdown: string, heading: string): string[][] {
  const start = markdown.indexOf(heading);
  if (start < 0) throw new Error(`No "${heading.replace(/^## /, '')}" section`);
  const end = markdown.indexOf('\n## ', start + 5);
  const section = markdown.slice(start, end < 0 ? undefined : end);
  return section
    .split('\n')
    .filter((line) => line.startsWith('| '))
    .map((line) =>
      line
        .split('|')
        .slice(1, -1)
        .map((c) => c.trim()),
    );
}

/** v1's IDs; the 2 Nov table's are letters and a number (FQ1, VC3, LW2, PC1, RUN2, CW1). */
const V1_ID = /^(?:\d+|7-F|G|T)$/;
const LATER_ID = /^[A-Z]{1,4}\d{1,2}$/;

/**
 * The approved rules: v1's table, then (Ben, 2 Nov: "a good coach … must be able to say why") the short forms of
 * rules approved since that the app enforces, so the coach can name every rule it is held to. Candidates awaiting
 * Ben are never here.
 */
export function parsePlaybookRules(markdown: string): PlaybookRule[] {
  const rules: PlaybookRule[] = [];
  for (const cells of sectionRows(markdown, '## Playbook rules (approved v1)')) {
    const id = cells[0] ?? '';
    if (!V1_ID.test(id)) continue;
    const short = plain(cells[1] ?? '');
    if (/^Removed\b/.test(short)) continue;
    const use: PlaybookUse = id === '7-F' ? 'code_only' : NOT_IN_USE[id] !== undefined ? 'not_in_use' : 'in_use';
    rules.push({ id, short, appliesWhen: plain(cells[2] ?? ''), grade: plain(cells[3] ?? ''), use, note: NOT_IN_USE[id] ?? (id === '7-F' ? 'code: the built-in rule, never sent as advice' : null) });
  }
  for (const cells of sectionRows(markdown, '## Playbook rules (approved 2 Nov 2026)')) {
    const id = cells[0] ?? '';
    if (!LATER_ID.test(id)) continue;
    rules.push({ id, short: plain(cells[1] ?? ''), appliesWhen: plain(cells[2] ?? ''), grade: plain(cells[3] ?? ''), use: 'in_use', note: null });
  }
  return rules;
}

export function buildPlaybookBundle(markdown: string): PlaybookBundle {
  return { formatVersion: 1, source: 'docs/training-guides/playbook-v1.md', approved: '2026-10-09', rules: parsePlaybookRules(markdown) };
}

const here = fileURLToPath(new URL('.', import.meta.url));
export const PLAYBOOK_MD = `${here}../../../docs/training-guides/playbook-v1.md`;
export const PLAYBOOK_JSON = `${here}../data/playbook-v1.json`;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const bundle = buildPlaybookBundle(readFileSync(PLAYBOOK_MD, 'utf8'));
  const text = `${JSON.stringify(bundle, null, 2)}\n`;
  if (process.argv.includes('--write')) writeFileSync(PLAYBOOK_JSON, text);
  else process.stdout.write(text);
}
