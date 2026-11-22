import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { catalogueExerciseId } from '@fizz/domain';

import { TodayScreen } from '../../src/screens/TodayScreen';
import type { Harness } from '../harness';
import { expectHealthy, renderScreen, type Rendered } from './render-screen';
import { benWithHistory, harness, todayData, withPlan } from './seed';

/**
 * (Ben, 3 Nov) The week's day sheet (`Wed · Lower A`, EXERCISE / SETS / TARGET) left out the bike warm-up the coach
 * put first on the day, while Library › Plan's day screen showed it. Rendered over real SQLite (ADR 0037): the sheet
 * lists the bike first with its time in SETS (`8 min`) and `—` for kg, never reps or `BW`. No React warning.
 */

const BIKE = catalogueExerciseId('exercise-bike');

let h: Harness;
beforeEach(() => {
  h = harness();
});
afterEach(async () => {
  await h.cleanup();
});

async function tapLabel(r: Rendered, label: RegExp): Promise<void> {
  const target = r.all((n) => typeof n.props.onPress === 'function' && typeof n.props.accessibilityLabel === 'string' && label.test(n.props.accessibilityLabel))[0];
  if (target === undefined) throw new Error(`nothing labelled ${String(label)}`);
  const onPress = target.props.onPress as (e: unknown) => unknown;
  await act(async () => {
    await onPress({ nativeEvent: {} });
  });
}

describe('the day sheet lists a cardio row', () => {
  it('Wednesday’s plan day with an 8-minute bike warm-up first: the sheet shows `Exercise bike`, `8 min`, `—` first', async () => {
    const ben = await benWithHistory(h);
    await withPlan(h, ben, { sessions: 4, schedule: 'set', days: [0, 2, 4, 5] });
    const d = await todayData(ben.s);
    const wed = d.week.planned.find((x) => x.localDate === '2026-10-21');
    const routineId = d.days.find((x) => x.key === wed?.key)?.templates[0]?.routineId ?? '';
    const t = (await ben.s.routines.editor({ routineId, gymId: null }))?.routine;
    if (wed === undefined || t == null) throw new Error('no Wednesday');
    // The write `propose_plan_add`'s Apply makes: the bike first, 8 min, marked as a warm-up, every week.
    const added = await ben.s.plans.editDayEveryWeek({ routineId, expectedVersion: t.version, opId: h.ids(), edit: { kind: 'add', rowId: h.ids(), fromExerciseId: null, toExerciseId: BIKE, afterRowId: null, sets: 1, first: true, durationS: 480, warmup: true } });
    expect(added.ok).toBe(true);

    const r = await renderScreen(h, ben.launched, TodayScreen, { name: 'Today' }, (x) => x.includes('Up next'));
    await tapLabel(r, /^Wednesday 21: /);
    await r.waitFor((x) => x.includes(`Wed · ${wed.name}`) && x.includes('Exercise bike'), 'the day sheet with the bike');
    const text = r.text();
    const at = text.indexOf('Exercise bike');
    expect(text.slice(at, at + 40)).toMatch(/^Exercise bike.*8 min.*—/s);
    // First in the list: no other exercise of the day before it.
    const sheet = ben.s.todaySession.daySheet(await todayData(ben.s), { date: '2026-10-21' }, null, (x) => x);
    expect(sheet.list[0]).toMatchObject({ fullName: 'Exercise bike', sets: '8 min', target: '—' });
    expect(sheet.list.slice(1).some((x) => x.exerciseId === BIKE)).toBe(false);
    for (const name of sheet.list.slice(1).map((x) => x.name)) expect(text.indexOf(name)).toBeGreaterThan(at);
    expectHealthy(r);
    await r.unmount();
  });
});
