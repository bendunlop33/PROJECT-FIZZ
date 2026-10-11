import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Alert } from 'react-native';

import { toMs } from '@fizz/domain';

import { pickBackupFolder } from '../../device/files';
import { newUuid } from '../../device/runtime';
import { formatTime } from '../../format/dates';
import { resultsView, undoAlert, undoneToast } from '../../import/views';
import type { ProfileStackParams } from '../../navigation/types';
import { useDataChanged, useScreenData, useServices } from '../../shell/context';
import { deleteToolbarLabel, pastRowDetail, pastRowTitle, selectRowLabel } from '../../history/delete-view';
import { DeleteToastView } from '../../history/DeleteToastView';
import { useDeleteToast } from '../../history/useDeleteToast';
import { useSelectDelete } from '../../history/useSelectDelete';
import type { RepeatCandidate } from '../../services/workout-services';
import { AppText, Card, DangerTextButton, Group, PrimaryButton, Row, Screen, SectionHeader, SelectionToolbar, SelectRow, StatusLine, TextButton } from '../../ui';

const ICON_TONE = { done: 'done', info: 'info', warning: 'warning' } as const;

/**
 * Import results (data-import-export §2.5 step 5, §3.4): what came in (each
 * workout opens its sets with the original rows, check 24), every skipped
 * row and why, `Save row-by-row results (CSV)`, and `Undo this import`
 * (hides its workouts, deletes nothing; DX7). An unfinished import offers
 * `Continue import`.
 */
const WORKOUT_PAGE = 50;
export function ImportResultsScreen() {
  const services = useServices();
  const changed = useDataChanged();
  const navigation = useNavigation<NativeStackNavigationProp<ProfileStackParams>>();
  const { jobId } = useRoute<RouteProp<ProfileStackParams, 'ImportResults'>>().params;
  const [open, setOpen] = useState<string | null>(null);
  const [workoutPages, setWorkoutPages] = useState(1);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [undoOp] = useState(() => newUuid());
  // An imported workout deleted from its own view comes back here with Undo (delete-workouts DW24).
  const deleted = useDeleteToast();
  const [data, reload] = useScreenData(async (s) => {
    const [job, block, workouts] = await Promise.all([s.imports.job(jobId), s.imports.blockedBy(), s.history.importWorkouts(jobId)]);
    return { job, block, workouts: workouts.rows };
  });
  // Select in the import's workout list (§2.1, DW24): only its workouts still in history.
  const selectable = data.state === 'ready' && data.value.job?.state !== 'undone' ? data.value.workouts : NO_ROWS;
  const sel = useSelectDelete({ rows: selectable, loaded: data.state === 'ready', title: 'Import results', reload, toast: deleted });
  if (data.state !== 'ready') return <Screen>{null}</Screen>;
  const { job, block } = data.value;
  if (!job) {
    return (
      <Screen>
        <StatusLine icon="info.circle" tone="info" text="This import wasn’t found." />
      </Screen>
    );
  }
  const v = resultsView(job);
  const current = job;

  function undo() {
    const a = undoAlert(current);
    Alert.alert(a.title, a.message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Undo import',
        style: 'destructive',
        onPress: () => {
          void services.imports.revert(jobId, current.job.version, undoOp).then((r) => {
            changed();
            if (r.ok) setNote({ ok: true, text: undoneToast(r.workouts) });
            else if (r.reason === 'workout_unfinished') setNote({ ok: false, text: `Finish or discard your workout first (${r.block.title}, started ${formatTime(toMs(r.block.startedAtUtc), r.block.tz)}).` });
            else if (r.reason === 'stale') setNote({ ok: false, text: 'This import changed since you opened it. Check it and try again.' });
            else if (r.reason === 'busy') setNote({ ok: false, text: 'Stop the import first.' });
            else setNote({ ok: false, text: 'This import was already undone.' });
          });
        },
      },
    ]);
  }

  async function saveResults() {
    setNote(null);
    const file = await services.imports.resultsCsv(jobId);
    if (!file) return;
    const picked = await pickBackupFolder();
    if (picked.kind === 'cancelled') return;
    if (picked.kind === 'failed') {
      setNote({ ok: false, text: `Couldn’t open the folder picker: ${picked.message}` });
      return;
    }
    try {
      await picked.destination.write(file.fileName, file.text);
      const back = await picked.destination.read(file.fileName);
      setNote(back === file.text ? { ok: true, text: `Results saved to Files · ${picked.destination.label}` } : { ok: false, text: 'The results file didn’t save correctly. Try another folder.' });
    } catch (e) {
      setNote({ ok: false, text: `Couldn’t save the results: ${e instanceof Error ? e.message : String(e)}` });
    }
  }

  const tz = services.now().tz;
  if (sel.selecting) {
    return (
      <>
        <Screen>
          {sel.line ? (
            <StatusLine
              icon={sel.line.tone === 'warning' ? 'exclamationmark.triangle' : 'info.circle'}
              tone={sel.line.tone}
              text={sel.line.text}
              {...(sel.line.retry ? { action: <TextButton label="Try again" onPress={sel.line.retry} /> } : {})}
            />
          ) : null}
          <Group>
            {selectable.map((c) => (
              <SelectRow
                key={c.sessionId}
                title={pastRowTitle(c, tz)}
                lines={[pastRowDetail(c)]}
                selected={sel.selected.has(c.sessionId)}
                accessibilityLabel={selectRowLabel(c, tz, sel.selected.has(c.sessionId))}
                onToggle={() => {
                  sel.toggle(c.sessionId);
                }}
              />
            ))}
          </Group>
        </Screen>
        <DeleteToastView state={deleted} />
        <SelectionToolbar trailing={<DangerTextButton label={deleteToolbarLabel(sel.selected.size)} disabled={sel.selected.size === 0} onPress={sel.confirmSelected} />} />
      </>
    );
  }

  return (
    <>
    <Screen
      footer={
        v.canContinue ? (
          <PrimaryButton
            label="Continue import"
            disabled={block !== null}
            onPress={() => {
              navigation.replace('ImportRun', { jobId });
            }}
          />
        ) : (
          <PrimaryButton
            label="Done"
            onPress={() => {
              navigation.popToTop();
              navigation.navigate('DataBackup');
            }}
          />
        )
      }
    >
      <StatusLine icon={v.banner.icon} tone={ICON_TONE[v.banner.tone]} text={v.banner.text} />
      <Card>
        <AppText variant="headline" numeric>
          {v.headline}
        </AppText>
        <AppText variant="callout" color="text.secondary">
          {v.from}
        </AppText>
      </Card>
      {block !== null && (v.canContinue || v.canUndo) ? <StatusLine icon="info.circle" tone="info" text={`Finish or discard your workout first (${block.title}).`} /> : null}
      {note ? <StatusLine icon={note.ok ? 'checkmark.circle.fill' : 'exclamationmark.triangle'} tone={note.ok ? 'done' : 'warning'} text={note.text} /> : null}
      {sel.line ? <StatusLine icon="info.circle" tone="info" text={sel.line.text} /> : null}

      {v.imported ? (
        <>
          <SectionHeader title={v.imported.title} />
          <Group>
            {v.imported.workouts.slice(0, workoutPages * WORKOUT_PAGE).map((w) => (
              <Row
                key={w.date}
                title={w.text}
                onPress={() => {
                  navigation.navigate('ImportedWorkout', { jobId, date: w.date });
                }}
              />
            ))}
          </Group>
          {v.imported.workouts.length > workoutPages * WORKOUT_PAGE ? (
            <TextButton
              label="Show more"
              onPress={() => {
                setWorkoutPages((n) => n + 1);
              }}
            />
          ) : null}
        </>
      ) : null}

      {v.skipped.length > 0 ? (
        <>
          <SectionHeader title="Skipped" />
          <Group>
            {v.skipped.map((x) => (
              <Row
                key={x.result}
                title={x.title}
                onPress={() => {
                  setOpen(open === x.result ? null : x.result);
                }}
              />
            ))}
          </Group>
          {v.skipped
            .filter((x) => x.result === open)
            .map((x) => (
              <Group key={`${x.result}-rows`}>
                {x.lines.slice(0, 200).map((l) => (
                  <Row key={l} title={l} />
                ))}
              </Group>
            ))}
        </>
      ) : null}

      <TextButton label="Save row-by-row results (CSV)" onPress={() => void saveResults()} />
      {v.canUndo ? <TextButton label="Undo this import" onPress={undo} disabled={block !== null} /> : null}
    </Screen>
    <DeleteToastView state={deleted} />
    </>
  );
}

const NO_ROWS: RepeatCandidate[] = [];
