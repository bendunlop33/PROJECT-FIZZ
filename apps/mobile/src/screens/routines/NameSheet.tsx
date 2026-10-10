import { useEffect, useState } from 'react';
import { View } from 'react-native';

import type { RoutineNameCheck } from '@fizz/domain';

import { useTheme } from '../../theme';
import { AppText, BottomCard, PrimaryButton, StatusLine, TextField } from '../../ui';

/**
 * The name sheet (premium-feel §2.6): `Save as routine`, `Rename routine`
 * and `Rename workout`. The keyboard opens with the name selected; the
 * button stays above it and Return also saves. An empty or over-long name
 * disables the button and says why; a duplicate routine name is a note,
 * never a block. A failed write keeps the sheet open with a warning.
 */
export interface NameSheetProps {
  visible: boolean;
  title: string;
  buttonLabel: string;
  initialName: string;
  /** `3 exercises · 9 sets. Targets start from what you did today.` */
  detail?: string | null;
  check: (name: string) => Promise<RoutineNameCheck>;
  /** Null when saved; otherwise the message to show (the sheet stays open). */
  onSubmit: (name: string) => Promise<string | null>;
  onClose: () => void;
  onDismissed?: () => void;
}

export function NameSheet({ visible, title, buttonLabel, initialName, detail = null, check, onSubmit, onClose, onDismissed }: NameSheetProps) {
  const theme = useTheme();
  const [name, setName] = useState(initialName);
  const [result, setResult] = useState<RoutineNameCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setName(initialName);
    setError(null);
    setBusy(false);
  }, [visible, initialName]);

  useEffect(() => {
    let live = true;
    void check(name).then((r) => {
      if (live) setResult(r);
    });
    return () => {
      live = false;
    };
  }, [name, check]);

  const valid = result?.ok === true;
  async function submit() {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    const message = await onSubmit(name.trim()).catch((e: unknown) => (e instanceof Error ? e.message : 'Couldn’t save. Try again.'));
    setBusy(false);
    if (message !== null) setError(message);
  }

  return (
    <BottomCard visible={visible} onClose={onClose} {...(onDismissed ? { onDismissed } : {})}>
      <AppText variant="title2" accessibilityRole="header">
        {title}
      </AppText>
      <View style={{ gap: theme.space['2'] }}>
        <AppText variant="label" color="text.secondary">
          Name
        </AppText>
        <TextField
          accessibilityLabel="Name"
          value={name}
          onChangeText={setName}
          autoFocus
          selectTextOnFocus
          returnKeyType="done"
          maxLength={160}
          onSubmitEditing={() => void submit()}
        />
        {result && !result.ok && name.length > 0 ? (
          <AppText variant="callout" color="status.warning">
            {result.message}
          </AppText>
        ) : result && !result.ok ? (
          <AppText variant="callout" color="text.secondary">
            {result.message}
          </AppText>
        ) : result?.ok && result.note !== null ? (
          <AppText variant="callout" color="text.secondary">
            {result.note}
          </AppText>
        ) : null}
      </View>
      {detail ? (
        <AppText variant="callout" color="text.secondary">
          {detail}
        </AppText>
      ) : null}
      {error ? <StatusLine icon="exclamationmark.triangle" tone="warning" text={error} /> : null}
      <PrimaryButton label={buttonLabel} busy={busy} disabled={!valid} onPress={() => void submit()} />
    </BottomCard>
  );
}
