import { useState } from 'react';
import { View } from 'react-native';

import { useDataChanged, useServices } from '../../shell/context';
import { pickBackupFolder } from '../../device/files';
import { useTheme } from '../../theme';
import { AppText, PrimaryButton, Row, StatusLine } from '../../ui';

/**
 * `Save a copy to Files` (data-import-export.md §2.2, §4.1): the system folder
 * picker, then a fresh backup written there and read back. Cancelling the
 * picker changes nothing and shows nothing. Success says `Copy saved to
 * Files` with where; it is only claimed after the file read back correctly.
 */
export function SaveCopyToFiles({ variant, label = 'Save a copy to Files', onSaved }: { variant: 'primary' | 'row'; label?: string; onSaved?: (where: string) => void }) {
  const theme = useTheme();
  const services = useServices();
  const changed = useDataChanged();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function save() {
    if (busy) return;
    setBusy(true);
    setResult(null);
    try {
      const picked = await pickBackupFolder();
      if (picked.kind === 'cancelled') return;
      if (picked.kind === 'failed') {
        setResult({ ok: false, text: `Couldn’t open the folder picker: ${picked.message}. Your data on this phone is fine.` });
        return;
      }
      const r = await services.backups.saveCopyTo(picked.destination);
      if (r.ok) {
        setResult({ ok: true, text: `Copy saved to Files · ${r.destinationLabel}` });
        onSaved?.(r.destinationLabel);
        changed();
      } else {
        setResult({ ok: false, text: r.message });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: theme.space['2'] }}>
      {variant === 'primary' ? (
        <>
          <AppText variant="callout" color="text.secondary">
            Backups are plain files with your training data and coaching knowledge. They never contain your coach sign-in or API keys.
          </AppText>
          <PrimaryButton label={busy ? 'Saving a copy…' : label} busy={busy} onPress={() => void save()} />
        </>
      ) : (
        <Row title={label} icon="externaldrive" onPress={() => void save()} disabled={busy} />
      )}
      {result ? (
        <StatusLine icon={result.ok ? 'externaldrive.fill.badge.checkmark' : 'exclamationmark.triangle'} tone={result.ok ? 'done' : 'warning'} text={result.text} />
      ) : null}
    </View>
  );
}
