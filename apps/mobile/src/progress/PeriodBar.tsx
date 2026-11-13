import { Pressable, View } from 'react-native';

import { PERIOD_SPANS, type PeriodBarView, type PeriodSpan } from '@fizz/domain';

import { useTheme } from '../theme';
import { AppText, Icon } from '../ui';
import { Segmented } from './components';

/**
 * (Redesign v3 C2) Progress's one period bar: `Week | Month | 3M | 6M | 1Y`, then `‹ October 2026 ›`. Lifts, Training
 * and Body all follow it. `›` is hidden at the present; `‹` stops at the first logged period.
 */
export function PeriodBar({ bar, onSpan, onStep }: { bar: PeriodBarView; onSpan: (s: PeriodSpan) => void; onStep: (by: -1 | 1) => void }) {
  const theme = useTheme();
  const arrow = (by: -1 | 1, enabled: boolean) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={by < 0 ? 'Previous period' : 'Next period'}
      accessibilityState={{ disabled: !enabled }}
      disabled={!enabled}
      onPress={() => {
        onStep(by);
      }}
      style={{ minWidth: theme.target.min.width, minHeight: theme.target.min.height, alignItems: 'center', justifyContent: 'center', opacity: enabled ? 1 : 0 }}
    >
      <Icon name={by < 0 ? 'chevron.left' : 'chevron.right'} color="accent" size={20} />
    </Pressable>
  );
  return (
    <View style={{ gap: theme.space['2'] }}>
      <Segmented options={PERIOD_SPANS} selected={bar.span} onSelect={onSpan} label="Period" />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        {arrow(-1, bar.canBack)}
        <View accessible accessibilityRole="header" accessibilityLabel={bar.words} style={{ flex: 1, alignItems: 'center' }}>
          <AppText variant="headline" numeric numberOfLines={1}>
            {bar.title}
          </AppText>
          {bar.datesLine !== null ? (
            <AppText variant="callout" color="text.secondary" numeric numberOfLines={1}>
              {bar.datesLine}
            </AppText>
          ) : null}
        </View>
        {arrow(1, bar.canForward)}
      </View>
    </View>
  );
}
