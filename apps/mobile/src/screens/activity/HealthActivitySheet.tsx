import { useEffect, useRef, useState } from 'react';

import { activityDetail, activityTitle } from '@fizz/domain';
import type { Activity } from '@fizz/schemas';

import { HEALTH_COPY, healthActivityFacts, healthSheetAction, type HealthActivityDetail } from '../../health/health-view';
import type { HealthLinkUndo } from '../../activity/activity-toast';
import { newUuid } from '../../device/runtime';
import { useServices } from '../../shell/context';
import { AppText, BottomCard, Group, PrimaryButton, Row, StatusLine, TextButton } from '../../ui';

/**
 * (Ben, 27 Oct; apple-health.md §2.2) A workout read from Apple Health: read-only (fix it in Garmin or Health), its
 * facts and source, then (Ben, 31 Oct: "make it easier to pair … from when you click on the activity") one action at
 * the top, that day only (never across days; `healthSheetAction`):
 * - one workout that day: `Pair with Push A · 18:04–18:50`, one tap, Undo in the toast;
 * - the day's workout already paired: `Same workout as Push A` (joins that link);
 * - several: a short list, each with `Pair` (or `Same workout`);
 * - paired: `Paired with Push A`, with `Unpair`;
 * - no workout that day: nothing.
 */
export function HealthActivitySheet({ visible, activity, onClose, onLinked }: { visible: boolean; activity: Activity; onClose: () => void; onLinked: (r: { text: string; undo: HealthLinkUndo }) => void }) {
  const services = useServices();
  const tz = services.now().tz;
  const [detail, setDetail] = useState<HealthActivityDetail | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const op = useRef(newUuid());

  useEffect(() => {
    if (!visible) return;
    op.current = newUuid();
    setMessage(null);
    setDetail(null);
    let alive = true;
    void services.health.activity(activity.id).then((d) => {
      if (alive) setDetail(d);
    });
    return () => {
      alive = false;
    };
  }, [visible, activity.id, services]);

  const p = activity.health;
  if (p === undefined) return null;
  const facts = healthActivityFacts(p, activityDetail(activity.fields), detail?.showHeartRate === true, tz);
  const action = detail === null ? ({ kind: 'none' } as const) : healthSheetAction(detail);
  const uuid = activity.id;

  /** One write, then the caller's toast with its Undo (rule 5: Undo against the version it wrote). */
  async function run(write: () => Promise<{ ok: true; healthUuid: string; version: number } | { ok: false; message: string }>, text: string, undo: (version: number) => HealthLinkUndo) {
    if (busy) return;
    setBusy(true);
    const r = await write();
    setBusy(false);
    op.current = newUuid();
    if (!r.ok) {
      setMessage(r.message);
      return;
    }
    onLinked({ text, undo: undo(r.version) });
  }

  const pair = (sessionId: string) =>
    run(
      () => services.health.link({ healthUuid: uuid, sessionId, opId: op.current }),
      HEALTH_COPY.paired,
      (version) => () => services.health.unlink({ healthUuid: uuid, expectedVersion: version, opId: newUuid() }),
    );
  const same = (linkUuid: string, linkVersion: number) =>
    run(
      () => services.health.sameWorkout({ healthUuid: uuid, linkUuid, expectedVersion: linkVersion, opId: op.current }),
      HEALTH_COPY.sameWorkout,
      (version) => () => services.health.notSameWorkout({ healthUuid: uuid, linkUuid, expectedVersion: version, opId: newUuid() }),
    );
  const unpair = (sessionId: string, linkVersion: number) =>
    run(
      () => services.health.unlink({ healthUuid: uuid, expectedVersion: linkVersion, opId: op.current }),
      HEALTH_COPY.unpaired,
      () => () => services.health.link({ healthUuid: uuid, sessionId, opId: newUuid() }),
    );

  return (
    <BottomCard visible={visible} onClose={onClose} footer={message !== null ? <StatusLine icon="exclamationmark.triangle" tone="warning" text={message} /> : null}>
      <AppText variant="title2">{activityTitle(activity)}</AppText>
      <AppText variant="callout" color="text.secondary" numeric>
        {facts.when}
      </AppText>
      {facts.facts !== '' ? (
        <AppText variant="body" numeric>
          {facts.facts}
        </AppText>
      ) : null}
      <AppText variant="callout" color="text.secondary">
        {facts.source}
      </AppText>
      {action.kind === 'pair' ? <PrimaryButton label={action.label} busy={busy} onPress={() => void pair(action.sessionId)} /> : null}
      {action.kind === 'same' ? <PrimaryButton label={action.label} busy={busy} onPress={() => void same(action.linkUuid, action.linkVersion)} /> : null}
      {action.kind === 'choose' ? (
        <Group>
          {action.rows.map((r) => (
            <Row
              key={`${r.kind}:${r.sessionId}`}
              title={r.label}
              trailing={<TextButton label={r.button} accessibilityLabel={`${r.button}, ${r.label}`} disabled={busy} onPress={() => void (r.kind === 'pair' ? pair(r.sessionId) : same(r.linkUuid, r.linkVersion))} />}
            />
          ))}
        </Group>
      ) : null}
      {action.kind === 'paired' ? (
        <Group>
          <Row title={action.label} trailing={<TextButton label={HEALTH_COPY.unpair} tone="secondary" disabled={busy} onPress={() => void unpair(action.sessionId, action.linkVersion)} />} />
        </Group>
      ) : null}
    </BottomCard>
  );
}
