/**
 * Worklets as the UI runtime runs them (How to crash, build 83).
 *
 * The worklets Babel plugin turns each worklet into a code string that the UI
 * runtime evaluates on its own, with module values only through
 * `this.__closure`, which the generated body destructures. A parameter default
 * can't see the body's bindings, so `maxPasses = MAX_AUTOPLAY_PASSES` threw a
 * ReferenceError on the first frame of every guide; uncaught on the UI thread,
 * it aborted the release build natively, so the app closed. Plain Node tests call the source
 * functions and never saw it. These tests run the real plugin over every app
 * file with a worklet and check the generated code itself.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
// Babel ships no types here; the two calls used are typed by hand.
const { transformSync } = require('@babel/core') as { transformSync: (code: string, opts: Record<string, unknown>) => { code?: string | null } | null };
const { parse } = require('@babel/parser') as { parse: (code: string, opts?: Record<string, unknown>) => { program: { body: unknown[] } & Node } };
const SRC = join(import.meta.dirname, '../src');
/** Every app source file with a worklet directive (keep in step with `grep -rl "'worklet'" apps/mobile/src`). */
const WORKLET_FILES = ['guide/clock.ts', 'guide/GuidePlayer.tsx'];
/** Files whose worklets are only helpers called inside another worklet's try (the runtime never runs them directly). */
const HELPER_ONLY_FILES = ['guide/clock.ts'];

function transform(file: string, commonjs: boolean): string {
  const source = readFileSync(join(SRC, file), 'utf8');
  const out = transformSync(source, {
    filename: join(SRC, file),
    babelrc: false,
    configFile: false,
    presets: [[require.resolve('@babel/preset-typescript'), { isTSX: file.endsWith('.tsx'), allExtensions: true }]],
    plugins: [
      [require.resolve('@babel/plugin-transform-react-jsx'), { runtime: 'automatic' }],
      ...(commonjs ? [require.resolve('@babel/plugin-transform-modules-commonjs')] : []),
      require.resolve('react-native-worklets/plugin'),
    ],
  });
  if (!out?.code) throw new Error(`no output for ${file}`);
  return out.code;
}

interface Node {
  type: string;
  [key: string]: unknown;
}

function walk(node: unknown, visit: (n: Node) => void): void {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  if (typeof node !== 'object' || node === null || typeof (node as Node).type !== 'string') return;
  visit(node as Node);
  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc' || key === 'start' || key === 'end') continue;
    walk(value, visit);
  }
}

/** The `code` strings of every worklet's init data in a transformed file. */
function workletCodes(transformed: string): string[] {
  const codes: string[] = [];
  walk(parse(transformed, { sourceType: 'module' }).program, (n) => {
    if (n.type !== 'ObjectProperty') return;
    const key = n.key as Node;
    const value = n.value as Node;
    if (key.type === 'Identifier' && key.name === 'code' && value.type === 'StringLiteral' && String(value.value).startsWith('function')) codes.push(String(value.value));
  });
  return codes;
}

/** Names the worklet takes from `this.__closure`, and identifiers its parameter defaults read. */
function closureAndDefaults(code: string): { closure: string[]; defaults: string[] } {
  const fn = (parse(`(${code})`).program.body[0] as { expression: Node }).expression;
  const closure: string[] = [];
  walk(fn.body, (n) => {
    if (n.type !== 'VariableDeclarator') return;
    const init = n.init as Node | null;
    if (init?.type !== 'MemberExpression' || (init.property as Node).name !== '__closure') return;
    for (const p of (n.id as { properties: { key: Node }[] }).properties) closure.push(String(p.key.name));
  });
  const defaults: string[] = [];
  for (const param of fn.params as Node[]) {
    if (param.type !== 'AssignmentPattern') continue;
    walk(param.right, (n) => {
      if (n.type === 'Identifier') defaults.push(String(n.name));
    });
  }
  return { closure, defaults };
}

describe('worklets as the UI runtime evaluates them', () => {
  it('lists every app file that has a worklet', () => {
    // A new worklet file must join WORKLET_FILES so the checks below cover it.
    const found: string[] = [];
    const scan = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) scan(path);
        else if (/\.tsx?$/.test(name) && /['"]worklet['"]/.test(readFileSync(path, 'utf8'))) found.push(path.slice(SRC.length + 1));
      }
    };
    scan(SRC);
    expect(found.sort()).toEqual([...WORKLET_FILES].sort());
  });

  for (const file of WORKLET_FILES) {
    it(`${file}: no parameter default reads a closure value (it would be a ReferenceError on the UI thread)`, () => {
      const codes = workletCodes(transform(file, false));
      expect(codes.length).toBeGreaterThan(0);
      for (const code of codes) {
        const { closure, defaults } = closureAndDefaults(code);
        expect(defaults.filter((name) => closure.includes(name)), code).toEqual([]);
      }
    });
  }

  it('runs the playback clock from its generated code alone, as the frame callback calls it', () => {
    type Worklet = ((...args: unknown[]) => unknown) & { __closure?: Record<string, unknown>; __initData?: { code: string } };
    const mod: { exports: Record<string, Worklet> } = { exports: {} };
    // eslint-disable-next-line @typescript-eslint/no-implied-eval -- evaluating our own transformed module, as Metro would
    const load = new Function('module', 'exports', 'require', transform('guide/clock.ts', true)) as (m: typeof mod, e: typeof mod.exports, r: NodeJS.Require) => void;
    load(mod, mod.exports, require);
    /** Rebuild a worklet the way the UI runtime does: its code string, bound to its closure (worklets inside converted too). */
    const onUi = (w: Worklet): ((...args: unknown[]) => unknown) => {
      const code = w.__initData?.code;
      if (code === undefined) throw new Error('not a worklet');
      const closure = Object.fromEntries(Object.entries(w.__closure ?? {}).map(([k, v]) => [k, typeof v === 'function' && '__initData' in v ? onUi(v as Worklet) : v]));
      // eslint-disable-next-line @typescript-eslint/no-implied-eval -- the generated worklet code, isolated from module scope
      const make = new Function(`return (${code})`) as () => (...args: unknown[]) => unknown;
      const fn = make();
      return (...args) => fn.apply({ __closure: closure }, args);
    };
    const advanceClock = onUi(mod.exports.advanceClock as Worklet);
    const frameIndexAt = onUi(mod.exports.frameIndexAt as Worklet);
    // Exactly the frame callback's calls (no maxPasses, a refresh interval or none).
    expect(advanceClock(0, 16, 1000, 'cycle')).toEqual({ elapsedMs: 16, finished: false });
    expect(advanceClock(2990, 16, 1000, 'cycle')).toEqual({ elapsedMs: 0, finished: true });
    expect(advanceClock(0, null, 1000, 'pingpong')).toEqual({ elapsedMs: 0, finished: false });
    expect(frameIndexAt(500, 1000, 30, 'cycle', 16)).toBe(15);
    expect(frameIndexAt(500, 1000, 30, 'cycle')).toBe(15);
  });

  /**
   * In a release build an uncaught worklet throw aborts the app natively (Worklets 0.10 forwards it to JS only in
   * debug builds), so each app worklet's try/catch is the only net on the UI thread (ADR 0018, review S3).
   */
  for (const file of WORKLET_FILES.filter((f) => !HELPER_ONLY_FILES.includes(f))) {
    it(`${file}: every worklet wraps its whole body in try/catch (after the closure and a \`done\` guard)`, () => {
      const codes = workletCodes(transform(file, false));
      expect(codes.length).toBeGreaterThan(0);
      for (const code of codes) {
        const fn = (parse(`(${code})`).program.body[0] as { expression: Node }).expression;
        let rest = (fn.body as { body: Node[] }).body;
        if (rest[0]?.type === 'VariableDeclaration') rest = rest.slice(1);
        if (rest[0]?.type === 'IfStatement' && (rest[0].consequent as Node).type === 'ReturnStatement' && rest[0].alternate === null) rest = rest.slice(1);
        expect(
          rest.map((n) => n.type),
          code,
        ).toEqual(['TryStatement']);
        expect((rest[0] as Node).handler, code).not.toBeNull();
      }
    });
  }

  it('the frame callback, run from its generated code, stops and reports a throw to JS instead of letting it escape', () => {
    const tickCode = workletCodes(transform('guide/GuidePlayer.tsx', false)).find((c) => c.includes('onClockError'));
    if (tickCode === undefined) throw new Error('tick worklet not found');
    const scheduled: unknown[][] = [];
    const onClockError = () => undefined;
    const onFinished = () => undefined;
    const run = (advanceClock: (...a: unknown[]) => unknown) => {
      const closure = {
        done: { value: false },
        elapsed: { value: 0 },
        frame: { value: 0 },
        durationMs: 1000,
        loop: 'cycle',
        count: 30,
        advanceClock,
        frameIndexAt: () => 3,
        scheduleOnRN: (...args: unknown[]) => scheduled.push(args),
        onFinished,
        onClockError,
      };
      // eslint-disable-next-line @typescript-eslint/no-implied-eval -- the generated worklet code, isolated from module scope
      const fn = (new Function(`return (${tickCode})`) as () => (info: unknown) => void)();
      const call = () => {
        fn.call({ __closure: closure }, { timeSincePreviousFrame: 16 });
      };
      return { closure, call };
    };

    const ok = run(() => ({ elapsedMs: 16, finished: false }));
    ok.call();
    expect(ok.closure.frame.value).toBe(3);
    expect(ok.closure.done.value).toBe(false);
    expect(scheduled).toEqual([]);

    const bad = run(() => {
      throw new ReferenceError('MAX_AUTOPLAY_PASSES is not defined');
    });
    expect(bad.call).not.toThrow();
    expect(bad.closure.done.value).toBe(true);
    expect(scheduled).toEqual([[onClockError, 'ReferenceError: MAX_AUTOPLAY_PASSES is not defined']]);
    bad.call(); // stopped: the next frame does nothing
    expect(scheduled).toHaveLength(1);

    // Even a failing hand-off to JS stays on the UI thread.
    const worst = run(() => {
      throw new Error('x');
    });
    worst.closure.scheduleOnRN = () => {
      throw new Error('no JS');
    };
    expect(worst.call).not.toThrow();
    expect(worst.closure.done.value).toBe(true);
  });
});
