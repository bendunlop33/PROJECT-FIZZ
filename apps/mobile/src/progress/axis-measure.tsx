import { useState } from 'react';
import { useWindowDimensions, View } from 'react-native';

import { AppText } from '../ui';
import { axisWidthFor, TICK_MAX_SCALE } from './axis-width';

/**
 * The y-axis width for these tick labels (design pass 6.3): estimated first, then measured by an
 * invisible copy of the labels at their real size. Render `measure` inside the chart.
 */
export function useAxisWidth(labels: readonly string[], min?: number): { width: number; measure: React.JSX.Element } {
  const { fontScale } = useWindowDimensions();
  const key = labels.join('|');
  const [measured, setMeasured] = useState<{ key: string; width: number } | null>(null);
  const width = axisWidthFor(labels, fontScale, measured?.key === key ? measured.width : null, min);
  const measure = (
    <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ position: 'absolute', left: -10000, top: 0, opacity: 0, alignItems: 'flex-start' }}>
      {labels.map((l, i) => (
        <AppText
          key={`${String(i)}-${l}`}
          variant="label"
          numeric
          maxFontSizeMultiplier={TICK_MAX_SCALE}
          onLayout={(e) => {
            const w = Math.ceil(e.nativeEvent.layout.width);
            setMeasured((m) => (m?.key === key && m.width >= w ? m : { key, width: Math.max(w, m?.key === key ? m.width : 0) }));
          }}
        >
          {l}
        </AppText>
      ))}
    </View>
  );
  return { width, measure };
}
