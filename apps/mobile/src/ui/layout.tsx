import { Children, Fragment, isValidElement, useState, type ReactNode, type Ref } from 'react';
import { Pressable, ScrollView, TextInput, View, type LayoutChangeEvent, type TextInputProps, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme, type ColorToken } from '../theme';
import { Icon, type SymbolName } from './Icon';
import { SheetKeyboardAvoidingView, useKeyboardVisible } from './keyboard';
import { bottomBarPadding, toastBottom } from './keyboard-state';
import { AppText } from './Text';
import { ToastHost } from './workout';

/** Room left under the content for a floating pill (F16: its 44 pt, its 16 pt lift, and a 16 pt gap). */
export const FLOATING_PILL_ROOM = 44 + 16 + 16;

/**
 * A scrolling screen on `bg.canvas` with the look's side margin. `floating`:
 * something drawn over the bottom of the scroll area (the `Ask` pill); the
 * content gets room below it so nothing ends up hidden underneath. It hides
 * while the keyboard is up. The screen avoids the keyboard (0.3), so the
 * lowest field and the footer's Save sit above it. `toast`: floats on the
 * footer (or clear of the home indicator; `tab`: on the tab bar) and pads the
 * scroll while it shows (0.6).
 */
export function Screen({ children, footer, floating, toast, tab = false, testID }: { children: ReactNode; footer?: ReactNode; floating?: ReactNode; toast?: ReactNode; tab?: boolean; testID?: string }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardVisible();
  const [footerHeight, setFooterHeight] = useState<number | null>(null);
  const [toastHeight, setToastHeight] = useState(0);
  const showFloating = floating !== undefined && floating !== null && !keyboard;
  // With a footer the whole screen avoids the keyboard, so Save rides on it. Without one the
  // scroll only insets itself (no double inset), and a large-title header still finds its scroll view.
  const Frame = footer ? SheetKeyboardAvoidingView : View;
  return (
    <Frame style={{ flex: 1, backgroundColor: theme.colors['bg.canvas'] }} {...(testID ? { testID } : {})}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets={!footer}
        contentContainerStyle={{
          paddingHorizontal: theme.components.screenMargin,
          paddingTop: theme.space['4'],
          paddingBottom: (footer ? theme.space['6'] : theme.space['8'] + (keyboard ? 0 : insets.bottom)) + (showFloating ? FLOATING_PILL_ROOM : 0) + toastHeight,
          gap: theme.space['5'],
        }}
      >
        {children}
      </ScrollView>
      {showFloating ? floating : null}
      {footer ? (
        <BottomBar
          onHeight={(h) => {
            setFooterHeight(h);
          }}
        >
          {footer}
        </BottomBar>
      ) : null}
      <ToastHost bottom={toastBottom({ footerHeight: footer ? footerHeight : null, insetBottom: keyboard ? 0 : insets.bottom, space2: theme.space['2'], tab })} onHeight={setToastHeight}>
        {toast}
      </ToastHost>
    </Frame>
  );
}

/** Fixed bottom bar for one primary action (OnboardingFrame, design-system §9.46). On the keyboard it drops the home-indicator room (0.2). */
export function BottomBar({ children, onHeight }: { children: ReactNode; onHeight?: (h: number) => void }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardVisible();
  return (
    <View
      {...(onHeight
        ? {
            onLayout: (e: LayoutChangeEvent) => {
              onHeight(e.nativeEvent.layout.height);
            },
          }
        : {})}
      style={{
        backgroundColor: theme.components.barOnCanvas ? theme.colors['bg.canvas'] : theme.colors['bg.surface'],
        borderTopWidth: theme.components.barOnCanvas ? 0 : theme.dividerWidth,
        borderTopColor: theme.colors['border.divider'],
        paddingHorizontal: theme.components.barOnCanvas ? theme.space['5'] : theme.space['4'],
        paddingTop: theme.space['3'],
        paddingBottom: bottomBarPadding({ keypadOpen: keyboard, insetBottom: insets.bottom, space2: theme.space['2'], space3: theme.space['3'] }),
        gap: theme.space['2'],
      }}
    >
      {children}
    </View>
  );
}

/** Card frame (design-system §9.48). */
export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const theme = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: theme.colors['bg.surface'],
          borderWidth: theme.components.cardBorderWidth,
          borderColor: theme.colors['border.control'],
          borderRadius: theme.components.cardBorderWidth === 0 ? theme.radius.lg : theme.radius.md,
          padding: theme.space['4'],
          gap: theme.space['3'],
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/** Section header (§9.32); D uses tracked caps (`type.sectionLabel`). */
export function SectionHeader({ title, icon }: { title: string; icon?: SymbolName }) {
  const theme = useTheme();
  return (
    <View accessibilityRole="header" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'], marginTop: theme.space['2'] }}>
      {icon ? <Icon name={icon} size={18} /> : null}
      <AppText variant="sectionLabel" color={theme.type.sectionLabel.uppercase ? 'text.tertiary' : 'text.secondary'}>
        {title}
      </AppText>
    </View>
  );
}

/** `DomainLabel` (§9.53): names the data domain; the word carries the meaning. */
export function DomainLabel({ domain }: { domain: 'yourData' | 'coachingKnowledge' }) {
  return domain === 'yourData' ? <SectionHeader icon="person.crop.circle" title="Your data" /> : <SectionHeader icon="books.vertical" title="Coaching knowledge" />;
}

/** A grouped list on `bg.surface` with decorative dividers between rows. */
export function Group({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const items = Children.toArray(children).filter(isValidElement);
  return (
    <View style={{ backgroundColor: theme.colors['bg.surface'], borderRadius: theme.components.cardBorderWidth === 0 ? theme.radius.lg : theme.radius.md, overflow: 'hidden' }}>
      {items.map((child, i) => (
        <Fragment key={child.key ?? i}>
          {i > 0 ? <View style={{ height: theme.dividerWidth, backgroundColor: theme.colors['border.divider'], marginLeft: theme.space['4'] }} /> : null}
          {child}
        </Fragment>
      ))}
    </View>
  );
}

interface RowProps {
  title: string;
  subtitle?: string | null;
  secondLine?: string | null;
  icon?: SymbolName;
  iconColor?: ColorToken;
  onPress?: () => void;
  disabled?: boolean;
  trailing?: ReactNode;
  accessibilityHint?: string;
  /** A row tag, icon + text (e.g. `⚠ May hurt`, exercise-library §2.1), read after the title. */
  tag?: { icon: SymbolName; color: ColorToken; text: string; accessibilityLabel: string };
  /** VoiceOver custom actions (e.g. `Delete` on a past workout, delete-workouts §4). */
  actions?: readonly { name: string; label: string }[];
  onAction?: (name: string) => void;
}

/** `SettingsRow` (§9.31): ≥ 52pt, whole row is the target, chevron when it opens something. */
export function Row({ title, subtitle, secondLine, icon, iconColor = 'text.secondary', onPress, disabled = false, trailing, accessibilityHint, tag, actions, onAction }: RowProps) {
  const theme = useTheme();
  const content = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['3'], minHeight: 52, paddingVertical: theme.space['3'], paddingHorizontal: theme.space['4'] }}>
      {icon ? <Icon name={icon} color={iconColor} /> : null}
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="body" color={disabled ? 'text.secondary' : 'text.primary'}>
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="callout" color="text.secondary" numeric>
            {subtitle}
          </AppText>
        ) : null}
        {secondLine ? (
          <AppText variant="callout" color="text.secondary" numeric>
            {secondLine}
          </AppText>
        ) : null}
        {tag ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['1'] }}>
            <Icon name={tag.icon} color={tag.color} size={14} />
            <AppText variant="label" color={tag.color}>
              {tag.text}
            </AppText>
          </View>
        ) : null}
      </View>
      {trailing}
      {onPress && !disabled ? <Icon name="chevron.right" color="text.tertiary" size={14} /> : null}
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[title, tag?.accessibilityLabel, subtitle, secondLine].filter(Boolean).join(', ')}
      accessibilityState={{ disabled }}
      {...(accessibilityHint ? { accessibilityHint } : {})}
      {...(actions && onAction
        ? {
            accessibilityActions: actions.map((a) => ({ name: a.name, label: a.label })),
            onAccessibilityAction: (e: { nativeEvent: { actionName: string } }) => {
              onAction(e.nativeEvent.actionName);
            },
          }
        : {})}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({ backgroundColor: pressed ? theme.colors['bg.raised'] : 'transparent' })}
    >
      {content}
    </Pressable>
  );
}

export type Tone = 'done' | 'warning' | 'info' | 'progress' | 'danger';

export const TONE_COLOR: Record<Tone, ColorToken> = {
  done: 'status.done',
  warning: 'status.warning',
  info: 'text.secondary',
  progress: 'text.secondary',
  danger: 'status.danger',
};

/** `StatusRow` / `StatusLabel` (§9.40): icon + words, never colour alone. */
export function StatusLine({
  icon,
  tone,
  text,
  detail,
  info,
  infoLabel = 'Details',
  action,
}: {
  icon: SymbolName;
  tone: Tone;
  text: string;
  detail?: string | null;
  /** Behind an ⓘ (minimal copy): shown only on a tap, for example an error's own message. */
  info?: string | null;
  /** The ⓘ's VoiceOver label, in context (`Error details`), never a bare `Info` (review N1). */
  infoLabel?: string;
  action?: ReactNode;
}) {
  const theme = useTheme();
  const [infoOpen, setInfoOpen] = useState(false);
  const hasInfo = info !== undefined && info !== null && info !== '';
  return (
    <View style={{ flexDirection: 'row', gap: theme.space['3'], alignItems: 'flex-start', minHeight: theme.target.min.height }} accessible={!hasInfo} accessibilityLabel={[text, detail].filter(Boolean).join('. ')}>
      <View style={{ paddingTop: 2 }}>
        <Icon name={icon} color={TONE_COLOR[tone]} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="body" numeric>
          {text}
        </AppText>
        {detail ? (
          <AppText variant="callout" color="text.secondary" numeric>
            {detail}
          </AppText>
        ) : null}
        {hasInfo && infoOpen ? (
          <AppText variant="callout" color="text.secondary" numeric>
            {info}
          </AppText>
        ) : null}
      </View>
      {hasInfo ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={infoLabel}
          accessibilityState={{ expanded: infoOpen }}
          hitSlop={12}
          style={{ paddingTop: 2 }}
          onPress={() => {
            setInfoOpen((o) => !o);
          }}
        >
          <Icon name="info.circle" color="text.secondary" size={18} />
        </Pressable>
      ) : null}
      {action}
    </View>
  );
}

/**
 * A short line with an optional `ⓘ` (minimal copy): the explanation shows only
 * on a tap. With no `info` it is a plain line.
 */
export function InfoLine({ text, info, variant = 'body', infoLabel = 'Details' }: { text?: string | null; info?: string | null; variant?: 'body' | 'callout'; infoLabel?: string }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const hasInfo = info !== undefined && info !== null && info !== '';
  return (
    <View style={{ gap: theme.space['1'] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}>
        {text ? (
          <AppText variant={variant} style={{ flexShrink: 1 }}>
            {text}
          </AppText>
        ) : null}
        {hasInfo ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={infoLabel}
            accessibilityState={{ expanded: open }}
            hitSlop={12}
            onPress={() => {
              setOpen((o) => !o);
            }}
          >
            <Icon name="info.circle" color="text.secondary" size={18} />
          </Pressable>
        ) : null}
      </View>
      {hasInfo && open ? (
        <AppText variant="callout" color="text.secondary">
          {info}
        </AppText>
      ) : null}
    </View>
  );
}

/** `StatusBanner` (§9.12): info or warning, one line and an optional action. */
export function Banner({ severity, text, action }: { severity: 'info' | 'warning'; text: string; action?: ReactNode }) {
  const theme = useTheme();
  const warning = severity === 'warning';
  return (
    <View
      accessibilityRole="alert"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space['3'],
        minHeight: theme.target.min.height,
        padding: theme.space['3'],
        borderRadius: theme.components.cardBorderWidth === 0 ? theme.radius.lg : theme.radius.md,
        backgroundColor: warning ? theme.colors['status.warning.subtle'] : theme.colors['bg.surface'],
        borderWidth: warning ? 0 : theme.components.cardBorderWidth,
        borderColor: theme.colors['border.control'],
      }}
    >
      <Icon name={warning ? 'exclamationmark.triangle' : 'info.circle'} color={warning ? 'status.warning' : 'text.secondary'} />
      <AppText variant="callout" style={{ flex: 1 }}>
        {text}
      </AppText>
      {action}
    </View>
  );
}

/** `ChoiceCard` (§9.34): selected shows a check icon and a thicker border, never colour alone. */
export function ChoiceCard({ title, subtitle, selected, onPress, disabled = false }: { title: string; subtitle?: string | null; selected: boolean; onPress: () => void; disabled?: boolean }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected, checked: selected, disabled }}
      accessibilityLabel={[title, subtitle].filter(Boolean).join(', ')}
      disabled={disabled}
      onPress={onPress}
      style={{
        opacity: disabled && !selected ? 0.4 : 1,
        minHeight: 60,
        padding: theme.space['4'],
        borderRadius: theme.components.cardBorderWidth === 0 ? theme.radius.lg : theme.radius.md,
        borderWidth: selected ? theme.components.selectedBorderWidth : 1,
        borderColor: selected ? theme.colors.accent : theme.components.cardBorderWidth === 0 ? theme.colors['border.divider'] : theme.colors['border.control'],
        backgroundColor: selected ? theme.colors['accent.subtle'] : theme.colors['bg.surface'],
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space['3'],
      }}
    >
      <Icon name={selected ? 'checkmark.circle.fill' : 'circle'} color={selected ? 'accent' : 'text.tertiary'} />
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="headline">{title}</AppText>
        {subtitle ? (
          <AppText variant="callout" color="text.secondary">
            {subtitle}
          </AppText>
        ) : null}
      </View>
    </Pressable>
  );
}

/** `ChecklistRow` (§9.33): the whole row toggles; optional provenance tag under the title. */
export function ChecklistRow({ title, checked, tag, onToggle }: { title: string; checked: boolean; tag?: string | null; onToggle: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={[title, tag].filter(Boolean).join(', ')}
      onPress={onToggle}
      style={({ pressed }) => ({
        minHeight: 52,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space['3'],
        paddingVertical: theme.space['3'],
        paddingHorizontal: theme.space['4'],
        backgroundColor: pressed ? theme.colors['bg.raised'] : 'transparent',
      })}
    >
      <Icon name={checked ? 'checkmark.square.fill' : 'square'} color={checked ? 'accent' : 'text.secondary'} size={22} />
      <View style={{ flex: 1, gap: theme.space['1'] }}>
        <AppText variant="body">{title}</AppText>
        {tag ? <Tag icon="questionmark.circle" text={tag} /> : null}
      </View>
    </Pressable>
  );
}

/** `Tag` frame (§9.28): text on `bg.raised`, never accent. */
export function Tag({ text, icon }: { text: string; icon?: SymbolName }) {
  const theme = useTheme();
  return (
    <View
      style={{
        alignSelf: 'flex-start',
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space['1'],
        backgroundColor: theme.colors['bg.raised'],
        borderRadius: theme.radius.sm,
        paddingVertical: theme.space['1'],
        paddingHorizontal: theme.space['2'],
      }}
    >
      {icon ? <Icon name={icon} size={14} /> : null}
      <AppText variant="label" color="text.secondary">
        {text}
      </AppText>
    </View>
  );
}

/** A full-screen message (launch states, BlockingCover-like). No buttons unless given. */
export function MessageScreen({ title, lines, children }: { title: string; lines: readonly string[]; children?: ReactNode }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.colors['bg.canvas'],
        justifyContent: 'center',
        paddingHorizontal: theme.components.screenMargin,
        paddingTop: insets.top,
        paddingBottom: insets.bottom,
        gap: theme.space['4'],
      }}
    >
      <AppText variant="title2" accessibilityRole="header">
        {title}
      </AppText>
      {lines.map((l) => (
        <AppText key={l} variant="callout" color="text.secondary">
          {l}
        </AppText>
      ))}
      {children}
    </View>
  );
}

/** A tracked-caps label (`TODAY`, `LOAD`, `REST`; D) or the look's section label. */
export function Eyebrow({ children, color = 'text.tertiary', align }: { children: string; color?: ColorToken; align?: 'center' }) {
  return (
    <AppText variant="sectionLabel" color={color} {...(align ? { align } : {})}>
      {children}
    </AppText>
  );
}

/**
 * The D hero (D-Today `TODAY / Push A / Chest · Shoulders`): eyebrow, a large
 * semibold title, then quiet lines. `size` `hero` is the 40pt Today title;
 * `screen` is the 30pt screen title.
 */
/** `link`: one quiet line that is a link (Today's `Day 2 of 4 ›` opens Your plan; Ben, 19 Oct), after the lines. */
export function HeroHeader({
  eyebrow,
  title,
  lines = [],
  size = 'hero',
  link = null,
}: {
  eyebrow?: string | null;
  title: string;
  lines?: readonly (string | null | undefined)[];
  size?: 'hero' | 'screen';
  link?: { text: string; accessibilityLabel: string; onPress: () => void } | null;
}) {
  const theme = useTheme();
  const px = size === 'hero' ? theme.components.heroTitleSize : theme.type.title1.fontSize;
  const shown = lines.filter((l): l is string => typeof l === 'string' && l !== '');
  // premium-feel §8: eyebrow → title 6 pt; title → lines 8 pt; the lines read as one paragraph, 4 pt apart.
  return (
    <View>
      {eyebrow ? (
        <View style={{ marginBottom: theme.space['1'] + 2 }}>
          <Eyebrow>{eyebrow}</Eyebrow>
        </View>
      ) : null}
      <AppText
        variant="title1"
        accessibilityRole="header"
        numberOfLines={3}
        style={{ fontSize: px, lineHeight: Math.round(px * 1.15), letterSpacing: px >= 40 ? -0.8 : theme.type.title1.letterSpacing }}
      >
        {title}
      </AppText>
      {shown.length > 0 || link !== null ? (
        <View style={{ marginTop: theme.space['2'], gap: theme.space['1'] }}>
          {shown.map((l) => (
            <AppText key={l} variant="callout" color="text.secondary" numeric>
              {l}
            </AppText>
          ))}
          {link !== null ? (
            <Pressable accessibilityRole="link" accessibilityLabel={link.accessibilityLabel} onPress={link.onPress} hitSlop={{ top: 12, bottom: 12 }} style={({ pressed }) => ({ alignSelf: 'flex-start', opacity: pressed ? 0.7 : 1 })}>
              <AppText variant="callout" color="text.secondary" numeric style={{ textDecorationLine: 'underline', textDecorationColor: theme.colors['border.control'] }}>
                {`${link.text} ›`}
              </AppText>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** A section opened by a hairline and an eyebrow (D-Today `THIS WEEK`, D-Rest saved/effort block). */
export function RuledSection({ title, children, gap = '3' }: { title?: string | null; children: ReactNode; gap?: '2' | '3' | '4' }) {
  const theme = useTheme();
  return (
    <View style={{ borderTopWidth: theme.dividerWidth, borderTopColor: theme.colors['border.divider'], paddingTop: theme.space['4'], gap: theme.space[gap] }}>
      {title ? (
        <View accessibilityRole="header">
          <Eyebrow>{title}</Eyebrow>
        </View>
      ) : null}
      {children}
    </View>
  );
}

/**
 * Large-numeral stat tiles (D: the LOAD / REPS tile look) in a wrapping grid,
 * two per row. Each tile reads as one VoiceOver element: `Active time, 52 min`.
 */
export function StatGrid({ items }: { items: readonly { label: string; value: string; unit?: string | null }[] }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space['3'] }}>
      {items.map((it) => (
        <View
          key={it.label}
          accessible
          accessibilityLabel={`${it.label}, ${it.value}${it.unit ? ` ${it.unit}` : ''}`}
          style={{
            flexGrow: 1,
            flexBasis: '40%',
            backgroundColor: theme.colors['bg.surface'],
            borderWidth: theme.components.cardBorderWidth,
            borderColor: theme.colors['border.control'],
            borderRadius: theme.components.cardBorderWidth === 0 ? theme.radius.lg : theme.radius.md,
            paddingVertical: theme.space['4'],
            paddingHorizontal: theme.space['4'],
            gap: theme.space['1'],
          }}
        >
          <Eyebrow>{it.label}</Eyebrow>
          <AppText variant="title1" numeric style={{ fontWeight: '500', fontVariant: ['tabular-nums'] }}>
            {it.value}
            {it.unit ? (
              <AppText variant="body" color="text.secondary">
                {` ${it.unit}`}
              </AppText>
            ) : null}
          </AppText>
        </View>
      ))}
    </View>
  );
}

/**
 * A quiet trend line (D-Today under the lift): `border.control` segments with
 * the newest point marked in the accent. Decorative; the words beside it
 * carry the meaning, so it is hidden from VoiceOver.
 */
export function Sparkline({ points, height = 40 }: { points: readonly { x: number; y: number }[] | ((width: number) => readonly { x: number; y: number }[]); height?: number }) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  const pts = typeof points === 'function' ? (width > 0 ? points(width) : []) : points;
  const stroke = 1.5;
  const dot = 7;
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      onLayout={(e) => {
        setWidth(Math.round(e.nativeEvent.layout.width) - dot);
      }}
      style={{ height, width: '100%' }}
    >
      {pts.slice(1).map((p, i) => {
        const a = pts[i];
        if (!a) return null;
        const dx = p.x - a.x;
        const dy = p.y - a.y;
        const len = Math.hypot(dx, dy);
        return (
          <View
            key={String(i)}
            style={{
              position: 'absolute',
              left: (a.x + p.x) / 2 - len / 2,
              top: (a.y + p.y) / 2 - stroke / 2,
              width: len,
              height: stroke,
              backgroundColor: theme.colors['border.control'],
              transform: [{ rotate: `${String(Math.atan2(dy, dx))}rad` }],
            }}
          />
        );
      })}
      {pts.length > 0 ? (
        <View
          style={{
            position: 'absolute',
            left: (pts.at(-1)?.x ?? 0) - dot / 2,
            top: (pts.at(-1)?.y ?? 0) - dot / 2,
            width: dot,
            height: dot,
            borderRadius: dot / 2,
            backgroundColor: theme.colors.accent,
          }}
        />
      ) : null}
    </View>
  );
}

/**
 * A text field in the look (D: a borderless `bg.raised` block, radius 14, a
 * hairline when focused; A: the bordered field). Extra props go to TextInput.
 */
export function TextField({ style, onFocus, onBlur, ref, ...rest }: TextInputProps & { ref?: Ref<TextInput> }) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  const d = theme.components.cardBorderWidth === 0;
  return (
    <TextInput
      ref={ref}
      placeholderTextColor={theme.colors['text.tertiary']}
      maxFontSizeMultiplier={theme.type.body.maxFontSizeMultiplier}
      onFocus={(e) => {
        setFocused(true);
        onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocused(false);
        onBlur?.(e);
      }}
      {...rest}
      style={[
        {
          minHeight: 52,
          paddingHorizontal: theme.space['4'],
          paddingVertical: theme.space['3'],
          borderRadius: d ? theme.radius.md : theme.radius.sm,
          borderWidth: d ? (focused ? 1 : 0) : focused ? 2 : 1,
          borderColor: d ? theme.colors['border.control'] : focused ? theme.colors.accent : theme.colors['border.control'],
          backgroundColor: theme.colors['bg.raised'],
          color: theme.colors['text.primary'],
          fontSize: theme.type.body.fontSize,
        },
        style,
      ]}
    />
  );
}
