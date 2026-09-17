import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ApiError } from '../../lib/api/errors';
import { openExternalUrl } from '../../lib/linking';
import { useTheme } from '../../lib/theme/theme-provider';
import { Button } from '../../ui/Button';
import { Card, CardRow } from '../../ui/Card';
import { EmptyState } from '../../ui/EmptyState';
import { Screen } from '../../ui/Screen';
import { Splash } from '../../ui/Splash';
import { useQueue } from '../queue/queue-provider';
import { QueueSummary } from '../queue/components/QueueBadge';
import { useMaskedCall } from '../telephony/use-masked-call';
import { JobClockCard } from '../timeclock/components/JobClockCard';
import { MinutesSheet } from './components/MinutesSheet';
import { JobStamps } from './components/JobStamps';
import { RescheduleSheet } from './components/RescheduleSheet';
import { StatusPill } from './components/StatusPill';
import { useJob, useMarkSeenOnOpen, useMe } from './hooks';
import {
  addressLine,
  clientDisplayName,
  formatDayHeading,
  formatSlot,
  localDateIso,
  navigationUrl,
  techActionState,
} from './lib';
import { RescheduleRefused } from './reschedule';
import { useJobActions } from './use-job-actions';

export interface JobDetailScreenProps {
  dealId: string;
  onBack: () => void;
  onOpenPhotos: (dealId: string) => void;
  /** Opens the office thread with this job attached to whatever is written. */
  onOpenChat: (dealId: string) => void;
  /** Opens the text thread with this job's client — a different screen. */
  onOpenClientThread: (dealId: string) => void;
}

type Sheet = 'none' | 'onMyWay' | 'late' | 'reschedule';

/**
 * One job, and everything a technician does to it.
 *
 * Every action is queued and optimistic, so the screen answers instantly
 * whether or not there is a signal, and the queue line under the header says
 * plainly what has not reached the server yet. Only "Done" asks for
 * confirmation — it is the one move that is awkward to undo. "Arrived" does
 * not: it is idempotent server-side, so a mis-tap costs nothing, and a
 * confirmation dialog between a technician and a doorstep is friction for its
 * own sake (docs/ARCHITECTURE.md §2.9).
 */
export function JobDetailScreen({
  dealId,
  onBack,
  onOpenPhotos,
  onOpenChat,
  onOpenClientThread,
}: JobDetailScreenProps) {
  const { colors, radius, spacing, touch, type } = useTheme();
  const { data: deal, isPending, error, refetch } = useJob(dealId);
  const { data: me } = useMe();
  // Above every early return, because opening the job is the event — whether
  // or not the fresh copy has landed yet.
  useMarkSeenOnOpen(deal, me?.id);
  const actions = useJobActions(dealId);
  const call = useMaskedCall();
  const { records } = useQueue();
  const [sheet, setSheet] = useState<Sheet>('none');
  const [note, setNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  const forThisJob = records.filter((r) => r.dealId === dealId);
  const waiting = forThisJob.filter(
    (r) => r.state === 'pending' || r.state === 'sending',
  ).length;
  const failed = forThisJob.filter((r) => r.state === 'failed').length;

  if (!deal && isPending) {
    return (
      <Screen testID="job-screen">
        <Header onBack={onBack} title="Job" />
        <Splash />
      </Screen>
    );
  }

  if (!deal) {
    const offline = error instanceof ApiError && error.status === 0;
    return (
      <Screen testID="job-screen">
        <Header onBack={onBack} title="Job" />
        <EmptyState
          testID="job-error"
          tone="error"
          title={offline ? 'No signal' : 'Could not open this job'}
          body={
            offline
              ? 'This job has not been downloaded to the phone yet.'
              : error instanceof ApiError
                ? error.message
                : 'Something went wrong on the way to the server.'
          }
          actionLabel="Try again"
          onAction={() => void refetch()}
        />
      </Screen>
    );
  }

  const can = techActionState(deal);
  const client = clientDisplayName(deal);
  const address = addressLine(deal.address);
  const mapUrl = navigationUrl(deal.address);

  return (
    <Screen testID="job-screen">
      <Header onBack={onBack} title={`Job ${deal.dealNumber}`} />

      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}>
        <QueueSummary waiting={waiting} failed={failed} label="this job" />

        <Card>
          <View style={styles.topRow}>
            <Text style={[type.title, styles.shrink, { color: colors.text }]}>
              {formatSlot(deal.scheduledTimeSlot, deal.allDay)}
            </Text>
            <StatusPill status={deal.superStatus} />
          </View>
          {client ? <CardRow label="Client" value={client} /> : null}
          {address ? <CardRow label="Address" value={address} /> : null}
          {deal.scheduledDate ? (
            <CardRow
              label="Date"
              value={formatDayHeading(deal.scheduledDate.slice(0, 10))}
            />
          ) : null}
          <View style={{ marginTop: spacing.sm }}>
            <JobStamps deal={deal} />
          </View>
        </Card>

        <View style={{ gap: spacing.md }}>
          <Button
            label="Navigate"
            variant="secondary"
            disabled={!mapUrl}
            onPress={() => {
              void openExternalUrl(mapUrl).then((opened) => {
                if (!opened) {
                  Alert.alert(
                    'Could not open maps',
                    'No maps app answered. The address is above, ready to copy.',
                  );
                }
              });
            }}
          />
          <Button
            label="Call client"
            variant="secondary"
            busy={call.isPending}
            accessibilityHint="Rings your phone, then connects you to the client"
            onPress={() => call.mutate({ dealId, contactId: deal.contactId })}
          />
          {/* The two client-facing buttons together, the office one under
              them: the grouping is the first thing that says which of the two
              threads a technician is about to open, before any wording does. */}
          <Button
            label={client ? `Text ${client}` : 'Text the client'}
            testID="action-text-client"
            variant="secondary"
            hint="Their own text thread — they see it, the office does not"
            disabled={!deal.contactId}
            onPress={() => onOpenClientThread(dealId)}
          />
          {/* One tap from the job to the office, with the job carried along —
              the technician does not have to say which job they mean. */}
          <Button
            label="Message the office"
            testID="action-message-office"
            variant="secondary"
            hint="Asks dispatch about this job — the client does not see it"
            onPress={() => onOpenChat(dealId)}
          />
        </View>

        {/* Workiz's quick-action panel leads with Start, which starts a clock
            on this job (`WORKIZ_MOBILE_APP.md` §1.4), so the clock comes before
            the rest of the actions here too. */}
        <Section title="Time clock">
          <JobClockCard dealId={dealId} />
        </Section>

        <Section title="Actions">
          {can.canConfirm ? (
            <Button
              label="Confirm receipt"
              testID="action-confirm"
              hint="Tells dispatch you have the job"
              onPress={() => void actions.confirm()}
            />
          ) : null}
          {can.canNotify ? (
            <>
              <Button
                label="On my way"
                testID="action-on-my-way"
                variant="secondary"
                hint="Texts the client"
                onPress={() => setSheet('onMyWay')}
              />
              <Button
                label="Running late"
                testID="action-late"
                variant="secondary"
                hint="Texts the client how long"
                onPress={() => setSheet('late')}
              />
            </>
          ) : null}
          {can.canArrive ? (
            <Button
              label="Arrived"
              testID="action-arrived"
              size="hero"
              hint="Sends your location if the phone offers one"
              onPress={() => void actions.arrive()}
            />
          ) : null}
          {can.canStart ? (
            <Button
              label="Start work"
              testID="action-start"
              onPress={() => void actions.start()}
            />
          ) : null}
          {can.canFinish ? (
            <Button
              label="Done"
              testID="action-done"
              size="hero"
              onPress={() =>
                Alert.alert(
                  'Finish this job?',
                  'Dispatch will see it as done.',
                  [
                    { text: 'Not yet', style: 'cancel' },
                    { text: 'Done', onPress: () => void actions.finish() },
                  ],
                )
              }
            />
          ) : null}
          {!can.canConfirm && !can.canNotify && !can.canArrive && !can.canStart && !can.canFinish ? (
            <Text style={[type.body, { color: colors.textMuted }]}>
              This job is closed. You can still call the client.
            </Text>
          ) : null}
        </Section>

        {/* Its own section, well away from the hero actions: a mis-tap here
            opens a sheet, but a mis-tap on "Done" beside it would not. */}
        <Section title="Visit">
          <Button
            label="Reschedule"
            testID="action-reschedule"
            variant="secondary"
            hint="Move this visit to another day or window"
            disabled={!can.canReschedule}
            onPress={() => setSheet('reschedule')}
          />
          {!can.canReschedule ? (
            <Text style={[type.caption, { color: colors.textMuted }]}>
              A closed job cannot be moved. Ask the office to reopen it.
            </Text>
          ) : null}
        </Section>

        <Section title="Photos">
          <Button
            label="Photos"
            testID="action-photos"
            variant="secondary"
            hint="Take a photo or see what is queued"
            onPress={() => onOpenPhotos(dealId)}
          />
        </Section>

        <Section title="Notes">
          {deal.notes ? (
            <Card>
              <Text style={[type.body, { color: colors.text }]}>{deal.notes}</Text>
            </Card>
          ) : null}
          <TextInput
            testID="note-input"
            accessibilityLabel="New note"
            multiline
            placeholder="Add a note for this job"
            placeholderTextColor={colors.textMuted}
            value={note}
            onChangeText={setNote}
            style={[
              type.body,
              {
                minHeight: touch.min * 2,
                backgroundColor: colors.surface,
                borderColor: colors.border,
                borderWidth: 2,
                borderRadius: radius.md,
                color: colors.text,
                padding: spacing.lg,
                textAlignVertical: 'top',
              },
            ]}
          />
          <Button
            label="Save note"
            testID="action-save-note"
            disabled={note.trim().length === 0}
            busy={savingNote}
            onPress={() => {
              setSavingNote(true);
              void actions
                .addNote(note.trim())
                .then(() => setNote(''))
                .finally(() => setSavingNote(false));
            }}
          />
        </Section>

        <View style={{ height: spacing.xl }} />
      </ScrollView>

      <MinutesSheet
        visible={sheet === 'onMyWay'}
        title="On my way"
        body="The client gets your workspace's own message. Pick how long you expect to be."
        confirmPrefix="I'll be there in"
        onCancel={() => setSheet('none')}
        onSelect={(minutes) => {
          setSheet('none');
          void actions.onMyWay(minutes);
        }}
      />
      <MinutesSheet
        visible={sheet === 'late'}
        title="Running late"
        body="The client is told how much longer. Each message is sent on its own — a second, longer delay is never swallowed as a duplicate."
        confirmPrefix="I'll be"
        onCancel={() => setSheet('none')}
        onSelect={(minutes) => {
          setSheet('none');
          void actions.runningLate(minutes);
        }}
      />
      <RescheduleSheet
        visible={sheet === 'reschedule'}
        dealNumber={deal.dealNumber}
        scheduledDate={deal.scheduledDate}
        scheduledTimeSlot={deal.scheduledTimeSlot}
        allDay={deal.allDay}
        todayIso={localDateIso()}
        onCancel={() => setSheet('none')}
        onConfirm={(next) => {
          setSheet('none');
          void actions.reschedule(next).catch((error: unknown) => {
            // The only way here is a sheet that sat open across midnight or
            // across the end of a window: the day it was offering stopped
            // being offerable while the technician was looking at it.
            Alert.alert(
              'Not moved',
              error instanceof RescheduleRefused
                ? error.message
                : 'The phone could not save the change. Try again.',
            );
          });
        }}
      />
    </Screen>
  );
}

function Header({ onBack, title }: { onBack: () => void; title: string }) {
  const { colors, spacing, type } = useTheme();
  return (
    <View
      style={[
        styles.header,
        { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, gap: spacing.md },
      ]}
    >
      <Button label="Back" variant="ghost" onPress={onBack} testID="job-back" />
      <Text
        accessibilityRole="header"
        style={[type.heading, styles.shrink, { color: colors.text }]}
      >
        {title}
      </Text>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const { colors, spacing, type } = useTheme();
  return (
    <View style={{ gap: spacing.md }}>
      <Text accessibilityRole="header" style={[type.heading, { color: colors.textMuted }]}>
        {title}
      </Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center' },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  shrink: { flexShrink: 1 },
});
