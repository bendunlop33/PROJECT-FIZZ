import { useState } from 'react';
import { View } from 'react-native';

import type { PlaybookRuleRow } from '../../coach/playbook-view';
import { useDataChanged, useScreenData, useServices } from '../../shell/context';
import { useTheme } from '../../theme';
import { DomainLabel, Group, Row, Screen, SectionHeader, StatusLine, TextButton, Toast } from '../../ui';

/**
 * Profile → Coach → Playbook (coaching-playbook §2.1, §4.1; backlog §4.3):
 * general training rules from chat waiting for Ben's review, with Approve
 * and Reject (toast Undo), the ones he approved (sent to the coach,
 * `Remove` puts one back to review) and the ones he rejected (`Review
 * again`). Coaching knowledge, never memories (rule 10). Local; no AI.
 */
export function PlaybookScreen() {
  const services = useServices();
  const changed = useDataChanged();
  const theme = useTheme();
  const [toast, setToast] = useState<{ text: string; undo: { id: string; version: number } | null } | null>(null);
  const [data, reload] = useScreenData((s) => s.coach.playbookRules());
  if (data.state === 'loading') return <Screen>{null}</Screen>;
  if (data.state === 'error') {
    return (
      <Screen>
        <StatusLine icon="exclamationmark.triangle" tone="warning" text="Couldn’t read the playbook." detail={data.message} action={<TextButton label="Try again" onPress={reload} />} />
      </Screen>
    );
  }
  const list = data.value;

  async function decide(row: PlaybookRuleRow, decision: 'approve' | 'reject' | 'reopen', word: string) {
    const r = await services.coach.decidePlaybookRule(row.id, row.version, decision).catch(() => null);
    setToast(r?.status === 'written' ? { text: word, undo: decision === 'reopen' ? null : { id: row.id, version: r.candidate.version } } : { text: r?.status === 'stale' ? 'Out of date.' : 'Couldn’t save.', undo: null });
    changed();
    reload();
  }

  async function undo(u: { id: string; version: number }) {
    const r = await services.coach.decidePlaybookRule(u.id, u.version, 'reopen').catch(() => null);
    setToast(r?.status === 'written' ? null : { text: 'Couldn’t undo.', undo: null });
    changed();
    reload();
  }

  const empty = list.toReview.length === 0 && list.approved.length === 0 && list.rejected.length === 0;
  return (
    <Screen>
      {toast ? <Toast text={toast.text} {...(toast.undo !== null ? { action: 'Undo', onAction: () => void undo(toast.undo ?? { id: '', version: 0 }) } : {})} /> : null}
      <DomainLabel domain="coachingKnowledge" />
      {empty ? <StatusLine icon="checkmark.circle.fill" tone="done" text="No rules from chat" /> : null}
      {list.toReview.length > 0 ? (
        <>
          <SectionHeader title="To review" />
          <Group>
            {list.toReview.map((r) => (
              <Row
                key={r.id}
                icon="questionmark.circle"
                title={r.text}
                subtitle={`${r.label} · ${r.line}`}
                // Design pass 6.7: the buttons go under the rule, so its text uses the full width.
                below={
                  <View style={{ flexDirection: 'row', gap: theme.space['8'] }}>
                    <TextButton label="Reject" tone="secondary" onPress={() => void decide(r, 'reject', 'Rejected.')} />
                    <TextButton label="Approve" onPress={() => void decide(r, 'approve', 'Approved.')} />
                  </View>
                }
              />
            ))}
          </Group>
        </>
      ) : null}
      {list.approved.length > 0 ? (
        <>
          <SectionHeader title="Approved" />
          <Group>
            {list.approved.map((r) => (
              <Row key={r.id} icon="checkmark.circle.fill" iconColor="status.done" title={r.text} subtitle={`${r.label} · ${r.line}`} trailing={<TextButton label="Remove" tone="secondary" onPress={() => void decide(r, 'reopen', 'Back to review.')} />} />
            ))}
          </Group>
        </>
      ) : null}
      {list.rejected.length > 0 ? (
        <>
          <SectionHeader title="Rejected" />
          <Group>
            {list.rejected.map((r) => (
              <Row key={r.id} icon="xmark.circle" title={r.text} subtitle={`${r.label} · ${r.line}`} trailing={<TextButton label="Review again" tone="secondary" onPress={() => void decide(r, 'reopen', 'Back to review.')} />} />
            ))}
          </Group>
        </>
      ) : null}
    </Screen>
  );
}
