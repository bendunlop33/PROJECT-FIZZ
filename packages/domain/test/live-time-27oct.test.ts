import { describe, expect, it } from 'vitest';
import { liveTime } from '../src/index';

/**
 * (Ben, 27 Oct: "if I add an exercise without changing the time it changes the time automatically, and if I manually
 * change an exercise it should update too") The Time control shows the live estimate; `−`/`+` step from it and always
 * move the length; past the length the number is in the warning tone. Pure.
 */
describe('liveTime', () => {
  it('shows the estimate, not the length', () => {
    expect(liveTime({ estimate: 43, length: 45 })).toEqual({ minutes: 43, over: false, less: 40, more: 50 });
    expect(liveTime({ estimate: 47, length: 47 })).toEqual({ minutes: 47, over: false, less: 45, more: 50 });
  });

  it('an added exercise raises the number past the length: over, never cut', () => {
    const v = liveTime({ estimate: 52, length: 45 });
    expect(v.minutes).toBe(52);
    expect(v.over).toBe(true);
    // `+` goes to the next step above the estimate (and the length moves with it); `−` below the length, where the fit cuts.
    expect(v.more).toBe(55);
    expect(v.less).toBe(40);
  });

  it('a removed exercise lowers the number', () => {
    expect(liveTime({ estimate: 38, length: 45 })).toMatchObject({ minutes: 38, over: false, less: 35 });
  });

  it('every tap moves the length: an estimate just under it doesn’t step to where it already is', () => {
    // A fit to 45 that lands at 43: `+` goes to 50, not 45 again.
    expect(liveTime({ estimate: 43, length: 45 }).more).toBe(50);
    // At 45 exactly: 40 and 50.
    expect(liveTime({ estimate: 45, length: 45 })).toMatchObject({ less: 40, more: 50 });
  });

  it('`floor`: the length a `−` must go below to cut (Your workout: before the first Time change)', () => {
    // Time + took it to 55 with nothing to bring back; the fit cuts only below 45.
    expect(liveTime({ estimate: 52, length: 55, floor: 45 })).toMatchObject({ minutes: 52, over: false, less: 40, more: 60 });
    // The editor with no live fit works from the list as it is: `−` from the estimate, even past the length.
    expect(liveTime({ estimate: 52, length: 45, floor: 52 })).toMatchObject({ over: true, less: 50 });
  });

  it('limits: nothing below 15 or above 180', () => {
    expect(liveTime({ estimate: 15, length: 15 }).less).toBeNull();
    expect(liveTime({ estimate: 14, length: 15 }).less).toBeNull();
    expect(liveTime({ estimate: 180, length: 180 }).more).toBeNull();
    expect(liveTime({ estimate: 190, length: 180 })).toMatchObject({ minutes: 190, over: true, more: null, less: 175 });
  });

  it('an empty workout reads 0', () => {
    expect(liveTime({ estimate: 0, length: 45 })).toMatchObject({ minutes: 0, over: false, less: 40, more: 50 });
  });
});
