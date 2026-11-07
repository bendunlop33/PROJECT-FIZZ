/**
 * In-memory results for the ChatGPT sign-in test screen, so a run that
 * finishes after ‹ Back is still shown when Ben returns. Not persisted: the
 * Export button is the record (results hold no secrets; see providers'
 * formatSignInReport).
 */

import { pendingSteps, type ListenerLogEntry, type ModelOption, type StepResult } from '@fizz/providers';

export interface SignInTestState {
  steps: StepResult[];
  listenerLog: ListenerLogEntry[];
  models: ModelOption[];
  model: ModelOption | null;
  /** What is running now, for the busy label; null when idle. */
  running: 'sign_in' | 'models' | 'responses' | 'refresh' | 'disconnect' | null;
  /** Live text of the test reply while it streams. */
  streamingText: string;
  /** Result line of the last Disconnect. */
  note: string | null;
}

let state: SignInTestState = {
  steps: pendingSteps(),
  listenerLog: [],
  models: [],
  model: null,
  running: null,
  streamingText: '',
  note: null,
};
const listeners = new Set<() => void>();

export function getSnapshot(): SignInTestState {
  return state;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function update(change: (s: SignInTestState) => SignInTestState): void {
  state = change(state);
  for (const l of listeners) l();
}

export function setStep(step: StepResult): void {
  update((s) => ({ ...s, steps: s.steps.map((x) => (x.id === step.id ? step : x)) }));
}
