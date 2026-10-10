import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '../../theme';
import { HeroHeader, Screen, TextButton } from '../../ui';

/**
 * `OnboardingFrame` (design-system §9.46): top bar with Back and an optional
 * Skip; `Step n of m` over the title; one line of explanation;
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
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44, paddingHorizontal: theme.components.screenMargin }}>
        <View>{onBack ? <TextButton label="Back" icon="chevron.left" onPress={onBack} /> : null}</View>
        <View>{onSkip ? <TextButton label="Skip" tone="secondary" onPress={onSkip} /> : null}</View>
      </View>
      <Screen footer={footer}>
        {/* D: `STEP 1 OF 3` as a tracked eyebrow over a large title (D-Today hero). */}
        <View style={{ paddingTop: theme.space['2'], paddingBottom: theme.space['2'] }}>
          <HeroHeader size="screen" eyebrow={step} title={title} lines={explanation ? [explanation] : []} />
        </View>
        {children}
      </Screen>
    </View>
  );
}
