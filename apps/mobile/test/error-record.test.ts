import { describe, expect, it } from 'vitest';

import {
  createContainmentScopes,
  createGlobalErrorHandler,
  errorOutcome,
  errorStatusDetail,
  formatErrorReport,
  MAX_MESSAGE_CHARS,
  MAX_STACK_CHARS,
  parseErrorRecord,
  toErrorRecord,
  type ErrorContext,
  type ErrorRecord,
} from '../src/diagnostics/error-record';

const CTX: ErrorContext = { nowUtc: '2026-10-10T15:00:00.000Z', tz: 'Europe/London', screen: 'HowTo', build: '0.1.0 (84)' };

function harness() {
  const saved: ErrorRecord[] = [];
  const passedOn: { error: unknown; isFatal: boolean | undefined }[] = [];
  const scopes = createContainmentScopes();
  const handler = createGlobalErrorHandler({
    previous: (error, isFatal) => {
      passedOn.push({ error, isFatal });
    },
    scopes,
    context: () => CTX,
    save: (r) => {
      saved.push(r);
    },
  });
  return { saved, passedOn, scopes, handler };
}

describe('error records', () => {
  it('keeps the error, screen, time and build, and nothing else', () => {
    const e = new ReferenceError('MAX_AUTOPLAY_PASSES is not defined');
    const r = toErrorRecord(e, true, null, CTX);
    expect(r).toMatchObject({ v: 1, name: 'ReferenceError', message: 'MAX_AUTOPLAY_PASSES is not defined', fatal: true, containedBy: null, screen: 'HowTo', atUtc: CTX.nowUtc, tz: 'Europe/London', build: '0.1.0 (84)' });
    expect(Object.keys(r).sort()).toEqual(['atUtc', 'build', 'containedBy', 'fatal', 'message', 'name', 'screen', 'stack', 'tz', 'v']);
  });

  it('truncates long messages and stacks', () => {
    const e = new Error('x'.repeat(5000));
    e.stack = 'y'.repeat(50_000);
    const r = toErrorRecord(e, false, null, CTX);
    expect(r.message.length).toBe(MAX_MESSAGE_CHARS);
    expect(r.stack?.length).toBe(MAX_STACK_CHARS);
  });

  it('handles thrown non-errors and error-like objects (Worklets forwards plain objects)', () => {
    expect(toErrorRecord('boom', false, null, CTX)).toMatchObject({ name: 'Thrown string', message: 'boom', stack: null });
    expect(toErrorRecord(undefined, false, null, CTX)).toMatchObject({ name: 'Thrown undefined', message: 'undefined' });
    expect(toErrorRecord({ name: 'TypeError', message: 'x is null', stack: 'at worklet' }, true, null, CTX)).toMatchObject({ name: 'TypeError', message: 'x is null', stack: 'at worklet' });
    const evil = {
      toString() {
        throw new Error('no');
      },
    };
    expect(toErrorRecord(evil, false, null, CTX).message).toBe('(unprintable)');
  });

  it('round-trips through the file and rejects anything else', () => {
    const r = toErrorRecord(new Error('a'), true, 'guide', CTX);
    expect(parseErrorRecord(JSON.stringify(r))).toEqual(r);
    expect(parseErrorRecord(null)).toBeNull();
    expect(parseErrorRecord('not json')).toBeNull();
    expect(parseErrorRecord('{"v":2,"message":"a","atUtc":"x"}')).toBeNull();
    expect(parseErrorRecord('null')).toBeNull();
    expect(parseErrorRecord(JSON.stringify({ ...r, atUtc: 'yesterday' }))).toBeNull();
  });

  it('reports in plain text with the outcome', () => {
    const r = toErrorRecord(new Error('a'), true, null, CTX);
    const text = formatErrorReport(r);
    expect(text).toContain('Build: 0.1.0 (84)');
    expect(text).toContain('Screen: HowTo');
    expect(text).toContain('Outcome: The app closed (fatal)');
    expect(text).toContain('Error: a');
    expect(errorOutcome({ ...r, containedBy: 'guide' })).toBe('The exercise guide stopped; the app stayed open');
    expect(errorOutcome({ ...r, fatal: false })).toBe('The app stayed open');
    expect(errorStatusDetail(r)).toBe('on HowTo · build 0.1.0 (84). Error: a');
    expect(errorStatusDetail({ ...r, screen: null, build: null })).toBe('Error: a');
  });
});

describe('global error handler', () => {
  it('records then passes on to React Native when nothing contains it', () => {
    const h = harness();
    const e = new Error('fatal elsewhere');
    h.handler(e, true);
    expect(h.saved).toHaveLength(1);
    expect(h.saved[0]).toMatchObject({ fatal: true, containedBy: null, message: 'fatal elsewhere' });
    expect(h.passedOn).toEqual([{ error: e, isFatal: true }]);
  });

  it('contains a fatal error while the guide scope is open: the fallback runs once, the app stays open', () => {
    const h = harness();
    const told: unknown[] = [];
    const close = h.scopes.open('guide', (e) => told.push(e));
    const e = new ReferenceError('MAX_AUTOPLAY_PASSES is not defined');
    h.handler(e, true);
    h.handler(e, true); // the next frame, before the player unmounts
    expect(h.passedOn).toEqual([]);
    expect(told).toEqual([e]);
    expect(h.saved.map((r) => r.containedBy)).toEqual(['guide', 'guide']);
    expect(h.saved[0]?.fatal).toBe(true);
    close();
    expect(h.scopes.size).toBe(0);
    h.handler(e, true);
    expect(h.passedOn).toHaveLength(1);
  });

  it('a failing fallback or save never turns into a different outcome', () => {
    const scopes = createContainmentScopes();
    scopes.open('guide', () => {
      throw new Error('fallback broke');
    });
    const passedOn: unknown[] = [];
    const handler = createGlobalErrorHandler({
      previous: (e) => passedOn.push(e),
      scopes,
      context: () => CTX,
      save: () => {
        throw new Error('disk full');
      },
    });
    expect(() => {
      handler(new Error('x'), true);
    }).not.toThrow();
    expect(passedOn).toEqual([]);
  });

  it('the newest scope takes the error; closing one leaves the other', () => {
    const scopes = createContainmentScopes();
    const a: unknown[] = [];
    const b: unknown[] = [];
    const closeA = scopes.open('a', (e) => a.push(e));
    const closeB = scopes.open('b', (e) => b.push(e));
    expect(scopes.take(1)).toBe('b');
    closeB();
    closeB(); // idempotent
    expect(scopes.take(2)).toBe('a');
    closeA();
    expect(scopes.take(3)).toBeNull();
    expect(a).toEqual([2]);
    expect(b).toEqual([1]);
  });

  it('works without a previous handler', () => {
    const handler = createGlobalErrorHandler({ previous: null, scopes: createContainmentScopes(), context: () => CTX, save: () => undefined });
    expect(() => {
      handler(new Error('x'));
    }).not.toThrow();
  });
});
