import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { pastImportRow } from '../../import/views';
import type { ProfileStackParams } from '../../navigation/types';
import { useScreenData } from '../../shell/context';
import { AppText, Group, Row, Screen } from '../../ui';

/**
 * `Past imports` (data-import-export §2.1 region 6, §3.4): every import,
 * newest first, with its state (finished, paused, undone). Tapping one opens
 * its results, where a paused import continues and any import can be undone.
 */
export function PastImportsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<ProfileStackParams>>();
  const [data] = useScreenData((s) => s.imports.list());
  if (data.state !== 'ready') return <Screen>{null}</Screen>;
  if (data.value.length === 0) {
    return (
      <Screen>
        <AppText variant="body">No imports yet.</AppText>
      </Screen>
    );
  }
  return (
    <Screen>
      <Group>
        {data.value.map((p) => {
          const r = pastImportRow(p);
          return (
            <Row
              key={p.job.id}
              title={r.title}
              subtitle={r.subtitle}
              secondLine={r.line.text}
              icon={r.line.icon}
              iconColor={r.line.tone === 'done' ? 'status.done' : r.line.tone === 'warning' ? 'status.warning' : 'text.secondary'}
              onPress={() => {
                navigation.navigate('ImportResults', { jobId: p.job.id });
              }}
            />
          );
        })}
      </Group>
    </Screen>
  );
}
