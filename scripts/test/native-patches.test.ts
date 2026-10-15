import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Guards the pinned native patches (ADR 0007). `npm install`/`npm ci` apply
 * them via the root postinstall (patch-package --error-on-fail --error-on-warn).
 * These tests make `npm run check` fail if a patch was not applied, if the
 * patched package was upgraded, or if the package would be linked precompiled
 * (in which case the patched Swift would silently not be compiled).
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const widgetsDir = join(root, 'node_modules', 'expo-widgets');
const PATCH = 'expo-widgets+57.0.23.patch';

function read(...parts: string[]): string {
  return readFileSync(join(...parts), 'utf8');
}

describe('expo-widgets runtime App Group patch', () => {
  it('has exactly one patch, for the installed expo-widgets version', () => {
    const patches = readdirSync(join(root, 'patches')).filter((f) => f.endsWith('.patch'));
    expect(patches).toEqual([PATCH]);
    const installed = JSON.parse(read(widgetsDir, 'package.json')) as { version: string };
    // Upgrading expo-widgets means re-reading its group handling and re-making the patch.
    expect(installed.version).toBe('57.0.23');
    const pinned = JSON.parse(read(root, 'apps', 'mobile', 'package.json')) as { dependencies: Record<string, string> };
    expect(pinned.dependencies['expo-widgets']).toBe('57.0.23');
  });

  it('is applied to node_modules (WidgetsStorage resolves the group at runtime)', () => {
    const storage = read(widgetsDir, 'ios', 'WidgetsStorage.swift');
    expect(storage).toContain('public static var appGroupIdentifier: String? = FizzAppGroupResolver.resolve()');
    expect(storage).toContain('enum FizzAppGroupResolver');
    expect(storage).toContain('"ALTAppGroups"');
    // scripts/ci/check-patched-binaries.sh looks for this literal in the built binaries.
    expect(storage).toContain('"parentAltAppGroups"');
  });

  it('every other group read in expo-widgets goes through WidgetsStorage (or only checks the key exists)', () => {
    // If a future version reads the Info.plist key for real use elsewhere, the
    // patch no longer covers it. TimelineProvider only nil-checks it today.
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (entry.name.endsWith('.swift') && read(path).includes('"ExpoWidgetsAppGroupIdentifier"')) {
          hits.push(path.slice(widgetsDir.length + 1));
        }
      }
    };
    walk(join(widgetsDir, 'ios'));
    // WidgetsStorage.swift is the patched resolver itself.
    expect(hits.sort()).toEqual(['ios/Widgets/TimelineProvider.swift', 'ios/WidgetsStorage.swift']);
    const provider = read(widgetsDir, 'ios', 'Widgets', 'TimelineProvider.swift');
    // The value is passed to parseTimeline, which ignores it and reads WidgetsStorage.
    expect(read(widgetsDir, 'ios', 'Widgets', 'Utils.swift')).toMatch(
      /func parseTimeline\(identifier: String, name: String, family: WidgetFamily\)[^{]*\{\s*let timeline = WidgetsStorage\.getArray/,
    );
    expect(provider).toContain('parseTimeline(identifier: groupIdentifier');
  });

  it('is compiled from source: expo-widgets ships no precompiled xcframework', () => {
    // Expo's Podfile turns on EXPO_USE_PRECOMPILED_MODULES by default; a package
    // with prebuilds/ would be linked as a binary and ignore the patched source.
    expect(existsSync(join(widgetsDir, 'prebuilds'))).toBe(false);
  });

  it('the probe reads the record keys the patch writes', () => {
    const storage = read(widgetsDir, 'ios', 'WidgetsStorage.swift');
    const probe = read(root, 'apps', 'mobile', 'modules', 'audio-coach', 'ios', 'AudioCoachModule.swift');
    expect(storage).toContain('static let recordKeyPrefix = "fizz.appGroupResolution."');
    expect(probe).toContain('"fizz.appGroupResolution."');
  });
});
