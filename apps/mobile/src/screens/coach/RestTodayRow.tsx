import { useEffect, useRef, useState } from 'react';

import type { ActionRecord } from '@fizz/schemas';

import { REST_SETTINGS_COPY, type RestTodayState } from '../../services/rest-settings-service';
import { useServices } from '../../shell/context';
import { AppText, TextButton } from '../../ui';
import { CardActions } from './CoachCardFrame';

/**
 * (Ben, 2 Nov) Under the coach's rest-settings card while a workout is live: `Today too?` moves today's pending rests
 * that were on the old default to the new one (its own change), then `Today too: done` with its own `Undo`, as `Make
 * main lift` offers `Every week?`. Hidden when there is nothing to offer.
 */
export function RestTodayRow({ record, onChanged }: { record: ActionRecord; onChanged?: () => void }) {
  const services = useServices();
  const [state, setState] = useState<RestTodayState | 'loading'>('loading');
  const [notice, setNotice] = useState<string | null>(null);
  const busy = useRef(false);
  const undone = record.undoneBy !== null;

  useEffect(() => {
    const screen = { alive: true };
    void services.restSettings
      .today(record.actionId)
      .catch((): RestTodayState => null)
      .then((s) => {
        if (screen.alive) setState(s);
      });
    return () => {
      screen.alive = false;
    };
  }, [services, record.actionId, undone]);

  if (state === 'loading' || (state === null && notice === null)) return null;

  async function run(write: () => Promise<boolean>, failed: string) {
    if (busy.current) return;
    busy.current = true;
    try {
      const ok = await write();
      setNotice(ok ? null : failed);
      setState(await services.restSettings.today(record.actionId).catch((): RestTodayState => null));
      onChanged?.();
    } finally {
      busy.current = false;
    }
  }

  return (
    <CardActions>
      {notice !== null ? (
        <AppText variant="callout" color="text.secondary">
          {notice}
        </AppText>
      ) : null}
      {state === 'open' ? <TextButton label={REST_SETTINGS_COPY.todayToo} onPress={() => void run(() => services.restSettings.applyToday(record.actionId), REST_SETTINGS_COPY.stale)} /> : null}
      {state === 'done' ? (
        <>
          <AppText variant="callout" color="text.secondary">
            {REST_SETTINGS_COPY.todayDone}
          </AppText>
          <TextButton label={REST_SETTINGS_COPY.undo} onPress={() => void run(() => services.restSettings.undoToday(record.actionId), REST_SETTINGS_COPY.notUndone)} />
        </>
      ) : null}
    </CardActions>
  );
}
