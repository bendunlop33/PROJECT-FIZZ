import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { presetProgressRange, PROGRESS_PERIOD_PRESETS, shortDateText, stepPeriodDate, type ActivityView, type DateRange, type TimeSheetRow } from '@fizz/domain';

import { E1RM_SHEET_LINES, HOW_COUNTED_LINES, TIME_SHEET_COPY } from '../../progress/copy';
import { useTheme } from '../../theme';
import { AppText, BottomCard, Chip, ChipRow, OutlinePill, PrimaryButton, TextButton } from '../../ui';

/**
 * The two Progress sheets (progress.md §2.3, §2.4): `Time in gym` lists only
 * what was left out of time, and `How this is counted`, the one place the
 * muscle method is explained (minimal copy: nowhere else).
 */

function Heading({ title, onDone }: { title: string; onDone: () => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <AppText variant="title2" accessibilityRole="header">
        {title}
      </AppText>
      <TextButton label="Done" onPress={onDone} />
    </View>
  );
}

function LeftOutRow({ row, onCount, onEdit }: { row: TimeSheetRow; onCount?: (r: TimeSheetRow) => void; onEdit: (r: TimeSheetRow) => void }) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.space['2'] }}>
      <AppText variant="body" numeric>
        {row.text}
      </AppText>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space['2'] }}>
        {onCount ? (
          <OutlinePill
            label={TIME_SHEET_COPY.countIt}
            accessibilityLabel={`${TIME_SHEET_COPY.countIt}: ${row.text}`}
            onPress={() => {
              onCount(row);
            }}
          />
        ) : null}
        <OutlinePill
          label={TIME_SHEET_COPY.editTimes}
          accessibilityLabel={`${TIME_SHEET_COPY.editTimes}: ${row.text}`}
          onPress={() => {
            onEdit(row);
          }}
        />
      </View>
    </View>
  );
}

export function TimeSheet({ visible, sheet, onClose, onCount, onEdit }: { visible: boolean; sheet: ActivityView['sheet']; onClose: () => void; onCount: (r: TimeSheetRow) => void; onEdit: (r: TimeSheetRow) => void }) {
  const theme = useTheme();
  return (
    <BottomCard visible={visible} onClose={onClose}>
      <Heading title={TIME_SHEET_COPY.title} onDone={onClose} />
      <AppText variant="body" numeric>
        {sheet.countLine}
      </AppText>
      {sheet.overCap.length > 0 ? (
        <View style={{ gap: theme.space['3'] }}>
          <AppText variant="sectionLabel" color="text.tertiary" accessibilityRole="header">
            {TIME_SHEET_COPY.overCap}
          </AppText>
          {sheet.overCap.map((r) => (
            <LeftOutRow key={r.sessionId} row={r} onCount={onCount} onEdit={onEdit} />
          ))}
        </View>
      ) : null}
      {sheet.noEnd.length > 0 ? (
        <View style={{ gap: theme.space['3'] }}>
          <AppText variant="sectionLabel" color="text.tertiary" accessibilityRole="header">
            {TIME_SHEET_COPY.noEnd}
          </AppText>
          {sheet.noEnd.map((r) => (
            <LeftOutRow key={r.sessionId} row={r} onEdit={onEdit} />
          ))}
        </View>
      ) : null}
      {sheet.imported !== null ? (
        <View style={{ gap: theme.space['2'] }}>
          <AppText variant="sectionLabel" color="text.tertiary" accessibilityRole="header">
            {TIME_SHEET_COPY.imported}
          </AppText>
          <AppText variant="body" numeric>
            {sheet.imported}
          </AppText>
        </View>
      ) : null}
      <AppText variant="callout" color="text.secondary">
        {TIME_SHEET_COPY.footer}
      </AppText>
    </BottomCard>
  );
}

export function HowCountedSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const theme = useTheme();
  const lines = HOW_COUNTED_LINES;
  return (
    <BottomCard visible={visible} onClose={onClose}>
      <Heading title="How this is counted" onDone={onClose} />
      <View style={{ gap: theme.space['3'] }}>
        {lines.map((l) => (
          <AppText key={l} variant="body">
            {l}
          </AppText>
        ))}
      </View>
    </BottomCard>
  );
}

/** Est. 1RM `ⓘ` (§2.7): how the estimate is worked out. */
export function E1rmSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const theme = useTheme();
  return (
    <BottomCard visible={visible} onClose={onClose}>
      <Heading title="Est. 1RM" onDone={onClose} />
      <View style={{ gap: theme.space['3'] }}>
        {E1RM_SHEET_LINES.map((l) => (
          <AppText key={l} variant="body">
            {l}
          </AppText>
        ))}
      </View>
    </BottomCard>
  );
}

const STEPS = [
  { unit: 'month', by: -1, label: '−1 mo', words: 'one month earlier' },
  { unit: 'week', by: -1, label: '−1 wk', words: 'one week earlier' },
  { unit: 'week', by: 1, label: '+1 wk', words: 'one week later' },
  { unit: 'month', by: 1, label: '+1 mo', words: 'one month later' },
] as const;

function DateStepper({ label, date, bounds, onChange }: { label: string; date: string; bounds: DateRange; onChange: (d: string) => void }) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.space['2'] }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <AppText variant="sectionLabel" color="text.tertiary">
          {label}
        </AppText>
        <AppText variant="headline" numeric>
          {shortDateText(date, true)}
        </AppText>
      </View>
      <ChipRow>
        {STEPS.map((st) => (
          <Chip
            key={st.label}
            label={st.label}
            selected={false}
            accessibilityLabel={`${label}, ${st.words}`}
            onPress={() => {
              onChange(stepPeriodDate(date, { unit: st.unit, by: st.by }, bounds));
            }}
          />
        ))}
      </ChipRow>
    </View>
  );
}

/**
 * Choose the dates (Ben, 12 Oct 2026): `3 months`, `6 months`, `1 year`, or
 * a `From` and `To` moved a week or a month at a time, between the first
 * workout and today. `Show` applies it; `Clear` goes back to the preset.
 */
export function PeriodSheet({
  visible,
  today,
  earliest,
  current,
  onShow,
  onClear,
  onClose,
}: {
  visible: boolean;
  today: string;
  earliest: string;
  /** The period showing now (custom or the preset's dates). */
  current: DateRange;
  onShow: (range: DateRange) => void;
  /** Null when a preset is showing (nothing to clear). */
  onClear: (() => void) | null;
  onClose: () => void;
}) {
  const theme = useTheme();
  const [from, setFrom] = useState(current.from);
  const [to, setTo] = useState(current.to);
  useEffect(() => {
    if (!visible) return;
    setFrom(current.from);
    setTo(current.to);
  }, [visible, current.from, current.to]);
  const bounds = { from: earliest < today ? earliest : today, to: today };
  return (
    <BottomCard visible={visible} onClose={onClose}>
      <Heading title="Dates" onDone={onClose} />
      <ChipRow>
        {PROGRESS_PERIOD_PRESETS.map((p) => {
          const r = presetProgressRange(today, p.key);
          return (
            <Chip
              key={p.key}
              label={p.label}
              selected={r.from === from && r.to === to}
              onPress={() => {
                setFrom(r.from);
                setTo(r.to);
              }}
            />
          );
        })}
      </ChipRow>
      <DateStepper
        label="FROM"
        date={from}
        bounds={{ from: bounds.from, to }}
        onChange={setFrom}
      />
      <DateStepper
        label="TO"
        date={to}
        bounds={{ from, to: bounds.to }}
        onChange={setTo}
      />
      <View style={{ gap: theme.space['2'] }}>
        <PrimaryButton
          label="Show"
          onPress={() => {
            onShow({ from, to });
          }}
        />
        {onClear ? <TextButton label="Clear" onPress={onClear} /> : null}
      </View>
    </BottomCard>
  );
}
