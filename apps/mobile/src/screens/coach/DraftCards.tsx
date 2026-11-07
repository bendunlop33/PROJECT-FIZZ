import { useNavigation } from '@react-navigation/native';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import type { ActionRecord } from '@fizz/schemas';

import type { DraftEditCardState } from '../../coach/coach-service';
import { DRAFT_EDIT_COPY } from '../../coach/sheet-view';
import { newUuid } from '../../device/runtime';
import { useServices } from '../../shell/context';
import { useTheme } from '../../theme';
import { AppText, Icon, TextButton } from '../../ui';
import { CardActions, CoachCardFrame } from './CoachCardFrame';

/**
 * ADR 0039 (Ben, 29 Oct): a change to Your workout before Start, from any chat. The builder's own lines, `Skip` ·
 * `Apply` (rule 3: nothing changes until he applies it); after Apply, `Undo`. Apply is checked again against the
 * draft as it is then (`Out of date. Ask again.`) and written once (its op ID). Every value is from the record.
 */
export function DraftEditCard({ record, onChanged }: { record: ActionRecord; onChanged: () => void }) {
  const theme = useTheme();
  const services = useServices();
  const [state, setState] = useState<DraftEditCardState | { kind: 'skipped' } | { kind: 'undone' } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const busy = useRef(false);
  const undoOp = useRef(newUuid());

  useEffect(() => {
    const screen = { alive: true };
    void services.coach
      .draftEditCard(record.actionId)
      .catch((): DraftEditCardState => ({ kind: 'gone' }))
      .then((s) => {
        if (screen.alive) setState(s);
      });
    return () => {
      screen.alive = false;
    };
  }, [services, record.actionId]);

  if (record.detail.kind !== 'propose_workout_edit' || state === null || state.kind === 'gone') return null;
  const d = record.detail;

  async function run(write: () => Promise<void>) {
    if (busy.current) return;
    busy.current = true;
    try {
      await write();
      onChanged();
    } catch {
      setNotice('Couldn’t save. Try again.');
    } finally {
      busy.current = false;
    }
  }

  return (
    <CoachCardFrame>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}>
        <Icon name="list.bullet" color="text.secondary" size={18} />
        <AppText variant="label" color="text.secondary">
          {d.draftName === '' ? 'Your workout' : d.draftName}
        </AppText>
      </View>
      {d.proposal.lines.map((l) => (
        <AppText key={l} variant="callout">
          {l}
        </AppText>
      ))}
      {d.proposal.warnings.map((w) => (
        <AppText key={w} variant="callout" color="text.secondary">
          {w}
        </AppText>
      ))}
      {notice !== null ? (
        <AppText variant="callout" color="text.secondary">
          {notice}
        </AppText>
      ) : null}
      <CardActions>
        {state.kind === 'open' ? (
          <>
            <TextButton
              label={DRAFT_EDIT_COPY.skip}
              onPress={() => {
                setState({ kind: 'skipped' });
              }}
            />
            <TextButton
              label={DRAFT_EDIT_COPY.apply}
              onPress={() =>
                void run(async () => {
                  const r = await services.coach.applyDraftEdit(record.actionId);
                  if (r.ok) {
                    setNotice(null);
                    setState({ kind: 'applied' });
                  } else setNotice(r.line);
                })
              }
            />
          </>
        ) : null}
        {state.kind === 'applied' ? (
          <>
            <AppText variant="callout" color="text.secondary">
              {DRAFT_EDIT_COPY.applied}
            </AppText>
            <TextButton
              label={DRAFT_EDIT_COPY.undo}
              onPress={() =>
                void run(async () => {
                  const ok = await services.coach.undoDraftEdit(record.actionId, undoOp.current);
                  if (ok) setState({ kind: 'undone' });
                  else setNotice('Not undone.');
                })
              }
            />
          </>
        ) : null}
        {state.kind === 'skipped' || state.kind === 'undone' ? (
          <AppText variant="callout" color="text.secondary">
            {state.kind === 'skipped' ? DRAFT_EDIT_COPY.skipped : DRAFT_EDIT_COPY.undone}
          </AppText>
        ) : null}
      </CardActions>
    </CoachCardFrame>
  );
}

/** ADR 0039: today's Set up filled from Ben's words: what it says and `Open Set up` (Undo is on Set up). */
export function SetupFillCard({ record, onOpen }: { record: ActionRecord; onOpen: () => void }) {
  const theme = useTheme();
  if (record.detail.kind !== 'fill_setup') return null;
  return (
    <CoachCardFrame>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}>
        <Icon name="checkmark.circle.fill" color="text.secondary" size={18} />
        <AppText variant="callout">{`Set up: ${record.detail.toast}`}</AppText>
      </View>
      <CardActions>
        <TextButton label={DRAFT_EDIT_COPY.openSetup} onPress={onOpen} />
      </CardActions>
    </CoachCardFrame>
  );
}

/** Opens Set up from the sheet (the fill waits there). */
export function useOpenSetup(): () => void {
  const navigation = useNavigation();
  return () => {
    navigation.goBack();
    navigation.navigate('BuilderSetup', undefined);
  };
}
