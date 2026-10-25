import { Alert, ScrollView, View } from 'react-native';

import { PICKER_COPY, pickerConfirm, type BroadMuscleGroup, type PickerRowView, type PickerView } from '@fizz/domain';

import { useTheme } from '../theme';
import { TextButton } from './buttons';
import { Eyebrow, StatusLine, TextField } from './layout';
import { BottomCard } from './sheet';
import { AppText } from './Text';
import { POPUP_COPY } from './exercise-popup-model';
import { choiceLine, swapPainConfirm, SWAP_SHEET_COPY, type ChoiceSection } from './swap-sheet-model';
import { ChoiceRow, Divider, Table } from './table-parts';
import { Chip } from './workout';

/**
 * Swap / Add (workout-builder-v3 §2.5), one sheet for Your workout, the one workout editor and the active workout
 * (today only there). (Ben, 25 Oct) Top: the ranked suggestions as before (by focus, near-duplicates last with
 * `Like …`, `May hurt`). Below: the muscle chips and a search over every exercise (catalogue + Ben's own, the
 * Library's aliases and typos), by broad group like Library › Exercises; the gym's misses last, dimmed,
 * `Not at Main Gym`; `＋ Add your own` at the bottom. A flagged or not-here pick asks first. No estimated max.
 */
export function SwapSheet({
  visible,
  title,
  sections,
  actionWord,
  onPick,
  onClose,
  onDismissed,
  picker,
}: {
  visible: boolean;
  title: string;
  /** The ranked suggestions (the host's `choices`), by focus. */
  sections: readonly ChoiceSection[];
  /** `Swap` or `Add` (the confirms' `Swap anyway` / `Add anyway`). */
  actionWord: string;
  onPick: (exerciseId: string) => void;
  onClose: () => void;
  /** The sheet's modal has gone (iOS): `＋ Add your own` opens its form then. */
  onDismissed?: () => void;
  picker: {
    /** Null while the full list is being read. */
    view: PickerView | null;
    query: string;
    onQuery: (q: string) => void;
    /** A muscle chip (null: `All`); the suggestions follow a group chip. */
    onChip: (group: BroadMuscleGroup | null) => void;
    /** `＋ Add your own`: the custom-exercise form, the name pre-filled when searching. */
    onAddOwn: (name: string | null) => void;
  };
}) {
  const theme = useTheme();
  const view = picker.view;
  const searching = picker.query.trim() !== '';
  const ask = (c: { title: string; message: string | null; cancel: string; confirm: string } | null, exerciseId: string) => {
    if (c === null) {
      onPick(exerciseId);
      return;
    }
    // `Choose another` keeps the sheet open and changes nothing.
    Alert.alert(c.title, c.message ?? undefined, [
      { text: c.cancel, style: 'cancel' },
      {
        text: c.confirm,
        onPress: () => {
          onPick(exerciseId);
        },
      },
    ]);
  };
  const row = (r: PickerRowView, i: number) => (
    <View key={r.exerciseId}>
      {i > 0 ? <Divider /> : null}
      <ChoiceRow
        title={r.name}
        line={r.line}
        tags={r.tags.map((t) => ({ text: t.text, tone: t.kind === 'may_hurt' ? ('warning' as const) : ('secondary' as const) }))}
        dimmed={r.notHere}
        accessibilityLabel={r.accessibilityLabel}
        onPress={() => {
          ask(pickerConfirm(r, actionWord), r.exerciseId);
        }}
      />
    </View>
  );
  return (
    <BottomCard visible={visible} onClose={onClose} {...(onDismissed ? { onDismissed } : {})} footer={<TextButton label="Back" tone="secondary" onPress={onClose} />}>
      <AppText variant="title2" accessibilityRole="header">
        {title}
      </AppText>
      {!searching && sections.length > 0 ? (
        <View style={{ gap: theme.space['2'] }}>
          <Eyebrow>{SWAP_SHEET_COPY.suggested}</Eyebrow>
          {sections.map((sec) => (
            <View key={sec.focus} style={{ gap: theme.space['1'] }}>
              {sections.length > 1 ? (
                <AppText variant="label" color="text.secondary" accessibilityRole="header">
                  {sec.focus}
                </AppText>
              ) : null}
              <Table>
                {sec.items.map((it, i) => (
                  <View key={it.exerciseId}>
                    {i > 0 ? <Divider /> : null}
                    <ChoiceRow
                      title={it.name}
                      line={choiceLine(it)}
                      tag={it.mayHurt ? POPUP_COPY.mayHurt : null}
                      onPress={() => {
                        // Rule 9: a flagged exercise asks first.
                        ask(swapPainConfirm(it, actionWord), it.exerciseId);
                      }}
                    />
                  </View>
                ))}
              </Table>
            </View>
          ))}
        </View>
      ) : null}
      {/* (D5) `All` + six broad groups, as Library › Exercises; then the search. */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" accessibilityLabel="Muscle" style={{ flexGrow: 0, marginHorizontal: -theme.components.screenMargin }} contentContainerStyle={{ paddingHorizontal: theme.components.screenMargin, gap: theme.space['2'] }}>
        {(view?.chips ?? []).map((c) => (
          <Chip
            key={c.label}
            label={c.label}
            selected={c.selected}
            size="min"
            onPress={() => {
              picker.onChip(c.group);
            }}
          />
        ))}
      </ScrollView>
      <TextField accessibilityLabel={PICKER_COPY.search} placeholder={PICKER_COPY.search} value={picker.query} onChangeText={picker.onQuery} autoCorrect={false} returnKeyType="search" clearButtonMode="while-editing" />
      {view === null ? null : (
        <>
          {view.sections.map((sec) => (
            <View key={sec.key} style={{ gap: theme.space['1'] }}>
              <Eyebrow>{sec.title}</Eyebrow>
              {sec.parts.map((part) => (
                <View key={part.title ?? sec.key} style={{ gap: theme.space['1'] }}>
                  {part.title !== null ? (
                    <AppText variant="label" color="text.secondary" accessibilityRole="header">
                      {part.title}
                    </AppText>
                  ) : null}
                  <Table>{part.rows.map(row)}</Table>
                </View>
              ))}
            </View>
          ))}
          {view.empty !== null ? <StatusLine icon="info.circle" tone="info" text={view.empty} /> : null}
          <TextButton
            label={view.addOwn.label}
            onPress={() => {
              picker.onAddOwn(view.addOwn.name);
            }}
          />
        </>
      )}
    </BottomCard>
  );
}
