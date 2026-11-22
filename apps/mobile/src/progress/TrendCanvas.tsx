import { Canvas, Circle, DashPathEffect, Line, Path, Rect, RoundedRect, Skia, vec } from '@shopify/react-native-skia';

import type { TrendLayout } from './trend-layout';

/**
 * The exercise `TrendChart` plot, drawn with Skia (progress.md §7.1,
 * design-system §9.23, ADR 0013): horizontal gridlines, the line broken at
 * gaps (or volume bars), points (hollow for FitNotes on a combined series),
 * and the selected point by size, ring and a 1pt guide line, never by hue
 * alone (Direction D's accent is close to the line colour). No text and no
 * animation: labels are native views over the canvas, and nothing moves on
 * load, chip changes or selection. Required lazily through
 * `loadTrendCanvas`, so a Skia failure costs the drawing, not the screen.
 * Hidden from VoiceOver; the wrapping view carries the summary.
 */
export interface TrendCanvasProps {
  layout: TrendLayout;
  width: number;
  height: number;
  bars: boolean;
  hollow: readonly boolean[];
  selected: number | null;
  colors: { line: string; point: string; selected: string; grid: string; bar: string; surface: string };
  lineWidth: number;
  pointSize: number;
  pointSelectedSize: number;
  gridWidth: number;
  /** A dashed second line through `layout.overlayYs` (the trailing average), thinner than the main line. */
  overlay?: { color: string; width: number } | null;
  /** (Ben, 20 Oct) The lift target's level (`layout.targetY`): a thin dotted line, no colour meaning. */
  targetColor?: string | null;
}

export function TrendCanvas({ layout, width, height, bars, hollow, selected, colors, lineWidth, pointSize, pointSelectedSize, gridWidth, overlay = null, targetColor = null }: TrendCanvasProps) {
  const { plot } = layout;
  const overlayYs = layout.overlayYs ?? [];
  const overlayPath = (() => {
    if (overlay === null || overlayYs.length < 2) return null;
    const p = Skia.Path.Make();
    overlayYs.forEach((y, i) => {
      const x = layout.xs[i] ?? 0;
      if (i === 0) p.moveTo(x, y);
      else p.lineTo(x, y);
    });
    return p;
  })();
  const paths = bars
    ? []
    : layout.segments
        .filter((seg) => seg.length > 1)
        .map((seg) => {
          const p = Skia.Path.Make();
          seg.forEach((i, k) => {
            const x = layout.xs[i] ?? 0;
            const y = layout.ys[i] ?? 0;
            if (k === 0) p.moveTo(x, y);
            else p.lineTo(x, y);
          });
          return p;
        });
  const sel = selected === null ? null : { x: layout.xs[selected] ?? 0, y: layout.ys[selected] ?? 0 };
  const r = pointSize / 2;
  const rs = pointSelectedSize / 2;
  return (
    <Canvas style={{ width, height }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {layout.yTicks.map((t) => (
        <Line key={`g${t.label}`} p1={vec(plot.x, t.y)} p2={vec(plot.x + plot.width, t.y)} color={colors.grid} strokeWidth={gridWidth} />
      ))}
      <Line p1={vec(plot.x, plot.y + plot.height)} p2={vec(plot.x + plot.width, plot.y + plot.height)} color={colors.grid} strokeWidth={gridWidth} />
      {layout.targetY !== undefined && targetColor !== null ? (
        <Line p1={vec(plot.x, layout.targetY)} p2={vec(plot.x + plot.width, layout.targetY)} color={targetColor} strokeWidth={1.5} strokeCap="round">
          <DashPathEffect intervals={[2, 4]} />
        </Line>
      ) : null}
      {sel ? <Rect x={sel.x - 0.5} y={plot.y} width={1} height={plot.height} color={colors.selected} /> : null}
      {bars
        ? layout.bars.map((b, i) => <RoundedRect key={`b${String(i)}`} x={b.x} y={b.y} width={b.width} height={b.height} r={Math.min(2, b.width / 2)} color={i === selected ? colors.line : colors.bar} />)
        : null}
      {overlayPath !== null && overlay !== null ? (
        <Path path={overlayPath} style="stroke" strokeWidth={overlay.width} strokeJoin="round" color={overlay.color}>
          <DashPathEffect intervals={[6, 5]} />
        </Path>
      ) : null}
      {paths.map((p, i) => (
        <Path key={`l${String(i)}`} path={p} style="stroke" strokeWidth={lineWidth} strokeJoin="round" strokeCap="round" color={colors.line} />
      ))}
      {bars
        ? null
        : layout.xs.map((x, i) =>
            hollow[i] === true ? (
              [
                <Circle key={`hf${String(i)}`} cx={x} cy={layout.ys[i] ?? 0} r={r} color={colors.surface} />,
                <Circle key={`hs${String(i)}`} cx={x} cy={layout.ys[i] ?? 0} r={r} style="stroke" strokeWidth={2} color={colors.point} />,
              ]
            ) : (
              <Circle key={`p${String(i)}`} cx={x} cy={layout.ys[i] ?? 0} r={r} color={colors.point} />
            ),
          )}
      {sel ? (
        // Selected: a larger point, a 2pt gap in the surface colour, then a 2pt ring.
        [
          <Circle key="s-ring" cx={sel.x} cy={bars ? plot.y + 4 : sel.y} r={rs + 4} style="stroke" strokeWidth={2} color={colors.selected} />,
          <Circle key="s-gap" cx={sel.x} cy={bars ? plot.y + 4 : sel.y} r={rs + 2} color={colors.surface} />,
          <Circle key="s-dot" cx={sel.x} cy={bars ? plot.y + 4 : sel.y} r={rs} color={colors.point} />,
        ]
      ) : null}
    </Canvas>
  );
}
