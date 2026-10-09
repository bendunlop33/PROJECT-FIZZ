import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import config from '../app.config';
import { displayNameFrom } from '../src/device/display-name';
import { APP_GROUP_IDENTIFIER, BUNDLE_IDENTIFIER, DISPLAY_NAME, IOS_PROJECT_NAME, WIDGET_EXTENSION_BUNDLE_IDENTIFIER } from '../app-identity.mts';

describe('app identity (ADR 0004)', () => {
  it('keeps the bundle ID that Ben installs under', () => {
    // Deliberate change detector. If this fails, someone changed the bundle ID.
    // After Ben's first install, a new bundle ID means a separate app with an
    // empty database. Only update this after reading ADR 0004 and planning an
    // export/restore migration.
    expect(BUNDLE_IDENTIFIER).toBe('com.projectfizz.fizz');
  });

  it('derives the App Group and widget IDs from it', () => {
    expect(APP_GROUP_IDENTIFIER).toBe(`group.${BUNDLE_IDENTIFIER}`);
    expect(WIDGET_EXTENSION_BUNDLE_IDENTIFIER.startsWith(`${BUNDLE_IDENTIFIER}.`)).toBe(true);
  });
});

describe('app name (approved 9 Oct 2026)', () => {
  it('shows GymSmarter while the Xcode project keeps its internal name', () => {
    expect(DISPLAY_NAME).toBe('GymSmarter');
    // Renaming the Expo `name` renames the Xcode project, workspace, scheme and
    // .app, which CI, the entitlement check and the patched-binary check rely on.
    expect(IOS_PROJECT_NAME).toBe('Fizz');
    expect(config.name).toBe(IOS_PROJECT_NAME);
    expect(config.ios?.infoPlist?.CFBundleDisplayName).toBe(DISPLAY_NAME);
    expect(config.slug).toBe('fizz');
  });

  it('gives the running app the same name, from the embedded config (review R1: backup headers)', () => {
    expect(config.extra?.displayName).toBe(DISPLAY_NAME);
    expect(displayNameFrom(config.extra, 'Something else')).toBe(DISPLAY_NAME);
    // Fallbacks: the installed app's own display name, then an honest unknown.
    expect(displayNameFrom({}, 'GymSmarter')).toBe('GymSmarter');
    expect(displayNameFrom(undefined, null)).toBe('unknown');
    expect(displayNameFrom({ displayName: ' ' }, '')).toBe('unknown');
    // No second hard-coded copy of the name in the app's code.
    const runtime = readFileSync(join(import.meta.dirname, '../src/device/runtime.ts'), 'utf8');
    expect(runtime).not.toContain(`'${DISPLAY_NAME}'`);
  });

  it('names the app in every permission prompt', () => {
    const plist = config.ios?.infoPlist ?? {};
    expect(plist.NSAlarmKitUsageDescription).toMatch(/^GymSmarter /);
    const speech = config.plugins?.find((p) => Array.isArray(p) && p[0] === 'expo-speech-recognition');
    const texts = Array.isArray(speech) ? Object.values(speech[1] as Record<string, string>) : [];
    expect(texts).toHaveLength(2);
    for (const t of texts) expect(t).toMatch(/^GymSmarter /);
  });

  it('keeps the IPA workflow on the internal project name and names the .ipa from the display name', () => {
    const workflow = readFileSync(join(import.meta.dirname, '../../../.github/workflows/ios-ipa.yml'), 'utf8');
    expect(workflow).toMatch(new RegExp(`^  IOS_PROJECT: ${IOS_PROJECT_NAME}$`, 'm'));
    expect(workflow).toContain('-workspace "$IOS_PROJECT.xcworkspace"');
    expect(workflow).toContain('DISPLAY_NAME="$(plutil -extract CFBundleDisplayName raw "$APP/Info.plist")"');
    expect(workflow).toContain('IPA_NAME="$DISPLAY_NAME-$VERSION-build$FIZZ_BUILD_NUMBER.ipa"');
  });
});
