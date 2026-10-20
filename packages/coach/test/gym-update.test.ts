import { describe, expect, it } from 'vitest';
import { buildQuickGymDraft, materialiseGymDraft } from '@fizz/domain';
import { exercise, GYM, idGen, OWNER, T0 } from '@fizz/domain/testing';
import type { Store } from '@fizz/persistence';
import type { Exercise } from '@fizz/schemas';
import { buildTurnRegistry, createGymUpdateExecutor, gateFor, gymChangeAsked, mentionsGymSetup, runCoachTurn } from '../src/index';
import { ScriptedCoachModel } from './fake-model';
import { call, memoryStore, ports, reply, request, words } from './turn-fixtures';

/** `update_gym` (Ben, 20 Oct; ADR 0029): applied with Undo when Ben said it, a card he applies otherwise. */
const legPress = exercise(900, 'Leg press', { catalogueKey: 'machine-leg-press', compatibleEquipment: ['plate_loaded_machine'], defaultLoadConvention: 'added' });

async function fullGym(store: Store) {
  const made = materialiseGymDraft(buildQuickGymDraft({ setup: 'full', unit: 'kg', dumbbellStep: 2.5 }), { name: 'Main gym', ownerId: OWNER, gymId: GYM, isDefault: true, atUtc: T0, newId: idGen(60_000), setup: 'full' });
  if (!made.ok) throw new Error('gym');
  await store.repos.gyms.createWithEquipment(made.gym, made.equipment);
  return made;
}

function executors(store: Store) {
  return {
    update_gym: createGymUpdateExecutor({
      store: store.repos.coach,
      gym: async () => {
        const gym = await store.repos.gyms.get(GYM);
        return gym === null ? null : { gym, equipment: await store.repos.equipment.listByGym(GYM), unit: 'kg' as const };
      },
      exercise: (key) => Promise.resolve<Exercise | null>(key === 'machine-leg-press' || key === legPress.id ? legPress : null),
    }),
  };
}

describe('when update_gym is offered and when it applies', () => {
  it.each([
    ['this gym has no leg press', true],
    ['There’s no smith machine here', true],
    ['the dumbbells go up in 2s', true],
    ['dumbbells only go up to 30 kg', true],
    ['how did my bench go?', false],
    ['add some curls', false],
    ['the gym was busy today', false],
  ])('%s → offered %s', (text, offered) => {
    expect(mentionsGymSetup(text)).toBe(offered);
    const names = buildTurnRegistry(gateFor({ kind: 'general', input: words(text), previousOffer: null, structuralSignals: [] })).tools.map((t) => t.name);
    expect(names.includes('update_gym')).toBe(offered);
  });

  it('applies on Ben’s own words or a verified quote; the coach’s own idea is an offer', () => {
    expect(gymChangeAsked('this gym has no leg press', {})).toBe(true);
    expect(gymChangeAsked('this gym has no leg press', { benAsked: true, benQuote: 'has no leg press' })).toBe(true);
    expect(gymChangeAsked('this gym has no leg press', { benAsked: false, benQuote: null })).toBe(false);
    expect(gymChangeAsked('how was that?', { benAsked: true, benQuote: 'no leg press' })).toBe(false);
    expect(gymChangeAsked(null, {})).toBe(false);
  });
});

describe('update_gym in a turn', () => {
  it('"this gym has no leg press" applies at once (Leg press: not here) with Undo', async () => {
    const store = await memoryStore();
    await fullGym(store);
    const model = new ScriptedCoachModel([
      [call('update_gym', { gymName: null, changes: [{ op: 'not_here', exerciseId: 'machine-leg-press' }], reason: 'Ben said so', benAsked: true, benQuote: 'this gym has no leg press' }), { type: 'completed' }],
      reply('Noted.'),
    ]);
    const result = await runCoachTurn(request({ input: words('this gym has no leg press') }), ports(store, model, executors(store)));
    const record = result.cards[0]?.record;
    expect(record).toMatchObject({ status: 'committed', detail: { kind: 'update_gym', gymName: 'Main gym', lines: ['Leg press: not here'] } });
    expect(result.cards[0]?.rendered.text).toBe('Main gym: Leg press: not here.');
    const plate = (await store.repos.equipment.listByGym(GYM)).find((e) => e.kind === 'plate_loaded_machine');
    expect(plate?.notFor).toEqual([legPress.id]);
    if (record === undefined) throw new Error('no card');
    const undone = await store.repos.coach.undo(OWNER, { ...record, actionId: '00000000-0000-4000-8000-000000000777', opId: 'undo-1', author: 'ben', turnId: null, status: 'committed', detail: { kind: 'undo', undoneActionId: record.actionId, what: 'the change to Main gym', restored: [], alreadyLogged: [] } });
    expect(undone.status).toBe('written');
    expect((await store.repos.equipment.listByGym(GYM)).find((e) => e.kind === 'plate_loaded_machine')?.notFor).toBeUndefined();
    await store.close();
  });

  it('the coach’s own idea is a card: nothing changes until Apply', async () => {
    const store = await memoryStore();
    await fullGym(store);
    const model = new ScriptedCoachModel([
      [call('update_gym', { gymName: null, changes: [{ op: 'dumbbells', max: null, step: 2 }], reason: 'Your logs show 2 kg jumps', benAsked: false, benQuote: null }), { type: 'completed' }],
      reply('Want me to change the dumbbell steps?'),
    ]);
    const before = await store.repos.equipment.listByGym(GYM);
    const result = await runCoachTurn(request({ input: words('the dumbbells here go up in 2s I think, what do you reckon?') }), ports(store, model, executors(store)));
    expect(result.cards[0]?.record).toMatchObject({ status: 'proposed', detail: { kind: 'update_gym', lines: ['Dumbbells: 2–50 kg, every 2'] } });
    expect(await store.repos.equipment.listByGym(GYM)).toEqual(before);
    await store.close();
  });

  it('a change the app can’t make is refused with its reason; nothing written', async () => {
    const store = await memoryStore();
    await fullGym(store);
    const model = new ScriptedCoachModel([
      [call('update_gym', { gymName: null, changes: [{ op: 'dumbbells', max: null, step: 12.5 }], reason: 'x', benAsked: true, benQuote: 'dumbbells go up in 12.5' }), { type: 'completed' }],
      reply('Done.'),
    ]);
    const before = await store.repos.equipment.listByGym(GYM);
    const result = await runCoachTurn(request({ input: words('the dumbbells go up in 12.5') }), ports(store, model, executors(store)));
    expect(result.cards[0]?.record).toMatchObject({ status: 'rejected', failure: 'a 12.5 kg dumbbell step isn’t possible' });
    expect(await store.repos.equipment.listByGym(GYM)).toEqual(before);
    await store.close();
  });
});
