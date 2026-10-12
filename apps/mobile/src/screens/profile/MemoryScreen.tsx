import { useState } from 'react';
import { View } from 'react-native';

import { memoryScreenView, type MemoryRowView } from '../../coach/memory-view';
import { newUuid } from '../../device/runtime';
import { useDataChanged, useScreenData, useServices } from '../../shell/context';
import { useTheme } from '../../theme';
import { AppText, BottomCard, DangerTextButton, DomainLabel, Group, PrimaryButton, Row, Screen, SectionHeader, StatusLine, TextButton, TextField, Toast } from '../../ui';

/**
 * Profile → Coach → Memory (coach-memory §2.1–2.4, backlog §4.3): what the
 * coach is sent about Ben (`Saved`) and the coach's suggestions waiting for
 * his `Save` (never sent until saved, CM1). Edit, Forget (with Undo) and Add.
 * Your data; local, no AI. Minimal copy: words, source and date only.
 */
type Sheet = { kind: 'add' } | { kind: 'edit'; row: MemoryRowView } | null;

export function MemoryScreen() {
  const services = useServices();
  const changed = useDataChanged();
  const theme = useTheme();
  const [sheet, setSheet] = useState<Sheet>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ text: string; undoActionId: string | null } | null>(null);
  const [data, reload] = useScreenData((s) => s.coach.memories());
  if (data.state === 'loading') return <Screen>{null}</Screen>;
  if (data.state === 'error') {
    return (
      <Screen>
        <StatusLine icon="exclamationmark.triangle" tone="warning" text="Couldn’t read memory." detail={data.message} action={<TextButton label="Try again" onPress={reload} />} />
      </Screen>
    );
  }
  const view = memoryScreenView(data.value, services.now().tz);
  const done = (t: { text: string; undoActionId: string | null } | null) => {
    setToast(t);
    setSheet(null);
    changed();
    reload();
  };

  async function decide(row: MemoryRowView, decision: 'save' | 'not_now') {
    const r = await services.coach.decideMemory(row.id, row.version, decision).catch(() => null);
    done(r === null || r.status === 'missing' ? { text: 'Couldn’t save.', undoActionId: null } : r.status === 'duplicate' ? { text: 'Already saved.', undoActionId: null } : r.status === 'stale' ? { text: 'Out of date.', undoActionId: null } : null);
  }

  /** `Playbook` on a waiting row whose words could be a rule (CM9 split, same as the chat card). */
  async function toPlaybook(row: MemoryRowView) {
    const r = await services.coach.memoryToPlaybook(row.id, row.version, newUuid()).catch(() => null);
    done(r === null || (!r.ok && r.reason === 'missing') ? { text: 'Couldn’t save.', undoActionId: null } : !r.ok ? { text: 'Out of date.', undoActionId: null } : r.rejectedBefore ? { text: 'Rejected before.', undoActionId: null } : { text: 'Playbook, to review.', undoActionId: null });
  }

  async function submit() {
    if (sheet === null) return;
    setBusy(true);
    if (sheet.kind === 'add') {
      const r = await services.coach.addMemory(text, newUuid()).catch(() => ({ ok: false as const }));
      setBusy(false);
      done(r.ok ? { text: r.duplicate ? 'Already saved.' : 'Saved.', undoActionId: r.duplicate ? null : r.record.actionId } : { text: 'Couldn’t save.', undoActionId: null });
      return;
    }
    const r = await services.coach.editMemory(sheet.row.id, sheet.row.version, text).catch(() => null);
    setBusy(false);
    done(r === null || r.status === 'missing' || r.status === 'invalid' ? { text: 'Couldn’t save.', undoActionId: null } : r.status === 'duplicate' ? { text: 'Already saved.', undoActionId: null } : r.status === 'stale' ? { text: 'Out of date.', undoActionId: null } : null);
  }

  async function forget(row: MemoryRowView) {
    const r = await services.coach.forgetMemory(row.id, row.version, newUuid()).catch(() => null);
    done(r?.ok === true ? { text: 'Forgotten.', undoActionId: r.record.actionId } : { text: r?.ok === false && r.stale ? 'Out of date.' : 'Couldn’t forget.', undoActionId: null });
  }

  async function undo(actionId: string) {
    const r = await services.coach.undo(actionId, `undo:${actionId}`).catch(() => null);
    done(r !== null && (r.result.status === 'written' || r.result.status === 'replayed') ? null : { text: 'Couldn’t undo.', undoActionId: null });
  }

  const valid = text.trim().length > 0 && text.trim().length <= 200;
  return (
    <Screen>
      {toast ? <Toast text={toast.text} {...(toast.undoActionId !== null ? { action: 'Undo', onAction: () => void undo(toast.undoActionId ?? '') } : {})} /> : null}
      <DomainLabel domain="yourData" />
      {view.waiting.length > 0 ? (
        <>
          <SectionHeader title="Waiting for you" />
          <Group>
            {view.waiting.map((m) => (
              <Row
                key={m.id}
                icon="questionmark.circle"
                title={m.text}
                subtitle={m.line}
                trailing={
                  <View style={{ flexDirection: 'row', gap: theme.space['3'] }}>
                    <TextButton label="Not now" tone="secondary" onPress={() => void decide(m, 'not_now')} />
                    {m.split ? (
                      <>
                        <TextButton label="Memory" accessibilityLabel="Save as a memory about me" onPress={() => void decide(m, 'save')} />
                        <TextButton label="Playbook" accessibilityLabel="Add to playbook" onPress={() => void toPlaybook(m)} />
                      </>
                    ) : (
                      <TextButton label="Save" onPress={() => void decide(m, 'save')} />
                    )}
                  </View>
                }
              />
            ))}
          </Group>
        </>
      ) : null}
      <SectionHeader title="Saved" />
      <Group>
        {view.saved.map((m) => (
          <Row
            key={m.id}
            icon="checkmark.circle"
            iconColor="status.done"
            title={m.text}
            subtitle={m.line}
            onPress={() => {
              setText(m.text);
              setSheet({ kind: 'edit', row: m });
            }}
          />
        ))}
        <Row
          title="Add"
          icon="plus"
          onPress={() => {
            setText('');
            setSheet({ kind: 'add' });
          }}
        />
      </Group>
      <BottomCard
        visible={sheet !== null}
        onClose={() => {
          setSheet(null);
        }}
      >
        <AppText variant="title2" accessibilityRole="header">
          {sheet?.kind === 'edit' ? 'Edit memory' : 'New memory'}
        </AppText>
        <TextField accessibilityLabel="Memory" value={text} onChangeText={setText} autoFocus multiline maxLength={200} />
        {sheet?.kind === 'edit' ? <DangerTextButton label="Forget" onPress={() => void forget(sheet.row)} /> : null}
        <PrimaryButton label="Save" busy={busy} disabled={!valid} onPress={() => void submit()} />
      </BottomCard>
    </Screen>
  );
}
