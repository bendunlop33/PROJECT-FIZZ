import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Source checks for the Lock Screen widget's rest-end branch (Ben, 27 Oct
 * 2026). The widget can't run on Linux (it is serialised and evaluated in the
 * iOS extension), so these pin the parts the switch depends on.
 */

const widget = readFileSync(join(import.meta.dirname, '../src/live-activity/RestCountdownActivity.tsx'), 'utf8');
const body = widget.slice(widget.indexOf("'widget';"), widget.indexOf('let factory'));

describe('RestCountdownActivity: Ready at the rest’s end without the app', () => {
  it('switches a stale Resting activity to the after-rest content written with it', () => {
    expect(body).toContain("const restOver = environment.isStale === true && props.state === 'resting' && props.afterTitle !== '';");
    for (const f of ['afterTitle', 'afterLine1', 'afterLine2', 'afterLine3', 'afterSide', 'afterA11y']) expect(body).toContain(`props.${f}`);
    // Ended: no countdown and no buttons (tap '' and endMs 0).
    expect(body).toMatch(/restOver\s*\?\s*\{ state: 'ready',[^}]*tap: '', startMs: 0, endMs: 0 \}/);
  });

  it('draws everything from the switched fields, never the raw props', () => {
    const afterSwitch = body.slice(body.indexOf('const counting'));
    expect(afterSwitch).not.toContain('props.');
  });

  it('uses no object spread inside the serialised function (a Babel helper would not exist in the extension)', () => {
    expect(body).not.toMatch(/\{\s*\.\.\./);
    expect(body).not.toContain(' as const');
  });

  it('expo-widgets still hands `isStale` to the layout (an upgrade must keep it)', () => {
    const utils = readFileSync(join(import.meta.dirname, '../../../node_modules/expo-widgets/ios/Widgets/Utils.swift'), 'utf8');
    expect(utils).toContain('env["isStale"] = context.isStale');
  });

  it('the stale date reaches ActivityKit on start and update', () => {
    const port = readFileSync(join(import.meta.dirname, '../src/live-activity/expo-port.ts'), 'utf8');
    expect(port).toContain('restCountdownActivity().start(props, undefined, dateOf(staleAtMs))');
    expect(port).toContain('a.update(props, dateOf(staleAtMs))');
  });
});
