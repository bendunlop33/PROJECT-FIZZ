/**
 * Minimal-copy audit acceptance checks (docs/design/minimal-copy-audit.md §12;
 * CLAUDE.md "UI copy is minimal", Ben 10 Oct 2026).
 *
 * Check 1 is a scan of every string literal, template piece and JSX text in
 * the code that produces on-screen copy (apps/mobile/src, packages/domain/src,
 * packages/coach/src). Comments are never read: the files are parsed, so a
 * banned phrase in a comment doesn't count. Apostrophes match either way
 * (`’` or `'`), because source strings use curly ones.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

import { BUILT_IN_SOURCE_TAG, PAIN_PROFESSIONAL_TEXT, PAIN_RED_FLAG_TEXT, painClearConfirm, targetText } from '@fizz/domain';
import type { ActionRecord, PlannedSet, PlannedSource } from '@fizz/schemas';

import { describeBackupError } from '../src/backup/restore-view';
import { whyView } from '../src/coach/sheet-view';
import { slotView } from '../src/coach/slot-view';

const require = createRequire(import.meta.url);
// Babel ships no types here; the one call used is typed by hand.
const { parse } = require('@babel/parser') as { parse: (code: string, opts?: Record<string, unknown>) => { program: unknown } };

const ROOT = join(import.meta.dirname, '..', '..', '..');
const SCANNED = ['apps/mobile/src', 'packages/domain/src', 'packages/coach/src'];

/** Out of scope (audit header): diagnostic screens, and text sent only to the model. */
const EXCLUDED_FILES = new Set([
  'apps/mobile/src/screens/profile/DeveloperScreen.tsx',
  'apps/mobile/src/screens/CapabilityProbeScreen.tsx',
  'apps/mobile/src/screens/profile/ChatGptSignInTestScreen.tsx',
  // Tool descriptions and the system prompt (model-only).
  'packages/coach/src/registry.ts',
  'packages/coach/src/function-tools.ts',
  'packages/coach/src/request.ts',
  // Refusal lines the sheet filters out (model-only).
  'packages/coach/src/tool-call.ts',
]);
const EXCLUDED_DIRS = ['apps/mobile/src/probe/'];

/**
 * Text shown only after a `Why?` or `ⓘ` tap (allowed by check 1). Each entry
 * is a file and a fragment of the one string allowed there.
 */
const WHY_ONLY: readonly { file: string; fragment: string; why: string }[] = [
  { file: 'packages/domain/src/session/target-why.ts', fragment: 'Built-in rule ·', why: '`Set by` in the set card’s Why? (D1)' },
  { file: 'packages/coach/src/executors.ts', fragment: 'no change from the built-in rule', why: 'a refused record’s failure, shown only in the card’s Why? (Not changed)' },
];

/** §12 check 1, with `’` and `'` both matched. */
const BANNED = [
  'built-in rule',
  'snapped',
  'unless you say so',
  'never changes',
  'Nothing was lost',
  'Nothing changes',
  'Nothing was changed',
  'Nothing has been changed',
  'still work',
  'until you clear it',
  'isn’t a diagnosis',
  'can’t diagnose',
];

export function bannedPattern(phrase: string): RegExp {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[’']/g, '[’\']');
  return new RegExp(escaped, 'i');
}

function* sourceFiles(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* sourceFiles(p);
    else if (/\.tsx?$/.test(name) && !name.endsWith('.d.ts')) yield p;
  }
}

interface Found {
  file: string;
  line: number;
  text: string;
}

/** Every piece of literal text in a file: string literals, template pieces and JSX text. Code tokens (`'snapped'` as a kind) are skipped. */
function literalTexts(file: string): Found[] {
  const rel = relative(ROOT, file).split(sep).join('/');
  const ast = parse(readFileSync(file, 'utf8'), { sourceType: 'module', plugins: ['typescript', 'jsx'] });
  const out: Found[] = [];
  const visit = (node: unknown): void => {
    if (node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const n of node) visit(n);
      return;
    }
    const n = node as { type?: string; value?: unknown; loc?: { start: { line: number } } } & Record<string, unknown>;
    let text: string | null = null;
    if (n.type === 'StringLiteral' && typeof n.value === 'string') text = n.value;
    else if (n.type === 'TemplateElement') text = (n.value as { cooked: string | null }).cooked;
    else if (n.type === 'JSXText' && typeof n.value === 'string') text = n.value;
    // A bare lowercase token is a code value (an enum member, a kind), never copy.
    if (text !== null && !/^[a-z_]+$/.test(text.trim())) out.push({ file: rel, line: n.loc?.start.line ?? 0, text });
    for (const [k, v] of Object.entries(n)) {
      if (k === 'loc' || k === 'leadingComments' || k === 'trailingComments' || k === 'innerComments' || k === 'comments') continue;
      if (v !== null && typeof v === 'object') visit(v);
    }
  };
  visit(ast.program);
  return out;
}

function scan(phrases: readonly string[]): Found[] {
  const hits: Found[] = [];
  for (const dir of SCANNED) {
    for (const file of sourceFiles(join(ROOT, dir))) {
      const rel = relative(ROOT, file).split(sep).join('/');
      if (EXCLUDED_FILES.has(rel) || EXCLUDED_DIRS.some((d) => rel.startsWith(d))) continue;
      for (const f of literalTexts(file)) {
        if (WHY_ONLY.some((w) => w.file === f.file && f.text.includes(w.fragment))) continue;
        if (phrases.some((p) => bannedPattern(p).test(f.text))) hits.push(f);
      }
    }
  }
  return hits;
}

describe('§12 check 1: no rule labels or standing reassurance in on-screen copy', () => {
  it('the pattern matches curly and straight apostrophes, any case', () => {
    expect(bannedPattern('can’t diagnose').test('The coach can\'t diagnose.')).toBe(true);
    expect(bannedPattern('can’t diagnose').test('The coach can’t diagnose.')).toBe(true);
    expect(bannedPattern('built-in rule').test('Built-in rule (coach offline)')).toBe(true);
    expect(bannedPattern('Nothing changes').test('Nothing changed.')).toBe(false);
  });

  it('the scan reads literals and JSX text, not comments', () => {
    const texts = literalTexts(join(ROOT, 'apps/mobile/src/screens/workout/CheckInScreen.tsx')).map((f) => f.text);
    expect(texts.some((t) => t.includes('Which movements hurt?'))).toBe(true);
    // A comment in that file mentions "minimal copy"; comments are never collected.
    expect(texts.some((t) => t.includes('Behind an ⓘ by the title'))).toBe(false);
  });

  it('no banned phrase in any on-screen string', () => {
    expect(scan(BANNED).map((f) => `${f.file}:${String(f.line)}: ${f.text.trim()}`)).toEqual([]);
  });

  it('every Why?-only allowance still matches something (stale entries fail)', () => {
    for (const w of WHY_ONLY) {
      const texts = literalTexts(join(ROOT, w.file)).map((f) => f.text);
      expect(texts.some((t) => t.includes(w.fragment)), `${w.file}: ${w.why}`).toBe(true);
    }
  });
});

describe('§12 check 3: the set card target line (D1)', () => {
  /** A routine template's target carries no source. */
  const planned = (source: PlannedSource | null): PlannedSet => ({
    load: { value: 100, unit: 'kg', convention: 'total' },
    reps: { min: 6, max: 8 },
    durationS: null,
    rpe: null,
    rir: null,
    ...(source === null ? {} : { source }),
  });
  it('reads `Target …` for built-in, routine and repeat targets, and `Coach target …` for coach ones', () => {
    const t = (s: PlannedSource | null) => (targetText(planned(s), { convention: 'total' }) ?? '').replace(/\u00a0/g, ' ');
    expect(t('built_in_rule')).toBe('Target 100 kg · 6–8 reps');
    expect(t(null)).toBe('Target 100 kg · 6–8 reps');
    expect(t('repeat')).toBe('Target 100 kg · 6–8 reps');
    expect(t('coach')).toBe('Coach target 100 kg · 6–8 reps');
  });
});

describe('§12 check 4: Summary Next time tags (D1)', () => {
  it('a built-in row is tagged `Rule` whatever the coach’s state; nothing begins `Built-in rule`', () => {
    expect(Object.values(BUILT_IN_SOURCE_TAG)).toEqual(['Rule', 'Rule', 'Rule']);
  });
});

describe('§12 check 5: confirmations are a title and buttons', () => {
  it('clearing a pain flag (Undo follows) has no message line', () => {
    expect(painClearConfirm({ exerciseName: 'Bench press' })).toEqual({ title: 'Clear the pain flag on Bench press?', confirm: 'Clear flag', cancel: 'Keep it' });
  });
});

describe('§12 check 6: honesty kept', () => {
  it('data-at-risk failures still say `Data unchanged`', () => {
    expect(describeBackupError({ code: 'not_a_backup', message: '' })).toBe('This isn’t a GymSmarter backup file. Data unchanged.');
    expect(describeBackupError({ code: 'checksum_mismatch', message: '' })).toMatch(/Data unchanged\.$/);
  });
});

describe('§12 check 7: the pain step (D2)', () => {
  it('shows the professional line and the red-flag line, and never says the coach can’t diagnose', () => {
    expect(PAIN_PROFESSIONAL_TEXT).toBe('Sharp or lasting pain: see a physio or doctor.');
    expect(PAIN_RED_FLAG_TEXT).toBe('Chest pain, faintness or sudden severe pain: stop and get medical help now.');
    expect(PAIN_RED_FLAG_TEXT).toMatch(/medical/);
    const src = readFileSync(join(ROOT, 'apps/mobile/src/screens/workout/CheckInScreen.tsx'), 'utf8');
    // Both lines are shown from the domain constants, not copies, and not behind the ⓘ.
    expect(src).toContain('{PAIN_PROFESSIONAL_TEXT}');
    expect(src).toContain('{PAIN_RED_FLAG_TEXT}');
    expect(bannedPattern('can’t diagnose').test(src)).toBe(false);
  });
});

describe('§12 check 8: the coach slot banner (W13) and card Why? (W11)', () => {
  const AT = { utc: '2026-10-10T08:00:00.000Z', tz: 'Europe/London' };
  const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const kg = (value: number) => ({ value, unit: 'kg' as const, convention: 'total' as const });
  const record = (over: Partial<ActionRecord> & Pick<ActionRecord, 'detail'>): ActionRecord => ({
    actionId: ID(1),
    turnId: 't1',
    opId: 'op1',
    status: 'committed',
    author: 'coach',
    failure: null,
    reason: null,
    evidenceRefs: [],
    guardNotes: [],
    entityVersions: [],
    undoneBy: null,
    createdAt: AT,
    ...over,
  });
  const detail = {
    kind: 'adjust_pending_sets' as const,
    sessionId: ID(9),
    exercises: [{ sessionExerciseId: ID(10), exerciseName: 'Bench press', changes: [{ setId: ID(103), setNumber: 3, before: { load: kg(100), reps: { min: 6, max: 8 } }, after: { load: kg(97.5), reps: { min: 6, max: 8 } } }] }],
  };

  it('shows the change with Why? and Undo, and no guard-note sentence', () => {
    const a = record({ detail, guardNotes: [{ kind: 'snapped', setIds: [], text: 'Rounded to 97.5 kg' }, { kind: 'capped', setIds: [], text: 'Max here 30 kg each' }] });
    expect(slotView({ pending: false, adjustment: a, outcome: null, offer: null })).toMatchObject({ kind: 'banner', canUndo: true, notes: [] });
    // The checks are still there, behind Why?.
    expect(whyView(a).checks).toEqual(['Rounded to 97.5 kg', 'Max here 30 kg each']);
  });

  it('a pain block is the one visible warning, in its short form', () => {
    const a = record({ detail, guardNotes: [{ kind: 'pain_blocked', setIds: [], text: 'Not increasing Bench press: you mentioned shoulder pain.' }] });
    expect(slotView({ pending: false, adjustment: a, outcome: null, offer: null })).toMatchObject({ kind: 'banner', notes: ['Pain flag · no increases'] });
  });

  it('a playbook candidate’s card says `to review`; that it isn’t used until approved is behind Why?', () => {
    const a = record({ detail: { kind: 'add_playbook_candidate', candidateId: ID(70), text: 'Deload every 6 weeks' } });
    expect(whyView(a).checks).toContain('Not in use until you approve it.');
  });
});
