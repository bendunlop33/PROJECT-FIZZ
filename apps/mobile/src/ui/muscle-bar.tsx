import { useState } from 'react';
import { View } from 'react-native';

import type { MuscleBarLook } from '@fizz/domain';

import { useTheme } from '../theme';

/**
 * (Ben, 1 Nov) The one muscle bar: Progress › Training's `Muscles · sets` rows and Plan › Muscles draw this, so they
 * look the same. A track, the shaded goal range (when there is one), the fill (green in range, amber outside it,
 * neutral with no range or on a deload / lead-in / short week), and a thin done-so-far marker. Decoration only: every
 * number is printed next to it, and VoiceOver reads the row's words (`importantForAccessibility` off here).
 */
export function MuscleBar({ look, height }: { look: MuscleBarLook; height?: number }) {
  const theme = useTheme();
  const [track, setTrack] = useState(0);
  const h = height ?? theme.chart.countBar.height;
  const r = theme.chart.countBar.radius;
  const px = (share: number) => Math.round(share * track);
  const fill = look.tone === 'in' ? theme.colors['status.done'] : look.tone === 'out' ? theme.colors['status.warning'] : theme.colors['chart.bar'];
  return (
    <View
      testID="muscle-bar"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      onLayout={(e) => {
        setTrack(Math.floor(e.nativeEvent.layout.width));
      }}
      style={{ height: h, borderRadius: r, backgroundColor: theme.colors['bg.raised'], overflow: 'hidden' }}
    >
      {look.band !== null ? <View testID="muscle-bar-band" style={{ position: 'absolute', top: 0, bottom: 0, left: px(look.band.from), width: Math.max(2, px(look.band.to) - px(look.band.from)), backgroundColor: theme.colors['chart.bandFill'] }} /> : null}
      <View testID={`muscle-bar-fill-${look.tone}`} style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: look.fill > 0 ? Math.max(2, px(look.fill)) : 0, borderRadius: r, backgroundColor: fill }} />
      {look.marker !== null ? <View testID="muscle-bar-marker" style={{ position: 'absolute', top: 0, bottom: 0, left: Math.min(Math.max(0, px(look.marker) - 1), Math.max(0, track - 2)), width: 2, backgroundColor: theme.colors['text.primary'] }} /> : null}
    </View>
  );
}
