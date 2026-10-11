import type { UserProfile, WeightUnit } from '@fizz/schemas';

/**
 * First-run state (onboarding.md §3.1), derived from stored data so a
 * force-close resumes at the first unfinished step. Pure.
 */
export type SetupStep = 'welcome' | 'units' | 'gym' | 'data' | 'done';

export function setupStep(profile: UserProfile | null, gymCount: number): SetupStep {
  if (profile === null) return 'welcome';
  // A profile without setup tracking came from a backup made before it
  // existed, i.e. after a finished setup: don't ask again.
  if (profile.setup === undefined) return 'done';
  if (profile.setup.completedAtUtc !== undefined) return 'done';
  // The gym is saved before the profile notes it, so a gym on file counts.
  if (profile.setup.gymStep !== undefined || gymCount > 0) return 'data';
  return 'gym';
}

/** Rest presets shown on Step 1 (onboarding.md §2.2: starting points, not advice). */
export const DEFAULT_REST_PRESETS = [
  { seconds: 60, presetName: 'Warm-up' },
  { seconds: 90, presetName: 'Standard' },
  { seconds: 180, presetName: 'Heavy' },
] as const;

/**
 * Unit preselected from the phone's region (onboarding.md §2.2): `us` → lb,
 * everything else (metric, en-GB's `uk`) → kg. A preference default, not
 * personal data, so the caption says where it came from.
 */
export function unitFromMeasurementSystem(system: string | null | undefined): WeightUnit {
  return system === 'us' ? 'lb' : 'kg';
}

/**
 * Step 1 after a gym is saved in first run (`Gym saved in kg`): the unit is
 * read-only, as the gym's equipment stays in the unit it was saved in.
 */
export function unitLockedText(unit: WeightUnit): string {
  return `Gym saved in ${unit}`;
}

export interface NewProfileInput {
  id: string;
  unit: WeightUnit;
  timezone: string;
  atUtc: string;
}

export function newProfile(input: NewProfileInput): UserProfile {
  return {
    id: input.id,
    ownerId: input.id,
    version: 1,
    createdAtUtc: input.atUtc,
    updatedAtUtc: input.atUtc,
    timezone: input.timezone,
    preferredUnit: input.unit,
    defaultRest: { seconds: 90, presetName: 'Standard' },
    restPresets: DEFAULT_REST_PRESETS.map((p) => ({ ...p })),
    effortScale: 'rpe',
    setup: {},
  };
}

/** The next version of a profile with `patch` applied. */
export function bumpProfile(profile: UserProfile, patch: Partial<Pick<UserProfile, 'preferredUnit' | 'setup'>>, atUtc: string): UserProfile {
  return { ...profile, ...patch, version: profile.version + 1, updatedAtUtc: atUtc };
}
