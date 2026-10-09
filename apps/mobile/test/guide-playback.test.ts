import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { bundledGuides, catalogueExerciseId, createGuideLibrary, createLazyCatalogue } from '@fizz/catalogue';
import { bakeFrame, GUIDE_MUSCLE_COLOR, GUIDE_TOKEN_NAMES, guideStyleFromTokens, type DrawOp, type GuideTokens } from '@fizz/catalogue/figure';

import { advanceClock, frameIndexAt, MAX_AUTOPLAY_PASSES, passMs } from '../src/guide/clock';
import { opPathData, planOp, rgba } from '../src/guide/draw-plan';
import { BUNDLED_GUIDE_FILES } from '../../../packages/catalogue/src/generated/guide-files';
import { buildHowToView, bundledHowToSources, DRAFT_GUIDE_LABEL, guideDraftLabel, hasHowTo, howToKeyForExerciseId, howToLayout, type HowToSources } from '../src/guide/how-to';
import { initialPlayerState, isRunning, playControlLabel, playerReducer, stepAccessibilityLabel, stepAnnouncement, stepPosition, type PlayerAction, type PlayerState } from '../src/guide/player-model';
import { runSliced } from '../src/guide/sliced';
import { resolveTheme, THEME_DIRECTIONS } from '../src/theme/tokens';

describe('playback clock (UI-thread worklets)', () => {
  it('loops a cycle at the guide tempo, picking the nearest baked frame', () => {
    // 2800 ms at 30 fps = 84 frames, one every 33.3 ms.
    expect(frameIndexAt(0, 2800, 84, 'cycle')).toBe(0);
    expect(frameIndexAt(1400, 2800, 84, 'cycle')).toBe(42);
    expect(frameIndexAt(2790, 2800, 84, 'cycle')).toBe(0); // nearer to t = 1 (= t = 0) than to frame 83
    expect(frameIndexAt(2800 + 1400, 2800, 84, 'cycle')).toBe(42);
    expect(frameIndexAt(17, 2800, 84, 'cycle')).toBe(1);
  });

  it('plays a ping-pong forwards then backwards over both ends', () => {
    expect(frameIndexAt(0, 2000, 61, 'pingpong')).toBe(0);
    expect(frameIndexAt(2000, 2000, 61, 'pingpong')).toBe(60);
    expect(frameIndexAt(3000, 2000, 61, 'pingpong')).toBe(30);
    expect(frameIndexAt(4000, 2000, 61, 'pingpong')).toBe(0);
    expect(passMs(2000, 'pingpong')).toBe(4000);
    expect(passMs(2000, 'cycle')).toBe(2000);
  });

  it('never returns an out-of-range frame for odd inputs', () => {
    expect(frameIndexAt(-5, 2800, 84, 'cycle')).toBe(0);
    expect(frameIndexAt(Number.NaN, 2800, 84, 'cycle')).toBe(0);
    expect(frameIndexAt(500, 2800, 1, 'cycle')).toBe(0);
    expect(frameIndexAt(500, 0, 84, 'cycle')).toBe(0);
    for (let e = 0; e < 6000; e += 7) {
      const i = frameIndexAt(e, 2800, 84, 'cycle');
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(84);
    }
  });

  it('stops autoplay after the allowed passes, back on the first frame', () => {
    expect(MAX_AUTOPLAY_PASSES).toBe(3);
    let elapsed = 0;
    let frames = 0;
    let finished = false;
    while (!finished && frames < 10_000) {
      ({ elapsedMs: elapsed, finished } = advanceClock(elapsed, 1000 / 60, 2800, 'cycle'));
      frames += 1;
    }
    expect(finished).toBe(true);
    expect(elapsed).toBe(0);
    expect(frames).toBe(Math.ceil((3 * 2800) / (1000 / 60)));
  });

  it('a resume (no previous frame) or a long stall never jumps the animation', () => {
    expect(advanceClock(1000, null, 2800, 'cycle')).toEqual({ elapsedMs: 1000, finished: false });
    expect(advanceClock(1000, 5000, 2800, 'cycle')).toEqual({ elapsedMs: 1100, finished: false });
    expect(advanceClock(1000, -3, 2800, 'cycle')).toEqual({ elapsedMs: 1000, finished: false });
  });
});

describe('player state', () => {
  const run = (s: PlayerState, ...actions: PlayerAction[]) => actions.reduce(playerReducer, s);
  const env = { visible: true, appActive: true, framesReady: true };

  it('animates by default; Reduce Motion starts on the key positions instead', () => {
    expect(initialPlayerState(false, 3)).toMatchObject({ mode: 'animate', step: 0 });
    expect(initialPlayerState(true, 3)).toMatchObject({ mode: 'steps', step: 0, stepCount: 3 });
  });

  it('Reduce Motion never autoplays, even with no labelled key positions: a still first frame until Play animation (P6)', () => {
    const s = initialPlayerState(true, 0);
    expect(s).toMatchObject({ mode: 'steps', step: 0, stepCount: 0 });
    expect(isRunning(s, env)).toBe(false);
    expect(run(s, { type: 'step', delta: 1 })).toBe(s);
    const playing = run(s, { type: 'show_animation' });
    expect(isRunning(playing, env)).toBe(true);
    // Reduce Motion turned on mid-play stops it the same way.
    expect(run(initialPlayerState(false, 0), { type: 'reduce_motion', on: true })).toMatchObject({ mode: 'steps', step: 0 });
  });

  it('says "key position" to VoiceOver and announces each step a button makes (P2, review N6)', () => {
    const stops = [
      { label: 'Start', caption: 'Stand tall, brace' },
      { label: 'Halfway', caption: null },
      { label: 'Bottom', caption: 'Hips just below knees' },
    ];
    const s = initialPlayerState(true, 3);
    expect(stepAccessibilityLabel(s, stops[0] ?? { label: '' })).toBe('Key position 1 of 3, Start. Stand tall, brace');
    const next = run(s, { type: 'step', delta: 1 });
    expect(stepAnnouncement(s, next, stops)).toBe('Key position 2 of 3, Halfway.');
    // Previous on the first, Next on the last: nothing changed, nothing announced.
    expect(stepAnnouncement(s, run(s, { type: 'step', delta: -1 }), stops)).toBeNull();
    // Key positions from the animation lands on position 1 and says so.
    const anim = initialPlayerState(false, 3);
    expect(stepAnnouncement(anim, run(anim, { type: 'show_steps' }), stops)).toBe('Key position 1 of 3, Start. Stand tall, brace');
    // Back to the animation: nothing to announce (the canvas label covers it).
    expect(stepAnnouncement(next, run(next, { type: 'show_animation' }), stops)).toBeNull();
    // A still frame with no labelled positions has nothing to announce.
    expect(stepAnnouncement(anim, run(anim, { type: 'reduce_motion', on: true }), [])).toBeNull();
  });

  it('pauses and resumes; after the autoplay passes the control is Replay and restarts the clock', () => {
    const s0 = initialPlayerState(false, 3);
    expect(playControlLabel(s0)).toBe('Pause');
    const paused = run(s0, { type: 'toggle_play' });
    expect(paused.paused).toBe(true);
    expect(playControlLabel(paused)).toBe('Play');
    expect(isRunning(paused, env)).toBe(false);
    const finished = run(s0, { type: 'finished' });
    expect(playControlLabel(finished)).toBe('Replay');
    expect(isRunning(finished, env)).toBe(false);
    const replay = run(finished, { type: 'toggle_play' });
    expect(replay).toMatchObject({ finished: false, paused: false, run: s0.run + 1 });
    expect(isRunning(replay, env)).toBe(true);
  });

  it('only runs on screen, in the foreground, with every frame baked', () => {
    const s = initialPlayerState(false, 3);
    expect(isRunning(s, env)).toBe(true);
    expect(isRunning(s, { ...env, visible: false })).toBe(false);
    expect(isRunning(s, { ...env, appActive: false })).toBe(false);
    expect(isRunning(s, { ...env, framesReady: false })).toBe(false);
    // A pause survives going off-screen and back.
    const paused = run(s, { type: 'toggle_play' });
    expect(isRunning(paused, { ...env, visible: true })).toBe(false);
  });

  it('steps between key frames without wrapping, and never runs the clock', () => {
    const s = initialPlayerState(true, 3);
    expect(isRunning(s, env)).toBe(false);
    expect(run(s, { type: 'step', delta: -1 })).toBe(s);
    const end = run(s, { type: 'step', delta: 1 }, { type: 'step', delta: 1 }, { type: 'step', delta: 1 });
    expect(end.step).toBe(2);
    expect(stepPosition(end, 'Bottom')).toBe('3 of 3 · Bottom');
    // Play/pause does nothing in the steps view.
    expect(run(end, { type: 'toggle_play' })).toBe(end);
  });

  it('switches views both ways; Play animation restarts from the first frame', () => {
    const s = initialPlayerState(false, 3);
    const steps = run(s, { type: 'show_steps' });
    expect(steps).toMatchObject({ mode: 'steps', step: 0 });
    const back = run(steps, { type: 'step', delta: 1 }, { type: 'show_animation' });
    expect(back).toMatchObject({ mode: 'animate', paused: false, finished: false, run: s.run + 1 });
    expect(run(initialPlayerState(false, 0), { type: 'show_steps' }).mode).toBe('animate');
  });

  it('turning Reduce Motion on stops the animation at once; turning it off starts nothing', () => {
    const s = initialPlayerState(false, 3);
    expect(run(s, { type: 'reduce_motion', on: true }).mode).toBe('steps');
    const steps = initialPlayerState(true, 3);
    expect(run(steps, { type: 'reduce_motion', on: false })).toBe(steps);
    expect(run(s, { type: 'reduce_motion', on: false })).toBe(s);
  });
});

describe('how-to view (catalogue → screen)', () => {
  const src = bundledHowToSources();

  it('labels every guide that Ben has not approved as a draft', () => {
    expect(guideDraftLabel('draft')).toBe(DRAFT_GUIDE_LABEL);
    expect(guideDraftLabel('checked')).toBe('Draft guide');
    expect(guideDraftLabel('approved')).toBeNull();
  });

  it('a guide stays a draft until its catalogue entry is approved too (P5)', () => {
    expect(guideDraftLabel('approved', 'draft')).toBe('Draft guide');
    expect(guideDraftLabel('approved', 'checked')).toBe('Draft guide');
    expect(guideDraftLabel('draft', 'approved')).toBe('Draft guide');
    expect(guideDraftLabel('approved', 'approved')).toBeNull();
    // No entry read: only the guide's own status counts.
    expect(guideDraftLabel('approved', null)).toBeNull();
  });

  it('unapproved cues without a guide are labelled Draft; approved ones are not (P5)', () => {
    const raw = JSON.parse(readFileSync(join(import.meta.dirname, '../../../packages/catalogue/data/exercises/barbell-back-squat.json'), 'utf8')) as Record<string, unknown>;
    const only = (entry: unknown): HowToSources => ({ catalogue: createLazyCatalogue([entry]), guides: createGuideLibrary([]) });
    const draft = buildHowToView({ name: 'Back squat', catalogueKey: 'barbell-back-squat' }, only(raw));
    expect(draft.textDraftLabel).toBe('Draft');
    expect(howToLayout(draft, false).textDraftLabel).toBe('Draft');
    const approved = buildHowToView({ name: 'Back squat', catalogueKey: 'barbell-back-squat' }, only({ ...raw, review: { status: 'approved', benApprovedOn: '2026-10-09' } }));
    expect(approved.notice).toBeNull();
    expect(approved.textDraftLabel).toBeNull();
    // With the player showing, its own `Draft guide` tag is the label; the text gets one only if the player fails.
    const squat = buildHowToView({ name: 'Back squat', catalogueKey: 'barbell-back-squat' }, src);
    expect(howToLayout(squat, false).textDraftLabel).toBeNull();
    expect(howToLayout(squat, true).textDraftLabel).toBe('Draft');
  });

  it('all 10 bundled guides are still drafts', () => {
    expect(bundledGuides().keys.size).toBe(10);
    for (const key of bundledGuides().keys) expect(buildHowToView({ name: key, catalogueKey: key }, src).guide?.draftLabel, key).toBe('Draft guide');
  });

  it('builds the squat: guide, one VoiceOver description, key positions, cues and mistakes', () => {
    const v = buildHowToView({ name: 'Squat (old name)', catalogueKey: 'barbell-back-squat' }, src);
    expect(v.title).toBe('Back squat');
    expect(v.muscles).toBe('Main muscles: Quads · Glutes');
    // One label for the animation and the still view (P4).
    expect(v.guide?.accessibilityLabel).toMatch(/^Exercise guide for Back squat\. Side view, facing right\. Bar on the upper back\./);
    expect(v.guide?.stops.map((s) => s.label)).toEqual(['Start', 'Halfway', 'Bottom']);
    expect(v.setup).toHaveLength(4);
    expect(v.execution[0]).toBe('Breathe in, brace, then sit down');
    expect(v.mistakes).toContain("Don't let your knees cave inward");
    expect(v.notice).toBeNull();
  });

  it('shows the entry\'s safety notes and when to stop the set (P1)', () => {
    const v = buildHowToView({ name: 'Back squat', catalogueKey: 'barbell-back-squat' }, src);
    expect(v.safety.notes[0]).toMatch(/safety arms/);
    expect(v.safety.stopIf).toEqual(['Sharp, pinching or sudden pain', 'Pain that changes how you move', 'Dizziness, numbness or tingling']);
    // Every rich entry has both, and none is a diagnosis-length paragraph (catalogue copy rules).
    for (const key of src.catalogue.keys) {
      if (src.catalogue.tierHint(key) !== 'rich') continue;
      const s = buildHowToView({ name: key, catalogueKey: key }, src).safety;
      expect(s.notes.length, key).toBeGreaterThan(0);
      expect(s.stopIf.length, key).toBeGreaterThan(0);
    }
    const none = buildHowToView({ name: 'Landmine twist', catalogueKey: null }, src);
    expect(none.safety).toEqual({ notes: [], stopIf: [] });
  });

  it('a basic entry or an unknown exercise says there is no how-to yet (never a blank screen)', () => {
    const basic = [...src.catalogue.keys].find((k) => src.catalogue.tierHint(k) === 'basic') ?? '';
    const v = buildHowToView({ name: 'x', catalogueKey: basic }, src);
    expect(v.guide).toBeNull();
    expect(v.setup).toEqual([]);
    expect(v.notice).toMatch(/^No how-to for .+ yet\.$/);
    expect(buildHowToView({ name: 'Landmine twist', catalogueKey: null }, src).notice).toBe('No how-to for Landmine twist yet.');
    expect(hasHowTo(basic, src)).toBe(false);
    expect(hasHowTo(null, src)).toBe(false);
    expect(hasHowTo('barbell-back-squat', src)).toBe(true);
  });

  it('a rich entry without a guide shows its text cues only; a broken guide says so and keeps the cues', () => {
    const rich: unknown = JSON.parse(readFileSync(join(import.meta.dirname, '../../../packages/catalogue/data/exercises/barbell-back-squat.json'), 'utf8'));
    const noGuide: HowToSources = { catalogue: createLazyCatalogue([rich]), guides: createGuideLibrary([]) };
    const cuesOnly = buildHowToView({ name: 'Back squat', catalogueKey: 'barbell-back-squat' }, noGuide);
    expect(cuesOnly.guide).toBeNull();
    expect(cuesOnly.setup.length).toBeGreaterThan(0);
    expect(cuesOnly.notice).toBeNull();
    expect(hasHowTo('barbell-back-squat', noGuide)).toBe(true);

    const broken: HowToSources = { catalogue: createLazyCatalogue([rich]), guides: createGuideLibrary([{ key: 'barbell-back-squat', raw: { nope: true }, camera: null }]) };
    const b = buildHowToView({ name: 'Back squat', catalogueKey: 'barbell-back-squat' }, broken);
    expect(b.guide).toBeNull();
    expect(b.mistakes.length).toBeGreaterThan(0);
    expect(b.notice).toBe('The animated guide for Back squat couldn’t be read. The cues below still apply.');
  });

  it('an entry that fails validation is reported, not shown', () => {
    const bad: HowToSources = { catalogue: createLazyCatalogue([{ key: 'odd-lift', tier: 'rich', name: 'Odd lift' }]), guides: createGuideLibrary([]) };
    expect(buildHowToView({ name: 'Odd lift', catalogueKey: 'odd-lift' }, bad)).toMatchObject({ guide: null, setup: [], entryUnreadable: true, notice: 'Couldn’t read the how-to for Odd lift.' });
  });

  it('an unreadable entry with a working guide says the guide still applies, and stops saying so if the player fails (P7)', () => {
    const squatGuide = BUNDLED_GUIDE_FILES.filter((f) => f.key === 'barbell-back-squat');
    const src2: HowToSources = { catalogue: createLazyCatalogue([{ key: 'barbell-back-squat', tier: 'rich', name: 'Back squat' }]), guides: createGuideLibrary(squatGuide) };
    const v = buildHowToView({ name: 'Back squat', catalogueKey: 'barbell-back-squat' }, src2);
    expect(v.guide).not.toBeNull();
    expect(v.setup).toEqual([]);
    expect(v.notice).toBe('Couldn’t read the cues for Back squat. The guide above still applies.');
    expect(howToLayout(v, false)).toMatchObject({ showPlayer: true, notices: ['Couldn’t read the cues for Back squat. The guide above still applies.'] });
    expect(howToLayout(v, true)).toMatchObject({
      showPlayer: false,
      notices: ['The animated guide couldn’t be shown and the cues for Back squat couldn’t be read. The key positions below still apply.'],
    });
  });

  it('finds the catalogue key behind an exercise ID (the workout menu), only for exercises with a how-to', () => {
    expect(howToKeyForExerciseId(catalogueExerciseId('barbell-back-squat'), src)).toBe('barbell-back-squat');
    expect(howToKeyForExerciseId(catalogueExerciseId('sled-push'), src)).toBe('sled-push');
    const basic = [...src.catalogue.keys].find((k) => src.catalogue.tierHint(k) === 'basic') ?? '';
    expect(howToKeyForExerciseId(catalogueExerciseId(basic), src)).toBeNull();
    expect(howToKeyForExerciseId('00000000-0000-4000-8000-000000000000', src)).toBeNull();
  });
});

describe('Skia draw plan', () => {
  const style = guideStyleFromTokens({ 'bg.canvas': '#000007', 'bg.surface': '#000001', 'bg.raised': '#000002', 'border.control': '#000003', 'text.primary': '#000004', 'text.secondary': '#000005', 'text.tertiary': '#000006' });

  it('mirrors SVG: one alpha for a semi-transparent fill-and-stroke (a layer), per-paint alpha otherwise', () => {
    const plate: DrawOp = { kind: 'circle', c: { x: 0.5, y: 0.5 }, r: 0.1, fill: 'frameFill', stroke: 'implement', width: 0.006, opacity: 0.55 };
    expect(planOp(plate, style)).toEqual({
      layerAlpha: 0.55,
      steps: [
        { draw: 'fill', color: '#000002', alpha: 1 },
        { draw: 'stroke', color: '#000004', alpha: 1, stroke: { width: 0.006, join: 'miter', cap: 'butt', dash: null } },
      ],
    });
    const ring: DrawOp = { kind: 'circle', c: { x: 0.5, y: 0.5 }, r: 0.06, fill: null, stroke: 'implement', width: 0.004, opacity: 0.35 };
    expect(planOp(ring, style)).toMatchObject({ layerAlpha: null, steps: [{ draw: 'stroke', alpha: 0.35 }] });
  });

  it('keeps the floor butt-capped and dashed, limbs round-joined', () => {
    const floor: DrawOp = { kind: 'line', a: { x: 0, y: 0.9 }, b: { x: 1, y: 0.9 }, width: 0.004, paint: 'trace', cap: 'butt', dash: [0.03, 0.02], opacity: 1 };
    expect(planOp(floor, style).steps).toEqual([{ draw: 'stroke', color: '#000006', alpha: 1, stroke: { width: 0.004, join: 'miter', cap: 'butt', dash: [0.03, 0.02] } }]);
    const halo: DrawOp = { kind: 'path', contours: [], closed: true, smooth: true, fill: 'background', gradient: null, stroke: 'background', width: 0.01, join: 'round', cap: null, dash: null, opacity: 1 };
    expect(planOp(halo, style)).toMatchObject({ layerAlpha: null, steps: [{ draw: 'fill', color: '#000001' }, { draw: 'stroke', stroke: { join: 'round', cap: 'butt' } }] });
  });

  it('writes compact SVG path data for Skia: polylines, smooth cubics and several contours', () => {
    const path = (contours: { x: number; y: number }[][], closed: boolean, smooth: boolean): Extract<DrawOp, { kind: 'path' }> => ({ kind: 'path', contours, closed, smooth, fill: 'nearBody', gradient: null, stroke: null, width: 0, join: null, cap: null, dash: null, opacity: 1 });
    expect(opPathData(path([[{ x: 0.123456789, y: 1 }, { x: 0.5, y: 0.25 }]], true, false))).toBe('M0.12346 1L0.5 0.25Z');
    expect(opPathData(path([[{ x: 0, y: 0 }, { x: 1, y: 1 }]], false, false))).toBe('M0 0L1 1');
    const square = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
    expect(opPathData(path([square], true, true))).toMatch(/^M0 0C.*Z$/);
    expect(opPathData(path([square, square], true, false)).match(/M/g)).toHaveLength(2);
  });

  it('turns a shading gradient into one fill with per-stop rgba colours', () => {
    const band: DrawOp = { kind: 'path', contours: [], closed: true, smooth: false, fill: null, gradient: { from: { x: 0, y: 0 }, to: { x: 1, y: 0 }, stops: [{ at: 0, paint: 'shade', opacity: 0.26 }, { at: 1, paint: 'shade', opacity: 0 }] }, stroke: null, width: 0, join: null, cap: null, dash: null, opacity: 1 };
    const live = { ...style, shade: '#0D0C0B' };
    expect(planOp(band, live).steps).toEqual([{ draw: 'fill', color: '#0D0C0B', alpha: 1, gradient: { from: { x: 0, y: 0 }, to: { x: 1, y: 0 }, colors: ['rgba(13, 12, 11, 0.26)', 'rgba(13, 12, 11, 0)'], positions: [0, 1] } }]);
    expect(rgba('#7A4AF0', 0.45)).toBe('rgba(122, 74, 240, 0.45)');
  });

  it('every guide frame uses only the neutral guide tokens plus the muscle hue, never the accent or a status colour, in every look and scheme', () => {
    for (const direction of Object.values(THEME_DIRECTIONS)) {
      for (const scheme of ['dark', 'light'] as const) {
        const theme = resolveTheme(direction, scheme);
        const tokens = {} as GuideTokens;
        for (const name of GUIDE_TOKEN_NAMES) tokens[name] = theme.colors[name];
        const live = guideStyleFromTokens(tokens, scheme);
        expect(live.muscle).toBe(GUIDE_MUSCLE_COLOR[scheme]);
        const allowed = new Set([...Object.values(tokens), GUIDE_MUSCLE_COLOR[scheme]]);
        // The accent and the status colours are their own values in every look, so "only these" means "never those" (§12.1 #4).
        const forbidden = [theme.colors.accent, theme.colors['status.done'], theme.colors['status.warning'], theme.colors['status.danger']];
        for (const c of forbidden) expect(allowed.has(c), `${direction.id} ${scheme} ${c}`).toBe(false);
        for (const key of bundledGuides().keys) {
          const g = bundledGuides().load(key);
          if (!g.ok) throw new Error(`${key} should load`);
          for (const t of [0, 0.37, 0.71]) {
            for (const op of bakeFrame(g.value.prepared, g.value.camera, t, undefined, { muscles: { primary: ['quads', 'chest', 'lats', 'triceps'], secondary: ['core', 'grip'] }, pulse: 0.5 })) {
              for (const step of planOp(op, live).steps) {
                expect(allowed.has(step.color), `${direction.id} ${scheme} ${key}`).toBe(true);
                if (step.draw === 'fill' && step.gradient) for (const c of step.gradient.colors) expect(c.startsWith('rgba(')).toBe(true);
              }
            }
          }
        }
      }
    }
  });
});

describe('sliced baking', () => {
  const unexpected = (e: unknown) => {
    throw new Error(`unexpected bake error: ${String(e)}`);
  };
  function harness() {
    let now = 0;
    const queue: (() => void)[] = [];
    return {
      now: () => now,
      advance: (ms: number) => {
        now += ms;
      },
      schedule: (fn: () => void) => {
        queue.push(fn);
        return () => {
          const i = queue.indexOf(fn);
          if (i >= 0) queue.splice(i, 1);
        };
      },
      flush: () => {
        const fn = queue.shift();
        fn?.();
        return fn !== undefined;
      },
      pending: () => queue.length,
    };
  }

  it('draws the poster at once, then yields every budget until done', () => {
    const h = harness();
    const ran: number[] = [];
    let done = 0;
    const tasks = Array.from({ length: 10 }, (_, i) => () => {
      ran.push(i);
      h.advance(3);
    });
    runSliced(tasks, { budgetMs: 8, firstSync: 1, now: h.now, schedule: h.schedule, onDone: () => (done += 1), onError: unexpected });
    expect(ran).toEqual([0]);
    expect(h.pending()).toBe(1);
    h.flush();
    // 3 ms per task, 8 ms budget: three tasks per slice.
    expect(ran).toEqual([0, 1, 2, 3]);
    while (h.flush());
    expect(ran).toHaveLength(10);
    expect(done).toBe(1);
  });

  it('cancel stops further work and never reports done', () => {
    const h = harness();
    let ran = 0;
    let done = false;
    const r = runSliced(
      Array.from({ length: 5 }, () => () => {
        ran += 1;
        h.advance(10);
      }),
      { budgetMs: 8, firstSync: 0, now: h.now, schedule: h.schedule, onDone: () => (done = true), onError: unexpected },
    );
    h.flush();
    expect(ran).toBe(1);
    r.cancel();
    expect(h.pending()).toBe(0);
    expect(done).toBe(false);
  });

  it('a task that throws in a later slice stops the run: reported once, never done, nothing left scheduled (review S1)', () => {
    const h = harness();
    const ran: number[] = [];
    const errors: unknown[] = [];
    let done = false;
    const boom = new Error('Skia path failed');
    const tasks = Array.from({ length: 8 }, (_, i) => () => {
      if (i === 4) throw boom;
      ran.push(i);
      h.advance(3);
    });
    runSliced(tasks, { budgetMs: 8, firstSync: 1, now: h.now, schedule: h.schedule, onDone: () => (done = true), onError: (e) => errors.push(e) });
    // The slice that hits the throw must not let it escape (a timer throw is fatal in a release build).
    expect(() => {
      while (h.flush());
    }).not.toThrow();
    expect(ran).toEqual([0, 1, 2, 3]);
    expect(errors).toEqual([boom]);
    expect(done).toBe(false);
    expect(h.pending()).toBe(0);
  });

  it('a throw while drawing the poster (synchronously) is reported, not thrown, and schedules nothing', () => {
    const h = harness();
    const errors: unknown[] = [];
    let done = false;
    const r = runSliced(
      [
        () => {
          throw new TypeError('Skia is undefined');
        },
        () => undefined,
      ],
      { budgetMs: 8, firstSync: 1, now: h.now, schedule: h.schedule, onDone: () => (done = true), onError: (e) => errors.push(e) },
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(TypeError);
    expect(done).toBe(false);
    expect(h.pending()).toBe(0);
    expect(() => {
      r.cancel();
    }).not.toThrow();
  });

  it('an empty or fully synchronous job finishes immediately', () => {
    const h = harness();
    let done = 0;
    runSliced([], { budgetMs: 8, firstSync: 1, now: h.now, schedule: h.schedule, onDone: () => (done += 1), onError: unexpected });
    runSliced([() => undefined], { budgetMs: 8, firstSync: 1, now: h.now, schedule: h.schedule, onDone: () => (done += 1), onError: unexpected });
    expect(done).toBe(2);
    expect(h.pending()).toBe(0);
  });
});
