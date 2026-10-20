import { useWindowDimensions, View } from 'react-native';

import { useTheme } from '../theme';
import { AX_FONT_SCALE } from '../workout/overview';
import { AppText } from './Text';

/**
 * A list row's title and detail (design pass 5.4, 20 Oct). Below AX sizes: one line, the title
 * takes the room (2 lines max) and the detail shrinks, right-aligned, never cut. At AX sizes they
 * stack (title, then detail) so a workout name stays readable. Put it where the row's two texts were.
 */
export function RowText({ title, detail, titleColor = 'text.primary', titleWeight }: { title: string; detail: string; titleColor?: 'text.primary' | 'text.secondary'; titleWeight?: '400' | '600' }) {
  const theme = useTheme();
  const ax = useWindowDimensions().fontScale >= AX_FONT_SCALE;
  const titleStyle = titleWeight === undefined ? undefined : { fontWeight: titleWeight };
  if (ax) {
    return (
      <View style={{ flex: 1, paddingVertical: theme.space['1'] }}>
        <AppText variant="body" color={titleColor} style={titleStyle}>
          {title}
        </AppText>
        <AppText variant="callout" color="text.secondary" numeric>
          {detail}
        </AppText>
      </View>
    );
  }
  return (
    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: theme.space['3'] }}>
      <AppText variant="body" numberOfLines={2} color={titleColor} style={[{ flex: 1 }, titleStyle]}>
        {title}
      </AppText>
      <AppText variant="callout" color="text.secondary" numeric style={{ flexShrink: 1, textAlign: 'right' }}>
        {detail}
      </AppText>
    </View>
  );
}
