import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Linking, View } from 'react-native';

import {
  clearProviderFailure,
  connectChatGpt,
  disconnectChatGpt,
  markFirstUseSeen,
  readTextCoachState,
  refreshAvailableModels,
  selectModel,
  type ConnectPhase,
  type ModelOption,
  type TextCoachState,
} from '@fizz/providers';

import { coachConnectionPorts } from '../../ai/coach-connection-ports';
import {
  EXPLAINER,
  FIRST_USE,
  MANAGE_USAGE_URL,
  WAITING,
  checkingView,
  connectNotice,
  connectionStatusView,
  modelChoiceRows,
  type ConnectNotice,
  type ConnectionAction,
} from '../../ai/coach-connection-view';
import { useDataChanged } from '../../shell/context';
import { TIMING, useTheme } from '../../theme';
import { AppText, Card, ChoiceCard, DangerTextButton, PrimaryButton, Row, Screen, SecondaryButton, SectionHeader, StatusLine, TextButton, Toast } from '../../ui';

/**
 * Profile → Coach connection (ai-connection.md §2.1–2.6, ADR 0018 C5).
 * ChatGPT plan only in v1. All decisions are in @fizz/providers
 * (`connectChatGpt`, `textCoachState`) and `coach-connection-view`; this
 * screen renders them and calls the services on Ben's taps.
 */

type Flow =
  | { kind: 'status' }
  | { kind: 'explainer' }
  | { kind: 'waiting' }
  | { kind: 'checking'; phase: Extract<ConnectPhase, { kind: 'checking' }> }
  | { kind: 'first_use' }
  | { kind: 'models' };

export function CoachConnectionScreen() {
  const theme = useTheme();
  const changed = useDataChanged();
  const { ports, loopback } = coachConnectionPorts();
  const [state, setState] = useState<TextCoachState | null>(null);
  const [models, setModels] = useState<ModelOption[] | null>(null);
  const [flow, setFlow] = useState<Flow>({ kind: 'status' });
  const [notice, setNotice] = useState<ConnectNotice | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const didntReturnInARow = useRef(0);

  useEffect(() => {
    if (toast === null) return;
    const t = setTimeout(() => {
      setToast(null);
    }, TIMING.undoToast);
    return () => {
      clearTimeout(t);
    };
  }, [toast]);

  const reload = useCallback(
    async (listed: ModelOption[] | null) => {
      setState(await readTextCoachState(ports, { listedModels: listed }));
      changed();
    },
    [ports, changed],
  );

  /** GET /v1/models (no plan usage) so a removed model shows as `model_gone` (AC6). */
  const refreshModels = useCallback(async (): Promise<ModelOption[] | null> => {
    const r = await refreshAvailableModels(ports);
    const listed = r.ok ? r.models : null;
    if (listed !== null) setModels(listed);
    await reload(listed);
    return listed;
  }, [ports, reload]);

  useEffect(() => {
    void (async () => {
      const first = await readTextCoachState(ports);
      setState(first);
      if (['ok', 'no_model', 'model_gone', 'limit'].includes(first.status)) await refreshModels();
    })();
  }, [ports, refreshModels]);

  const startSignIn = async () => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const outcome = await connectChatGpt(ports, {
        onPhase: (phase) => {
          setFlow(phase.kind === 'waiting' ? { kind: 'waiting' } : { kind: 'checking', phase });
        },
      });
      didntReturnInARow.current = outcome.kind === 'didnt_return' ? didntReturnInARow.current + 1 : 0;
      setNotice(connectNotice(outcome, didntReturnInARow.current));
      if (outcome.kind === 'connected') {
        setModels(outcome.models.length > 0 ? outcome.models : null);
        await reload(outcome.models.length > 0 ? outcome.models : null);
        setFlow(outcome.firstUse && outcome.models.length > 0 ? { kind: 'first_use' } : { kind: 'status' });
      } else {
        await reload(null);
        setFlow({ kind: 'status' });
      }
    } finally {
      setBusy(false);
    }
  };

  const chooseModel = async (slug: string) => {
    if (models === null) return;
    const r = await selectModel(ports.settings, models, slug);
    if (r.ok) {
      await reload(models);
      if (flow.kind === 'models') {
        setToast(`Coach will use ${r.value.displayName}`);
        setFlow({ kind: 'status' });
      }
    }
  };

  const act = (action: ConnectionAction) => {
    switch (action) {
      case 'open_explainer':
        setNotice(null);
        setFlow({ kind: 'explainer' });
        return;
      case 'start_sign_in':
        void startSignIn();
        return;
      case 'manage_usage':
        void Linking.openURL(MANAGE_USAGE_URL);
        return;
      case 'choose_model':
        setFlow({ kind: 'models' });
        if (models === null) void refreshModels();
        return;
      case 'check_again':
        void clearProviderFailure(ports.settings).then(() => reload(models));
        return;
      case 'disconnect':
        Alert.alert('Disconnect ChatGPT?', 'The coach stops until you connect again. Your workouts stay.', [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Disconnect',
            style: 'destructive',
            onPress: () => {
              void (async () => {
                setBusy(true);
                try {
                  await disconnectChatGpt(ports);
                  setModels(null);
                  await reload(null);
                  setToast('ChatGPT disconnected');
                } finally {
                  setBusy(false);
                }
              })();
            },
          },
        ]);
        return;
    }
  };

  const toastView = toast === null ? null : <Toast icon="info.circle" text={toast} />;

  if (flow.kind === 'explainer') {
    return (
      <Screen footer={<PrimaryButton label={EXPLAINER.primary} disabled={busy} onPress={() => void startSignIn()} />}>
        <AppText variant="title2">{EXPLAINER.title}</AppText>
        <View style={{ gap: theme.space['2'] }}>
          {EXPLAINER.bullets.map((b) => (
            <AppText key={b} variant="body">{`• ${b}`}</AppText>
          ))}
        </View>
        <AppText variant="callout" color="text.secondary">
          {EXPLAINER.footnote}
        </AppText>
        <TextButton
          label="Cancel"
          onPress={() => {
            setFlow({ kind: 'status' });
          }}
        />
      </Screen>
    );
  }

  if (flow.kind === 'waiting') {
    return (
      <Screen>
        <StatusLine icon="ellipsis" tone="progress" text={WAITING.title} detail={WAITING.body} />
        <SecondaryButton label={WAITING.cancel} onPress={() => void loopback.cancel()} />
      </Screen>
    );
  }

  if (flow.kind === 'checking') {
    const v = checkingView(flow.phase);
    return (
      <Screen>
        <AppText variant="title2">{v.title}</AppText>
        <View style={{ gap: theme.space['2'] }}>
          {v.lines.map((l) => (
            <StatusLine key={l.text} icon={l.icon} tone={l.tone} text={l.text} />
          ))}
        </View>
        <AppText variant="callout" color="text.secondary">
          {v.footnote}
        </AppText>
      </Screen>
    );
  }

  if (flow.kind === 'first_use' || flow.kind === 'models') {
    const rows = modelChoiceRows(models ?? [], state?.model?.slug ?? null);
    const firstUse = flow.kind === 'first_use';
    return (
      <View style={{ flex: 1 }}>
        <Screen
          footer={
            <PrimaryButton
              label={firstUse ? FIRST_USE.primary : 'Done'}
              onPress={() => {
                if (firstUse) void markFirstUseSeen(ports.settings);
                setFlow({ kind: 'status' });
              }}
            />
          }
        >
          {firstUse ? (
            <>
              <AppText variant="title2">{FIRST_USE.title}</AppText>
              <AppText variant="body">{FIRST_USE.body}</AppText>
              <TextButton
                label="Manage usage"
                onPress={() => {
                  act('manage_usage');
                }}
              />
            </>
          ) : null}
          <SectionHeader title={FIRST_USE.modelHeading} />
          {models === null ? (
            <AppText variant="callout" color="text.secondary">
              {busy ? 'Finding available models…' : 'The model list didn’t load.'}
            </AppText>
          ) : (
            <View style={{ gap: theme.space['2'] }} accessibilityRole="radiogroup">
              {rows.map((r) => (
                <ChoiceCard key={r.slug} title={r.title} subtitle={r.tag} selected={r.selected} onPress={() => void chooseModel(r.slug)} />
              ))}
            </View>
          )}
          {models === null && !busy ? <SecondaryButton label="Try again" onPress={() => void refreshModels()} /> : null}
          {firstUse ? (
            <AppText variant="callout" color="text.secondary">
              {FIRST_USE.voice}
            </AppText>
          ) : null}
        </Screen>
        {toastView}
      </View>
    );
  }

  if (state === null) return <Screen>{null}</Screen>;
  const v = connectionStatusView(state, loopback.unavailableReason());
  return (
    <View style={{ flex: 1 }}>
      <Screen footer={v.primary === null ? undefined : <PrimaryButton label={v.primary.label} busy={busy} disabled={busy} onPress={() => { if (v.primary) act(v.primary.action); }} />}>
        <SectionHeader title="Text coach" />
        <Card>
          <View style={{ gap: theme.space['2'] }}>
            <StatusLine icon={v.card.icon} tone={v.card.tone} text={v.card.title} detail={v.card.lines.join('\n') || null} />
            {v.modelRow !== null ? (
              <Row
                title={v.modelRow}
                onPress={() => {
                  act('choose_model');
                }}
              />
            ) : null}
            {v.links.map((l) => (
              <TextButton
                key={l.action}
                label={l.label}
                disabled={busy}
                onPress={() => {
                  act(l.action);
                }}
              />
            ))}
          </View>
        </Card>
        {notice !== null ? (
          <View style={{ gap: theme.space['2'] }}>
            <StatusLine icon={notice.icon} tone={notice.tone} text={notice.text} detail={notice.detail} />
            {notice.retry ? <SecondaryButton label="Try again" disabled={busy} onPress={() => void startSignIn()} /> : null}
          </View>
        ) : null}
        {v.pitch !== null ? (
          <AppText variant="callout" color="text.secondary">
            {v.pitch}
          </AppText>
        ) : null}
        {v.showDisconnect ? (
          <DangerTextButton
            label="Disconnect ChatGPT"
            disabled={busy}
            onPress={() => {
              act('disconnect');
            }}
          />
        ) : null}
      </Screen>
      {toastView}
    </View>
  );
}
