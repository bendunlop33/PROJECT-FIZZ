import { useEffect, useRef, type RefObject } from 'react';
import { AccessibilityInfo, Pressable, useWindowDimensions, View } from 'react-native';

import type { WhyRow } from '@fizz/domain';

import { useTheme } from '../../theme';
import { AppText, Icon } from '../../ui';
import { WHY_FAILED_TEXT, whyLinkLabel, whyRowAccessibilityLabel, type WhyPanel } from '../../workout/target-why';

/**
 * `TargetWhyLink` and `TargetWhyPanel` (active-workout.md §2.12 and §9; the
 * component spec waits there until design-system.md is free to merge it).
 * Inline under the target line, never a sheet, so Log stays visible (AW1).
 * Shows `explainTarget`'s rows as given: no text is made here.
 */

const LABEL_WIDTH = 96;

/** `slim`: on the Table's one-line sub-line (1.5), a 44 pt target by padding and hitSlop, not by height. */
export function TargetWhyLink({ open, onPress, slim = false }: { open: boolean; onPress: () => void; slim?: boolean }) {
  const theme = useTheme();
  const chevron = theme.components.linkAffordance === 'chevron';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={whyLinkLabel(open)}
      accessibilityState={{ expanded: open }}
      onPress={onPress}
      {...(slim ? { hitSlop: { top: 10, bottom: 10, left: 8, right: 8 } } : {})}
      style={({ pressed }) => (slim ? { paddingVertical: theme.space['1'], justifyContent: 'center', opacity: pressed ? 0.6 : 1 } : { minHeight: theme.target.workout.height, minWidth: theme.target.workout.width, alignItems: 'flex-end', justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['1'] }}>
        <AppText variant="callout" color="accent" style={chevron ? { textDecorationLine: 'underline' } : undefined}>
          {open ? 'Hide' : 'Why?'}
        </AppText>
        {chevron ? <Icon name={open ? 'chevron.up' : 'chevron.down'} color="accent" size={14} /> : null}
      </View>
    </Pressable>
  );
}

export function TargetWhyPanel({ panel, onPainFlag }: { panel: Exclude<WhyPanel, null>; onPainFlag?: (flagId: string) => void }) {
  const theme = useTheme();
  const { fontScale } = useWindowDimensions();
  // AX sizes: the label sits above its value instead of beside it.
  const stacked = fontScale >= 1.35;
  const first = useRef<View>(null);

  useEffect(() => {
    // VoiceOver moves to `Set by` when the panel opens (rule 6).
    if (panel.status === 'ready' && first.current) AccessibilityInfo.sendAccessibilityEvent(first.current, 'focus');
  }, [panel.status]);

  // A local read: usually done before a frame is drawn, so nothing flashes.
  if (panel.status === 'loading') return null;

  const box = { backgroundColor: theme.colors['bg.raised'], borderRadius: theme.radius.sm, padding: theme.space['3'], gap: theme.space['2'] } as const;
  if (panel.status === 'failed') {
    return (
      <View style={box}>
        <AppText variant="callout" color="text.secondary">
          {WHY_FAILED_TEXT}
        </AppText>
      </View>
    );
  }
  const { rows, basisEdited } = panel.explanation;
  return (
    <View style={box}>
      {rows.map((row, i) => (
        <Row key={row.key} row={row} stacked={stacked} innerRef={i === 0 ? first : undefined} onPainFlag={onPainFlag} />
      ))}
      {basisEdited ? (
        <View accessible accessibilityLabel={basisEdited} style={{ flexDirection: 'row', gap: theme.space['2'], alignItems: 'flex-start' }}>
          <Icon name="info.circle" size={16} />
          <AppText variant="callout" color="text.secondary" style={{ flex: 1 }}>
            {basisEdited}
          </AppText>
        </View>
      ) : null}
    </View>
  );
}

function Row({ row, stacked, innerRef, onPainFlag }: { row: WhyRow; stacked: boolean; innerRef?: RefObject<View | null> | undefined; onPainFlag?: ((flagId: string) => void) | undefined }) {
  const theme = useTheme();
  const link = row.link;
  if (!link || !onPainFlag) return <RowBody row={row} stacked={stacked} innerRef={innerRef} />;
  // `Check due ›` on the `Pain` row (§2.14.2) opens the pain flag sheet: a separate button after the row's text.
  return (
    <View style={{ gap: 2 }}>
      <RowBody row={row} stacked={stacked} innerRef={innerRef} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Pain flag check due. Opens the pain flag."
        onPress={() => {
          onPainFlag(link.flagId);
        }}
        style={({ pressed }) => ({ minHeight: theme.target.min.height, justifyContent: 'center', alignSelf: 'flex-start', marginLeft: stacked ? 0 : LABEL_WIDTH + theme.space['2'], opacity: pressed ? 0.6 : 1 })}
      >
        <AppText variant="callout" color="accent">
          {link.label}
        </AppText>
      </Pressable>
    </View>
  );
}

function RowBody({ row, stacked, innerRef }: { row: WhyRow; stacked: boolean; innerRef?: RefObject<View | null> | undefined }) {
  const theme = useTheme();
  return (
    <View ref={innerRef} accessible accessibilityLabel={whyRowAccessibilityLabel(row)} style={{ flexDirection: stacked ? 'column' : 'row', gap: stacked ? 2 : theme.space['2'] }}>
      {row.label === null ? null : (
        <AppText variant="label" color="text.secondary" style={stacked ? undefined : { width: LABEL_WIDTH }}>
          {row.label}
        </AppText>
      )}
      <View style={{ flex: stacked ? undefined : 1, gap: 2 }}>
        {row.lines.map((line, i) => (
          <View key={`${row.key}:${String(i)}`} style={{ flexDirection: 'row', gap: theme.space['1'], alignItems: 'flex-start' }}>
            {row.kind === 'warning' && i === 0 ? <Icon name="exclamationmark.triangle" color="status.warning" size={16} /> : null}
            <AppText variant="callout" color={i === 0 || row.kind === 'actual' ? 'text.primary' : 'text.secondary'} numeric style={{ flexShrink: 1 }}>
              {line}
            </AppText>
          </View>
        ))}
      </View>
    </View>
  );
}
