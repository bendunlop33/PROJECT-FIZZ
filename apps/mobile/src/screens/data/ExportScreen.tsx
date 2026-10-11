import { useState } from 'react';
import { View } from 'react-native';

import type { ExportKind } from '../../backup/data-domain-service';
import { pickBackupFolder } from '../../device/files';
import { useScreenData, useServices } from '../../shell/context';
import { useTheme } from '../../theme';
import { ChoiceCard, InfoLine, PrimaryButton, Screen, SectionHeader, StatusLine } from '../../ui';

/**
 * `Export` (data-import-export §2.6, §3.5, §4.4): what to export, then the
 * system folder picker, as `Save a copy to Files` does. `My data` is the full
 * JSON of Your data; `Coaching knowledge only` has nothing about Ben (rule
 * 10). Success is claimed only after the file read back correctly. With
 * nothing in the chosen domain, Export is disabled (§3.5). CSV, FitNotes 2
 * CSV, ranges and the share sheet aren't built yet (ADR 0023).
 */
export function ExportScreen() {
  const theme = useTheme();
  const services = useServices();
  const [kind, setKind] = useState<ExportKind>('your_data');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [data] = useScreenData((s) => s.data.summary());
  const counts = data.state === 'ready' ? data.value.counts : null;
  const empty = counts !== null && (kind === 'your_data' ? counts.yourData.records : counts.coachingKnowledge.records) === 0;

  async function run() {
    if (busy || empty) return;
    setBusy(true);
    setResult(null);
    try {
      const picked = await pickBackupFolder();
      if (picked.kind === 'cancelled') return;
      if (picked.kind === 'failed') {
        setResult({ ok: false, text: `Couldn’t open the folder picker: ${picked.message}.` });
        return;
      }
      const r = await services.data.saveExportTo(picked.destination, kind);
      setResult(r.ok ? { ok: true, text: `Saved to Files · ${r.destinationLabel}` } : { ok: false, text: r.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen footer={<PrimaryButton label={busy ? 'Preparing…' : 'Export'} busy={busy} disabled={busy || empty} onPress={() => void run()} />}>
      <SectionHeader title="What to export" />
      <View style={{ gap: theme.space['2'] }}>
        <ChoiceCard title="My data" subtitle="Full data (JSON)" selected={kind === 'your_data'} onPress={() => { setKind('your_data'); }} />
        <ChoiceCard title="Coaching knowledge only" subtitle="Rules and the exercise list" selected={kind === 'coaching_knowledge'} onPress={() => { setKind('coaching_knowledge'); }} />
      </View>
      <InfoLine info="Exports can’t be restored into GymSmarter. Use Save a copy to Files for that." infoLabel="About exports" />
      {empty ? <StatusLine icon="info.circle" tone="info" text="Nothing to export" /> : null}
      {result ? <StatusLine icon={result.ok ? 'externaldrive.fill.badge.checkmark' : 'exclamationmark.triangle'} tone={result.ok ? 'done' : 'warning'} text={result.text} /> : null}
    </Screen>
  );
}
