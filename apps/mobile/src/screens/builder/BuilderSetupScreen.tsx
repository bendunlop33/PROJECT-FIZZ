import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CUSTOM_DAY_ID } from '@fizz/domain';
import type { BuilderGroup } from '@fizz/schemas';

import type { SetupFacts, SetupInput } from '../../builder/builder-service';
import { addGroup, coachBarWord, coachStatusOf, setupView, SETUP_COPY, stepGroup, stepMinutes, applyRecommended, withRecommendation, type CoachBarStatus } from '../../builder/builder-view';
import { newUuid } from '../../device/runtime';
import type { RootStackParams } from '../../navigation/types';
import { useDataChanged, useServices } from '../../shell/context';
import { useTheme } from '../../theme';
import { AppText, BottomCard, Eyebrow, PrimaryButton, Screen, StatusLine, TextButton } from '../../ui';
import { ChoiceRow, CoachBar, Divider, Stepper, Table, ValueRow } from './BuilderParts';

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
  const [coach, setCoach] = useState<CoachBarStatus>('not_connected');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nextOp = useRef(newUuid());
  const seq = useRef(0);

  useEffect(() => {
    const alive = { current: true };
    void (async () => {
      const a = await services.coach.availability().catch(() => null);
      if (alive.current) setCoach(coachStatusOf(a?.status ?? 'not_connected'));
      if (draftId !== null) {
        const snap = await services.builder.read(draftId);
        if (!alive.current || snap === null) return;
        setDraftVersion(snap.version);
        setSetup(snap.setup);
      } else {
        const s = await services.builder.initialSetup(params?.dayId === undefined ? {} : { dayId: params.dayId });
        if (alive.current) setSetup(s);
      }
    })();
    return () => {
      alive.current = false;
    };
  }, [services, draftId, params?.dayId]);

  /** Every change re-reads the facts; rows follow the recommendation until Ben edits them. */
  const change = useCallback(
    (next: SetupInput) => {
      setSetup(next);
      const n = (seq.current += 1);
      void services.builder.setupFacts(next).then((f) => {
        if (n !== seq.current) return;
        setFacts(f);
        setSetup((cur) => (cur === null ? cur : withRecommendation(cur, f.recommended)));
      });
    },
    [services],
  );

  useEffect(() => {
    if (setup !== null && facts === null) change(setup);
  }, [setup, facts, change]);

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
      navigation.navigate('BuilderWorkout', { draftId: r.snapshot.draftId, ...(toast === undefined ? {} : { toast }) });
      return;
    }
    setError(r.message);
  }

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
        <CoachBar
          text={SETUP_COPY.bar}
          statusWord={coachBarWord(coach)}
          disabled={false}
          onOpen={() => { navigation.navigate('Coach', { entry: { kind: 'today' }, focus: true }); }}
          onMic={() => { navigation.navigate('Coach', { entry: { kind: 'today' }, focus: true }); }}
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
                  if (facts !== null) change(applyRecommended(setup, facts.recommended));
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
            <ChoiceRow
              key={x.id}
              title={x.label}
              selected={x.id === setup.variationId}
              onPress={() => {
                setSheet(null);
                change({ ...setup, variationId: x.id });
              }}
            />
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
