import DateTimePicker from '@react-native-community/datetimepicker';
import { useRef, useState } from 'react';
import { Pressable, View } from 'react-native';

import { BODYWEIGHT_RANGE_LABEL, BODYWEIGHT_RANGES, localDateOf, localHourUtcMs, weightText, type BodyweightRange } from '@fizz/domain';
import type { WeightEntry, WeightUnit } from '@fizz/schemas';

import { dateAt } from '../../clock';
import { formatCalendarDate } from '../../format/dates';
import { newUuid } from '../../device/runtime';
import { loadTrendCanvas } from '../../progress/load-charts';
import { Segmented, useAx } from '../../progress/components';
import { trendLayout } from '../../progress/trend-layout';
import type { BodyweightCard as CardData } from '../../services/bodyweight-service';
import { useDataChanged, useScreenData, useServices } from '../../shell/context';
import { useTheme } from '../../theme';
import { readWeightEntry } from '../../training/training-view';
import { AppText, BottomCard, Chip, ChipRow, PrimaryButton, RuledSection, TextButton, TextField, Toast } from '../../ui';

/**
 * (Ben, 27 Oct) Progress › Training: bodyweight over time. Gym first: it sits below the lifting cards. Points (one a
 * day; his entry wins over Health's) with the 7-day average as the thin dashed line the Exercises tab uses for its
 * average, one axis, latest value and the change over the range. `＋ Weight` logs one (number pad, kg/lb, date
 * defaulting to today); `Entries` lists his own to edit or delete, each with Undo. Values only (minimal copy).
 */

const COPY = { title: 'Bodyweight', add: '＋ Weight', entries: 'Entries', save: 'Save', cancel: 'Cancel', delete: 'Delete', undo: 'Undo', saved: 'Saved', deleted: 'Deleted', edited: 'Changed', date: 'Date' } as const;

type Sheet = { kind: 'add' } | { kind: 'edit'; entry: WeightEntry } | { kind: 'list' } | null;
type UndoState = { text: string; run: () => Promise<unknown> } | null;

export function BodyweightCard({ active }: { active: boolean }) {
  const theme = useTheme();
  const services = useServices();
  const changed = useDataChanged();
  const [range, setRange] = useState<BodyweightRange>('3m');
  const [data, reload] = useScreenData((s) => s.bodyweight.card(range), { enabled: active });
  const [sheet, setSheet] = useState<Sheet>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [undo, setUndo] = useState<UndoState>(null);
  const busy = useRef(false);
  const card = data.state === 'ready' ? data.value : null;
  if (card === null) return null;

  const after = (ok: boolean, msg: string | undefined) => {
    setMessage(ok ? null : (msg ?? null));
    changed();
    reload();
  };
  // Every tap is one op ID on the version the card read (rule 5); a stale card is refused and reloads.
  const run = async (fn: () => Promise<{ ok: true } | { ok: false; message: string }>, undoText: string | null, undoFn: ((version: number) => Promise<unknown>) | null) => {
    if (busy.current) return;
    busy.current = true;
    try {
      const r = await fn();
      setSheet(null);
      after(r.ok, r.ok ? undefined : r.message);
      if (r.ok && undoText !== null && undoFn !== null) {
        setUndo({
          text: undoText,
          // Undo is a new versioned write on the profile as it is after this one.
          run: async () => {
            const fresh = await services.bodyweight.card(range);
            if (fresh !== null) await undoFn(fresh.version);
          },
        });
      }
    } finally {
      busy.current = false;
    }
  };

  const v = card.view;
  return (
    <RuledSection title={COPY.title}>
      {message !== null ? <Toast icon="exclamationmark.triangle" text={message} onDismiss={() => { setMessage(null); }} /> : null}
      {undo !== null && message === null ? (
        <Toast
          text={undo.text}
          action={COPY.undo}
          showClose
          onAction={() => {
            const u = undo;
            setUndo(null);
            void u.run().then(() => {
              changed();
              reload();
            });
          }}
          onDismiss={() => { setUndo(null); }}
        />
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space['2'] }}>
        <View style={{ flexShrink: 1 }} accessible accessibilityLabel={v.accessibilityLabel}>
          <AppText variant="headline" numeric>
            {v.latest ?? '—'}
          </AppText>
          {v.change !== null ? (
            <AppText variant="callout" color="text.secondary" numeric>
              {v.change}
            </AppText>
          ) : null}
        </View>
        <TextButton label={COPY.add} accessibilityLabel="Add weight" onPress={() => { setSheet({ kind: 'add' }); }} />
      </View>
      {!v.empty ? (
        <>
          <Segmented options={BODYWEIGHT_RANGES.map((k) => ({ key: k, label: BODYWEIGHT_RANGE_LABEL[k] }))} selected={range} onSelect={setRange} label="Bodyweight range" />
          <BodyweightPlot card={card} />
          {v.source !== null ? (
            <AppText variant="callout" color="text.secondary">
              {v.source}
            </AppText>
          ) : null}
        </>
      ) : null}
      {card.mine.length > 0 ? (
        <View style={{ alignSelf: 'flex-start' }}>
          <TextButton label={`${COPY.entries} ›`} tone="secondary" onPress={() => { setSheet({ kind: 'list' }); }} />
        </View>
      ) : null}
      <BottomCard visible={sheet !== null} onClose={() => { setSheet(null); }}>
        {sheet === null ? null : sheet.kind === 'list' ? (
          <EntryList card={card} onPick={(entry) => { setSheet({ kind: 'edit', entry }); }} onClose={() => { setSheet(null); }} />
        ) : (
          <WeightForm
            key={sheet.kind === 'edit' ? sheet.entry.id : 'add'}
            unit={card.unit}
            today={card.today}
            tz={services.now().tz}
            entry={sheet.kind === 'edit' ? sheet.entry : null}
            onCancel={() => { setSheet(null); }}
            onSave={(value, unit, date) => {
              const opId = newUuid();
              if (sheet.kind === 'add') {
                void run(() => services.bodyweight.log({ value, unit, date, opId, expectedVersion: card.version }), COPY.saved, (version) => services.bodyweight.remove({ entryId: opId, opId: newUuid(), expectedVersion: version }));
              } else {
                const before = sheet.entry;
                void run(() => services.bodyweight.edit({ entryId: before.id, value, unit, date, opId, expectedVersion: card.version }), COPY.edited, (version) => services.bodyweight.edit({ entryId: before.id, value: before.value, unit: before.unit, date: before.date, opId: newUuid(), expectedVersion: version }));
              }
            }}
            onDelete={
              sheet.kind === 'edit'
                ? () => {
                    const e = sheet.entry;
                    void run(() => services.bodyweight.remove({ entryId: e.id, opId: newUuid(), expectedVersion: card.version }), COPY.deleted, (version) => services.bodyweight.restore({ entry: e, opId: newUuid(), expectedVersion: version }));
                  }
                : null
            }
          />
        )}
      </BottomCard>
    </RuledSection>
  );
}

/** The chart: one y axis (Ben's unit), points, and the 7-day average as a thin dashed line; Skia, else plain dots. */
function BodyweightPlot({ card }: { card: CardData }) {
  const theme = useTheme();
  const ax = useAx();
  const [width, setWidth] = useState(0);
  const v = card.view;
  const height = ax ? theme.chart.detailHeightAX : theme.chart.detailHeight;
  // Each point stands alone (no joining line): the average is the line.
  const layout = trendLayout({ points: v.points.map((p) => ({ date: p.date, value: p.value, breakBefore: true })), from: v.from, to: v.to, width, height, bars: false, format: 'number', axisWidth: 40, inset: 8, overlay: v.average });
  const canvas = loadTrendCanvas();
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <AppText variant="label" color="chart.axisText">
        {card.unit}
      </AppText>
      <View
        style={{ height }}
        onLayout={(e) => {
          setWidth(Math.floor(e.nativeEvent.layout.width));
        }}
      >
        {width > 0 ? (
          canvas.ok ? (
            <canvas.value
              layout={layout}
              width={width}
              height={height}
              bars={false}
              hollow={v.points.map((p) => p.from === 'health')}
              selected={null}
              lineWidth={theme.chart.activeLineWidth}
              pointSize={theme.chart.point}
              pointSelectedSize={theme.chart.pointSelected}
              gridWidth={theme.a11y.increaseContrast ? 2 : 1}
              overlay={{ color: theme.colors['chart.line'], width: 1.5 }}
              colors={{ line: theme.colors['chart.line'], point: theme.colors['chart.point'], selected: theme.colors['chart.selected'], grid: theme.a11y.increaseContrast ? theme.colors['border.control'] : theme.colors['chart.grid'], bar: theme.colors['chart.bar'], surface: theme.colors['bg.canvas'] }}
            />
          ) : (
            <View style={{ width, height }}>
              {layout.xs.map((x, i) => (
                <View key={v.points[i]?.id ?? String(i)} style={{ position: 'absolute', left: x - theme.chart.point / 2, top: (layout.ys[i] ?? 0) - theme.chart.point / 2, width: theme.chart.point, height: theme.chart.point, borderRadius: theme.chart.point / 2, backgroundColor: theme.colors['chart.point'] }} />
              ))}
            </View>
          )
        ) : null}
        {layout.yTicks.map((t) => (
          <View key={t.label} pointerEvents="none" style={{ position: 'absolute', left: 0, width: 34, top: t.y - 10 }}>
            <AppText variant="label" numeric color="chart.axisText" align="right" maxFontSizeMultiplier={1.4}>
              {t.label}
            </AppText>
          </View>
        ))}
      </View>
      <View style={{ height: 22 }}>
        {layout.months.map((m) => (
          <View key={`${m.label}${String(Math.round(m.x))}`} style={{ position: 'absolute', left: m.x - 24, width: 48, alignItems: 'center' }}>
            <AppText variant="label" color="chart.axisText" numberOfLines={1} maxFontSizeMultiplier={1.4}>
              {m.label}
            </AppText>
          </View>
        ))}
      </View>
    </View>
  );
}

function EntryList({ card, onPick, onClose }: { card: CardData; onPick: (e: WeightEntry) => void; onClose: () => void }) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.space['2'] }}>
      <AppText variant="headline">{COPY.entries}</AppText>
      {card.mine.slice(0, 60).map((e) => {
        const text = `${formatCalendarDate(e.date)} · ${weightText(e, card.unit)}`;
        return (
          <Pressable key={e.id} accessibilityRole="button" accessibilityLabel={`${text}. Edit`} onPress={() => { onPick(e); }} style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', opacity: pressed ? 0.7 : 1 })}>
            <AppText variant="body" numeric>
              {text}
            </AppText>
          </Pressable>
        );
      })}
      <TextButton label={COPY.cancel} tone="secondary" onPress={onClose} />
    </View>
  );
}

function WeightForm({ unit, today, tz, entry, onCancel, onSave, onDelete }: { unit: WeightUnit; today: string; tz: string; entry: WeightEntry | null; onCancel: () => void; onSave: (value: number, unit: WeightUnit, date: string) => void; onDelete: (() => void) | null }) {
  const theme = useTheme();
  const [text, setText] = useState(entry === null ? '' : String(entry.value));
  const [u, setU] = useState<WeightUnit>(entry?.unit ?? unit);
  const [date, setDate] = useState(entry?.date ?? today);
  const noon = (d: string) => dateAt(localHourUtcMs(d, 12, tz));
  const read = readWeightEntry(text, date, today);
  return (
    <View style={{ gap: theme.space['3'] }}>
      <AppText variant="headline">{entry === null ? 'Weight' : formatCalendarDate(entry.date)}</AppText>
      <TextField accessibilityLabel={`Weight in ${u}`} keyboardType="decimal-pad" placeholder={u} value={text} onChangeText={setText} autoFocus />
      <ChipRow>
        {(['kg', 'lb'] as const).map((x) => (
          <Chip key={x} label={x} selected={u === x} onPress={() => { setU(x); }} />
        ))}
      </ChipRow>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 }}>
        <AppText variant="body">{COPY.date}</AppText>
        <DateTimePicker
          value={noon(date)}
          mode="date"
          display="compact"
          timeZoneName={tz}
          maximumDate={noon(today)}
          themeVariant={theme.scheme}
          accessibilityLabel={COPY.date}
          onValueChange={(_e, d) => {
            setDate(localDateOf(d.getTime(), tz));
          }}
        />
      </View>
      <PrimaryButton label={COPY.save} disabled={read === null} onPress={() => { if (read !== null) onSave(read.value, u, read.date); }} />
      {onDelete !== null ? <TextButton label={COPY.delete} tone="secondary" onPress={onDelete} /> : null}
      <TextButton label={COPY.cancel} tone="secondary" onPress={onCancel} />
    </View>
  );
}
