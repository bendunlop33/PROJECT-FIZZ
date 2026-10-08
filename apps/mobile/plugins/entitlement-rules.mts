/**
 * Free-provisioning rules (ADR 0004, docs/research/free-ios-install.md §1.2).
 *
 * A free Apple ID ("Personal Team") cannot provision these capabilities, so
 * any of them in a signed binary can make SideStore fail to sign or install
 * the app. Pure data + pure functions: used by the config plugin that strips
 * them at prebuild and by scripts/check-entitlements.ts in CI.
 */

export interface ForbiddenEntitlement {
  key: string;
  reason: string;
}

export const FORBIDDEN_ENTITLEMENTS: readonly ForbiddenEntitlement[] = [
  { key: 'aps-environment', reason: 'Push notifications (APNs) need the paid programme' },
  { key: 'com.apple.developer.aps-environment', reason: 'Push notifications (APNs) need the paid programme' },
  {
    key: 'com.apple.developer.usernotifications.time-sensitive',
    reason: 'Time-sensitive notifications need the paid programme',
  },
  { key: 'com.apple.developer.siri', reason: 'Siri / App Intents entitlement is not free-provisionable' },
  { key: 'com.apple.developer.associated-domains', reason: 'Associated Domains are not free-provisionable' },
  { key: 'com.apple.developer.icloud-container-identifiers', reason: 'iCloud is not free-provisionable' },
  { key: 'com.apple.developer.icloud-container-development-container-identifiers', reason: 'iCloud is not free-provisionable' },
  { key: 'com.apple.developer.icloud-container-environment', reason: 'iCloud is not free-provisionable' },
  { key: 'com.apple.developer.icloud-services', reason: 'iCloud is not free-provisionable' },
  { key: 'com.apple.developer.ubiquity-container-identifiers', reason: 'iCloud Documents are not free-provisionable' },
  { key: 'com.apple.developer.ubiquity-kvstore-identifier', reason: 'iCloud key-value storage is not free-provisionable' },
];

/**
 * Entitlements we expect and believe a free team can carry. Anything not in
 * either list is reported as a warning so a new capability gets a deliberate
 * look before it reaches Ben's phone.
 */
export const KNOWN_FREE_ENTITLEMENTS: readonly string[] = [
  'com.apple.security.application-groups',
  'keychain-access-groups',
  'application-identifier',
  'com.apple.developer.team-identifier',
  'get-task-allow',
];

/** Info.plist UIBackgroundModes values that imply a forbidden capability. */
export const FORBIDDEN_BACKGROUND_MODES: readonly ForbiddenEntitlement[] = [
  { key: 'remote-notification', reason: 'Remote-notification background mode implies push (APNs)' },
];

export interface EntitlementFinding {
  key: string;
  severity: 'error' | 'warning';
  message: string;
}

export function checkEntitlementKeys(keys: readonly string[]): EntitlementFinding[] {
  const findings: EntitlementFinding[] = [];
  for (const key of keys) {
    const forbidden = FORBIDDEN_ENTITLEMENTS.find((f) => f.key === key);
    if (forbidden !== undefined) {
      findings.push({ key, severity: 'error', message: `${key}: ${forbidden.reason}` });
    } else if (!KNOWN_FREE_ENTITLEMENTS.includes(key)) {
      findings.push({ key, severity: 'warning', message: `${key}: not on the known free-provisionable list; check before shipping` });
    }
  }
  return findings;
}

export function checkBackgroundModes(modes: readonly string[]): EntitlementFinding[] {
  return modes.flatMap((mode) => {
    const forbidden = FORBIDDEN_BACKGROUND_MODES.find((f) => f.key === mode);
    return forbidden === undefined
      ? []
      : [{ key: mode, severity: 'error' as const, message: `UIBackgroundModes ${mode}: ${forbidden.reason}` }];
  });
}
