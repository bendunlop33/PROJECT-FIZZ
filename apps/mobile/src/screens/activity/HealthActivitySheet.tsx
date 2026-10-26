import { useEffect, useRef, useState } from 'react';

import { activityDetail, activityTitle, type LinkableWorkout } from '@fizz/domain';
import type { Activity } from '@fizz/schemas';

import { HEALTH_COPY, healthActivityFacts, linkableWorkoutLine } from '../../health/health-view';
import { newUuid } from '../../device/runtime';
import { useServices } from '../../shell/context';
import { AppText, BottomCard, Group, Row, SectionHeader, StatusLine, TextButton } from '../../ui';

/**
 * (Ben, 27 Oct; apple-health.md §2.2) A workout read from Apple Health: read-only (fix it in Garmin or Health),
 * with its source, the one-tap `Link to this workout?` when a strength workout nearly matches, and `Link to a
 * workout` (the app's workouts a day either side). Values only.
 */
export function HealthActivitySheet({ visible, activity, onClose, onLinked }: { visible: boolean; activity: Activity; onClose: () => void; onLinked: () => void }) {
  const services = useServices();
  const tz = services.now().tz;
  const [detail, setDetail] = useState<{ suggestion: LinkableWorkout | null; nearby: LinkableWorkout[]; showHeartRate: boolean } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const op = useRef(newUuid());

  useEffect(() => {
    if (!visible) return;
    op.current = newUuid();
    setMessage(null);
    setPicking(false);
    let alive = true;
    void services.health.activity(activity.id).then((d) => {
      if (alive) setDetail(d === null ? null : { suggestion: d.suggestion, nearby: d.nearby, showHeartRate: d.showHeartRate });
    });
    return () => {
      alive = false;
    };
  }, [visible, activity.id, services]);

  const p = activity.health;
  if (p === undefined) return null;
  const facts = healthActivityFacts(p, activityDetail(activity.fields), detail?.showHeartRate === true, tz);

  async function link(sessionId: string) {
    const r = await services.health.link({ healthUuid: activity.id, sessionId, opId: op.current });
    if (!r.ok) {
      setMessage(r.message);
      return;
    }
    onLinked();
  }

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
      {detail?.suggestion != null ? (
        <Group>
          <Row
            title={HEALTH_COPY.linkQuestion}
            subtitle={linkableWorkoutLine(detail.suggestion)}
            trailing={<TextButton label={HEALTH_COPY.link} onPress={() => void link(detail.suggestion?.sessionId ?? '')} />}
          />
        </Group>
      ) : null}
      {detail !== null && detail.nearby.length > 0 ? (
        picking ? (
          <>
            <SectionHeader title={HEALTH_COPY.linkToWorkout} />
            <Group>
              {detail.nearby.map((w) => (
                <Row key={w.sessionId} title={linkableWorkoutLine(w)} trailing={<TextButton label={HEALTH_COPY.link} onPress={() => void link(w.sessionId)} />} />
              ))}
            </Group>
          </>
        ) : (
          <TextButton
            label={`${HEALTH_COPY.linkToWorkout} ›`}
            onPress={() => {
              setPicking(true);
            }}
          />
        )
      ) : null}
    </BottomCard>
  );
}
