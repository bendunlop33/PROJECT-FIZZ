import { describe, expect, it } from 'vitest';

import { logRefusal, reloadsAfterRefusal } from '../src/workout/log-refusal';

describe('a refused log says what is true', () => {
  it('a reused opId: the set is already saved, so the screen reloads and never says "not saved"', () => {
    expect(reloadsAfterRefusal('operation_id_reused')).toBe(true);
    const r = logRefusal({ code: 'operation_id_reused', message: 'This operation ID was already used for a different action.' });
    expect(r).toEqual({ banner: { severity: 'info', text: 'Already saved' }, clearEdits: true });
  });

  it('a failed write keeps the edit and asks for a retry (same opId)', () => {
    expect(reloadsAfterRefusal('write_failed')).toBe(false);
    expect(logRefusal({ code: 'write_failed', message: 'disk full' })).toEqual({ banner: { severity: 'warning', text: 'Set not saved. Try again.' }, clearEdits: false });
  });

  it('out of date: reload; other refusals show their message', () => {
    expect(reloadsAfterRefusal('stale_version')).toBe(true);
    expect(reloadsAfterRefusal('write_conflict')).toBe(true);
    expect(reloadsAfterRefusal('set_not_pending')).toBe(false);
    expect(logRefusal({ code: 'set_not_pending', message: 'Set already logged.' }).banner).toEqual({ severity: 'warning', text: 'Set already logged.' });
  });
});
