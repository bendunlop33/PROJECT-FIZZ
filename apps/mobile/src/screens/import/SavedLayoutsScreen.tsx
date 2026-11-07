import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Alert } from 'react-native';

import { ROLE_LABEL, SAVED_LAYOUTS_COPY, MARKER_LABEL, savedLayoutRowView } from '../../import/layout-views';
import type { ProfileStackParams } from '../../navigation/types';
import { useDataChanged, useScreenData, useServices } from '../../shell/context';
import { AppText, DangerTextButton, DomainLabel, Group, Row, Screen, SectionHeader, StatusLine, Toast } from '../../ui';

/**
 * Saved import layouts (data-import-export §9.2.9): Your data. A layout
 * imports files with the same columns offline. A layout whose imports were
 * all undone is `Not in use`. A damaged one (a hand-edited backup) is never
 * used and can only be deleted.
 */
export function SavedLayoutsScreen() {
  const services = useServices();
  const changed = useDataChanged();
  const navigation = useNavigation<NativeStackNavigationProp<ProfileStackParams>>();
  const [data] = useScreenData((s) => s.importLayouts.listLayouts());
  if (data.state !== 'ready') return <Screen>{null}</Screen>;
  const { rows, damaged } = data.value;
  return (
    <Screen>
      <DomainLabel domain="yourData" />
      {rows.length === 0 && damaged.length === 0 ? (
        <AppText variant="callout" color="text.secondary">
          {SAVED_LAYOUTS_COPY.empty}
        </AppText>
      ) : null}
      <Group>
        {rows.map((r) => {
          const v = savedLayoutRowView(r);
          return (
            <Row
              key={r.id}
              title={v.title}
              subtitle={v.subtitle}
              secondLine={v.state?.text ?? null}
              onPress={() => {
                navigation.navigate('SavedLayout', { id: r.id });
              }}
            />
          );
        })}
        {damaged.map((d) => (
          <Row
            key={d.id}
            title={d.name ?? '—'}
            subtitle={SAVED_LAYOUTS_COPY.damaged}
            icon="exclamationmark.triangle"
            iconColor="status.warning"
            onPress={() => {
              Alert.alert(SAVED_LAYOUTS_COPY.deleteAlert(d.name ?? '—').title, SAVED_LAYOUTS_COPY.deleteAlert(d.name ?? '—').message, [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete',
                  style: 'destructive',
                  onPress: () => {
                    void services.importLayouts.deleteDamagedLayout(d.id).then(changed);
                  },
                },
              ]);
            }}
          />
        ))}
      </Group>
    </Screen>
  );
}

/** One saved layout: its columns (read-only), Ben's answers, `Delete layout` with Undo. */
export function SavedLayoutScreen() {
  const services = useServices();
  const changed = useDataChanged();
  const navigation = useNavigation<NativeStackNavigationProp<ProfileStackParams>>();
  const { id } = useRoute<RouteProp<ProfileStackParams, 'SavedLayout'>>().params;
  const [deleted, setDeleted] = useState<{ version: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [data] = useScreenData((s) => s.importLayouts.getLayout(id));
  if (data.state !== 'ready') return <Screen>{null}</Screen>;
  const p = data.value;
  if (!p) return <Screen>{null}</Screen>;
  const roleOf = (index: number): string => {
    const mine = p.answers.roles[String(index)];
    if (mine) return ROLE_LABEL[mine];
    const s = p.spec;
    if (s.exercise.index === index) return ROLE_LABEL.exercise;
    if (s.date.column.index === index) return ROLE_LABEL.date;
    if (s.load?.column.index === index) return `${ROLE_LABEL.load}${p.answers.unit ? ` · ${p.answers.unit}` : ''}`;
    if (s.reps?.index === index) return ROLE_LABEL.reps;
    if (s.rpe?.index === index) return ROLE_LABEL.rpe;
    if (s.setType?.column.index === index) return ROLE_LABEL.set_type;
    if (s.workoutKey.some((c) => c.index === index)) return ROLE_LABEL.workout;
    if (s.notes.some((c) => c.index === index)) return ROLE_LABEL.notes;
    return ROLE_LABEL.not_imported;
  };

  return (
    <Screen
      floating={
        deleted ? (
          <Toast
            text={SAVED_LAYOUTS_COPY.deleted}
            action="Undo"
            onAction={() => {
              void services.importLayouts.undoDeleteLayout(id, deleted.version).then(() => {
                setDeleted(null);
                changed();
              });
            }}
            onDismiss={() => {
              setDeleted(null);
              navigation.goBack();
            }}
          />
        ) : null
      }
    >
      <Row title="Name" trailing={<AppText variant="callout">{p.name}</AppText>} />
      <AppText variant="callout" color="text.secondary">
        Coach layout · checked by you
      </AppText>
      {error ? <StatusLine icon="exclamationmark.triangle" tone="warning" text={error} /> : null}
      <SectionHeader title={`Columns (${String(p.fingerprint.header.length)})`} />
      <Group>
        {p.fingerprint.header.map((h, i) => (
          <Row key={`${String(i)}:${h}`} title={`“${h}”`} subtitle={roleOf(i)} />
        ))}
      </Group>
      <SectionHeader title="Your answers" />
      <Group>
        {p.answers.recordKind ? <Row title="What it is" subtitle={p.answers.recordKind === 'done' ? 'Workouts I did' : 'A plan or template'} /> : null}
        {Object.entries(p.answers.markers).map(([token, meaning]) => (
          <Row key={token} title={`“${token}”`} subtitle={MARKER_LABEL[meaning]} />
        ))}
      </Group>
      {p.deletedAt === null && !deleted ? (
        <DangerTextButton
          label={SAVED_LAYOUTS_COPY.delete}
          onPress={() => {
            const a = SAVED_LAYOUTS_COPY.deleteAlert(p.name);
            Alert.alert(a.title, a.message, [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delete',
                style: 'destructive',
                onPress: () => {
                  void services.importLayouts.deleteLayout(id, p.version).then((r) => {
                    if (r.ok) setDeleted({ version: r.profile.version });
                    else setError('The layout changed. Try again.');
                    changed();
                  });
                },
              },
            ]);
          }}
        />
      ) : null}
    </Screen>
  );
}
