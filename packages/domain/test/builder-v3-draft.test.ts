import { describe, expect, it } from 'vitest';
import { DraftPlanSchema, type VariationOp } from '@fizz/schemas';
import {
  addWarmup,
  applyBuilderEdit,
  applyVariation,
  buildFromSetup,
  builderChangeLine,
  builderChanges,
  fromDraftPlan,
  slotsOf,
  suggestVariationLabel,
  toDraftPlan,
  variationExtrasOf,
  withSlotRevs,
  workingCount,
  workoutFromTemplate,
  type BuilderContext,
  type BuilderWorkout,
  type DraftCodecContext,
} from '../src/index';
import { bar, context, info, INFO, pool } from './builder-v3-fixture';
import { id } from './fixtures';

/**
 * Builder v3 S3–S5 pure parts: the draft codec (a force-close loses
 * nothing), Ben's own edits, the Start prompt's change lines and the
 * variation extras.
 */

const KEYS = Object.keys(INFO);
const uuidOf = (k: string): string => id(9000 + KEYS.indexOf(k.split('#')[0] ?? k));

/** A context whose slot keys are UUIDs (the stored `slotKey`). */
function ctx(): BuilderContext {
  const base = context();
  let n = 0;
  return { ...base, newKey: () => id(20_000 + (n += 1)) };
}

const codec: DraftCodecContext = {
  info,
  catalogueIdOf: (e) => e,
  checkedOnOf: (e) => (e === 'bench' ? { equipmentId: bar.id, kind: bar.kind, convention: 'total', unit: 'kg', barKg: 20 } : null),
};

const chest = (c: BuilderContext, supersets = true): BuilderWorkout =>
  buildFromSetup(
    {
      minutes: 60,
      mainLiftExerciseId: 'bench',
      supersets,
      groups: [
        { group: 'Chest', count: 3 },
        { group: 'Triceps', count: 1 },
        { group: 'Abs', count: 1 },
      ],
    },
    pool,
    c,
  ).workout;

const ids = (w: BuilderWorkout) => w.blocks.map((b) => b.slots.map((s) => s.exerciseId).join('+'));

describe('draft codec (§4.4): stored plan round-trips the builder workout', () => {
  it('order, supersets, rows, typed kg, own rests and builder state survive', () => {
    const c = ctx();
    let w = chest(c);
    const fly = slotsOf(w.blocks).find((s) => s.exerciseId === 'cable_fly');
    expect(fly).toBeDefined();
    const typed = applyBuilderEdit(w, { kind: 'edit_row', slotKey: fly?.key ?? '', index: 0, patch: { kind: 'load', value: 21 } }, c);
    expect(typed.ok).toBe(true);
    if (typed.ok) w = typed.workout;
    const rest = applyBuilderEdit(w, { kind: 'rest', slotKey: fly?.key ?? '', restKind: 'working', seconds: 105 }, c);
    if (rest.ok) w = rest.workout;
    const plan = toDraftPlan(w, codec);
    // Stored exercise IDs are UUIDs: validate with the fixture's names mapped to UUIDs and back.
    const stored = { slots: plan.slots.map((s) => ({ ...s, exerciseId: uuidOf(s.exerciseId) })) };
    expect(DraftPlanSchema.safeParse(stored).error?.issues.map((i) => `${i.path.join('.')}: ${i.message}`) ?? []).toEqual([]);
    const parsed = DraftPlanSchema.parse(stored);
    const back = fromDraftPlan({ slots: parsed.slots.map((s) => ({ ...s, exerciseId: KEYS[Number(s.exerciseId.slice(-4)) - 9000] ?? '' })) });
    expect(ids(back)).toEqual(ids(w));
    expect(back.blocks.map((b) => b.auto)).toEqual(w.blocks.map((b) => b.auto));
    const flyBack = slotsOf(back.blocks).find((s) => s.exerciseId === 'cable_fly');
    // 21 kg on a 5 kg stack rounds down to 20, kept as typed (`ben`).
    expect(flyBack?.rows[0]).toMatchObject({ load: 20, typed: true });
    expect(flyBack?.restS).toEqual({ working: 105 });
    expect(flyBack?.touched).toBe(true);
    const bench = slotsOf(back.blocks).find((s) => s.main);
    expect(bench?.rows).toEqual(slotsOf(w.blocks).find((s) => s.main)?.rows);
    expect(plan.slots.find((s) => s.main)?.checkedOn?.equipmentId).toBe(bar.id);
  });

  it('a superset rests only after the round; warm-ups keep their own rest', () => {
    const c = ctx();
    const w = chest(c);
    const plan = toDraftPlan(w, codec);
    const groups = new Map<string, typeof plan.slots>();
    for (const s of plan.slots) if (s.supersetGroup !== null) groups.set(s.supersetGroup, [...(groups.get(s.supersetGroup) ?? []), s]);
    expect(groups.size).toBeGreaterThan(0);
    for (const members of groups.values()) {
      const first = members[0];
      const last = members[members.length - 1];
      expect(first?.setTemplates.filter((t) => t.setType !== 'warmup').every((t) => t.restS === null)).toBe(true);
      expect(last?.setTemplates.filter((t) => t.setType !== 'warmup').every((t) => t.restS === 90)).toBe(true);
    }
  });

  it('slot revisions move only for slots that changed (§4.4)', () => {
    const c = ctx();
    const w = chest(c);
    const first = withSlotRevs(null, toDraftPlan(w, codec));
    expect(first.plan.slots.every((s) => s.rev === 1)).toBe(true);
    const fly = slotsOf(w.blocks).find((s) => s.exerciseId === 'cable_fly');
    const r = applyBuilderEdit(w, { kind: 'add_set', slotKey: fly?.key ?? '' }, c);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const second = withSlotRevs(first.plan, toDraftPlan(r.workout, codec));
    expect(second.changed).toEqual([fly?.key]);
    expect(second.plan.slots.find((s) => s.slotKey === fly?.key)?.rev).toBe(2);
    expect(second.plan.slots.filter((s) => s.slotKey !== fly?.key).every((s) => s.rev === 1)).toBe(true);
  });
});

describe("Ben's own edits (§2.3–§2.5)", () => {
  it('swap keeps the position, superset and set count; loads recalculate', () => {
    const c = ctx();
    const w = chest(c, false);
    const fly = slotsOf(w.blocks).find((s) => s.exerciseId === 'cable_fly');
    const r = applyBuilderEdit(w, { kind: 'swap', slotKey: fly?.key ?? '', exerciseId: 'crossover' }, c);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const at = ids(w).indexOf('cable_fly');
    expect(ids(r.workout)[at]).toBe('crossover');
    const swapped = slotsOf(r.workout.blocks).find((s) => s.key === fly?.key);
    expect(swapped?.exerciseId).toBe('crossover');
    expect(workingCount(swapped ?? { rows: [] })).toBe(workingCount(fly ?? { rows: [] }));
    expect(r.changed).toEqual([fly?.key]);
  });

  it('swap or add refuses an exercise already in the workout; add stops at 10', () => {
    const c = ctx();
    const w = chest(c, false);
    const fly = slotsOf(w.blocks).find((s) => s.exerciseId === 'cable_fly');
    expect(applyBuilderEdit(w, { kind: 'swap', slotKey: fly?.key ?? '', exerciseId: 'bench' }, c)).toEqual({ ok: false, reason: 'already_in_workout' });
    let x = w;
    for (const e of ['hammer', 'curl', 'oh_ext', 'leg_ext', 'leg_curl', 'calf', 'row', 'lat_pulldown']) {
      const r = applyBuilderEdit(x, { kind: 'add_exercise', exerciseId: e }, c);
      if (r.ok) x = r.workout;
    }
    expect(slotsOf(x.blocks)).toHaveLength(10);
    expect(applyBuilderEdit(x, { kind: 'add_exercise', exerciseId: 'squat' }, c)).toEqual({ ok: false, reason: 'max_exercises' });
  });

  it('pairing two exercises that share a muscle is allowed and advised once, with the reason', () => {
    const c = ctx();
    const w = chest(c, false);
    const incline = slotsOf(w.blocks).find((s) => s.exerciseId === 'incline_db');
    const r = applyBuilderEdit(w, { kind: 'superset_next', slotKey: incline?.key ?? '' }, c);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.workout.blocks.some((b) => b.slots.length === 2 && !b.auto)).toBe(true);
    expect(r.advice?.kind).toBe('shared_muscle');
    expect(r.advice?.reason).toMatch(/^Both work your /);
  });

  it('the main lift never joins a superset (Q5)', () => {
    const c = ctx();
    const w = chest(c, false);
    const main = slotsOf(w.blocks).find((s) => s.main);
    expect(applyBuilderEdit(w, { kind: 'superset_next', slotKey: main?.key ?? '' }, c)).toEqual({ ok: false, reason: 'cannot_superset' });
  });

  it('move up / down: inside a superset swaps a ↔ b, a single moves past the next round', () => {
    const c = ctx();
    const w = chest(c);
    const pairAt = w.blocks.findIndex((b) => b.slots.length === 2);
    const b2 = w.blocks[pairAt]?.slots[1];
    const r = applyBuilderEdit(w, { kind: 'move', slotKey: b2?.key ?? '', dir: 'up' }, c);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.workout.blocks[pairAt]?.slots[0]?.key).toBe(b2?.key);
    const main = slotsOf(w.blocks).find((s) => s.main);
    expect(applyBuilderEdit(w, { kind: 'move', slotKey: main?.key ?? '', dir: 'up' }, c)).toEqual({ ok: false, reason: 'cannot_move' });
    const down = applyBuilderEdit(w, { kind: 'move', slotKey: main?.key ?? '', dir: 'down' }, c);
    expect(down.ok && down.workout.blocks[1]?.slots[0]?.key).toBe(main?.key);
  });

  it('delete set keeps at least one working set; + Set copies the last one, max 10', () => {
    const c = ctx();
    const w = chest(c, false);
    const fly = slotsOf(w.blocks).find((s) => s.exerciseId === 'cable_fly');
    let x = w;
    for (let i = 0; i < 2; i += 1) {
      const r = applyBuilderEdit(x, { kind: 'delete_set', slotKey: fly?.key ?? '', index: 0 }, c);
      expect(r.ok).toBe(true);
      if (r.ok) x = r.workout;
    }
    expect(applyBuilderEdit(x, { kind: 'delete_set', slotKey: fly?.key ?? '', index: 0 }, c)).toEqual({ ok: false, reason: 'keep_one_set' });
    for (let i = 0; i < 9; i += 1) {
      const r = applyBuilderEdit(x, { kind: 'add_set', slotKey: fly?.key ?? '' }, c);
      if (r.ok) x = r.workout;
    }
    expect(workingCount(slotsOf(x.blocks).find((s) => s.key === fly?.key) ?? { rows: [] })).toBe(10);
    expect(applyBuilderEdit(x, { kind: 'add_set', slotKey: fly?.key ?? '' }, c)).toEqual({ ok: false, reason: 'max_sets' });
  });

  it('+ Warm-up fills the biggest gap, rounded down, and stops at 4', () => {
    const c = ctx();
    const w = chest(c, false);
    const main = slotsOf(w.blocks).find((s) => s.main);
    expect(main).toBeDefined();
    if (main === undefined) return;
    const warm = main.rows.filter((r) => r.type === 'warmup');
    expect(warm.length).toBe(4);
    expect(addWarmup(main, c)).toEqual({ ok: false, reason: 'max_warmups' });
    const fewer = { ...main, rows: main.rows.filter((r, i) => r.type !== 'warmup' || i === 0) };
    const r = addWarmup(fewer, c);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const loads = r.slot.rows.filter((x) => x.type === 'warmup').map((x) => x.load ?? 0);
    expect(loads).toEqual([...loads].sort((a, b) => a - b));
    // Every warm-up load is one the 1.25 kg plates can make on a 20 kg bar (2.5 kg steps).
    for (const l of loads) expect(Math.abs((l - 20) / 2.5 - Math.round((l - 20) / 2.5))).toBeLessThan(1e-9);
  });

  it('a typed kg above a stack max is bounded to the max (rule 4)', () => {
    const c = ctx();
    const w = chest(c, false);
    const fly = slotsOf(w.blocks).find((s) => s.exerciseId === 'cable_fly');
    const r = applyBuilderEdit(w, { kind: 'edit_row', slotKey: fly?.key ?? '', index: 0, patch: { kind: 'load', value: 140 } }, c);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(slotsOf(r.workout.blocks).find((s) => s.key === fly?.key)?.rows[0]?.load).toBe(100);
    expect(r.rounded?.bounded).toBe('max');
  });

  it('a typed kg on per-hand dumbbells stays per hand; lb items keep lb', () => {
    const c = ctx();
    const w = chest(c, false);
    const db = slotsOf(w.blocks).find((s) => s.exerciseId === 'incline_db');
    expect(db?.convention).toBe('per_hand');
    const r = applyBuilderEdit(w, { kind: 'edit_row', slotKey: db?.key ?? '', index: db?.rows.findIndex((x) => x.type !== 'warmup') ?? 0, patch: { kind: 'load', value: 28 } }, c);
    expect(r.ok && slotsOf(r.workout.blocks).find((s) => s.key === db?.key)?.rows.find((x) => x.typed === true)?.load).toBe(27.5);
  });
});

describe('Start prompt changes (§2.8, Q11) and variation extras (§4.3)', () => {
  const nameOf = (e: string) => INFO[e]?.name ?? e;

  it('load-only edits list nothing; a swap, an add and a set count each list one line', () => {
    const c = ctx();
    const base = chest(c, false);
    const fly = slotsOf(base.blocks).find((s) => s.exerciseId === 'cable_fly');
    const loadOnly = applyBuilderEdit(base, { kind: 'edit_row', slotKey: fly?.key ?? '', index: 0, patch: { kind: 'load', value: 15 } }, c);
    expect(loadOnly.ok && builderChanges(base, loadOnly.workout)).toEqual([]);
    let w = base;
    const steps = [
      { kind: 'swap', slotKey: fly?.key ?? '', exerciseId: 'incline_bb' },
      { kind: 'add_exercise', exerciseId: 'hammer' },
    ] as const;
    for (const op of steps) {
      const r = applyBuilderEdit(w, op, c);
      if (r.ok) w = r.workout;
    }
    const push = slotsOf(w.blocks).find((s) => s.exerciseId === 'pushdown');
    const more = applyBuilderEdit(w, { kind: 'add_set', slotKey: push?.key ?? '' }, c);
    if (more.ok) w = more.workout;
    const lines = builderChanges(base, w).map((x) => builderChangeLine(x, nameOf));
    expect(lines).toEqual(['Cable fly → Incline barbell press', 'Add Hammer curl', 'Triceps pushdown: 3 → 4 sets']);
  });

  it('extras rebuild the edited workout from the template, and a template change reaches the variation', () => {
    const c = ctx();
    const template = chest(c, false);
    let w = template;
    const r1 = applyBuilderEdit(w, { kind: 'add_exercise', exerciseId: 'curl' }, c);
    if (r1.ok) w = r1.workout;
    const push = slotsOf(w.blocks).find((s) => s.exerciseId === 'pushdown');
    const r2 = applyBuilderEdit(w, { kind: 'move', slotKey: slotsOf(w.blocks).find((s) => s.exerciseId === 'curl')?.key ?? '', dir: 'up' }, c);
    if (r2.ok) w = r2.workout;
    const pushNow = slotsOf(w.blocks).find((s) => s.key === push?.key);
    const r3 = applyBuilderEdit(w, { kind: 'superset_next', slotKey: pushNow?.key ?? '' }, c);
    if (r3.ok) w = r3.workout;
    const ex = variationExtrasOf(template, w);
    expect(ex.ok).toBe(true);
    if (!ex.ok) return;
    const kinds = ex.extras.map((o: VariationOp) => o.kind);
    expect(kinds).toContain('add_slot');
    expect(kinds).toContain('pair');
    const again = applyVariation(template, ex.extras, c);
    expect(again.skipped).toEqual([]);
    expect(again.workout.blocks.some((b) => b.slots.map((s) => s.exerciseId).join('+') === 'pushdown+curl')).toBe(true);
    // The template drops Cable fly: the variation still applies, without it.
    const fly = slotsOf(template.blocks).find((s) => s.exerciseId === 'cable_fly');
    const trimmed = applyBuilderEdit(template, { kind: 'delete_exercise', slotKey: fly?.key ?? '' }, c);
    expect(trimmed.ok).toBe(true);
    if (!trimmed.ok) return;
    const v = applyVariation(trimmed.workout, ex.extras, c);
    expect(slotsOf(v.workout.blocks).some((s) => s.exerciseId === 'cable_fly')).toBe(false);
    expect(slotsOf(v.workout.blocks).some((s) => s.exerciseId === 'curl')).toBe(true);
    expect(suggestVariationLabel(builderChanges(template, w), info)).toBe('arms superset');
  });

  it('a template opens as stored (no rebuild): order, pairs and set counts', () => {
    const c = ctx();
    const w = workoutFromTemplate(
      [
        { exerciseId: 'bench', main: true, workingSets: 4, group: null },
        { exerciseId: 'cable_fly', main: false, workingSets: 2, group: 'A' },
        { exerciseId: 'crunch', main: false, workingSets: 2, group: 'A' },
        { exerciseId: 'not-in-catalogue', main: false, workingSets: 3, group: null },
      ],
      c,
    );
    expect(ids(w)).toEqual(['bench', 'cable_fly+crunch']);
    expect(slotsOf(w.blocks).map((s) => workingCount(s))).toEqual([4, 2, 2]);
  });
});
