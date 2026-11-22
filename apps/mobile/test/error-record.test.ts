import { describe, expect, it } from 'vitest';

import {
  createGlobalErrorHandler,
  errorOutcome,
  errorStatusDetail,
  formatErrorReport,
  GUIDE_CLOSE_NAME,
  MAX_MESSAGE_CHARS,
  MAX_STACK_CHARS,
  parseErrorRecord,
  parseGuideBreadcrumb,
  recordFromGuideBreadcrumb,
  toErrorRecord,
  toGuideBreadcrumb,
  type ErrorContext,
  type ErrorRecord,
} from '../src/diagnostics/error-record';

const CTX: ErrorContext = { nowUtc: '2026-10-10T15:00:00.000Z', tz: 'Europe/London', screen: 'HowTo', build: '0.1.0 (84)' };

function harness() {
  const saved: ErrorRecord[] = [];
  const passedOn: { error: unknown; isFatal: boolean | undefined }[] = [];
  const handler = createGlobalErrorHandler({
    previous: (error, isFatal) => {
      passedOn.push({ error, isFatal });
    },
    context: () => CTX,
    save: (r) => {
      saved.push(r);
    },
  });
  return { saved, passedOn, handler };
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

  it('handles thrown non-errors and error-like objects', () => {
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

  it('never swallows an error: fatal or not, it is recorded then passed on unchanged (review B1)', () => {
    const h = harness();
    const fatal = new Error('rest alert callback threw');
    const soft = new Error('soft');
    h.handler(fatal, true);
    h.handler(soft, false);
    h.handler(soft);
    expect(h.passedOn).toEqual([
      { error: fatal, isFatal: true },
      { error: soft, isFatal: false },
      { error: soft, isFatal: undefined },
    ]);
    expect(h.saved.map((r) => [r.fatal, r.containedBy])).toEqual([
      [true, null],
      [false, null],
      [false, null],
    ]);
  });

  it('a failing save still passes the error on', () => {
    const passedOn: unknown[] = [];
    const handler = createGlobalErrorHandler({
      previous: (e) => passedOn.push(e),
      context: () => CTX,
      save: () => {
        throw new Error('disk full');
      },
    });
    const e = new Error('x');
    expect(() => {
      handler(e, true);
    }).not.toThrow();
    expect(passedOn).toEqual([e]);
  });

  it('works without a previous handler', () => {
    const handler = createGlobalErrorHandler({ previous: null, context: () => CTX, save: () => undefined });
    expect(() => {
      handler(new Error('x'));
    }).not.toThrow();
  });
});

describe('How to breadcrumb (a native close leaves no JS error)', () => {
  const crumb = toGuideBreadcrumb(CTX);

  it('round-trips and rejects anything else', () => {
    expect(parseGuideBreadcrumb(JSON.stringify(crumb))).toEqual(crumb);
    expect(parseGuideBreadcrumb(null)).toBeNull();
    expect(parseGuideBreadcrumb('{')).toBeNull();
    expect(parseGuideBreadcrumb('{"v":1,"atUtc":"soon"}')).toBeNull();
    expect(parseGuideBreadcrumb('{"v":2,"atUtc":"2026-10-10T15:00:00.000Z"}')).toBeNull();
  });

  it('a leftover breadcrumb with no later JS error becomes a fatal Last error on How to', () => {
    const r = recordFromGuideBreadcrumb(crumb, null);
    expect(r).toMatchObject({ name: GUIDE_CLOSE_NAME, fatal: true, containedBy: null, screen: 'HowTo', atUtc: CTX.nowUtc, build: '0.1.0 (84)', stack: null });
    expect(r === null ? '' : errorOutcome(r)).toBe('The app closed');
    expect(r?.message).toContain('Exercise guide animations off');
    // An older error from before How to opened doesn't explain this close.
    const older = toErrorRecord(new Error('old'), false, null, { ...CTX, nowUtc: '2026-10-09T10:00:00.000Z' });
    expect(recordFromGuideBreadcrumb(crumb, older)?.name).toBe(GUIDE_CLOSE_NAME);
    // It survives the file round trip App status reads.
    expect(r === null ? null : parseErrorRecord(JSON.stringify(r))).toEqual(r);
  });

  it('a JS error recorded at or after the breadcrumb already explains the close', () => {
    const later = toErrorRecord(new Error('js fatal'), true, null, { ...CTX, nowUtc: '2026-10-10T15:00:05.000Z' });
    expect(recordFromGuideBreadcrumb(crumb, later)).toBeNull();
    expect(recordFromGuideBreadcrumb(crumb, { ...later, atUtc: crumb.atUtc })).toBeNull();
    expect(recordFromGuideBreadcrumb(null, null)).toBeNull();
  });
});
