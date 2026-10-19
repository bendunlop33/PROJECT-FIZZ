import { useNavigation } from '@react-navigation/native';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActionSheetIOS, Alert, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PLAN_OVERVIEW_COPY, withoutRoutines, type LibraryHistoryRow, type LibraryRow, type LibrarySort } from '@fizz/domain';
import type { Routine } from '@fizz/schemas';

import { newUuid } from '../../device/runtime';
import { popToTabs } from '../../navigation/actions';
import { PLAN_COPY } from '../../services/plan-services';
import type { EditorFrom, LibraryToastParam } from '../../navigation/types';
import { useDataChanged, useScreenData, useServices } from '../../shell/context';
import { TIMING, useTheme } from '../../theme';
import { AppText, Banner, Eyebrow, Icon, SecondaryButton, StatusLine, Tag, TextButton, Toast } from '../../ui';
import { deleteConfirm, LIBRARY_COPY_UI, LIBRARY_TOASTS, rowMenu } from '../../workout/library-view';
import { useSaveToWorkouts } from './SaveWorkoutSheet';
import { YourPlanBlock } from '../library/YourPlanBlock';

type Toasting = { text: string; action?: string; onAction?: () => void; why?: string } | null;

/**
 * The Workouts library (routines.md §A2.1, WL1–WL4): `YOUR ROTATION` from
 * Up next, `ALL WORKOUTS`, `FROM HISTORY` with `Save`. A row opens its
 * overview (where Start is); `⋯` (and long-press, and VoiceOver actions)
 * has Edit, Duplicate, rotation and Delete, each with Undo. Local only:
 * nothing here waits on network or AI. It is the Library tab's `Workouts`
 * segment (exercise-library EL10); the Library header's `＋` is
 * `NewWorkoutButton` (review library-browse B1).
 */
/** `＋` → `New workout` (44pt). */
export function NewWorkoutButton({ from }: { from: EditorFrom }) {
  const navigation = useNavigation();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={LIBRARY_COPY_UI.newWorkout}
      onPress={() => {
        navigation.navigate('WorkoutEditor', { routineId: null, from });
      }}
      style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}
    >
      <Icon name="plus" color="text.primary" size={22} />
    </Pressable>
  );
}

/**
 * The Workouts list's body: `from` is where the editor returns; `handedToast` is the editor's `Saved Push A` [Undo].
 * (Ben, 19 Oct) With a plan in use, `Your plan` leads and the list below is `Other workouts` (the plan's days are in the
 * block). `scrollTopKey`: a new value scrolls to the top (Today's `Day 2 of 4 ›`).
 */
export function WorkoutsList({ from, handedToast, onHandedToast, scrollTopKey }: { from: EditorFrom; handedToast: LibraryToastParam | undefined; onHandedToast: () => void; scrollTopKey?: string | undefined }) {
  const theme = useTheme();
  const services = useServices();
  const changed = useDataChanged();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [sort, setSort] = useState<LibrarySort>('recent');
  const [showAll, setShowAll] = useState(false);
  const [toast, setToast] = useState<Toasting>(null);
  const [placeholder, setPlaceholder] = useState(false);
  const busy = useRef(false);
  const [data, reload] = useScreenData(async (s) => {
    const gym = await s.yourData.currentGym().catch(() => null);
    // Review planview S5: a failed read is said, never shown as no plan.
    const [library, planRead] = await Promise.all([
      s.routines.library({ gymId: gym?.id ?? null, sort, showAllHistory: showAll }),
      s.plans.overview().then(
        (v) => ({ plan: v, planFailed: false }),
        () => ({ plan: null, planFailed: true }),
      ),
    ]);
    return { gym, library, ...planRead };
  });
  useEffect(() => {
    reload();
  }, [sort, showAll, reload]);
  const scrollRef = useRef<ScrollView>(null);
  useEffect(() => {
    if (scrollTopKey !== undefined) scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [scrollTopKey]);

  // Loading: nothing for 300 ms, then static rows (no shimmer).
  useEffect(() => {
    const t = setTimeout(() => {
      setPlaceholder(true);
    }, TIMING.placeholderDelay);
    return () => {
      clearTimeout(t);
    };
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => {
      setToast(null);
    }, TIMING.undoToast);
    return () => {
      clearTimeout(t);
    };
  }, [toast]);

  // A toast handed back by the editor (`Saved Push A` [Undo]).
  const handed = handedToast;
  useEffect(() => {
    if (!handed) return;
    showLibraryToast(handed);
    onHandedToast();
  }, [handed?.key]);

  function showLibraryToast(t: LibraryToastParam) {
    const undo = t.undo;
    setToast({
      text: t.text,
      ...(undo
        ? {
            action: LIBRARY_COPY_UI.undo,
            onAction: () => {
              setToast(null);
              const run = undo.kind === 'revert' ? services.routines.revert({ actionId: undo.actionId, opId: newUuid() }) : services.routines.remove({ routineId: undo.routineId, expectedVersion: undo.version, opId: newUuid() });
              void run.then((r) => {
                changed();
                if (!r.ok) setToast({ text: r.message });
              });
            },
          }
        : {}),
    });
  }

  const save = useSaveToWorkouts(
    (r: Routine) => {
      changed();
      showLibraryToast({ key: r.id, text: LIBRARY_COPY_UI.savedToWorkouts, undo: { kind: 'delete', routineId: r.id, version: r.version } });
    },
    () => {
      setToast({ text: LIBRARY_COPY_UI.nothingToSave });
    },
  );

  function openRow(row: LibraryRow) {
    navigation.navigate('WorkoutOverview', { target: { kind: 'routine', routineId: row.routineId } });
  }

  async function act(row: LibraryRow, action: string) {
    if (busy.current) return;
    busy.current = true;
    try {
      if (action === LIBRARY_COPY_UI.editWorkout) {
        navigation.navigate('WorkoutEditor', { routineId: row.routineId, from });
      } else if (action === LIBRARY_COPY_UI.duplicate) {
        const r = await services.routines.duplicate({ routineId: row.routineId, opId: newUuid() });
        if (!r.ok) {
          setToast({ text: r.message });
          return;
        }
        changed();
        // The toast comes back with Cancel, so its Undo is reachable (review S1).
        const copyToast = { key: r.routine.id, text: LIBRARY_TOASTS.saved(r.routine.name), undo: { kind: 'delete' as const, routineId: r.routine.id, version: r.routine.version } };
        navigation.navigate('WorkoutEditor', { routineId: r.routine.id, from, selectName: true, copyToast });
      } else if (action === LIBRARY_COPY_UI.addToRotation || action === LIBRARY_COPY_UI.removeFromRotation) {
        const on = action === LIBRARY_COPY_UI.addToRotation;
        const before = await services.routines.editor({ routineId: row.routineId, gymId: null });
        const placeAtUtc = before?.routine?.rotationAtUtc ?? before?.routine?.createdAtUtc ?? null;
        const r = await services.routines.setRotation({ routineId: row.routineId, on, expectedVersion: row.version, opId: newUuid() });
        if (!r.ok) {
          setToast({ text: r.message });
          reload();
          return;
        }
        changed();
        const done = r.routine;
        setToast({
          text: on ? LIBRARY_TOASTS.added(row.name) : LIBRARY_TOASTS.removed(row.name),
          action: LIBRARY_COPY_UI.undo,
          onAction: () => {
            setToast(null);
            void services.routines.setRotation({ routineId: done.id, on: !on, expectedVersion: done.version, opId: newUuid(), placeAtUtc: on ? null : placeAtUtc }).then((u) => {
              changed();
              if (!u.ok) setToast({ text: u.message });
            });
          },
        });
      } else if (action === LIBRARY_COPY_UI.delete) {
        const c = deleteConfirm(row.name);
        Alert.alert(c.title, c.message, [
          { text: LIBRARY_COPY_UI.cancel, style: 'cancel' },
          {
            text: c.confirm,
            style: 'destructive',
            onPress: () => {
              void services.routines.remove({ routineId: row.routineId, expectedVersion: row.version, opId: newUuid() }).then((r) => {
                if (!r.ok) {
                  setToast({ text: r.message });
                  reload();
                  return;
                }
                changed();
                const gone = r.routine;
                setToast({
                  text: LIBRARY_TOASTS.deleted(row.name),
                  action: LIBRARY_COPY_UI.undo,
                  onAction: () => {
                    setToast(null);
                    void services.routines.restore({ routineId: gone.id, expectedVersion: gone.version, opId: newUuid() }).then((u) => {
                      changed();
                      if (!u.ok) setToast({ text: u.message });
                    });
                  },
                });
              });
            },
          },
        ]);
      }
    } finally {
      busy.current = false;
    }
  }

  function openMenu(row: LibraryRow) {
    const options = [...rowMenu(row), LIBRARY_COPY_UI.cancel];
    ActionSheetIOS.showActionSheetWithOptions({ title: row.name, options, cancelButtonIndex: options.length - 1, destructiveButtonIndex: options.indexOf(LIBRARY_COPY_UI.delete) }, (i) => {
      const picked = options[i];
      if (picked !== undefined && picked !== LIBRARY_COPY_UI.cancel) void act(row, picked);
    });
  }

  function pickSort() {
    const options = [LIBRARY_COPY_UI.recent, LIBRARY_COPY_UI.az, LIBRARY_COPY_UI.cancel];
    ActionSheetIOS.showActionSheetWithOptions({ options, cancelButtonIndex: 2 }, (i) => {
      if (i === 0) setSort('recent');
      if (i === 1) setSort('az');
    });
  }

  const body = (() => {
    if (data.state === 'loading') {
      return placeholder ? (
        <View accessibilityElementsHidden style={{ gap: theme.space['3'] }}>
          {[0, 1, 2].map((i) => (
            <View key={String(i)} style={{ height: 64, borderRadius: theme.radius.sm, backgroundColor: theme.colors['bg.surface'] }} />
          ))}
        </View>
      ) : null;
    }
    if (data.state === 'error' || data.value.library === null) {
      return (
        <StatusLine
          icon="exclamationmark.triangle"
          tone="warning"
          text={LIBRARY_COPY_UI.loadFailed}
          action={
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: theme.space['4'] }}>
              <TextButton label={LIBRARY_COPY_UI.tryAgain} onPress={reload} />
              <TextButton
                label={LIBRARY_COPY_UI.restore}
                tone="secondary"
                onPress={() => {
                  navigation.dispatch(popToTabs({ screen: 'Profile', params: { screen: 'Restore', params: { mode: 'restore' }, initial: false } }));
                }}
              />
            </View>
          }
        />
      );
    }
    const { active } = data.value.library;
    const plan = data.value.plan;
    const view = plan === null ? data.value.library.view : withoutRoutines(data.value.library.view, new Set(plan.days.map((d) => d.routineId)));
    return (
      <View style={{ gap: theme.space['5'] }}>
        {plan !== null ? <YourPlanBlock plan={plan} onToast={setToast} /> : null}
        {data.value.planFailed ? <StatusLine icon="exclamationmark.triangle" tone="warning" text={PLAN_COPY.loadFailed} action={<TextButton label="Try again" onPress={reload} />} /> : null}
        {active ? (
          <Banner
            severity="info"
            text={LIBRARY_COPY_UI.inProgress(active.name)}
            action={
              <TextButton
                label={LIBRARY_COPY_UI.resume}
                onPress={() => {
                  navigation.navigate('Workout');
                }}
              />
            }
          />
        ) : null}
        {view.state === 'empty' && plan === null ? (
          <View style={{ gap: theme.space['2'], alignItems: 'flex-start' }}>
            <AppText variant="body">{LIBRARY_COPY_UI.empty}</AppText>
            <TextButton
              label={LIBRARY_COPY_UI.newWorkout}
              onPress={() => {
                navigation.navigate('WorkoutEditor', { routineId: null, from });
              }}
            />
          </View>
        ) : null}
        {view.rotation.length > 0 ? (
          <Section title={LIBRARY_COPY_UI.rotation}>
            {view.rotation.map((r, i) => (
              <WorkoutRow key={r.routineId} row={r} first={i === 0} onPress={() => { openRow(r); }} onMenu={() => { openMenu(r); }} onAction={(a) => void act(r, a)} />
            ))}
          </Section>
        ) : null}
        {view.all.length > 0 ? (
          <Section title={plan !== null ? PLAN_OVERVIEW_COPY.otherWorkouts : LIBRARY_COPY_UI.all} action={<TextButton label={sort === 'recent' ? LIBRARY_COPY_UI.recent : LIBRARY_COPY_UI.az} icon="chevron.down" tone="secondary" accessibilityLabel={`Sort, ${sort === 'recent' ? 'recent' : 'A to Z'}`} onPress={pickSort} />}>
            {view.all.map((r, i) => (
              <WorkoutRow key={r.routineId} row={r} first={i === 0} onPress={() => { openRow(r); }} onMenu={() => { openMenu(r); }} onAction={(a) => void act(r, a)} />
            ))}
          </Section>
        ) : null}
        {view.history.length > 0 ? (
          <Section title={LIBRARY_COPY_UI.history}>
            {view.history.map((h, i) => (
              <HistoryRow
                key={h.key}
                row={h}
                first={i === 0}
                onPress={
                  h.startable
                    ? () => {
                        navigation.navigate('WorkoutOverview', { target: { kind: 'session', sourceSessionId: h.sourceSessionId } });
                      }
                    : null
                }
                onSave={() => void save.open({ kind: 'session', sessionId: h.sourceSessionId }, h.label)}
              />
            ))}
            {view.historyTotal > 0 ? (
              <View style={{ alignSelf: 'flex-start' }}>
                <TextButton
                  label={LIBRARY_COPY_UI.showAll(view.historyTotal)}
                  tone="secondary"
                  onPress={() => {
                    setShowAll(true);
                  }}
                />
              </View>
            ) : null}
          </Section>
        ) : null}
        <View style={{ alignSelf: 'flex-start' }}>
          <TextButton
            label={LIBRARY_COPY_UI.emptyWorkout}
            tone="secondary"
            onPress={() => {
              // Today's own start (gym, alerts question, check-in gate); one Tabs, never a second (actions.ts).
              navigation.dispatch(popToTabs({ screen: 'Today', params: { startEmpty: newUuid() } }));
            }}
          />
        </View>
      </View>
    );
  })();

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors['bg.canvas'] }}>
      <ScrollView ref={scrollRef} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingHorizontal: theme.components.screenMargin, paddingTop: theme.space['4'], paddingBottom: theme.space['8'] + insets.bottom }}>
        {body}
      </ScrollView>
      {toast ? (
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: insets.bottom + theme.space['2'] }}>
          <Toast
            icon="info.circle"
            text={toast.text}
            {...(toast.action ? { action: toast.action } : {})}
            {...(toast.onAction ? { onAction: toast.onAction } : {})}
            {...(toast.why !== undefined
              ? {
                  secondary: PLAN_OVERVIEW_COPY.why,
                  onSecondary: () => {
                    const { why, ...rest } = toast;
                    setToast({ ...rest, text: why ?? rest.text });
                  },
                }
              : {})}
          />
        </View>
      ) : null}
      {save.sheet}
    </View>
  );
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 }} accessibilityRole="header">
        <Eyebrow>{title}</Eyebrow>
        {action ?? null}
      </View>
      <View style={{ marginTop: theme.space['1'] }}>{children}</View>
    </View>
  );
}

/**
 * `WorkoutRow` (§A2.1, ≥ 64pt): name with `UP NEXT` and a source tag (icon
 * and word), line 2 `6 exercises · ≈ 60 min · 6 days ago` or `⚠ 1 not
 * here`, and a 44pt `⋯`. Long-press and VoiceOver custom actions give the
 * same menu; nothing is swipe-only. At AX sizes everything wraps.
 */
function WorkoutRow({ row, first, onPress, onMenu, onAction }: { row: LibraryRow; first: boolean; onPress: () => void; onMenu: () => void; onAction: (action: string) => void }) {
  const theme = useTheme();
  const actions = rowMenu(row);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', borderTopWidth: first ? 0 : theme.dividerWidth, borderTopColor: theme.colors['border.divider'] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={row.accessibilityLabel}
        accessibilityActions={actions.map((a) => ({ name: a, label: a }))}
        onAccessibilityAction={(e) => {
          onAction(e.nativeEvent.actionName);
        }}
        onPress={onPress}
        onLongPress={onMenu}
        style={({ pressed }) => ({ flex: 1, minHeight: 64, justifyContent: 'center', paddingVertical: theme.space['2'], gap: theme.space['1'], opacity: pressed ? 0.7 : 1 })}
      >
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: theme.space['2'], rowGap: theme.space['1'] }}>
          <AppText variant="headline">{row.name}</AppText>
          {row.upNext ? <Tag icon="arrow.clockwise" text={LIBRARY_COPY_UI.upNext.toUpperCase()} /> : null}
          {row.sourceTag !== null ? <Tag icon={row.sourceTag === 'Coach' ? 'text.bubble' : 'square.and.arrow.down'} text={row.sourceTag} /> : null}
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: theme.space['1'] }}>
          <AppText variant="callout" color="text.secondary" numeric>
            {row.detail}
          </AppText>
          {row.issue !== null ? (
            <>
              <AppText variant="callout" color="text.secondary">
                ·
              </AppText>
              <Icon name="exclamationmark.triangle" color="status.warning" size={14} />
              <AppText variant="callout" color="status.warning" numeric>
                {row.issue}
              </AppText>
            </>
          ) : null}
        </View>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`${LIBRARY_COPY_UI.more}, ${row.name}`} onPress={onMenu} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="ellipsis" color="text.secondary" />
      </Pressable>
    </View>
  );
}

/** A `FROM HISTORY` row: no `⋯`; `Save` (SecondaryButton) moves under the name at AX sizes. */
function HistoryRow({ row, first, onPress, onSave }: { row: LibraryHistoryRow; first: boolean; onPress: (() => void) | null; onSave: () => void }) {
  const theme = useTheme();
  const ax = useWindowDimensions().fontScale >= 1.35;
  const text = (
    <View style={{ gap: theme.space['1'] }}>
      <AppText variant="headline">{row.label}</AppText>
      <AppText variant="callout" color="text.secondary" numeric>
        {row.detail}
      </AppText>
    </View>
  );
  return (
    <View style={{ flexDirection: ax ? 'column' : 'row', alignItems: ax ? 'stretch' : 'center', gap: theme.space['2'], minHeight: 64, paddingVertical: theme.space['2'], borderTopWidth: first ? 0 : theme.dividerWidth, borderTopColor: theme.colors['border.divider'] }}>
      {onPress ? (
        <Pressable accessibilityRole="button" accessibilityLabel={row.accessibilityLabel} onPress={onPress} style={({ pressed }) => ({ flex: ax ? 0 : 1, opacity: pressed ? 0.7 : 1 })}>
          {text}
        </Pressable>
      ) : (
        <View accessible accessibilityLabel={row.accessibilityLabel} style={{ flex: ax ? 0 : 1 }}>
          {text}
        </View>
      )}
      <View style={{ alignSelf: ax ? 'flex-start' : 'center' }}>
        <SecondaryButton label={LIBRARY_COPY_UI.save} onPress={onSave} accessibilityLabel={`${LIBRARY_COPY_UI.saveToWorkouts}, ${row.label}`} />
      </View>
    </View>
  );
}
