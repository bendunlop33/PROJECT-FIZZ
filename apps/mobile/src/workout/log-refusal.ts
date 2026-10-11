import type { ServiceError } from '@fizz/domain';

/**
 * What the screen does when a command is refused. Pure so the copy stays true:
 * a reused opId means the set is already saved under it (the screen was behind),
 * so it never says "not saved", and a retry with the same opId can't succeed.
 */
export function reloadsAfterRefusal(code: ServiceError['code']): boolean {
  return code === 'stale_version' || code === 'write_conflict' || code === 'operation_id_reused';
}

export interface LogRefusal {
  banner: { severity: 'info' | 'warning'; text: string };
  /** Drop the unsaved edit: the set is already stored and the reload shows its saved values. */
  clearEdits: boolean;
}

export function logRefusal(error: ServiceError): LogRefusal {
  if (error.code === 'operation_id_reused') return { banner: { severity: 'info', text: 'Already saved' }, clearEdits: true };
  if (error.code === 'write_failed') return { banner: { severity: 'warning', text: 'Set not saved. Try again.' }, clearEdits: false };
  return { banner: { severity: 'warning', text: error.message }, clearEdits: false };
}
