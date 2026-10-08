import { describe, expect, it } from 'vitest';

import { APP_GROUP_IDENTIFIER, BUNDLE_IDENTIFIER, WIDGET_EXTENSION_BUNDLE_IDENTIFIER } from '../app-identity.mts';

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
