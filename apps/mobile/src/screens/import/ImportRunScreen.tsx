import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useEffect, useRef, useState } from 'react';
import { Alert, View } from 'react-native';

import { toMs } from '@fizz/domain';

import { newUuid } from '../../device/runtime';
import { formatTime } from '../../format/dates';
import { plural } from '../../format/numbers';
import type { CommitResult } from '../../import/import-service';
import { layoutRefusedView, progressView, writeFailedLine } from '../../import/views';
import type { ProfileStackParams } from '../../navigation/types';
import { useDataChanged, useScreenData, useServices } from '../../shell/context';
import { useTheme } from '../../theme';
import { AppText, PrimaryButton, Screen, StatusLine, TextButton } from '../../ui';
import { SaveCopyToFiles } from '../data/SaveCopyToFiles';

type Phase =
  | { kind: 'confirm' }
  | { kind: 'backing_up' }
  | { kind: 'importing'; written: number; total: number }
  | { kind: 'failed'; text: string; jobId: string | null; retry: boolean; back?: { label: string; layoutId: string } | null };

/**
 * Confirm, back up on this phone, then import (data-import-export §2.5
 * step 4, §3.4, §4.1a, §4.3). The operation ID is chosen once per visit, so
 * a retry (or `Import` tapped twice) can't duplicate anything. `Stop` asks
 * first and leaves what is in. `Continue import` opens here with the job.
 */
export function ImportRunScreen() {
  const theme = useTheme();
  const services = useServices();
  const changed = useDataChanged();
  const navigation = useNavigation<NativeStackNavigationProp<ProfileStackParams>>();
  const params = useRoute<RouteProp<ProfileStackParams, 'ImportRun'>>().params;
  const resumeJob = 'jobId' in params ? params.jobId : null;
  const [operationId] = useState(() => newUuid());
  const [phase, setPhase] = useState<Phase>(resumeJob ? { kind: 'importing', written: 0, total: 0 } : { kind: 'confirm' });
  const stop = useRef(false);
  const started = useRef(false);
  const [status] = useScreenData((s) => s.backups.getStatus());
  const busy = phase.kind === 'backing_up' || phase.kind === 'importing';

  useEffect(() => {
    navigation.setOptions({ headerBackVisible: !busy, gestureEnabled: !busy });
  }, [navigation, busy]);

  function finish(r: CommitResult) {
    changed();
    if (r.ok) {
      navigation.replace('ImportResults', { jobId: r.jobId });
      return;
    }
    switch (r.reason) {
      case 'undone':
        navigation.replace('ImportResults', { jobId: r.jobId });
        return;
      case 'write_failed':
        setPhase({
          kind: 'failed',
          text: writeFailedLine(r),
          jobId: r.jobId,
          retry: true,
        });
        return;
      case 'finish_failed':
        // Every workout is in; only the last step failed. Continue import finishes it (review B1).
        setPhase({
          kind: 'failed',
          text: `${plural(r.written, 'workout is', 'workouts are')} in, but the import couldn’t be marked finished: ${r.message}. Try again to finish it.`,
          jobId: r.jobId,
          retry: true,
        });
        return;
      case 'outdated_answers':
        // Paused by an earlier build that read barbell weights as plates only for every exercise at once (review r8 S3).
        setPhase({
          kind: 'failed',
          text: `This import can’t continue (older version). ${plural(r.written, 'workout is', 'workouts are')} in. Undo it, then import again.`,
          jobId: r.jobId,
          retry: false,
        });
        return;
      case 'stale':
        Alert.alert('The preview changed', 'Check the preview again.', [{ text: 'OK', onPress: () => { navigation.goBack(); } }]);
        return;
      case 'layout_changed':
      case 'layout_session_changed': {
        // The saved layout changed, or the layout was changed on Check the layout, since the preview (rule 5): nothing was imported.
        const v = layoutRefusedView(r);
        setPhase({ kind: 'failed', text: v.text, jobId: null, retry: false, back: v.back });
        return;
      }
      case 'workout_unfinished':
        setPhase({ kind: 'failed', text: `Finish or discard your workout first (${r.block.title}, started ${formatTime(toMs(r.block.startedAtUtc), r.block.tz)}).`, jobId: null, retry: false });
        return;
      case 'another_import':
        setPhase({ kind: 'failed', text: `Another import isn’t finished yet (${r.job.fileName}). Continue or undo it first.`, jobId: r.job.id, retry: false });
        return;
      case 'backup_failed':
        setPhase({ kind: 'failed', text: `Couldn’t back up on this phone first: ${r.message} Nothing was imported.`, jobId: null, retry: true });
        return;
      case 'not_ready':
      case 'not_found':
        setPhase({ kind: 'failed', text: 'This preview is no longer open or still has questions. Go back and check it.', jobId: null, retry: false });
        return;
    }
  }

  async function run() {
    stop.current = false;
    const hooks = {
      onProgress: (written: number, total: number) => {
        setPhase({ kind: 'importing', written, total });
      },
      shouldStop: () => stop.current,
    };
    try {
      if (resumeJob !== null) {
        setPhase({ kind: 'importing', written: 0, total: 0 });
        finish(await services.imports.resume(resumeJob, hooks));
        return;
      }
      if (!('draftId' in params)) return;
      setPhase({ kind: 'backing_up' });
      finish(await services.imports.commit(params.draftId, params.mappingVersion, operationId, hooks));
    } catch (e) {
      setPhase({ kind: 'failed', text: `Import didn’t finish: ${e instanceof Error ? e.message : String(e)}. Continue from Past imports.`, jobId: resumeJob, retry: true });
    }
  }

  useEffect(() => {
    if (resumeJob !== null && !started.current) {
      started.current = true;
      void run();
    }
  });

  if (phase.kind === 'confirm') {
    const s = status.state === 'ready' ? status.value : null;
    const lastCopy = s?.offPhone.lastCopy ?? null;
    const needsCopy = s !== null && (lastCopy === null || lastCopy.atUtc < (s.onPhone.lastSuccess?.createdAtUtc ?? ''));
    const workouts = 'workouts' in params ? params.workouts : 0;
    return (
      <Screen footer={<PrimaryButton label={`Import ${plural(workouts, 'workout', 'workouts')}`} onPress={() => void run()} />}>
        <AppText variant="body">{`Adds ${plural(workouts, 'workout', 'workouts')}.`}</AppText>
        {needsCopy ? (
          <View style={{ gap: theme.space['2'] }}>
            <AppText variant="callout" color="text.secondary">Save a copy to Files first?</AppText>
            <SaveCopyToFiles variant="row" label="Save a copy to Files first" />
          </View>
        ) : null}
      </Screen>
    );
  }

  if (phase.kind === 'failed') {
    return (
      <Screen
        footer={
          phase.back ? (
            <PrimaryButton
              label={phase.back.label}
              onPress={() => {
                // Back to Check the layout with Ben's answers; the stale preview under it is dropped on the way.
                if (phase.back) navigation.popTo('ImportLayoutCheck', { layoutId: phase.back.layoutId });
              }}
            />
          ) : phase.retry ? (
            <PrimaryButton
              label="Try again"
              onPress={() => {
                if (phase.jobId !== null && resumeJob === null) {
                  // The job exists: carry on with it (same operation ID, nothing duplicated).
                  navigation.replace('ImportRun', { jobId: phase.jobId });
                  return;
                }
                void run();
              }}
            />
          ) : undefined
        }
      >
        <StatusLine icon="exclamationmark.triangle" tone="warning" text={phase.text} />
        {phase.jobId !== null ? (
          <TextButton
            label="See this import"
            onPress={() => {
              if (phase.jobId !== null) navigation.replace('ImportResults', { jobId: phase.jobId });
            }}
          />
        ) : null}
      </Screen>
    );
  }

  const progress = phase.kind === 'importing' && phase.total > 0 ? progressView(phase.written, phase.total) : null;
  return (
    <Screen>
      <AppText variant="title2" accessibilityRole="header">
        {phase.kind === 'backing_up' ? 'Backing up…' : 'Importing from FitNotes'}
      </AppText>
      {progress ? (
        <View style={{ gap: theme.space['2'] }} accessible accessibilityLabel={progress.text}>
          <AppText variant="body" numeric>
            {progress.text}
          </AppText>
          <View style={{ height: 4, borderRadius: 2, backgroundColor: theme.colors['bg.raised'], overflow: 'hidden' }}>
            <View style={{ height: 4, width: `${Math.round(progress.fraction * 100)}%`, backgroundColor: theme.colors.accent }} />
          </View>
        </View>
      ) : null}
      <AppText variant="callout" color="text.secondary">
        Keep GymSmarter open.
      </AppText>
      {phase.kind === 'importing' ? (
        <TextButton
          label="Stop"
          tone="secondary"
          onPress={() => {
            Alert.alert('Stop importing?', `${plural(phase.written, 'workout is', 'workouts are')} already in your history.`, [
              { text: 'Keep going', style: 'cancel' },
              {
                text: 'Stop',
                onPress: () => {
                  stop.current = true;
                },
              },
            ]);
          }}
        />
      ) : null}
    </Screen>
  );
}
