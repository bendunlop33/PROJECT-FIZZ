import { useIsFocused, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useCallback, useMemo, useRef, useState } from 'react';
import { ScrollView, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GuideBoundary } from '../../guide/GuideBoundary';
import { buildHowToView, bundledHowToSources, howToLayout } from '../../guide/how-to';
import { loadGuidePlayer } from '../../guide/load-player';
import type { RootStackParams } from '../../navigation/types';
import { useTheme } from '../../theme';
import { AppText, Card, SectionHeader, StatusLine, TextButton } from '../../ui';

/** Largest guide canvas; it stays legible down to about 240 pt (the narrowest phone with margins). */
const MAX_GUIDE_SIZE = 360;

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
 * How to (ADR 0013): the exercise's animated guide, key positions, cues and
 * common mistakes, from the bundled catalogue (Coaching knowledge; works
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
  const view = useMemo(() => buildHowToView({ name, catalogueKey }, bundledHowToSources()), [name, catalogueKey]);
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
  const size = Math.max(200, Math.min(MAX_GUIDE_SIZE, width - 2 * margin - 2 * theme.space['4']));

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors['bg.canvas'] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space['3'], paddingHorizontal: margin, paddingVertical: theme.space['3'], backgroundColor: theme.colors['bg.surface'] }}>
        <View style={{ flex: 1, gap: 2 }}>
          <AppText variant="title2" accessibilityRole="header" numberOfLines={2}>
            {view.title}
          </AppText>
          {view.muscles ? (
            <AppText variant="callout" color="text.secondary">
              {view.muscles}
            </AppText>
          ) : null}
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
            <Card>
              <GuideBoundary onError={onPlayerError}>
                <Player guide={view.guide} size={size} visible={focused && !scrolledAway} />
              </GuideBoundary>
            </Card>
          </View>
        ) : null}

        {layout.notices.map((text) => (
          <StatusLine key={text} icon="info.circle" tone="info" text={text} />
        ))}

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
        {view.mistakes.length > 0 ? (
          <View style={{ gap: theme.space['2'] }}>
            <SectionHeader title="Common mistakes" />
            <CueList items={view.mistakes} />
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}
