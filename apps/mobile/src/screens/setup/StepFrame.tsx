import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '../../theme';
import { AppText, Screen, TextButton } from '../../ui';

/**
 * `OnboardingFrame` (design-system §9.46): top bar with Back, a centred
 * `Step n of m` and an optional Skip; title; one line of explanation;
 * scrolling content; a fixed bottom bar with one primary button.
 */
export function StepFrame({
  step,
  title,
  explanation,
  onBack,
  onSkip,
  footer,
  children,
}: {
  step: string | null;
  title: string;
  explanation?: string;
  onBack?: (() => void) | undefined;
  onSkip?: (() => void) | undefined;
  footer: ReactNode;
  children?: ReactNode;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: theme.colors['bg.canvas'], paddingTop: insets.top }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingHorizontal: theme.components.screenMargin }}>
        <View style={{ flex: 1, alignItems: 'flex-start' }}>{onBack ? <TextButton label="Back" icon="chevron.left" onPress={onBack} /> : null}</View>
        {step ? (
          <AppText variant="label" color="text.secondary" numeric>
            {step}
          </AppText>
        ) : null}
        <View style={{ flex: 1, alignItems: 'flex-end' }}>{onSkip ? <TextButton label="Skip" tone="secondary" onPress={onSkip} /> : null}</View>
      </View>
      <Screen footer={footer}>
        <View style={{ gap: theme.space['2'] }}>
          <AppText variant="title2" accessibilityRole="header">
            {title}
          </AppText>
          {explanation ? (
            <AppText variant="callout" color="text.secondary">
              {explanation}
            </AppText>
          ) : null}
        </View>
        {children}
      </Screen>
    </View>
  );
}
