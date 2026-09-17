import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ApiError } from '../../lib/api/errors';
import { useTheme } from '../../lib/theme/theme-provider';
import { Button } from '../../ui/Button';
import { Card, CardRow } from '../../ui/Card';
import { EmptyState } from '../../ui/EmptyState';
import { Screen } from '../../ui/Screen';
import { Splash } from '../../ui/Splash';
import { FinanceTab } from '../finance/components/FinanceTab';
import { PaySheet } from '../finance/components/PaySheet';
import { useQueue } from '../queue/queue-provider';
import { QueueSummary } from '../queue/components/QueueBadge';
import { useMaskedCall } from '../telephony/use-masked-call';
import { ClientCard } from './components/ClientCard';
import { EtaSheet } from './components/EtaSheet';
import { JobMapCard } from './components/JobMapCard';
import { JobTabs, type JobTab } from './components/JobTabs';
import { MinutesSheet } from './components/MinutesSheet';
import { JobStamps } from './components/JobStamps';
import { PrimaryActions } from './components/PrimaryActions';
import { RescheduleSheet } from './components/RescheduleSheet';
import { StatusPill } from './components/StatusPill';
import { TimeClockSheet } from './components/TimeClockSheet';
import { useJob, useJobContact, useMarkSeenOnOpen, useMe } from './hooks';
import {
  addressLine,
  clientDisplayName,
  formatDayHeading,
  formatSlot,
  localDateIso,
  teamSummary,
  techActionState,
} from './lib';
import { RescheduleRefused } from './reschedule';
import { shareJob } from './share';
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

type Sheet = 'none' | 'clock' | 'eta' | 'pay' | 'onMyWay' | 'late' | 'reschedule';

/**
 * One job, and everything a technician does to it — laid out as Workiz lays it
 * out (`WORKIZ_MOBILE_APP.md` §1.4, `WORKIZ_APP_SCREENS_LIVE.md`).
 *
 * The owner's rule is UX theirs, UI ours: the users are technicians who have
 * spent years in the Workiz app, and nothing about their day should have to be
 * relearned. So the structure and the words are Workiz's, down to the order —
 *
 *   header `Job #<number>` · back · share
 *   tabs   `Details` | `Finance`
 *   row    `Start` · `ETA` · `Pay`
 *   details: map, description, status, client, schedule, team
 *
 * — and everything visual is ours: our palette, our type scale, our touch
 * floors, our components.
 *
 * Every action still goes through the durable queue and is optimistic, so the
 * screen answers instantly whether or not there is a signal, and the queue line
 * under the header says plainly what has not reached the server yet. Only
 * "Done" asks for confirmation — it is the one move that is awkward to undo.
 * "Arrived" does not: it is idempotent server-side, so a mis-tap costs nothing,
 * and a confirmation dialog between a technician and a doorstep is friction for
 * its own sake (docs/ARCHITECTURE.md §2.9).
 *
 * **What is mocked, and what was left out.** Finance and Pay read from nothing
 * this wave and say so on their face (`features/finance/mock.ts`). Four of
 * Workiz's Details sections are absent rather than drawn dead — Job name, Job
 * type, Job tags, Checklists, Equipment, Tasks — because the phone has either
 * no field behind them at all or only a catalog id it cannot turn into a word,
 * and a row that shows a technician a uuid, or that they tap twice a day for
 * nothing, is worse than a row that is not there.
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
  const { data: contact } = useJobContact(deal?.contactId);
  const actions = useJobActions(dealId);
  const call = useMaskedCall();
  const { records } = useQueue();
  const [tab, setTab] = useState<JobTab>('Details');
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
        <Header title="Job" onBack={onBack} />
        <Splash />
      </Screen>
    );
  }

  if (!deal) {
    const offline = error instanceof ApiError && error.status === 0;
    return (
      <Screen testID="job-screen">
        <Header title="Job" onBack={onBack} />
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

  return (
    <Screen testID="job-screen">
      <Header
        title={`Job #${deal.dealNumber}`}
        onBack={onBack}
        onShare={() => void shareJob(deal)}
      />

      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}>
        {/* Above the tabs: what has not reached the server is about the whole
            job, not about whichever tab happens to be open. */}
        <QueueSummary waiting={waiting} failed={failed} label="this job" />

        <JobTabs value={tab} onChange={setTab} />

        <PrimaryActions
          dealId={dealId}
          canNotify={can.canNotify}
          onOpenClock={() => setSheet('clock')}
          onOpenEta={() => setSheet('eta')}
          onOpenPay={() => setSheet('pay')}
        />

        {tab === 'Finance' ? (
          <FinanceTab />
        ) : (
          <View testID="details-tab" style={{ gap: spacing.lg }}>
            {/* 1. The map with the address — Workiz's first element. */}
            <JobMapCard address={deal.address} />

            {/* 2. Description: what the office wrote on the job. Read-only, and
                   separate from the Notes box further down, which is where the
                   technician writes — `deal.notes` and `POST /notes` are two
                   different things and were sharing one heading before. */}
            {deal.notes ? (
              <Section title="Description">
                <Card testID="job-description">
                  <Text style={[type.body, { color: colors.text }]}>
                    {deal.notes}
                  </Text>
                </Card>
              </Section>
            ) : null}

            {/* 3. Status — and, as in Workiz, the status moves are made here on
                   Details rather than from the quick-action row. */}
            <Section title="Status">
              <Card>
                <StatusPill status={deal.superStatus} />
                <View style={{ marginTop: spacing.sm }}>
                  <JobStamps deal={deal} />
                </View>
              </Card>
              {can.canConfirm ? (
                <Button
                  label="Confirm receipt"
                  testID="action-confirm"
                  hint="Tells dispatch you have the job"
                  onPress={() => void actions.confirm()}
                />
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
              {/* "Start work" is the status move Submitted → In progress, not
                  the clock: the clock is `Start` in the row above, which is the
                  word Workiz spends there. Two buttons beginning with "Start"
                  is the one thing a technician of twenty years' standing should
                  not have to puzzle over, so this one keeps the longer name. */}
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
                    Alert.alert('Finish this job?', 'Dispatch will see it as done.', [
                      { text: 'Not yet', style: 'cancel' },
                      { text: 'Done', onPress: () => void actions.finish() },
                    ])
                  }
                />
              ) : null}
              {!can.canConfirm && !can.canArrive && !can.canStart && !can.canFinish ? (
                <Text style={[type.body, { color: colors.textMuted }]}>
                  This job is closed. You can still call the client.
                </Text>
              ) : null}
            </Section>

            {/* 4. Client: name, address, phone, call, message. */}
            <Section title="Client">
              <ClientCard
                name={client}
                address={address}
                contact={contact}
                onCall={() => call.mutate({ dealId, contactId: deal.contactId })}
                callBusy={call.isPending}
                canText={Boolean(deal.contactId)}
                onText={() => onOpenClientThread(dealId)}
              />
            </Section>

            {/* 5. Schedule — when the visit is, and the one control that moves
                   it. Its own section, well away from the hero actions: a
                   mis-tap here opens a sheet, but a mis-tap on "Done" would
                   not be so cheap. */}
            <Section title="Schedule">
              <Card>
                {deal.scheduledDate ? (
                  <CardRow
                    label="Date"
                    value={formatDayHeading(deal.scheduledDate.slice(0, 10))}
                  />
                ) : null}
                <CardRow
                  label="Window"
                  value={formatSlot(deal.scheduledTimeSlot, deal.allDay)}
                />
                {deal.serviceArea ? (
                  <CardRow label="Area" value={deal.serviceArea} />
                ) : null}
              </Card>
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

            {/* 6. Team — who else is on this job, and the way to reach the
                   office about it. */}
            <Section title="Team">
              <Card testID="job-team">
                <Text style={[type.body, { color: colors.text }]}>
                  {teamSummary(deal, me?.id)}
                </Text>
              </Card>
              {/* One tap from the job to the office, with the job carried along
                  — the technician does not have to say which job they mean. */}
              <Button
                label="Message the office"
                testID="action-message-office"
                variant="secondary"
                hint="Asks dispatch about this job — the client does not see it"
                onPress={() => onOpenChat(dealId)}
              />
            </Section>

            {/* Workiz's two remaining quick actions, Attach and Add note, at
                the foot of Details where the things they write to live. */}
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
          </View>
        )}

        <View style={{ height: spacing.xl }} />
      </ScrollView>

      <TimeClockSheet
        visible={sheet === 'clock'}
        dealId={dealId}
        onClose={() => setSheet('none')}
      />
      <EtaSheet
        visible={sheet === 'eta'}
        clientName={client}
        onCancel={() => setSheet('none')}
        onOnMyWay={() => setSheet('onMyWay')}
        onRunningLate={() => setSheet('late')}
      />
      <PaySheet visible={sheet === 'pay'} onClose={() => setSheet('none')} />
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

/**
 * `Job #<number>`, back, and the share action — Workiz's job header, in its
 * order (§1.4). Share hands the phone's own share sheet the job's details;
 * there is no send-to-tech endpoint in the app, and this is the half of that
 * action which needs no server.
 */
function Header({
  title,
  onBack,
  onShare,
}: {
  title: string;
  onBack: () => void;
  onShare?: () => void;
}) {
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
        style={[type.heading, styles.grow, { color: colors.text }]}
      >
        {title}
      </Text>
      {onShare ? (
        <Button
          label="Share"
          variant="ghost"
          testID="job-share"
          accessibilityHint="Sends this job's details through your phone's share sheet"
          onPress={onShare}
        />
      ) : null}
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
  grow: { flexShrink: 1, flexGrow: 1 },
});
