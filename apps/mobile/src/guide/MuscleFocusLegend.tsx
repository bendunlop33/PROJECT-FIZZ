import { View } from 'react-native';

import type { LegendLine } from '@fizz/catalogue';
import { GUIDE_MUSCLE_COLOR, MUSCLE_OPACITY } from '@fizz/catalogue/figure';

import { useTheme } from '../theme';
import { AppText } from '../ui';

/** Swatch diameter (design-system `guide.legendSwatch`). */
const SWATCH = 12;

/** ● strong: filled. ◐ soft: the hue at the soft opacity inside a 1 pt ring, so it differs in shape as well as tone. */
function Swatch({ kind }: { kind: 'most' | 'also' }) {
  const theme = useTheme();
  const hue = GUIDE_MUSCLE_COLOR[theme.scheme];
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: SWATCH, height: SWATCH, marginTop: 4 }}>
      {kind === 'most' ? (
        <View style={{ width: SWATCH, height: SWATCH, borderRadius: SWATCH / 2, backgroundColor: hue }} />
      ) : (
        <View style={{ width: SWATCH, height: SWATCH, borderRadius: SWATCH / 2, borderWidth: 1, borderColor: hue, overflow: 'hidden' }}>
          <View style={{ flex: 1, backgroundColor: hue, opacity: MUSCLE_OPACITY.soft }} />
        </View>
      )}
    </View>
  );
}

/**
 * `MuscleFocusLegend` (design-system §9.58, guides v2 §5.3): `Feel it most:`,
 * `Also works:` and `Not shown from this side:`. The text always names the
 * muscles, so the colour on the figure is never the only signal. Each line is
 * one VoiceOver element; swatches are decorative. Not tappable.
 */
export function MuscleFocusLegend({ lines }: { lines: readonly LegendLine[] }) {
  const theme = useTheme();
  if (lines.length === 0) return null;
  const anySwatch = lines.some((l) => l.swatch);
  return (
    <View style={{ gap: theme.space['2'] }}>
      {lines.map((line) => (
        <View key={line.kind} accessible accessibilityLabel={line.accessibilityLabel} style={{ flexDirection: 'row', gap: theme.space['2'] }}>
          {/* Lines keep one indent when any line has a swatch, so the text aligns. */}
          {line.swatch && line.kind !== 'notShown' ? <Swatch kind={line.kind} /> : anySwatch ? <View style={{ width: SWATCH }} /> : null}
          <AppText variant="callout" color={line.kind === 'notShown' ? 'text.secondary' : 'text.primary'} style={{ flex: 1 }}>
            <AppText variant="callout" color={line.kind === 'notShown' ? 'text.secondary' : 'text.primary'} style={{ fontWeight: '600' }}>
              {line.label}
            </AppText>
            {` ${line.list}`}
          </AppText>
        </View>
      ))}
    </View>
  );
}
