import { Modal, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '../theme';
import { contextMenuHeight, contextMenuPlacement, CONTEXT_MENU, type ContextMenuItem, type ContextMenuModel, type ExerciseMenuAction, type MenuAnchor } from '../workout/exercise-menu';
import { Icon } from './Icon';
import { AppText } from './Text';

/**
 * The round page's exercise menu (Ben, 1 Nov, approved A; docs/design/exercise-menu.md). Built in React Native,
 * not the native iOS context menu: the card lifts (a copy drawn over it, slightly larger, with a shadow), the
 * rest dims under a translucent scrim (no blur module in the app), and a 250 pt menu sits next to it. A tap
 * outside dismisses it; there's no Cancel row. Placement and contents are pure (`contextMenuPlacement`,
 * `roundContextMenu`).
 */
export interface ExerciseContextMenuProps {
  visible: boolean;
  /** The card's header in window points, or null (opened from the Workout sheet): placed near the top. */
  anchor: MenuAnchor | null;
  title: string;
  subtitle: string | null;
  model: ContextMenuModel;
  onPick: (action: ExerciseMenuAction) => void;
  onDismiss: () => void;
  /** iOS: the menu has gone (a sheet the pick opens can present now). */
  onDismissed?: () => void;
}

export function ExerciseContextMenu(p: ExerciseContextMenuProps) {
  const theme = useTheme();
  const win = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const place = contextMenuPlacement(p.anchor, contextMenuHeight(p.model), win, insets);
  const divider = { borderTopWidth: theme.dividerWidth, borderTopColor: theme.colors['border.divider'] };
  const sep = <View style={{ height: CONTEXT_MENU.sepH, backgroundColor: theme.colors.scrim }} />;
  const row = (item: ContextMenuItem, i: number) => (
    <Pressable
      key={item.action}
      accessibilityRole="button"
      accessibilityLabel={item.accessibilityLabel ?? item.label}
      onPress={() => {
        p.onPick(item.action);
      }}
      style={({ pressed }) => ({
        minHeight: CONTEXT_MENU.rowH,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space['2'],
        paddingHorizontal: 14,
        backgroundColor: pressed ? theme.colors['bg.raised'] : 'transparent',
        ...(i > 0 ? divider : {}),
      })}
    >
      <AppText variant="body" numberOfLines={1} color={item.destructive === true ? 'status.danger' : 'text.primary'} style={{ flexShrink: 1 }}>
        {item.label}
      </AppText>
      <View style={{ flex: 1 }}>
        {item.detail !== undefined ? (
          <AppText variant="callout" color="text.tertiary" numberOfLines={1} style={{ fontSize: 13 }}>
            {item.detail}
          </AppText>
        ) : null}
      </View>
      <Icon name={item.icon} color={item.destructive === true ? 'status.danger' : 'text.primary'} size={18} />
    </Pressable>
  );
  const sections = [
    p.model.undo.length > 0 ? <View key="undo">{p.model.undo.map(row)}</View> : null,
    p.model.moves.length > 0 ? (
      <View key="moves" style={{ flexDirection: 'row', height: CONTEXT_MENU.movesH }}>
        {p.model.moves.map((m, i) => (
          <Pressable
            key={m.action}
            accessibilityRole="button"
            accessibilityLabel={m.accessibilityLabel ?? m.label}
            onPress={() => {
              p.onPick(m.action);
            }}
            style={({ pressed }) => ({
              flex: 1,
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              backgroundColor: pressed ? theme.colors['bg.raised'] : 'transparent',
              ...(i > 0 ? { borderLeftWidth: theme.dividerWidth, borderLeftColor: theme.colors['border.divider'] } : {}),
            })}
          >
            <Icon name={m.icon} color="text.primary" size={18} />
            <AppText variant="label" style={{ fontSize: 11, lineHeight: 13 }} maxFontSizeMultiplier={1.4}>
              {m.label}
            </AppText>
          </Pressable>
        ))}
      </View>
    ) : null,
    p.model.rows.length > 0 ? <View key="rows">{p.model.rows.map(row)}</View> : null,
    p.model.more.length > 0 ? <View key="more">{p.model.more.map(row)}</View> : null,
    p.model.danger.length > 0 ? <View key="danger">{p.model.danger.map(row)}</View> : null,
  ].filter((x) => x !== null);
  return (
    <Modal visible={p.visible} transparent animationType="fade" onRequestClose={p.onDismiss} {...(p.onDismissed ? { onDismiss: p.onDismissed } : {})}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close menu" onPress={p.onDismiss} style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: theme.colors.scrim }} />
      {/* The lifted card: the exercise's header, drawn over its place. */}
      <View
        pointerEvents="none"
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
        style={{
          position: 'absolute',
          top: place.card.y,
          left: place.card.x,
          width: place.card.width,
          minHeight: place.card.height,
          justifyContent: 'center',
          paddingHorizontal: theme.space['3'],
          paddingVertical: theme.space['2'],
          backgroundColor: theme.colors['bg.surface'],
          borderRadius: theme.radius.lg,
          transform: theme.a11y.reduceMotion ? [] : [{ scale: 1.02 }],
          shadowColor: '#000',
          shadowOpacity: 0.45,
          shadowRadius: 18,
          shadowOffset: { width: 0, height: 10 },
        }}
      >
        <AppText variant="headline" numberOfLines={2}>
          {p.title}
        </AppText>
        {p.subtitle !== null ? (
          <AppText variant="callout" color="text.secondary" numberOfLines={1} style={{ fontSize: 13, lineHeight: 18 }}>
            {p.subtitle}
          </AppText>
        ) : null}
      </View>
      <View
        accessibilityViewIsModal
        accessibilityLabel={`${p.title} options`}
        style={{
          position: 'absolute',
          top: place.menu.top,
          left: place.menu.left,
          width: place.menu.width,
          borderRadius: 14,
          overflow: 'hidden',
          backgroundColor: theme.colors['bg.surface'],
          borderWidth: theme.dividerWidth,
          borderColor: theme.colors['border.divider'],
          shadowColor: '#000',
          shadowOpacity: 0.55,
          shadowRadius: 20,
          shadowOffset: { width: 0, height: 18 },
        }}
      >
        {/* Larger text makes rows taller than 44 pt: the menu scrolls inside the screen rather than running off it. */}
        <ScrollView bounces={false} style={{ maxHeight: win.height - place.menu.top - insets.bottom - CONTEXT_MENU.margin }}>
          {sections.flatMap((s, i) => (i === 0 ? [s] : [<View key={`sep-${String(i)}`}>{sep}</View>, s]))}
        </ScrollView>
      </View>
    </Modal>
  );
}
