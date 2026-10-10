import { useRoute, type RouteProp } from '@react-navigation/native';
import { useState, type ReactNode } from 'react';
import { TextInput, View } from 'react-native';

import type { AnswerChange } from '@fizz/domain';

import { barWeightEntry, bodyweightOptions, longDate, perHandOptions, totalOptions, type BarWeightView, type OptionView, type PerHandRowView, type TotalRowView } from '../../import/views';
import type { ProfileStackParams } from '../../navigation/types';
import { useDataChanged, useScreenData, useServices } from '../../shell/context';
import { useTheme } from '../../theme';
import { AppText, ChecklistRow, ChoiceCard, Group, Screen, SectionHeader, StatusLine, TextButton } from '../../ui';

/**
 * One import question (data-import-export §2.5 steps 3b–3c): dumbbell and
 * barbell conventions (one answer for the group, per-exercise overrides;
 * each exercise shows what it will import as; one-dumbbell exercises, and
 * exercises whose count the name doesn't establish, are never read by the
 * group answer, review r3 S1, r5; the barbell group answer is only "Total
 * as written" and "Plates only" is chosen per exercise with its bar shown,
 * PM decision after review r7; Ben's answer for an exercise in an earlier
 * import is filled in and says so, review r4 S2),
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

  /** One exercise: its name, what it imports as, and its choices (each change saved at once). */
  const exerciseRow = (r: { key: string; title: string; conversion: string; remembered?: string | null; choices: readonly { label: string; selected: boolean }[] }, onPick: (i: number) => AnswerChange) => (
    <View key={r.key} style={{ gap: theme.space['1'] }}>
      <AppText variant="body">{r.title}</AppText>
      <AppText variant="callout" color="text.secondary">
        {r.conversion}
      </AppText>
      {r.remembered ? (
        <AppText variant="callout" color="text.secondary">
          {r.remembered}
        </AppText>
      ) : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space['2'] }}>
        {r.choices.map((c, i) => (
          <TextButton key={c.label} label={c.selected ? `✓ ${c.label}` : c.label} tone={c.selected ? 'accent' : 'secondary'} onPress={() => void answer(onPick(i))} />
        ))}
      </View>
    </View>
  );

  const section = (title: string, lead: string | null, rows: ReactNode): ReactNode => (
    <>
      <SectionHeader title={title} />
      {lead ? (
        <AppText variant="callout" color="text.secondary">
          {lead}
        </AppText>
      ) : null}
      {rows}
    </>
  );

  let body: ReactNode = <AppText variant="body">This question no longer applies.</AppText>;
  switch (question) {
    case 'per_hand': {
      const q = perHandOptions(a);
      if (q) {
        const row = (r: PerHandRowView) => exerciseRow(r, (i) => ({ kind: 'per_hand_override', key: r.key, answer: r.choices[i]?.value ?? null }));
        body = (
          <>
            <AppText variant="body">{q.lead}</AppText>
            {q.question ? <AppText variant="headline">{q.question}</AppText> : null}
            {options(q.options, (v) => ({ kind: 'per_hand', answer: v }))}
            {q.example ? <AppText variant="callout" color="text.secondary">{q.example}</AppText> : null}
            {q.ask ? section(q.ask.title, q.ask.lead, q.ask.rows.map(row)) : null}
            {q.rows ? section(q.rows.title, q.rows.note, q.rows.rows.map(row)) : null}
          </>
        );
      }
      break;
    }
    case 'total': {
      const q = totalOptions(a);
      if (q) {
        // One exercise: its bar (changeable), what plates only would import as, what it imports as now, and Total as written / Plates only.
        const row = (r: TotalRowView) => (
          <View key={r.key} style={{ gap: theme.space['1'] }}>
            <AppText variant="body">{r.title}</AppText>
            <AppText variant="callout" color="text.secondary">
              {r.barLine}
            </AppText>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space['2'] }}>
              {r.bars.map((b) => (
                <TextButton key={b.label} label={b.selected ? `✓ ${b.label}` : b.label} tone={b.selected ? 'accent' : 'secondary'} onPress={() => void answer({ kind: 'total_bar', key: r.key, bar: b.value })} />
              ))}
            </View>
            <AppText variant="callout" color="text.secondary">
              {r.conversion}
            </AppText>
            <AppText variant="callout" color="text.secondary">
              {r.now}
            </AppText>
            {r.remembered ? (
              <AppText variant="callout" color="text.secondary">
                {r.remembered}
              </AppText>
            ) : null}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space['2'] }}>
              {r.choices.map((c) => (
                <TextButton key={c.label} label={c.selected ? `✓ ${c.label}` : c.label} tone={c.selected ? 'accent' : 'secondary'} onPress={() => void answer({ kind: 'total_override', key: r.key, answer: c.value })} />
              ))}
            </View>
          </View>
        );
        body = (
          <>
            <AppText variant="body">{q.lead}</AppText>
            {q.question ? <AppText variant="headline">{q.question}</AppText> : null}
            {options(q.options, (v) => ({ kind: 'total', answer: v }))}
            {q.example ? <AppText variant="callout" color="text.secondary">{q.example}</AppText> : null}
            {section(q.platesOnly.title, q.platesOnly.lead, q.platesOnly.rows.map(row))}
            {q.barWeights.map((b) => (
              <BarWeightField key={`${b.bar}-${b.unit}`} field={b} onSave={(value) => void answer({ kind: 'bar_weight', bar: b.bar, unit: b.unit, value })} />
            ))}
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
            Imported sets aren’t linked to a particular machine or bar. For now they’re kept and listed under Data & backup → Past imports, but aren’t used as “Last” values or targets, and imported workouts can’t be repeated.
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

/**
 * One bar's weight in one unit (review S1: the Olympic bar, an EZ bar and a
 * trap bar each have their own). An EZ or trap bar starts empty. A cleared
 * field warns while it's edited and shows the weight still in use once
 * editing ends (review r2 S1; `barWeightEntry`).
 */
function BarWeightField({ field, onSave }: { field: BarWeightView; onSave: (v: number) => void }) {
  const theme = useTheme();
  const [text, setText] = useState(field.value === null ? '' : String(field.value));
  const entry = barWeightEntry(text, field);
  return (
    <View style={{ gap: theme.space['1'] }}>
      <AppText variant="label" color="text.secondary">
        {field.label}
      </AppText>
      <TextInput
        value={text}
        onChangeText={setText}
        onEndEditing={() => {
          if (entry.save !== null) onSave(entry.save);
          setText(entry.endText);
        }}
        keyboardType="decimal-pad"
        accessibilityLabel={field.label}
        maxFontSizeMultiplier={theme.type.body.maxFontSizeMultiplier}
        style={{ minHeight: 52, paddingHorizontal: theme.space['3'], borderRadius: theme.radius.sm, borderWidth: 1, borderColor: theme.colors['border.control'], backgroundColor: theme.colors['bg.raised'], color: theme.colors['text.primary'], fontSize: theme.type.body.fontSize }}
      />
      {entry.warning !== null ? <AppText variant="callout" color="status.warning">{entry.warning}</AppText> : null}
    </View>
  );
}
