import { Pressable, View } from 'react-native';

import { WORKOUT_LIST_COPY, workoutListTargetLines, type WorkoutListRow } from '@fizz/domain';

import { useTheme } from '../theme';
import { Icon } from './Icon';
import { AppText } from './Text';

/**
 * (Redesign v3 §B, Ben 27 Oct) The compact read-only WorkoutList: `Exercise · Sets · Target kg`, one row per exercise,
 * supersets in a ruled box with `SUPERSET` over them. Used on Today's card, Library › Plan › day and a saved workout's
 * page. Values come from `workoutListRows` (domain): `ea` on per-dumbbell loads, `DB` in names; VoiceOver reads each
 * row's full words (`Dumbbell shoulder press … 24 kilograms each`). Sets and Target ≈14 pt (sets secondary) so each
 * stays on one line; headers ≈11 pt. A row's coach value (`✦ 22 ea`) taps through to the offer.
 */

export const WORKOUT_LIST_LAYOUT = { rowMinHeight: 48, setsWidth: 72, targetWidth: 62, nameSize: 15, nameLine: 20, valueSize: 14, valueLine: 20, headerSize: 11, headerLine: 14 } as const;

export function WorkoutList({ rows, target, onRow, onCoach, changed }: { rows: readonly WorkoutListRow[]; /** `Target kg`. */ target: string; onRow?: (row: WorkoutListRow) => void; onCoach?: (row: WorkoutListRow) => void; /** (Ben, 29 Oct) Exercises a one-change edit put in: a small accent dot after the name. */ changed?: ReadonlySet<string> }) {
  const theme = useTheme();
  const L = WORKOUT_LIST_LAYOUT;
  const groups: WorkoutListRow[][] = [];
  for (const r of rows) {
    const last = groups[groups.length - 1];
    if (r.superset !== null && last !== undefined && last[0]?.superset === r.superset) last.push(r);
    else groups.push([r]);
  }
  const head = { fontSize: L.headerSize, lineHeight: L.headerLine } as const;
  const value = { fontSize: L.valueSize, lineHeight: L.valueLine } as const;
  const row = (r: WorkoutListRow, first: boolean) => {
    const body = (
      <>
        <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: theme.space['1'] }}>
          {r.held ? <Icon name="exclamationmark.triangle" size={13} color="status.warning" /> : null}
          <AppText variant="body" style={{ flexShrink: 1, fontSize: L.nameSize, lineHeight: L.nameLine, ...(r.main ? { fontWeight: '600' } : {}) }}>
            {r.name}
          </AppText>
          {changed?.has(r.exerciseId) === true ? <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: theme.colors.accent }} /> : null}
        </View>
        <AppText variant="callout" color="text.secondary" numeric numberOfLines={1} align="right" style={{ width: L.setsWidth, ...value }}>
          {r.sets}
        </AppText>
        {r.coach !== null && onCoach !== undefined ? (
          <Pressable accessibilityRole="button" accessibilityLabel={r.accessibilityLabel} hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }} onPress={() => { onCoach(r); }} style={{ width: L.targetWidth, alignItems: 'flex-end' }}>
            <AppText variant="callout" color="accent" numeric numberOfLines={1} style={value}>
              {r.coach}
            </AppText>
          </Pressable>
        ) : (
          <AppText variant="callout" numeric numberOfLines={1} align="right" color={r.coach !== null ? 'accent' : 'text.primary'} style={{ width: L.targetWidth, ...value }}>
            {r.coach ?? r.target}
          </AppText>
        )}
      </>
    );
    const style = { minHeight: L.rowMinHeight, flexDirection: 'row' as const, alignItems: 'center' as const, gap: theme.space['2'], borderTopWidth: first ? 0 : theme.dividerWidth, borderTopColor: theme.colors['border.divider'] };
    return onRow === undefined ? (
      <View key={r.key} accessible accessibilityLabel={changed?.has(r.exerciseId) === true ? `${r.accessibilityLabel}, changed` : r.accessibilityLabel} style={style}>
        {body}
      </View>
    ) : (
      <Pressable key={r.key} accessibilityRole="button" accessibilityLabel={changed?.has(r.exerciseId) === true ? `${r.accessibilityLabel}, changed` : r.accessibilityLabel} onPress={() => { onRow(r); }} style={({ pressed }) => ({ ...style, opacity: pressed ? 0.7 : 1 })}>
        {body}
      </Pressable>
    );
  };
  return (
    <View>
      <View accessible={false} importantForAccessibility="no-hide-descendants" style={{ flexDirection: 'row', alignItems: 'flex-end', gap: theme.space['2'], paddingBottom: theme.space['1'], borderBottomWidth: theme.dividerWidth, borderBottomColor: theme.colors['border.divider'] }}>
        <AppText variant="sectionLabel" color="text.tertiary" style={{ flex: 1, ...head }}>
          {WORKOUT_LIST_COPY.exercise}
        </AppText>
        <AppText variant="sectionLabel" color="text.tertiary" align="right" style={{ width: L.setsWidth, ...head }}>
          {WORKOUT_LIST_COPY.sets}
        </AppText>
        <AppText variant="sectionLabel" color="text.tertiary" align="right" style={{ width: L.targetWidth, ...head }}>
          {workoutListTargetLines(target).join('\n')}
        </AppText>
      </View>
      {groups.map((g, gi) =>
        g.length > 1 ? (
          <View key={`ss:${g[0]?.key ?? ''}`} accessibilityLabel={WORKOUT_LIST_COPY.superset} style={{ borderLeftWidth: 2, borderLeftColor: theme.colors['text.tertiary'], paddingLeft: theme.space['3'], borderTopWidth: gi === 0 ? 0 : theme.dividerWidth, borderTopColor: theme.colors['border.divider'] }}>
            <AppText variant="sectionLabel" color="text.tertiary" accessible={false} style={{ ...head, paddingTop: theme.space['2'] }}>
              {WORKOUT_LIST_COPY.superset}
            </AppText>
            {g.map((r, i) => row(r, i === 0))}
          </View>
        ) : (
          g.map((r) => row(r, gi === 0))
        ),
      )}
    </View>
  );
}
