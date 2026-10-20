/**
 * Design tokens (docs/design/design-system.md is the only source).
 *
 * Pure TypeScript, no React Native imports, so it is unit-tested on Linux
 * (test/theme-tokens.test.ts checks that every token named in design-system.md
 * exists here).
 *
 * Swappable looks: everything visual (colours for both schemes, type scale,
 * spacing, radii, touch targets, chart dimensions, component shape choices)
 * lives in one `ThemeDirection` object. Two exist:
 * - A "Navy": design-system.md v0.1.
 * - D "Premium": docs/research/thirdspace-visual-reference.md §6 (the
 *   provisional default, docs/decisions/provisional-2026-10-09.md).
 * A new look (B, C, D-Clay) is one more object in `THEME_DIRECTIONS`;
 * screens never name colour values.
 *
 * Behaviour tokens (timing, haptics, sound) don't change with the look, so
 * they are shared by every direction.
 */

export type ColorScheme = 'dark' | 'light';

/** design-system §2: base colour tokens (`color.<name>`). */
export const BASE_COLOR_TOKENS = [
  'bg.canvas',
  'bg.surface',
  'bg.raised',
  'border.divider',
  'border.control',
  'text.primary',
  'text.secondary',
  'text.tertiary',
  'accent',
  'accent.pressed',
  'accent.subtle',
  'on.accent',
  'status.done',
  'status.done.subtle',
  'status.warning',
  'status.warning.subtle',
  'status.danger',
  'status.danger.subtle',
  'scrim',
] as const;
export type BaseColorToken = (typeof BASE_COLOR_TOKENS)[number];

/** design-system §2.1: chart colours are aliases of base tokens, never new values. */
export const CHART_COLOR_ALIASES = {
  'chart.line': 'text.primary',
  'chart.point': 'text.primary',
  'chart.selected': 'accent',
  'chart.grid': 'border.divider',
  'chart.axisText': 'text.secondary',
  'chart.bandFill': 'bg.raised',
  'chart.bandEdge': 'border.control',
  'chart.bar': 'text.secondary',
  'chart.marker': 'text.secondary',
  'chart.markerPain': 'status.warning',
} as const satisfies Record<string, BaseColorToken>;
export type ChartColorToken = keyof typeof CHART_COLOR_ALIASES;

export type ColorToken = BaseColorToken | ChartColorToken;

export type FontWeight = '300' | '400' | '500' | '600' | '700';

/** iOS text style a token scales with (Dynamic Type). */
export type IosTextStyle = 'largeTitle' | 'title1' | 'title2' | 'headline' | 'body' | 'callout' | 'system';

export interface TypeToken {
  size: number;
  lineHeight: number;
  weight: FontWeight;
  /** `always`: tabular numerals everywhere; `numeric`: when the text is a number. */
  tabular: 'always' | 'numeric' | 'never';
  textStyle: IosTextStyle;
  /** Dynamic Type ceiling (maxFontSizeMultiplier). */
  maxScale: number;
  /** Live Activity only; not used for in-app text. */
  widgetOnly?: true;
  /** Section labels only (Direction D: tracked uppercase). */
  uppercase?: true;
  letterSpacing?: number;
}

export const TYPE_TOKENS = [
  'timerDisplay',
  'loadDisplay',
  'title1',
  'title2',
  'headline',
  'body',
  'callout',
  'label',
  'keypad',
  'rowValue',
  'sectionLabel',
  'liveCountdown',
] as const;
export type TypeTokenName = (typeof TYPE_TOKENS)[number];
export type InAppTypeTokenName = Exclude<TypeTokenName, 'liveCountdown'>;

export const SPACE_TOKENS = ['1', '2', '3', '4', '5', '6', '8'] as const;
export type SpaceToken = (typeof SPACE_TOKENS)[number];

export const RADIUS_TOKENS = ['sm', 'md', 'lg', 'pill'] as const;
export type RadiusToken = (typeof RADIUS_TOKENS)[number];

export interface TargetTokens {
  min: { width: number; height: number };
  workout: { width: number; height: number };
  /** Full width × height. */
  primary: { height: number };
  keypadKey: { minWidth: number; height: number };
}

export interface ChartDimensions {
  sparkline: { width: number; height: number };
  detailHeight: number;
  detailHeightAX: number;
  lineWidth: number;
  lineWidthIncreasedContrast: number;
  point: number;
  pointSelected: number;
  markerLane: number;
  bandBar: number;
  weekBar: { width: number; gap: number };
  /** `WeekBars` (Progress, design-system §4.1 revision 2026-10-11): plot height, widest bar, gap, top-corner radius. */
  weekBars: { height: number; maxBarWidth: number; gap: number; radius: number };
  /** `FrequencyRow` bar. */
  countBar: { height: number; radius: number };
  /** `DayStrip` glyph diameter in a column at least `minColumn` wide. */
  dayCell: { diameter: number; minColumn: number };
}

/**
 * Component shape choices that differ between looks. Each answers a risk the
 * look creates (research §6.3), so screens read these instead of guessing.
 */
export interface ComponentShapes {
  /** `PrimaryButton` corner (D: pill CTAs). */
  primaryButtonRadius: RadiusToken;
  /**
   * How text links and text buttons show they're tappable. `chevron`: always
   * add a trailing chevron or an icon. `underline`: D's approved mockups
   * underline links (the accent is almost the same as body text, risk 1, so
   * colour alone never says it). A uses its blue accent, so colour plus the
   * spec's own chevrons is enough.
   */
  linkAffordance: 'colour' | 'chevron' | 'underline';
  /**
   * Extra border on selected chips and cards (D risk 3: `accent.subtle` is
   * close to `bg.raised`). Selected chips show a check icon in every look.
   */
  selectedBorderWidth: number;
  /** Side margin on non-workout screens (D: 20, workout screens keep space.4). */
  screenMargin: number;
  /**
   * Cards and grouped surfaces: D's are borderless `bg.surface` blocks
   * (D-Today/D-ActiveSet mockups); A keeps a 1pt `border.control` frame.
   */
  cardBorderWidth: number;
  /** Secondary buttons: D uses a transparent outline pill (D-Rest), A a filled rounded rectangle. */
  secondaryButton: 'outline_pill' | 'filled';
  /** Bottom bars (ActionBar, BottomBar): D sits on the canvas with no top rule; A on `bg.surface` with a divider. */
  barOnCanvas: boolean;
  /** Large page title on Today (D: 40pt routine name). */
  heroTitleSize: number;
}

/** Everything that defines a look. Swap the whole object to change the look. */
export interface ThemeDirection {
  id: 'A' | 'B' | 'C' | 'D';
  name: string;
  components: ComponentShapes;
  colors: Record<ColorScheme, Record<BaseColorToken, string>>;
  type: Record<TypeTokenName, TypeToken>;
  space: Record<SpaceToken, number>;
  radius: Record<RadiusToken, number>;
  target: TargetTokens;
  chart: ChartDimensions;
}

/** Direction A: navy, design-system.md v0.1 (8 Oct 2026). */
export const NAVY_DIRECTION: ThemeDirection = {
  id: 'A',
  name: 'Navy',
  components: { primaryButtonRadius: 'md', linkAffordance: 'colour', selectedBorderWidth: 2, screenMargin: 16, cardBorderWidth: 1, secondaryButton: 'filled', barOnCanvas: false, heroTitleSize: 28 },
  colors: {
    dark: {
      'bg.canvas': '#0F1620',
      'bg.surface': '#17202B',
      'bg.raised': '#1F2A38',
      'border.divider': '#2A3646',
      'border.control': '#64748A',
      'text.primary': '#EEF2F6',
      'text.secondary': '#A9B4C2',
      'text.tertiary': '#8593A3',
      accent: '#5AA9FF',
      'accent.pressed': '#3F8FE6',
      'accent.subtle': '#16304A',
      'on.accent': '#0B1118',
      'status.done': '#5CC98A',
      'status.done.subtle': '#15301F',
      'status.warning': '#F2B84B',
      'status.warning.subtle': '#3A2C10',
      'status.danger': '#FF7B72',
      'status.danger.subtle': '#3A1A1A',
      scrim: 'rgba(0, 0, 0, 0.5)',
    },
    light: {
      'bg.canvas': '#F5F7FA',
      'bg.surface': '#FFFFFF',
      'bg.raised': '#EEF1F5',
      'border.divider': '#D9DEE5',
      'border.control': '#7A8696',
      'text.primary': '#0F1620',
      'text.secondary': '#4A5666',
      'text.tertiary': '#5F6B7A',
      accent: '#0A63C9',
      'accent.pressed': '#084FA1',
      'accent.subtle': '#E3EEFB',
      'on.accent': '#FFFFFF',
      'status.done': '#1E7F45',
      'status.done.subtle': '#E4F3EA',
      'status.warning': '#8A5A00',
      'status.warning.subtle': '#FBF0D9',
      'status.danger': '#B3261E',
      'status.danger.subtle': '#FBE4E2',
      scrim: 'rgba(15, 22, 32, 0.3)',
    },
  },
  type: {
    timerDisplay: { size: 64, lineHeight: 72, weight: '600', tabular: 'always', textStyle: 'largeTitle', maxScale: 1.6 },
    loadDisplay: { size: 40, lineHeight: 48, weight: '600', tabular: 'always', textStyle: 'largeTitle', maxScale: 1.8 },
    title1: { size: 28, lineHeight: 34, weight: '700', tabular: 'never', textStyle: 'title1', maxScale: 2.5 },
    title2: { size: 22, lineHeight: 28, weight: '600', tabular: 'never', textStyle: 'title2', maxScale: 2.5 },
    headline: { size: 17, lineHeight: 22, weight: '600', tabular: 'numeric', textStyle: 'headline', maxScale: 3 },
    body: { size: 17, lineHeight: 24, weight: '400', tabular: 'numeric', textStyle: 'body', maxScale: 3 },
    callout: { size: 16, lineHeight: 22, weight: '400', tabular: 'numeric', textStyle: 'callout', maxScale: 3 },
    label: { size: 16, lineHeight: 20, weight: '500', tabular: 'numeric', textStyle: 'callout', maxScale: 3 },
    keypad: { size: 28, lineHeight: 34, weight: '400', tabular: 'always', textStyle: 'title1', maxScale: 1.5 },
    // Workout Table row values (design-system §3, 2026-10-12): Regular for targets; done rows set Medium.
    rowValue: { size: 19, lineHeight: 24, weight: '400', tabular: 'always', textStyle: 'body', maxScale: 3 },
    // A has no separate section-label style: SettingsSectionHeader uses type.label (design-system §9.32).
    sectionLabel: { size: 16, lineHeight: 20, weight: '500', tabular: 'numeric', textStyle: 'callout', maxScale: 3 },
    // Banner size; Dynamic Island sizes are set in the widget (design-system §3).
    liveCountdown: { size: 28, lineHeight: 34, weight: '600', tabular: 'always', textStyle: 'system', maxScale: 1, widgetOnly: true },
  },
  space: { '1': 4, '2': 8, '3': 12, '4': 16, '5': 20, '6': 24, '8': 32 },
  radius: { sm: 8, md: 12, lg: 16, pill: 999 },
  target: {
    min: { width: 44, height: 44 },
    workout: { width: 52, height: 52 },
    primary: { height: 60 },
    keypadKey: { minWidth: 64, height: 56 },
  },
  chart: {
    sparkline: { width: 96, height: 32 },
    detailHeight: 220,
    detailHeightAX: 280,
    lineWidth: 2,
    lineWidthIncreasedContrast: 3,
    point: 6,
    pointSelected: 10,
    markerLane: 28,
    bandBar: 12,
    weekBar: { width: 8, gap: 4 },
    weekBars: { height: 64, maxBarWidth: 28, gap: 8, radius: 4 },
    countBar: { height: 6, radius: 3 },
    dayCell: { diameter: 10, minColumn: 32 },
  },
};

/** Status colours are shared by A and D (research §6.1: unchanged). */
const STATUS_DARK = {
  'status.done': '#5CC98A',
  'status.done.subtle': '#15301F',
  'status.warning': '#F2B84B',
  'status.warning.subtle': '#3A2C10',
  'status.danger': '#FF7B72',
  'status.danger.subtle': '#3A1A1A',
} as const;
const STATUS_LIGHT = {
  'status.done': '#1E7F45',
  'status.done.subtle': '#E4F3EA',
  'status.warning': '#8A5A00',
  'status.warning.subtle': '#FBF0D9',
  'status.danger': '#B3261E',
  'status.danger.subtle': '#FBE4E2',
} as const;

/**
 * Direction D: Premium (research thirdspace-visual-reference.md §6.1, §6.3,
 * §6.5). Warm near-black and porcelain, SF Pro only (no bundled serif yet),
 * Semibold titles, tracked-caps section labels, pill primary buttons.
 * Contrast figures are the researcher's hand calculation; re-check on device.
 *
 * Type, radius and component shapes follow Ben's approved D mockups
 * (D-Today, D-ActiveSet, D-Rest, 9 Oct 2026), which differ from
 * design-system.md's D values: 12pt (13pt since 20 Oct) tracked labels in `text.tertiary`, an
 * 88/300 rest numeral, 38/500 load, 30pt titles, 20pt card radius,
 * borderless cards and outline-pill secondary buttons (first-run audit §3).
 * design-system.md still needs updating to match.
 */
export const PREMIUM_DIRECTION: ThemeDirection = {
  ...NAVY_DIRECTION,
  id: 'D',
  name: 'Premium',
  components: { primaryButtonRadius: 'pill', linkAffordance: 'underline', selectedBorderWidth: 2, screenMargin: 20, cardBorderWidth: 0, secondaryButton: 'outline_pill', barOnCanvas: true, heroTitleSize: 40 },
  colors: {
    dark: {
      'bg.canvas': '#0D0C0B',
      'bg.surface': '#181615',
      'bg.raised': '#23201E',
      'border.divider': '#302C29',
      'border.control': '#75706A',
      'text.primary': '#F3EEE8',
      'text.secondary': '#B5ADA5',
      'text.tertiary': '#948C84',
      accent: '#EDE5DA',
      'accent.pressed': '#D6CCBF',
      'accent.subtle': '#2B2724',
      'on.accent': '#0D0C0B',
      ...STATUS_DARK,
      scrim: 'rgba(0, 0, 0, 0.55)',
    },
    light: {
      'bg.canvas': '#F6F3EF',
      'bg.surface': '#FFFFFF',
      'bg.raised': '#EEE9E3',
      'border.divider': '#DDD6CE',
      'border.control': '#857D75',
      'text.primary': '#15120F',
      'text.secondary': '#57504A',
      'text.tertiary': '#6B645D',
      accent: '#1A1714',
      'accent.pressed': '#3A3530',
      'accent.subtle': '#ECE5DC',
      'on.accent': '#FFFFFF',
      ...STATUS_LIGHT,
      scrim: 'rgba(21, 18, 15, 0.3)',
    },
  },
  type: {
    ...NAVY_DIRECTION.type,
    // D-Rest: a large light numeral.
    timerDisplay: { size: 88, lineHeight: 92, weight: '300', tabular: 'always', textStyle: 'largeTitle', maxScale: 1.4, letterSpacing: -2 },
    // D-ActiveSet LOAD/REPS tiles.
    loadDisplay: { size: 38, lineHeight: 44, weight: '500', tabular: 'always', textStyle: 'largeTitle', maxScale: 1.8, letterSpacing: -0.5 },
    // Semibold rather than Bold (research §6.5); 30pt exercise name (D-ActiveSet).
    title1: { size: 30, lineHeight: 36, weight: '600', tabular: 'never', textStyle: 'title1', maxScale: 2.5, letterSpacing: -0.4 },
    // Tracked caps labels (`TODAY`, `LOAD`, `REST`): 12pt in the mockups, raised a step to 13pt (Ben, 20 Oct); still scaled by Dynamic Type.
    sectionLabel: { size: 13, lineHeight: 18, weight: '600', tabular: 'never', textStyle: 'callout', maxScale: 3, uppercase: true, letterSpacing: 1.2 },
  },
  radius: { sm: 8, md: 14, lg: 20, pill: 999 },
};

/** Every look that has values. B and C (and D-Clay) are added as further objects. */
export const THEME_DIRECTIONS = {
  A: NAVY_DIRECTION,
  D: PREMIUM_DIRECTION,
} as const satisfies Partial<Record<ThemeDirection['id'], ThemeDirection>>;
export type AvailableDirectionId = keyof typeof THEME_DIRECTIONS;

/** The default look (provisional decision 2026-10-09: D). A is selectable in Developer settings. */
export const DEFAULT_DIRECTION_ID: AvailableDirectionId = 'D';
export const CURRENT_DIRECTION: ThemeDirection = THEME_DIRECTIONS[DEFAULT_DIRECTION_ID];

export function directionById(id: string | null | undefined): ThemeDirection {
  return id === 'A' || id === 'D' ? THEME_DIRECTIONS[id] : CURRENT_DIRECTION;
}

/**
 * D is dark only: Ben approved it as dark mockups, and its light variant was
 * never reviewed (first-run audit B3). A follows the system; dark is the
 * default (design-system §2).
 */
export function schemeFor(directionId: string, system: string | null | undefined): ColorScheme {
  if (directionId === 'D') return 'dark';
  return system === 'light' ? 'light' : 'dark';
}

/** design-system §2.2: values mirrored where `theme.ts` can't be imported. */
export function outsideMirrors(direction: ThemeDirection): Record<'widget.accent' | 'widget.warning' | 'widget.text' | 'icon.canvas' | 'icon.mark' | 'launch.bg' | 'launch.mark', Record<ColorScheme, string>> {
  const { dark, light } = direction.colors;
  return {
    'widget.accent': { dark: dark.accent, light: light.accent },
    'widget.warning': { dark: dark['status.warning'], light: light['status.warning'] },
    'widget.text': { dark: 'system label colours', light: 'system label colours' },
    // The icon is a single dark design.
    'icon.canvas': { dark: dark['bg.canvas'], light: dark['bg.canvas'] },
    'icon.mark': { dark: dark.accent, light: dark.accent },
    'launch.bg': { dark: dark['bg.canvas'], light: light['bg.canvas'] },
    'launch.mark': { dark: dark.accent, light: light.accent },
  };
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** design-system §6. Durations in milliseconds unless the shape says otherwise. */
export const TIMING = {
  fast: 150,
  /** The system sheet animation; never re-timed in JS. */
  sheet: 'system',
  commitGuard: 1000,
  undoToast: 8 * SECOND,
  valueChangeGuard: 1000,
  coachTimeout: 20 * SECOND,
  coachStreamStall: 20 * SECOND,
  coachBuildTimeout: 60 * SECOND,
  signInTimeout: 5 * MINUTE,
  placeholderDelay: 300,
  coverDelay: 1000,
  staleWorkout: 6 * HOUR,
  spokenOfferMinRest: 20 * SECOND,
  cueOverlapWait: 3 * SECOND,
  lateCueDrop: 5 * SECOND,
  voiceEndSilence: 1200,
  voiceMaxUtterance: 12 * SECOND,
  voiceClarifyWindow: 8 * SECOND,
  clarifyExpiry: 30 * SECOND,
  ttsFallback: 3 * SECOND,
  loudModeMinRest: 2 * MINUTE,
  stillRunningReminder: 60 * MINUTE,
  checkInReuse: 2 * HOUR,
  offPhoneReminder: 30 * DAY,
  expiryNotice: 72 * HOUR,
  expiryUrgent: 24 * HOUR,
  /** One local notification at 19:00 local, two days before signing expiry. */
  expiryReminder: { localTime: '19:00', daysBefore: 2 },
} as const;
export type TimingToken = keyof typeof TIMING;

/** design-system §6 haptics, as the platform feedback kind each one uses. */
export const HAPTICS = {
  commit: 'notificationSuccess',
  undo: 'impactLight',
  step: 'selection',
  restEnd: 'notificationWarning',
  /** Heaviest-set line (premium-feel §5): medium then light, 90 ms apart. Replaces `commit` for that log. */
  record: 'impactMediumThenLight',
  /** Summary shown after a successful Finish; never on discard (premium-feel §5). */
  finish: 'notificationSuccess',
} as const;

/**
 * design-system §6 motion (premium-feel.md §4.1). Durations in ms, distances
 * in pt. Everything here stays at or under 200 ms except `finish`, the one
 * marked exception (Ben to approve, premium-feel §13), and `recordPulse`
 * (exception 3, 300 ms, once per record). `restRing` isn't built (it's off
 * by default in the spec).
 */
export const MOTION = {
  pressIn: { durationMs: 80 },
  pressOut: { durationMs: 160 },
  'pressScale.primary': { scale: 0.97 },
  'pressScale.pill': { scale: 0.95 },
  'pressOpacity.text': { opacity: 0.55 },
  swap: { durationMs: 180, risePt: 8, reducedDurationMs: 150 },
  listEnter: { durationMs: 160, risePt: 6, staggerMs: 35, maxStaggered: 6 },
  digit: { durationMs: 140 },
  screenFade: { durationMs: 200 },
  finish: { strokeMs: 420, titleFadeMs: 200, titleDelayMs: 120 },
  recordPulse: { durationMs: 300, scale: 1.06 },
} as const;
export type MotionToken = keyof typeof MOTION;
export type HapticToken = keyof typeof HAPTICS;

/** design-system §6 and §9 (sound asset). */
export const SOUNDS = {
  restEnd: { file: 'rest-end.caf', maxSeconds: 2 },
} as const;
export type SoundToken = keyof typeof SOUNDS;

/**
 * Every token name, fully qualified as design-system.md writes it
 * (`color.bg.canvas`, `type.body`, `timing.fast`, …). Used by the
 * completeness test and handy for debugging.
 */
export function tokenNames(direction: ThemeDirection = CURRENT_DIRECTION): string[] {
  return [
    ...BASE_COLOR_TOKENS.map((t) => `color.${t}`),
    ...Object.keys(CHART_COLOR_ALIASES).map((t) => `color.${t}`),
    ...Object.keys(direction.type).map((t) => `type.${t}`),
    ...Object.keys(direction.space).map((t) => `space.${t}`),
    ...Object.keys(direction.radius).map((t) => `radius.${t}`),
    ...Object.keys(direction.target).map((t) => `target.${t}`),
    ...Object.keys(direction.components).map((t) => `component.${t}`),
    ...Object.keys(direction.chart).map((t) => `chart.${t}`),
    ...Object.keys(outsideMirrors(direction)),
    ...Object.keys(TIMING).map((t) => `timing.${t}`),
    ...Object.keys(HAPTICS).map((t) => `haptic.${t}`),
    ...Object.keys(MOTION).map((t) => `motion.${t}`),
    ...Object.keys(SOUNDS).map((t) => `sound.${t}`),
  ];
}

/** Accessibility settings that change tokens (design-system §2, §3, §6). */
export interface AccessibilityPrefs {
  /** iOS Bold Text: every weight moves up one step. */
  boldText: boolean;
  /** iOS Increase Contrast: tertiary text becomes secondary; dividers 2pt in border.control. */
  increaseContrast: boolean;
  /** iOS Reduce Motion: slides become cross-fades or nothing. */
  reduceMotion: boolean;
}

export const DEFAULT_A11Y: AccessibilityPrefs = { boldText: false, increaseContrast: false, reduceMotion: false };

export interface ResolvedTextStyle {
  fontSize: number;
  lineHeight: number;
  fontWeight: FontWeight;
  maxFontSizeMultiplier: number;
  tabular: TypeToken['tabular'];
  uppercase: boolean;
  letterSpacing: number;
}

export interface ResolvedTheme {
  directionId: ThemeDirection['id'];
  scheme: ColorScheme;
  colors: Record<ColorToken, string>;
  type: Record<InAppTypeTokenName, ResolvedTextStyle>;
  space: Record<SpaceToken, number>;
  radius: Record<RadiusToken, number>;
  target: TargetTokens;
  components: ComponentShapes;
  chart: ChartDimensions & { activeLineWidth: number };
  /** Width of decorative dividers (2 under Increase Contrast). */
  dividerWidth: number;
  timing: typeof TIMING;
  haptics: typeof HAPTICS;
  a11y: AccessibilityPrefs;
}

const NEXT_WEIGHT: Record<FontWeight, FontWeight> = { '300': '400', '400': '500', '500': '600', '600': '700', '700': '700' };

/** Resolve one direction for one scheme and the current accessibility settings. Pure. */
export function resolveTheme(direction: ThemeDirection, scheme: ColorScheme, a11y: AccessibilityPrefs = DEFAULT_A11Y): ResolvedTheme {
  const base = { ...direction.colors[scheme] };
  if (a11y.increaseContrast) {
    base['text.tertiary'] = base['text.secondary'];
    base['border.divider'] = base['border.control'];
  }
  const chartColors = Object.fromEntries(
    Object.entries(CHART_COLOR_ALIASES).map(([token, alias]) => [token, base[alias]]),
  ) as Record<ChartColorToken, string>;
  const type = {} as Record<InAppTypeTokenName, ResolvedTextStyle>;
  for (const name of TYPE_TOKENS) {
    if (name === 'liveCountdown') continue;
    const t = direction.type[name];
    type[name] = {
      fontSize: t.size,
      lineHeight: t.lineHeight,
      fontWeight: a11y.boldText ? NEXT_WEIGHT[t.weight] : t.weight,
      maxFontSizeMultiplier: t.maxScale,
      tabular: t.tabular,
      uppercase: t.uppercase === true,
      letterSpacing: t.letterSpacing ?? 0,
    };
  }
  return {
    directionId: direction.id,
    scheme,
    colors: { ...base, ...chartColors },
    type,
    space: direction.space,
    radius: direction.radius,
    target: direction.target,
    components: direction.components,
    chart: { ...direction.chart, activeLineWidth: a11y.increaseContrast ? direction.chart.lineWidthIncreasedContrast : direction.chart.lineWidth },
    dividerWidth: a11y.increaseContrast ? 2 : 1,
    timing: TIMING,
    haptics: HAPTICS,
    a11y,
  };
}
