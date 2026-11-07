import type { ConfigPlugin } from 'expo/config-plugins';
// The `.js` path is deliberate: Expo loads this file as native ESM (via the
// `.mts` import in app.config.ts) and `expo` has no exports map for this subpath.
import { withEntitlementsPlist, withInfoPlist } from 'expo/config-plugins.js';
import { FORBIDDEN_BACKGROUND_MODES, FORBIDDEN_ENTITLEMENTS } from './entitlement-rules.mts';

/**
 * Removes entitlements a free Apple ID cannot provision (ADR 0004).
 *
 * Needed because, as of SDK 57:
 * - expo-notifications 57.0.22 always adds `aps-environment` (even for
 *   local-only use);
 * - expo-widgets 57.0.23 adds `aps-environment` even when
 *   `enablePushNotifications` is false (its docs say it only does so when true).
 *
 * Applied directly to the config in app.config.ts (not via `plugins`) so it runs last. scripts/check-entitlements.ts verifies the
 * result after prebuild and again on the signed .app in CI.
 */
export const withFreeProvisioning: ConfigPlugin = (config) => {
  config = withEntitlementsPlist(config, (mod) => {
    for (const { key } of FORBIDDEN_ENTITLEMENTS) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- keys come from a fixed list
      delete mod.modResults[key];
    }
    return mod;
  });
  config = withInfoPlist(config, (mod) => {
    const modes: unknown = mod.modResults.UIBackgroundModes;
    if (Array.isArray(modes)) {
      const forbidden = new Set(FORBIDDEN_BACKGROUND_MODES.map((m) => m.key));
      const kept = modes.filter((m): m is string => typeof m === 'string' && !forbidden.has(m));
      if (kept.length > 0) mod.modResults.UIBackgroundModes = kept;
      else delete mod.modResults.UIBackgroundModes;
    }
    return mod;
  });
  return config;
};
