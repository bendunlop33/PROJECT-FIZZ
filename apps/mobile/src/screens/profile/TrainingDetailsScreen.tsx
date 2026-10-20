import { useState } from 'react';
import { Switch, View } from 'react-native';

import { cmFromFeetInches, feetInches, LIFT_TARGET_COPY } from '@fizz/domain';
import type { TrainingChange, TrainingProfile, WeightEntry, WeightUnit } from '@fizz/schemas';

import { nowMs as clockNow } from '../../clock';
import { localDateKey } from '../../format/dates';
import { useDataChanged, useScreenData, useServices } from '../../shell/context';
import { birthYearPicker, EXPERIENCE_CHOICES, GENDER_CHOICES, GOAL_CHOICES, heightPicker, readWeightEntry, TRAINING_COPY as C, trainingDetailsView, type TrainingRowKey } from '../../training/training-view';
import { AppText, BottomCard, Chip, ChipRow, CountStepper, Group, PrimaryButton, Row, Screen, SectionHeader, StatusLine, TextButton, TextField, Toast } from '../../ui';

type Editing = TrainingRowKey | 'addWeight' | null;

/**
 * Profile › Training details (Ben 13 Oct: D5, D8): About you, Weight,
 * Training and Self sessions. Values and actions only. Each Save is one
 * versioned write with the sheet's operation ID (a double tap writes once);
 * a stale version reloads (rule 5).
 */
export function TrainingDetailsScreen() {
  const services = useServices();
  const changed = useDataChanged();
  const [data, reload] = useScreenData(async (s) => {
    const [snap, owner] = await Promise.all([s.training.snapshot(), s.yourData.profile()]);
    return { snap, unit: owner?.preferredUnit ?? 'kg' };
  });
  const [editing, setEditing] = useState<Editing>(null);
  const [opId, setOpId] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [undo, setUndo] = useState<WeightEntry | null>(null);

  if (data.state === 'loading') return <Screen>{null}</Screen>;
  if (data.state === 'error' || data.value.snap === null) {
    return (
      <Screen>
        <StatusLine icon="exclamationmark.triangle" tone="warning" text="Couldn’t read training details." action={<TextButton label="Try again" onPress={reload} />} />
      </Screen>
    );
  }
  const { snap, unit } = data.value;
  const p = snap.profile;
  const v = trainingDetailsView(p, { nowYear: snap.nowYear, unit });

  const open = (e: Editing) => {
    setOpId(services.newId());
    setNotice(null);
    setEditing(e);
  };
  const save = async (change: TrainingChange, op = opId, version = p.version): Promise<boolean> => {
    // A new weight entry's ID is the sheet's operation ID, so a retried Save can't add it twice.
    const c: TrainingChange = change.kind === 'add_weight' && change.entry.id === '' ? { ...change, entry: { ...change.entry, id: op } } : change;
    const r = await services.training.change(c, version, op);
    setEditing(null);
    if (!r.ok) setNotice(r.reason === 'stale' ? C.stale : r.reason === 'invalid' ? C.invalid : C.failed);
    changed();
    reload();
    return r.ok;
  };
  // Review S1: a deleted weight comes back with one tap (same entry ID).
  const remove = async (entryId: string) => {
    const entry = p.weights.find((w) => w.id === entryId);
    setUndo(null);
    if (entry !== undefined && (await save({ kind: 'delete_weight', entryId }, services.newId()))) setUndo(entry);
  };
  const restore = (e: WeightEntry) => {
    setUndo(null);
    void save({ kind: 'add_weight', entry: { id: e.id, date: e.date, value: e.value, unit: e.unit } }, services.newId(), p.version);
  };

  return (
    <Screen>
      {notice ? <Toast icon="exclamationmark.triangle" text={notice} onDismiss={() => { setNotice(null); }} /> : null}
      {undo && !notice ? <Toast text={C.deleted} action={C.undo} onAction={() => { restore(undo); }} onDismiss={() => { setUndo(null); }} showClose /> : null}
      <SectionHeader title={C.aboutYou} />
      <Group>
        {v.about.map((r) => (
          <Row key={r.key} title={r.title} subtitle={r.value} onPress={() => { open(r.key); }} />
        ))}
      </Group>

      <SectionHeader title={C.weight} />
      <Group>
        {v.weights.map((w) => (
          <Row
            key={w.id}
            title={w.value}
            subtitle={w.title}
            actions={[{ name: 'delete', label: C.delete }]}
            onAction={() => void remove(w.id)}
            trailing={<TextButton label={C.delete} tone="secondary" accessibilityLabel={`${C.delete} ${w.accessibilityLabel}`} onPress={() => void remove(w.id)} />}
          />
        ))}
        <Row title={C.addWeight} icon="plus" onPress={() => { open('addWeight'); }} />
      </Group>

      <SectionHeader title={C.training} />
      <Group>
        {v.training.map((r) => (
          <Row key={r.key} title={r.title} subtitle={r.value} onPress={() => { open(r.key); }} />
        ))}
        {/* (Ben approved 20 Oct) Lift targets on or off; off hides them everywhere and from the coach. */}
        <Row title={LIFT_TARGET_COPY.setting} trailing={<Switch accessibilityLabel={LIFT_TARGET_COPY.setting} value={p.liftTargetsOn === true} onValueChange={(on) => void save({ kind: 'lift_targets_on', on }, services.newId())} />} />
      </Group>

      <EditSheet editing={editing} profile={p} nowYear={snap.nowYear} unit={unit} today={localDateKey(clockNow(), services.now().tz)} onClose={() => { setEditing(null); }} onSave={(c) => void save(c)} />
    </Screen>
  );
}

function EditSheet({ editing, profile: p, nowYear, unit, today, onClose, onSave }: { editing: Editing; profile: TrainingProfile; nowYear: number; unit: WeightUnit; today: string; onClose: () => void; onSave: (c: TrainingChange) => void }) {
  return (
    <BottomCard visible={editing !== null} onClose={onClose}>
      {editing === null ? null : <SheetBody key={editing} editing={editing} profile={p} nowYear={nowYear} unit={unit} today={today} onClose={onClose} onSave={onSave} />}
    </BottomCard>
  );
}

function SheetBody({ editing, profile: p, nowYear, unit, today, onClose, onSave }: { editing: Exclude<Editing, null>; profile: TrainingProfile; nowYear: number; unit: WeightUnit; today: string; onClose: () => void; onSave: (c: TrainingChange) => void }) {
  const year = birthYearPicker(p.about.birthYear, nowYear);
  const [yearText, setYearText] = useState(String(year.start));
  const [cm, setCm] = useState(p.about.heightCm ?? 175);
  const [weeks, setWeeks] = useState(p.checkInWeeks);
  const [days, setDays] = useState(p.daysPerWeek ?? 3);
  const [minutes, setMinutes] = useState(p.sessionMinutes);
  const [weight, setWeight] = useState('');
  const [weightUnit, setWeightUnit] = useState<WeightUnit>(unit);
  const [date, setDate] = useState(today);
  const footer = (save: (() => void) | null, clear?: () => void) => (
    <View style={{ gap: 8 }}>
      {save ? <PrimaryButton label={C.save} onPress={save} /> : null}
      {clear ? <TextButton label={C.notSet} tone="secondary" onPress={clear} /> : null}
      <TextButton label={C.cancel} tone="secondary" onPress={onClose} />
    </View>
  );
  switch (editing) {
    case 'birthYear': {
      const n = Number(yearText);
      const ok = Number.isInteger(n) && n >= year.min && n <= year.max;
      return (
        <>
          <AppText variant="headline">{C.birthYear}</AppText>
          <CountStepper label={C.birthYear} value={ok ? n : year.start} limits={{ min: year.min, max: year.max }} fewerLabel="Earlier" moreLabel="Later" onChange={(x) => { setYearText(String(x)); }} />
          <TextField accessibilityLabel={C.birthYear} keyboardType="number-pad" maxLength={4} value={yearText} onChangeText={setYearText} />
          {footer(ok ? () => { onSave({ kind: 'birth_year', year: n }); } : null, () => { onSave({ kind: 'birth_year', year: null }); })}
        </>
      );
    }
    case 'gender':
      return (
        <>
          <AppText variant="headline">{C.gender}</AppText>
          <ChipRow>
            {GENDER_CHOICES.map((g) => (
              <Chip key={g.label} label={g.label} selected={(p.about.gender ?? null) === g.value} onPress={() => { onSave({ kind: 'gender', gender: g.value }); }} />
            ))}
          </ChipRow>
          {footer(null)}
        </>
      );
    case 'height': {
      const h = heightPicker(cm);
      const fi = feetInches(cm);
      return (
        <>
          <AppText variant="headline">{C.height}</AppText>
          <AppText variant="body" numeric>
            {h.label}
          </AppText>
          <CountStepper label="cm" value={Math.round(cm)} limits={h.limits} fewerLabel="Shorter" moreLabel="Taller" onChange={setCm} />
          <CountStepper label="in" value={fi.ft * 12 + fi.inch} limits={{ min: 40, max: 98 }} fewerLabel="Shorter" moreLabel="Taller" onChange={(x) => { setCm(cmFromFeetInches(Math.floor(x / 12), x % 12)); }} />
          {footer(() => { onSave({ kind: 'height', cm }); }, () => { onSave({ kind: 'height', cm: null }); })}
        </>
      );
    }
    case 'experience':
      return (
        <>
          <AppText variant="headline">{C.experience}</AppText>
          <ChipRow>
            {EXPERIENCE_CHOICES.map((e) => (
              <Chip key={e.value} label={e.label} selected={p.about.experience === e.value} onPress={() => { onSave({ kind: 'experience', level: e.value }); }} />
            ))}
          </ChipRow>
          {footer(null, () => { onSave({ kind: 'experience', level: null }); })}
        </>
      );
    case 'goal':
      return (
        <>
          <AppText variant="headline">{C.goal}</AppText>
          <ChipRow>
            {GOAL_CHOICES.map((g) => (
              <Chip key={g.value} label={g.label} selected={p.goal === g.value} onPress={() => { onSave({ kind: 'goal', goal: g.value }); }} />
            ))}
          </ChipRow>
          {footer(null, () => { onSave({ kind: 'goal', goal: null }); })}
        </>
      );
    case 'checkIn':
      return (
        <>
          <AppText variant="headline">{C.checkIn}</AppText>
          <CountStepper label="Weeks" value={weeks} limits={{ min: 4, max: 12 }} fewerLabel="Fewer weeks" moreLabel="More weeks" onChange={setWeeks} />
          {footer(() => { onSave({ kind: 'check_in_weeks', weeks }); })}
        </>
      );
    case 'days':
      return (
        <>
          <AppText variant="headline">{C.days}</AppText>
          <CountStepper label="Days" value={days} limits={{ min: 1, max: 7 }} fewerLabel="Fewer days" moreLabel="More days" onChange={setDays} />
          {footer(() => { onSave({ kind: 'days_per_week', days }); }, () => { onSave({ kind: 'days_per_week', days: null }); })}
        </>
      );
    case 'length':
      return (
        <>
          <AppText variant="headline">{C.length}</AppText>
          <CountStepper label="Minutes" value={minutes} limits={{ min: 15, max: 180 }} fewerLabel="5 minutes less" moreLabel="5 minutes more" onChange={(x) => { setMinutes(Math.min(180, Math.max(15, x > minutes ? minutes + 5 : minutes - 5))); }} />
          {footer(() => { onSave({ kind: 'session_minutes', minutes }); })}
        </>
      );
    case 'addWeight': {
      const entry = readWeightEntry(weight, date, today);
      return (
        <>
          <AppText variant="headline">{C.addWeight}</AppText>
          <TextField accessibilityLabel={`Weight in ${weightUnit}`} keyboardType="decimal-pad" placeholder={weightUnit} value={weight} onChangeText={setWeight} autoFocus />
          <ChipRow>
            {(['kg', 'lb'] as const).map((u) => (
              <Chip key={u} label={u} selected={weightUnit === u} onPress={() => { setWeightUnit(u); }} />
            ))}
          </ChipRow>
          <TextField accessibilityLabel="Date" value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" />
          {footer(entry === null ? null : () => { onSave({ kind: 'add_weight', entry: { id: '', date: entry.date, value: entry.value, unit: weightUnit } }); })}
        </>
      );
    }
  }
}
