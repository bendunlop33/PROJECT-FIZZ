import { describe, expect, it } from 'vitest';

import { BUNDLE_IDENTIFIER, WIDGET_EXTENSION_BUNDLE_IDENTIFIER } from '../../apps/mobile/app-identity.mts';
import { ALLOWED_ENTITLEMENTS, checkEntitlementKeys, FORBIDDEN_ENTITLEMENTS } from '../../apps/mobile/plugins/entitlement-rules.mts';
import {
  checkEntitlementsXml,
  checkInfoPlistXml,
  checkPbxprojBundleIds,
  formatFindings,
  parsePlist,
} from '../check-entitlements';

const plist = (inner: string) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n${inner}\n</plist>`;

const APP_GROUP_ONLY = plist(
  '<dict>\n  <key>com.apple.security.application-groups</key>\n  <array>\n    <string>group.com.projectfizz.fizz</string>\n  </array>\n</dict>',
);

describe('parsePlist', () => {
  it('parses dicts, arrays, booleans, numbers and entities', () => {
    const xml = plist(
      '<dict><!-- c --><key>a</key><true/><key>b</key><false/><key>n</key><integer>42</integer>' +
        '<key>r</key><real>1.5</real><key>s</key><string>x &amp; y</string><key>arr</key><array><string>1</string><dict/></array></dict>',
    );
    expect(parsePlist(xml)).toEqual({ a: true, b: false, n: 42, r: 1.5, s: 'x & y', arr: ['1', {}] });
  });

  it('treats an empty plist as no value', () => {
    expect(parsePlist(plist(''))).toBeNull();
    expect(parsePlist('')).toBeNull();
    expect(parsePlist('<plist version="1.0"/>')).toBeNull();
  });

  it('rejects malformed input instead of guessing', () => {
    expect(() => parsePlist(plist('<dict><key>a</key></dict>'))).toThrow(SyntaxError);
    expect(() => parsePlist(plist('<dict><string>no key</string></dict>'))).toThrow(SyntaxError);
    expect(() => parsePlist('<dict></dict>')).toThrow(SyntaxError);
  });
});

describe('entitlement rules', () => {
  it('accepts the App Group used by the Live Activity extension', () => {
    expect(checkEntitlementsXml(APP_GROUP_ONLY, 'Fizz.entitlements')).toEqual([]);
  });

  it.each(FORBIDDEN_ENTITLEMENTS.map((f) => f.key))('fails on %s', (key) => {
    const xml = plist(`<dict><key>${key}</key><string>development</string></dict>`);
    const findings = checkEntitlementsXml(xml, 'Fizz.entitlements');
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('error');
  });

  it('fails on aps-environment alongside allowed keys (the expo-notifications/expo-widgets default)', () => {
    const xml = plist(
      '<dict><key>aps-environment</key><string>development</string><key>com.apple.security.application-groups</key><array><string>g</string></array></dict>',
    );
    const errors = checkEntitlementsXml(xml, 'x').filter((f) => f.severity === 'error');
    expect(errors.map((e) => e.key)).toEqual(['aps-environment']);
  });

  it('accepts every allowlisted key', () => {
    expect(checkEntitlementKeys(ALLOWED_ENTITLEMENTS)).toEqual([]);
  });

  it.each([
    'com.apple.developer.applesignin',
    'com.apple.developer.usernotifications.communication',
    'com.apple.developer.healthkit',
    'com.example.custom-key',
  ])('fails closed on %s, which is not on the allowlist', (key) => {
    expect(checkEntitlementKeys([key])).toEqual([expect.objectContaining({ severity: 'error', key })]);
  });

  it('warns when a signed binary carries no entitlements at all', () => {
    expect(checkEntitlementsXml('', 'Fizz.app')).toEqual([expect.objectContaining({ severity: 'warning' })]);
  });
});

describe('Info.plist checks', () => {
  const info = (extra: string) =>
    plist(`<dict><key>CFBundleIdentifier</key><string>${BUNDLE_IDENTIFIER}</string>${extra}</dict>`);

  it('passes the expected bundle ID with audio background mode', () => {
    expect(checkInfoPlistXml(info('<key>UIBackgroundModes</key><array><string>audio</string></array>'), 'Info', BUNDLE_IDENTIFIER)).toEqual([]);
  });

  it('fails on the remote-notification background mode', () => {
    const f = checkInfoPlistXml(info('<key>UIBackgroundModes</key><array><string>remote-notification</string></array>'), 'Info', null);
    expect(f).toEqual([expect.objectContaining({ severity: 'error', key: 'remote-notification' })]);
  });

  it('fails when Live Activity push is enabled', () => {
    const f = checkInfoPlistXml(info('<key>ExpoWidgets_EnablePushNotifications</key><true/>'), 'Info', null);
    expect(f).toEqual([expect.objectContaining({ severity: 'error' })]);
  });

  it('fails when the built bundle ID differs from app-identity', () => {
    const xml = plist('<dict><key>CFBundleIdentifier</key><string>com.other.fizz</string></dict>');
    expect(checkInfoPlistXml(xml, 'Info', BUNDLE_IDENTIFIER)).toEqual([
      expect.objectContaining({ severity: 'error', key: 'CFBundleIdentifier' }),
    ]);
  });
});

describe('Xcode project bundle IDs', () => {
  const allowed = [BUNDLE_IDENTIFIER, WIDGET_EXTENSION_BUNDLE_IDENTIFIER];

  it('accepts the app and widget extension IDs', () => {
    const pbx = `PRODUCT_BUNDLE_IDENTIFIER = "${BUNDLE_IDENTIFIER}";\nPRODUCT_BUNDLE_IDENTIFIER = "${WIDGET_EXTENSION_BUNDLE_IDENTIFIER}";`;
    expect(checkPbxprojBundleIds(pbx, 'pbx', allowed)).toEqual([]);
  });

  it('fails on a changed or unexpected ID', () => {
    const f = checkPbxprojBundleIds('PRODUCT_BUNDLE_IDENTIFIER = com.changed.fizz;', 'pbx', allowed);
    expect(f.map((x) => x.severity)).toEqual(['error', 'error']);
  });
});

describe('formatFindings', () => {
  it('reports OK when there is nothing to report', () => {
    expect(formatFindings([])).toMatch(/OK/);
  });
});
