import { Pressable, View } from 'react-native';

import type { FitView, HowLongSheetView } from '@fizz/domain';

import { useTheme } from '../theme';
import { FIT_COPY } from '../workout/fit-view';
import { PrimaryButton, SecondaryButton, TextButton } from './buttons';
import { Icon } from './Icon';
import { OutlinePill } from './overview';
import { BottomCard } from './sheet';
import { AppText } from './Text';
import { Chip, ChipRow } from './workout';

/**
 * Fit to time (fit-to-time.md §3; design-system §9.73, §9.74):
 * `HowLongSheet` and `FitCard`. Direction D tokens only, no new values.
 * They show what the domain worked out (`howLongSheet`, `fitView`) and
 * compute nothing. Static: no spinner or progress animation anywhere.
 */

export interface HowLongSheetProps {
  visible: boolean;
  sheet: HowLongSheetView | null;
  /** `Other` was tapped: the 5-minute stepper shows. */
  otherOpen: boolean;
  /** `ⓘ` is open: the pace lines show. */
  infoOpen: boolean;
  busy: boolean;
  onChip: (minutes: number) => void;
  onOther: () => void;
  onStep: (delta: 5 | -5) => void;
  onInfo: () => void;
  onTrim: () => void;
  onAsk: () => void;
  onClear: () => void;
  onClose: () => void;
}

/** `How long?` (§3.2): `Now ≈ 62 min`, chips, `Trim to 45 min` (or `Fits already`), `Ask coach`, `Clear fit`. */
export function HowLongSheet({ visible, sheet, otherOpen, infoOpen, busy, onChip, onOther, onStep, onInfo, onTrim, onAsk, onClear, onClose }: HowLongSheetProps) {
  const theme = useTheme();
  const wheelValue = sheet?.selected ?? null;
  return (
    <BottomCard visible={visible} onClose={onClose}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space['3'] }}>
        <AppText variant="title2" accessibilityRole="header">
          {FIT_COPY.title}
        </AppText>
        <TextButton label={FIT_COPY.close} tone="secondary" onPress={onClose} />
      </View>
      {sheet === null ? null : (
        <>
          {sheet.nowText !== null ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <AppText variant="title2" numeric accessibilityLabel={sheet.nowText.replace('≈', 'about')}>
                <AppText variant="title2" color="text.secondary">
                  {'Now ≈ '}
                </AppText>
                {sheet.nowText.replace('Now ≈ ', '')}
              </AppText>
              {sheet.pace !== null ? (
                <Pressable accessibilityRole="button" accessibilityLabel={FIT_COPY.paceInfo} accessibilityState={{ expanded: infoOpen }} onPress={onInfo} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="info.circle" color="text.secondary" size={16} />
                </Pressable>
              ) : null}
            </View>
          ) : null}
          {infoOpen && sheet.pace !== null ? (
            <View accessible accessibilityLabel={`${FIT_COPY.yourPace}: ${sheet.pace.text}. ${sheet.pace.source}.`} style={{ gap: theme.space['1'] }}>
              <AppText variant="label" color="text.secondary">
                {FIT_COPY.yourPace}
              </AppText>
              <AppText variant="callout" numeric>
                {sheet.pace.text}
              </AppText>
              <AppText variant="callout" color="text.secondary">
                {sheet.pace.source}
              </AppText>
            </View>
          ) : null}
          <ChipRow>
            {sheet.chips.map((c) => (
              <Chip
                key={c.minutes}
                label={c.text}
                selected={c.selected}
                accessibilityLabel={c.accessibilityLabel}
                onPress={() => {
                  onChip(c.minutes);
                }}
              />
            ))}
            <Chip label={sheet.other.text} selected={sheet.other.selected || otherOpen} accessibilityLabel={sheet.other.selected ? `Other, ${sheet.other.text} minutes` : 'Other length'} onPress={onOther} />
          </ChipRow>
          {otherOpen && wheelValue !== null ? (
            // The `Other` length, 15–180 min in 5-minute steps (the Finish by sheet's stepper pattern).
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.space['4'] }} accessible accessibilityRole="adjustable" accessibilityLabel={`${String(wheelValue)} minutes`} accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]} onAccessibilityAction={(e) => {
              onStep(e.nativeEvent.actionName === 'increment' ? 5 : -5);
            }}>
              <StepButton label="−" spoken="5 minutes less" onPress={() => { onStep(-5); }} />
              <AppText variant="title2" numeric style={{ minWidth: 88, textAlign: 'center' }}>{`${String(wheelValue)} min`}</AppText>
              <StepButton label="+" spoken="5 minutes more" onPress={() => { onStep(5); }} />
            </View>
          ) : null}
          <PrimaryButton label={sheet.trim.text} disabled={!sheet.trim.enabled} busy={busy} onPress={onTrim} />
          <View style={{ gap: theme.space['1'] }}>
            <SecondaryButton label={sheet.ask.text} disabled={!sheet.ask.enabled || busy} onPress={onAsk} {...(sheet.ask.caption !== null ? { accessibilityLabel: `${sheet.ask.text}, ${sheet.ask.caption}` } : {})} />
            {sheet.ask.caption !== null ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.space['2'] }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                <Icon name="wifi.slash" color="text.secondary" size={14} />
                <AppText variant="callout" color="text.secondary">
                  {sheet.ask.caption}
                </AppText>
              </View>
            ) : null}
          </View>
          {sheet.clear ? <TextButton label={FIT_COPY.clear} tone="secondary" onPress={onClear} /> : null}
        </>
      )}
    </BottomCard>
  );
}

function StepButton({ label, spoken, onPress }: { label: string; spoken: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={spoken}
      onPress={onPress}
      style={({ pressed }) => ({ width: 44, height: 44, borderRadius: theme.radius.pill, borderWidth: 1, borderColor: theme.colors['border.control'], alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? theme.colors['bg.raised'] : 'transparent' })}
    >
      <AppText variant="headline">{label}</AppText>
    </Pressable>
  );
}

/** `SourceTag` `Coach`: icon and word, never colour alone. */
function CoachTag() {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: theme.colors['bg.raised'], borderRadius: theme.radius.sm, paddingVertical: theme.space['1'], paddingHorizontal: theme.space['2'] }}>
      <Icon name="text.bubble" color="text.secondary" size={12} />
      <AppText variant="label" color="text.secondary">
        Coach
      </AppText>
    </View>
  );
}

export interface FitCardProps {
  fit: FitView;
  /** After the first scroll the card is one line; a tap opens it again. */
  collapsed: boolean;
  onExpand: () => void;
  onUndo: () => void;
  onChange: () => void;
  /** Coach variant: `Why? ›`. */
  onWhy?: (() => void) | undefined;
}

/** `FitCard` (§3.3): `◷ Fitted to 45 min`, `≈ 62 → 44 min`, one line per cut, `Undo` and `Change`. */
export function FitCard({ fit, collapsed, onExpand, onUndo, onChange, onWhy }: FitCardProps) {
  const theme = useTheme();
  const surface = { backgroundColor: theme.colors['bg.surface'], borderRadius: theme.radius.md, marginTop: theme.space['3'] };
  if (collapsed) {
    return (
      <Pressable accessibilityRole="button" accessibilityLabel={`${fit.accessibilityLabel} ${FIT_COPY.showFit}`} onPress={onExpand} style={({ pressed }) => ({ ...surface, minHeight: 52, paddingHorizontal: theme.space['3'], flexDirection: 'row', alignItems: 'center', gap: theme.space['2'], opacity: pressed ? 0.7 : 1 })}>
        <Icon name="clock" color="text.primary" size={15} />
        <AppText variant="callout" numeric style={{ flex: 1 }}>
          {fit.collapsed}
        </AppText>
        <Icon name="chevron.right" color="text.secondary" size={12} />
      </Pressable>
    );
  }
  return (
    <View style={{ ...surface, padding: theme.space['3'], gap: theme.space['1'] }}>
      <View accessible accessibilityRole="summary" accessibilityLabel={fit.accessibilityLabel} style={{ gap: theme.space['1'] }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.space['2'] }}>
          {fit.by === 'coach' ? <CoachTag /> : <Icon name="clock" color="text.primary" size={15} />}
          <AppText variant="headline">{fit.title}</AppText>
        </View>
        <AppText variant="body" numeric>
          {fit.beforeAfter}
        </AppText>
        {fit.lines.map((l) => (
          <AppText key={l} variant="callout" color="text.secondary" numeric>
            {l}
          </AppText>
        ))}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: theme.space['2'], marginTop: theme.space['2'] }}>
        <View style={{ flexDirection: 'row', gap: theme.space['2'] }}>
          <OutlinePill label={FIT_COPY.undo} accessibilityLabel={FIT_COPY.undoSpoken(fit.minutes)} onPress={onUndo} />
          {onWhy ? <OutlinePill label={FIT_COPY.why} onPress={onWhy} /> : null}
        </View>
        <OutlinePill label={FIT_COPY.change} accessibilityLabel={FIT_COPY.changeSpoken} onPress={onChange} />
      </View>
    </View>
  );
}

/**
 * The coach fit's own card (§3.4, §6): `[Coach] Fitting to 45 min…` with
 * `Cancel` while it works (static, no spinner: the page stays usable), then
 * `No answer from the coach`, `Couldn’t use the coach’s version` or `Plan
 * changed` with their buttons.
 */
export function CoachFitStatusCard({ text, actions, onAction }: { text: string; actions: readonly ('cancel' | 'trim' | 'why' | 'dismiss' | 'ask_again')[]; onAction: (a: 'cancel' | 'trim' | 'why' | 'dismiss' | 'ask_again') => void }) {
  const theme = useTheme();
  const label = { cancel: FIT_COPY.cancel, trim: FIT_COPY.trimInstead, why: FIT_COPY.why, dismiss: FIT_COPY.dismiss, ask_again: FIT_COPY.askAgain } as const;
  return (
    <View style={{ backgroundColor: theme.colors['bg.surface'], borderRadius: theme.radius.md, marginTop: theme.space['3'], padding: theme.space['3'], gap: theme.space['2'] }}>
      <View accessible accessibilityLiveRegion="polite" accessibilityLabel={`Coach. ${text}`} style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.space['2'] }}>
        <CoachTag />
        <AppText variant="headline" numeric>
          {text}
        </AppText>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: theme.space['2'] }}>
        {actions.map((a) => (
          <OutlinePill
            key={a}
            label={label[a]}
            onPress={() => {
              onAction(a);
            }}
          />
        ))}
      </View>
    </View>
  );
}

/** A coach swap suggestion (§3.3, FT-C12): `Today only`, the change, `Not now` and `Apply`. Nothing is swapped until Apply. */
export function FitSuggestionCard({ text, busy, onApply, onNotNow }: { text: string; busy: boolean; onApply: () => void; onNotNow: () => void }) {
  const theme = useTheme();
  return (
    <View style={{ borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors['border.control'], padding: theme.space['3'], gap: theme.space['2'], marginTop: theme.space['2'] }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.space['2'] }}>
        <CoachTag />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: theme.colors['border.control'], borderRadius: theme.radius.sm, paddingVertical: theme.space['1'], paddingHorizontal: theme.space['2'] }}>
          <Icon name="calendar" color="text.primary" size={12} />
          <AppText variant="label">{FIT_COPY.todayOnly}</AppText>
        </View>
      </View>
      <View accessible accessibilityLabel={`Swap today: ${text.replace('→', 'to')}`} style={{ flexDirection: 'row', gap: theme.space['2'] }}>
        <Icon name="arrow.left.arrow.right" color="text.primary" size={13} />
        <AppText variant="callout" style={{ flex: 1 }}>
          {text}
        </AppText>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: theme.space['2'] }}>
        <OutlinePill label={FIT_COPY.notNow} onPress={onNotNow} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Apply: ${text.replace('→', 'to')}, today only`}
          accessibilityState={{ disabled: busy }}
          disabled={busy}
          onPress={onApply}
          style={({ pressed }) => ({ minHeight: theme.target.min.height, paddingHorizontal: theme.space['4'], borderRadius: theme.radius.pill, borderWidth: 1, borderColor: theme.colors.accent, backgroundColor: pressed ? theme.colors['accent.subtle'] : 'transparent', justifyContent: 'center' })}
        >
          <AppText variant="label" color="accent">
            {FIT_COPY.apply}
          </AppText>
        </Pressable>
      </View>
    </View>
  );
}

/** `Why?` on the coach's fit (§7.2): its reason, the checks it passed, and what wasn't used. */
export function FitWhySheet({ visible, reason, checks, notUsed, onClose }: { visible: boolean; reason: string | null; checks: readonly string[]; notUsed: readonly string[]; onClose: () => void }) {
  const theme = useTheme();
  return (
    <BottomCard visible={visible} onClose={onClose}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <AppText variant="title2" accessibilityRole="header">
          {FIT_COPY.whyTitle}
        </AppText>
        <TextButton label={FIT_COPY.close} tone="secondary" onPress={onClose} />
      </View>
      {reason !== null ? <AppText variant="body">{`“${reason}”`}</AppText> : null}
      {checks.map((c) => (
        <View key={c} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}>
          <Icon name="checkmark" color="text.secondary" size={13} />
          <AppText variant="callout" color="text.secondary">
            {c}
          </AppText>
        </View>
      ))}
      {notUsed.length > 0 ? (
        <View style={{ gap: theme.space['1'] }}>
          <AppText variant="label" color="text.secondary">
            {FIT_COPY.notUsed}
          </AppText>
          {notUsed.map((n) => (
            <AppText key={n} variant="callout" color="text.secondary">
              {n}
            </AppText>
          ))}
        </View>
      ) : null}
    </BottomCard>
  );
}
