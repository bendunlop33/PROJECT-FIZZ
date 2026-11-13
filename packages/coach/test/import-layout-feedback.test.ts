import { describe, expect, it } from 'vitest';
import { buildImportLayoutRepairRequest, IMPORT_LAYOUT_INSTRUCTIONS_V1, importLayoutFeedback, submitImportLayoutTool } from '../src';

/** The one correction request (ADR 0026 amendment, 13 Oct 2026): code's reasons, nothing new from the file. */
describe('importLayoutFeedback', () => {
  const sample = JSON.stringify({ kind: 'gymsmarter_import_sample', v: 1, rows: [{ line: 2, cells: ['2025-01-15T18:02:03Z', 'Bench'] }] });

  it('quotes a date cell only when that cell was already in the sample', () => {
    expect(importLayoutFeedback([{ kind: 'date', cell: '2025-01-15T18:02:03Z', row: 2 }], sample)).toContain('does not read "2025-01-15T18:02:03Z" (line 2)');
    const outside = importLayoutFeedback([{ kind: 'date', cell: '2025-09-30T07:00:00Z', row: 200 }], sample);
    expect(outside).not.toContain('2025-09-30');
    expect(outside).toContain('the date on line 200');
  });

  it('has one fixed sentence per reason', () => {
    const text = importLayoutFeedback(
      [
        { kind: 'schema' },
        { kind: 'unknown_column', header: 'Reps' },
        { kind: 'two_roles', header: 'Weight' },
        { kind: 'unit_token', token: 'lbs' },
        { kind: 'unit_column', header: 'Unit' },
        { kind: 'marker', token: '' },
        { kind: 'self_check', row: 3 },
        { kind: 'dry_run', percent: 40 },
        { kind: 'target_column', header: 'Target Reps' },
      ],
      sample,
    );
    expect(text.split('\n')).toHaveLength(11);
  });
});

describe('buildImportLayoutRepairRequest', () => {
  it('is the same instructions, the same sample byte for byte, the model’s own call and code’s reasons', () => {
    const req = buildImportLayoutRepairRequest('{"x":1}', 'gpt-test', { callId: 'c1', arguments: '{"a":1}' }, 'reasons');
    expect(req).toEqual({
      model: 'gpt-test',
      instructions: IMPORT_LAYOUT_INSTRUCTIONS_V1,
      input: [
        { type: 'message', role: 'user', content: '{"x":1}' },
        { type: 'function_call', callId: 'c1', name: 'submit_import_layout', arguments: '{"a":1}' },
        { type: 'function_call_output', callId: 'c1', output: 'reasons' },
      ],
      tools: [submitImportLayoutTool()],
      toolChoice: 'required',
      parallelToolCalls: false,
    });
  });
});
