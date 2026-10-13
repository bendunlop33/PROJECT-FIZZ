import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useEffect, useRef, useState } from 'react';
import { Share, View } from 'react-native';

import { newUuid } from '../../device/runtime';
import { newLayoutView, readingResultView, readingSteps, type ReadingResultView } from '../../import/layout-views';
import type { ProfileStackParams } from '../../navigation/types';
import { useScreenData, useServices } from '../../shell/context';
import { useTheme } from '../../theme';
import { AppText, Card, InfoLine, PrimaryButton, Row, Screen, StatusLine, TextButton } from '../../ui';

type Phase = { kind: 'consent' } | { kind: 'reading'; chars: number } | { kind: 'result'; view: ReadingResultView };

/**
 * New file layout and Reading the layout (data-import-export §9.2.2,
 * §9.2.4, §9.3.3). The send line is the whole consent; `See what's sent`
 * shows the literal text. With the coach unusable the screen says why and
 * sends nothing. `Read with the coach` sends exactly the text shown, once
 * per tap (an operation ID per tap); `Stop` cancels and throws away a late
 * answer. Nothing is imported here.
 */
export function ImportNewLayoutScreen() {
  const theme = useTheme();
  const services = useServices();
  const navigation = useNavigation<NativeStackNavigationProp<ProfileStackParams>>();
  const { layoutId } = useRoute<RouteProp<ProfileStackParams, 'ImportNewLayout'>>().params;
  const [phase, setPhase] = useState<Phase>({ kind: 'consent' });
  const alive = useRef(true);
  const [data] = useScreenData(async (s) => {
    const info = await s.importLayouts.newTable(layoutId);
    const sample = s.importLayouts.buildImportSample(layoutId);
    return info && sample ? { info, sample } : null;
  });

  useEffect(() => {
    navigation.setOptions({ title: phase.kind === 'reading' ? 'Reading the layout' : 'New file layout' });
  }, [navigation, phase.kind]);

  // Leaving while it reads stops the request: a late answer is thrown away (§9.3.3).
  useEffect(
    () => () => {
      alive.current = false;
      services.importLayouts.stop(layoutId);
    },
    [services, layoutId],
  );

  if (data.state !== 'ready') return <Screen>{null}</Screen>;
  if (data.value === null) {
    return (
      <Screen>
        <StatusLine icon="info.circle" tone="info" text="Choose the file again." />
      </Screen>
    );
  }
  const { info, sample } = data.value;
  const v = newLayoutView(info, sample);

  async function read() {
    // The text shown now (the sheet may have changed it): its hash goes with the request (AI8).
    const now = services.importLayouts.buildImportSample(layoutId);
    if (!now) return;
    setPhase({ kind: 'reading', chars: now.chars });
    const r = await services.importLayouts.proposeImportMapping(layoutId, now.hash, newUuid());
    if (!alive.current) return;
    const view = readingResultView(r);
    if (view.next === 'check') {
      navigation.replace('ImportLayoutCheck', { layoutId });
      return;
    }
    setPhase({ kind: 'result', view });
  }

  if (phase.kind === 'reading') {
    return (
      <Screen
        footer={
          <TextButton
            label="Stop"
            tone="secondary"
            onPress={() => {
              services.importLayouts.stop(layoutId);
            }}
          />
        }
      >
        <AppText variant="headline">{v.fileName}</AppText>
        {readingSteps('waiting', phase.chars).map((l) => (
          <StatusLine key={l.text} icon={l.icon} tone={l.tone} text={l.text} />
        ))}
        <AppText variant="callout" color="text.secondary">
          Keep the app open.
        </AppText>
      </Screen>
    );
  }

  const result = phase.kind === 'result' ? phase.view : null;
  const primaryAction = result?.primary?.action ?? (v.primary.label === 'Choose another file' ? 'choose' : 'read');
  const primaryLabel = result?.primary?.label ?? v.primary.label;
  const footer = (
    <PrimaryButton
      label={primaryLabel}
      disabled={result === null && !v.primary.enabled}
      onPress={() => {
        if (primaryAction === 'choose') navigation.goBack();
        else void read();
      }}
    />
  );

  return (
    <Screen footer={footer}>
      <AppText variant="headline">{v.fileName}</AppText>
      <AppText variant="callout" color="text.secondary" numeric>
        {v.counts}
      </AppText>
      {v.damaged.map((d) => (
        <StatusLine key={d} icon="exclamationmark.triangle" tone="warning" text={d.replace(/^⚠ /, '')} />
      ))}
      {v.notice && result === null ? <StatusLine icon="info.circle" tone="info" text={v.notice} /> : null}

      {result ? (
        <Card>
          {result.status ? <StatusLine icon={result.status.icon} tone={result.status.tone} text={result.status.text} /> : null}
          {result.reasons.map((reason) => (
            <AppText key={reason} variant="callout">
              {`• ${reason}`}
            </AppText>
          ))}
          {result.fix ? (
            <TextButton
              label={result.fix.label.replace(/ ›$/, '')}
              onPress={() => {
                navigation.navigate('CoachConnection');
              }}
            />
          ) : null}
        </Card>
      ) : null}

      {v.sendLine !== null ? (
        <>
          <InfoLine text={v.sendLine} info={v.sendWhy} variant="callout" infoLabel="Why?" />
          <Row
            title="See what’s sent"
            onPress={() => {
              navigation.navigate('ImportSent', { layoutId });
            }}
          />
        </>
      ) : null}

      {v.needsCoach ? (
        <Card>
          <StatusLine icon={v.needsCoach.line.icon} tone={v.needsCoach.line.tone} text={v.needsCoach.line.text} />
          {v.needsCoach.fix ? (
            <TextButton
              label={v.needsCoach.fix.label.replace(/ ›$/, '')}
              onPress={() => {
                navigation.navigate('CoachConnection');
              }}
            />
          ) : null}
        </Card>
      ) : null}

      {v.firstLine !== null ? (
        <View style={{ gap: theme.space['2'] }}>
          <AppText variant="label" color="text.secondary">
            First line
          </AppText>
          <AppText variant="callout" selectable numberOfLines={3} style={{ fontFamily: 'Menlo', backgroundColor: theme.colors['bg.raised'], padding: theme.space['2'], borderRadius: theme.radius.sm }}>
            {v.firstLine}
          </AppText>
          <TextButton
            label="Share first line"
            onPress={() => {
              if (v.firstLine !== null) void Share.share({ message: v.firstLine });
            }}
          />
        </View>
      ) : null}
    </Screen>
  );
}
