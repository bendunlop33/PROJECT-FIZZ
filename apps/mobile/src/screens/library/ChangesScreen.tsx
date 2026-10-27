import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CHANGE_TAP_LABEL, changeRowTaps, LIBRARY_CHANGES_COPY as C, type ChangeRowView, type ChangeTap, type LibraryChangeRow } from '@fizz/domain';

import { haptic } from '../../device/haptics';
import { newUuid } from '../../device/runtime';
import type { LibraryChangesData } from '../../library/library-changes-service';
import type { LibraryStackParams } from '../../navigation/types';
import { runChangeTap } from '../../reviews/change-taps';
import { useDataChanged, useScreenData, useServices } from '../../shell/context';
import { TIMING, useTheme } from '../../theme';
import { AppText, Eyebrow, Icon, PrimaryButton, SecondaryButton, StatusLine, TextButton, Toast, ToastHost, toastBottom } from '../../ui';

/**
 * Library › Plan › **Changes** (redesign 27 Oct, D2; prototype `Plan › Changes`): the coach's changes to come, moved
 * here from Progress. `Next week`: the small changes already made (`Bench press 82.5 → 85 kg` · its day, `Why?`,
 * `Undo`), then the bigger ones asked (Apply / Skip; never made before Ben's tap, rule 3). `Earlier changes ›`:
 * older weekly reviews. Every row and number comes from `services.libraryChanges` (stored records); every tap is
 * the record's own versioned write with its op ID (rule 5), and a toast says what happened. Local only (rule 1).
 */
export function ChangesScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const services = useServices();
  const changed = useDataChanged();
  const stack = useNavigation<NativeStackNavigationProp<LibraryStackParams, 'LibraryChanges'>>();
  const [data, reload] = useScreenData((s) => s.libraryChanges.read());
  const [toast, setToast] = useState<string | null>(null);
  const busy = useRef(false);
  // One op ID per row and tap while on screen: a double tap is the same write, replayed.
  const ops = useRef(new Map<string, string>());
  useEffect(() => {
    if (toast === null) return;
    const t = setTimeout(() => {
      setToast(null);
    }, TIMING.undoToast);
    return () => {
      clearTimeout(t);
    };
  }, [toast]);

  const value: LibraryChangesData | null = data.state === 'ready' ? data.value : null;

  function tap(row: LibraryChangeRow, t: ChangeTap) {
    if (value === null || busy.current) return;
    busy.current = true;
    haptic('step');
    const key = `${row.key}:${t}`;
    const opId = ops.current.get(key) ?? newUuid();
    ops.current.set(key, opId);
    void services.libraryChanges
      .tap(value, row, t, opId)
      .then((r) => {
        ops.current.delete(key);
        changed();
        reload();
        setToast(r.ok ? r.text : r.message);
      })
      .finally(() => {
        busy.current = false;
      });
  }

  const v = value?.view ?? null;
  return (
    <View style={{ flex: 1, backgroundColor: theme.colors['bg.canvas'] }}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingHorizontal: theme.components.screenMargin, paddingTop: theme.space['3'], paddingBottom: theme.space['8'] + insets.bottom, gap: theme.space['4'] }}>
        {data.state === 'error' ? <StatusLine icon="exclamationmark.triangle" tone="warning" text="Couldn’t load changes." action={<TextButton label="Try again" onPress={reload} />} /> : null}
        {v !== null ? (
          <>
            <View style={{ gap: theme.space['2'] }}>
              <View accessibilityRole="header">
                <Eyebrow>{C.nextWeek}</Eyebrow>
              </View>
              {v.note !== null ? (
                <AppText variant="callout" color="text.secondary">
                  {v.note}
                </AppText>
              ) : null}
              {v.tweaks.length === 0 && v.offers.length === 0 ? (
                <AppText variant="body" color="text.secondary">
                  {C.none}
                </AppText>
              ) : null}
              {v.tweaks.length > 0 ? (
                <View style={{ backgroundColor: theme.colors['bg.surface'], borderRadius: theme.radius.lg, paddingHorizontal: theme.space['4'] }}>
                  {v.tweaks.map((r, i) => (
                    <TweakRow
                      key={r.key}
                      row={r}
                      first={i === 0}
                      onTap={(t) => {
                        tap(r, t);
                      }}
                    />
                  ))}
                </View>
              ) : null}
              {v.offers.map((r) => (
                <OfferCard
                  key={r.key}
                  row={r}
                  onTap={(t) => {
                    tap(r, t);
                  }}
                />
              ))}
            </View>
            {v.hasEarlier ? (
              <TextButton
                label={`${C.earlier} ›`}
                tone="secondary"
                onPress={() => {
                  stack.navigate('LibraryEarlierChanges');
                }}
              />
            ) : null}
          </>
        ) : null}
      </ScrollView>
      <ToastHost bottom={toastBottom({ footerHeight: null, insetBottom: insets.bottom, space2: theme.space['2'], tab: true })}>{toast !== null ? <Toast icon="info.circle" text={toast} /> : null}</ToastHost>
    </View>
  );
}

/** `Why?` and its lines under a row (minimal copy: the reason is never on the row itself). */
function WhyLink({ lines, label }: { lines: readonly string[]; label: string }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  if (lines.length === 0) return null;
  return (
    <View style={{ gap: theme.space['1'] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${C.why} ${label}`}
        accessibilityState={{ expanded: open }}
        onPress={() => {
          setOpen((o) => !o);
        }}
        hitSlop={6}
        style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start', opacity: pressed ? 0.7 : 1 })}
      >
        <AppText variant="callout" color="text.secondary" style={{ textDecorationLine: 'underline' }}>
          {C.why}
        </AppText>
      </Pressable>
      {open
        ? lines.map((l) => (
            <AppText key={l} variant="callout" color="text.secondary" numeric>
              {l}
            </AppText>
          ))
        : null}
    </View>
  );
}

/** A change made (Undo) or undone (Redo): `Bench press 82.5 → 85 kg` / `Push`, its button, `Why?`. */
export function TweakRow({ row, first, onTap }: { row: LibraryChangeRow; first: boolean; onTap: (t: ChangeTap) => void }) {
  const theme = useTheme();
  return (
    <View style={{ paddingVertical: theme.space['3'], gap: 2, borderTopWidth: first ? 0 : theme.dividerWidth, borderTopColor: theme.colors['border.divider'] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['3'] }}>
        <View accessible accessibilityLabel={row.accessibilityLabel} style={{ flex: 1, gap: 2 }}>
          <AppText variant="body" numeric style={{ fontWeight: '600' }}>
            {row.title}
          </AppText>
          {[row.sub, row.statusText].some((x) => x !== null) ? (
            <AppText variant="callout" color="text.secondary" numeric>
              {[row.sub, row.statusText].filter((x): x is string => x !== null).join(' · ')}
            </AppText>
          ) : null}
        </View>
        {row.taps.map((t) => (
          <TextButton
            key={t}
            label={CHANGE_TAP_LABEL[t]}
            accessibilityLabel={`${CHANGE_TAP_LABEL[t]}: ${row.exerciseName}`}
            onPress={() => {
              onTap(t);
            }}
          />
        ))}
      </View>
      <WhyLink lines={row.why} label={row.exerciseName} />
    </View>
  );
}

/** A change asked: Apply / Skip (rule 3); answered ones keep their status and no buttons. */
function OfferCard({ row, onTap }: { row: LibraryChangeRow; onTap: (t: ChangeTap) => void }) {
  const theme = useTheme();
  return (
    <View style={{ backgroundColor: theme.colors['bg.surface'], borderRadius: theme.radius.lg, padding: theme.space['4'], gap: theme.space['2'] }}>
      <View accessible accessibilityLabel={row.accessibilityLabel} style={{ gap: 2 }}>
        <AppText variant="body" numeric style={{ fontWeight: '600' }}>
          {row.title}
        </AppText>
        {[row.sub, row.statusText].some((x) => x !== null) ? (
          <AppText variant="callout" color="text.secondary" numeric>
            {[row.sub, row.statusText].filter((x): x is string => x !== null).join(' · ')}
          </AppText>
        ) : null}
      </View>
      <WhyLink lines={row.why} label={row.exerciseName} />
      {row.taps.length > 0 ? (
        <View style={{ flexDirection: 'row', gap: theme.space['2'] }}>
          {row.taps.map((t) =>
            t === 'apply' ? (
              <View key={t} style={{ flex: 1 }}>
                <PrimaryButton
                  label={CHANGE_TAP_LABEL[t]}
                  onPress={() => {
                    onTap(t);
                  }}
                  accessibilityHint={row.accessibilityLabel}
                />
              </View>
            ) : (
              <SecondaryButton
                key={t}
                label={CHANGE_TAP_LABEL[t]}
                accessibilityLabel={`${CHANGE_TAP_LABEL[t]}: ${row.exerciseName}`}
                onPress={() => {
                  onTap(t);
                }}
              />
            ),
          )}
        </View>
      ) : null}
    </View>
  );
}

/**
 * `Earlier changes ›`: each earlier weekly review (newest first; the newest one too while it isn't next week's), as
 * stored. A tap opens that week's changes. Local only.
 */
export function EarlierChangesScreen() {
  const theme = useTheme();
  const stack = useNavigation<NativeStackNavigationProp<LibraryStackParams, 'LibraryEarlierChanges'>>();
  const [data] = useScreenData(async (s) => {
    const [past, now] = await Promise.all([s.reviews.pastWeeks().catch(() => []), s.reviews.changesNow().catch(() => null)]);
    const newest = now?.view != null && !now.view.current ? [{ reviewId: now.view.reviewId, title: now.view.week, detail: now.view.collapsed, accessibilityLabel: `${now.view.week}, ${now.view.collapsed}` }] : [];
    return [...newest, ...past.map((p) => ({ reviewId: p.reviewId, title: p.title, detail: p.detail, accessibilityLabel: p.accessibilityLabel }))];
  });
  const rows = data.state === 'ready' ? data.value : [];
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: theme.colors['bg.canvas'] }} contentContainerStyle={{ paddingHorizontal: theme.components.screenMargin, paddingTop: theme.space['4'], paddingBottom: theme.space['8'] }}>
      {data.state === 'ready' && rows.length === 0 ? (
        <AppText variant="body" color="text.secondary">
          {C.none}
        </AppText>
      ) : null}
      {rows.map((h, i) => (
        <Pressable
          key={h.reviewId}
          accessibilityRole="button"
          accessibilityLabel={h.accessibilityLabel}
          onPress={() => {
            stack.navigate('LibraryEarlierWeek', { reviewId: h.reviewId });
          }}
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: theme.space['3'], minHeight: 56, paddingVertical: theme.space['2'], borderTopWidth: i === 0 ? 0 : theme.dividerWidth, borderColor: theme.colors['border.divider'], opacity: pressed ? 0.7 : 1 })}
        >
          <View style={{ flex: 1, gap: 2 }}>
            <AppText variant="body" numeric>
              {h.title}
            </AppText>
            <AppText variant="callout" color="text.secondary" numeric>
              {h.detail}
            </AppText>
          </View>
          <Icon name="chevron.right" size={14} color="text.tertiary" />
        </Pressable>
      ))}
    </ScrollView>
  );
}

/** `Row 4 → 3 sets` from a stored change's own words (`4 sets`, `3 sets`). */
function earlierTitle(r: Pick<ChangeRowView, 'exercise' | 'before' | 'after'>): string {
  const n = (t: string) => t.replace(/ sets?$/, '');
  return `${r.exercise} ${n(r.before)} → ${r.after}`;
}

/** One earlier week: its coach sentence and its changes (Undo / Redo while they still apply; offers Apply / Skip). */
export function EarlierWeekScreen({ route }: NativeStackScreenProps<LibraryStackParams, 'LibraryEarlierWeek'>) {
  const theme = useTheme();
  const services = useServices();
  const changed = useDataChanged();
  const [data, reload] = useScreenData((s) => s.reviews.review(route.params.reviewId));
  const [message, setMessage] = useState<string | null>(null);
  const busy = useRef(false);
  const d = data.state === 'ready' ? data.value : null;
  const tap = (row: ChangeRowView, t: ChangeTap) => {
    if (d === null || busy.current) return;
    busy.current = true;
    haptic('step');
    void runChangeTap(services.reviews, t, { reviewId: d.card.reviewId, proposalId: row.id, opId: newUuid() })
      .then((r) => {
        setMessage(r.ok ? null : r.message);
        changed();
        reload();
      })
      .finally(() => {
        busy.current = false;
      });
  };
  const rows = d?.changes === null || d === null ? [] : [...d.changes.rows, ...d.changes.asks];
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: theme.colors['bg.canvas'] }} contentContainerStyle={{ paddingHorizontal: theme.components.screenMargin, paddingTop: theme.space['4'], paddingBottom: theme.space['8'], gap: theme.space['4'] }}>
      {d !== null ? (
        <>
          <View accessible accessibilityLabel={d.card.accessibilityLabel} style={{ gap: theme.space['1'] }}>
            <AppText variant="label" color="text.secondary" numeric>
              {d.card.week}
            </AppText>
            <AppText variant="body" color={d.card.reviewed ? 'text.primary' : 'text.secondary'}>
              {d.card.verdict}
            </AppText>
          </View>
          {rows.length === 0 ? (
            <AppText variant="body" color="text.secondary">
              {C.none}
            </AppText>
          ) : (
            <View style={{ backgroundColor: theme.colors['bg.surface'], borderRadius: theme.radius.lg, paddingHorizontal: theme.space['4'] }}>
              {rows.map((r, i) => (
                <View key={r.id} style={{ paddingVertical: theme.space['3'], gap: 2, borderTopWidth: i === 0 ? 0 : theme.dividerWidth, borderTopColor: theme.colors['border.divider'] }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}>
                    <View accessible accessibilityLabel={r.accessibilityLabel} style={{ flex: 1, gap: 2 }}>
                      <AppText variant="body" numeric style={{ fontWeight: '600' }}>
                        {earlierTitle(r)}
                      </AppText>
                      {r.statusText !== null ? (
                        <AppText variant="callout" color="text.secondary">
                          {r.statusText}
                        </AppText>
                      ) : null}
                    </View>
                    {changeRowTaps(r).map((t) => (
                      <TextButton
                        key={t}
                        label={CHANGE_TAP_LABEL[t]}
                        accessibilityLabel={`${CHANGE_TAP_LABEL[t]}: ${r.exercise}`}
                        onPress={() => {
                          tap(r, t);
                        }}
                      />
                    ))}
                  </View>
                  <WhyLink lines={r.why === null ? [] : [r.why]} label={r.exercise} />
                </View>
              ))}
            </View>
          )}
          {message !== null ? (
            <AppText variant="callout" color="text.secondary" accessibilityLiveRegion="polite">
              {message}
            </AppText>
          ) : null}
        </>
      ) : null}
    </ScrollView>
  );
}
