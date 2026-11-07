import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CatalogueEntrySchema, type CatalogueEntry } from '../src/entry-schema';
import { GuideSchema, type Guide } from '../src/figure/guide-schema';

const ROOT = join(import.meta.dirname, '..');

export function squatRaw(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(ROOT, 'guides', 'barbell-back-squat', 'guide.json'), 'utf8')) as Record<string, unknown>;
}

export function squatEntry(): CatalogueEntry {
  return CatalogueEntrySchema.parse(JSON.parse(readFileSync(join(ROOT, 'data', 'exercises', 'barbell-back-squat.json'), 'utf8')));
}

/** A minimal valid guide; tests override parts of it. */
export function baseGuide(overrides: Record<string, unknown> = {}): Guide {
  return GuideSchema.parse({
    schemaVersion: 1,
    exerciseKey: 'test-guide',
    rig: 'adult-v1',
    view: 'side',
    facing: 'right',
    units: 'bodyHeight',
    durationMs: 3000,
    loop: 'cycle',
    ground: { y: 0, scrollPerCycle: 0 },
    props: [],
    keyframes: [
      { t: 0, label: 'Start', caption: 'Stand', root: { x: 0, y: 0.5, pelvisDeg: 0 } },
      { t: 1, sameAs: 0 },
    ],
    checks: { planted: [], romProfile: 'adult-default' },
    a11y: { summary: 'Test' },
    review: { status: 'draft', renderedWith: 'test' },
    ...overrides,
  });
}
