import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { todayActions } from '../src/today/today-view';
import { createHarness, setUpGym, type Harness } from './harness';

/**
 * (Ben, 26 Oct) "can you make the start empty workout easier to find?" `Empty workout` is a visible one-tap action on
 * Today in every state (under Start on the card, else its own row), hidden while a workout is open; it stays in `⋯`,
 * and Library › Workouts has it on its top row. It starts as `⋯`'s did: `start({ kind: 'empty' })`.
 */

const SRC = join(__dirname, '..', 'src');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');

type In = Parameters<typeof todayActions>[0];
const base: In = { openWorkout: false, read: 'ready', noPlan: false, cardShown: true, upNext: false };

describe('Today: Empty workout is visible in every state (view model)', () => {
  const states: [string, Partial<In>, boolean][] = [
    ['with a plan (card shown)', {}, true],
    ['paused plan, a day on the card', {}, true],
    ['paused plan, nothing picked', { cardShown: false }, false],
    ['no plan, a split day on the card', { noPlan: true }, true],
    ['no plan, Up next row (no card)', { noPlan: true, cardShown: false, upNext: true }, false],
    ['no plan, nothing to resolve (first use)', { noPlan: true, cardShown: false }, false],
    ['rest day / block done: no next day, no card', { cardShown: false }, false],
    ['done today, no day selected', { cardShown: false }, false],
    ['a failed read', { read: 'failed', cardShown: false }, false],
  ];
  for (const [name, over, onCard] of states) {
    it(name, () => {
      const a = todayActions({ ...base, ...over });
      expect(a.emptyWorkout).toBe(true);
      expect(a.emptyOnCard).toBe(onCard);
    });
  }

  it('hidden with an open workout (Resume takes over), whatever else is true', () => {
    for (const read of ['loading', 'failed', 'ready'] as const) {
      for (const cardShown of [true, false]) {
        const a = todayActions({ ...base, openWorkout: true, read, cardShown });
        expect(a.emptyWorkout).toBe(false);
        expect(a.emptyOnCard).toBe(false);
      }
    }
  });

  it('hidden while the session loads, so nothing moves under a finger when the card arrives', () => {
    expect(todayActions({ ...base, read: 'loading', cardShown: false })).toMatchObject({ emptyWorkout: false, emptyOnCard: false });
  });
});

describe('Today: the screen draws it and starts it the one way', () => {
  const screen = read('screens/TodayScreen.tsx');
  const card = read('screens/today/TodaySession.tsx');

  it('one start for every Empty workout on Today: start({ kind: "empty" }) (gym, alerts, check-in gate, op ID per intent)', () => {
    expect(screen).toContain("const startEmptyNow = () => void start({ kind: 'empty' });");
    // (Redesign v3 §A6) One pinned `Start Empty Workout` under Start Plan Workout, in every state but an open workout.
    expect(screen).toContain('{!openWorkout ? <StartDock plan={dockPlan} busy={starting} onPlan={onDockPlan} onEmpty={startEmptyNow}');
    // The idempotent op ID: kept per intent key (`empty`) until a start succeeds, so a double tap starts one workout.
    expect(screen).toContain('const opId = startOps.current.get(key) ?? newUuid();');
    expect(card).toContain('<SecondaryButton label={TODAY_PICK_COPY.startEmpty} disabled={busy} onPress={onEmpty} />');
  });

  it('(redesign v3 §A6) the dock: Start Plan Workout (primary) over Start Empty Workout (secondary), disabled while starting; no small link on the card', () => {
    const body = card.slice(card.indexOf('export function StartDock('));
    const startAt = body.indexOf('<PrimaryButton label={TODAY_PICK_COPY.startPlan}');
    const emptyAt = body.indexOf('<SecondaryButton label={TODAY_PICK_COPY.startEmpty}');
    expect(startAt).toBeGreaterThan(0);
    expect(emptyAt).toBeGreaterThan(startAt);
    expect(card).not.toContain('TODAY_V2_COPY.emptyWorkout');
    expect(read('ui/buttons.tsx')).toContain("minHeight: theme.target.min.height, justifyContent: 'center', opacity: pressed ? TEXT_PRESSED_OPACITY : 1");
  });

  it('Library › Workouts: on the top row (before the lists), hidden while a workout is open', () => {
    const lib = read('screens/routines/WorkoutsScreen.tsx');
    const emptyAt = lib.indexOf('label={LIBRARY_COPY_UI.emptyWorkout}');
    expect(emptyAt).toBeGreaterThan(0);
    expect(emptyAt).toBeLessThan(lib.indexOf('{view.rotation.length > 0 ? ('));
    expect(lib.indexOf('label={LIBRARY_COPY_UI.emptyWorkout}', emptyAt + 1)).toBe(-1);
    const top = lib.slice(lib.indexOf('{active ? ('), emptyAt);
    expect(top).toContain(') : (');
    expect(lib).toContain("navigation.dispatch(popToTabs({ screen: 'Today', params: { startEmpty: newUuid() } }));");
  });
});

describe('the start path on real SQLite: idempotent, one workout', () => {
  let h: Harness;
  beforeEach(() => {
    h = createHarness('2026-10-26T07:00:00.000Z');
  });
  afterEach(async () => {
    await h.cleanup();
  });

  it('a double tap (same op ID) starts one empty workout; a second start is refused while it is open', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const first = await s.workout.start({ gymId, opId: 'empty-1', checkIn: null });
    const again = await s.workout.start({ gymId, opId: 'empty-1', checkIn: null });
    if (!first.ok || !again.ok) throw new Error('start failed');
    expect(again.aggregate.session.id).toBe(first.aggregate.session.id);
    expect(first.aggregate.sets).toHaveLength(0);
    const other = await s.workout.start({ gymId, opId: 'empty-2', checkIn: null });
    expect(other.ok ? null : other.error.code).toBe('session_already_active');
  });
});
