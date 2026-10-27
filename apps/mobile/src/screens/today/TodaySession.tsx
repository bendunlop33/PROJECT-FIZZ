import { type ReactNode } from 'react';
import { Pressable, Switch, View, useWindowDimensions } from 'react-native';

import { TODAY_PICK_COPY, TODAY_V2_COPY, WORKOUT_LIST_COPY, type TodayDayRow, type TodayHealthLine, type TodayHealthShows, type WeekTile, type WeekTileMark } from '@fizz/domain';

import type { TodayOptionChange, TodayOptions } from '../../builder/builder-service';
import type { TodayCardView } from '../../services/today-session';
import { useTheme } from '../../theme';
import { AppText, BottomCard, Group, Icon, PrimaryButton, SecondaryButton, TextButton } from '../../ui';
import { WorkoutList } from '../../ui/workout-list';
import { AX_FONT_SCALE } from '../../workout/screen-rules';
import { markStyle, TILE_LAYOUT, tileStyle } from '../../today/tile-style';
import { todayCardRows, TODAY_SCREEN_COPY, type DaySheetOpen, type DaySheetRow, type LabelValueRow } from '../../today/today-view';
import { PAST_LOG_COPY } from '../../workout/past-log-view';

/**
 * Today (redesign v3, Ben 27 Oct; options B and C; docs/design/redesign-27oct.md §A): the pieces only lay out what
 * `todaySession` and the pure view rules worked out; no rule lives here. Every gesture is a tap with a VoiceOver label;
 * every target is ≥ 44 pt; text scales with Dynamic Type, and at accessibility sizes the week becomes a list.
 */

/** Control rows are 44 pt with no gap between them, so a 34 pt chip's 5 pt slop stays inside its own row (review S9). */
const ROW_H = 44;
const HIT = { top: 5, bottom: 5, left: 4, right: 4 } as const;
const useAx = () => useWindowDimensions().fontScale >= AX_FONT_SCALE;

/** (Ben, 27 Oct) Spacing between Today's sections: extra above `Up next`, and between a label and its card. */
export const TODAY_SPACING = { labelToContent: 7, aboveCardLabel: 7, labelColumn: 96 } as const;

// ---------------------------------------------------------------------------
// Header: `Tuesday` over `27 October`, ✦ and mic as 44 pt icon buttons

export function TodayHeader({ title, date, coach }: { title: string; /** `27 October`. */ date: string; /** `CoachAskBar compact round`. */ coach: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space['2'] }}>
      <View style={{ flexShrink: 1 }}>
        <AppText variant="title1" accessibilityRole="header" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
          {title}
        </AppText>
        <AppText variant="callout" color="text.secondary" numeric>
          {date}
        </AppText>
      </View>
      {coach}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Apple Health line (redesign v3 §A2): one quiet row, tap → Progress, long-press → Show on Today

export function HealthLine({ line, onPress, onLongPress }: { line: TodayHealthLine; onPress: () => void; onLongPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={line.accessibilityLabel}
      accessibilityHint="Opens Progress. Long-press to choose what shows"
      accessibilityActions={[{ name: 'longpress', label: 'Choose what shows' }]}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === 'longpress') onLongPress();
      }}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => ({ minHeight: 40, marginTop: 4 - theme.space['3'], marginBottom: 8 - theme.space['3'], flexDirection: 'row', alignItems: 'center', gap: theme.space['2'], opacity: pressed ? 0.7 : 1 })}
    >
      <Icon name="heart" size={16} color="text.secondary" />
      <AppText variant="body" color="text.secondary" numeric numberOfLines={1} style={{ flexShrink: 1 }}>
        {line.text}
      </AppText>
      <Icon name="chevron.right" size={12} color="text.tertiary" />
    </Pressable>
  );
}

/** Long-press on the Health line: what shows (Sleep, Resting heart rate, Bodyweight), saved on this phone. */
export function ShowOnTodaySheet({ visible, shows, onChange, onClose }: { visible: boolean; shows: TodayHealthShows; onChange: (next: TodayHealthShows) => void; onClose: () => void }) {
  const theme = useTheme();
  const row = (label: string, key: keyof TodayHealthShows) => (
    <Pressable key={key} accessibilityRole="switch" accessibilityLabel={label} accessibilityState={{ checked: shows[key] }} onPress={() => { onChange({ ...shows, [key]: !shows[key] }); }} style={({ pressed }) => ({ minHeight: 48, paddingHorizontal: theme.space['4'], flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', opacity: pressed ? 0.7 : 1 })}>
      <AppText variant="body">{label}</AppText>
      <View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants">
        <Switch value={shows[key]} accessible={false} />
      </View>
    </Pressable>
  );
  return (
    <BottomCard visible={visible} onClose={onClose} footer={<PrimaryButton label={TODAY_SCREEN_COPY.done} onPress={onClose} />}>
      <AppText variant="title2" accessibilityRole="header">
        {TODAY_SCREEN_COPY.showOnToday}
      </AppText>
      <Group>
        {row('Sleep', 'sleep')}
        {row('Resting heart rate', 'rhr')}
        {row('Bodyweight', 'bodyweight')}
      </Group>
    </BottomCard>
  );
}

// ---------------------------------------------------------------------------
// Section label rows (`THIS WEEK  Plan week 3 of 6`, `YOUR SPLIT`, `UP NEXT`)

export function SectionLabel({ title, right, onRight, rightLabel }: { title: string; right?: string | null; onRight?: () => void; rightLabel?: string }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space['2'], minHeight: 20 }}>
      <AppText variant="sectionLabel" color="text.tertiary" accessibilityRole="header">
        {title}
      </AppText>
      {right != null && right !== '' ? (
        onRight !== undefined ? (
          <Pressable accessibilityRole="button" accessibilityLabel={rightLabel ?? right} hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }} onPress={onRight} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
            <AppText variant="callout" color="text.secondary" numeric style={{ fontSize: 13, lineHeight: 18 }}>
              {right}
            </AppText>
          </Pressable>
        ) : (
          <AppText variant="callout" color="text.secondary" numeric style={{ fontSize: 13, lineHeight: 18 }}>
            {right}
          </AppText>
        )
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// The week: seven tiles Mon–Sun (option B)

/** 7 pt gaps leave ≈42 pt tiles at 375 pt: 3 pt of slop a side keeps each target ≥ 44 pt without overlapping its neighbour. */
const TILE_SLOP = { top: 4, bottom: 4, left: 3, right: 3 } as const;

export function WeekTiles({ tiles, onDay }: { tiles: readonly WeekTile[]; onDay: (tile: WeekTile) => void }) {
  const theme = useTheme();
  const ax = useAx();
  const L = TILE_LAYOUT;
  if (ax) {
    return (
      <View accessibilityRole="list">
        {tiles.map((t) => (
          <Pressable key={t.date} accessibilityRole="button" accessibilityLabel={t.accessibilityLabel} disabled={t.items.length === 0} onPress={() => { onDay(t); }} style={({ pressed }) => ({ minHeight: theme.target.min.height, justifyContent: 'center', opacity: pressed ? 0.7 : 1 })}>
            <AppText variant="callout" color={t.today ? 'text.primary' : 'text.secondary'}>
              {t.accessibilityLabel}
            </AppText>
          </Pressable>
        ))}
      </View>
    );
  }
  return (
    <View style={{ flexDirection: 'row', gap: L.gap }}>
      {tiles.map((t) => {
        const st = tileStyle(t, theme);
        return (
          <Pressable
            key={t.date}
            accessibilityRole="button"
            accessibilityLabel={t.accessibilityLabel}
            accessibilityState={{ disabled: t.items.length === 0 }}
            disabled={t.items.length === 0}
            hitSlop={TILE_SLOP}
            onPress={() => {
              onDay(t);
            }}
            style={({ pressed }) => ({ flex: 1, flexBasis: 0, minWidth: 0, height: L.height, borderRadius: L.radius, backgroundColor: st.backgroundColor, borderWidth: st.borderWidth, borderColor: st.borderColor, alignItems: 'center', justifyContent: 'center', gap: 2, opacity: pressed ? 0.7 : 1 })}
          >
            <AppText variant="callout" color="text.tertiary" maxFontSizeMultiplier={1} style={{ fontSize: L.letterSize, lineHeight: 13 }}>
              {t.letter}
            </AppText>
            <AppText variant="label" numeric color={st.dateColor} maxFontSizeMultiplier={1} style={{ fontSize: L.dateSize, lineHeight: 19, fontWeight: '600' }}>
              {String(t.dayOfMonth)}
            </AppText>
            <View style={{ flexDirection: 'row', gap: L.markGap, height: L.mark + 1, alignItems: 'center' }}>
              {t.marks.slice(0, 3).map((m, i) => (
                <View key={`${m.shape}:${String(i)}`} style={{ width: L.mark, height: L.mark, borderRadius: L.mark / 2, ...markStyle(m, theme) }} />
              ))}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A tapped day (Ben, 27 Oct): `Mon 26 Oct`, one row per thing on it, each opening its own page. */
export function DaySheet({ title, rows, onOpen, onClose }: { title: string | null; rows: readonly DaySheetRow[]; onOpen: (open: NonNullable<DaySheetOpen>) => void; onClose: () => void }) {
  const theme = useTheme();
  return (
    <BottomCard visible={title !== null} onClose={onClose} footer={<TextButton label={TODAY_V2_COPY.close} tone="secondary" onPress={onClose} />}>
      <AppText variant="title2" accessibilityRole="header">
        {title ?? ''}
      </AppText>
      <Group>
        {rows.map((r) => (
          <Pressable
            key={r.key}
            accessibilityRole={r.open === null ? 'text' : 'button'}
            accessibilityLabel={r.accessibilityLabel}
            disabled={r.open === null}
            onPress={() => {
              if (r.open !== null) onOpen(r.open);
            }}
            style={({ pressed }) => ({ minHeight: 56, paddingHorizontal: theme.space['4'], paddingVertical: theme.space['2'], flexDirection: 'row', alignItems: 'center', gap: theme.space['3'], opacity: pressed ? 0.7 : 1 })}
          >
            <RowMark mark={r.mark} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <AppText variant="body">
                {r.title}
                {r.health ? <AppText variant="callout" color="text.tertiary" style={CARD_TEXT.small}>{' ♥'}</AppText> : null}
              </AppText>
              {r.detail !== null ? (
                <AppText variant="callout" color="text.secondary" numeric>
                  {r.detail}
                </AppText>
              ) : null}
            </View>
            {r.open !== null ? <Icon name="chevron.right" size={14} color="text.tertiary" /> : null}
          </Pressable>
        ))}
      </Group>
    </BottomCard>
  );
}

// ---------------------------------------------------------------------------
// `Push ⌄` → Today's workout (option C)

export function TodayPickSheet({
  visible,
  rows,
  others,
  onPick,
  onBuild,
  onPastLog,
  onActivity,
  onClose,
}: {
  visible: boolean;
  rows: readonly TodayDayRow[];
  /** Other sessions (Full body, Upper …) after the plan's days. */
  others: readonly { key: string; name: string; selected: boolean }[];
  onPick: (key: string) => void;
  onBuild: () => void;
  onPastLog: () => void;
  onActivity: () => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const dayRow = (key: string, name: string, status: string, selected: boolean, label: string) => (
    <Pressable key={key} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected }} onPress={() => { onPick(key); }} style={({ pressed }) => ({ minHeight: 52, paddingHorizontal: theme.space['4'], flexDirection: 'row', alignItems: 'center', gap: theme.space['2'], opacity: pressed ? 0.7 : 1 })}>
      <AppText variant="body" style={{ flex: 1, ...(selected ? { fontWeight: '600' } : {}) }}>
        {name}
      </AppText>
      <AppText variant="callout" color={status === TODAY_PICK_COPY.upNext ? 'accent' : 'text.secondary'} numeric>
        {status}
      </AppText>
      <View style={{ width: 20, alignItems: 'flex-end' }}>{selected ? <Icon name="checkmark" size={16} color="accent" /> : null}</View>
    </Pressable>
  );
  const link = (label: string, onPress: () => void) => (
    <Pressable key={label} accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => ({ minHeight: 52, paddingHorizontal: theme.space['4'], flexDirection: 'row', alignItems: 'center', opacity: pressed ? 0.7 : 1 })}>
      <AppText variant="body" style={{ flex: 1 }}>
        {label}
      </AppText>
      <Icon name="chevron.right" size={14} color="text.tertiary" />
    </Pressable>
  );
  return (
    <BottomCard visible={visible} onClose={onClose} footer={<TextButton label={TODAY_V2_COPY.close} tone="secondary" onPress={onClose} />}>
      <AppText variant="title2" accessibilityRole="header">
        {TODAY_PICK_COPY.title}
      </AppText>
      {rows.length + others.length > 0 ? (
        <Group>
          {rows.map((r) => dayRow(r.key, r.name, r.status, r.selected, r.accessibilityLabel))}
          {others.map((o) => dayRow(o.key, o.name, '', o.selected, o.selected ? `${o.name}, selected` : o.name))}
        </Group>
      ) : null}
      <Group>
        {link(TODAY_V2_COPY.buildYourOwn, onBuild)}
        {link(PAST_LOG_COPY.entry, onPastLog)}
        {link(TODAY_SCREEN_COPY.addActivity, onActivity)}
      </Group>
    </BottomCard>
  );
}

// ---------------------------------------------------------------------------
// Cards: the workout (collapsed / expanded), rest day, done

/** (Ben, 27 Oct) One text scale on the card: label/value rows 15 pt (labels regular secondary, values semibold). */
export const CARD_TEXT = { row: { fontSize: 15, lineHeight: 20 }, small: { fontSize: 14, lineHeight: 18 } } as const;

function ValueRows({ rows, onNote, onValue }: { rows: readonly LabelValueRow[]; /** The row's small note (`(1 left out)`) was tapped. */ onNote?: () => void; /** Rows whose value is a control (`Gym  Main Gym ⌄`), by label. */ onValue?: Readonly<Record<string, { onPress: () => void; accessibilityLabel: string }>> }) {
  const theme = useTheme();
  const ax = useAx();
  return (
    <View>
      {rows.map((r) => {
        const control = onValue?.[r.label];
        const plain = control === undefined && r.note === undefined;
        const label = (
          <AppText variant="callout" color="text.secondary" accessible={false} style={{ ...CARD_TEXT.row, ...(ax ? {} : { width: TODAY_SPACING.labelColumn }) }}>
            {r.label}
          </AppText>
        );
        const value = (
          <AppText variant="body" numeric accessible={false} style={{ ...CARD_TEXT.row, flexShrink: 1, fontWeight: '600' }}>
            {control !== undefined ? `${r.value} ⌄` : r.value}
          </AppText>
        );
        const rowStyle = { flexDirection: ax ? ('column' as const) : ('row' as const), alignItems: ax ? ('flex-start' as const) : ('center' as const), minHeight: 30, gap: ax ? 0 : theme.space['2'] };
        if (control !== undefined) {
          return (
            <Pressable key={r.label} accessibilityRole="button" accessibilityLabel={control.accessibilityLabel} onPress={control.onPress} style={({ pressed }) => ({ ...rowStyle, opacity: pressed ? 0.7 : 1 })}>
              {label}
              {value}
            </Pressable>
          );
        }
        return (
          <View key={r.label} accessible={plain} accessibilityLabel={`${r.label}, ${r.value}`} style={rowStyle}>
            {label}
            <View accessible={!plain} accessibilityLabel={`${r.label}, ${r.value}`} style={{ flexShrink: 1 }}>
              {value}
            </View>
            {r.note !== undefined ? (
              <Pressable accessibilityRole="button" accessibilityLabel={`${r.note.replace(/[()]/g, '')}. Shows what changed to fit`} hitSlop={{ top: 10, bottom: 10, left: 6, right: 10 }} onPress={onNote} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
                <AppText variant="callout" color="text.secondary" numeric style={CARD_TEXT.small}>
                  {r.note}
                </AppText>
              </Pressable>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

/** A secondary link or note on the card: 14 pt, secondary (Ben, 27 Oct). */
function SmallLink({ label, onPress, accessibilityLabel, tone = 'text.secondary' }: { label: string; onPress: () => void; accessibilityLabel?: string; tone?: 'text.secondary' | 'accent' }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} hitSlop={{ top: 12, bottom: 12, left: 4, right: 8 }} onPress={onPress} style={({ pressed }) => ({ minHeight: 28, justifyContent: 'center', alignSelf: 'flex-start', opacity: pressed ? 0.7 : 1 })}>
      <AppText variant="callout" color={tone} style={CARD_TEXT.small}>
        {label}
      </AppText>
    </Pressable>
  );
}

function CardShell({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return <View style={{ backgroundColor: theme.colors['bg.surface'], borderRadius: theme.radius.lg, padding: theme.space['4'], gap: theme.space['2'] }}>{children}</View>;
}

/**
 * Today's workout card (option C; Ben 27 Oct): `Push ⌄` (the day sheet), `Edit` top right, then `Main lift`,
 * `Exercises  5 (1 left out)` (the note opens the fit with Undo), `Est. time`, `Gym  Main Gym ⌄`. `Show exercises`
 * (remembered on this phone) and, when the coach has changes for today, `✦ 1 change` (the offer: Apply/Skip, rule 3).
 * Expanded: the moved / clash lines, `Back to plan day` on an edited card, the WorkoutList with the coach's value on its
 * row, `Why?`, and `Hide exercises` at the bottom. One text scale: rows 15 pt, notes and links 14 pt.
 */
export function TodayCard({
  view,
  open,
  why,
  moved,
  gymName,
  onGym,
  onTitle,
  onEdit,
  onToggle,
  onOffer,
  onTimeNote,
  onBackToPlan,
  onWhy,
}: {
  view: TodayCardView;
  open: boolean;
  why: boolean;
  moved: string | null;
  gymName: string | null;
  onGym: () => void;
  onTitle: () => void;
  onEdit: () => void;
  onToggle: () => void;
  onOffer: () => void;
  onTimeNote: () => void;
  onBackToPlan: () => void;
  onWhy: () => void;
}) {
  const theme = useTheme();
  const time = view.time;
  const gymLabel = gymName ?? TODAY_PICK_COPY.addGym;
  const tag =
    view.coachChanges > 0 ? (
      <Pressable accessibilityRole="button" accessibilityLabel={WORKOUT_LIST_COPY.changesLabel(view.coachChanges)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} onPress={onOffer} style={({ pressed }) => ({ minHeight: 30, paddingHorizontal: theme.space['3'], justifyContent: 'center', borderRadius: theme.radius.pill, borderWidth: 1, borderColor: theme.colors['border.control'], opacity: pressed ? 0.7 : 1 })}>
        <AppText variant="callout" color="accent" style={CARD_TEXT.small}>
          {WORKOUT_LIST_COPY.changes(view.coachChanges)}
        </AppText>
      </Pressable>
    ) : null;
  const toggleRow = (label: string) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space['2'], minHeight: 36 }}>
      <SmallLink label={label} onPress={onToggle} tone="accent" />
      {tag}
    </View>
  );
  return (
    <CardShell>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: theme.space['2'] }}>
        <Pressable accessibilityRole="button" accessibilityLabel={`${view.title}. Change today’s workout`} onPress={onTitle} style={({ pressed }) => ({ flexShrink: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: theme.space['1'], opacity: pressed ? 0.7 : 1 })}>
          <AppText variant="title2" style={{ flexShrink: 1 }}>
            {view.title}
          </AppText>
          <Icon name="chevron.down" size={16} color="text.secondary" />
        </Pressable>
        <TextButton label={TODAY_V2_COPY.edit} onPress={onEdit} />
      </View>
      <ValueRows
        rows={todayCardRows(view, gymLabel)}
        onNote={onTimeNote}
        onValue={{ [TODAY_PICK_COPY.gym]: { onPress: onGym, accessibilityLabel: `${TODAY_PICK_COPY.gym}, ${gymLabel}` } }}
      />
      {time?.overText != null ? (
        <AppText variant="callout" color="status.warning" numeric style={CARD_TEXT.small}>
          {time.overText}
        </AppText>
      ) : null}
      {open ? (
        <View style={{ gap: theme.space['2'] }}>
          {moved !== null ? (
            <AppText variant="callout" color="text.secondary" style={CARD_TEXT.small}>
              {moved}
            </AppText>
          ) : null}
          {view.clashLine !== null ? (
            <AppText variant="callout" color="status.warning" style={CARD_TEXT.small}>
              {view.clashLine}
            </AppText>
          ) : null}
          {view.edited !== null ? <SmallLink label={TODAY_V2_COPY.backToPlan} onPress={onBackToPlan} /> : null}
          <WorkoutList rows={view.list} target={view.listTarget} onCoach={() => { onOffer(); }} />
          <SmallLink label={TODAY_V2_COPY.why} accessibilityLabel={why ? 'Hide why' : 'Why this workout'} onPress={onWhy} />
          {why ? (
            <View style={{ gap: 2 }}>
              {view.why.map((l, i) => (
                <AppText key={`${String(i)}:${l}`} variant="callout" color="text.secondary" style={CARD_TEXT.small}>
                  {`· ${l}`}
                </AppText>
              ))}
            </View>
          ) : null}
          {toggleRow(WORKOUT_LIST_COPY.hideExercises)}
        </View>
      ) : (
        toggleRow(WORKOUT_LIST_COPY.showExercises)
      )}
    </CardShell>
  );
}

/** A rest day on a Set days plan: `Rest day`, `Next  Legs · Thu`. Start Plan Workout starts that day early. */
export function RestDayCard({ next, label }: { next: string; label: string }) {
  return (
    <View accessible accessibilityLabel={label}>
      <CardShell>
        <AppText variant="title2">{TODAY_PICK_COPY.restDay}</AppText>
        <ValueRows rows={[{ label: TODAY_PICK_COPY.next, value: next }]} />
      </CardShell>
    </View>
  );
}

/** Done today: `Push ✓`, `Time 47 min`, `New best 1`, `Summary ›`. */
export function DoneCard({ title, rows, onSummary }: { title: string; rows: readonly LabelValueRow[]; onSummary: () => void }) {
  const theme = useTheme();
  return (
    <CardShell>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}>
        <AppText variant="title2" style={{ flexShrink: 1 }}>
          {title}
        </AppText>
        <Icon name="checkmark.circle.fill" size={20} color="status.done" />
      </View>
      {rows.length > 0 ? <ValueRows rows={rows} /> : null}
      <View style={{ alignSelf: 'flex-start' }}>
        <TextButton label={TODAY_PICK_COPY.summary} accessibilityLabel={`${title} summary`} onPress={onSummary} />
      </View>
    </CardShell>
  );
}

/** The coach's offer for today (`✦ 1 change`): its line, the before → after lines, Apply / Skip (rule 3). */
export function OfferSheet({ visible, offer, onClose }: { visible: boolean; offer: { line: string; lines: readonly string[]; busy: boolean; onApply: () => void; onSkip: () => void } | null; onClose: () => void }) {
  const theme = useTheme();
  return (
    <BottomCard
      visible={visible && offer !== null}
      onClose={onClose}
      footer={
        offer === null ? null : (
          <View style={{ gap: theme.space['2'] }}>
            <PrimaryButton label={TODAY_V2_COPY.apply} disabled={offer.busy} onPress={offer.onApply} />
            <SecondaryButton label={TODAY_V2_COPY.skip} disabled={offer.busy} onPress={offer.onSkip} />
          </View>
        )
      }
    >
      {offer === null ? null : (
        <View style={{ gap: theme.space['2'] }} accessible accessibilityLabel={[offer.line, ...offer.lines].join('. ')}>
          <AppText variant="title2" accessibilityRole="header">
            {TODAY_SCREEN_COPY.changesForToday(offer.lines.length)}
          </AppText>
          <AppText variant="callout" color="text.secondary">
            {offer.line}
          </AppText>
          {offer.lines.map((l) => (
            <AppText key={l} variant="body" numeric>
              {l}
            </AppText>
          ))}
        </View>
      )}
    </BottomCard>
  );
}

// ---------------------------------------------------------------------------
// Recent (Ben, 27 Oct): the last three things done

/** (Ben, 27 Oct) The week tiles' marker at the start of a row (Recent, a day's sheet), so rows align. */
function RowMark({ mark }: { mark: WeekTileMark }) {
  const theme = useTheme();
  return <View accessible={false} style={{ width: 9, height: 9, borderRadius: 4.5, ...markStyle(mark, theme) }} />;
}

export function RecentList({ rows }: { rows: readonly { key: string; mark: WeekTileMark; title: string; health: boolean; line: string; accessibilityLabel: string; onPress: () => void }[] }) {
  const theme = useTheme();
  return (
    <Group>
      {rows.map((r) => (
        <Pressable key={r.key} accessibilityRole="button" accessibilityLabel={r.accessibilityLabel} onPress={r.onPress} style={({ pressed }) => ({ minHeight: 56, paddingHorizontal: theme.space['4'], paddingVertical: theme.space['2'], flexDirection: 'row', alignItems: 'center', gap: theme.space['3'], backgroundColor: pressed ? theme.colors['bg.raised'] : 'transparent' })}>
          <RowMark mark={r.mark} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <AppText variant="body" numberOfLines={1}>
              {r.title}
              {r.health ? <AppText variant="callout" color="text.tertiary" style={CARD_TEXT.small}>{' ♥'}</AppText> : null}
            </AppText>
            <AppText variant="callout" color="text.secondary" numeric>
              {r.line}
            </AppText>
          </View>
          <Icon name="chevron.right" size={14} color="text.tertiary" />
        </Pressable>
      ))}
    </Group>
  );
}

// ---------------------------------------------------------------------------
// The pinned dock (redesign v3 §A6)

export function StartDock({ plan, onPlan, onEmpty, busy, bottom }: { plan: 'enabled' | 'disabled' | 'hidden'; onPlan: () => void; onEmpty: () => void; busy: boolean; bottom: number }) {
  const theme = useTheme();
  return (
    <View style={{ paddingHorizontal: theme.components.screenMargin, paddingTop: theme.space['2'], paddingBottom: bottom, gap: theme.space['2'], backgroundColor: theme.colors['bg.canvas'], borderTopWidth: theme.dividerWidth, borderTopColor: theme.colors['border.divider'] }}>
      {plan !== 'hidden' ? <PrimaryButton label={TODAY_PICK_COPY.startPlan} busy={busy} disabled={plan === 'disabled'} onPress={onPlan} /> : null}
      <SecondaryButton label={TODAY_PICK_COPY.startEmpty} disabled={busy} onPress={onEmpty} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Your workout's options (D3), unchanged rows; the Options card wraps them on Your workout

function Chip({ label, selected, onPress, accessibilityLabel }: { label: string; selected: boolean; onPress: () => void; accessibilityLabel?: string }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected }}
      hitSlop={HIT}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 34,
        paddingHorizontal: theme.space['3'],
        justifyContent: 'center',
        borderRadius: theme.radius.pill,
        backgroundColor: selected ? theme.colors.accent : 'transparent',
        borderWidth: 1,
        borderColor: selected ? theme.colors.accent : theme.colors['border.divider'],
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <AppText variant="label" color={selected ? 'on.accent' : 'text.secondary'} style={{ fontSize: 15, lineHeight: 18 }}>
        {selected ? `● ${label}` : label}
      </AppText>
    </Pressable>
  );
}

function ControlRow({ label, sub, children }: { label: string; sub?: string | null; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space['2'], minHeight: ROW_H, flexWrap: 'wrap' }}>
      <View>
        <AppText variant="callout" color="text.secondary" style={{ fontSize: 15 }}>
          {label}
        </AppText>
        {sub ? (
          <AppText variant="callout" color="text.tertiary" style={{ fontSize: 12, lineHeight: 14 }}>
            {sub}
          </AppText>
        ) : null}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space['2'], justifyContent: 'flex-end', flexShrink: 1 }}>{children}</View>
    </View>
  );
}

/**
 * `Abs` / `Supersets`: the whole 44 pt row is the switch (review S9: a `hitSlop` on a View around a Switch doesn't
 * enlarge the Switch's own touch area on iOS). VoiceOver reads one switch with its state; the Switch inside only shows it.
 */
function ToggleRow({ label, sub, value, onChange }: { label: string; sub?: string | null; value: boolean; onChange: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={sub ? `${label}, ${sub}` : label}
      accessibilityState={{ checked: value }}
      onPress={onChange}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space['2'], minHeight: ROW_H, opacity: pressed ? 0.7 : 1 })}
    >
      <View>
        <AppText variant="callout" color="text.secondary" style={{ fontSize: 15 }}>
          {label}
        </AppText>
        {sub ? (
          <AppText variant="callout" color="text.tertiary" style={{ fontSize: 12, lineHeight: 14 }}>
            {sub}
          </AppText>
        ) : null}
      </View>
      <View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants">
        <Switch value={value} accessible={false} />
      </View>
    </Pressable>
  );
}

/**
 * (D3, Ben 22–23 Oct) The controls that left Today's card, on Your workout opened from Today: `Main lift` (only with more
 * than one template), `Accessories` Focused | Varied, `Abs` and `Supersets`. The same 44 pt rows as the card had; each
 * tap is one change the service makes (with Undo), never computed here.
 */
export function TodayOptionRows({ options, onChange, onMix }: { options: TodayOptions; onChange: (c: TodayOptionChange) => void; /** (Ben, 23 Oct) Your workout's fifth row, `↻ Mix it up`; absent: not shown. */ onMix?: () => void }) {
  const theme = useTheme();
  return (
    <View>
      {options.mainLifts.length > 1 ? (
        <ControlRow label={TODAY_V2_COPY.mainLift}>
          {options.mainLifts.map((m) => (
            <Chip key={m.exerciseId} label={m.label} selected={m.selected} accessibilityLabel={`Main lift, ${m.label}`} onPress={() => { if (!m.selected) onChange({ kind: 'main_lift', exerciseId: m.exerciseId }); }} />
          ))}
        </ControlRow>
      ) : null}
      <ControlRow label={TODAY_V2_COPY.accessories}>
        <Chip label={TODAY_V2_COPY.focused} selected={options.accessories === 'focused'} accessibilityLabel={`Accessories, ${TODAY_V2_COPY.focused}`} onPress={() => { if (options.accessories !== 'focused') onChange({ kind: 'accessories', style: 'focused' }); }} />
        <Chip label={TODAY_V2_COPY.varied} selected={options.accessories === 'varied'} accessibilityLabel={`Accessories, ${TODAY_V2_COPY.varied}`} onPress={() => { if (options.accessories !== 'varied') onChange({ kind: 'accessories', style: 'varied' }); }} />
      </ControlRow>
      <ToggleRow label={TODAY_V2_COPY.abs} value={options.abs} onChange={() => { onChange({ kind: 'abs', on: !options.abs }); }} />
      <ToggleRow label={TODAY_V2_COPY.supersets} value={options.supersets} onChange={() => { onChange({ kind: 'supersets', on: !options.supersets }); }} />
      {onMix !== undefined ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Mix it up" onPress={onMix} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', minHeight: ROW_H, opacity: pressed ? 0.7 : 1, gap: theme.space['2'] })}>
          <AppText variant="callout" style={{ fontSize: 15 }}>
            {TODAY_V2_COPY.mix}
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

