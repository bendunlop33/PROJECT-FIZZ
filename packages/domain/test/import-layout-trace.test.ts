import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ImportMappingSpecV1Schema } from '@fizz/schemas';
import { applyImportSpec } from '../src';
import { OPTS, answerAll, specOf, tableOf } from './layout-fixtures';

/**
 * The AI never writes rows (rules 2, 6; checks 40, 42).
 * - The spec can't carry a set, a load value, a load convention, a record
 *   kind or a unit conversion (a scan of its JSON Schema).
 * - Every stored load and rep count is a number in that row's own cells.
 * - Only the FitNotes parser and `applyImportSpec` make source rows.
 */

type Node = { type?: string | string[]; properties?: Record<string, Node>; items?: Node; anyOf?: Node[]; oneOf?: Node[] };

/** Every property path of the spec's JSON Schema, and the type at each leaf. */
function paths(node: Node, at = ''): { path: string; type: string }[] {
  const out: { path: string; type: string }[] = [];
  for (const alt of [...(node.anyOf ?? []), ...(node.oneOf ?? [])]) out.push(...paths(alt, at));
  if (node.items) out.push(...paths(node.items, `${at}[]`));
  for (const [k, v] of Object.entries(node.properties ?? {})) {
    const p = at === '' ? k : `${at}.${k}`;
    const t = Array.isArray(v.type) ? v.type.join('|') : (v.type ?? (v.anyOf ? v.anyOf.map((x) => x.type).join('|') : 'any'));
    out.push({ path: p, type: t }, ...paths(v, p));
  }
  return out;
}

describe('the spec’s vocabulary (check 40)', () => {
  const schema = z.toJSONSchema(ImportMappingSpecV1Schema, { io: 'input' }) as Node;
  const all = paths(schema);

  it('has no field for a set, a load convention, a record kind or a conversion', () => {
    const names = new Set(all.flatMap((p) => p.path.split(/\.|\[\]/)).filter((x) => x !== ''));
    for (const forbidden of ['convention', 'loadConvention', 'recordKind', 'planned', 'done', 'perHand', 'conversion', 'convert', 'factor', 'multiplier', 'rows', 'sets_values', 'value', 'weight', 'kg', 'lb']) {
      expect(names.has(forbidden), forbidden).toBe(false);
    }
  });

  it('its only numbers are column positions, the header line, the version and the self-check readings', () => {
    const numeric = [...new Set(all.filter((p) => /number|integer/.test(p.type)).map((p) => p.path.replace(/\[\]/g, '')))].sort();
    expect(numeric).toEqual([
      'date.column.index',
      'exercise.index',
      'file.headerLine',
      'layout.setColumns.index',
      'layout.setOrder.index',
      'layout.sets.index',
      'load.column.index',
      'load.unit.column.index',
      'notes.index',
      'reps.index',
      'rpe.index',
      'selfCheck.line',
      'selfCheck.load',
      'selfCheck.reps',
      'setType.column.index',
      'specVersion',
      'unmapped.index',
      'workoutKey.index',
    ]);
  });
});

/** Numbers written in a row's cells (`100`, `82.5`, and each side of `100x8` or `3x8 @ 100`). */
function numbersIn(cells: readonly string[]): number[] {
  return cells.flatMap((c) => (c.match(/-?\d+(?:[.,]\d+)?/g) ?? []).map((n) => Number(n.replace(',', '.'))));
}

describe('every stored value is in its row’s cells (check 40)', () => {
  it.each([
    ['strong-new-kg', {}],
    ['strong-old', { unit: 'lb' as const, markers: { F: 'failure' as const } }],
    ['hevy-kg', {}],
    ['hevy-lbs', {}],
    ['hevy-assisted', {}],
    ['spreadsheet-sets-x-reps', { unit: 'kg' as const, notation: { '3': 'sets_x_reps' as const } }],
    ['spreadsheet-sets-x-reps', { unit: 'lb' as const, notation: { '3': 'reps_x_sets' as const } }],
    ['spreadsheet-wide', { notation: { '2': 'load_x_reps' as const } }],
    ['spreadsheet-packed-at', { notation: { '2': 'sets_x_reps' as const } }],
    ['liftosaur-like', {}],
  ])('%s %j', (name, over) => {
    const { answers } = answerAll(name, over);
    const rows = applyImportSpec(specOf(`${name}.spec.json`), answers, tableOf(`${name}.synthetic.csv`), OPTS).rows;
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      const nums = numbersIn(r.cells);
      if (r.weight) expect(nums, `row ${String(r.row)} load`).toContain(r.weight.value);
      if (r.reps !== null) expect(nums, `row ${String(r.row)} reps`).toContain(r.reps);
      // The unit is the header’s word, a unit cell, or Ben’s answer: never converted.
      if (r.weight && answers.unit !== null) expect(r.weight.unit).toBe(answers.unit);
    }
  });
});

describe('only code makes rows (check 42, the half that holds now)', () => {
  const read = (dir: URL): { file: string; text: string }[] =>
    readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((d) => d.isFile() && /\.tsx?$/.test(d.name))
      .map((d) => {
        const file = `${d.parentPath}/${d.name}`;
        return { file, text: readFileSync(file, 'utf8') };
      });

  it('a source row (`rowClass: …`) is built only in fitnotes.ts and layout/apply-spec.ts', () => {
    const roots = ['../../domain/src/', '../../coach/src/', '../../persistence/src/', '../../providers/src/', '../../../apps/mobile/src/'].map((p) => new URL(p, import.meta.url));
    const makers = roots
      .flatMap(read)
      .filter((f) => /rowClass:\s*['"]/.test(f.text) || /rowClass: (s\.reps|r\.)/.test(f.text))
      .map((f) => f.file.replace(/^.*\/(packages|apps)\//, '$1/'))
      .sort();
    expect(makers).toEqual(['packages/domain/src/import/fitnotes.ts', 'packages/domain/src/import/layout/apply-spec.ts']);
  });

  it('the coach package never reads rows or applies a layout', () => {
    const coach = read(new URL('../../coach/src/', import.meta.url));
    expect(coach.filter((f) => /applyImportSpec|SourceSetRow|planImportRows|analyseImport/.test(f.text)).map((f) => f.file)).toEqual([]);
  });
});
