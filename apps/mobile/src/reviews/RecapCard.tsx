import { useState } from 'react';
import { Pressable, View } from 'react-native';

import type { MonthlyRecapView } from '@fizz/domain';

import { haptic } from '../device/haptics';
import { useAx } from '../progress/components';
import { useTheme } from '../theme';
import { AppText, BottomCard, Icon } from '../ui';
import { PROGRESS_TEXT, ProgressCard } from './charts';

/**
 * The monthly recap (Ben approved 26 Oct): a card at the top of Progress › Overview on the 1st–7th, for the month
 * just ended (`October` · `12 workouts · 9 h 40 min · 3 records`), with `×` to dismiss; a tap opens the facts in a
 * sheet against the month before. Lays out `MonthlyRecapView`; computes nothing. Records and lifts open their
 * workout. Copy is values only (minimal copy, Ben 10 Oct).
 */
export function RecapCard({ view, onDismiss, onOpenWorkout }: { view: MonthlyRecapView; onDismiss: () => void; onOpenWorkout: (sessionId: string) => void }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <>
      <ProgressCard>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={view.accessibilityLabel}
            onPress={() => {
              haptic('step');
              setOpen(true);
            }}
            style={({ pressed }) => ({ flex: 1, minHeight: 44, justifyContent: 'center', gap: 2, opacity: pressed ? 0.7 : 1 })}
          >
            <AppText variant="headline" style={PROGRESS_TEXT.title}>
              {view.title}
            </AppText>
            <AppText variant="callout" color="text.secondary" numeric>
              {`${view.line} ›`}
            </AppText>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Dismiss ${view.title} recap`}
            onPress={onDismiss}
            hitSlop={6}
            style={({ pressed }) => ({ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.7 : 1 })}
          >
            <Icon name="xmark" color="text.tertiary" size={14} />
          </Pressable>
        </View>
      </ProgressCard>
      <RecapSheet
        view={view}
        visible={open}
        onClose={() => {
          setOpen(false);
        }}
        onOpenWorkout={(sessionId) => {
          setOpen(false);
          onOpenWorkout(sessionId);
        }}
      />
    </>
  );
}

const short = (month: string) => month.slice(0, 3);

/** The recap in full: each fact with the month before beside it. */
export function RecapSheet({ view, visible, onClose, onOpenWorkout }: { view: MonthlyRecapView; visible: boolean; onClose: () => void; onOpenWorkout: (sessionId: string) => void }) {
  const theme = useTheme();
  const ax = useAx();
  const head = (title: string) => (
    <AppText variant="sectionLabel" color="text.tertiary" accessibilityRole="header" style={{ marginTop: theme.space['2'] }}>
      {title.toUpperCase()}
    </AppText>
  );
  const pair = (key: string, label: string, value: string, previous: string, words: string) => (
    <View key={key} accessible accessibilityLabel={words} style={{ flexDirection: ax ? 'column' : 'row', alignItems: ax ? 'flex-start' : 'center', gap: ax ? 0 : theme.space['2'], minHeight: 36, borderTopWidth: theme.dividerWidth, borderColor: theme.colors['border.divider'] }}>
      <AppText variant="body" style={{ flex: ax ? undefined : 1 }}>
        {label}
      </AppText>
      <AppText variant="body" numeric align="right" style={ax ? undefined : { width: 96 }}>
        {value}
      </AppText>
      <AppText variant="callout" color="text.secondary" numeric align="right" style={ax ? undefined : { width: 96 }}>
        {ax ? `${short(view.previousTitle)} ${previous}` : previous}
      </AppText>
    </View>
  );
  const link = (key: string, title: string, detail: string, words: string, sessionId: string) => (
    <Pressable
      key={key}
      accessibilityRole="button"
      accessibilityLabel={words}
      onPress={() => {
        onOpenWorkout(sessionId);
      }}
      style={({ pressed }) => ({ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: theme.space['2'], borderTopWidth: theme.dividerWidth, borderColor: theme.colors['border.divider'], backgroundColor: pressed ? theme.colors['bg.raised'] : 'transparent' })}
    >
      <View style={{ flex: 1, gap: 2, paddingVertical: theme.space['1'] }}>
        <AppText variant="body">{title}</AppText>
        <AppText variant="callout" color="text.secondary" numeric>
          {detail}
        </AppText>
      </View>
      <Icon name="chevron.right" color="text.tertiary" size={14} />
    </Pressable>
  );
  return (
    <BottomCard visible={visible} onClose={onClose}>
      <AppText variant="title2" accessibilityRole="header">
        {view.title}
      </AppText>
      <View>
        {ax ? null : (
          <View style={{ flexDirection: 'row', gap: theme.space['2'] }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <View style={{ flex: 1 }} />
            <AppText variant="sectionLabel" color="text.tertiary" align="right" style={{ width: 96 }}>
              {short(view.title).toUpperCase()}
            </AppText>
            <AppText variant="sectionLabel" color="text.tertiary" align="right" style={{ width: 96 }}>
              {short(view.previousTitle).toUpperCase()}
            </AppText>
          </View>
        )}
        {view.stats.map((s) => pair(s.label, s.label, s.value, s.previous, s.words))}
        {view.plan !== null ? pair('plan', 'Weeks at your aim', view.plan.text, '', view.plan.words) : null}
      </View>
      {view.timeNote !== null ? (
        <AppText variant="callout" color="text.secondary" numeric>
          {view.timeNote}
        </AppText>
      ) : null}
      {view.muscles.length > 0 ? (
        <View>
          {head('Sets')}
          {view.muscles.map((m) => pair(m.key, m.label, m.value, m.previous, m.words))}
        </View>
      ) : null}
      {view.lifts.length > 0 ? (
        <View>
          {head('Lifts')}
          {view.lifts.map((l) => link(l.exerciseId, l.name, `${l.text} ${l.unit}`, l.words, l.sessionId))}
        </View>
      ) : null}
      {view.records.length > 0 ? (
        <View>
          {head('Records')}
          {view.records.map((r) => link(r.key, r.exercise, `${r.text} · ${r.date}`, r.words, r.sessionId))}
        </View>
      ) : null}
    </BottomCard>
  );
}
