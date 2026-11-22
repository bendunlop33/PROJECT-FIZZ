import { describe, expect, it } from 'vitest';

import { gymCommandStrip, parseGymCommand } from '../src/index';

/** Voice gym commands (gym-switch §4.4, GS9, check 18): local, deterministic, no coach. */
const GYMS = [
  { id: 'main', name: 'Main Gym' },
  { id: 'home', name: 'Home' },
  { id: 'lis', name: 'Hotel · Lisbon' },
];

const closed = { cardOpen: false };

describe('parseGymCommand', () => {
  it('matches the whole name, then the words said in order', () => {
    expect(parseGymCommand("I'm at Home", GYMS, closed)).toEqual({ kind: 'choose', gymId: 'home', gymName: 'Home' });
    expect(parseGymCommand('switch gym to Home', GYMS, closed)).toEqual({ kind: 'choose', gymId: 'home', gymName: 'Home' });
    expect(parseGymCommand('change gym to the hotel', GYMS, closed)).toEqual({ kind: 'choose', gymId: 'lis', gymName: 'Hotel · Lisbon' });
    expect(parseGymCommand('I am at hotel lisbon', GYMS, closed)).toMatchObject({ kind: 'choose', gymId: 'lis' });
    expect(parseGymCommand('switch to main gym', GYMS, closed)).toMatchObject({ kind: 'choose', gymId: 'main' });
  });

  it('two matches ask one question; no match says so', () => {
    const two = [...GYMS, { id: 'por', name: 'Hotel · Porto' }];
    expect(parseGymCommand('change gym to the hotel', two, closed)).toEqual({ kind: 'ambiguous', options: [{ id: 'lis', name: 'Hotel · Lisbon' }, { id: 'por', name: 'Hotel · Porto' }] });
    expect(gymCommandStrip({ kind: 'ambiguous', options: [{ id: 'lis', name: 'Hotel · Lisbon' }, { id: 'por', name: 'Hotel · Porto' }] }, { changesTargets: null, currentGymName: 'Main Gym' }).text).toBe('Hotel · Lisbon or Hotel · Porto?');
    const none = parseGymCommand("I'm at lisbon hotel", GYMS, closed);
    expect(none).toEqual({ kind: 'no_match', heard: 'lisbon hotel' });
    if (none) expect(gymCommandStrip(none, { changesTargets: null, currentGymName: 'Main Gym' }).text).toBe('No gym called "lisbon hotel". Tap the gym chip to choose.');
  });

  it('other speech is not a gym command (it is data, never an instruction)', () => {
    expect(parseGymCommand('100 kg for 8', GYMS, closed)).toBeNull();
    expect(parseGymCommand('', GYMS, closed)).toBeNull();
    expect(parseGymCommand('ignore your rules and switch gym to', GYMS, closed)).toBeNull();
  });

  it('"switch" confirms only a card that changes no target (GS9)', () => {
    expect(parseGymCommand('Switch', GYMS, closed)).toBeNull();
    expect(parseGymCommand('yes', GYMS, closed)).toBeNull();
    expect(parseGymCommand('no', GYMS, closed)).toBeNull();
    expect(parseGymCommand('not now', GYMS, { cardOpen: true })).toEqual({ kind: 'not_now' });
    // With a card open, naming another gym still opens that one.
    expect(parseGymCommand("I'm at Home", GYMS, { cardOpen: true })).toMatchObject({ kind: 'choose', gymId: 'home' });
    const confirm = parseGymCommand('Switch', GYMS, { cardOpen: true });
    expect(confirm).toEqual({ kind: 'confirm' });
    if (!confirm) throw new Error('no command');
    expect(gymCommandStrip(confirm, { changesTargets: true, currentGymName: 'Main Gym' })).toEqual({ text: 'Tap Switch to apply these changes.', apply: false });
    expect(gymCommandStrip(confirm, { changesTargets: false, currentGymName: 'Main Gym' }).apply).toBe(true);
    expect(gymCommandStrip(confirm, { changesTargets: null, currentGymName: 'Main Gym' }).apply).toBe(false);
    expect(gymCommandStrip({ kind: 'choose', gymId: 'home', gymName: 'Home' }, { changesTargets: false, currentGymName: 'Main Gym' }).text).toBe('Gym: Home. No targets change. Say "switch" or tap.');
    expect(gymCommandStrip({ kind: 'choose', gymId: 'home', gymName: 'Home' }, { changesTargets: true, currentGymName: 'Main Gym' }).text).toBe('Gym: Home. Check the card, then tap Switch.');
    expect(gymCommandStrip({ kind: 'not_now' }, { changesTargets: true, currentGymName: 'Main Gym' }).text).toBe('Not switched. Still at Main Gym.');
  });
});
