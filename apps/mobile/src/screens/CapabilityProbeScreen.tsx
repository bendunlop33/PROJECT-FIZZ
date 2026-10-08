import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';

import { reportMeta } from '../app-info';
import { nowMs } from '../clock';
import {
  PROBES,
  STATUS_LABEL,
  appendDetail,
  confirmObservation,
  recordAudioEvent,
  formatReport,
  recordResult,
  toUtcIso,
  type ProbeId,
  type ProbeStatus,
  type ResultUpdate,
  type SecondaryAction,
} from '../probe/model';
import {
  formatMs,
  judgeRecoveredRest,
  recoverProbeRest,
  serialiseProbeRest,
  startProbeRest,
} from '../probe/rest-probe';
import {
  getProbeValue,
  probeUuid,
  putProbeValue,
  requestAlarmKitPermission,
  runAlarmKitProbe,
  runAppGroupProbe,
  runAudioCoachProbe,
  runLockedCueProbe,
  runLiveActivityProbe,
  runNotificationProbe,
  runSecureStoreProbe,
  runSpeechRecognitionProbe,
  runSqliteProbe,
  runTtsProbe,
} from '../probe/runners';
import { getSnapshot, loadSavedResults, subscribe, updateResults } from '../probe/results-store';
import AudioCoach from '../../modules/audio-coach';

const REST_KEY = 'rest_deadline_probe';
/** New per JS launch: lets the rest probe tell "same launch" from "after relaunch". */
const LAUNCH_ID = probeUuid();
const BUILD_NUMBER = reportMeta().buildNumber;

interface Props {
  onBack: () => void;
}

export function CapabilityProbeScreen({ onBack }: Props) {
  const { results, loaded, loadIssues, persistError } = useSyncExternalStore(subscribe, getSnapshot);
  const [transcript, setTranscript] = useState('');
  const [restLine, setRestLine] = useState<string | null>(null);
  const [busy, setBusy] = useState<ReadonlySet<ProbeId>>(new Set());
  const restStored = useRef<string | null>(null);

  // Goes through the store, so a probe that finishes after ‹ Back is still saved.
  const apply = useCallback((id: ProbeId, update: ResultUpdate) => {
    updateResults((r) => recordResult(r, id, update, nowMs()));
  }, []);

  // Rest deadline: recompute from the stored deadline; the tick only refreshes the display.
  const refreshRest = useCallback(() => {
    const recovered = recoverProbeRest(restStored.current, LAUNCH_ID, nowMs());
    if (recovered.kind === 'running') setRestLine(`${formatMs(recovered.remainingMs)} remaining`);
    else if (recovered.kind === 'expired') setRestLine(`Rest ended ${formatMs(recovered.overrunMs)} ago`);
    else setRestLine(null);
    return recovered;
  }, []);

  useEffect(() => {
    // A function, not a `let`: TypeScript can't see the cleanup closure's
    // assignment and would narrow a plain flag after the first check.
    const life = { cancelled: false };
    const cancelled = () => life.cancelled;
    void (async () => {
      // Saved results first, so the rest recovery below only replaces its own row.
      await loadSavedResults();
      if (cancelled()) return;
      try {
        restStored.current = await getProbeValue(REST_KEY);
      } catch (e) {
        if (!cancelled()) apply('rest_deadline', { status: 'fail', summary: `Could not read saved rest: ${String(e)}` });
        return;
      }
      if (cancelled()) return;
      const verdict = judgeRecoveredRest(refreshRest(), BUILD_NUMBER);
      if (verdict.status !== 'not_run') apply('rest_deadline', verdict);
    })();
    const tick = setInterval(refreshRest, 1000);
    return () => {
      life.cancelled = true;
      clearInterval(tick);
    };
  }, [apply, refreshRest]);

  // Audio-coach events, logged while this screen is mounted (it stays mounted
  // while the phone is locked during the locked-cue test).
  const audioEvents = useRef<{ atMs: number; line: string }[]>([]);
  useEffect(() => {
    if (AudioCoach === null) return;
    const log = (line: string) => {
      const atMs = nowMs();
      audioEvents.current = [...audioEvents.current, { atMs, line }].slice(-50);
      updateResults((r) => recordAudioEvent(r, line, atMs));
    };
    const subs = [
      AudioCoach.addListener('onInterruption', (e) => {
        log(`interruption ${e.type}${e.type === 'ended' ? ` (shouldResume ${String(e.shouldResume)})` : ''}`);
      }),
      AudioCoach.addListener('onRouteChange', (e) => {
        log(`route change: ${e.reason}; outputs ${e.outputs.join(', ') || 'none'}`);
      }),
    ];
    return () => {
      subs.forEach((s) => {
        s.remove();
      });
    };
  }, []);
  const eventsSince = useCallback(
    (sinceMs: number) => audioEvents.current.filter((e) => e.atMs >= sinceMs).map((e) => e.line),
    [],
  );

  const run = useCallback(
    async (id: ProbeId) => {
      setBusy((b) => new Set(b).add(id));
      apply(id, { status: 'running', summary: 'Running…' });
      const now = nowMs();
      let update: ResultUpdate;
      // Any throw still ends in a terminal state, never a stuck RUNNING.
      try {
        switch (id) {
          case 'sqlite':
            update = await runSqliteProbe(toUtcIso(now));
            break;
          case 'secure_store':
            update = await runSecureStoreProbe();
            break;
          case 'notification':
            update = await runNotificationProbe(now, (line) => {
              updateResults((r) => appendDetail(r, 'notification', line, nowMs()));
            });
            break;
          case 'rest_deadline': {
            const stored = serialiseProbeRest(
              startProbeRest({ timerId: probeUuid(), sessionId: probeUuid(), setId: probeUuid() }, LAUNCH_ID, BUILD_NUMBER, now),
            );
            try {
              await putProbeValue(REST_KEY, stored, toUtcIso(now));
              restStored.current = stored;
              update = judgeRecoveredRest(refreshRest(), BUILD_NUMBER);
            } catch (e) {
              update = { status: 'fail', summary: `Could not save rest: ${String(e)}` };
            }
            break;
          }
          case 'tts':
            update = await runTtsProbe();
            break;
          case 'audio_coach':
            update = await runAudioCoachProbe();
            break;
          case 'audio_events':
            update = {
              status: 'not_run',
              summary: 'Nothing to run: events are logged automatically while this screen is open',
            };
            break;
          case 'locked_cue':
            update = await runLockedCueProbe(eventsSince);
            break;
          case 'speech_recognition':
            setTranscript('');
            update = await runSpeechRecognitionProbe(setTranscript);
            break;
          case 'app_group':
            update = await runAppGroupProbe();
            break;
          case 'live_activity':
            update = await runLiveActivityProbe(now);
            break;
          case 'alarmkit':
            update = await runAlarmKitProbe();
            break;
          case 'chatgpt_signin':
            update = { status: 'not_implemented', summary: 'S1 ChatGPT sign-in: not yet implemented' };
            break;
        }
      } catch (e) {
        update = { status: 'fail', summary: `Probe threw: ${e instanceof Error ? e.message : String(e)}` };
      }
      apply(id, update);
      setBusy((b) => {
        const next = new Set(b);
        next.delete(id);
        return next;
      });
    },
    [apply, refreshRest, eventsSince],
  );

  // A row's second button (e.g. AlarmKit "Request permission"). Shares the
  // row's busy state with Run, and always ends in a terminal state.
  const runSecondary = useCallback(
    async (id: ProbeId, action: SecondaryAction) => {
      setBusy((b) => new Set(b).add(id));
      apply(id, { status: 'running', summary: `${action.label}…` });
      let update: ResultUpdate;
      try {
        // The only action today ('alarmkit_request_permission'); switch on
        // action.id when a second one is added.
        update = await requestAlarmKitPermission();
      } catch (e) {
        update = { status: 'fail', summary: `${action.label} threw: ${e instanceof Error ? e.message : String(e)}` };
      }
      apply(id, update);
      setBusy((b) => {
        const next = new Set(b);
        next.delete(id);
        return next;
      });
    },
    [apply],
  );

  const exportReport = useCallback(async () => {
    await Share.share({ message: formatReport(results, reportMeta(), nowMs()) });
  }, [results]);

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={onBack} hitSlop={12}>
          <Text style={styles.link}>‹ Back</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Capability probe</Text>
        <Pressable accessibilityRole="button" onPress={() => void exportReport()} hitSlop={12}>
          <Text style={styles.link}>Export</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.list}>
        {!loaded ? <Text style={styles.howTo}>Loading saved results…</Text> : null}
        {persistError !== null ? (
          <Text style={styles.warning}>Results are NOT being saved: {persistError}. Tap Export before leaving the app.</Text>
        ) : null}
        {loadIssues.map((issue) => (
          <Text key={issue} style={styles.warning}>
            {issue}
          </Text>
        ))}
        {PROBES.map((def) => {
          const r = results[def.id];
          return (
            <View key={def.id} style={styles.card}>
              <View style={styles.row}>
                <Text style={styles.cardTitle}>
                  {def.ref}: {def.title}
                </Text>
                <Text style={[styles.badge, badgeStyle(r.status)]}>{STATUS_LABEL[r.status]}</Text>
              </View>
              <Text style={styles.howTo}>{def.howTo}</Text>
              <Text style={styles.summary}>{r.summary}</Text>
              {r.details.map((d) => (
                <Text key={d} style={styles.detail}>
                  • {d}
                </Text>
              ))}
              {def.id === 'rest_deadline' && restLine !== null ? <Text style={styles.big}>{restLine}</Text> : null}
              {def.id === 'speech_recognition' && busy.has('speech_recognition') ? (
                <Text style={styles.big}>{transcript.length > 0 ? transcript : 'Listening…'}</Text>
              ) : null}
              <Text style={styles.time}>{r.atUtc === null ? 'Never run' : `Last change ${r.atUtc} UTC`}</Text>
              {def.id !== 'chatgpt_signin' && def.id !== 'audio_events' ? (
                <View style={styles.row}>
                  <Pressable
                    accessibilityRole="button"
                    disabled={!loaded || busy.has(def.id) || r.status === 'running'}
                    style={[styles.button, (!loaded || busy.has(def.id) || r.status === 'running') && styles.disabled]}
                    onPress={() => void run(def.id)}
                  >
                    <Text style={styles.buttonText}>Run</Text>
                  </Pressable>
                  {def.secondaryAction !== undefined ? (
                    <Pressable
                      accessibilityRole="button"
                      disabled={!loaded || busy.has(def.id) || r.status === 'running'}
                      style={[styles.button, (!loaded || busy.has(def.id) || r.status === 'running') && styles.disabled]}
                      onPress={() => {
                        if (def.secondaryAction !== undefined) void runSecondary(def.id, def.secondaryAction);
                      }}
                    >
                      <Text style={styles.buttonText}>{def.secondaryAction.label}</Text>
                    </Pressable>
                  ) : null}
                  {r.status === 'needs_check' && def.confirmQuestion !== undefined ? (
                    <>
                      <Pressable
                        accessibilityRole="button"
                        style={styles.button}
                        onPress={() => {
                          updateResults((x) => confirmObservation(x, def.id, true, nowMs()));
                        }}
                      >
                        <Text style={styles.buttonText}>Yes</Text>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        style={styles.button}
                        onPress={() => {
                          updateResults((x) => confirmObservation(x, def.id, false, nowMs()));
                        }}
                      >
                        <Text style={styles.buttonText}>No</Text>
                      </Pressable>
                    </>
                  ) : null}
                </View>
              ) : null}
              {r.status === 'needs_check' && def.confirmQuestion !== undefined ? (
                <Text style={styles.question}>{def.confirmQuestion}</Text>
              ) : null}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

function badgeStyle(status: ProbeStatus) {
  switch (status) {
    case 'pass':
      return styles.pass;
    case 'fail':
      return styles.fail;
    case 'needs_check':
    case 'running':
      return styles.pending;
    case 'unavailable':
    case 'not_run':
    case 'not_implemented':
      return styles.neutral;
  }
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 },
  headerTitle: { fontSize: 17, fontWeight: '600' },
  link: { fontSize: 17, color: '#0a63c9' },
  list: { padding: 16, gap: 12 },
  card: { borderWidth: 1, borderColor: '#ddd', borderRadius: 10, padding: 12, gap: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  cardTitle: { flex: 1, fontSize: 15, fontWeight: '600' },
  badge: { fontSize: 11, fontWeight: '700', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, overflow: 'hidden' },
  pass: { backgroundColor: '#d6f5dd', color: '#0b5d1e' },
  fail: { backgroundColor: '#fbdada', color: '#8a1111' },
  pending: { backgroundColor: '#fff1c2', color: '#6b4e00' },
  neutral: { backgroundColor: '#eee', color: '#444' },
  howTo: { fontSize: 13, color: '#555' },
  summary: { fontSize: 15 },
  detail: { fontSize: 13, color: '#333' },
  big: { fontSize: 22, fontWeight: '600' },
  time: { fontSize: 11, color: '#777' },
  question: { fontSize: 13, fontStyle: 'italic' },
  warning: { fontSize: 13, color: '#8a1111' },
  button: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 8, backgroundColor: '#0a63c9' },
  disabled: { opacity: 0.4 },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
