import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { changedColumnsView, checkLayoutView, type QuestionRowKey } from '../../import/layout-views';
import type { ProfileStackParams } from '../../navigation/types';
import { useDataChanged, useScreenData, useServices } from '../../shell/context';
import { useTheme } from '../../theme';
import { AppText, Card, Group, Icon, PrimaryButton, Row, Screen, SecondaryButton, SectionHeader, StatusLine, TextButton, Toast } from '../../ui';
import { useLayoutCancel } from './useLayoutCancel';

/**
 * Check the layout and Changed columns (data-import-export §9.2.5, §9.2.7).
 * Columns the header names show `✓`; the coach's suggestions show `Check`
 * with `Use this` / `Change…`, and nothing reads through them until Ben
 * taps (AI3). Questions appear only when the file needs them, with nothing
 * selected. Worked examples are the file's text and code's reading. Every
 * string is copy, file text or code's rendering (AI11).
 */
export function ImportLayoutCheckScreen() {
  const theme = useTheme();
  const services = useServices();
  const changed = useDataChanged();
  const navigation = useNavigation<NativeStackNavigationProp<ProfileStackParams>>();
  const { layoutId } = useRoute<RouteProp<ProfileStackParams, 'ImportLayoutCheck'>>().params;
  const [toast, setToast] = useState<{ text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [data] = useScreenData((s) => Promise.resolve(s.importLayouts.getLayoutReview(layoutId)));
  // `Cancel`, back and the swipe drop the session: the layout isn't reused (review r2 S2).
  useLayoutCancel(layoutId);

  useEffect(() => {
    const changedCols = data.state === 'ready' && data.value !== null && data.value.newColumns.length + data.value.missing.length > 0 && data.value.kind === 'saved';
    navigation.setOptions({ title: changedCols ? 'Changed columns' : 'Check the layout' });
  }, [navigation, data]);

  if (data.state !== 'ready') return <Screen>{null}</Screen>;
  const review = data.value;
  if (!review) {
    return (
      <Screen>
        <StatusLine icon="info.circle" tone="info" text="Choose the file again." />
      </Screen>
    );
  }
  const v = checkLayoutView(review);
  const changedCols = review.kind === 'saved' && review.newColumns.length + review.missing.length > 0 ? changedColumnsView(review) : null;

  function open(k: QuestionRowKey) {
    navigation.navigate('ImportLayoutQuestion', { layoutId, kind: k.kind, ...('column' in k ? { column: k.column } : {}), ...('token' in k ? { token: k.token } : {}) });
  }

  function confirm(column: number) {
    if (!review) return;
    const r = services.importLayouts.updateImportLayout(layoutId, { kind: 'confirm', column }, review.layoutVersion);
    if (!r.ok) setError('The layout changed. Try again.');
    changed();
  }

  async function useLayout() {
    if (!review) return;
    if (v.plan !== null) {
      navigation.popToTop();
      return;
    }
    setBusy(true);
    setError(null);
    const r = await services.importLayouts.confirmImportLayout(layoutId, review.layoutVersion);
    setBusy(false);
    if (r.ok && r.result.kind === 'preview') {
      navigation.navigate('ImportPreview', { draftId: r.result.draft.draftId });
      return;
    }
    if (!r.ok && r.reason === 'workout_unfinished') setError('Finish or discard your workout first.');
    else if (r.ok && r.result.kind === 'same_file') navigation.navigate('ImportResults', { jobId: r.result.job.id });
    else changed();
  }

  async function readAgain() {
    setBusy(true);
    const next = await services.importLayouts.readAgain(layoutId);
    setBusy(false);
    if (next !== null) navigation.replace('ImportNewLayout', { layoutId: next });
  }

  return (
    <Screen
      footer={<PrimaryButton label={v.primary.label} disabled={!v.primary.enabled || busy} busy={busy} onPress={() => void useLayout()} />}
      floating={
        toast ? (
          <Toast
            icon="checkmark.circle.fill"
            text={toast.text}
            action="Undo"
            onAction={() => {
              const now = services.importLayouts.getLayoutReview(layoutId);
              if (now) services.importLayouts.updateImportLayout(layoutId, { kind: 'undo' }, now.layoutVersion);
              setToast(null);
              changed();
            }}
            onDismiss={() => {
              setToast(null);
            }}
          />
        ) : null
      }
    >
      <AppText variant="headline">{v.fileName}</AppText>
      {changedCols ? (
        <>
          <AppText variant="callout" color="text.secondary">
            {changedCols.title}
          </AppText>
          {changedCols.lines.map((l) => (
            <AppText key={l} variant="callout" color="text.secondary">
              {l}
            </AppText>
          ))}
        </>
      ) : null}
      <StatusLine icon={v.readLine.icon} tone={v.readLine.tone} text={v.readLine.text} />
      {v.notReadLine ? <StatusLine icon="info.circle" tone="info" text={v.notReadLine} /> : null}
      {v.stuckLine ? <StatusLine icon={v.stuckLine.icon} tone={v.stuckLine.tone} text={v.stuckLine.text} /> : null}
      {v.plan ? <StatusLine icon="info.circle" tone="info" text={v.plan} /> : null}
      {error ? <StatusLine icon="exclamationmark.triangle" tone="warning" text={error} /> : null}

      {v.questions.length > 0 ? (
        <>
          {v.questionsTitle ? <SectionHeader title={v.questionsTitle} /> : null}
          <Group>
            {v.questions.map((q) => (
              <View key={JSON.stringify(q.key)}>
                <Row
                  title={q.title}
                  subtitle={q.answer === null ? null : q.lastTime ? `${q.answer} · Your answer last time` : q.answer}
                  icon={q.answered ? 'checkmark.circle.fill' : q.check ? 'questionmark.circle' : 'exclamationmark.triangle'}
                  iconColor={q.answered ? 'status.done' : 'status.warning'}
                  onPress={() => {
                    open(q.key);
                  }}
                />
                {q.check && q.key.kind === 'marker' ? (
                  <View style={{ flexDirection: 'row', gap: theme.space['3'], paddingHorizontal: theme.space['4'], paddingBottom: theme.space['3'] }}>
                    <SecondaryButton
                      label="Use this"
                      onPress={() => {
                        const token = q.key.kind === 'marker' ? q.key.token : '';
                        const m = review.review.questions.find((x) => x.kind === 'marker' && x.marker.token === token);
                        if (m?.kind === 'marker' && m.marker.suggested !== null) {
                          services.importLayouts.updateImportLayout(layoutId, { kind: 'marker', token, meaning: m.marker.suggested }, review.layoutVersion);
                          changed();
                        }
                      }}
                    />
                    <TextButton
                      label="Change…"
                      onPress={() => {
                        open(q.key);
                      }}
                    />
                  </View>
                ) : null}
              </View>
            ))}
          </Group>
        </>
      ) : null}

      <SectionHeader title="Columns" />
      <Group>
        {v.columns.map((c) => (
          <View key={c.index}>
            <Row
              title={c.header}
              subtitle={c.detail === null ? c.role : `${c.role} · ${c.detail}`}
              {...(c.state === 'check'
                ? { tag: { icon: 'questionmark.circle' as const, color: 'status.warning' as const, text: 'Check', accessibilityLabel: 'Check' } }
                : c.state === 'named'
                  ? { tag: { icon: 'checkmark.circle.fill' as const, color: 'status.done' as const, text: '✓', accessibilityLabel: 'Named by the column' } }
                  : c.state === 'you'
                    ? { tag: { icon: 'person' as const, color: 'text.secondary' as const, text: 'You', accessibilityLabel: 'You' } }
                    : c.state === 'last_time'
                      ? { tag: { icon: 'person' as const, color: 'text.secondary' as const, text: 'Your answer last time', accessibilityLabel: 'Your answer last time' } }
                      : {})}
              onPress={() => {
                navigation.navigate('ImportLayoutRole', { layoutId, column: c.index });
              }}
            />
            {c.state === 'check' ? (
              <View style={{ flexDirection: 'row', gap: theme.space['3'], paddingHorizontal: theme.space['4'], paddingBottom: theme.space['3'] }}>
                <SecondaryButton
                  label="Use this"
                  onPress={() => {
                    confirm(c.index);
                  }}
                />
                <TextButton
                  label="Change…"
                  onPress={() => {
                    navigation.navigate('ImportLayoutRole', { layoutId, column: c.index });
                  }}
                />
              </View>
            ) : null}
          </View>
        ))}
      </Group>

      <SectionHeader title="Rows" />
      {v.examples.map((e) => (
        <Card key={e.label}>
          <AppText variant="label" color="text.secondary" numeric>
            {e.label}
          </AppText>
          <AppText variant="callout" color="text.secondary" style={{ fontFamily: 'Menlo' }}>
            {e.source}
          </AppText>
          <AppText variant="callout" numeric>
            {e.reading}
          </AppText>
        </Card>
      ))}
      {review.canUndo && !toast ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}>
          <Icon name="arrow.uturn.backward" color="text.secondary" size={16} />
          <TextButton
            label="Undo"
            tone="secondary"
            onPress={() => {
              services.importLayouts.updateImportLayout(layoutId, { kind: 'undo' }, review.layoutVersion);
              changed();
            }}
          />
        </View>
      ) : null}
      {v.readAgain !== null ? <TextButton label={v.readAgain} tone="secondary" disabled={busy} onPress={() => void readAgain()} /> : null}
      <ToastFromRoute setToast={setToast} />
    </Screen>
  );
}

/** The role sheet passes back `"Reps" → Not imported` as a param; it shows here once with [Undo]. */
function ToastFromRoute({ setToast }: { setToast: (t: { text: string } | null) => void }) {
  const route = useRoute<RouteProp<ProfileStackParams, 'ImportLayoutCheck'>>();
  const navigation = useNavigation<NativeStackNavigationProp<ProfileStackParams>>();
  const moved = route.params.moved;
  useEffect(() => {
    if (moved !== undefined) {
      setToast({ text: moved });
      navigation.setParams({ moved: undefined });
    }
  }, [moved, setToast, navigation]);
  return null;
}
