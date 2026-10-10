import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { Alert } from 'react-native';

import { previewView, workoutRows, WORKOUT_PAGE, type QuestionKey } from '../../import/views';
import type { ProfileStackParams } from '../../navigation/types';
import { useScreenData, useServices } from '../../shell/context';
import { AppText, Card, Group, PrimaryButton, Row, Screen, SectionHeader, StatusLine, TextButton } from '../../ui';

/**
 * The import preview (data-import-export §2.5 step 3): what needs Ben
 * first, then what will be skipped, then what is kept as written, then the
 * workouts (pages of 50). Nothing has been saved. The primary stays
 * disabled until every question is answered (check 17).
 */
export function ImportPreviewScreen() {
  const services = useServices();
  const navigation = useNavigation<NativeStackNavigationProp<ProfileStackParams>>();
  const { draftId } = useRoute<RouteProp<ProfileStackParams, 'ImportPreview'>>().params;
  const [pages, setPages] = useState(1);
  const [data] = useScreenData((s) => s.imports.draft(draftId));

  // Leaving the preview any way but Import drops it; nothing was saved (review N8).
  useEffect(
    () =>
      navigation.addListener('beforeRemove', () => {
        services.imports.discard(draftId);
      }),
    [navigation, services, draftId],
  );

  useEffect(() => {
    navigation.setOptions({
      headerBackVisible: false,
      // Back is the Cancel button (it confirms); the swipe would skip that.
      gestureEnabled: false,
      headerLeft: () => (
        <TextButton
          label="Cancel"
          tone="secondary"
          onPress={() => {
            Alert.alert('Cancel this import?', 'Nothing has been saved.', [
              { text: 'Keep going', style: 'cancel' },
              {
                text: 'Cancel import',
                style: 'destructive',
                onPress: () => {
                  services.imports.discard(draftId);
                  navigation.goBack();
                },
              },
            ]);
          }}
        />
      ),
    });
  }, [navigation, services, draftId]);

  if (data.state !== 'ready') return <Screen>{null}</Screen>;
  const draft = data.value;
  if (!draft) {
    return (
      <Screen>
        <StatusLine icon="info.circle" tone="info" text="This preview is no longer open. Choose the file again." />
      </Screen>
    );
  }
  const v = previewView(draft);
  const rows = Array.from({ length: pages }, (_, p) => workoutRows(draft.analysis, p)).flat();

  function openQuestion(k: QuestionKey) {
    switch (k.kind) {
      case 'names':
        navigation.navigate('ImportNames', { draftId });
        return;
      case 'bodyweight':
        navigation.navigate('ImportQuestion', { draftId, question: 'bodyweight', key: k.key });
        return;
      case 'per_hand':
      case 'total':
      case 'unit':
        navigation.navigate('ImportQuestion', { draftId, question: k.kind });
        return;
    }
  }

  return (
    <Screen
      footer={
        <PrimaryButton
          label={v.primary.label}
          disabled={!v.primary.enabled}
          onPress={() => {
            navigation.navigate('ImportRun', { draftId, mappingVersion: draft.mappingVersion, workouts: draft.analysis.counts.workouts });
          }}
        />
      }
    >
      {v.notice ? <StatusLine icon={v.notice.icon} tone={v.notice.tone} text={v.notice.text} /> : null}
      <Card>
        <AppText variant="headline">{v.fileName}</AppText>
        <AppText variant="callout" color="text.secondary">
          {v.detection}
        </AppText>
        <AppText variant="callout" color="text.secondary" numeric>
          {v.rowsLine}
        </AppText>
      </Card>

      <SectionHeader title="Will import" />
      <AppText variant="body" numeric>
        {v.willImport.line1}
      </AppText>
      <AppText variant="callout" color="text.secondary" numeric>
        {v.willImport.line2}
      </AppText>

      {v.questions.length > 0 ? (
        <>
          <SectionHeader title={v.questionsTitle} />
          <Group>
            {v.questions.map((q) => (
              <Row
                key={q.key.kind === 'bodyweight' ? `bw:${q.key.key}` : q.key.kind}
                title={q.line.text}
                icon={q.line.icon}
                iconColor={q.answered ? 'status.done' : 'status.warning'}
                onPress={() => {
                  openQuestion(q.key);
                }}
              />
            ))}
          </Group>
        </>
      ) : null}

      {v.skipped.length > 0 || v.datesRow ? (
        <>
          <SectionHeader title="Will be skipped" />
          <Group>
            {v.skipped.map((x) => (
              <Row
                key={x.key + x.line.text}
                title={x.line.text}
                subtitle={x.line.detail ?? null}
                icon="info.circle"
                onPress={() => {
                  navigation.navigate('ImportRows', { draftId, skip: x.key });
                }}
              />
            ))}
            {v.datesRow ? (
              <Row
                title={v.datesRow}
                icon="calendar"
                onPress={() => {
                  navigation.navigate('ImportQuestion', { draftId, question: 'dates' });
                }}
              />
            ) : null}
          </Group>
        </>
      ) : null}

      <SectionHeader title="Kept as written" />
      <Group>
        {v.kept.map((k) => (
          <Row key={k.text} title={k.text} subtitle={k.detail ?? null} icon="info.circle" />
        ))}
        {v.effortReview ? (
          <Row
            title={v.effortReview}
            icon="info.circle"
            onPress={() => {
              navigation.navigate('ImportQuestion', { draftId, question: 'effort' });
            }}
          />
        ) : null}
        <Row
          title={v.gymRow}
          icon="mappin.and.ellipse"
          onPress={() => {
            navigation.navigate('ImportQuestion', { draftId, question: 'gym' });
          }}
        />
      </Group>

      <SectionHeader title={v.workoutsTitle} />
      {rows.length === 0 ? (
        <AppText variant="callout" color="text.secondary">
          No workouts to import from this file.
        </AppText>
      ) : (
        <Group>
          {rows.map((w) => (
            <Row
              key={w.date}
              title={w.text}
              onPress={() => {
                navigation.navigate('ImportRows', { draftId, date: w.date });
              }}
            />
          ))}
        </Group>
      )}
      {draft.analysis.workouts.length > pages * WORKOUT_PAGE ? (
        <TextButton
          label="Show more"
          onPress={() => {
            setPages((p) => p + 1);
          }}
        />
      ) : null}
    </Screen>
  );
}
