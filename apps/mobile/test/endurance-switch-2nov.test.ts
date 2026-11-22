import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ModelRequest } from '@fizz/coach';

import { CONNECTED, replyWith, StepModel } from './coach-model';
import { FakeHealth } from './fake-health';
import { createHarness, setUpGym, type Harness } from './harness';

/**
 * (Ben, 2 Nov: "go") Rules 11–13 follow the endurance switch, worked out from his activities (Apple Health's runs
 * included) on every main coach turn. Real SQLite, a fake HealthKit and a scripted model; made-up runs, never Ben's.
 * Now is Mon 2 Nov 2026, 09:00 London.
 */

let h: Harness;
let model: StepModel;
let fake: FakeHealth;
beforeEach(() => {
  model = new StepModel([]);
  fake = new FakeHealth();
  h = createHarness('2026-11-02T09:00:00.000Z', { coach: { model: () => model, connection: () => Promise.resolve(CONNECTED) } });
});
afterEach(async () => {
  await h.cleanup();
});

const RUN = 37;
const launch = async () => {
  const s = (await h.launch({ health: { port: fake, buildIncludesHealth: true } })).services;
  await setUpGym(h, s);
  return s;
};
type Services = Awaited<ReturnType<typeof launch>>;

function block(req: ModelRequest | undefined, label: string): Record<string, unknown> {
  const b = req?.input.find((i) => i.type === 'message' && i.role === 'developer' && i.content.startsWith(label));
  if (b?.type !== 'message') throw new Error(`no ${label}`);
  return JSON.parse(b.content.slice(b.content.indexOf('\n') + 1)) as Record<string, unknown>;
}

async function ask(s: Services): Promise<{ switch: unknown; rules: Record<string, string> }> {
  model = new StepModel([() => replyWith('Ok.')]);
  const r = await s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text: 'How is my week looking?', spoken: false }, turnId: h.ids() });
  expect(r.status).toBe('completed');
  const req = model.requests[0];
  const k = block(req, 'COACHING KNOWLEDGE') as { playbook: { rules: { id: string; status: string }[] } };
  return { switch: block(req, 'YOUR DATA').enduranceSwitch, rules: Object.fromEntries(k.playbook.rules.filter((x) => ['11', '12', '13'].includes(x.id)).map((x) => [x.id, x.status])) };
}

const OFF = 'not in use: no hard/long/key endurance in plan or log';

describe('the endurance switch in the coach (app wiring)', () => {
  it('a long Garmin run read from Apple Health on Saturday: 11–13 in use, the run named in YOUR DATA', async () => {
    const s = await launch();
    fake.addGarmin({ activityType: RUN, startMs: Date.parse('2026-10-31T08:00:00.000Z'), endMs: Date.parse('2026-10-31T09:40:00.000Z'), distanceM: 18_000 });
    await s.health.setSwitch('readActivities', true);
    await s.health.readNow();
    const out = await ask(s);
    expect(out.rules).toEqual({ '11': 'in use', '12': 'in use', '13': 'in use' });
    expect(out.switch).toMatchObject({ on: true, session: { kind: 'run', date: '2026-10-31', status: 'done', effort: 'long' } });
  });

  it('a planned long run on Saturday: in use; only easy runs, or a missed planned long run: not in use', async () => {
    const s = await launch();
    const add = async (date: string, status: 'done' | 'planned', effort: 'easy' | 'long') => {
      const id = h.ids();
      expect(await s.activities.add({ id, fields: { kind: 'run', status, date, durationS: null, distanceM: null, effort }, opId: `a-${id}` })).toMatchObject({ ok: true });
      return id;
    };
    await add('2026-11-01', 'done', 'easy');
    await add('2026-10-31', 'planned', 'long'); // Saturday's, never linked or done: missed
    expect((await ask(s)).rules).toEqual({ '11': OFF, '12': OFF, '13': OFF });
    await add('2026-11-07', 'planned', 'long');
    const on = await ask(s);
    expect(on.rules).toEqual({ '11': 'in use', '12': 'in use', '13': 'in use' });
    expect(on.switch).toMatchObject({ on: true, session: { date: '2026-11-07', status: 'planned', from: 'Ben' } });
  });
});
