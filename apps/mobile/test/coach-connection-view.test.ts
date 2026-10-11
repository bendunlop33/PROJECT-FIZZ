import { describe, expect, it } from 'vitest';

import { failure, type TextCoachState, type TextCoachStatus } from '@fizz/providers';

import {
  COACH_CHAT_IN_BUILD,
  EXPLAINER,
  MANAGE_USAGE_URL,
  checkingView,
  connectNotice,
  connectionStatusView,
  modelChoiceRows,
  profileCoachLine,
  showFirstUseNotice,
  summaryCoachView,
} from '../src/ai/coach-connection-view';

const SOL = { slug: 'gpt-6.1-sol', displayName: 'GPT-6.1-Sol' };
const LUNA = { slug: 'gpt-6-luna', displayName: 'GPT-6-Luna' };

function state(status: TextCoachStatus, over: Partial<TextCoachState> = {}): TextCoachState {
  return { status, route: status === 'not_connected' ? null : 'chatgpt_plan', email: 'ben@example.com', model: SOL, ...over };
}

const ALL: TextCoachStatus[] = ['ok', 'not_connected', 'expired', 'limit', 'not_eligible', 'no_scope', 'region', 'model_gone', 'no_model', 'offline'];

describe('Coach connection status card (ai-connection §2.1, §2.6, §3.1)', () => {
  it('not connected: the plan pitch and Continue with ChatGPT, no Disconnect', () => {
    const v = connectionStatusView(state('not_connected', { email: null, model: null }), null);
    expect(v.card).toMatchObject({ icon: 'xmark.circle', title: 'Not connected', lines: ['Logging, targets, rest timers and built-in progression work without the coach.'] });
    expect(v.primary).toEqual({ label: 'Continue with ChatGPT', action: 'open_explainer' });
    expect(v.pitch).toContain('Voice isn’t included.');
    expect(v.showDisconnect).toBe(false);
  });

  it('a build without the loopback module says so and offers no sign-in that can’t work (check 2)', () => {
    const v = connectionStatusView(state('not_connected', { email: null }), 'This build has no loopback sign-in module');
    expect(v.card.title).toBe('ChatGPT sign-in isn’t in this build');
    expect(v.primary).toBeNull();
  });

  it('connected: account, model row, limits line, Manage usage and Disconnect; no quota or message count', () => {
    const v = connectionStatusView(state('ok'), null, true);
    expect(v.card).toMatchObject({ icon: 'checkmark.circle.fill', tone: 'done', title: 'Connected · ChatGPT plan', lines: ['Signed in as ben@example.com', 'Limits are set in ChatGPT.'] });
    expect(v.modelRow).toBe('Model: GPT-6.1-Sol');
    expect(v.links).toEqual([{ label: 'Manage usage', action: 'manage_usage' }]);
    expect(v.showDisconnect).toBe(true);
    expect(JSON.stringify(v)).not.toMatch(/\d+ coach messages|%/);
  });

  it('this build has the coach chat (C6); a build without it would say so and never use up the first-use notice (review S2)', () => {
    expect(COACH_CHAT_IN_BUILD).toBe(true);
    expect(connectionStatusView(state('ok'), null).card.lines).toEqual(['Signed in as ben@example.com', 'Limits are set in ChatGPT.']);
    expect(connectionStatusView(state('ok'), null, false).card.lines).toEqual(['Signed in as ben@example.com', 'Limits are set in ChatGPT.', 'The coach chat isn’t in this build yet.']);
    const connected = { kind: 'connected' as const, email: 'ben@example.com', models: [SOL, LUNA], selected: SOL, modelsFailure: null, firstUse: true };
    expect(showFirstUseNotice(connected, false)).toBe(false);
    expect(showFirstUseNotice(connected)).toBe(true);
    expect(showFirstUseNotice({ ...connected, firstUse: false }, true)).toBe(false);
    expect(showFirstUseNotice({ ...connected, models: [] }, true)).toBe(false);
  });

  it('the explainer never reads as an instruction to keep paying (rule 7)', () => {
    expect(JSON.stringify(EXPLAINER)).not.toMatch(/keep paying/i);
    expect(EXPLAINER.bullets).toContain('In ChatGPT’s settings, leave using credits after limits switched off for this app, so the coach stops at your plan’s limit.');
  });

  it('limit: Manage usage is the primary; only Ben’s Check again lifts the pause; no reset time (check 6)', () => {
    const v = connectionStatusView(state('limit'), null);
    expect(v.card.title).toBe('ChatGPT usage limit reached');
    expect(v.card.lines).toEqual(['The coach is paused. Logging and built-in targets still work.']);
    expect(v.primary).toEqual({ label: 'Manage usage', action: 'manage_usage' });
    expect(v.links).toEqual([{ label: 'Check again', action: 'check_again' }]);
    expect(JSON.stringify(v)).not.toMatch(/reset|resets|try again at|\d{1,2}:\d{2}/i);
  });

  it('model gone and no model ask Ben to choose; another model is never named as in use (check 12)', () => {
    const gone = connectionStatusView(state('model_gone'), null);
    expect(gone.card.title).toBe('GPT-6.1-Sol isn’t available any more.');
    expect(gone.primary).toEqual({ label: 'Choose model', action: 'choose_model' });
    expect(connectionStatusView(state('no_model', { model: null }), null).primary?.action).toBe('choose_model');
  });

  it('expired, not eligible, no scope and region have their spec lines and a single way forward', () => {
    expect(connectionStatusView(state('expired'), null)).toMatchObject({ card: { title: 'ChatGPT disconnected' }, primary: { label: 'Sign in again', action: 'start_sign_in' } });
    expect(connectionStatusView(state('not_eligible'), null)).toMatchObject({
      card: { title: 'This ChatGPT account can’t be used by other apps.', lines: ['Plus and Pro plans can, unless a work or school workspace blocks it.'] },
      primary: { label: 'Use a different account' },
    });
    expect(connectionStatusView(state('no_scope'), null).card.title).toBe('Signed in, but ChatGPT didn’t allow coach replies for this app.');
    expect(connectionStatusView(state('region'), null).card.title).toBe('ChatGPT plan use in other apps isn’t available in your region.');
  });

  it('never offers a paid route in any state (rule 7; ADR 0020 §8)', () => {
    for (const s of ALL) {
      const text = JSON.stringify(connectionStatusView(state(s), null));
      expect(text).not.toMatch(/API key|paid|\$/i);
    }
    expect(JSON.stringify(EXPLAINER)).not.toMatch(/API key|paid|OpenAI key/i);
  });

  it('every status card has an icon and words (check 17)', () => {
    for (const s of ALL) {
      const v = connectionStatusView(state(s), null);
      expect(v.card.icon).toBeTruthy();
      expect(v.card.title.length).toBeGreaterThan(3);
    }
  });

  it('Manage usage opens ChatGPT usage settings', () => {
    expect(MANAGE_USAGE_URL).toBe('https://chatgpt.com/settings/usage');
  });
});

describe('sign-in steps and outcomes', () => {
  it('checking ticks finished steps, marks the running one and leaves later ones open (§2.4)', () => {
    const icons = (step: 'signed_in' | 'access' | 'models') => checkingView({ kind: 'checking', step, email: 'ben@example.com' }).lines.map((l) => l.icon);
    expect(icons('signed_in')).toEqual(['checkmark.circle.fill', 'circle', 'circle']);
    expect(icons('access')).toEqual(['checkmark.circle.fill', 'ellipsis', 'circle']);
    expect(icons('models')).toEqual(['checkmark.circle.fill', 'checkmark.circle.fill', 'ellipsis']);
    const v = checkingView({ kind: 'checking', step: 'models', email: 'ben@example.com' });
    expect(v.lines.map((l) => l.text)).toEqual(['Signed in as ben@example.com', 'Checking coach access', 'Finding available models']);
    expect(v.footnote).toBe('Nothing is used from your plan yet.');
  });

  it('outcomes use the spec lines; the second didn’t-return adds the may-not-work line (check 4)', () => {
    expect(connectNotice({ kind: 'cancelled' }, 0)?.text).toBe('Sign-in cancelled. Nothing was connected.');
    expect(connectNotice({ kind: 'timed_out' }, 0)).toMatchObject({ text: 'Sign-in took too long. Nothing was connected.', retry: true });
    expect(connectNotice({ kind: 'didnt_return', detail: 'x' }, 1)?.detail).toBe('This can happen if you switch apps while signing in.');
    expect(connectNotice({ kind: 'didnt_return', detail: 'x' }, 2)?.detail).toContain('Signing in may not work on this iPhone yet.');
    expect(connectNotice({ kind: 'no_scope' }, 0)).toMatchObject({ text: 'Signed in, but ChatGPT didn’t allow coach replies for this app.', detail: 'Nothing was stored.' });
  });

  it('not eligible is not offered as a retry (check 5)', () => {
    expect(connectNotice({ kind: 'failed', failure: failure('not_eligible', 'no') }, 0)?.retry).toBe(false);
    expect(connectNotice({ kind: 'failed', failure: failure('invalid_grant', 'bad code') }, 0)?.retry).toBe(true);
  });

  it('a clean connection shows no notice; a missing model list says so', () => {
    expect(connectNotice({ kind: 'connected', email: null, models: [SOL], selected: SOL, modelsFailure: null, firstUse: true }, 0)).toBeNull();
    expect(connectNotice({ kind: 'connected', email: null, models: [], selected: null, modelsFailure: failure('network', 'offline'), firstUse: true }, 0)?.text).toBe(
      'Connected, but the model list didn’t load.',
    );
  });

  it('model rows: API names, the tested tag only on the tested model, one selected', () => {
    expect(modelChoiceRows([LUNA, SOL], 'gpt-6-luna')).toEqual([
      { slug: 'gpt-6-luna', title: 'GPT-6-Luna', tag: null, selected: true },
      { slug: 'gpt-6.1-sol', title: 'GPT-6.1-Sol', tag: 'tested with GymSmarter', selected: false },
    ]);
  });
});

describe('Profile row and Summary lines', () => {
  it('Profile row names the state in words; no OAuth or token wording (check 16)', () => {
    expect(profileCoachLine(state('ok'))).toBe('Connected · ChatGPT plan · GPT-6.1-Sol');
    expect(profileCoachLine(state('limit'))).toBe('Paused · usage limit reached');
    for (const s of ALL) expect(profileCoachLine(state(s))).not.toMatch(/token|scope|oauth/i);
  });

  it('Summary never claims a coach review: tag and note follow the connection (check 1, rule 1)', () => {
    expect(summaryCoachView(null)).toEqual({ coach: 'not_connected', note: 'Coach not connected.' });
    expect(summaryCoachView(state('not_connected')).coach).toBe('not_connected');
    expect(summaryCoachView(state('not_eligible')).coach).toBe('not_connected');
    // Connected: the summary turn's checked reply is the note; nothing fixed stands in for it.
    expect(summaryCoachView(state('ok'))).toEqual({ coach: 'connected', note: null });
    for (const s of ['limit', 'expired', 'model_gone', 'no_model', 'offline'] as const) expect(summaryCoachView(state(s)).coach).toBe('unavailable');
    for (const s of ALL) expect(summaryCoachView(state(s)).note ?? '').not.toMatch(/OAuth|token|API key|paid/i);
  });
});
