import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * 21 Oct (Ben, build B): "If I change the weights from pre set then it keeps
 * flicking back to before". The screen half of the fix, checked in source
 * (the pure halves are in packages/domain/test/weight-revert.test.ts and the
 * pop-up tests). Typing on a real iPhone is on Ben's device checklist.
 */

const SRC = join(__dirname, '..', 'src');
const workout = readFileSync(join(SRC, 'screens', 'workout', 'WorkoutScreen.tsx'), 'utf8');
const edits = readFileSync(join(SRC, 'screens', 'workout', 'WorkoutEdits.tsx'), 'utf8');

describe('the workout screen never puts an old weight back (R2)', () => {
  it('its unsaved edits are reconciled with every new workout state, through the domain helper', () => {
    expect(workout).toContain('reconcileDraftEdits(rawEdits, data.aggregate)');
  });
  it('the debounced draft save runs on a change to the edits only, through the tested saver (draft-edits-lifecycle.test.ts)', () => {
    expect(workout).not.toContain('}, [edits, data, services]);');
    expect(workout).toContain('draftSaver.schedule(edits);');
    expect(workout).toContain('}, [edits, draftSaver]);');
  });
  it('a stale draft save on a row switch re-reads and re-bases before selecting (S2)', () => {
    expect(workout).toMatch(/rebase: async \(\) => \{\s*const d = await reload\(\);/);
    expect(workout).toContain('reconcileDraftEdits(edits, d.aggregate)');
  });
  it('every edit records the set version it was made on, so a late save is refused as stale (rule 5)', () => {
    expect(workout).toContain('const next: DraftEdits = { setId: focus.setId, values, setVersion: focus.setVersion };');
    expect(workout.match(/copied: true, setVersion: f(ocus)?\.setVersion/g)?.length).toBe(2);
  });
  it('a pop-up value already on the row writes nothing (R4)', () => {
    expect(edits).toMatch(/case 'unchanged':\s*return w\.note;/);
  });
});
