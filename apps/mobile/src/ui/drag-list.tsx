import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { Animated, PanResponder, View, type GestureResponderEvent, type StyleProp, type ViewStyle } from 'react-native';

import { nowMs } from '../clock';
import { haptic } from '../device/haptics';
import { useTheme } from '../theme';
import { DRAG, dragStep, dropTargetAt, type DragFrame, type DragPhase, type DropTarget } from './drag-logic';

/**
 * Press-and-hold drag, built once (workout-builder-v3 §2.3, §9 Q18;
 * workout-table-v3 §7) and used by the builder's Your workout, the workout's
 * set rows and its Workout sheet. The rules are `drag-logic.ts` (tested);
 * this measures rows, animates the dragged one and draws where it would land.
 *
 * A row is a `DragItem`. The hold starts on the row's own buttons: each
 * spreads `useDragHandle()` (a 320 ms long press, which also stops the tap),
 * so text fields and steppers never start a drag. Once held, the list takes
 * the touch from the row, its swipes and the page (`onDragChange` lets the
 * page stop scrolling), until the finger lifts: a drop, or, without a move,
 * the row's menu (the fallback; VoiceOver users have the same actions on the
 * row). Needs a real iPhone check (ScrollView hand-off, haptics).
 */

interface DragContext {
  phase: DragPhase;
  target: DropTarget | null;
  enabled: boolean;
  /** Each row's view, measured in the window when a hold fires (rows may sit in nested boxes). */
  items: { current: Map<string, View | null> };
  arm: (key: string, draggable: boolean) => void;
  /** A hold has fired (read at the touch, not at the last render). */
  holding: () => boolean;
  touch: (kind: 'down' | 'move' | 'up' | 'cancel', key: string, e: GestureResponderEvent | null) => void;
  offset: Animated.Value;
}

const Ctx = createContext<DragContext | null>(null);
const ItemCtx = createContext<{ key: string; draggable: boolean } | null>(null);

export interface DragListProps {
  /** Off: rows behave as before (no hold, no drag). */
  enabled: boolean;
  /** A drop on a row's middle means onto it (a superset); off: only before / after. */
  allowOnto?: boolean;
  /** Where a row may land (e.g. only among sets not done yet, never past a started round). */
  canDrop?: (fromKey: string, target: DropTarget) => boolean;
  onDrop: (fromKey: string, target: DropTarget) => void;
  /** A hold released without moving: the row's menu (Move up / Move down, Change type, Delete…). */
  onMenu?: (key: string) => void;
  /** A drag started or ended: the page stops (and restarts) scrolling. */
  onDragChange?: (active: boolean) => void;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}

export function DragList(p: DragListProps) {
  const [phase, setPhaseState] = useState<DragPhase>({ kind: 'idle' });
  const phaseRef = useRef<DragPhase>({ kind: 'idle' });
  const [target, setTarget] = useState<DropTarget | null>(null);
  const frames = useRef(new Map<string, DragFrame>());
  const items = useRef(new Map<string, View | null>());
  const startPage = useRef(0);
  const offset = useRef(new Animated.Value(0)).current;
  const latest = useRef(p);
  latest.current = p;

  const setPhase = (next: DragPhase) => {
    const prev = phaseRef.current;
    const wasActive = prev.kind === 'armed' || prev.kind === 'dragging';
    const active = next.kind === 'armed' || next.kind === 'dragging';
    phaseRef.current = next;
    // Only what the rows draw re-renders them (a held or dragged row), never every tap's press and release.
    if (wasActive || active) {
      if (!(prev.kind === next.kind && 'key' in prev && 'key' in next && prev.key === next.key)) setPhaseState(next);
    }
    if (wasActive !== active) latest.current.onDragChange?.(active);
  };

  const targetFor = (key: string, pageY: number): DropTarget | null => {
    if (frames.current.size === 0) return null;
    const canDrop = latest.current.canDrop;
    return dropTargetAt([...frames.current.values()], key, pageY, { allowOnto: latest.current.allowOnto === true, ...(canDrop === undefined ? {} : { canDrop: (t: DropTarget) => canDrop(key, t) }) });
  };

  const ctx = useMemo<Omit<DragContext, 'phase' | 'target' | 'enabled'>>(() => {
    const step = (e: Parameters<typeof dragStep>[1]) => {
      const r = dragStep(phaseRef.current, e);
      switch (r.effect.kind) {
        case 'armed':
          haptic('step');
          // Where every row is now, in the window (the touch's page y is in the same space).
          frames.current = new Map();
          for (const [key, view] of items.current) {
            view?.measureInWindow((_x, y, _w, h) => {
              frames.current.set(key, { key, y, h });
            });
          }
          break;
        case 'menu':
          offset.setValue(0);
          latest.current.onMenu?.(r.effect.key);
          break;
        case 'drop': {
          const t = targetFor(r.effect.key, r.effect.y);
          offset.setValue(0);
          setTarget(null);
          if (t !== null) latest.current.onDrop(r.effect.key, t);
          break;
        }
        case 'cancelled':
          offset.setValue(0);
          setTarget(null);
          break;
        case 'none':
          break;
      }
      setPhase(r.phase);
      return r.phase;
    };
    return {
      items,
      offset,
      holding: () => phaseRef.current.kind === 'armed' || phaseRef.current.kind === 'dragging',
      arm: (key, draggable) => {
        if (phaseRef.current.kind === 'pressing' && phaseRef.current.key === key) step({ kind: 'hold', atMs: nowMs(), draggable });
      },
      touch: (kind, key, e) => {
        const n = e?.nativeEvent;
        if (kind === 'down' && n !== undefined) {
          startPage.current = n.pageY;
          step({ kind: 'down', key, x: n.pageX, y: n.pageY, atMs: nowMs() });
          return;
        }
        if (kind === 'move' && n !== undefined) {
          const ph = step({ kind: 'move', x: n.pageX, y: n.pageY });
          if (ph.kind === 'dragging') {
            offset.setValue(n.pageY - startPage.current);
            setTarget(targetFor(ph.key, n.pageY));
          }
          return;
        }
        step({ kind: kind === 'up' ? 'up' : 'cancel' });
      },
    };
  }, [offset]);

  const value: DragContext = { ...ctx, phase, target, enabled: p.enabled };
  return (
    <Ctx.Provider value={value}>
      <View style={p.style}>{p.children}</View>
    </Ctx.Provider>
  );
}

/** One row of a `DragList`. `draggable` false: it can still be a drop target and still opens its menu on a hold. */
export function DragItem({ dragKey, draggable, children }: { dragKey: string; draggable: boolean; children: ReactNode }) {
  const theme = useTheme();
  const c = useContext(Ctx);
  const ph = c?.phase ?? { kind: 'idle' as const };
  const active = c !== null && ph.kind === 'dragging' && ph.key === dragKey;
  const holding = useRef<() => boolean>(() => false);
  holding.current = c === null ? () => false : c.holding;
  const responder = useMemo(
    () =>
      PanResponder.create({
        // Once a hold has fired, the list takes the touch (the row's tap, its swipe, the page's swipe).
        onMoveShouldSetPanResponderCapture: () => holding.current(),
        onStartShouldSetPanResponderCapture: () => false,
        onPanResponderTerminationRequest: () => !holding.current(),
      }),
    [],
  );
  if (c === null || !c.enabled) return <ItemCtx.Provider value={{ key: dragKey, draggable: false }}>{children}</ItemCtx.Provider>;
  const t = c.target?.key === dragKey ? c.target.edge : null;
  return (
    <ItemCtx.Provider value={{ key: dragKey, draggable }}>
      <Animated.View
        ref={(v: View | null) => {
          if (v === null) c.items.current.delete(dragKey);
          else c.items.current.set(dragKey, v);
        }}
        onTouchStart={(e) => {
          c.touch('down', dragKey, e);
        }}
        onTouchMove={(e) => {
          c.touch('move', dragKey, e);
        }}
        onTouchEnd={() => {
          c.touch('up', dragKey, null);
        }}
        onTouchCancel={() => {
          c.touch('cancel', dragKey, null);
        }}
        {...responder.panHandlers}
        style={
          active
            ? { transform: [{ translateY: c.offset }], zIndex: 10, backgroundColor: theme.colors['bg.raised'], borderRadius: theme.radius.sm, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } }
            : t === 'onto'
              ? { borderRadius: theme.radius.sm, borderWidth: 2, borderColor: theme.colors.accent }
              : undefined
        }
      >
        {t === 'before' ? <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: -2, height: 3, borderRadius: 2, backgroundColor: theme.colors.accent }} /> : null}
        {children}
        {t === 'after' ? <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: -2, height: 3, borderRadius: 2, backgroundColor: theme.colors.accent }} /> : null}
      </Animated.View>
    </ItemCtx.Provider>
  );
}

/**
 * Props for a row's own buttons: a 320 ms hold arms the drag (and, as any long press, stops the
 * tap). Outside a `DragList` (or with it off) the hold does `fallback`, as before.
 */
export function useDragHandle(fallback?: () => void): { delayLongPress?: number; onLongPress?: () => void } {
  const c = useContext(Ctx);
  const item = useContext(ItemCtx);
  if (c === null || !c.enabled || item === null) return fallback === undefined ? {} : { onLongPress: fallback };
  const { key, draggable } = item;
  return {
    delayLongPress: DRAG.holdMs,
    onLongPress: () => {
      c.arm(key, draggable);
    },
  };
}
