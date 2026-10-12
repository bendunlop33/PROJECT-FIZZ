import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { Store } from '@fizz/persistence';
import type { UserProfile } from '@fizz/schemas';

import { createProgressService, type ProgressServiceDeps } from '../src/services/progress-service';

/**
 * Fixes for review progress-A r2: Ask on the Muscles screen (S3), `Edit
 * times` opening the time correction and returning (N1), a failed settings
 * save dropping only its own fields (N2), and no blank Muscles page (N4).
 * S2 (unilateral pairing within a set type) is in packages/domain/test/progress.test.ts.
 */

const SRC = join(__dirname, '..', 'src');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');

describe('S3: Ask on the Muscles screen carries the Progress window', () => {
  it('Muscles floats the Ask pill with a progress entry for the shared window', () => {
    const src = read('screens/progress/MusclesScreen.tsx');
    expect(src).toContain('<AskPill');
    expect(src).toContain("{ kind: 'progress', days }");
    // On both the normal and the "Nothing to show yet" page.
    expect(src.match(/<Screen floating=\{ask\}>/g)).toHaveLength(2);
  });

  it('Screen draws `floating` over the scroll area and leaves room under the content for it', () => {
    const src = read('ui/layout.tsx');
    expect(src).toContain('(floating ? FLOATING_ROOM : 0)');
    expect(src.indexOf('{floating}')).toBeGreaterThan(src.indexOf('</ScrollView>'));
  });
});

describe('N1: Edit times opens the time correction and returns to Progress', () => {
  it('Progress asks the Summary to open straight into the time correction', () => {
    expect(read('screens/progress/ProgressScreen.tsx')).toContain("navigation.navigate('Summary', { sessionId: r.sessionId, back: true, editTimes: true })");
  });

  it('the Summary opens the sheet at once and goes back when it closes or saves', () => {
    const src = read('screens/workout/SummaryScreen.tsx');
    expect(src).toContain('const [times, setTimes] = useState(editTimes);');
    expect(src).toMatch(/onClose=\{\(\) => \{\s*setTimes\(false\);\s*if \(editTimes\) done\(\);/);
    expect(src).toMatch(/onSaved=\{\(\) => \{\s*setTimes\(false\);\s*changed\(\);\s*if \(editTimes\) done\(\);/);
  });
});

describe('N4: Muscles with no profile is never a blank page', () => {
  it('shows Nothing to show yet once loaded', () => {
    const src = read('screens/progress/MusclesScreen.tsx');
    expect(src).not.toContain('<Screen>{null}</Screen>');
    expect(src).toContain("data.state === 'loading' ? null : <AppText variant=\"headline\">Nothing to show yet</AppText>");
  });
});

describe('N2: a failed settings save drops only the fields it still owns', () => {
  function service(results: boolean[]) {
    const store = {
      repos: {
        sessions: { listFinishedRevisions: () => Promise.resolve([]), getActive: () => Promise.resolve(null), get: () => Promise.resolve(null) },
        exercises: { list: () => Promise.resolve([]) },
        gyms: { listByOwner: () => Promise.resolve([]) },
      },
    } as unknown as Store;
    let saved: UserProfile['progress'] = { window: 30, grouping: 'body_part' };
    const profile = { id: 'owner', timezone: 'Europe/London', progress: saved } as unknown as UserProfile;
    const gates: (() => void)[] = [];
    const deps: ProgressServiceDeps = {
      store: () => store,
      now: () => ({ utc: '2026-10-11T12:00:00.000Z', tz: 'Europe/London' }),
      profile: () => Promise.resolve({ ...profile, progress: saved }),
      saveSettings: async (merge) => {
        await new Promise<void>((r) => gates.push(r));
        const ok = results.shift() ?? true;
        if (!ok) return { ok: false };
        const next = merge(saved);
        if (next !== null) saved = next;
        return { ok: true };
      },
      catalogueExercises: () => [],
      dispatch: () => Promise.reject(new Error('unused')),
      slicer: () => () => Promise.resolve(),
    };
    const release = async () => {
      while (gates.length === 0) await Promise.resolve();
      gates.shift()?.();
    };
    return { progress: createProgressService(deps), release, saved: () => saved };
  }

  it('grouping fails, a later window tap succeeds: the screen shows the saved grouping and the new window', async () => {
    const { progress, release, saved } = service([false, true]);
    const a = progress.saveSettings({ grouping: 'ppl' });
    const b = progress.saveSettings({ days: 7 });
    expect((await progress.home())?.grouping).toBe('ppl');
    await release();
    expect(await a).toEqual({ ok: false });
    await release();
    expect(await b).toEqual({ ok: true });
    const home = await progress.home();
    expect([home?.days, home?.grouping]).toEqual([7, 'body_part']);
    expect(saved()).toEqual({ window: 7, grouping: 'body_part' });
  });

  it('a later tap on the same field keeps it when the earlier save fails', async () => {
    const { progress, release } = service([false, true]);
    const a = progress.saveSettings({ grouping: 'ppl' });
    const b = progress.saveSettings({ grouping: 'body_part', days: 14 });
    const c = progress.saveSettings({ grouping: 'ppl' });
    await release();
    expect(await a).toEqual({ ok: false });
    // c's choice still shows while its save is waiting.
    expect((await progress.home())?.grouping).toBe('ppl');
    await release();
    await b;
    await release();
    await c;
    const home = await progress.home();
    expect([home?.days, home?.grouping]).toEqual([14, 'ppl']);
  });
});
