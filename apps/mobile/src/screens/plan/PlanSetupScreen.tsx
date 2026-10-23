import { useNavigation } from '@react-navigation/native';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pressable, View, type DimensionValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { toMs, fmt, pbDaysReady, pbToggleDay, pbTapSport, pbTogglePriority, pbToggleSportDay, pbWarmUpText, pbWithSessions,  PB_EXTRA_LIFTS, PB_PREF_DAYS, type PbExercise, type PlanKit } from '@fizz/domain';
import type { PlanBuilderAnswers, PlanPrefAnswer, PlanTarget } from '@fizz/schemas';

import { newUuid } from '../../device/runtime';
import { formatShortDate } from '../../format/dates';
import { todayAfterPlanApplied } from '../../navigation/actions';
import {
  PB_ABS_OPTIONS,
  PB_COPY as C,
  PB_EFFORTS,
  PB_FOCUSES,
  PB_GROUP_LIST,
  PB_INFO,
  PB_LENGTHS,
  PB_SPORT_CHIPS,
  PB_WEEKDAYS,
  PB_WEEKS,
  balanceRows,
  checkRows,
  dayViews,
  goalsRowValue,
  liftFromLine,
  otherOf,
  prefQuestions,
  prefsRowValue,
  rotatesLine,
  splitBoxes,
  targetChoices,
  volumeRows,
  weekRowValue,
} from '../../plan-builder/plan-builder-view';
import type { PlanBuilderSession } from '../../services/plan-builder-service';
import { useDataChanged, useServices } from '../../shell/context';
import { useTheme } from '../../theme';
import { AppText, BottomCard, Card, Chip, Group, PrimaryButton, Row, Screen, SecondaryButton, StatusLine, TextButton, Toast } from '../../ui';

type Page = 'check' | 'goals' | 'week' | 'plan' | 'prefs';
type Sheet =
  | { kind: 'info'; title: string; lines: readonly (readonly [string, string])[] | string }
  | { kind: 'lift'; key: string; value: number; reps: number }
  | { kind: 'addLift' }
  | { kind: 'spec' }
  | { kind: 'abs' }
  | { kind: 'other'; qId: string }
  | { kind: 'exercise'; day: number; key: string }
  | null;
type Draft = PlanBuilderSession['draft'];

/**
 * The plan builder (plan-builder.md; D7, Ben 22–23 Oct): (Check your lifts when needed) → Gym goals → Your week →
 * Your plan, with `Build plan` on every page and the ✦ answers already selected. Your plan: day cards that open to an
 * inset panel, Sets per week, Abs, and the `Goals ›` / `Week ›` / `Any preferences ›` rows; `Apply plan` goes to Today
 * with `Plan applied · Undo`. Offline: every number comes from the engine through the service; nothing here computes
 * a load, a set count or a progression.
 */
export function PlanSetupScreen() {
  const theme = useTheme();
  const services = useServices();
  const changed = useDataChanged();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [session, setSession] = useState<PlanBuilderSession | null | 'error'>(null);
  const [answers, setAnswers] = useState<PlanBuilderAnswers | null>(null);
  const [page, setPage] = useState<Page>('goals');
  const [fromPlan, setFromPlan] = useState<PlanBuilderAnswers | null>(null);
  const [draft, setDraft] = useState<Draft>(null);
  const [openDay, setOpenDay] = useState(-1);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null);
  const [busy, setBusy] = useState(false);
  const [priYes, setPriYes] = useState<boolean | null>(null);
  const [lenOpen, setLenOpen] = useState(false);
  const buildOp = useRef(newUuid());
  const applyOp = useRef(newUuid());

  /** Reads Ben's records for the builder. `keep`: the answers on screen stay (a gym was just added). */
  const load = (keep: PlanBuilderAnswers | null = null): void => {
    void services.planBuilder
      .open()
      .then((s) => {
        if (s === null) {
          setSession('error');
          return;
        }
        setSession(s);
        setDraft(s.draft);
        if (keep !== null) {
          setAnswers(keep);
          return;
        }
        setAnswers(s.answers);
        setPage(s.draft !== null ? 'plan' : s.needsCheck ? 'check' : 'goals');
      })
      .catch(() => {
        setSession('error');
      });
  };
  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (toast === null) return;
    const t = setTimeout(() => { setToast(null); }, theme.timing.undoToast);
    return () => { clearTimeout(t); };
  }, [toast, theme.timing.undoToast]);

  const s = session !== null && session !== 'error' ? session : null;
  const plan = useMemo(() => (s === null || answers === null || page !== 'plan' ? null : s.build(answers)), [s, answers, page]);

  if (session === 'error') {
    return (
      <Screen>
        <StatusLine icon="exclamationmark.triangle" tone="warning" text={C.failed} action={<TextButton label="Try again" onPress={() => { load(); }} />} />
        <TextButton label={C.close} onPress={() => { navigation.goBack(); }} />
      </Screen>
    );
  }
  if (s === null || answers === null) return <Screen>{null}</Screen>;

  const set = (next: PlanBuilderAnswers): void => { setAnswers(next); };
  const flow: Page[] = [...(s.needsCheck ? (['check'] as const) : []), 'goals', 'week'];
  const kitOf = (k: string): PlanKit | null => {
    const kit = s.kitOf(k);
    return kit === null || kit === 'bodyweight' ? null : kit;
  };
  const perHand = (k: string): boolean => kitOf(k)?.convention === 'per_hand';

  /** Build plan (any page) or Done (a page opened from Your plan): write the plan, then Your plan. */
  async function build(next: PlanBuilderAnswers, undoText: string | null, before: PlanBuilderAnswers | null = fromPlan): Promise<void> {
    if (s === null) return;
    if (!pbDaysReady(next)) {
      setToast({ text: C.pickDays(next.sessions) });
      return;
    }
    const ready = next.schedule === 'any' && next.days.length !== next.sessions ? { ...next, days: [...(PB_PREF_DAYS[next.sessions] ?? [])] } : next;
    setBusy(true);
    const r = await services.planBuilder.save(s, ready, draft, buildOp.current);
    setBusy(false);
    if (!r.ok) {
      setToast({ text: r.reason === 'empty' ? C.empty : r.reason === 'stale' ? C.stale : C.failed });
      if (r.reason === 'stale') load();
      return;
    }
    buildOp.current = newUuid();
    setAnswers(ready);
    setDraft({ planId: r.planId, version: r.version, versionN: r.versionN });
    setFromPlan(null);
    setOpenDay(-1);
    setPage('plan');
    changed();
    if (undoText !== null && before !== null && JSON.stringify(before) !== JSON.stringify(ready)) {
      setToast({ text: undoText, undo: () => { setToast(null); void rebuildTo(before, { planId: r.planId, version: r.version, versionN: r.versionN }); } });
    }
  }

  /** Undo of a change on Your plan: the answers before it, as a new version (rule 5). */
  async function rebuildTo(prev: PlanBuilderAnswers, at: NonNullable<Draft>): Promise<void> {
    if (s === null) return;
    const r = await services.planBuilder.save(s, prev, at, newUuid());
    if (!r.ok) {
      setToast({ text: r.reason === 'stale' ? C.stale : C.failed });
      return;
    }
    setAnswers(prev);
    setDraft({ planId: r.planId, version: r.version, versionN: r.versionN });
    changed();
  }

  async function apply(): Promise<void> {
    if (draft === null) return;
    setBusy(true);
    const r = await services.planBuilder.apply({ planId: draft.planId, versionN: draft.versionN, expectedVersion: draft.version, opId: applyOp.current });
    setBusy(false);
    if (!r.ok) {
      setToast({ text: r.message });
      if (r.reason === 'stale' || r.reason === 'closed') load();
      return;
    }
    changed();
    navigation.dispatch(todayAfterPlanApplied({ key: applyOp.current, planId: r.plan.id, version: r.plan.version }));
  }

  const openFromPlan = (p: Page): void => {
    setFromPlan(answers);
    setPage(p);
  };

  // ---------------------------------------------------------------------------
  // Top bar: one back control (D7)

  const stepBack = (): void => {
    if (fromPlan !== null) {
      setAnswers(fromPlan);
      setFromPlan(null);
      setPage('plan');
      return;
    }
    const at = page === 'plan' ? flow.length : flow.indexOf(page);
    const prev = flow[at - 1];
    if (prev !== undefined) setPage(prev);
  };
  const canBack = fromPlan !== null || (page === 'plan' ? draft === null || flow.length > 0 : flow.indexOf(page) > 0);
  const topBar = (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: insets.top, paddingHorizontal: theme.components.screenMargin, minHeight: 44 + insets.top, backgroundColor: theme.colors['bg.canvas'] }}>
      {canBack ? <TextButton label={fromPlan !== null ? C.yourPlan : C.back} onPress={stepBack} /> : <View />}
      {fromPlan === null ? <TextButton label={C.close} tone="secondary" onPress={() => { navigation.goBack(); }} /> : <View />}
    </View>
  );

  const footer =
    page === 'plan' ? (
      <PrimaryButton label={C.apply} busy={busy} disabled={draft === null} onPress={() => void apply()} />
    ) : fromPlan !== null ? (
      <PrimaryButton label={C.done} busy={busy} onPress={() => void build(answers, C.updated)} />
    ) : (
      <View style={{ flexDirection: 'row', gap: theme.space['2'] }}>
        {page !== 'week' ? (
          <View style={{ flex: 1 }}>
            <SecondaryButton label={page === 'goals' ? C.nextWeek : C.next} onPress={() => { setPage(flow[flow.indexOf(page) + 1] ?? 'week'); }} />
          </View>
        ) : null}
        <View style={{ flex: 1 }}>
          <PrimaryButton label={C.build} busy={busy} onPress={() => void build(answers, null)} />
        </View>
      </View>
    );

  const toastView = toast === null ? null : <Toast icon="info.circle" text={toast.text} {...(toast.undo ? { action: C.undo, onAction: toast.undo } : {})} />;

  // ---------------------------------------------------------------------------
  // Pages

  const title = (t: string): ReactNode => (
    <AppText variant="title1" accessibilityRole="header">
      {t}
    </AppText>
  );

  let body: ReactNode = null;
  // `Any priorities?`: Yes while a group or target is picked, or Ben tapped Yes (no ✦ pick yet: none is computed).
  const yes = priYes ?? (answers.priorities.length > 0 || answers.specific.length > 0);
  if (page === 'goals') {
    const expect = s.expect(answers);
    body = (
      <>
        {title(C.goals)}
        <Question label={C.length}>
          <Boxes items={PB_WEEKS.map((w) => ({ key: String(w), label: `${w === 6 ? '✦ ' : ''}${String(w)} weeks`, selected: answers.weeks === w }))} onPick={(k) => { set({ ...answers, weeks: Number(k) as PlanBuilderAnswers['weeks'] }); }} />
        </Question>
        <Question label={C.effort} onInfo={() => { setSheet({ kind: 'info', title: C.effort, lines: PB_INFO.effort }); }}>
          <Boxes items={PB_EFFORTS.map((e) => ({ key: e.key, label: `${e.key === 'standard' ? '✦ ' : ''}${e.label}`, selected: answers.effort === e.key }))} onPick={(k) => { set({ ...answers, effort: k as PlanBuilderAnswers['effort'] }); }} />
        </Question>
        <Question label={C.focus} onInfo={() => { setSheet({ kind: 'info', title: C.focus, lines: PB_INFO.focus }); }}>
          <Boxes items={PB_FOCUSES.map((f) => ({ key: f.key, label: `${f.key === 'balanced' ? '✦ ' : ''}${f.label}`, selected: answers.focus === f.key }))} onPick={(k) => { set({ ...answers, focus: k as PlanBuilderAnswers['focus'] }); }} />
        </Question>
        <Question label={C.priorities} onInfo={() => { setSheet({ kind: 'info', title: C.priorities, lines: PB_INFO.priority }); }}>
          <Boxes
            items={[
              { key: 'no', label: 'No', selected: !yes },
              { key: 'yes', label: 'Yes', selected: yes },
            ]}
            onPick={(k) => {
              setPriYes(k === 'yes');
              if (k === 'no') set({ ...answers, priorities: [], specific: [] });
            }}
          />
          {yes ? (
            <>
              <Boxes
                columns={3}
                items={PB_GROUP_LIST.map((g) => ({ key: g, label: g, selected: answers.priorities.includes(g) }))}
                onPick={(k) => {
                  const next = pbTogglePriority(answers, k as PlanBuilderAnswers['priorities'][number]);
                  if (next === null) setToast({ text: C.upTo2 });
                  else set(next);
                }}
              />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.space['2'] }}>
                <AppText variant="callout" color="text.secondary">
                  {C.specific}
                </AppText>
                {answers.specific.map((t) => (
                  <Chip key={t} size="min" label={`${t} ×`} selected onPress={() => { set({ ...answers, specific: answers.specific.filter((x) => x !== t) }); }} />
                ))}
                <Chip size="min" label={C.add} selected={false} onPress={() => { setSheet({ kind: 'spec' }); }} />
              </View>
            </>
          ) : null}
        </Question>
        {expect.rows.length > 0 ? (
          <Question label={C.expect(answers.weeks)}>
            <Card>
              <TableRow cells={[`kg × ${String(expect.reps)}`, 'Now', `Week ${String(answers.weeks)} (${C.est})`]} head />
              {expect.rows.map((r) => (
                <TableRow key={r.key} cells={[s.nameOf(r.key), r.now === null ? '—' : `${fmt(r.now)}${r.perHand ? ' each' : ''}`, r.end === null ? '—' : `${fmt(r.end)}${r.perHand ? ' each' : ''}`]} />
              ))}
            </Card>
          </Question>
        ) : null}
      </>
    );
  } else if (page === 'check') {
    const lifts = s.lifts(answers);
    const rows = checkRows(lifts, s.nameOf, perHand);
    const bal = balanceRows(lifts, s.nameOf);
    const left = PB_EXTRA_LIFTS.filter((k) => !answers.extraLifts.includes(k) && kitOf(k) !== null);
    body = (
      <>
        {title(C.check)}
        <Card>
          <TableRow cells={[C.lift, C.sixReps, C.oneRmEst]} head />
          {rows.map((r) => (
            <Pressable
              key={r.key}
              accessibilityRole="button"
              accessibilityLabel={`${r.name}, ${r.six}${r.est ? `, ${C.est}` : ''}`}
              onPress={() => {
                const l = lifts.find((x) => x.key === r.key);
                const from = l?.from;
                const value = from?.kind === 'similar' || from == null ? (l?.six ?? kitOf(r.key)?.loads[0] ?? 20) : from.value;
                const reps = from?.kind === 'similar' || from == null ? 6 : from.reps;
                setSheet({ kind: 'lift', key: r.key, value, reps });
              }}
            >
              <TableRow cells={[r.name, r.six, r.oneRm]} dim={r.est} dot={r.open} />
            </Pressable>
          ))}
          {left.length > 0 ? <TextButton label={C.addLift} onPress={() => { setSheet({ kind: 'addLift' }); }} /> : null}
        </Card>
        {bal.length > 0 ? (
          <Question label={C.balance} onInfo={() => { setSheet({ kind: 'info', title: C.balance, lines: PB_INFO.balance }); }}>
            <Card>
              {bal.map((b) => (
                <TableRow key={b.key} cells={[b.name, '', b.word]} warn={b.warn} />
              ))}
            </Card>
          </Question>
        ) : null}
      </>
    );
  } else if (page === 'week') {
    const lenOther = !(PB_LENGTHS as readonly number[]).includes(answers.minutes);
    body = (
      <>
        {title(C.week)}
        <Question label={C.sessions}>
          <Boxes items={[2, 3, 4, 5, 6, 7].map((n) => ({ key: String(n), label: String(n), selected: answers.sessions === n }))} onPick={(k) => { set(pbWithSessions(answers, Number(k))); }} />
        </Question>
        <Question label={C.minutes}>
          <Boxes
            columns={4}
            items={[...PB_LENGTHS.map((n) => ({ key: String(n), label: String(n), selected: answers.minutes === n })), { key: 'other', label: lenOther ? String(answers.minutes) : C.otherPick, selected: lenOther }]}
            onPick={(k) => {
              setLenOpen(k === 'other');
              if (k !== 'other') set({ ...answers, minutes: Number(k) });
            }}
          />
          {lenOther || lenOpen ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['3'] }}>
              <Chip size="min" label="−" accessibilityLabel="Shorter" selected={false} onPress={() => { set({ ...answers, minutes: Math.max(15, answers.minutes - 5) }); }} />
              <AppText variant="headline" numeric>{`${String(answers.minutes)} min`}</AppText>
              <Chip size="min" label="＋" accessibilityLabel="Longer" selected={false} onPress={() => { set({ ...answers, minutes: Math.min(180, answers.minutes + 5) }); }} />
            </View>
          ) : null}
        </Question>
        <Question label={C.split} note={rotatesLine(answers, s.profileSplit)}>
          <Boxes columns={2} items={splitBoxes(answers, s.profileSplit).map((b) => ({ key: b.key, label: b.label, selected: b.selected }))} onPick={(k) => { set({ ...answers, split: k as PlanBuilderAnswers['split'] }); }} />
        </Question>
        <Question label={C.days}>
          <Boxes
            columns={2}
            items={[
              { key: 'any', label: C.anyDays, selected: answers.schedule === 'any' },
              { key: 'set', label: C.setDays, selected: answers.schedule === 'set' },
            ]}
            onPick={(k) => { set({ ...answers, schedule: k as PlanBuilderAnswers['schedule'] }); }}
          />
          {answers.schedule === 'set' ? <DayRow on={(d) => answers.days.includes(d)} onTap={(d) => { set(pbToggleDay(answers, d)); }} /> : null}
        </Question>
        <Question label={C.other}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space['2'] }}>
            {PB_SPORT_CHIPS.map((sp) => {
              const o = answers.other.find((x) => x.sport === sp);
              return <Chip key={sp} size="min" label={`${o?.star === true ? '★ ' : ''}${sp}`} selected={o !== undefined} onPress={() => { set(pbTapSport(answers, sp)); }} />;
            })}
          </View>
          {answers.other.map((o) => (
            <View key={o.sport} style={{ gap: theme.space['1'] }}>
              <AppText variant="callout" color="text.secondary">
                {o.sport === 'Running' && o.longRunDay != null ? `Runs · long run ${PB_WEEKDAYS[o.longRunDay] ?? ''}` : o.sport}
              </AppText>
              <DayRow on={(d) => o.days.includes(d)} onTap={(d) => { set(pbToggleSportDay(answers, o.sport, d)); }} />
              {o.sport === 'Running' && o.days.length > 1 ? (
                <TextButton
                  label="Change long run"
                  tone="secondary"
                  onPress={() => {
                    const i = o.days.indexOf(o.longRunDay ?? -1);
                    const longRunDay = o.days[(i + 1) % o.days.length] ?? null;
                    set({ ...answers, other: answers.other.map((x) => (x.sport === 'Running' ? { ...x, longRunDay } : x)) });
                  }}
                />
              ) : null}
            </View>
          ))}
        </Question>
        <Question label={C.supersets} onInfo={() => { setSheet({ kind: 'info', title: C.supersets, lines: PB_INFO.supersets }); }}>
          <Boxes columns={2} items={[{ key: 'no', label: 'No', selected: !answers.supersets }, { key: 'yes', label: 'Yes', selected: answers.supersets }]} onPick={(k) => { set({ ...answers, supersets: k === 'yes' }); }} />
        </Question>
        <Question label={C.gym}>
          {s.gym === null ? (
            <StatusLine icon="info.circle" tone="info" text={C.noGym} action={<TextButton label={C.useTypicalGym} onPress={() => void services.setup.useTypicalGym().then(() => { changed(); load(answers); })} />} />
          ) : (
            <AppText variant="body">{s.gym.name}</AppText>
          )}
        </Question>
      </>
    );
  } else if (page === 'prefs') {
    body = (
      <>
        {title(C.prefs)}
        {prefQuestions(answers).map((g) => (
          <View key={g.group} style={{ gap: theme.space['3'] }}>
            <AppText variant="title2">{g.group}</AppText>
            {g.questions.map((q) => {
              const a = answers.prefs[q.id];
              const sug = s.prefSuggestion(q.id);
              const other = otherOf(answers, q.id);
              const pick = (v: PlanPrefAnswer): void => { set({ ...answers, prefs: { ...answers.prefs, [q.id]: v } }); };
              return (
                <Question key={q.id} label={q.label}>
                  <Boxes
                    columns={2}
                    items={[
                      { key: '0', label: `${sug === 0 && a === undefined ? '✦ ' : ''}${q.labels[0]}`, selected: a === 0 },
                      { key: '1', label: `${sug === 1 && a === undefined ? '✦ ' : ''}${q.labels[1]}`, selected: a === 1 },
                      { key: 'other', label: other === null ? C.otherPick : s.nameOf(other), selected: other !== null },
                      { key: 'either', label: C.noPreference, selected: a === 'either' },
                    ]}
                    onPick={(k) => {
                      if (k === 'other') setSheet({ kind: 'other', qId: q.id });
                      else pick(k === 'either' ? 'either' : k === '0' ? 0 : 1);
                    }}
                  />
                </Question>
              );
            })}
          </View>
        ))}
      </>
    );
  } else if (plan !== null) {
    const days = dayViews(plan, answers, s.nameOf);
    const vol = volumeRows(plan, answers);
    const maxSets = 24;
    body = (
      <>
        {title(C.plan)}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <AppText variant="callout" color="text.secondary">{`${String(answers.weeks)} weeks · ${PB_EFFORTS.find((e) => e.key === answers.effort)?.label ?? ''}`}</AppText>
          <AppText variant="callout" color="text.secondary">{`${String(answers.minutes)} min`}</AppText>
        </View>
        {plan.heldForPain.length > 0 ? <StatusLine icon="exclamationmark.triangle" tone="warning" text={`${C.heldForPain}: ${plan.heldForPain.map(s.nameOf).join(', ')}`} /> : null}
        <View style={{ gap: theme.space['2'] }}>
          {days.map((d) => {
            const open = openDay === d.index;
            return (
              <Card key={d.index} style={{ padding: 0, gap: 0 }}>
                <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => { setOpenDay(open ? -1 : d.index); }} style={{ padding: theme.space['4'], flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: theme.space['2'] }}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <AppText variant="headline">{d.title}</AppText>
                    <AppText variant="callout" color="text.secondary">{d.sub}</AppText>
                  </View>
                  <AppText variant="callout" color="text.secondary" numeric>{`${d.right} ${open ? '⌄' : '›'}`}</AppText>
                </Pressable>
                {open ? (
                  <View style={{ backgroundColor: theme.colors['bg.raised'], paddingHorizontal: theme.space['4'], paddingVertical: theme.space['2'], borderBottomLeftRadius: theme.radius.md, borderBottomRightRadius: theme.radius.md }}>
                    {d.rows.map((r) => (
                      <Pressable key={r.key} accessibilityRole="button" onPress={() => { setSheet({ kind: 'exercise', day: d.index, key: r.key }); }} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 40, gap: theme.space['2'], borderBottomWidth: theme.dividerWidth, borderBottomColor: theme.colors['border.divider'] }}>
                        {answers.supersets ? <AppText variant="label" color="text.tertiary" style={{ width: 20 }}>{r.pair ?? ''}</AppText> : null}
                        {r.main && r.kg === null ? (
                          <View style={{ flex: 1, paddingVertical: theme.space['1'] }}>
                            <AppText variant="callout" style={{ fontWeight: '600' }}>{r.name}</AppText>
                            <AppText variant="label" color="text.secondary" numeric>{`${r.scheme}${r.est ? ` ${C.est}` : ''}`}</AppText>
                          </View>
                        ) : (
                          <>
                            <AppText variant="callout" style={{ flex: 1, ...(r.main ? { fontWeight: '600' } : {}) }}>{r.name}</AppText>
                            <AppText variant="callout" color="text.secondary" numeric>{r.scheme}</AppText>
                            <AppText variant="callout" numeric style={{ minWidth: 64, textAlign: 'right' }}>{`${r.kg ?? ''}${r.est ? ` ${C.est}` : ''}`}</AppText>
                          </>
                        )}
                      </Pressable>
                    ))}
                  </View>
                ) : null}
              </Card>
            );
          })}
        </View>
        <Question label={C.setsPerWeek}>
          <Card>
            {vol.map((v) => (
              <View key={v.muscle} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }} accessibilityLabel={`${v.muscle} ${String(v.n)} sets, aim ${String(v.lo)} to ${String(v.hi)}`}>
                <AppText variant="callout" style={{ width: 96, ...(v.priority ? { fontWeight: '600' } : {}) }}>{v.muscle}</AppText>
                <View style={{ flex: 1, height: 8, borderRadius: 4, backgroundColor: theme.colors['bg.raised'] }}>
                  <View style={{ position: 'absolute', left: pct(v.lo / maxSets), width: pct((v.hi - v.lo) / maxSets), top: 0, bottom: 0, backgroundColor: theme.colors['accent.subtle'] }} />
                  <View style={{ position: 'absolute', left: 0, width: pct(Math.min(v.n, maxSets) / maxSets), top: 2, bottom: 2, borderRadius: 2, backgroundColor: theme.colors.accent }} />
                </View>
                <AppText variant="callout" numeric color={v.mark === '↓' ? 'status.warning' : 'text.primary'} style={{ width: 40, textAlign: 'right' }}>{`${String(v.n)}${v.mark === null ? '' : ` ${v.mark}`}`}</AppText>
              </View>
            ))}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}>
              <AppText variant="callout" color="text.secondary">{C.abs(plan.abs)}</AppText>
              <TextButton label={C.change} onPress={() => { setSheet({ kind: 'abs' }); }} />
            </View>
          </Card>
        </Question>
        <Group>
          <Row title={C.goalsRow} subtitle={goalsRowValue(answers)} onPress={() => { openFromPlan('goals'); }} />
          <Row title={C.weekRow} subtitle={weekRowValue(answers)} onPress={() => { openFromPlan('week'); }} />
          <Row title={C.prefsRow} subtitle={prefsRowValue(answers)} onPress={() => { openFromPlan('prefs'); }} />
        </Group>
      </>
    );
  }

  // ---------------------------------------------------------------------------
  // Sheets

  let sheetBody: ReactNode = null;
  let sheetFooter: ReactNode = null;
  if (sheet?.kind === 'info') {
    sheetBody = (
      <>
        <AppText variant="headline">{sheet.title}</AppText>
        {typeof sheet.lines === 'string' ? (
          <AppText variant="body" color="text.secondary">{sheet.lines}</AppText>
        ) : (
          sheet.lines.map(([k, v]) => (
            <View key={k} style={{ gap: 2 }}>
              <AppText variant="headline">{k}</AppText>
              <AppText variant="callout" color="text.secondary">{v}</AppText>
            </View>
          ))
        )}
      </>
    );
  } else if (sheet?.kind === 'lift') {
    const lift = s.lifts(answers).find((l) => l.key === sheet.key);
    const kit = kitOf(sheet.key);
    const step = (dir: 1 | -1): void => {
      if (kit === null) return;
      const loads = kit.loads;
      const next = dir > 0 ? loads.find((l) => l > sheet.value + 1e-9) : [...loads].reverse().find((l) => l < sheet.value - 1e-9);
      if (next !== undefined) setSheet({ ...sheet, value: next });
    };
    const stale = lift?.status === 'stale';
    sheetBody = (
      <>
        <AppText variant="headline">{s.nameOf(sheet.key)}</AppText>
        {lift === undefined ? null : <AppText variant="callout" color="text.secondary">{liftFromLine(lift, s.nameOf, (utc) => formatShortDate(toMs(utc), s.tz))}</AppText>}
        <Stepper label={C.weight} value={`${fmt(sheet.value)}${perHand(sheet.key) ? ' each' : ''}`} onDown={() => { step(-1); }} onUp={() => { step(1); }} />
        <Stepper label={C.reps} value={String(sheet.reps)} onDown={() => { setSheet({ ...sheet, reps: Math.max(1, sheet.reps - 1) }); }} onUp={() => { setSheet({ ...sheet, reps: Math.min(30, sheet.reps + 1) }); }} />
        {lift !== undefined && lift.status !== 'recent' && lift.sources.length > 1 && lift.from?.kind !== 'history' && lift.from?.kind !== 'entered' ? (
          <View style={{ gap: theme.space['1'] }}>
            <AppText variant="sectionLabel" color="text.secondary">{C.otherLift}</AppText>
            {lift.sources.map((src) => (
              <Chip key={src.index} size="min" label={`${s.nameOf(src.fromKey)} · ${C.est} ${src.six === null ? '—' : fmt(src.six)}`} selected={lift.from?.kind === 'similar' && lift.from.index === src.index} onPress={() => { set({ ...answers, lifts: { ...answers.lifts, [sheet.key]: { kind: 'similar', source: src.index } } }); setSheet(null); }} />
            ))}
          </View>
        ) : null}
      </>
    );
    sheetFooter = (
      <>
        {stale ? <SecondaryButton label={C.stillRight} onPress={() => { set({ ...answers, lifts: { ...answers.lifts, [sheet.key]: { kind: 'confirmed' } } }); setSheet(null); }} /> : null}
        <PrimaryButton
          label={C.save}
          onPress={() => {
            const unit = kit?.unit ?? 'kg';
            const f = lift?.from;
            const unchanged = f != null && (f.kind === 'history' || f.kind === 'entered') && f.value === sheet.value && f.reps === sheet.reps;
            set({ ...answers, lifts: { ...answers.lifts, [sheet.key]: unchanged ? (f.kind === 'history' && lift?.status === 'stale' ? { kind: 'confirmed' } : (answers.lifts[sheet.key] ?? { kind: 'confirmed' })) : { kind: 'entered', value: sheet.value, unit, reps: sheet.reps } } });
            setSheet(null);
          }}
        />
      </>
    );
  } else if (sheet?.kind === 'addLift') {
    sheetBody = (
      <>
        <AppText variant="headline">{C.addLift.replace('＋ ', '')}</AppText>
        <Group>
          {PB_EXTRA_LIFTS.filter((k) => !answers.extraLifts.includes(k) && kitOf(k) !== null).map((k) => (
            <Row key={k} title={s.nameOf(k)} onPress={() => { set({ ...answers, extraLifts: [...answers.extraLifts, k] }); setSheet(null); }} />
          ))}
        </Group>
      </>
    );
  } else if (sheet?.kind === 'spec') {
    const choices = targetChoices((k) => s.kitOf(k) !== null);
    sheetBody = (
      <>
        <AppText variant="headline">{C.specific}</AppText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space['2'] }}>
          {choices.map((t: PlanTarget) => (
            <Chip
              key={t}
              size="min"
              label={t}
              selected={answers.specific.includes(t)}
              onPress={() => {
                if (answers.specific.includes(t)) set({ ...answers, specific: answers.specific.filter((x) => x !== t) });
                else if (answers.specific.length >= 4) setToast({ text: C.upTo4 });
                else set({ ...answers, specific: [...answers.specific, t] });
              }}
            />
          ))}
        </View>
      </>
    );
  } else if (sheet?.kind === 'abs' && plan !== null) {
    sheetBody = (
      <>
        <AppText variant="headline">{C.abs(plan.abs)}</AppText>
        <Boxes
          items={PB_ABS_OPTIONS.map((n) => ({ key: String(n), label: String(n), selected: plan.abs === n }))}
          onPick={(k) => {
            setSheet(null);
            void build({ ...answers, abs: Number(k) as PlanBuilderAnswers['abs'] }, `Abs ${k} sets a week`, answers);
          }}
        />
      </>
    );
  } else if (sheet?.kind === 'other') {
    const q = prefQuestions(answers).flatMap((g) => g.questions).find((x) => x.id === sheet.qId);
    sheetBody =
      q === undefined ? null : (
        <>
          <AppText variant="headline">{`${q.label}: ${C.otherPick.toLowerCase()}`}</AppText>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space['2'] }}>
            {q.other
              .filter((k) => s.kitOf(k) !== null)
              .map((k) => (
                <Chip key={k} size="min" label={s.nameOf(k)} selected={otherOf(answers, q.id) === k} onPress={() => { set({ ...answers, prefs: { ...answers.prefs, [q.id]: { other: k } } }); setSheet(null); }} />
              ))}
          </View>
        </>
      );
  } else if (sheet?.kind === 'exercise' && plan !== null) {
    const e: PbExercise | undefined = plan.days.find((d) => d.index === sheet.day)?.exercises.find((x) => x.key === sheet.key);
    sheetBody =
      e === undefined ? null : (
        <>
          <AppText variant="headline">{s.nameOf(e.key)}</AppText>
          {e.main !== null && e.main.warmup.length > 0 ? <AppText variant="callout" color="text.secondary" numeric>{`${C.warmup}: ${pbWarmUpText(e.main.warmup, perHand(e.key))}`}</AppText> : null}
          <AppText variant="callout" color="text.secondary">
            {e.main?.start?.from?.kind === 'similar' ? `${C.est} · ${s.nameOf(e.main.start.from.fromKey)}` : e.why}
          </AppText>
        </>
      );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors['bg.canvas'] }}>
      {topBar}
      <Screen footer={footer} toast={toastView}>
        {body}
      </Screen>
      <BottomCard visible={sheet !== null} onClose={() => { setSheet(null); }} {...(sheetFooter === null ? {} : { footer: sheetFooter })}>
        {sheetBody}
      </BottomCard>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Parts

/** A share as a percentage width. */
const pct = (x: number): DimensionValue => `${String(Math.max(0, Math.min(1, x)) * 100)}%` as DimensionValue;

/** A question: its label (ⓘ when it has an explanation), its options, a divider under it (Ben, 22 Oct). */
function Question({ label, onInfo, note, children }: { label: string; onInfo?: () => void; note?: string | null; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.space['2'], paddingBottom: theme.space['3'], borderBottomWidth: theme.dividerWidth, borderBottomColor: theme.colors['border.divider'] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space['2'] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['1'] }}>
          <AppText variant="sectionLabel" color="text.secondary" accessibilityRole="header">
            {label}
          </AppText>
          {onInfo ? <TextButton label="ⓘ" accessibilityLabel={`About ${label}`} tone="secondary" onPress={onInfo} /> : null}
        </View>
        {note ? (
          <AppText variant="label" color="text.tertiary">
            {note}
          </AppText>
        ) : null}
      </View>
      {children}
    </View>
  );
}

/** One row (or grid) of equal answer boxes. */
function Boxes({ items, onPick, columns }: { items: readonly { key: string; label: string; selected: boolean }[]; onPick: (key: string) => void; columns?: number }) {
  const theme = useTheme();
  const per = columns ?? items.length;
  const rows: (typeof items)[] = [];
  for (let i = 0; i < items.length; i += per) rows.push(items.slice(i, i + per));
  return (
    <View style={{ gap: theme.space['2'] }}>
      {rows.map((r) => (
        <View key={r.map((x) => x.key).join('|')} style={{ flexDirection: 'row', gap: theme.space['2'] }}>
          {r.map((x) => (
            <Chip key={x.key} grow size="min" label={x.label} selected={x.selected} onPress={() => { onPick(x.key); }} />
          ))}
          {r.length < per ? Array.from({ length: per - r.length }, (_, i) => <View key={`pad${String(i)}`} style={{ flex: 1 }} />) : null}
        </View>
      ))}
    </View>
  );
}

function DayRow({ on, onTap }: { on: (d: number) => boolean; onTap: (d: number) => void }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: theme.space['1'] }}>
      {PB_WEEKDAYS.map((w, d) => (
        <Chip key={w} grow size="min" label={w} selected={on(d)} onPress={() => { onTap(d); }} />
      ))}
    </View>
  );
}

function TableRow({ cells, head = false, dim = false, dot = false, warn = false }: { cells: readonly string[]; head?: boolean; dim?: boolean; dot?: boolean; warn?: boolean }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: head ? 28 : 44, gap: theme.space['2'] }}>
      {cells.map((c, i) => (
        <View key={i} style={{ flex: i === 0 ? 2 : 1, flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: i === 0 ? 'flex-start' : 'center' }}>
          <AppText variant={head ? 'label' : 'callout'} numeric color={head ? 'text.tertiary' : warn && i === cells.length - 1 ? 'status.warning' : dim && i > 0 ? 'text.secondary' : 'text.primary'}>
            {c}
          </AppText>
          {dot && i === 0 ? <View accessibilityLabel="Check" style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: theme.colors['status.warning'] }} /> : null}
        </View>
      ))}
    </View>
  );
}

function Stepper({ label, value, onDown, onUp }: { label: string; value: string; onDown: () => void; onUp: () => void }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space['3'] }}>
      <AppText variant="body">{label}</AppText>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['3'] }}>
        <Chip size="min" label="−" accessibilityLabel={`Less ${label.toLowerCase()}`} selected={false} onPress={onDown} />
        <AppText variant="headline" numeric style={{ minWidth: 72, textAlign: 'center' }}>
          {value}
        </AppText>
        <Chip size="min" label="＋" accessibilityLabel={`More ${label.toLowerCase()}`} selected={false} onPress={onUp} />
      </View>
    </View>
  );
}
