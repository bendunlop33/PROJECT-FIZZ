import { useMemo, useRef, type ReactNode } from 'react';
import { PanResponder, Pressable, View } from 'react-native';

import { NBSP, type SetGlance } from '@fizz/domain';

import { haptic } from '../../device/haptics';
import { useTheme } from '../../theme';
import { AppText, Eyebrow, Icon, SecondaryButton, TEXT_PRESSED_OPACITY, TextButton } from '../../ui';
import { claimsDrag, swipeIntent, type PagerView } from '../../workout/set-pager';

/**
 * F7, F8 (Ben, build 151): the set pager and the rest screen's `Last set` /
 * `Next` blocks. Everything shown comes from `setGlance`, `setNavigation`
 * and `pagerView`; these only lay it out and report taps. Viewing another
 * set never changes which set Log logs.
 */

const plain = (s: string) => s.replaceAll(NBSP, ' ');

/** Swipe left / right on its children: next / previous. A vertical drag stays the scroll view's. */
function Swipeable({ onSwipe, children }: { onSwipe: (d: 'prev' | 'next') => void; children: ReactNode }) {
  const latest = useRef(onSwipe);
  latest.current = onSwipe;
  const responder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) => claimsDrag(g.dx, g.dy),
        onPanResponderTerminationRequest: () => true,
        onPanResponderRelease: (_e, g) => {
          const d = swipeIntent(g.dx, g.dy);
          if (d !== null) {
            haptic('step');
            latest.current(d);
          }
        },
      }),
    [],
  );
  return <View {...responder.panHandlers}>{children}</View>;
}

function ArrowButton({ direction, enabled, onPress }: { direction: 'prev' | 'next'; enabled: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={direction === 'prev' ? 'Previous set' : 'Next set'}
      accessibilityState={{ disabled: !enabled }}
      disabled={!enabled}
      onPress={onPress}
      style={({ pressed }) => ({ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', opacity: !enabled ? 0.3 : pressed ? TEXT_PRESSED_OPACITY : 1 })}
    >
      <Icon name={direction === 'prev' ? 'chevron.left' : 'chevron.right'} size={20} color="text.primary" />
    </Pressable>
  );
}

/**
 * `‹  Bench press · Set 2 of 4  ›` with the set's type and state, plus
 * `Table`. Swipe it left or right. `Now` shows once Ben is away from the
 * current set.
 */
export function SetPager({ pager, onMove, onNow, onTable }: { pager: PagerView; onMove: (d: 'prev' | 'next') => void; onNow: () => void; onTable: (() => void) | null }) {
  const theme = useTheme();
  return (
    <Swipeable onSwipe={onMove}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['1'] }}>
        <ArrowButton direction="prev" enabled={pager.canPrev} onPress={() => { onMove('prev'); }} />
        <View accessible accessibilityLabel={pager.accessibilityLabel} accessibilityHint="Swipe left or right for other sets" style={{ flex: 1, alignItems: 'center' }}>
          <AppText variant="callout" numberOfLines={1} numeric>
            {pager.title}
          </AppText>
          <AppText variant="label" color="text.tertiary" numberOfLines={1}>
            {pager.detail}
          </AppText>
        </View>
        <ArrowButton direction="next" enabled={pager.canNext} onPress={() => { onMove('next'); }} />
        {pager.away ? <TextButton label="Now" accessibilityLabel="Back to the current set" onPress={onNow} /> : onTable !== null ? <TextButton label="Table" tone="secondary" onPress={onTable} /> : null}
      </View>
    </Swipeable>
  );
}

/** A set Ben is viewing (not the current one): its value and what he can do with it. Log still logs the current set. */
export function ViewedSetCard({ glance, pager, onEdit, onMakeCurrent }: { glance: SetGlance; pager: PagerView; onEdit: () => void; onMakeCurrent: () => void }) {
  const theme = useTheme();
  return (
    <View style={{ backgroundColor: theme.colors['bg.surface'], borderRadius: theme.radius.lg, padding: theme.space['4'], gap: theme.space['3'] }}>
      <AppText variant="title2" numeric>
        {plain(glance.value)}
      </AppText>
      {glance.effort !== null && (glance.effort.rpe !== null || glance.effort.rir !== null) ? (
        <AppText variant="callout" color="text.secondary" numeric>
          {glance.effort.rpe !== null ? `RPE ${String(glance.effort.rpe)}` : `RIR ${String(glance.effort.rir)}`}
        </AppText>
      ) : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space['3'] }}>
        {pager.canEdit ? <SecondaryButton workout label="Edit" accessibilityLabel={`Edit set ${String(glance.setNumber)}`} onPress={onEdit} /> : null}
        {pager.canMakeCurrent ? <SecondaryButton workout label="Make current" onPress={onMakeCurrent} /> : null}
      </View>
    </View>
  );
}

/**
 * Under the rest timer (F8): the set just done, compact but editable (tap
 * it; the effort chips stay), and the next set in an equal block: exercise,
 * set number and type, `weight × reps @RPE`, `Edit`. ‹ › on the next block
 * view other sets; `Make current` changes which one Log logs.
 */
export function RestSetBlocks({
  last,
  effort,
  next,
  pager,
  onEditLast,
  onEditNext,
  onMove,
  onNow,
  onMakeCurrent,
}: {
  last: SetGlance | null;
  /** The effort chips (6–10, or RIR) for the last set; null when effort is off. */
  effort: ReactNode;
  /** The set the next block shows: the current one, or the one Ben is viewing. */
  next: SetGlance | null;
  pager: PagerView | null;
  onEditLast: () => void;
  onEditNext: () => void;
  onMove: (d: 'prev' | 'next') => void;
  onNow: () => void;
  onMakeCurrent: () => void;
}) {
  const theme = useTheme();
  const block = { backgroundColor: theme.colors['bg.surface'], borderRadius: theme.radius.lg, padding: theme.space['4'], gap: theme.space['2'], minHeight: 148 } as const;
  return (
    <View style={{ gap: theme.space['3'] }}>
      {last !== null ? (
        <View style={block}>
          <Eyebrow>Last set</Eyebrow>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Last set: ${plain(last.accessibilityLabel)}`}
            accessibilityHint="Edit this set"
            onPress={onEditLast}
            style={({ pressed }) => ({ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: theme.space['2'], opacity: pressed ? TEXT_PRESSED_OPACITY : 1 })}
          >
            <AppText variant="callout" color="text.secondary" numberOfLines={1} style={{ flexShrink: 1 }}>
              {`${last.exerciseName} · Set ${String(last.setNumber)}`}
            </AppText>
            <AppText variant="headline" numeric style={{ flex: 1 }}>
              {plain(last.value)}
            </AppText>
            <Icon name="pencil" size={14} color="text.tertiary" />
          </Pressable>
          {effort}
        </View>
      ) : null}
      {next !== null ? (
        <Swipeable onSwipe={onMove}>
          <View style={block}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ flex: 1 }}>
                <Eyebrow>{next.isCurrent ? 'Next' : next.status === 'done' ? 'Done' : next.status === 'skipped' ? 'Skipped' : 'Later'}</Eyebrow>
              </View>
              {pager !== null ? (
                <>
                  <ArrowButton direction="prev" enabled={pager.canPrev} onPress={() => { onMove('prev'); }} />
                  <ArrowButton direction="next" enabled={pager.canNext} onPress={() => { onMove('next'); }} />
                </>
              ) : null}
            </View>
            <View accessible accessibilityLabel={next.accessibilityLabel}>
              <AppText variant="title2" numberOfLines={2}>
                {next.exerciseName}
              </AppText>
              <AppText variant="callout" color="text.secondary" numeric>
                {`Set ${String(next.setNumber)} of ${String(next.setCount)} · ${next.setTypeLabel}`}
              </AppText>
              <AppText variant="title1" numeric>
                {plain(next.value)}
              </AppText>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space['3'] }}>
              {next.status !== 'skipped' ? <SecondaryButton workout label="Edit" accessibilityLabel={`Edit set ${String(next.setNumber)}`} onPress={onEditNext} /> : null}
              {pager?.canMakeCurrent === true ? <SecondaryButton workout label="Make current" onPress={onMakeCurrent} /> : null}
              {pager?.away === true ? <TextButton label="Now" accessibilityLabel="Back to the next set" onPress={onNow} /> : null}
            </View>
          </View>
        </Swipeable>
      ) : null}
    </View>
  );
}
