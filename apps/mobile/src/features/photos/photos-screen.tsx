import { useState } from 'react';
import { Alert, Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../lib/api/query-keys';
import { useTheme } from '../../lib/theme/theme-provider';
import type { UploadRecord } from '../../lib/queue/types';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { Screen } from '../../ui/Screen';
import { listAttachments } from '../jobs/api';
import { useQueue } from '../queue/queue-provider';
import { capturePhoto, pickPhoto } from './capture';

export interface PhotosScreenProps {
  dealId: string;
  onBack: () => void;
}

/**
 * Photos for a job.
 *
 * A capture is copied into the app's own storage and queued; the bytes go when
 * there is a connection. Every queued photo is on screen with its progress and,
 * if it failed, a retry — a photo taken at a job and silently lost is the
 * single worst thing this app could do (docs/ARCHITECTURE.md §2.5).
 */
export function PhotosScreen({ dealId, onBack }: PhotosScreenProps) {
  const { colors, radius, spacing, type } = useTheme();
  const { records, enqueueUpload, retry, discard } = useQueue();
  const [busy, setBusy] = useState(false);

  const queued = records.filter(
    (r): r is { queue: 'uploads' } & UploadRecord =>
      r.queue === 'uploads' && r.dealId === dealId && r.state !== 'done',
  );

  const uploaded = useQuery({
    queryKey: queryKeys.deals.attachments(dealId),
    queryFn: () => listAttachments(dealId),
  });

  const add = (take: boolean) => {
    setBusy(true);
    void (take ? capturePhoto(dealId) : pickPhoto(dealId))
      .then(async (photo) => {
        if (!photo) return;
        await enqueueUpload({
          dealId,
          localUri: photo.localUri,
          fileName: photo.fileName,
          contentType: photo.contentType,
          ...(photo.size ? { size: photo.size } : {}),
          category: take ? 'onsite' : 'attached',
        });
      })
      .catch(() =>
        Alert.alert(
          'Could not add the photo',
          'The phone would not hand the file over. Try again.',
        ),
      )
      .finally(() => setBusy(false));
  };

  return (
    <Screen testID="photos-screen">
      <View
        style={[
          styles.header,
          { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, gap: spacing.md },
        ]}
      >
        <Button label="Back" variant="ghost" onPress={onBack} testID="photos-back" />
        <Text accessibilityRole="header" style={[type.heading, { color: colors.text }]}>
          Photos
        </Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}>
        <View style={{ gap: spacing.md }}>
          <Button
            label="Take a photo"
            testID="take-photo"
            size="hero"
            busy={busy}
            onPress={() => add(true)}
          />
          <Button
            label="Add from the phone"
            testID="pick-photo"
            variant="secondary"
            busy={busy}
            onPress={() => add(false)}
          />
        </View>

        {queued.length ? (
          <View style={{ gap: spacing.md }}>
            <Text style={[type.heading, { color: colors.textMuted }]}>
              Waiting to upload
            </Text>
            {queued.map((record) => (
              <Card key={record.id} testID={`upload-${record.id}`}>
                <View style={[styles.row, { gap: spacing.md }]}>
                  <Image
                    source={{ uri: record.localUri }}
                    style={[styles.thumb, { borderRadius: radius.sm }]}
                    accessibilityIgnoresInvertColors
                  />
                  <View style={styles.grow}>
                    <Text style={[type.label, { color: colors.text }]} numberOfLines={1}>
                      {record.fileName}
                    </Text>
                    <Text
                      style={[
                        type.caption,
                        {
                          color:
                            record.state === 'failed' ? colors.danger : colors.textMuted,
                        },
                      ]}
                    >
                      {record.state === 'failed'
                        ? (record.lastError ?? 'Not sent')
                        : record.state === 'sending'
                          ? `Uploading ${Math.round(record.progress * 100)}%`
                          : 'Waiting for a connection'}
                    </Text>
                    <View
                      style={[
                        styles.track,
                        { backgroundColor: colors.surfaceSunken, borderRadius: radius.sm },
                      ]}
                    >
                      <View
                        style={[
                          styles.fill,
                          {
                            backgroundColor:
                              record.state === 'failed' ? colors.danger : colors.primary,
                            width: `${Math.max(2, Math.round(record.progress * 100))}%`,
                            borderRadius: radius.sm,
                          },
                        ]}
                      />
                    </View>
                  </View>
                </View>
                {record.state === 'failed' ? (
                  <View style={{ gap: spacing.md, marginTop: spacing.sm }}>
                    <Button
                      label="Try again"
                      testID={`retry-${record.id}`}
                      onPress={() => void retry('uploads', record.id)}
                    />
                    <Button
                      label="Remove"
                      variant="ghost"
                      testID={`discard-${record.id}`}
                      onPress={() =>
                        Alert.alert(
                          'Remove this photo?',
                          'It has not been uploaded. Removing it here deletes it from the queue.',
                          [
                            { text: 'Keep it', style: 'cancel' },
                            {
                              text: 'Remove',
                              style: 'destructive',
                              onPress: () => void discard('uploads', record.id),
                            },
                          ],
                        )
                      }
                    />
                  </View>
                ) : null}
              </Card>
            ))}
          </View>
        ) : null}

        <View style={{ gap: spacing.md }}>
          <Text style={[type.heading, { color: colors.textMuted }]}>On the job</Text>
          {uploaded.data?.length ? (
            uploaded.data.map((attachment) => (
              <Card key={attachment.id}>
                <Text style={[type.label, { color: colors.text }]} numberOfLines={1}>
                  {attachment.fileName}
                </Text>
                <Text style={[type.caption, { color: colors.textMuted }]}>
                  {attachment.category ?? 'Photo'}
                </Text>
              </Card>
            ))
          ) : (
            <Text style={[type.body, { color: colors.textMuted }]}>
              {uploaded.isPending
                ? 'Checking…'
                : 'Nothing has been uploaded to this job yet.'}
            </Text>
          )}
        </View>

        <View style={{ height: spacing.xl }} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center' },
  grow: { flex: 1, gap: 4 },
  thumb: { width: 64, height: 64, backgroundColor: '#8883' },
  track: { height: 8, overflow: 'hidden' },
  fill: { height: 8 },
});
