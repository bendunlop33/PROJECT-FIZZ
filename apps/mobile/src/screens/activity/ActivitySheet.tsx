import DateTimePicker from '@react-native-community/datetimepicker';
import { useEffect, useRef, useState } from 'react';
import { Pressable, View, type TextInput } from 'react-native';

import { ACTIVITY_COPY, activityRemoveLabel, activityRemovedText, addDays, localDateOf, localDateText, localHourUtcMs, toMs } from '@fizz/domain';
import type { Activity } from '@fizz/schemas';

import { ACTIVITY_EFFORTS, ACTIVITY_KINDS, fieldsOf, formOf, newActivityForm, withDate, type ActivityForm } from '../../activity/activity-form';
import { dateAt } from '../../clock';
import { newUuid } from '../../device/runtime';
import { useServices } from '../../shell/context';
import { useTheme } from '../../theme';
import { AppText, BottomCard, DangerTextButton, KeyboardDoneAccessory, PrimaryButton, StatusLine, TextField } from '../../ui';

import type { ActivitySaved } from '../../activity/activity-toast';

export type { ActivitySaved };

/** How far back or ahead the date wheel goes. */
const DATE_RANGE_DAYS = 60;

/** The Done / Next bar on the time and distance keypads. */
const ACTIVITY_ACCESSORY_ID = 'activity-sheet-numbers';

/**
 * (Ben, 20 Oct) Today › ＋ Activity: a run, ride, swim, sport or other, done
 * or planned, with a date (wheel), a rough time and/or distance (keypad) and
 * an effort. Saved locally at once (rule 1); the toast offers Undo. With an
 * activity, the same sheet edits or removes it: `Cancel run` for a planned
 * one (Ben, 20 Oct: a planned run counts on its date unless he cancels it),
 * `Delete` for one done; both a versioned tombstone with Undo. Values only.
 */
export function ActivitySheet({ visible, activity, onClose, onSaved }: { visible: boolean; activity: Activity | null; onClose: () => void; onSaved: (s: ActivitySaved) => void }) {
  const theme = useTheme();
  const services = useServices();
  const now = services.now();
  const today = localDateOf(toMs(now.utc), now.tz);
  const [form, setForm] = useState<ActivityForm>(() => (activity === null ? newActivityForm(today) : formOf(activity)));
  const [minutesText, setMinutesText] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // One op ID and activity ID per open sheet: a double tap on Save saves once (rule 5).
  const op = useRef(newUuid());
  const newId = useRef(newUuid());
  const distanceField = useRef<TextInput>(null);
  const [focused, setFocused] = useState<'minutes' | 'distance' | null>(null);

  useEffect(() => {
    if (!visible) return;
    const f = activity === null ? newActivityForm(today) : formOf(activity);
    setForm(f);
    setMinutesText(f.minutes === null ? '' : String(f.minutes));
    setMessage(null);
    op.current = newUuid();
    newId.current = newUuid();
  }, [visible, activity?.id, activity?.version]);

  const noon = (date: string) => localHourUtcMs(date, 12, now.tz);

  async function save() {
    const r = fieldsOf(form, today);
    if (!r.ok) {
      setMessage(r.message);
      return;
    }
    setBusy(true);
    const opId = op.current;
    const out = activity === null ? await services.activities.add({ id: newId.current, fields: r.fields, opId }) : await services.activities.edit({ activityId: activity.id, expectedVersion: activity.version, fields: r.fields, opId });
    setBusy(false);
    if (!out.ok) {
      setMessage(out.message);
      return;
    }
    onSaved({ kind: activity === null ? 'added' : 'edited', activityId: out.activity.id, opId });
  }

  async function remove() {
    if (activity === null) return;
    setBusy(true);
    const opId = op.current;
    const out = await services.activities.remove({ activityId: activity.id, expectedVersion: activity.version, opId });
    setBusy(false);
    if (!out.ok) {
      setMessage(out.message);
      return;
    }
    onSaved({ kind: 'deleted', activityId: activity.id, opId, text: activityRemovedText(activity.fields) });
  }

  return (
    <BottomCard
      visible={visible}
      onClose={onClose}
      footer={
        <>
          {message !== null ? <StatusLine icon="exclamationmark.triangle" tone="warning" text={message} /> : null}
          <PrimaryButton label={ACTIVITY_COPY.save} busy={busy} onPress={() => void save()} />
          {activity !== null ? <DangerTextButton label={activityRemoveLabel(activity.fields)} disabled={busy} onPress={() => void remove()} /> : null}
        </>
      }
    >
      <KeyboardDoneAccessory nativeID={ACTIVITY_ACCESSORY_ID} onNext={focused === 'minutes' ? () => distanceField.current?.focus() : null} />
      <AppText variant="title2">{ACTIVITY_COPY.title}</AppText>
      <Chips items={ACTIVITY_KINDS.map((k) => ({ key: k.kind, label: k.label, selected: form.kind === k.kind }))} onPick={(k) => { setForm((f) => ({ ...f, kind: k as ActivityForm['kind'] })); }} />
      <Chips
        items={[
          { key: 'done', label: ACTIVITY_COPY.done, selected: form.status === 'done', disabled: form.date > today },
          { key: 'planned', label: ACTIVITY_COPY.planned, selected: form.status === 'planned' },
        ]}
        onPick={(k) => { setForm((f) => ({ ...f, status: k === 'planned' ? 'planned' : 'done' })); }}
      />
      <AppText variant="callout" color="text.secondary" numeric>
        {localDateText(form.date)}
      </AppText>
      <DateTimePicker
        value={dateAt(noon(form.date))}
        mode="date"
        display="spinner"
        timeZoneName={now.tz}
        minimumDate={dateAt(noon(addDays(today, -DATE_RANGE_DAYS)))}
        maximumDate={dateAt(noon(addDays(today, DATE_RANGE_DAYS)))}
        themeVariant={theme.scheme}
        onValueChange={(_e, date) => {
          setForm((f) => withDate(f, localDateOf(date.getTime(), now.tz), today));
        }}
      />
      <View style={{ flexDirection: 'row', gap: theme.space['3'] }}>
        <View style={{ flex: 1, gap: theme.space['1'] }}>
          <AppText variant="callout" color="text.secondary">{`${ACTIVITY_COPY.duration} (min)`}</AppText>
          <TextField
            accessibilityLabel="Time in minutes"
            keyboardType="number-pad"
            inputAccessoryViewID={ACTIVITY_ACCESSORY_ID}
            onFocus={() => {
              setFocused('minutes');
            }}
            value={minutesText}
            maxLength={4}
            onChangeText={(t) => {
              const digits = t.replace(/\D/g, '');
              setMinutesText(digits);
              setForm((f) => ({ ...f, minutes: digits === '' ? null : Number(digits) }));
            }}
          />
        </View>
        <View style={{ flex: 1, gap: theme.space['1'] }}>
          <AppText variant="callout" color="text.secondary">{`${ACTIVITY_COPY.distance} (km)`}</AppText>
          <TextField
            ref={distanceField}
            accessibilityLabel="Distance in kilometres"
            keyboardType="decimal-pad"
            inputAccessoryViewID={ACTIVITY_ACCESSORY_ID}
            onFocus={() => {
              setFocused('distance');
            }}
            value={form.distanceKm}
            maxLength={7}
            onChangeText={(t) => {
              setForm((f) => ({ ...f, distanceKm: t }));
            }}
          />
        </View>
      </View>
      <Chips
        items={ACTIVITY_EFFORTS.map((e) => ({ key: e.effort, label: e.label, selected: form.effort === e.effort }))}
        onPick={(k) => {
          // A second tap clears it: an effort is only ever Ben's own word.
          setForm((f) => ({ ...f, effort: f.effort === k ? null : (k as ActivityForm['effort']) }));
        }}
      />
    </BottomCard>
  );
}

function Chips({ items, onPick }: { items: readonly { key: string; label: string; selected: boolean; disabled?: boolean }[]; onPick: (key: string) => void }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space['2'] }}>
      {items.map((it) => (
        <Pressable
          key={it.key}
          accessibilityRole="radio"
          accessibilityState={{ selected: it.selected, disabled: it.disabled === true }}
          accessibilityLabel={it.label}
          disabled={it.disabled === true}
          onPress={() => {
            onPick(it.key);
          }}
          style={{
            minHeight: 44,
            paddingHorizontal: theme.space['3'],
            justifyContent: 'center',
            borderRadius: theme.radius.md,
            borderWidth: 1,
            borderColor: it.selected ? theme.colors.accent : theme.colors['border.divider'],
            backgroundColor: it.selected ? theme.colors['bg.raised'] : 'transparent',
            opacity: it.disabled === true ? 0.4 : 1,
          }}
        >
          <AppText variant="callout" color={it.selected ? 'accent' : 'text.primary'}>
            {it.label}
          </AppText>
        </Pressable>
      ))}
    </View>
  );
}
