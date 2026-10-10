import { useEffect, useState } from 'react';
import { ActionSheetIOS, Pressable, ScrollView, View } from 'react-native';

import { toMs } from '@fizz/domain';

import { formatShortDate } from '../../format/dates';
import type { RoutinePreview, RoutineRow } from '../../services/workout-services';
import { useServices } from '../../shell/context';
import { useTheme } from '../../theme';
import { AppText, BottomCard, Icon, PrimaryButton, StatusLine, Tag, TextButton } from '../../ui';

/**
 * The routine sheet (premium-feel §2.6): name and `⋯` (Rename · Delete), when
 * it was last done, the targets `Start this routine` would create at this gym
 * (already snapped to its equipment, each saying `Target`), rounding notes,
 * where the targets come from, then Start. Saves nothing until Start. Shows
 * static placeholder rows while it reads, never a blank card (§7.1).
 */
export function RoutineSheet({
  row,
  gymId,
  visible,
  starting,
  onStart,
  onRename,
  onDelete,
  onClose,
  onDismissed,
}: {
  row: RoutineRow | null;
  gymId: string | null;
  visible: boolean;
  starting: boolean;
  onStart: (row: RoutineRow) => void;
  onRename: (row: RoutineRow) => void;
  onDelete: (row: RoutineRow) => void;
  onClose: () => void;
  onDismissed?: () => void;
}) {
  const theme = useTheme();
  const services = useServices();
  const [why, setWhy] = useState(false);
  const [preview, setPreview] = useState<{ state: 'loading' } | { state: 'ready'; value: RoutinePreview | null }>({ state: 'loading' });

  useEffect(() => {
    if (!visible || row === null) return;
    let live = true;
    setPreview({ state: 'loading' });
    setWhy(false);
    const read = gymId === null ? Promise.resolve(null) : services.routines.preview(row.id, gymId);
    void read.then((value) => {
      if (live) setPreview({ state: 'ready', value });
    });
    return () => {
      live = false;
    };
  }, [visible, row, gymId, services]);

  if (row === null) return null;
  const p = preview.state === 'ready' ? preview.value : null;
  const last = p?.lastDone ?? null;
  const lastLine = [
    `${String(row.exercises)} ${row.exercises === 1 ? 'exercise' : 'exercises'}`,
    p?.aboutMinutes != null ? `about ${String(p.aboutMinutes)} min` : null,
    last ? `last done ${formatShortDate(toMs(last.atUtc), last.tz)}${last.gymName ? ` at ${last.gymName}` : ''}` : 'not done yet',
  ]
    .filter(Boolean)
    .join(' · ');

  function menu(r: RoutineRow) {
    ActionSheetIOS.showActionSheetWithOptions({ title: r.name, options: ['Rename', 'Delete', 'Cancel'], destructiveButtonIndex: 1, cancelButtonIndex: 2 }, (i) => {
      if (i === 0) onRename(r);
      if (i === 1) onDelete(r);
    });
  }

  return (
    <BottomCard visible={visible} onClose={onClose} {...(onDismissed ? { onDismissed } : {})}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}>
        <AppText variant="title2" accessibilityRole="header" numberOfLines={2} style={{ flex: 1 }}>
          {row.name}
        </AppText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`More for ${row.name}`}
          onPress={() => {
            menu(row);
          }}
          style={({ pressed }) => ({ minWidth: theme.target.min.width, minHeight: theme.target.min.height, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}
        >
          <Icon name="ellipsis" color="text.secondary" size={20} />
        </Pressable>
      </View>
      <AppText variant="callout" color="text.secondary" numeric>
        {preview.state === 'loading' ? ' ' : lastLine}
      </AppText>
      <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ gap: theme.space['1'] }}>
        {preview.state === 'loading'
          ? Array.from({ length: Math.min(4, Math.max(1, row.exercises)) }, (_, i) => <PlaceholderRow key={i} />)
          : (p?.targets ?? []).map((t, i) => (
              <View key={`${String(i)}:${t.exerciseName}`} accessible accessibilityLabel={`${t.exerciseName}. ${t.line}`} style={{ minHeight: theme.target.min.height, justifyContent: 'center', paddingVertical: theme.space['1'] }}>
                <AppText variant="body">{t.exerciseName}</AppText>
                <AppText variant="callout" color="text.secondary" numeric>
                  {t.line}
                </AppText>
              </View>
            ))}
      </ScrollView>
      {preview.state === 'ready' && p === null ? <StatusLine icon="exclamationmark.triangle" tone="warning" text="Couldn’t read targets." /> : null}
      {(p?.notes ?? []).map((n, i) => (
        <AppText key={`n${String(i)}`} variant="callout" color="text.secondary">
          {`${n.exerciseName}: ${n.text}`}
        </AppText>
      ))}
      {/* Where the targets come from: a short tag, the explanation behind `Why?` (CLAUDE.md minimal copy). */}
      {p?.source === 'built_in_rule' ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['3'] }}>
          <Tag text="Rule" />
          <TextButton
            label={why ? 'Next targets from the built-in rule' : 'Why?'}
            tone="secondary"
            onPress={() => {
              setWhy((w) => !w);
            }}
          />
        </View>
      ) : null}
      <PrimaryButton
        label="Start this routine"
        busy={starting}
        onPress={() => {
          onStart(row);
        }}
      />
    </BottomCard>
  );
}

function PlaceholderRow() {
  const theme = useTheme();
  return (
    <View style={{ minHeight: theme.target.min.height, justifyContent: 'center', gap: theme.space['1'] }}>
      <View style={{ height: 14, width: '55%', borderRadius: 4, backgroundColor: theme.colors['bg.raised'] }} />
      <View style={{ height: 12, width: '40%', borderRadius: 4, backgroundColor: theme.colors['bg.raised'] }} />
    </View>
  );
}
