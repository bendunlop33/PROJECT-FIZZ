import { useRoute, type RouteProp } from '@react-navigation/native';
import { useState, type ReactNode } from 'react';
import { TextInput, View } from 'react-native';

import type { AnswerChange } from '@fizz/domain';

import { bodyweightOptions, longDate, perHandOptions, totalOptions, type BarWeightView, type OptionView } from '../../import/views';
import type { ProfileStackParams } from '../../navigation/types';
import { useDataChanged, useScreenData, useServices } from '../../shell/context';
import { useTheme } from '../../theme';
import { parseNumber } from '../../ui/number-text';
import { AppText, ChecklistRow, ChoiceCard, Group, Screen, SectionHeader, StatusLine, TextButton } from '../../ui';

/**
 * One import question (data-import-export §2.5 steps 3b–3c): dumbbell and
 * barbell conventions (one answer for the group, per-exercise overrides),
 * a bodyweight exercise with weights, the weight unit for rows with both
 * columns, effort ratings in comments, dates already in GymSmarter, and the
 * gym. Convention questions start with nothing selected (DX6). Each change
 * is saved at once (versioned) and the preview updates.
 */
export function ImportQuestionScreen() {
  const theme = useTheme();
  const services = useServices();
  const changed = useDataChanged();
  const { draftId, question, key } = useRoute<RouteProp<ProfileStackParams, 'ImportQuestion'>>().params;
  const [error, setError] = useState<string | null>(null);
  const [data] = useScreenData((s) => s.imports.draft(draftId));
  if (data.state !== 'ready' || !data.value) return <Screen>{null}</Screen>;
  const draft = data.value;
  const a = draft.analysis;

  async function answer(change: AnswerChange) {
    setError(null);
    const r = await services.imports.answer(draftId, draft.mappingVersion, change);
    if (!r.ok) setError(r.reason === 'invalid' ? r.message : 'The preview changed. Check the answer again.');
    changed();
  }

  const options = <A extends string>(list: readonly OptionView<A>[], onPick: (v: A) => AnswerChange) =>
    list.map((o) => <ChoiceCard key={o.value} title={o.label} subtitle={o.detail} selected={o.selected} onPress={() => void answer(onPick(o.value))} />);

  const overrides = <A extends string>(exercises: readonly { key: string; name: string; override: A | null }[], choices: readonly { value: A; label: string }[], onPick: (k: string, v: A | null) => AnswerChange): ReactNode =>
    exercises.length < 2 ? null : (
      <>
        <SectionHeader title="Different for some?" />
        {exercises.map((e) => (
          <View key={e.key} style={{ gap: theme.space['1'] }}>
            <AppText variant="body">{e.name}</AppText>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space['2'] }}>
              <TextButton label={e.override === null ? '✓ Same' : 'Same'} tone={e.override === null ? 'accent' : 'secondary'} onPress={() => void answer(onPick(e.key, null))} />
              {choices.map((c) => (
                <TextButton key={c.value} label={e.override === c.value ? `✓ ${c.label}` : c.label} tone={e.override === c.value ? 'accent' : 'secondary'} onPress={() => void answer(onPick(e.key, c.value))} />
              ))}
            </View>
          </View>
        ))}
      </>
    );

  let body: ReactNode = <AppText variant="body">This question no longer applies.</AppText>;
  switch (question) {
    case 'per_hand': {
      const q = perHandOptions(a);
      if (q && a.perHand) {
        body = (
          <>
            <AppText variant="body">{q.lead}</AppText>
            <AppText variant="headline">{q.question}</AppText>
            {options(q.options, (v) => ({ kind: 'per_hand', answer: v }))}
            {q.example ? <AppText variant="callout" color="text.secondary">{q.example}</AppText> : null}
            {overrides(a.perHand.exercises, [{ value: 'each', label: 'Each' }, { value: 'both', label: 'Both together' }], (k, v) => ({ kind: 'per_hand_override', key: k, answer: v }))}
          </>
        );
      }
      break;
    }
    case 'total': {
      const q = totalOptions(a);
      if (q && a.total) {
        body = (
          <>
            <AppText variant="body">{q.lead}</AppText>
            <AppText variant="headline">{q.question}</AppText>
            {options(q.options, (v) => ({ kind: 'total', answer: v }))}
            {q.barWeights.map((b) => (
              <BarWeightField key={`${b.bar}-${b.unit}`} field={b} onSave={(value) => void answer({ kind: 'bar_weight', bar: b.bar, unit: b.unit, value })} />
            ))}
            {q.example ? <AppText variant="callout" color="text.secondary">{q.example}</AppText> : null}
            {overrides(a.total.exercises, [{ value: 'total', label: 'Total' }, { value: 'plates_only', label: 'Plates only' }], (k, v) => ({ kind: 'total_override', key: k, answer: v }))}
          </>
        );
      }
      break;
    }
    case 'bodyweight': {
      const q = key === undefined ? null : bodyweightOptions(a, key);
      if (q && key !== undefined) {
        body = (
          <>
            <AppText variant="headline">{q.question}</AppText>
            <AppText variant="callout" color="text.secondary">
              {q.range}
            </AppText>
            {options(q.options, (v) => ({ kind: 'bodyweight', key, answer: v }))}
          </>
        );
      }
      break;
    }
    case 'unit':
      if (a.unit) {
        const unit = a.unit;
        body = (
          <>
            <AppText variant="body">{`${String(unit.rows)} ${unit.rows === 1 ? 'row has values' : 'rows have values'} in both the kg and lb columns. Which did you enter in FitNotes?`}</AppText>
            {(['kg', 'lb'] as const).map((u) => (
              <ChoiceCard key={u} title={u} selected={unit.answer === u} onPress={() => void answer({ kind: 'both_columns', answer: u })} />
            ))}
            <AppText variant="callout" color="text.secondary">
              The other column is kept with each row as the original.
            </AppText>
          </>
        );
      }
      break;
    case 'effort': {
      const c = a.effort.candidates;
      body = (
        <>
          <AppText variant="body">{`${String(c.length)} ${c.length === 1 ? 'comment looks' : 'comments look'} like effort ratings, for example “@8” or “RPE 9”.`}</AppText>
          <ChoiceCard title="Keep as notes only" selected={a.effort.mode === 'notes_only'} onPress={() => void answer({ kind: 'effort_mode', mode: 'notes_only' })} />
          <ChoiceCard title="Review and import as RPE" subtitle="Only the rows you tick get an RPE. The comment is kept either way." selected={a.effort.mode === 'review'} onPress={() => void answer({ kind: 'effort_mode', mode: 'review' })} />
          {a.effort.mode === 'review' ? (
            <>
              <TextButton label="Select all" onPress={() => void answer({ kind: 'effort_rows', rows: c.map((x) => x.row), checked: true })} />
              <Group>
                {c.map((x) => (
                  <ChecklistRow
                    key={x.row}
                    title={`“${x.comment}” → RPE ${String(x.rpe)}`}
                    tag={`${longDate(x.date)} · ${x.name} · row ${String(x.row)}`}
                    checked={x.checked}
                    onToggle={() => void answer({ kind: 'effort_rows', rows: [x.row], checked: !x.checked })}
                  />
                ))}
              </Group>
            </>
          ) : null}
        </>
      );
      break;
    }
    case 'dates':
      body = (
        <>
          <AppText variant="body">{`${String(a.appDates.count)} ${a.appDates.count === 1 ? 'date already has' : 'dates already have'} a workout logged in GymSmarter${a.appDates.newest ? ` (newest: ${longDate(a.appDates.newest)})` : ''}.`}</AppText>
          <ChoiceCard title="Skip those dates" subtitle="Same as FitNotes 2 does" selected={draft.answers.existingDates === 'skip'} onPress={() => void answer({ kind: 'existing_dates', answer: 'skip' })} />
          <ChoiceCard title="Import them as extra workouts" selected={draft.answers.existingDates === 'import'} onPress={() => void answer({ kind: 'existing_dates', answer: 'import' })} />
        </>
      );
      break;
    case 'gym':
      body = (
        <>
          <ChoiceCard title="Not recorded" subtitle="Don’t assume a gym" selected={draft.answers.gymId === null} onPress={() => void answer({ kind: 'gym', gymId: null })} />
          {draft.gyms.map((g) => (
            <ChoiceCard key={g.id} title={`All at ${g.name}`} selected={draft.answers.gymId === g.id} onPress={() => void answer({ kind: 'gym', gymId: g.id })} />
          ))}
          <AppText variant="callout" color="text.secondary">
            Imported sets aren’t linked to a particular machine or bar, so they show in your history but may not appear as “Last” values yet.
          </AppText>
        </>
      );
      break;
  }

  return (
    <Screen>
      {error ? <StatusLine icon="exclamationmark.triangle" tone="warning" text={error} /> : null}
      {body}
    </Screen>
  );
}

/** One bar's weight in one unit (review S1: the Olympic bar, an EZ bar and a trap bar each have their own). An EZ or trap bar starts empty. */
function BarWeightField({ field, onSave }: { field: BarWeightView; onSave: (v: number) => void }) {
  const theme = useTheme();
  const [text, setText] = useState(field.value === null ? '' : String(field.value));
  const parsed = parseNumber(text);
  const invalid = text.trim() !== '' && (parsed === null || parsed <= 0);
  return (
    <View style={{ gap: theme.space['1'] }}>
      <AppText variant="label" color="text.secondary">
        {field.label}
      </AppText>
      <TextInput
        value={text}
        onChangeText={setText}
        onEndEditing={() => {
          if (parsed !== null && parsed > 0 && parsed !== field.value) onSave(parsed);
        }}
        keyboardType="decimal-pad"
        accessibilityLabel={field.label}
        maxFontSizeMultiplier={theme.type.body.maxFontSizeMultiplier}
        style={{ minHeight: 52, paddingHorizontal: theme.space['3'], borderRadius: theme.radius.sm, borderWidth: 1, borderColor: theme.colors['border.control'], backgroundColor: theme.colors['bg.raised'], color: theme.colors['text.primary'], fontSize: theme.type.body.fontSize }}
      />
      {invalid ? <AppText variant="callout" color="status.warning">Enter a bar weight above 0.</AppText> : field.missing !== null ? <AppText variant="callout" color="status.warning">{field.missing}</AppText> : null}
    </View>
  );
}
