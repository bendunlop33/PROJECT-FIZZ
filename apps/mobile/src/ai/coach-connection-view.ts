/**
 * View models for Profile → Coach → Coach connection (ai-connection.md
 * §2.1–2.6, §3.1, §5), the Profile row, and the Summary's coach lines. Pure:
 * the screen renders these and calls services; it never decides wording.
 *
 * v1 differences from the spec (ADR 0020 §8, §10; Needs Ben):
 * - ChatGPT plan only. No API-key links (`Use an OpenAI API key…`,
 *   `Switch coach to your API key (paid)`) and no Coach voice section.
 * - No `This week: N coach messages` line: no coach messages are stored yet,
 *   so there is nothing true to count.
 * - Copy says GymSmarter where the spec says Fizz (renamed 9 Oct).
 * - Until the coach chat ships (`COACH_CHAT_IN_BUILD`), the connected card
 *   says it isn't in this build and the first-use notice is held back.
 */

import type { CoachStatus } from '@fizz/domain';
import { TESTED_MODEL_SLUG, describeFailure, type ConnectOutcome, type ConnectPhase, type ModelOption, type TextCoachState } from '@fizz/providers';

/** From OpenAI's Sign in with ChatGPT UI guidelines (checked 10 Oct 2026): the `Manage usage` destination. */
export const MANAGE_USAGE_URL = 'https://chatgpt.com/settings/usage';

export type ViewIcon = 'checkmark.circle.fill' | 'xmark.circle' | 'exclamationmark.triangle' | 'slash.circle' | 'info.circle' | 'circle' | 'ellipsis';
export type ViewTone = 'done' | 'warning' | 'info' | 'progress' | 'danger';

export type ConnectionAction = 'open_explainer' | 'start_sign_in' | 'manage_usage' | 'choose_model' | 'check_again' | 'disconnect';

export interface ActionView {
  label: string;
  action: ConnectionAction;
}

export interface ConnectionStatusView {
  card: { icon: ViewIcon; tone: ViewTone; title: string; lines: string[] };
  /** `Model: GPT-6.1-Sol ›` row inside the card (connected states only). */
  modelRow: string | null;
  /** (Coach v3, Ben 18 Oct) `Mid-workout: Same as coach ›` row under it (connected states only). */
  workoutModelRow?: string | null;
  /** The plan pitch under the card when nothing is connected. */
  pitch: string | null;
  primary: ActionView | null;
  links: ActionView[];
  showDisconnect: boolean;
}

/**
 * This build has the connection but no coach chat (ADR 0020: C3/C4 not built).
 * While false, the connected card says so and the once-ever first-use notice
 * isn't shown or used up, so Ben sees it when the coach can actually reply
 * (review S2). Set to true in the build that ships the coach sheet.
 */
export const COACH_CHAT_IN_BUILD = true;
const NO_COACH_YET = 'The coach chat isn’t in this build yet.';

/** Whether a finished sign-in should show the first-use notice (§2.5). Never in a build without the coach chat. */
export function showFirstUseNotice(outcome: Extract<ConnectOutcome, { kind: 'connected' }>, coachChatInBuild: boolean = COACH_CHAT_IN_BUILD): boolean {
  return coachChatInBuild && outcome.firstUse && outcome.models.length > 0;
}

/**
 * The status screen (§2.1 / §2.6 and the §3.1 rows). `signInUnavailable` is
 * the reason when this build has no loopback module.
 */
export function connectionStatusView(state: TextCoachState, signInUnavailable: string | null, coachChatInBuild: boolean = COACH_CHAT_IN_BUILD): ConnectionStatusView {
  const modelName = state.model?.displayName ?? null;
  const signedIn = state.email === null ? [] : [`Signed in as ${state.email}`];
  const base = { modelRow: null, pitch: null, links: [], showDisconnect: true };
  const manage: ActionView = { label: 'Manage usage', action: 'manage_usage' };
  switch (state.status) {
    case 'not_connected':
      if (signInUnavailable !== null) {
        return {
          ...base,
          card: { icon: 'slash.circle', tone: 'info', title: 'ChatGPT sign-in isn’t in this build', lines: [signInUnavailable] },
          primary: null,
          showDisconnect: false,
        };
      }
      return {
        ...base,
        card: { icon: 'xmark.circle', tone: 'info', title: 'Not connected', lines: [] },
        pitch: 'Your ChatGPT Plus or Pro plan can run the coach’s text replies. Voice isn’t included.',
        primary: { label: 'Continue with ChatGPT', action: 'open_explainer' },
        showDisconnect: false,
      };
    case 'ok':
    case 'offline':
      return {
        ...base,
        card: { icon: 'checkmark.circle.fill', tone: 'done', title: 'Connected · ChatGPT plan', lines: [...signedIn, 'Limits are set in ChatGPT.', ...(coachChatInBuild ? [] : [NO_COACH_YET])] },
        modelRow: `Model: ${modelName ?? 'not chosen'}`,
        workoutModelRow: `Mid-workout: ${state.workoutModel?.displayName ?? SAME_AS_COACH}`,
        primary: null,
        links: [manage],
      };
    case 'no_model':
      return {
        ...base,
        card: { icon: 'exclamationmark.triangle', tone: 'warning', title: 'Connected · ChatGPT plan', lines: [...signedIn, 'Choose a model to use the coach.'] },
        primary: { label: 'Choose model', action: 'choose_model' },
        links: [manage],
      };
    case 'model_gone':
      return {
        ...base,
        card: { icon: 'exclamationmark.triangle', tone: 'warning', title: `${modelName ?? 'The model you chose'} isn’t available any more.`, lines: [...signedIn] },
        primary: { label: 'Choose model', action: 'choose_model' },
        links: [manage],
      };
    case 'limit':
      return {
        ...base,
        card: { icon: 'exclamationmark.triangle', tone: 'warning', title: 'ChatGPT usage limit reached', lines: ['Coach paused'] },
        primary: manage,
        // Ben's tap lifts the pause; nothing retries by itself and no reset time is guessed.
        links: [{ label: 'Check again', action: 'check_again' }],
      };
    case 'expired':
      return {
        ...base,
        card: { icon: 'exclamationmark.triangle', tone: 'warning', title: 'ChatGPT disconnected', lines: ['Sign in again to use the coach.'] },
        primary: { label: 'Sign in again', action: 'start_sign_in' },
        showDisconnect: false,
      };
    case 'not_eligible':
      return {
        ...base,
        card: { icon: 'slash.circle', tone: 'info', title: 'This ChatGPT account can’t be used by other apps.', lines: ['Plus and Pro plans can, unless a work or school workspace blocks it.'] },
        primary: { label: 'Use a different account', action: 'start_sign_in' },
        showDisconnect: false,
      };
    case 'no_scope':
      return {
        ...base,
        card: { icon: 'exclamationmark.triangle', tone: 'warning', title: 'Signed in, but ChatGPT didn’t allow coach replies for this app.', lines: [] },
        primary: { label: 'Try again', action: 'start_sign_in' },
      };
    case 'region':
      return {
        ...base,
        card: { icon: 'slash.circle', tone: 'info', title: 'ChatGPT plan use in other apps isn’t available in your region.', lines: [] },
        primary: null,
        links: [{ label: 'Try again', action: 'start_sign_in' }],
        showDisconnect: false,
      };
  }
}

/** §2.2, adapted to v1 (no API key, no OpenAI voice). */
export const EXPLAINER = {
  title: 'Connect your ChatGPT plan',
  bullets: [
    'The coach’s text replies count toward your ChatGPT plan’s usage.',
    'Voice isn’t included.',
    'GymSmarter can’t see your ChatGPT chats or memory.',
    'Your workouts stay on this phone. The coach sends the parts it needs to OpenAI to reply.',
    'In ChatGPT’s settings, leave using credits after limits switched off for this app, so the coach stops at your plan’s limit.',
  ],
  footnote: 'A ChatGPT sign-in page opens next. If you need a code from another app, have it ready first.',
  primary: 'Continue with ChatGPT',
} as const;

export const WAITING = { title: 'Waiting for ChatGPT sign-in', body: 'Finish signing in on the ChatGPT page.', cancel: 'Cancel' } as const;

export interface CheckingLine {
  icon: ViewIcon;
  tone: ViewTone;
  text: string;
}

/** §2.4: done steps ticked, the running one marked, later ones open. No percentage. */
export function checkingView(phase: Extract<ConnectPhase, { kind: 'checking' }>): { title: string; lines: CheckingLine[]; footnote: string | null } {
  const order = ['signed_in', 'access', 'models'] as const;
  const at = order.indexOf(phase.step);
  const texts = [phase.email === null ? 'Signed in' : `Signed in as ${phase.email}`, 'Checking coach access', 'Finding available models'];
  const lines = texts.map((text, i): CheckingLine => {
    // `signed_in` is a finished fact the moment it is reported.
    if (i < at || (i === 0 && at === 0)) return { icon: 'checkmark.circle.fill', tone: 'done', text };
    if (i === at) return { icon: 'ellipsis', tone: 'progress', text };
    return { icon: 'circle', tone: 'info', text };
  });
  return { title: 'Connecting ChatGPT', lines, footnote: null };
}

export interface ModelChoiceRow {
  slug: string;
  title: string;
  tag: string | null;
  selected: boolean;
}

/** (Coach v3) The mid-workout model's default: the coach's own model. */
export const SAME_AS_COACH = 'Same as coach';

/**
 * (Coach v3, Ben 18 Oct) `Mid-workout ›`: `Same as coach` first (the default), then his plan's listed
 * models. Only listed models can be chosen; the app never picks one.
 */
export function workoutModelChoiceRows(models: readonly ModelOption[], selectedSlug: string | null): ModelChoiceRow[] {
  return [{ slug: '', title: SAME_AS_COACH, tag: null, selected: selectedSlug === null }, ...modelChoiceRows(models, selectedSlug)];
}

/** §2.5 list (also `Model ›`). Names come from the API; the tag only marks the tested model when listed. */
export function modelChoiceRows(models: readonly ModelOption[], selectedSlug: string | null): ModelChoiceRow[] {
  return models.map((m) => ({ slug: m.slug, title: m.displayName, tag: m.slug === TESTED_MODEL_SLUG ? 'tested with GymSmarter' : null, selected: m.slug === selectedSlug }));
}

export const FIRST_USE = {
  title: 'You’re using your ChatGPT plan',
  body: 'The coach’s replies now count toward your ChatGPT plan. You can set a limit for this app and see usage in ChatGPT.',
  modelHeading: 'Model',
  voice: 'Voice isn’t part of your plan.',
  primary: 'Done',
} as const;

export interface ConnectNotice {
  icon: ViewIcon;
  tone: ViewTone;
  text: string;
  detail: string | null;
  retry: boolean;
}

/**
 * The inline line after a sign-in attempt that didn't connect (§3.1). The
 * `failuresInARow` count includes this one (`didn't return` twice → the extra
 * line). Returns null for `connected`, which moves to first use or status.
 */
export function connectNotice(outcome: ConnectOutcome, failuresInARow: number): ConnectNotice | null {
  switch (outcome.kind) {
    case 'connected':
      return outcome.modelsFailure === null
        ? null
        : { icon: 'exclamationmark.triangle', tone: 'warning', text: 'Connected, but the model list didn’t load.', detail: describeFailure(outcome.modelsFailure), retry: false };
    case 'cancelled':
      return { icon: 'info.circle', tone: 'info', text: 'Sign-in cancelled.', detail: null, retry: false };
    case 'timed_out':
      return { icon: 'exclamationmark.triangle', tone: 'warning', text: 'Sign-in took too long.', detail: null, retry: true };
    case 'didnt_return':
      return {
        icon: 'exclamationmark.triangle',
        tone: 'warning',
        text: 'The sign-in page didn’t return to GymSmarter.',
        detail: ['This can happen if you switch apps while signing in.', ...(failuresInARow >= 2 ? ['Signing in may not work on this iPhone yet.'] : [])].join(' '),
        retry: true,
      };
    case 'no_scope':
      return { icon: 'exclamationmark.triangle', tone: 'warning', text: 'Signed in, but ChatGPT didn’t allow coach replies for this app.', detail: null, retry: true };
    case 'different_account':
      return {
        icon: 'exclamationmark.triangle',
        tone: 'warning',
        text: 'That’s a different ChatGPT account from the one this iPhone uses.',
        detail: 'Sign in with the same account, or disconnect first.',
        retry: true,
      };
    case 'sign_in_unavailable':
      return { icon: 'slash.circle', tone: 'info', text: 'ChatGPT sign-in isn’t in this build.', detail: outcome.reason, retry: false };
    case 'failed':
      // not_eligible / region show as the status card; other failures say what happened.
      return { icon: 'exclamationmark.triangle', tone: 'warning', text: 'Couldn’t connect ChatGPT.', detail: describeFailure(outcome.failure), retry: outcome.failure.kind !== 'not_eligible' };
  }
}

/** Profile → Coach row subtitle: icon-free words, the same states as the card. */
export function profileCoachLine(state: TextCoachState): string {
  switch (state.status) {
    case 'ok':
    case 'offline':
      return `Connected · ChatGPT plan${state.model === null ? '' : ` · ${state.model.displayName}`}`;
    case 'not_connected':
      return 'Not connected';
    case 'no_model':
      return 'Connected · choose a model';
    case 'model_gone':
      return 'Paused · choose a model';
    case 'limit':
      return 'Paused · usage limit reached';
    case 'expired':
      return 'ChatGPT disconnected · sign in again';
    case 'not_eligible':
      return 'Not connected · account can’t be used';
    case 'no_scope':
      return 'Not connected · coach access not allowed';
    case 'region':
      return 'Not connected · not available in your region';
  }
}

/**
 * The Summary's coach lines (ADR 0020 C8). Connected: no fixed note; the
 * summary turn's checked reply is the note, and its targets show on their
 * rows. Otherwise one short honest line (minimal copy) and the built-in
 * rule's targets, labelled. Nothing pretends a coach reviewed the workout.
 */
export function summaryCoachView(state: TextCoachState | null): { coach: CoachStatus; note: string | null } {
  if (state === null) return { coach: 'not_connected', note: 'Coach not connected.' };
  switch (state.status) {
    case 'not_connected':
    case 'not_eligible':
    case 'no_scope':
    case 'region':
      return { coach: 'not_connected', note: 'Coach not connected.' };
    case 'ok':
      return { coach: 'connected', note: null };
    case 'offline':
      return { coach: 'unavailable', note: 'Offline.' };
    case 'limit':
      return { coach: 'unavailable', note: 'Coach paused.' };
    case 'expired':
      return { coach: 'unavailable', note: 'Coach signed out.' };
    case 'no_model':
    case 'model_gone':
      return { coach: 'unavailable', note: 'Choose a coach model.' };
  }
}
