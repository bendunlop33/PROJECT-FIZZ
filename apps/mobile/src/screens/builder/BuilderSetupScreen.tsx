import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, ActionSheetIOS, Alert, Pressable, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { BuilderCoachReach } from '@fizz/coach';
import { CUSTOM_DAY_ID } from '@fizz/domain';
import type { BuilderGroup } from '@fizz/schemas';

import type { SetupFacts, SetupInput } from '../../builder/builder-service';
import { addGroup, sameIdentity, setupView, SETUP_COPY, stepGroup, stepMinutes, applyRecommended, withRecommendation } from '../../builder/builder-view';
import { registerSetupPage, takePendingSetupFill } from '../../builder/coach-ports';
import { CoachAskBar } from '../../ui/coach-ask-bar';
import { createOnDeviceSpeech } from '../../voice/on-device-speech';
import { newUuid } from '../../device/runtime';
import { builderPage } from '../../navigation/actions';
import type { RootStackParams } from '../../navigation/types';
import { useDataChanged, useServices } from '../../shell/context';
import { useTheme } from '../../theme';
import { AppText, BottomCard, Eyebrow, Icon, PrimaryButton, Screen, StatusLine, TextButton, Toast, ToastHost } from '../../ui';
import { ChoiceRow, Divider, Stepper, Table, ValueRow } from './BuilderParts';

/**
 * Set up (workout-builder-v3 §2.2): Day, Main lift, Variation (only when
 * saved ones exist), Length (any minute, 15–180), Supersets, and the muscle
 * groups (recommended for the day, length and supersets until Ben changes
 * them). `Next: exercises` builds Your workout, or, from `‹ Set up`, merges
 * the change into it. Nothing here computes a rule: the service does.
 */
export function BuilderSetupScreen() {
  const theme = useTheme();
  const services = useServices();
  const changed = useDataChanged();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const params = useRoute<RouteProp<RootStackParams, 'BuilderSetup'>>().params;
  const draftId = params?.draftId ?? null;
  const [setup, setSetup] = useState<SetupInput | null>(null);
  const [facts, setFacts] = useState<SetupFacts | null>(null);
  const [draftVersion, setDraftVersion] = useState<number | null>(null);
  const [sheet, setSheet] = useState<'day' | 'main' | 'variation' | 'group' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // `undo`: a variation Delete's; `restore`: a coach fill's (`Pull · 50 min · supersets on · Undo`, §2.6).
  const [toast, setToast] = useState<{ text: string; undo: { id: string; version: number } | null; restore?: SetupInput } | null>(null);
  const [reach, setReach] = useState<BuilderCoachReach>('not_connected');
  const [speech] = useState(createOnDeviceSpeech);
  const setupRef = useRef<SetupInput | null>(null);
  setupRef.current = setup;
  const [screenReader, setScreenReader] = useState(false);
  useEffect(() => {
    void AccessibilityInfo.isScreenReaderEnabled().then(setScreenReader);
  }, []);
  // With VoiceOver on, an Undo toast stays until dismissed.
  useEffect(() => {
    if (toast === null || screenReader) return;
    const t = setTimeout(() => { setToast(null); }, theme.timing.undoToast);
    return () => { clearTimeout(t); };
  }, [toast, screenReader, theme.timing.undoToast]);
  const nextOp = useRef(newUuid());
  const seq = useRef(0);
  /** The open draft's set-up as stored: its rows stay while Day, Main lift and Variation are unchanged (review B2). */
  const origin = useRef<SetupInput | null>(null);
  const versionRef = useRef<number | null>(null);

  // A fresh Set up (no draft yet): the day's starting rows.
  useEffect(() => {
    if (draftId !== null) return;
    const alive = { current: true };
    // Words asked from Today's bar (§2.0.5): Set up opens filled, with the fill's Undo toast here.
    const filled = takePendingSetupFill();
    if (filled !== null) {
      setSetup(filled.setup);
      setToast({ text: filled.toast, undo: null, restore: filled.undo });
      return;
    }
    void services.builder.initialSetup(params?.dayId === undefined ? {} : { dayId: params.dayId }).then((s) => {
      if (alive.current) setSetup(s);
    });
    return () => {
      alive.current = false;
    };
  }, [services, draftId, params?.dayId]);

  // On every focus: the coach status, and the open draft re-read, so a page under another (the coach
  // sheet, a later Your workout) never sends an old version (review B7).
  useFocusEffect(
    useCallback(() => {
      const alive = { current: true };
      void (async () => {
        const r = await services.builderCoach.status().catch((): BuilderCoachReach => 'not_connected');
        if (alive.current) setReach(r);
        if (draftId === null) return;
        const snap = await services.builder.read(draftId);
        if (!alive.current || snap === null || snap.version === versionRef.current) return;
        versionRef.current = snap.version;
        origin.current = snap.setup;
        setDraftVersion(snap.version);
        setFacts(null);
        setSetup(snap.setup);
      })();
      return () => {
        alive.current = false;
      };
    }, [services, draftId]),
  );

  /**
   * Every change re-reads the facts. Rows follow the loaded template's groups, else the
   * recommendation, until Ben edits them; an open draft's rows stay while its Day, Main lift and
   * Variation are unchanged (`keepGroups`: Ben just chose `Use recommended`).
   */
  const change = useCallback(
    (next: SetupInput, opts: { keepGroups?: boolean } = {}) => {
      setSetup(next);
      const n = (seq.current += 1);
      void services.builder.setupFacts(next).then((f) => {
        if (n !== seq.current) return;
        setFacts(f);
        setSetup((cur) => {
          if (cur === null || opts.keepGroups === true) return cur;
          const o = origin.current;
          if (o !== null && !cur.groupsEdited && sameIdentity(cur, o)) return { ...cur, groups: o.groups.map((g) => ({ ...g })), groupsEdited: o.groupsEdited };
          return withRecommendation(cur, f);
        });
      });
    },
    [services],
  );

  useEffect(() => {
    if (setup !== null && facts === null) change(setup);
  }, [setup, facts, change]);

  // The coach's checked fill applies to these rows at once, with Undo (§2.6); registered while Set up is open.
  useEffect(
    () =>
      registerSetupPage({
        current: () => setupRef.current,
        apply: (next, text, undo) => {
          change(next, { keepGroups: true });
          setToast({ text, undo: null, restore: undo });
        },
      }),
    [change],
  );

  /** Set up's bar: the words fill the rows (the coach's `fill_setup`, or code's reading offline, §9 Q4); never a chat bubble. */
  const ask = useCallback(
    async (words: string) => {
      const r = await services.builderCoach.askSetup({ words, opId: newUuid(), from: 'setup' });
      if (r.status === 'ok' || r.status === 'offline' || r.status === 'not_connected') setReach(r.status);
      switch (r.kind) {
        case 'filled':
          return;
        case 'reply':
          setToast({ text: r.text, undo: null });
          return;
        case 'not_understood':
          setToast({ text: r.line, undo: null });
          return;
        case 'failed':
          setToast({ text: SETUP_COPY.notFilled, undo: null });
      }
    },
    [services],
  );

  if (setup === null) return <View style={{ flex: 1, backgroundColor: theme.colors['bg.canvas'] }} />;
  const mainName = setup.mainLiftExerciseId === null ? null : (facts?.mainLifts.find((m) => m.id === setup.mainLiftExerciseId)?.name ?? null);
  const v = setupView(setup, facts, mainName);

  async function next() {
    if (setup === null || busy || !v.nextEnabled) return;
    setBusy(true);
    setError(null);
    const opId = nextOp.current;
    const r = draftId !== null && draftVersion !== null ? await services.builder.changeSetup(draftId, setup, { opId, expectedVersion: draftVersion }) : await services.builder.create(setup, opId);
    setBusy(false);
    if (r.status === 'written' || r.status === 'replayed') {
      nextOp.current = newUuid();
      changed();
      const toast = r.toast === null ? undefined : { key: opId, text: r.toast.text, undoOpId: r.toast.undoOpId, why: r.toast.why };
      // Back to the one Your workout (or this page becomes it): the builder never stacks pages (review B7).
      navigation.dispatch(builderPage('BuilderWorkout', { draftId: r.snapshot.draftId, ...(toast === undefined ? {} : { toast }) }));
      return;
    }
    setError(r.message);
    // Out of date: the page now shows the draft as stored, and the next tap sends that version.
    if (r.status === 'stale' && r.snapshot !== null) {
      versionRef.current = r.snapshot.version;
      origin.current = r.snapshot.setup;
      setDraftVersion(r.snapshot.version);
      setSetup(r.snapshot.setup);
      setFacts(null);
    }
  }

  /** A variation row's `⋯` (§2.2, Q3): Rename / Delete (`Deleted arms superset · Undo`). */
  const variationMenu = (x: { id: string; label: string; version: number }) => {
    const options = [SETUP_COPY.rename, SETUP_COPY.delete, 'Cancel'];
    ActionSheetIOS.showActionSheetWithOptions({ options, cancelButtonIndex: 2, destructiveButtonIndex: 1, title: x.label }, (i) => {
      if (i === 0) {
        Alert.prompt(SETUP_COPY.rename, undefined, (text) => {
          void services.builder.renameVariation(x.id, text, { opId: newUuid(), expectedVersion: x.version }).then((r) => {
            if (!r.ok) setToast({ text: r.message, undo: null });
            change(setup);
          });
        }, 'plain-text', x.label);
      }
      if (i === 1) {
        void services.builder.deleteVariation(x.id, { opId: newUuid(), expectedVersion: x.version }).then((r) => {
          if (!r.ok) {
            setToast({ text: r.message, undo: null });
            return;
          }
          changed();
          setToast({ text: SETUP_COPY.deleted(r.undo.label), undo: { id: r.undo.id, version: r.undo.version } });
          change(setup.variationId === x.id ? { ...setup, variationId: null } : setup);
        });
      }
    });
  };

  const undoDelete = (u: { id: string; version: number }) => {
    setToast(null);
    void services.builder.undoDeleteVariation(u, newUuid()).then((r) => {
      if (!r.ok) setToast({ text: r.message, undo: null });
      else changed();
      change(setup);
    });
  };

  const pickDay = (d: { id: string; name: string; parts: SetupInput['dayParts'] }) => {
    setSheet(null);
    void services.builder.initialSetup({ dayId: d.id }).then((s) => {
      change({ ...s, minutes: setup.minutes, supersets: setup.supersets });
    });
  };

  return (
    <View style={{ flex: 1, paddingTop: insets.top, backgroundColor: theme.colors['bg.canvas'] }}>
      <Screen
        footer={
          <View style={{ gap: theme.space['2'] }}>
            {v.hint !== null ? <StatusLine icon="info.circle" text={v.hint} tone="info" /> : null}
            {error !== null ? <StatusLine icon="exclamationmark.triangle" text={error} tone="warning" /> : null}
            <PrimaryButton label={SETUP_COPY.next} onPress={() => void next()} disabled={!v.nextEnabled} busy={busy} />
          </View>
        }
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <AppText variant="title1" accessibilityRole="header">
            {SETUP_COPY.title}
          </AppText>
          <TextButton label="Close" tone="secondary" onPress={() => { navigation.goBack(); }} />
        </View>
        <CoachAskBar
          page="setup"
          reach={reach}
          speech={speech}
          onSubmit={(words) => void ask(words)}
          onOpen={(heard) => {
            if (heard !== undefined && heard.trim() !== '') {
              void ask(heard);
              return;
            }
            Alert.prompt(SETUP_COPY.bar, undefined, (text) => {
              if (text.trim() !== '') void ask(text.trim());
            });
          }}
        />
        <Table>
          <ValueRow label={SETUP_COPY.day} value={v.dayValue} onPress={() => { setSheet('day'); }} />
          <Divider />
          <ValueRow label={SETUP_COPY.mainLift} value={v.mainLiftValue} onPress={() => { setSheet('main'); }} />
          {v.variationValue !== null ? (
            <>
              <Divider />
              <ValueRow label={SETUP_COPY.variation} value={v.variationValue} onPress={() => { setSheet('variation'); }} />
            </>
          ) : null}
          <Divider />
          <View style={{ minHeight: 54, flexDirection: 'row', alignItems: 'center', paddingLeft: theme.space['4'], paddingRight: theme.space['2'] }}>
            <AppText variant="body" style={{ flex: 1 }}>
              {SETUP_COPY.length}
            </AppText>
            <Stepper label={SETUP_COPY.length} valueText={v.lengthText} canMinus={v.canShorter} canPlus={v.canLonger} repeat onStep={(d) => { change(stepMinutes(setup, d)); }} />
          </View>
          <Divider />
          <View style={{ minHeight: 54, flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.space['4'] }}>
            <AppText variant="body" style={{ flex: 1 }}>
              {SETUP_COPY.supersets}
            </AppText>
            <Switch accessibilityLabel={SETUP_COPY.supersets} value={v.supersets} onValueChange={(on) => { change({ ...setup, supersets: on }); }} />
          </View>
        </Table>

        <View style={{ gap: theme.space['2'] }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: theme.space['1'] }}>
            <Eyebrow>{SETUP_COPY.groups}</Eyebrow>
            {v.groupsTag.kind === 'tag' ? (
              <AppText variant="label" color="text.secondary">
                {v.groupsTag.text}
              </AppText>
            ) : (
              <TextButton label={v.groupsTag.text} tone="secondary" onPress={() => {
                  if (facts !== null) change(applyRecommended(setup, facts.recommended), { keepGroups: true });
                }}
              />
            )}
          </View>
          <Table>
            {v.groups.map((g) => (
              <View key={g.group}>
                <View style={{ minHeight: 54, flexDirection: 'row', alignItems: 'center', paddingLeft: theme.space['4'], paddingRight: theme.space['2'] }}>
                  <AppText variant="body" style={{ flex: 1 }}>
                    {g.group}
                  </AppText>
                  <Stepper label={g.group} valueText={g.countText} canMinus={g.canMinus} canPlus={g.canPlus} onStep={(d) => { change(stepGroup(setup, g.group, d)); }} />
                </View>
                <Divider />
              </View>
            ))}
            {v.canAddGroup ? <ChoiceRow title={SETUP_COPY.addGroup} onPress={() => { setSheet('group'); }} /> : null}
            <Divider />
            <View style={{ padding: theme.space['4'], gap: theme.space['1'] }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <AppText variant="body">{SETUP_COPY.total}</AppText>
                <AppText variant="body" numeric>
                  {v.totalText}
                </AppText>
              </View>
              {v.recommendedLine !== null ? (
                <AppText variant="label" color="text.secondary" numeric>
                  {v.recommendedLine}
                </AppText>
              ) : null}
            </View>
          </Table>
        </View>
      </Screen>
      <ToastHost bottom={insets.bottom + 96}>
        {toast === null ? null : (
          <Toast
            icon="info.circle"
            text={toast.text}
            {...(toast.undo !== null
              ? { action: 'Undo', onAction: () => { if (toast.undo !== null) undoDelete(toast.undo); } }
              : toast.restore !== undefined
                ? { action: 'Undo', onAction: () => { const back = toast.restore; setToast(null); if (back !== undefined) change(back, { keepGroups: true }); } }
                : {})}
            onDismiss={() => { setToast(null); }}
            showClose={screenReader}
          />
        )}
      </ToastHost>

      <BottomCard visible={sheet === 'day'} onClose={() => { setSheet(null); }}>
        <AppText variant="title2" accessibilityRole="header">
          {SETUP_COPY.day}
        </AppText>
        {facts !== null && facts.days.split.length > 0 ? (
          <>
            <Eyebrow>{SETUP_COPY.yourSplit}</Eyebrow>
            <Table>
              {facts.days.split.map((d) => (
                <ChoiceRow key={d.id} title={d.name} line={d.label} selected={d.id === setup.dayId} onPress={() => { pickDay(d); }} />
              ))}
            </Table>
          </>
        ) : null}
        <Eyebrow>{SETUP_COPY.ppl}</Eyebrow>
        <Table>
          {(facts?.days.ppl ?? []).map((d) => (
            <ChoiceRow key={d.id} title={d.name} line={d.label} selected={d.id === setup.dayId} onPress={() => { pickDay(d); }} />
          ))}
        </Table>
        <Table>
          <ChoiceRow
            title={SETUP_COPY.custom}
            selected={setup.dayId === CUSTOM_DAY_ID}
            onPress={() => {
              setSheet(null);
              change({ ...setup, dayId: CUSTOM_DAY_ID, dayName: SETUP_COPY.custom, dayParts: [], mainLiftExerciseId: null, variationId: null, groups: [], groupsEdited: true });
            }}
          />
        </Table>
      </BottomCard>

      <BottomCard visible={sheet === 'main'} onClose={() => { setSheet(null); }}>
        <AppText variant="title2" accessibilityRole="header">
          {SETUP_COPY.mainLift}
        </AppText>
        <Table>
          {(facts?.mainLifts ?? []).map((m) => (
            <ChoiceRow
              key={m.id}
              title={m.name}
              line={m.fromProfile ? SETUP_COPY.fromProfile : null}
              selected={m.id === setup.mainLiftExerciseId}
              onPress={() => {
                setSheet(null);
                change({ ...setup, mainLiftExerciseId: m.id, variationId: null });
              }}
            />
          ))}
          <ChoiceRow
            title={SETUP_COPY.none}
            selected={setup.mainLiftExerciseId === null}
            onPress={() => {
              setSheet(null);
              change({ ...setup, mainLiftExerciseId: null, variationId: null });
            }}
          />
        </Table>
      </BottomCard>

      <BottomCard visible={sheet === 'variation'} onClose={() => { setSheet(null); }}>
        <AppText variant="title2" accessibilityRole="header">
          {SETUP_COPY.variation}
        </AppText>
        <Table>
          <ChoiceRow
            title={SETUP_COPY.standard}
            selected={setup.variationId === null}
            onPress={() => {
              setSheet(null);
              change({ ...setup, variationId: null });
            }}
          />
          {(facts?.variations ?? []).map((x) => (
            <View key={x.id} style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ flex: 1 }}>
                <ChoiceRow
                  title={x.label}
                  selected={x.id === setup.variationId}
                  onPress={() => {
                    setSheet(null);
                    change({ ...setup, variationId: x.id });
                  }}
                />
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${x.label}, more`}
                accessibilityActions={[{ name: 'rename', label: SETUP_COPY.rename }, { name: 'delete', label: SETUP_COPY.delete }]}
                onAccessibilityAction={(e) => {
                  if (e.nativeEvent.actionName === 'rename' || e.nativeEvent.actionName === 'delete') variationMenu(x);
                }}
                onPress={() => { variationMenu(x); }}
                style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}
              >
                <Icon name="ellipsis" color="text.secondary" />
              </Pressable>
            </View>
          ))}
        </Table>
      </BottomCard>

      <BottomCard visible={sheet === 'group'} onClose={() => { setSheet(null); }}>
        <AppText variant="title2" accessibilityRole="header">
          {SETUP_COPY.groups}
        </AppText>
        <Table>
          {(facts?.addable ?? []).map((g: BuilderGroup) => (
            <ChoiceRow
              key={g}
              title={g}
              onPress={() => {
                setSheet(null);
                change(addGroup(setup, g));
              }}
            />
          ))}
        </Table>
      </BottomCard>
    </View>
  );
}
