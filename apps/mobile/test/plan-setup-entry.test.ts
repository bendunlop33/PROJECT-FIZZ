import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { pbDefaultAnswers } from '@fizz/domain';

import { openNextBlock, openPlanEdit, openPlanSetup } from '../src/navigation/actions';
import { PB_COPY, pbFirstPage } from '../src/plan-builder/plan-builder-view';
import type { AppServices } from '../src/services/app-services';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * (Ben, 23 Oct, from his iPhone) `Set up a plan` jumped to the end of his last plan (its Your plan page). Every new
 * plan (Today's `Set up a plan ›`, Library › Plan's `Set up a plan`, `Start next block ›`) starts at the first step,
 * Check your lifts when needed, else Gym goals, with his last plan's answers as the starting selections; a built plan
 * left unapplied is offered quietly (`Continue last draft ›`), never the landing page. Only `Edit plan` opens on Your
 * plan. Real SQLite, offline.
 */

const DAY = 86_400_000;
let h: Harness;
beforeEach(() => {
  h = createHarness('2026-10-22T07:00:00.000Z');
});
afterEach(async () => {
  await h.cleanup();
});

async function ben(): Promise<{ s: AppServices; gymId: string }> {
  const { services: s } = await h.launch();
  const gymId = await setUpGym(h, s);
  await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 100, reps: 6, rpe: 8 }] }]);
  h.clockMs += DAY;
  return { s, gymId };
}

async function built(s: AppServices, sessions: number, split: 'ppl' | 'ul' | 'full') {
  const session = await s.planBuilder.open();
  if (session === null) throw new Error('no builder');
  const answers = { ...session.answers, split, sessions, days: sessions === 3 ? [0, 2, 4] : [0, 1, 3, 4] };
  const r = await s.planBuilder.save(session, answers, null, h.ids());
  if (!r.ok) throw new Error(r.reason);
  return { answers, plan: r };
}

describe('Set up a plan always starts a new plan at the first step', () => {
  it('the entry points navigate to the builder: Set up a plan with no params, Start next block with the block, Edit plan with the plan', () => {
    expect(openPlanSetup()).toEqual({ type: 'NAVIGATE', payload: { name: 'PlanSetup' } });
    expect(openNextBlock('p1')).toEqual({ type: 'NAVIGATE', payload: { name: 'PlanSetup', params: { fromPlanId: 'p1' } } });
    expect(openPlanEdit('p1')).toEqual({ type: 'NAVIGATE', payload: { name: 'PlanSetup', params: { editPlanId: 'p1' } } });
  });

  it('first plan: the ✦ answers, first step, nothing to continue', async () => {
    const { s } = await ben();
    const session = await s.planBuilder.open();
    if (session === null) throw new Error('no builder');
    expect(session.draft).toBeNull();
    expect(session.lastDraft).toBeNull();
    expect(session.opensOn).toBe('start');
    expect(session.answers).toEqual(pbDefaultAnswers({ sessions: null, minutes: null }));
    expect(pbFirstPage(session)).toBe(session.needsCheck ? 'check' : 'goals');
  });

  it('with an applied plan (Today, Library › Plan): a new plan prefilled from it, at the first step, never its Your plan', async () => {
    const { s } = await ben();
    const { answers, plan } = await built(s, 3, 'ppl');
    expect((await s.planBuilder.apply({ planId: plan.planId, versionN: plan.versionN, expectedVersion: plan.version, opId: h.ids() })).ok).toBe(true);
    // A force-close changes nothing.
    await h.forceClose();
    const { services: s2 } = await h.launch();
    const session = await s2.planBuilder.open();
    if (session === null) throw new Error('no builder');
    expect(session.draft).toBeNull();
    expect(session.lastDraft).toBeNull();
    expect(session.answers).toEqual(answers);
    expect(pbFirstPage(session)).not.toBe('plan');
    // Ben can change the starting selections; Build writes a new plan, the applied one is untouched (rule 2).
    const next = await s2.planBuilder.save(session, { ...session.answers, sessions: 4, split: 'ul', days: [0, 1, 3, 4] }, session.draft, h.ids());
    if (!next.ok) throw new Error(next.reason);
    expect(next.planId).not.toBe(plan.planId);
    expect((await s2.plans.inUse())?.planId).toBe(plan.planId);
  });

  it('a built plan left unapplied doesn’t hijack Set up: it is offered as Continue last draft, the page starts at step 1', async () => {
    const { s } = await ben();
    const { answers, plan } = await built(s, 4, 'ul');
    const session = await s.planBuilder.open();
    if (session === null) throw new Error('no builder');
    expect(session.draft).toBeNull();
    expect(pbFirstPage(session)).not.toBe('plan');
    expect(session.lastDraft).toEqual({ planId: plan.planId, version: plan.version, versionN: plan.versionN, answers });
    expect(PB_COPY.continueDraft).toBe('Continue last draft ›');
    // Continue: Build on it writes its next version (rule 5: the version it was built at).
    const v2 = await s.planBuilder.save(session, { ...answers, minutes: 45 }, session.lastDraft, h.ids());
    expect(v2).toMatchObject({ ok: true, planId: plan.planId, version: plan.version + 1 });
  });

  it('Start next block: the finished block’s answers, at the first step', async () => {
    const { s } = await ben();
    const { answers, plan } = await built(s, 3, 'ppl');
    expect((await s.planBuilder.apply({ planId: plan.planId, versionN: plan.versionN, expectedVersion: plan.version, opId: h.ids() })).ok).toBe(true);
    const session = await s.planBuilder.open({ fromPlanId: plan.planId });
    if (session === null) throw new Error('no builder');
    expect(session.answers).toEqual(answers);
    expect(session.draft).toBeNull();
    expect(pbFirstPage(session)).not.toBe('plan');
  });

  it('only Edit plan opens on Your plan, with that plan’s answers (an open built plan is edited in place)', async () => {
    const { s } = await ben();
    const { answers, plan } = await built(s, 4, 'ul');
    const session = await s.planBuilder.open({ editPlanId: plan.planId });
    if (session === null) throw new Error('no builder');
    expect(session.opensOn).toBe('plan');
    expect(pbFirstPage(session)).toBe('plan');
    expect(session.answers).toEqual(answers);
    expect(session.draft).toEqual({ planId: plan.planId, version: plan.version, versionN: plan.versionN });
    expect(session.lastDraft).toBeNull();
  });

  it('the screen opens on `pbFirstPage` and passes Edit plan through; `Continue last draft` sits on the first page only', () => {
    const src = readFileSync(join(__dirname, '../src/screens/plan/PlanSetupScreen.tsx'), 'utf8');
    expect(src).toContain(': pbFirstPage(s));');
    expect(src).not.toMatch(/setPage\(s\.draft !== null/);
    expect(src).toContain('editPlanId !== undefined ? { editPlanId }');
    expect(src).toMatch(/page === flow\[0\] \? <TextButton label=\{C\.continueDraft\}/);
  });
});
