import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

/**
 * scripts/ci/check-patched-binaries.sh against fake bundles (no otool or
 * plutil on Linux, so it falls back to the bundle name for the executable and
 * searches only files inside the bundles, and says so).
 */

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'ci', 'check-patched-binaries.sh');
const MACHO = Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0x0c, 0x00, 0x00, 0x01]);
const dirs: string[] = [];

function machO(text: string): Buffer {
  return Buffer.concat([MACHO, Buffer.from(`\0junk\0${text}\0more`)]);
}

function fakeApp(files: Record<string, Buffer | string>): string {
  const root = mkdtempSync(join(tmpdir(), 'fizz-bin-'));
  dirs.push(root);
  const app = join(root, 'Fizz.app');
  for (const [rel, content] of Object.entries(files)) {
    const path = join(app, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  return app;
}

function run(app: string) {
  const r = spawnSync('bash', [script, app], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

const APPEX = 'PlugIns/ExpoWidgetsTarget.appex';

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

// These tests run the real shell script; the failure path also runs the
// diagnostic tools (otool, strings, ...), which took 6.5 s on a GitHub runner.
describe('check-patched-binaries.sh', { timeout: 30_000 }, () => {
  it('passes when the app and extension executables contain the patch', () => {
    const r = run(fakeApp({ Fizz: machO('parentAltAppGroups'), [`${APPEX}/ExpoWidgetsTarget`]: machO('FizzAppGroupResolver') }));
    expect(r.out).toContain('Patched expo-widgets is in the code the app and the extension run');
    expect(r.out).toContain('PlugIns/ExpoWidgetsTarget.appex/ExpoWidgetsTarget: FizzAppGroupResolver');
    expect(r.code).toBe(0);
  });

  it("accepts the patch in another Mach-O the extension runs (e.g. Xcode's debug dylib)", () => {
    const r = run(
      fakeApp({
        Fizz: machO('parentAltAppGroups'),
        [`${APPEX}/ExpoWidgetsTarget`]: machO('stub'),
        [`${APPEX}/ExpoWidgetsTarget.debug.dylib`]: machO('parentAltAppGroups'),
      }),
    );
    expect(r.code).toBe(0);
    expect(r.out).toContain('(no otool: the extension');
  });

  it('accepts the patch in a framework the app loads', () => {
    const r = run(
      fakeApp({
        Fizz: machO('none'),
        'Frameworks/ExpoWidgets.framework/ExpoWidgets': machO('parentAltAppGroups'),
        [`${APPEX}/ExpoWidgetsTarget`]: machO('parentAltAppGroups'),
      }),
    );
    expect(r.code).toBe(0);
  });

  it('fails when the extension lacks the patch, with diagnostics', () => {
    const r = run(
      fakeApp({
        Fizz: machO('parentAltAppGroups'),
        [`${APPEX}/ExpoWidgetsTarget`]: machO('ExpoWidgetsAppGroupIdentifier'),
        // Text files never count, even if they contain a marker.
        [`${APPEX}/ExpoWidgets.bundle/main.js`]: 'parentAltAppGroups',
        [`${APPEX}/Info.plist`]: '<plist>parentAltAppGroups</plist>',
      }),
    );
    expect(r.code).toBe(1);
    expect(r.out).toContain('::error::Patched expo-widgets not found in anything the widget extension runs');
    expect(r.out).toMatch(/1 ExpoWidgetsAppGroupIdentifier/);
  });

  it('fails when the app lacks the patch', () => {
    const r = run(fakeApp({ Fizz: machO('nothing'), [`${APPEX}/ExpoWidgetsTarget`]: machO('parentAltAppGroups') }));
    expect(r.code).toBe(1);
    expect(r.out).toContain('::error::Patched expo-widgets not found in anything the app runs');
  });

  it('fails when the extension is missing', () => {
    const r = run(fakeApp({ Fizz: machO('parentAltAppGroups') }));
    expect(r.code).toBe(1);
    expect(r.out).toContain('ExpoWidgetsTarget.appex is missing');
  });
});
