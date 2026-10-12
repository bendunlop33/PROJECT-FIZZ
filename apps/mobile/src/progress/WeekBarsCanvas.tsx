import { Canvas, Rect, RoundedRect } from '@shopify/react-native-skia';

import type { BarRect } from './chart-layout';

/**
 * The `WeekBars` plot, drawn with Skia (progress.md §7.1, ADR 0013): bars
 * only, no text, no animation. Required lazily through `loadWeekBarsCanvas`,
 * so a Skia load failure costs the drawing (plain views take over), never the
 * tab. Hidden from VoiceOver: the card's label carries the numbers.
 */
export function WeekBarsCanvas({
  bars,
  width,
  height,
  radius,
  barColor,
  partialColor,
  stubColor,
}: {
  bars: readonly BarRect[];
  width: number;
  height: number;
  radius: number;
  barColor: string;
  /** A part week's bar: `barColor` mixed into the card (opaque, so the two shapes don't double up). */
  partialColor: string;
  stubColor: string;
}) {
  return (
    <Canvas style={{ width, height }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {bars.map((b, i) =>
        b.zero ? (
          <Rect key={String(i)} x={b.x} y={b.y} width={b.width} height={b.height} color={stubColor} />
        ) : (
          // Top corners rounded: a rounded bar with its lower corners squared off by a plain rect.
          [
            <RoundedRect key={`${String(i)}r`} x={b.x} y={b.y} width={b.width} height={b.height} r={Math.min(radius, b.height / 2)} color={b.partial ? partialColor : barColor} />,
            <Rect key={`${String(i)}s`} x={b.x} y={b.y + b.height / 2} width={b.width} height={b.height / 2} color={b.partial ? partialColor : barColor} />,
          ]
        ),
      )}
    </Canvas>
  );
}
