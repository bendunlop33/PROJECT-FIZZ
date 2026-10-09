import { useIsFocused, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useCallback, useMemo, useRef, useState } from 'react';
import { ScrollView, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GuideBoundary } from '../../guide/GuideBoundary';
import { MuscleFocusLegend } from '../../guide/MuscleFocusLegend';
import { buildHowToView, bundledHowToSources, howToLayout } from '../../guide/how-to';
import { loadGuidePlayer } from '../../guide/load-player';
import type { RootStackParams } from '../../navigation/types';
import { useTheme } from '../../theme';
import { AppText, Card, Icon, SectionHeader, StatusLine, Tag, TextButton } from '../../ui';

/** Guide canvas bounds in points (design-system `guide.canvasMax` / `guide.canvasMin`). It fills the player card's width. */
const MAX_GUIDE_SIZE = 400;
const MIN_GUIDE_SIZE = 200;

function CueList({ items }: { items: readonly string[] }) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.space['2'] }}>
      {items.map((text) => (
        <View key={text} style={{ flexDirection: 'row', gap: theme.space['2'] }}>
          <AppText variant="body" color="text.secondary" accessibilityElementsHidden importantForAccessibility="no">
            •
          </AppText>
          <AppText variant="body" style={{ flex: 1 }}>
            {text}
          </AppText>
        </View>
      ))}
    </View>
  );
}

/**
 * `AvoidList` (design-system §9.59, guides v2 §5.1): the entry's faults under
 * `What not to do`, in catalogue order. Reference, not a warning: no status
 * colour. The xmarks are decorative; VoiceOver reads each line as written.
 */
function AvoidList({ items }: { items: readonly string[] }) {
  const theme = useTheme();
  return (
    <Card>
      <AppText variant="headline" accessibilityRole="header">
        What not to do
      </AppText>
      <View style={{ gap: theme.space['2'] }}>
        {items.map((text) => (
          <View key={text} style={{ flexDirection: 'row', gap: theme.space['2'] }}>
            <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ paddingTop: 3 }}>
              <Icon name="xmark" size={16} color="text.secondary" />
            </View>
            <AppText variant="body" style={{ flex: 1 }}>
              {text}
            </AppText>
          </View>
        ))}
      </View>
    </Card>
  );
}

/**
 * How to (ADR 0013, guides v2): the exercise's animated guide with the
 * muscles to feel it in, What not to do, key positions, cues and safety
 * notes, from the bundled catalogue (Coaching knowledge; works
 * offline). Opened from the active workout's exercise menu and the exercise
 * picker. Exercises without a guide show their text cues only.
 *
 * Loaded lazily by the navigator, and the player (Skia) is required only here,
 * behind `GuideBoundary`: if Skia fails, How to shows the cues with a notice
 * and the workout underneath is untouched (review S1).
 */
export function HowToScreen() {
  const theme = useTheme();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const { width } = useWindowDimensions();
  const { catalogueKey, name } = useRoute<RouteProp<RootStackParams, 'HowTo'>>().params;
  const increaseContrast = theme.a11y.increaseContrast;
  // The legend's tint line (guides v2 §4.11.8) follows what the card draws; the app ships `neutral`, which has none.
  const view = useMemo(() => buildHowToView({ name, catalogueKey }, bundledHowToSources(), { increaseContrast }), [name, catalogueKey, increaseContrast]);
  const player = view.guide === null ? null : loadGuidePlayer();
  const [playerThrew, setPlayerThrew] = useState(false);
  const onPlayerError = useCallback(() => {
    setPlayerThrew(true);
  }, []);
  const layout = howToLayout(view, playerThrew || player?.ok === false);
  const Player = layout.showPlayer && player?.ok === true ? player.value : null;

  // The player pauses once it is scrolled out of sight (battery during rest).
  const playerBottom = useRef(Number.POSITIVE_INFINITY);
  const [scrolledAway, setScrolledAway] = useState(false);

  const margin = theme.components.screenMargin;
  // The canvas fills the card (no inner padding; the card's 1 pt border either side).
  const size = Math.max(MIN_GUIDE_SIZE, Math.min(MAX_GUIDE_SIZE, width - 2 * margin - 2));

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors['bg.canvas'] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space['3'], paddingHorizontal: margin, paddingVertical: theme.space['3'], backgroundColor: theme.colors['bg.surface'] }}>
        {/* Name only: the muscles moved into the player card as its legend (guides v2 §2.1). */}
        <View style={{ flex: 1 }}>
          <AppText variant="title2" accessibilityRole="header" numberOfLines={2}>
            {view.title}
          </AppText>
        </View>
        <TextButton
          label="Done"
          icon="xmark"
          tone="secondary"
          onPress={() => {
            navigation.goBack();
          }}
        />
      </View>
      <ScrollView
        scrollEventThrottle={100}
        onScroll={(e) => {
          const away = e.nativeEvent.contentOffset.y > playerBottom.current;
          if (away !== scrolledAway) setScrolledAway(away);
        }}
        contentContainerStyle={{ paddingHorizontal: margin, paddingTop: theme.space['4'], paddingBottom: theme.space['8'] + insets.bottom, gap: theme.space['5'] }}
      >
        {Player && view.guide ? (
          <View
            onLayout={(e) => {
              playerBottom.current = e.nativeEvent.layout.y + e.nativeEvent.layout.height;
            }}
          >
            <Card style={{ paddingHorizontal: 0, overflow: 'hidden', alignItems: 'center' }}>
              <View style={{ width: '100%' }}>
                <GuideBoundary onError={onPlayerError}>
                  <Player guide={view.guide} size={size} visible={focused && !scrolledAway} footer={<MuscleFocusLegend lines={view.legend} />} />
                </GuideBoundary>
              </View>
            </Card>
          </View>
        ) : null}

        {layout.notices.map((text) => (
          <StatusLine key={text} icon="info.circle" tone="info" text={text} />
        ))}

        {/* Unapproved text shown without the player's own `Draft guide` tag (spec §8.9 P5). */}
        {layout.textDraftLabel ? <Tag text={layout.textDraftLabel} /> : null}

        {/* No player: the muscle lines come first, without swatches (guides v2 §2.1, §8). */}
        {layout.standaloneLegend.length > 0 ? <MuscleFocusLegend lines={layout.standaloneLegend} /> : null}

        {/* Directly under the player: Ben asked for what NOT to do, and it's the quickest check mid-rest (guides v2 §2.1). */}
        {view.avoid.length > 0 ? <AvoidList items={view.avoid} /> : null}

        {view.guide && view.guide.stops.length > 0 ? (
          <View style={{ gap: theme.space['2'] }}>
            <SectionHeader title="Key positions" />
            {view.guide.stops.map((s) => (
              <View key={s.number} accessible accessibilityLabel={`${String(s.number)}, ${s.label}. ${s.caption ?? ''}`} style={{ gap: 2 }}>
                <AppText variant="headline" numeric>{`${String(s.number)} ${s.label}`}</AppText>
                {s.caption ? (
                  <AppText variant="callout" color="text.secondary">
                    {s.caption}
                  </AppText>
                ) : null}
              </View>
            ))}
          </View>
        ) : null}

        {view.setup.length > 0 ? (
          <View style={{ gap: theme.space['2'] }}>
            <SectionHeader title="Setup" />
            <CueList items={view.setup} />
          </View>
        ) : null}
        {view.execution.length > 0 ? (
          <View style={{ gap: theme.space['2'] }}>
            <SectionHeader title="How to do it" />
            <CueList items={view.execution} />
          </View>
        ) : null}
        {/* Reference text from the catalogue entry (spec §8.9 P1). No status colour; it never names a condition (rule 9). */}
        {view.safety.notes.length > 0 || view.safety.stopIf.length > 0 ? (
          <View style={{ gap: theme.space['2'] }}>
            <SectionHeader title="Safety" />
            <CueList items={view.safety.notes} />
            {view.safety.stopIf.length > 0 ? (
              <>
                <AppText variant="headline">Stop the set if:</AppText>
                <CueList items={view.safety.stopIf} />
              </>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}
