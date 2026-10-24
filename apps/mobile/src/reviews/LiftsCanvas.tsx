import { Canvas, Circle, DashPathEffect, Line, Path, Skia, vec } from '@shopify/react-native-skia';

import type { LiftsChartLayout } from './lifts-layout';

/**
 * The Lifts chart drawn with Skia (ADR 0013; the prototype's SVG): gridlines, one line per lift in its
 * colour, filled points (hollow for an estimate, larger for the newest), PB rings, the gutter targets or the focused
 * lift's dashed target, the dotted `at this rate` line and the tracked-reps marker. No text (labels are
 * native views over it) and no animation. Required lazily (`loadLiftsCanvas`), so a Skia failure costs the
 * drawing, never the screen. Hidden from VoiceOver; the wrapping view carries the summary.
 */
export interface LiftsCanvasProps {
  layout: LiftsChartLayout;
  colours: readonly string[];
  grid: string;
  surface: string;
  target: string;
  marker: string;
  lineWidth: number;
}

export function LiftsCanvas({ layout, colours, grid, surface, target, marker, lineWidth }: LiftsCanvasProps) {
  const { plot } = layout;
  return (
    <Canvas style={{ width: layout.width, height: layout.height }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {layout.ticks.map((t) => (
        <Line key={`g${t.label}`} p1={vec(plot.left, t.y)} p2={vec(plot.right, t.y)} color={grid} strokeWidth={1} />
      ))}
      {layout.target !== null ? (
        <Line p1={vec(plot.left, layout.target.y)} p2={vec(plot.right, layout.target.y)} color={target} strokeWidth={1}>
          <DashPathEffect intervals={[4, 4]} />
        </Line>
      ) : null}
      {layout.marker !== null ? (
        <Line p1={vec(layout.marker.x, plot.top)} p2={vec(layout.marker.x, plot.bottom)} color={marker} strokeWidth={1}>
          <DashPathEffect intervals={[2, 3]} />
        </Line>
      ) : null}
      {layout.lines.map((l) => {
        const c = colours[l.colour] ?? colours[0] ?? target;
        const path = Skia.Path.Make();
        l.points.forEach((p, i) => {
          if (i === 0) path.moveTo(p.x, p.y);
          else path.lineTo(p.x, p.y);
        });
        return [
          layout.eta !== null ? (
            <Line key={`${l.key}-eta`} p1={vec(layout.eta.x1, layout.eta.y1)} p2={vec(layout.eta.x2, layout.eta.y2)} color={c} strokeWidth={2}>
              <DashPathEffect intervals={[2, 4]} />
            </Line>
          ) : null,
          l.gutter !== null ? (
            <Line key={`${l.key}-guide`} p1={vec(l.gutter.guideFromX, l.gutter.y)} p2={vec(plot.right + 4, l.gutter.y)} color={c} opacity={0.35} strokeWidth={1}>
              <DashPathEffect intervals={[2, 3]} />
            </Line>
          ) : null,
          l.gutter !== null ? <Line key={`${l.key}-bar`} p1={vec(plot.right + 6, l.gutter.y)} p2={vec(plot.right + 14, l.gutter.y)} color={c} strokeWidth={3} strokeCap="round" /> : null,
          l.points.length > 1 ? <Path key={`${l.key}-line`} path={path} style="stroke" strokeWidth={lineWidth + 0.4} strokeJoin="round" color={c} /> : null,
          // PB rings (the prototype: r 8 on the newest point, 6.5 elsewhere; 1.4 pt at 80%).
          ...l.points.map((p, i) => (p.ring ? <Circle key={`${l.key}-pb${String(i)}`} cx={p.x} cy={p.y} r={p.last ? 8 : 6.5} style="stroke" strokeWidth={1.4} opacity={0.8} color={c} /> : null)),
          ...l.points.map((p, i) => {
            const r = p.last ? 4.5 : p.estimate ? 3.4 : 2.8;
            return p.estimate
              ? [<Circle key={`${l.key}-e${String(i)}`} cx={p.x} cy={p.y} r={r} color={surface} />, <Circle key={`${l.key}-s${String(i)}`} cx={p.x} cy={p.y} r={r} style="stroke" strokeWidth={1.6} color={c} />]
              : [<Circle key={`${l.key}-p${String(i)}`} cx={p.x} cy={p.y} r={r} color={c} />];
          }),
        ];
      })}
    </Canvas>
  );
}
