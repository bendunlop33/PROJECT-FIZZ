import type { ConfigPlugin } from 'expo/config-plugins';
// The `.js` path is deliberate (see with-free-provisioning.mts): Expo loads this file as native ESM.
import { withEntitlementsPlist } from 'expo/config-plugins.js';

/**
 * (Ben, 27 Oct; ADR 0035) Adds the HealthKit entitlement, and only that key: no background delivery, no
 * clinical records (`com.apple.developer.healthkit.access`). The usage strings are in app.config.ts.
 *
 * HealthKit stays a runtime capability (ADR 0004): if SideStore's signing drops the entitlement, the app's
 * probe sees it and Profile › Apple Health reads `Not available on this install`. `FIZZ_HEALTHKIT=0` builds
 * without the entitlement (a fallback if it ever stops SideStore from signing the app).
 */
export const withHealthKit: ConfigPlugin = (config) =>
  withEntitlementsPlist(config, (mod) => {
    mod.modResults['com.apple.developer.healthkit'] = true;
    return mod;
  });
