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
 * The allowlist. The guard fails closed: any entitlement key not listed here
 * is an error, so a new capability (from a plugin update, say) can't reach
 * Ben's phone until someone deliberately checks it is free-provisionable and
 * adds it here. Keep this list short and justified.
 */
export const ALLOWED_ENTITLEMENTS: readonly string[] = [
  // App Group shared with the Live Activity extension (expo-widgets).
  'com.apple.security.application-groups',
  // Added by signing tools; the app's own Keychain group.
  'keychain-access-groups',
  'application-identifier',
  'com.apple.developer.team-identifier',
  // Development-signed builds (SideStore signs with a development certificate).
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
    } else if (!ALLOWED_ENTITLEMENTS.includes(key)) {
      findings.push({
        key,
        severity: 'error',
        message: `${key}: not on the free-provisioning allowlist. Check a free Apple ID can sign it, then add it to ALLOWED_ENTITLEMENTS`,
      });
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
