import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Alert, Platform, Share, View } from 'react-native';

import {
  StepRecorder,
  disconnect,
  formatDuration,
  formatSignInReport,
  readConnection,
  runModelsStep,
  runRefreshStep,
  runResponsesStep,
  runSignInTest,
  type ConnectionSnapshot,
  type StepStatus,
} from '@fizz/providers';

import { createDevicePorts, createDeviceLoopback } from '../../ai/chatgpt-test-ports';
import { getSnapshot, setStep, subscribe, update } from '../../ai/chatgpt-test-store';
import { reportMeta } from '../../app-info';
import { isoUtc, nowMs } from '../../clock';
import { useTheme } from '../../theme';
import { AppText, ChoiceCard, DangerTextButton, Group, PrimaryButton, Row, Screen, SecondaryButton, SectionHeader, StatusLine, type SymbolName, type Tone } from '../../ui';

/**
 * Developer → ChatGPT sign-in test (spike S1, ADR 0012). Runs the real flow
 * and shows each step's real result. All logic is in @fizz/providers; this
 * screen only starts runs and renders results. Not a product screen: the
 * Coach connection design (ai-connection.md) is built after this test.
 */

const loopback = createDeviceLoopback();
const ports = createDevicePorts(loopback);

const STATUS_VIEW: Record<StepStatus, { icon: SymbolName; tone: Tone; word: string }> = {
  pending: { icon: 'circle', tone: 'info', word: 'Not run' },
  running: { icon: 'clock', tone: 'progress', word: 'Running' },
  pass: { icon: 'checkmark.circle.fill', tone: 'done', word: 'Pass' },
  fail: { icon: 'xmark.circle', tone: 'danger', word: 'Fail' },
  skipped: { icon: 'minus.circle', tone: 'info', word: 'Skipped' },
  unavailable: { icon: 'slash.circle', tone: 'warning', word: 'Unavailable' },
};

export function ChatGptSignInTestScreen() {
  const theme = useTheme();
  const s = useSyncExternalStore(subscribe, getSnapshot);
  const [connection, setConnection] = useState<ConnectionSnapshot | null>(null);
  const [readError, setReadError] = useState<string | null>(null);

  const refreshConnection = useCallback(async () => {
    try {
      setConnection(await readConnection(ports));
      setReadError(null);
    } catch (e) {
      setReadError(`Could not read the Keychain: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  useEffect(() => {
    void refreshConnection();
  }, [refreshConnection]);

  const recorder = useMemo(() => new StepRecorder(nowMs, setStep), []);
  const busy = s.running !== null;
  const signedIn = connection?.signedIn === true && connection.planUsage;

  const run = useCallback(
    async (kind: NonNullable<typeof s.running>, work: () => Promise<void>) => {
      if (getSnapshot().running !== null) return;
      update((x) => ({ ...x, running: kind, note: null }));
      try {
        await work();
      } finally {
        update((x) => ({ ...x, running: null }));
        await refreshConnection();
      }
    },
    [refreshConnection],
  );

  const startSignIn = () =>
    run('sign_in', async () => {
      update((x) => ({ ...x, listenerLog: [], streamingText: '' }));
      const result = await runSignInTest(ports, { preferredModel: getSnapshot().model?.slug ?? null, onStep: setStep });
      update((x) => ({ ...x, steps: result.steps, listenerLog: result.listenerLog, models: result.models, model: result.model ?? x.model }));
    });

  const listModels = () =>
    run('models', async () => {
      const r = await runModelsStep(ports, recorder);
      update((x) => ({ ...x, models: r.models, model: r.models.find((m) => m.slug === x.model?.slug) ?? r.models[0] ?? null }));
    });

  const sendTest = () =>
    run('responses', async () => {
      const model = getSnapshot().model;
      if (model === null) return;
      update((x) => ({ ...x, streamingText: '' }));
      await runResponsesStep(ports, model, recorder, (delta) => {
        update((x) => ({ ...x, streamingText: x.streamingText + delta }));
      });
    });

  const refreshNow = () =>
    run('refresh', async () => {
      await runRefreshStep(ports, recorder);
    });

  const confirmDisconnect = () => {
    Alert.alert('Disconnect ChatGPT?', 'The coach stops until you connect again. Your workouts, conversations and memory stay.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Disconnect',
        style: 'destructive',
        onPress: () => {
          void run('disconnect', async () => {
            const r = await disconnect(ports);
            update((x) => ({ ...x, note: [r.summary, ...r.details].join('\n') }));
          });
        },
      },
    ]);
  };

  const exportResults = async () => {
    const meta = reportMeta();
    const report = formatSignInReport(getSnapshot().steps, getSnapshot().listenerLog, {
      appVersion: meta.appVersion,
      buildNumber: meta.buildNumber,
      osVersion: `${Platform.OS} ${meta.osVersion}`,
      exportedAtIso: isoUtc(nowMs()),
      timeZone: meta.timeZone,
    });
    const note = getSnapshot().note;
    await Share.share({ message: note === null ? report : `${report}\n\nLast disconnect:\n${note}` });
  };

  return (
    <Screen>
      <AppText variant="callout" color="text.secondary">
        Spike S1. Checks whether your ChatGPT plan can run the coach on this iPhone. One tiny test reply counts toward your plan&apos;s usage. No API key
        is used, and nothing switches to a paid route.
      </AppText>

      <SectionHeader title="On this iPhone" />
      <Group>
        <Row
          title="ChatGPT"
          subtitle={connection === null ? 'Reading…' : connection.signedIn ? `Signed in as ${connection.email ?? '(no email)'}` : 'Not signed in'}
        />
        <Row
          title="Coach access (chatgpt.tokens.use.direct)"
          subtitle={connection === null ? '—' : connection.signedIn ? (connection.planUsage ? 'Granted' : 'Not granted') : '—'}
        />
        <Row
          title="Access token"
          subtitle={connection?.expiresInMs == null ? '—' : connection.expiresInMs > 0 ? `Expires in ${formatDuration(connection.expiresInMs)}` : 'Expired (Refresh now)'}
        />
        <Row
          title="Registration"
          subtitle={connection === null ? '—' : connection.clientId !== null ? `Client ${connection.clientId}` : connection.hostIdSaved ? 'Host ID saved; not registered yet' : 'Not registered'}
        />
      </Group>
      {readError !== null ? (
        <AppText variant="callout" color="status.danger">
          {readError}
        </AppText>
      ) : null}

      <View style={{ gap: theme.space['3'] }}>
        <PrimaryButton label="Start sign-in" busy={s.running === 'sign_in'} disabled={busy} onPress={() => void startSignIn()} />
        {s.running === 'sign_in' ? (
          <View style={{ gap: theme.space['2'] }}>
            <AppText variant="callout">Waiting for ChatGPT sign-in. Finish signing in on the ChatGPT page.</AppText>
            <SecondaryButton label="Cancel sign-in" onPress={() => void loopback.cancel()} />
          </View>
        ) : null}
        <SecondaryButton label="List models" disabled={busy || !signedIn} onPress={() => void listModels()} />
        <SecondaryButton
          label={s.model === null ? 'Send test message' : `Send test message (${s.model.displayName})`}
          disabled={busy || !signedIn || s.model === null}
          onPress={() => void sendTest()}
        />
        <SecondaryButton label="Refresh now" disabled={busy || connection?.signedIn !== true} onPress={() => void refreshNow()} />
        <SecondaryButton label="Export results" icon="square.and.arrow.up" disabled={busy} onPress={() => void exportResults()} />
      </View>

      {s.running === 'responses' || s.streamingText !== '' ? (
        <AppText variant="callout" color="text.secondary">
          Reply so far: {s.streamingText === '' ? '…' : `"${s.streamingText}"`}
        </AppText>
      ) : null}

      {s.models.length > 0 ? (
        <>
          <SectionHeader title="Model for the test message" />
          <View style={{ gap: theme.space['2'] }} accessibilityRole="radiogroup">
            {s.models.map((m) => (
              <ChoiceCard
                key={m.slug}
                title={m.displayName}
                subtitle={m.slug}
                selected={s.model?.slug === m.slug}
                onPress={() => {
                  update((x) => ({ ...x, model: m }));
                }}
              />
            ))}
          </View>
        </>
      ) : null}

      <SectionHeader title="Steps" />
      <View style={{ gap: theme.space['3'] }}>
        {s.steps.map((step) => {
          const v = STATUS_VIEW[step.status];
          const detail = [step.summary, ...step.details.map((d) => `• ${d}`)].join('\n');
          return <StatusLine key={step.id} icon={v.icon} tone={v.tone} text={`${v.word} · ${step.title}`} detail={detail} />;
        })}
      </View>

      {s.note !== null ? (
        <AppText variant="callout" color="text.secondary">
          {s.note}
        </AppText>
      ) : null}

      <DangerTextButton label="Disconnect ChatGPT" disabled={busy || connection?.signedIn !== true} onPress={confirmDisconnect} />
    </Screen>
  );
}
