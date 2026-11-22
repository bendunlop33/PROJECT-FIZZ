import { describe, expect, it } from 'vitest';

import { addPlanVersion, applyPlan, buildPlanFromAnswers, currentPlanVersion, endPlan, pbNewPlanDraft, pbPlanIdFor, pbPlanVersion, pbSameDays, planRoutines, rotationRoutines, undoEndPlan, undoPlanApply } from '@fizz/domain';
import { at, OWNER, planBuilderFixture as F, profile } from '@fizz/domain/testing';
import type { PlanBuilderAnswers } from '@fizz/schemas';

import { checkIntegrity, openStore, type Store } from '../src/index';
import { memoryDriver } from './helpers';

/**
 * The plan builder on real SQLite (plan-builder.md §4): Ben's own Build writes an open plan once (idempotent on the
 * Build's op ID), a rebuild is a new version (stale refused), and Apply / Undo / End / Undo of End are the plan model's
 * own transactions, so Today and Library › Your plan read it like any plan.
 */

const BUILD_OP = '00000000-0000-4000-8000-00000000d001';
const PLAN = pbPlanIdFor(BUILD_OP);

function draftFor(a: PlanBuilderAnswers, opId = BUILD_OP) {
  const plan = buildPlanFromAnswers({ answers: a, profileSplit: null, kitOf: F.KIT_OF, historyOf: F.HISTORY_OF, nowMs: F.NOW });
  return pbNewPlanDraft({ plan, answers: a, kitOf: F.KIT_OF, ownerId: OWNER, gymId: null, equipmentVersion: 'eq', opId, at: at(0) });
}

async function seeded(): Promise<Store> {
  const store = await openStore(memoryDriver());
  await store.repos.profiles.save(profile(), null);
  return store;
}

const rotation = async (store: Store) => rotationRoutines(await store.repos.routines.listByOwner(OWNER)).map((r) => r.name);

describe('plan builder: Build, Apply, Undo on SQLite', () => {
  it('Build writes one open plan; a retried Build replays it', async () => {
    const store = await seeded();
    const d = draftFor(F.answers());
    expect(await store.repos.planDrafts.create(OWNER, d)).toMatchObject({ status: 'written', plan: { id: PLAN, status: 'open' } });
    expect(await store.repos.planDrafts.create(OWNER, d)).toMatchObject({ status: 'replayed' });
    expect(await store.repos.planDrafts.create('00000000-0000-4000-8000-0000000000ff', { ...d, ownerId: '00000000-0000-4000-8000-0000000000ff' })).toMatchObject({ status: 'missing' });
    const stored = await store.repos.planDrafts.get(PLAN);
    expect(stored === null ? null : currentPlanVersion(stored).builder?.answers).toEqual(F.answers());
    await store.close();
  });

  it('a rebuild with new answers is a new version; one on a stale version writes nothing (rule 5)', async () => {
    const store = await seeded();
    const d = draftFor(F.answers());
    await store.repos.planDrafts.create(OWNER, d);
    const a2 = F.answers({ minutes: 45 });
    const plan2 = buildPlanFromAnswers({ answers: a2, profileSplit: null, kitOf: F.KIT_OF, historyOf: F.HISTORY_OF, nowMs: F.NOW });
    const v2 = pbPlanVersion({ plan: plan2, answers: a2, kitOf: F.KIT_OF, gymId: null, equipmentVersion: 'eq', opId: '00000000-0000-4000-8000-00000000d002', at: at(10), planId: PLAN });
    expect(pbSameDays(v2, currentPlanVersion(d))).toBe(false);
    const ok = await store.repos.planDrafts.write(OWNER, PLAN, (c) => addPlanVersion(c, { version: v2, expectedVersion: 1, opId: 'rebuild-1', at: at(10) }));
    expect(ok).toMatchObject({ status: 'written', plan: { currentVersion: 2, version: 2 } });
    const stale = await store.repos.planDrafts.write(OWNER, PLAN, (c) => addPlanVersion(c, { version: v2, expectedVersion: 1, opId: 'rebuild-2', at: at(11) }));
    expect(stale).toMatchObject({ status: 'stale' });
    await store.close();
  });

  it('Apply makes the plan’s days the rotation; Undo puts back the setup before it exactly; End and its Undo work', async () => {
    const store = await seeded();
    await store.repos.planDrafts.create(OWNER, draftFor(F.answers()));
    const applied = await store.repos.planDrafts.apply(OWNER, PLAN, (c, live, others) => applyPlan(c, { expectedVersion: 1, versionN: 1, mode: 'replace', opId: 'apply-1', at: at(100), live, applied: others }));
    expect(applied).toMatchObject({ status: 'written', plan: { status: 'applied', version: 2 } });
    expect(await rotation(store)).toEqual(['Upper A', 'Lower A', 'Upper B', 'Lower B']);
    const plan = await store.repos.planDrafts.applied(OWNER);
    expect(planRoutines(plan, await store.repos.routines.listByOwner(OWNER)).map((r) => r.name)).toEqual(['Upper A', 'Lower A', 'Upper B', 'Lower B']);
    // A retried Apply replays; a stale one changes nothing.
    expect(await store.repos.planDrafts.apply(OWNER, PLAN, (c, live) => applyPlan(c, { expectedVersion: 1, versionN: 1, mode: 'replace', opId: 'apply-1', at: at(100), live }))).toMatchObject({ status: 'replayed' });
    expect(await store.repos.planDrafts.apply(OWNER, PLAN, (c, live) => applyPlan(c, { expectedVersion: 1, versionN: 1, mode: 'replace', opId: 'apply-2', at: at(101), live }))).toMatchObject({ status: 'stale' });

    const undone = await store.repos.planDrafts.undo(OWNER, PLAN, (c, routines, plans) => undoPlanApply(c, { expectedVersion: 2, opId: 'undo-1', at: at(200), routines, plans }));
    expect(undone).toMatchObject({ status: 'written', plan: { status: 'open', applied: null } });
    expect(await rotation(store)).toEqual([]);
    expect(await store.repos.planDrafts.applied(OWNER)).toBeNull();
    // A stale Undo (the version moved) changes nothing.
    expect(await store.repos.planDrafts.undo(OWNER, PLAN, (c, routines) => undoPlanApply(c, { expectedVersion: 2, opId: 'undo-2', at: at(201), routines }))).toMatchObject({ status: 'stale' });

    // Apply again, then End and Undo End.
    await store.repos.planDrafts.apply(OWNER, PLAN, (c, live) => applyPlan(c, { expectedVersion: 3, versionN: 1, mode: 'replace', opId: 'apply-3', at: at(300), live }));
    const ended = await store.repos.planDrafts.endOrResume(OWNER, PLAN, (c, routines) => endPlan(c, { expectedVersion: 4, opId: 'end-1', at: at(400), routines }));
    expect(ended).toMatchObject({ status: 'written', plan: { status: 'ended' } });
    expect(await rotation(store)).toEqual([]);
    const back = await store.repos.planDrafts.endOrResume(OWNER, PLAN, (c, routines, other) => undoEndPlan(c, { expectedVersion: 5, opId: 'undo-end-1', at: at(500), routines, otherApplied: other }));
    expect(back).toMatchObject({ status: 'written', plan: { status: 'applied' } });
    expect(await rotation(store)).toEqual(['Upper A', 'Lower A', 'Upper B', 'Lower B']);
    expect((await checkIntegrity(store.db)).ok).toBe(true);
    await store.close();
  });

  it('the applied plan reads back with its answers', async () => {
    const store = await openStore(memoryDriver());
    await store.repos.profiles.save(profile(), null);
    await store.repos.planDrafts.create(OWNER, draftFor(F.answers({ effort: 'push', weeks: 8 })));
    await store.repos.planDrafts.apply(OWNER, PLAN, (c, live) => applyPlan(c, { expectedVersion: 1, versionN: 1, mode: 'replace', opId: 'apply-1', at: at(100), live }));
    const again = await store.repos.planDrafts.get(PLAN);
    expect(again?.status).toBe('applied');
    expect(again === null ? null : currentPlanVersion(again).builder?.answers.weeks).toBe(8);
    await store.close();
  });
});
