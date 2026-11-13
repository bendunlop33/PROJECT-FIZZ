import { useState } from 'react';
import { View } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import type { SplitBodyPart, TrainingChange } from '@fizz/schemas';

import { newUuid } from '../../device/runtime';
import { openYourPlan } from '../../navigation/actions';
import { useDataChanged, useScreenData, useServices } from '../../shell/context';
import { bodyPartChoices, customStartDays, splitView, TRAINING_COPY as C } from '../../training/training-view';
import { AppText, BottomCard, ChecklistRow, ChoiceCard, DangerTextButton, Group, PrimaryButton, Row, Screen, SectionHeader, StatusLine, TextButton, TextField, Toast } from '../../ui';

type Sheet = { kind: 'lift'; dayId: string } | { kind: 'day'; dayId: string | null } | null;

/**
 * Profile › Split (Ben 13 Oct: D7; F19): Push/Pull/Legs, Chest/Legs/
 * Shoulders/Back, or Custom (named days with body parts), and each day's main
 * lift (recommended from history, changeable). Used by the Build card and the
 * coach. Each change is one versioned write (rule 5).
 * (D7, Ben 22–23 Oct: one split source) With a plan in use the split is the plan's: `Set by your plan` and `Your plan ›`,
 * nothing to change here (Profile's row opens Library › Your plan instead).
 */
export function SplitScreen() {
  const services = useServices();
  const changed = useDataChanged();
  const navigation = useNavigation();
  // A failed read is never taken for no plan (the editor would change a split the plan owns): the screen says it couldn't read.
  const [planInUse, reloadPlan] = useScreenData((s) => s.plans.inUse().then((x) => x !== null));
  const [data, reloadSplit] = useScreenData((s) => s.training.snapshot());
  const reload = () => {
    reloadPlan();
    reloadSplit();
  };
  const [sheet, setSheet] = useState<Sheet>(null);
  const [opId, setOpId] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [parts, setParts] = useState<SplitBodyPart[]>([]);

  if (data.state === 'loading' || planInUse.state === 'loading') return <Screen>{null}</Screen>;
  if (planInUse.state === 'ready' && planInUse.value) {
    return (
      <Screen>
        <StatusLine icon="info.circle" tone="info" text={C.setByPlan} action={<TextButton label={`${C.yourPlan} ›`} onPress={() => { navigation.dispatch(openYourPlan(newUuid())); }} />} />
      </Screen>
    );
  }
  if (data.state === 'error' || data.value === null || planInUse.state === 'error') {
    return (
      <Screen>
        <StatusLine icon="exclamationmark.triangle" tone="warning" text="Couldn’t read the split." action={<TextButton label="Try again" onPress={reload} />} />
      </Screen>
    );
  }
  const snap = data.value;
  const v = splitView(snap.profile, snap.mainLifts);
  const current = customStartDays(snap.profile);

  const save = async (change: TrainingChange, op = services.newId()) => {
    const r = await services.training.change(change, snap.profile.version, op);
    setSheet(null);
    if (!r.ok) setNotice(r.reason === 'stale' ? C.stale : r.reason === 'invalid' ? C.invalid : C.failed);
    changed();
    reload();
  };
  const openDay = (dayId: string | null) => {
    const d = current.find((x) => x.id === dayId);
    setName(d?.name ?? '');
    setParts(d?.bodyParts ?? []);
    setOpId(services.newId());
    setSheet({ kind: 'day', dayId });
  };
  const saveDay = (dayId: string | null) => {
    const days = dayId === null ? [...current, { id: opId, name, bodyParts: parts }] : current.map((d) => (d.id === dayId ? { ...d, name, bodyParts: parts } : d));
    void save({ kind: 'custom_split', days }, opId);
  };

  return (
    <Screen>
      {notice ? <Toast icon="exclamationmark.triangle" text={notice} onDismiss={() => { setNotice(null); }} /> : null}
      <View style={{ gap: 8 }}>
        {v.choices.map((c) => (
          <ChoiceCard
            key={c.kind}
            title={c.label}
            selected={c.selected}
            onPress={() => {
              if (c.selected) return;
              void save(c.kind === 'custom' ? { kind: 'custom_split', days: current } : { kind: 'preset_split', split: c.kind });
            }}
          />
        ))}
      </View>

      <SectionHeader title={C.mainLift.toUpperCase()} />
      <Group>
        {v.days.map((d) => (
          <Row
            key={d.id}
            title={d.name}
            subtitle={d.mainLiftNote === null ? d.mainLift : `${d.mainLift} · ${d.mainLiftNote}`}
            secondLine={d.bodyParts}
            onPress={() => {
              setOpId(services.newId());
              setSheet({ kind: 'lift', dayId: d.id });
            }}
            {...(v.editable ? { trailing: <TextButton label="Edit" accessibilityLabel={`Edit ${d.name}`} onPress={() => { openDay(d.id); }} /> } : {})}
          />
        ))}
        {v.canAddDay ? <Row title={C.addDay} icon="plus" onPress={() => { openDay(null); }} /> : null}
      </Group>

      <BottomCard
        visible={sheet !== null}
        onClose={() => { setSheet(null); }}
        footer={
          sheet?.kind === 'lift' ? (
            <>
              <TextButton label={C.useRecommended} tone="secondary" onPress={() => void save({ kind: 'main_lift', dayId: sheet.dayId, exerciseId: null }, opId)} />
              <TextButton label={C.cancel} tone="secondary" onPress={() => { setSheet(null); }} />
            </>
          ) : sheet?.kind === 'day' ? (
            <>
              <PrimaryButton label={C.save} disabled={name.trim() === '' || parts.length === 0} onPress={() => { saveDay(sheet.dayId); }} />
              {sheet.dayId !== null && current.length > 1 ? <DangerTextButton label={C.removeDay} onPress={() => void save({ kind: 'custom_split', days: current.filter((d) => d.id !== sheet.dayId) }, opId)} /> : null}
              <TextButton label={C.cancel} tone="secondary" onPress={() => { setSheet(null); }} />
            </>
          ) : null
        }
      >
        {sheet?.kind === 'lift' ? (
          <>
            <AppText variant="headline">{`${C.mainLift} · ${v.days.find((d) => d.id === sheet.dayId)?.name ?? ''}`}</AppText>
            <Group>
              {(snap.options[sheet.dayId] ?? []).map((o) => (
                <Row key={o.id} title={o.name} {...(snap.mainLifts[sheet.dayId]?.exerciseId === o.id ? { subtitle: snap.mainLifts[sheet.dayId]?.source === 'recommended' ? C.recommended : 'Current' } : {})} onPress={() => void save({ kind: 'main_lift', dayId: sheet.dayId, exerciseId: o.id }, opId)} />
              ))}
            </Group>
          </>
        ) : null}
        {sheet?.kind === 'day' ? (
          <>
            <TextField accessibilityLabel={C.dayName} placeholder={C.dayName} maxLength={30} value={name} onChangeText={setName} />
            <AppText variant="sectionLabel" color="text.secondary">
              {C.bodyParts}
            </AppText>
            <View>
              {bodyPartChoices(parts).map((b) => (
                <ChecklistRow key={b.part} title={b.part} checked={b.checked} onToggle={() => { setParts((ps) => (ps.includes(b.part) ? ps.filter((x) => x !== b.part) : [...ps, b.part])); }} />
              ))}
            </View>
          </>
        ) : null}
      </BottomCard>
    </Screen>
  );
}
