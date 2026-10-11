import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Share, View } from 'react-native';

import { toMs } from '@fizz/domain';

import { pickCsvFile } from '../../device/files';
import { formatTime } from '../../format/dates';
import { INTRO_COPY, introView, openErrorView, type OpenErrorView } from '../../import/views';
import type { ProfileStackParams } from '../../navigation/types';
import { useScreenData, useServices } from '../../shell/context';
import { useTheme } from '../../theme';
import { AppText, Card, InfoLine, PrimaryButton, Screen, StatusLine, TextButton } from '../../ui';

type Step = { kind: 'intro' } | { kind: 'reading' } | { kind: 'error'; view: OpenErrorView };

/**
 * `Import from FitNotes`, step 1 (data-import-export §2.5, §3.4): what it
 * does, `Choose CSV file`, then the file errors. No menu paths inside
 * FitNotes are given (they're unverified). Unavailable while a workout is
 * unfinished (DX4). A paused import offers `Continue import` instead.
 */
export function ImportIntroScreen() {
  const theme = useTheme();
  const services = useServices();
  const navigation = useNavigation<NativeStackNavigationProp<ProfileStackParams>>();
  const [step, setStep] = useState<Step>({ kind: 'intro' });
  const [pickError, setPickError] = useState<string | null>(null);
  const [data] = useScreenData(async (s) => {
    const [block, paused] = await Promise.all([s.imports.blockedBy(), s.imports.paused()]);
    return { block, paused };
  });
  if (data.state !== 'ready') return <Screen>{null}</Screen>;
  const { block, paused } = data.value;
  const view = introView({ block, blockTime: block ? formatTime(toMs(block.startedAtUtc), block.tz) : '', paused });

  async function choose() {
    setPickError(null);
    const picked = await pickCsvFile();
    if (picked.kind === 'cancelled') return;
    if (picked.kind === 'failed') {
      setPickError(`Couldn’t open the file: ${picked.message}`);
      return;
    }
    setStep({ kind: 'reading' });
    try {
      const r = await services.imports.open({ name: picked.name, text: picked.text });
      if (r.kind === 'preview') {
        setStep({ kind: 'intro' });
        navigation.navigate('ImportPreview', { draftId: r.draft.draftId });
        return;
      }
      const err = openErrorView(r);
      if (err) setStep({ kind: 'error', view: err });
    } catch (e) {
      setStep({ kind: 'error', view: { text: `Couldn’t read the file: ${e instanceof Error ? e.message : String(e)}`, firstLine: null, sameFileJobId: null } });
    }
  }

  const footer =
    step.kind === 'error' ? (
      <PrimaryButton label="Choose another file" onPress={() => void choose()} disabled={block !== null} />
    ) : view.paused ? (
      <PrimaryButton
        label="Continue import"
        disabled={!view.primary.enabled}
        onPress={() => {
          if (view.paused) navigation.navigate('ImportRun', { jobId: view.paused.jobId });
        }}
      />
    ) : (
      <PrimaryButton label={step.kind === 'reading' ? 'Reading file…' : 'Choose CSV file'} busy={step.kind === 'reading'} disabled={!view.primary.enabled || step.kind === 'reading'} onPress={() => void choose()} />
    );

  return (
    <Screen footer={footer}>
      <InfoLine text={INTRO_COPY.line} info={INTRO_COPY.info} infoLabel="About FitNotes files" />
      {view.blockLine ? <StatusLine icon="info.circle" tone="info" text={view.blockLine} /> : null}
      {view.paused ? (
        <Card>
          <StatusLine icon="exclamationmark.triangle" tone="warning" text={view.paused.text} />
          <TextButton
            label="See this import"
            onPress={() => {
              if (view.paused) navigation.navigate('ImportResults', { jobId: view.paused.jobId });
            }}
          />
        </Card>
      ) : null}
      {pickError ? <StatusLine icon="exclamationmark.triangle" tone="warning" text={pickError} /> : null}
      {step.kind === 'error' ? (
        <Card>
          <StatusLine icon="exclamationmark.triangle" tone="warning" text={step.view.text} />
          {step.view.firstLine !== null ? (
            <View style={{ gap: theme.space['2'] }}>
              <AppText variant="label" color="text.secondary">
                First line of the file
              </AppText>
              <AppText variant="callout" selectable numberOfLines={3} style={{ fontFamily: 'Menlo', backgroundColor: theme.colors['bg.raised'], padding: theme.space['2'], borderRadius: theme.radius.sm }}>
                {step.view.firstLine}
              </AppText>
              <TextButton
                label="Share first line"
                onPress={() => {
                  if (step.view.firstLine !== null) void Share.share({ message: step.view.firstLine });
                }}
              />
            </View>
          ) : null}
          {step.view.sameFileJobId !== null ? (
            <TextButton
              label="View that import"
              onPress={() => {
                if (step.view.sameFileJobId !== null) navigation.navigate('ImportResults', { jobId: step.view.sameFileJobId });
              }}
            />
          ) : null}
        </Card>
      ) : null}
    </Screen>
  );
}
