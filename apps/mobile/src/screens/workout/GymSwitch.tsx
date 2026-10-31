import { Modal, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { ChangeLine, NoteLine } from '@fizz/domain';
import type { SessionAggregate } from '@fizz/schemas';

import type { GymChoice } from '../../services/workout-services';
import { useTheme } from '../../theme';
import { AppText, Card, Icon, PrimaryButton, SecondaryButton, Tag, TextButton } from '../../ui';
import { gymChipLabel, reviewSheetView, type CardButton, type OpenSwitchCard, type SwitchCardView } from '../../workout/gym-switch-card';

/**
 * The gym switch's pieces on the workout screen (gym-switch.md §2): the gym
 * chip, the switcher sheet, the card in the coach slot, the review sheet,
 * `SnapNote` and `GymPartDivider` (§9; specified there because
 * design-system.md is being edited elsewhere). Every word comes from the
 * domain proposal or `switchCardView`; nothing here decides a load.
 */

/** `GymChip`: the workout's gym; opens `Gym for this workout`. 44pt. */
export function GymChip({ gymName, onPress }: { gymName: string | null; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={gymChipLabel(gymName)}
      onPress={onPress}
      style={({ pressed }) => ({
        alignSelf: 'flex-start',
        // 1.8: a long gym name gives way (ellipsis) so the workout name stays visible.
        flexShrink: 1,
        minWidth: 0,
        maxWidth: 120,
        minHeight: theme.target.min.height,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space['1'],
        paddingHorizontal: theme.space['3'],
        borderRadius: theme.radius.pill,
        borderWidth: 1,
        borderColor: theme.colors['border.control'],
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Icon name="building.2" size={16} />
      <AppText variant="callout" numberOfLines={1} style={{ flexShrink: 1 }}>
        {gymName ?? 'Choose gym'}
      </AppText>
      <Icon name="chevron.down" size={12} />
    </Pressable>
  );
}

/** `Gym for this workout` (gym-editor §2.7): one row per gym; the workout's own is checked. */
export function GymSwitcherSheet({ visible, gyms, onChoose, onClose }: { visible: boolean; gyms: GymChoice[] | null; onChoose: (g: GymChoice) => void; onClose: () => void }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: theme.colors['bg.surface'] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', padding: theme.space['4'] }}>
          <AppText variant="title2" accessibilityRole="header" style={{ flex: 1 }}>
            Gym for this workout
          </AppText>
          <TextButton label="Close" tone="secondary" onPress={onClose} />
        </View>
        <ScrollView contentContainerStyle={{ paddingHorizontal: theme.space['4'], paddingBottom: theme.space['4'] + insets.bottom, gap: theme.space['2'] }}>
          {gyms === null ? (
            <AppText variant="callout" color="text.secondary">
              Loading gyms…
            </AppText>
          ) : (
            gyms.map((g) => (
              <Pressable
                key={g.id}
                accessibilityRole="button"
                accessibilityState={{ selected: g.current }}
                accessibilityLabel={`${g.name}${g.current ? ', current gym' : ''}, ${g.items === 0 ? 'no equipment set up yet' : `${String(g.items)} items`}`}
                onPress={() => {
                  onChoose(g);
                }}
                style={({ pressed }) => ({
                  minHeight: 52,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: theme.space['3'],
                  paddingVertical: theme.space['3'],
                  borderBottomWidth: theme.dividerWidth,
                  borderColor: theme.colors['border.divider'],
                  opacity: pressed ? 0.6 : 1,
                })}
              >
                <Icon name={g.current ? 'checkmark.circle.fill' : 'circle'} color={g.current ? 'accent' : 'text.tertiary'} />
                <View style={{ flex: 1, gap: 2 }}>
                  <AppText variant="body">{g.name}</AppText>
                  <AppText variant="callout" color="text.secondary">
                    {g.items === 0 ? 'No equipment set up yet' : `${String(g.items)} ${g.items === 1 ? 'item' : 'items'}`}
                  </AppText>
                </View>
              </Pressable>
            ))
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

/** `NoteLine` (§9.43): `ⓘ` facts in `text.secondary`, `⚠` warnings in `status.warning`. Icon and words, never colour alone. */
export function SnapNote({ note, action, muted = false }: { note: NoteLine; action?: { label: string; onPress: () => void } | null; muted?: boolean }) {
  const theme = useTheme();
  const warn = note.tone === 'warning' && !muted;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space['2'] }} accessible={!action} accessibilityLabel={`${note.tone === 'warning' ? 'Warning' : 'Note'}: ${note.text}`}>
      <View style={{ paddingTop: 2 }}>
        <Icon name={note.tone === 'warning' ? 'exclamationmark.triangle' : 'info.circle'} color={warn ? 'status.warning' : 'text.secondary'} size={16} />
      </View>
      <AppText variant="callout" color="text.secondary" numeric style={{ flex: 1 }}>
        {note.text}
      </AppText>
      {action ? <TextButton label={action.label} onPress={action.onPress} /> : null}
    </View>
  );
}

/** `GymPartDivider` (§9): `── At Hotel · Lisbon ──` between an exercise's parts done at different gyms. */
export function GymPartDivider({ label }: { label: string }) {
  const theme = useTheme();
  const rule = { flex: 1, height: theme.dividerWidth, backgroundColor: theme.colors['border.divider'] };
  return (
    <View accessible accessibilityRole="header" accessibilityLabel={`Sets from here on ${label.replace(/^At /, 'at ').replaceAll(' · ', ' ')}`} style={{ minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}>
      <View style={rule} />
      <Icon name="building.2" size={14} />
      <AppText variant="label" color="text.secondary">
        {label}
      </AppText>
      <View style={rule} />
    </View>
  );
}

function Line({ line, muted }: { line: ChangeLine; muted: boolean }) {
  const theme = useTheme();
  const tone = muted ? 'text.secondary' : 'text.primary';
  return (
    <View accessible accessibilityLabel={line.accessibilityLabel} style={{ gap: theme.space['1'] }}>
      <View style={{ flexDirection: 'row', gap: theme.space['2'], alignItems: 'flex-start' }}>
        <Icon name="pencil" size={14} color={muted ? 'text.tertiary' : 'text.secondary'} />
        <AppText variant="callout" color={tone} style={{ flex: 1, fontWeight: '600' }}>{`${line.exerciseName} · ${line.setsLabel}`}</AppText>
      </View>
      <View style={{ paddingLeft: theme.space['5'], gap: theme.space['1'] }}>
        <AppText variant="callout" color={tone} numeric>
          {line.target}
        </AppText>
        {line.after !== null ? (
          <AppText variant="callout" color={tone} numeric>
            {line.after}
          </AppText>
        ) : null}
        {line.notes.map((n) => (
          <SnapNote key={n.text} note={n} muted={muted} />
        ))}
      </View>
    </View>
  );
}

/**
 * The switch card (§2.2, §2.3), inline in the coach slot. Its buttons are
 * secondary-style, so `Log …` stays the screen's only primary; 52pt, at
 * least `space.8` apart. No animation (principle 5).
 */
export function GymSwitchCard({ view, onButton }: { view: SwitchCardView; onButton: (id: CardButton) => void }) {
  const theme = useTheme();
  return (
    <Card>
      <View style={{ gap: theme.space['3'] }}>
        <View style={{ gap: theme.space['2'] }}>
          {view.tags ? (
            <View style={{ flexDirection: 'row', gap: theme.space['2'], flexWrap: 'wrap' }}>
              <Tag icon="checkmark.seal" text={view.tags[0] ?? 'Checks'} />
              {view.tags[1] ? <Tag icon="calendar" text={view.tags[1]} /> : null}
            </View>
          ) : null}
          <AppText variant="headline" accessibilityRole="header">
            {view.title}
          </AppText>
        </View>
        {view.status ? <SnapNote note={{ tone: view.status.tone, text: view.status.text }} /> : null}
        {view.lead ? <SnapNote note={view.lead} /> : null}
        {view.notChanged.map((t) => (
          <AppText key={t} variant="callout" numeric>
            {t}
          </AppText>
        ))}
        {view.summary ? (
          <AppText variant="callout" numeric>
            {view.summary}
          </AppText>
        ) : null}
        {view.wasSuggested ? (
          <AppText variant="callout" color="text.secondary">
            Was suggested:
          </AppText>
        ) : null}
        {view.lines.map((l) => (
          <Line key={`${l.exerciseName}:${l.setsLabel}`} line={l} muted={view.muted} />
        ))}
        {view.unchanged ? (
          <AppText variant="callout" color="text.secondary">
            {view.unchanged}
          </AppText>
        ) : null}
        {view.unchecked ? <SnapNote note={view.unchecked} /> : null}
        {/* 2.7: the pills share the row and wrap rather than clip (`Review all 6 changes ›` at 375 pt). */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: theme.space['3'], rowGap: theme.space['2'] }}>
          {view.buttons.map((b) => (
            <SecondaryButton
              key={b.id}
              label={b.label}
              workout
              grow
              {...(b.disabled !== undefined ? { disabled: b.disabled } : {})}
              onPress={() => {
                onButton(b.id);
              }}
            />
          ))}
        </View>
      </View>
    </Card>
  );
}

/**
 * The review sheet (§2.4) for 5 or more change lines; its primary is `Switch`, or `Try
 * again` / `Check again` in the error and Out of date states (§3.1, review B3). Large
 * detent, Log one swipe away. `Close` keeps the card; `Not now` dismisses it, as on the card.
 */
export function GymReviewSheet({ card, aggregate, onButton, onClose }: { card: OpenSwitchCard | null; aggregate: SessionAggregate; onButton: (id: CardButton) => void; onClose: () => void }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const v = card ? reviewSheetView(card, aggregate) : null;
  return (
    <Modal visible={v !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: theme.colors['bg.surface'] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', padding: theme.space['4'] }}>
          <AppText variant="title2" accessibilityRole="header" style={{ flex: 1 }}>
            {v?.title ?? ''}
          </AppText>
          <TextButton label="Close" tone="secondary" onPress={onClose} />
        </View>
        {v ? (
          <ScrollView contentContainerStyle={{ paddingHorizontal: theme.space['4'], gap: theme.space['3'], paddingBottom: theme.space['6'] }}>
            {v.tags ? (
              <View style={{ flexDirection: 'row', gap: theme.space['2'] }}>
                <Tag icon="checkmark.seal" text={v.tags[0] ?? 'Checks'} />
                <Tag icon="calendar" text={v.tags[1] ?? 'Today only'} />
              </View>
            ) : null}
            {v.status ? <SnapNote note={{ tone: v.status.tone, text: v.status.text }} /> : null}
            {v.notChanged.map((t) => (
              <AppText key={t} variant="callout">
                {t}
              </AppText>
            ))}
            <AppText variant="label" color="text.secondary">
              All values are targets.
            </AppText>
            {v.wasSuggested ? (
              <AppText variant="callout" color="text.secondary">
                Was suggested:
              </AppText>
            ) : (
              <AppText variant="headline">{`Changes (${String(v.lines.length)})`}</AppText>
            )}
            {v.lines.map((l, i) => (
              <Line key={`${l.exerciseName}:${l.setsLabel}:${String(i)}`} line={l} muted={v.muted} />
            ))}
            {v.unchanged ? (
              <AppText variant="callout" color="text.secondary">
                {v.unchanged}
              </AppText>
            ) : null}
          </ScrollView>
        ) : null}
        {v ? (
          <View style={{ padding: theme.space['4'], paddingBottom: theme.space['4'] + insets.bottom, gap: theme.space['2'] }}>
            <TextButton
              label={v.secondary.label}
              tone="secondary"
              {...(v.secondary.disabled !== undefined ? { disabled: v.secondary.disabled } : {})}
              onPress={() => {
                onButton(v.secondary.id);
              }}
            />
            <PrimaryButton
              label={v.primary.label}
              {...(v.primary.disabled !== undefined ? { disabled: v.primary.disabled } : {})}
              onPress={() => {
                onButton(v.primary.id);
              }}
            />
          </View>
        ) : null}
      </View>
    </Modal>
  );
}
