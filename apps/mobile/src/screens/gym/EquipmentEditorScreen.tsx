import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useEffect, useMemo, useRef, useState, type Ref } from 'react';
import { Alert, Pressable, TextInput, View } from 'react-native';

import {
  applyEquipmentForm,
  BENCH_TYPE_LABEL,
  checkLoadText,
  dumbbellLoads,
  EQUIPMENT_KIND_LABEL,
  formatNumber,
  formFromEquipment,
  gapLines,
  loadPreviewLine,
  newEquipmentForm,
  RACK_TYPE_LABEL,
  rangeValues,
  unbalancedPlateHints,
  type EquipmentForm,
  type RangeSpec,
} from '@fizz/domain';
import type { BenchType, EquipmentInstance, PlateCount, RackType, WeightUnit } from '@fizz/schemas';

import { haptic } from '../../device/haptics';
import type { ProfileStackParams } from '../../navigation/types';
import { useDataChanged, useServices } from '../../shell/context';
import { useTheme } from '../../theme';
import { AppText, Chip, ChipRow, Icon, InfoLine, KeyboardDoneAccessory, NumberAccessory, NUMBER_ACCESSORY_ID, PrimaryButton, Screen, SectionHeader, StatusLine, TextButton, Toast } from '../../ui';
import { nextFieldText, parseNumber, rangeNextField } from '../../ui/number-text';

/**
 * Equipment editor, minimal (gym-editor.md §2.4): enough for rule 4 to be
 * true of Ben's real gym. Barbell: bar weight, every plate counted, optional
 * max. Dumbbells: range and step, missing weights, single weights. Stacks and
 * assisted machines: range and step (as printed). Plate-loaded: sides, plates,
 * max. EZ bar, trap bar and Smith machine as a barbell (ADR 0030); kettlebells
 * as dumbbells; a bench or rack is its type only. Every number and line comes from `@fizz/domain`; Save is one versioned,
 * idempotent write. The unit can't change once a set was logged with the item.
 */
export function EquipmentEditorScreen() {
  const theme = useTheme();
  const services = useServices();
  const changed = useDataChanged();
  const navigation = useNavigation();
  const { gymId, equipmentId, kind, isNew } = useRoute<RouteProp<ProfileStackParams, 'EquipmentEditor'>>().params;
  const [loaded, setLoaded] = useState<{ base: EquipmentInstance | null; unitLocked: boolean; unit: WeightUnit; ownerId: string } | null>(null);
  const [form, setForm] = useState<EquipmentForm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null);
  const [check, setCheck] = useState('');

  useEffect(() => {
    void (async () => {
      const profile = await services.yourData.profile();
      const unit = profile?.preferredUnit ?? 'kg';
      if (isNew) {
        setLoaded({ base: null, unitLocked: false, unit, ownerId: profile?.id ?? '' });
        setForm(newEquipmentForm(kind, unit));
        return;
      }
      const item = await services.gyms.item(equipmentId);
      if (!item) {
        setError('This item wasn’t found.');
        return;
      }
      setLoaded({ base: item.equipment, unitLocked: item.unitLocked, unit: item.equipment.unit, ownerId: item.equipment.ownerId });
      setForm(formFromEquipment(item.equipment));
    })();
  }, [services, equipmentId, isNew, kind]);

  // The same validation Save runs, so the preview and `Fix n problems` never disagree with it.
  const result = useMemo(() => (form && loaded ? applyEquipmentForm(form, loaded.base, { id: equipmentId, ownerId: loaded.ownerId, gymId, atUtc: services.now().utc }) : null), [form, loaded, equipmentId, gymId, services]);

  if (error !== null && form === null) {
    return (
      <Screen>
        <StatusLine icon="exclamationmark.triangle" tone="warning" text={error} />
      </Screen>
    );
  }
  if (form === null || loaded === null) return <Screen>{null}</Screen>;
  const f = form;
  const u = f.unit;
  const set = (patch: Partial<EquipmentForm>) => {
    setForm({ ...f, ...patch } as EquipmentForm);
  };
  const problems = result && !result.ok ? result.problems : [];

  async function save() {
    if (busy || problems.length > 0) return;
    setBusy(true);
    setError(null);
    const r = await services.gyms.save({ gymId, equipmentId, expectedVersion: loaded?.base?.version ?? null, form: f });
    setBusy(false);
    if (!r.ok) {
      setError(r.reason === 'invalid' ? r.problems.join(' ') : r.message);
      return;
    }
    haptic('commit');
    changed();
    const prev = r.previous;
    setLoaded({ base: r.equipment, unitLocked: loaded?.unitLocked ?? false, unit: r.equipment.unit, ownerId: r.equipment.ownerId });
    setToast({
      text: 'Saved',
      ...(prev
        ? {
            undo: () => {
              void services.gyms.undoSave(r.equipment, prev).then((ok) => {
                setToast({ text: ok ? 'Change undone' : 'Can’t undo: it changed again.' });
                changed();
                if (ok) navigation.goBack();
              });
            },
          }
        : {}),
    });
    if (!prev) navigation.goBack();
  }

  const preview = result?.ok ? result.equipment : null;
  return (
    <View style={{ flex: 1 }}>
      <NumberAccessory />
      <Screen
        toast={toast ? <Toast text={toast.text} {...(toast.undo ? { action: 'Undo', onAction: toast.undo } : {})} /> : null}
        footer={
          <PrimaryButton
            label={busy ? 'Saving…' : problems.length === 0 ? 'Save' : `Fix ${String(problems.length)} ${problems.length === 1 ? 'problem' : 'problems'}`}
            disabled={problems.length > 0}
            busy={busy}
            onPress={() => void save()}
          />
        }
      >
        <AppText variant="title2" accessibilityRole="header">
          {EQUIPMENT_KIND_LABEL[f.kind]}
        </AppText>
        <TextField label="Name" value={f.name} onChange={(name) => { set({ name }); }} />

        <View style={{ gap: theme.space['2'] }}>
          <AppText variant="label" color="text.secondary">
            Unit
          </AppText>
          <ChipRow>
            {(['kg', 'lb'] as const).map((unit) => (
              <Chip
                key={unit}
                label={unit}
                selected={u === unit}
                onPress={() => {
                  if (loaded.unitLocked && unit !== loaded.unit) {
                    Alert.alert('Unit is locked', `Has ${loaded.unit} sets. Add new equipment for ${unit}.`);
                    return;
                  }
                  set({ unit });
                }}
              />
            ))}
          </ChipRow>
          {loaded.unitLocked ? (
            <AppText variant="callout" color="text.secondary">{`Has ${loaded.unit} sets. Add new equipment for ${loaded.unit === 'kg' ? 'lb' : 'kg'}.`}</AppText>
          ) : null}
        </View>

        {f.kind === 'barbell' || f.kind === 'ez_bar' || f.kind === 'trap_bar' || f.kind === 'smith_machine' ? (
          <>
            <NumberField label={f.kind === 'smith_machine' ? 'Bar starting weight' : 'Bar weight'} unit={u} value={f.barMass} onChange={(barMass) => { set({ barMass }); }} />
            <PlatesEditor plates={f.plates} unit={u} sides={2} onChange={(plates) => { set({ plates }); }} />
            {f.kind === 'smith_machine' ? (
              <NumberField label="Most plates it takes (optional)" unit={`${u} of plates`} value={f.maxLoad} onChange={(maxLoad) => { set({ maxLoad }); }} />
            ) : (
              <NumberField label="Heaviest you’ll load (optional)" unit={u} value={f.maxLoad} onChange={(maxLoad) => { set({ maxLoad }); }} />
            )}
          </>
        ) : null}

        {f.kind === 'plate_loaded_machine' ? (
          <>
            <View style={{ gap: theme.space['2'] }}>
              <AppText variant="label" color="text.secondary">
                Plates go on
              </AppText>
              <ChipRow>
                <Chip label="Both sides, balanced" selected={f.loadingSides === 2} onPress={() => { set({ loadingSides: 2 }); }} />
                <Chip label="One horn" selected={f.loadingSides === 1} onPress={() => { set({ loadingSides: 1 }); }} />
              </ChipRow>
            </View>
            <PlatesEditor plates={f.plates} unit={u} sides={f.loadingSides} onChange={(plates) => { set({ plates }); }} />
            <NumberField label="Most plates it takes (optional)" unit={`${u} of plates`} value={f.maxLoad} onChange={(maxLoad) => { set({ maxLoad }); }} />
            <AppText variant="callout" color="text.secondary">
              Logged as plates added
            </AppText>
          </>
        ) : null}

        {f.kind === 'dumbbells' || f.kind === 'kettlebell' ? (
          <>
            <AppText variant="callout" color="text.secondary">
              {f.kind === 'kettlebell' ? 'Weights are per kettlebell.' : 'Weights are per dumbbell.'}
            </AppText>
            <RangeFields range={f.range} unit={u} onChange={(range) => { set({ range }); }} />
            <SectionHeader title="In the rack (tap any that are missing)" />
            <ChipRow>
              {rangeValues(f.range).map((v) => {
                const missing = f.missing.includes(v);
                return (
                  <Chip
                    key={v}
                    label={missing ? `${formatNumber(v)} missing` : formatNumber(v)}
                    accessibilityLabel={`${formatNumber(v)} ${u}, ${missing ? 'missing' : 'in the rack'}`}
                    selected={!missing}
                    onPress={() => {
                      set({ missing: missing ? f.missing.filter((m) => m !== v) : [...f.missing, v] });
                    }}
                  />
                );
              })}
              {f.extra.map((v) => (
                <Chip key={`x${String(v)}`} label={`${formatNumber(v)} (single)`} selected onPress={() => { set({ extra: f.extra.filter((x) => x !== v) }); }} accessibilityLabel={`${formatNumber(v)} ${u}, single weight. Tap to remove.`} />
              ))}
            </ChipRow>
            <AddValue label="Add a single weight" unit={u} onAdd={(v) => { set({ extra: [...f.extra, v] }); }} />
            <AppText variant="callout" color="text.secondary" numeric>{`${String(dumbbellLoads(f).length)} weights in the rack`}</AppText>
          </>
        ) : null}

        {f.kind === 'weight_stack' || f.kind === 'assisted_stack' ? (
          <>
            {/* Design pass 6.10: one short line; the assisted explanation behind ⓘ. */}
            <InfoLine text={f.kind === 'weight_stack' ? 'As printed on the stack' : 'Assistance, as printed'} variant="callout" {...(f.kind === 'assisted_stack' ? { info: 'More assistance is easier. In a workout, + adds assistance.', infoLabel: 'About assistance' } : {})} />
            {f.irregular ? (
              <StatusLine
                icon="info.circle"
                tone="info"
                text={`Uneven stack kept as saved: ${f.irregular.map(formatNumber).join(', ')} ${u}.`}
                detail="Edit the range below to replace it with an even one."
              />
            ) : null}
            <RangeFields range={f.range} unit={u} onChange={(range) => { set({ range, irregular: null }); }} />
          </>
        ) : null}

        {f.kind === 'bench' ? (
          <ChipRow>
            {(Object.keys(BENCH_TYPE_LABEL) as BenchType[]).map((t) => (
              <Chip key={t} label={BENCH_TYPE_LABEL[t]} selected={f.benchType === t} onPress={() => { set({ benchType: t }); }} />
            ))}
          </ChipRow>
        ) : null}

        {f.kind === 'rack' ? (
          <ChipRow>
            {(Object.keys(RACK_TYPE_LABEL) as RackType[]).map((t) => (
              <Chip key={t} label={RACK_TYPE_LABEL[t]} selected={f.rackType === t} onPress={() => { set({ rackType: t }); }} />
            ))}
          </ChipRow>
        ) : null}

        {f.kind === 'bodyweight_station' ? (
          <AppText variant="callout" color="text.secondary">
            Logged as bodyweight
          </AppText>
        ) : null}

        {preview ? (
          <View style={{ gap: theme.space['1'] }}>
            <AppText variant="body" numeric>
              {loadPreviewLine(preview)}
            </AppText>
            {gapLines(preview).map((g) => (
              <AppText key={g} variant="callout" color="text.secondary" numeric>
                {g}
              </AppText>
            ))}
          </View>
        ) : null}
        {'plates' in f
          ? unbalancedPlateHints(f.plates, f.kind === 'plate_loaded_machine' ? f.loadingSides : 2, u).map((hint) => (
              <AppText key={hint} variant="callout" color="text.secondary">
                {hint}
              </AppText>
            ))
          : null}
        {preview && 'plates' in preview ? (
          <View style={{ gap: theme.space['1'] }}>
            <TextField label={`Check a load (${u})`} value={check} numeric onChange={setCheck} />
            {parseNumber(check) !== null ? (
              <AppText variant="callout" numeric>
                {checkLoadText(preview, parseNumber(check) ?? 0)}
              </AppText>
            ) : null}
          </View>
        ) : null}
        {problems.map((p) => (
          <StatusLine key={p} icon="exclamationmark.triangle" tone="warning" text={p} />
        ))}
        {error ? <StatusLine icon="exclamationmark.triangle" tone="warning" text={error} /> : null}
      </Screen>
    </View>
  );
}

function TextField({ label, value, onChange, numeric = false, inputRef, onFocus, accessoryId = NUMBER_ACCESSORY_ID }: { label: string; value: string; onChange: (v: string) => void; numeric?: boolean; inputRef?: Ref<TextInput>; onFocus?: () => void; accessoryId?: string }) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.space['1'] }}>
      <AppText variant="label" color="text.secondary">
        {label}
      </AppText>
      <TextInput
        value={value}
        onChangeText={onChange}
        accessibilityLabel={label}
        maxLength={120}
        {...(numeric ? { keyboardType: 'decimal-pad' as const, inputAccessoryViewID: accessoryId } : {})}
        {...(inputRef ? { ref: inputRef } : {})}
        {...(onFocus ? { onFocus } : {})}
        maxFontSizeMultiplier={theme.type.body.maxFontSizeMultiplier}
        style={{
          minHeight: 52,
          paddingHorizontal: theme.space['3'],
          borderRadius: theme.radius.sm,
          borderWidth: 1,
          borderColor: theme.colors['border.control'],
          backgroundColor: theme.colors['bg.raised'],
          color: theme.colors['text.primary'],
          fontSize: theme.type.body.fontSize,
          fontVariant: ['tabular-nums'],
        }}
      />
    </View>
  );
}

/** A number field that keeps partial typing (`2.`) and shows the value otherwise. */
function NumberField({ label, unit, value, onChange, inputRef, onFocus, accessoryId }: { label: string; unit: string; value: number | null; onChange: (v: number | null) => void; inputRef?: Ref<TextInput>; onFocus?: () => void; accessoryId?: string }) {
  const [text, setText] = useState(value === null ? '' : String(value));
  useEffect(() => {
    setText((t) => nextFieldText(t, value));
  }, [value]);
  return (
    <TextField
      label={`${label} · ${unit}`}
      value={text}
      numeric
      {...(inputRef ? { inputRef } : {})}
      {...(onFocus ? { onFocus } : {})}
      {...(accessoryId ? { accessoryId } : {})}
      onChange={(t) => {
        setText(t);
        onChange(parseNumber(t));
      }}
    />
  );
}

/** The range's own `Next ›` bar (design pass 6.12): From → To → Every without the keypad dropping. */
const RANGE_ACCESSORY_ID = 'fizz-range-next';

function RangeFields({ range, unit, onChange }: { range: RangeSpec; unit: string; onChange: (r: RangeSpec) => void }) {
  const theme = useTheme();
  const refs = [useRef<TextInput>(null), useRef<TextInput>(null), useRef<TextInput>(null)] as const;
  const [focused, setFocused] = useState(0);
  const next = rangeNextField(focused);
  const field = (i: 0 | 1 | 2, label: string, value: number | null, set: (v: number | null) => void) => (
    <View style={{ flex: 1, minWidth: 90 }}>
      <NumberField label={label} unit={unit} value={value} inputRef={refs[i]} accessoryId={RANGE_ACCESSORY_ID} onFocus={() => { setFocused(i); }} onChange={set} />
    </View>
  );
  return (
    <View style={{ flexDirection: 'row', gap: theme.space['2'], flexWrap: 'wrap' }}>
      {field(0, 'From', range.from, (from) => { onChange({ ...range, from }); })}
      {field(1, 'To', range.to, (to) => { onChange({ ...range, to }); })}
      {field(2, 'Every', range.step, (step) => { onChange({ ...range, step }); })}
      <KeyboardDoneAccessory nativeID={RANGE_ACCESSORY_ID} onNext={next === null ? null : () => refs[next].current?.focus()} />
    </View>
  );
}

function AddValue({ label, unit, onAdd }: { label: string; unit: string; onAdd: (v: number) => void }) {
  const theme = useTheme();
  const [text, setText] = useState('');
  const v = parseNumber(text);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: theme.space['2'] }}>
      <View style={{ flex: 1 }}>
        <TextField label={`${label} (${unit})`} value={text} numeric onChange={setText} />
      </View>
      <TextButton
        label="Add"
        disabled={v === null || v <= 0}
        onPress={() => {
          if (v !== null && v > 0) onAdd(v);
          setText('');
        }}
      />
    </View>
  );
}

/** Plate counts (physical plates, not pairs) with the derived `2 a side` (gym-editor §2.4.1). */
function PlatesEditor({ plates, unit, sides, onChange }: { plates: PlateCount[]; unit: WeightUnit; sides: 1 | 2; onChange: (p: PlateCount[]) => void }) {
  const theme = useTheme();
  const sorted = [...plates].sort((a, b) => b.mass - a.mass);
  const setCount = (mass: number, count: number) => {
    onChange(sorted.map((p) => (p.mass === mass ? { mass, count: Math.max(0, Math.min(200, count)) } : p)));
  };
  return (
    <View style={{ gap: theme.space['2'] }}>
      <SectionHeader title="Plates · count every plate" />
      {sorted.map((p) => (
        <View key={p.mass} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'], minHeight: 52 }}>
          <AppText variant="body" numeric style={{ flex: 1 }}>{`${formatNumber(p.mass)} ${unit}`}</AppText>
          <CountButton icon="minus" label={`Fewer ${formatNumber(p.mass)} ${unit} plates`} disabled={p.count === 0} onPress={() => { setCount(p.mass, p.count - 1); }} />
          <AppText variant="headline" numeric style={{ minWidth: 32, textAlign: 'center' }} accessibilityLabel={`${String(p.count)} plates`}>
            {String(p.count)}
          </AppText>
          <CountButton icon="plus" label={`More ${formatNumber(p.mass)} ${unit} plates`} onPress={() => { setCount(p.mass, p.count + 1); }} />
          {sides === 2 ? (
            <AppText variant="callout" color="text.secondary" numeric style={{ minWidth: 72, textAlign: 'right' }}>{`${String(Math.floor(p.count / 2))} a side`}</AppText>
          ) : null}
        </View>
      ))}
      <AddValue
        label="Add plate size"
        unit={unit}
        onAdd={(mass) => {
          if (!sorted.some((p) => p.mass === mass)) onChange([...sorted, { mass, count: 2 }]);
        }}
      />
    </View>
  );
}

function CountButton({ icon, label, onPress, disabled = false }: { icon: 'plus' | 'minus'; label: string; onPress: () => void; disabled?: boolean }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: theme.radius.sm,
        borderWidth: 1,
        borderColor: theme.colors['border.control'],
        backgroundColor: pressed ? theme.colors['accent.subtle'] : theme.colors['bg.raised'],
        opacity: disabled ? 0.4 : 1,
      })}
    >
      <Icon name={icon} color="text.primary" size={18} />
    </Pressable>
  );
}
