import { describe, expect, it } from 'vitest';
import type { SessionAggregate } from '@fizz/schemas';
import { NBSP } from '@fizz/domain';
import { kg, values } from '../../../packages/domain/test/fixtures';
import { apply, BENCH, logCmd, setsFor, startFixture } from '../../../packages/domain/test/session-fixture';
import { popupCellWrite } from '../src/workout/exercise-popup';
import { createLiveActivityController, type LiveActivityPort } from '../src/live-activity/controller';
import { cueWords } from '../src/voice/cue-controller';
import { activePainFlagged, setActivePainFlagged } from '../src/workout/pain-flagged';

/** Last set carries (Ben, 21 Oct): the pop-up, Lock Screen and voice wiring read the carried load. */

function benchB1At97(): { s: SessionAggregate; b2: string } {
  let s = startFixture().state;
  const [w, b1, b2] = setsFor(s, BENCH);
  if (!w || !b1 || !b2) throw new Error('fixture');
  s = apply(s, logCmd(w.id, values(kg(60), 10), 60));
  s = apply(s, logCmd(b1.id, values(kg(97.5), 8), 300));
  return { s, b2: b2.id };
}

describe('last set carries: mobile wiring', () => {
  it('pop-up: retyping the carried 97.5 writes nothing; typing the plan’s 100 is a change', () => {
    const { s, b2 } = benchB1At97();
    expect(popupCellWrite(s, b2, 'kg', 97.5)).toEqual({ kind: 'unchanged', note: null });
    expect(popupCellWrite(s, b2, 'kg', 100)).toMatchObject({ kind: 'planned', patch: { load: kg(100) } });
    // A pain flag on the movement: a lighter carry still shows, so 97.5 is still the row's value.
    expect(popupCellWrite(s, b2, 'kg', 97.5, undefined, new Set([BENCH]))).toEqual({ kind: 'unchanged', note: null });
  });

  it('Live Activity reads the pain flags it is given; spoken cue says the carried load', async () => {
    const { s } = benchB1At97();
    const started: unknown[] = [];
    const port: LiveActivityPort = {
      available: () => true,
      listIds: () => [],
      start: (props: unknown) => {
        started.push(props);
        return 'a1';
      },
      update: () => undefined,
      end: () => undefined,
    } as unknown as LiveActivityPort;
    const c = createLiveActivityController(port, { tz: () => 'UTC', painFlagged: () => new Set<string>() });
    await c.reconcile(s, Date.parse(s.session.lastActivityAtUtc));
    expect(JSON.stringify(started).replaceAll(NBSP, ' ')).toContain('97.5 kg');
    expect(cueWords('rest_warning', s, 'timer_and_set')).toContain('97 and a half');
    expect(cueWords('rest_end', s, 'timer_and_set')).toBe('Rest over.');
  });

  it('the pain-flag cache holds what the workout read last', () => {
    setActivePainFlagged(new Set([BENCH]));
    expect(activePainFlagged()?.has(BENCH)).toBe(true);
  });
});
