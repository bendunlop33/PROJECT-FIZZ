import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Share, View } from 'react-native';

import { toMs } from '@fizz/domain';

import { pickImportFile } from '../../device/files';
import { formatTime } from '../../format/dates';
import { importHistoryView, notReadableLine } from '../../import/layout-views';
import { introView, openErrorView } from '../../import/views';
import type { ProfileStackParams } from '../../navigation/types';
import { useScreenData, useServices } from '../../shell/context';
import { useTheme } from '../../theme';
import { AppText, Card, Group, PrimaryButton, Row, Screen, SectionHeader, StatusLine, TextButton } from '../../ui';

type Problem = { text: string; firstLine: string | null; sameFileJobId: string | null };

/**
 * Import history (data-import-export §9.2.1): what reads offline (FitNotes,
 * saved layouts), what needs the coach (other apps and spreadsheets), the
 * coach's state in one phrase, and `Choose file`. The file is detected on
 * the phone; nothing leaves it until Ben taps a consent screen's primary.
 * Unavailable while a workout is unfinished (AI15). A paused import offers
 * `Continue import` (as the FitNotes intro did).
 */
export function ImportHistoryScreen() {
  const theme = useTheme();
  const services = useServices();
  const navigation = useNavigation<NativeStackNavigationProp<ProfileStackParams>>();
  const [reading, setReading] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [data] = useScreenData(async (s) => {
    const [block, paused, coach, layouts] = await Promise.all([s.imports.blockedBy(), s.imports.paused(), s.importLayouts.getImportCoachStatus(), s.importLayouts.listLayouts()]);
    return { block, paused, coach, saved: layouts.rows.filter((r) => r.state === 'in_use').length };
  });
  if (data.state !== 'ready') return <Screen>{null}</Screen>;
  const { block, paused, coach, saved } = data.value;
  const v = importHistoryView({ coach, savedLayouts: saved, blocked: block !== null });
  const intro = introView({ block, blockTime: block ? formatTime(toMs(block.startedAtUtc), block.tz) : '', paused });

  async function choose() {
    setProblem(null);
    const picked = await pickImportFile();
    if (picked.kind === 'cancelled') return;
    if (picked.kind === 'failed') {
      setProblem({ text: `Couldn’t open the file: ${picked.message}`, firstLine: null, sameFileJobId: null });
      return;
    }
    setReading(true);
    try {
      const r = await services.importLayouts.previewImport({ name: picked.name, text: picked.text });
      switch (r.kind) {
        case 'no_profile':
          return;
        case 'blocked':
          setProblem({ text: 'Finish or discard your workout first.', firstLine: null, sameFileJobId: null });
          return;
        case 'not_readable':
          setProblem({ text: notReadableLine(r.reason), firstLine: r.firstLine, sameFileJobId: null });
          return;
        case 'fitnotes':
        case 'saved_layout': {
          if (r.result.kind === 'preview') {
            navigation.navigate('ImportPreview', { draftId: r.result.draft.draftId });
            return;
          }
          const err = openErrorView(r.result);
          if (err) setProblem(err);
          return;
        }
        case 'saved_layout_review':
        case 'saved_layout_changed':
          navigation.navigate('ImportLayoutCheck', { layoutId: r.layoutId });
          return;
        case 'new_table':
          navigation.navigate('ImportNewLayout', { layoutId: r.layoutId });
          return;
      }
    } catch (e) {
      setProblem({ text: `Couldn’t read the file: ${e instanceof Error ? e.message : String(e)}`, firstLine: null, sameFileJobId: null });
    } finally {
      setReading(false);
    }
  }

  const footer = intro.paused ? (
    <PrimaryButton
      label="Continue import"
      disabled={!intro.primary.enabled}
      onPress={() => {
        if (intro.paused) navigation.navigate('ImportRun', { jobId: intro.paused.jobId });
      }}
    />
  ) : (
    <PrimaryButton label={reading ? 'Reading file…' : v.primary.label} busy={reading} disabled={!v.primary.enabled || reading} onPress={() => void choose()} />
  );

  return (
    <Screen footer={footer}>
      {v.blockLine ? <StatusLine icon="info.circle" tone="info" text={v.blockLine} /> : null}
      {intro.paused ? (
        <Card>
          <StatusLine icon="exclamationmark.triangle" tone="warning" text={intro.paused.text} />
          <TextButton
            label="See this import"
            onPress={() => {
              if (intro.paused) navigation.navigate('ImportResults', { jobId: intro.paused.jobId });
            }}
          />
        </Card>
      ) : null}

      <SectionHeader title="Offline" />
      <Group>
        {v.offline.map((o) => (
          <Row
            key={o.text}
            title={o.text}
            icon="checkmark.circle.fill"
            iconColor="status.done"
            {...(o.tappable === 'saved_layouts'
              ? {
                  onPress: () => {
                    navigation.navigate('SavedLayouts');
                  },
                }
              : {})}
          />
        ))}
      </Group>

      <SectionHeader title="Needs the coach" />
      <Group>
        {v.needsCoach.map((t) => (
          <Row key={t} title={t} icon="info.circle" />
        ))}
        <Row
          title={v.coach.line.text}
          icon={v.coach.line.icon}
          iconColor={v.coach.line.tone === 'done' ? 'status.done' : 'text.secondary'}
          {...(v.coach.fix
            ? {
                trailing: (
                  <AppText variant="callout" color="accent">
                    {v.coach.fix.label.replace(/ ›$/, '')}
                  </AppText>
                ),
                onPress: () => {
                  navigation.navigate('CoachConnection');
                },
              }
            : {})}
        />
      </Group>

      {problem ? (
        <Card>
          <StatusLine icon="exclamationmark.triangle" tone="warning" text={problem.text} />
          {problem.firstLine !== null ? (
            <View style={{ gap: theme.space['2'] }}>
              <AppText variant="label" color="text.secondary">
                First line
              </AppText>
              <AppText variant="callout" selectable numberOfLines={3} style={{ fontFamily: 'Menlo', backgroundColor: theme.colors['bg.raised'], padding: theme.space['2'], borderRadius: theme.radius.sm }}>
                {problem.firstLine}
              </AppText>
              <TextButton
                label="Share first line"
                onPress={() => {
                  if (problem.firstLine !== null) void Share.share({ message: problem.firstLine });
                }}
              />
            </View>
          ) : null}
          {problem.sameFileJobId !== null ? (
            <TextButton
              label="View that import"
              onPress={() => {
                if (problem.sameFileJobId !== null) navigation.navigate('ImportResults', { jobId: problem.sameFileJobId });
              }}
            />
          ) : null}
        </Card>
      ) : null}
    </Screen>
  );
}
