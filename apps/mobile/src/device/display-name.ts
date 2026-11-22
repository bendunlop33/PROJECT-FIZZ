/**
 * The app's display name at runtime (review R1). Its single source is
 * DISPLAY_NAME in app-identity.mts, which Metro can't import; app.config.ts
 * copies it into the embedded config's `extra.displayName`. The installed
 * app's own CFBundleDisplayName (expo-application) is the fallback, and
 * `unknown` is honest if both are missing. Pure, so it's tested in Node.
 */
export function displayNameFrom(extra: unknown, nativeName: string | null): string {
  const fromConfig = typeof extra === 'object' && extra !== null ? (extra as { displayName?: unknown }).displayName : undefined;
  if (typeof fromConfig === 'string' && fromConfig.trim() !== '') return fromConfig;
  if (nativeName !== null && nativeName.trim() !== '') return nativeName;
  return 'unknown';
}
