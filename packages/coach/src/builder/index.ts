export * from './load-guard';
export * from './edit-ops';
export * from './checked-text';
export * from './claims';
export * from './focus';
export * from './proposal';
export * from './setup';
export * from './review';
export * from './review-context';
export * from './mix';
export * from './nudge';
export * from './requests';

/**
 * Whether the builder's coach can answer (workout-builder-v3 §2.6, §5 "AI status"). Shown as one word
 * (rule 1): `● Coach`, `Offline`, `Coach not connected`. Never a canned reply in its place.
 */
export type BuilderCoachReach = 'ok' | 'offline' | 'not_connected';

export const BUILDER_STATUS_WORD: Readonly<Record<BuilderCoachReach, string>> = {
  ok: '● Coach',
  offline: 'Offline',
  not_connected: 'Coach not connected',
};
export * from './weekly';
