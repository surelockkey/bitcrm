import { Alert, Linking, Share } from 'react-native';
import { fireEvent, screen } from '@testing-library/react-native';
import { renderScreen } from '../../test/render';
import { JobDetailScreen } from './job-detail-screen';
import { localDateIso, shiftDateIso } from './lib';
import { RescheduleRefused, describeRefusal } from './reschedule';
import { JobSuperStatus, type Contact, type Deal } from './types';
import type { QueueRecord } from '../../lib/queue/types';
import type { ClockState } from '../timeclock/lib';

const mockActions = {
  confirm: jest.fn().mockResolvedValue(undefined),
  onMyWay: jest.fn().mockResolvedValue(undefined),
  runningLate: jest.fn().mockResolvedValue(undefined),
  arrive: jest.fn().mockResolvedValue(undefined),
  start: jest.fn().mockResolvedValue(undefined),
  finish: jest.fn().mockResolvedValue(undefined),
  addNote: jest.fn().mockResolvedValue(undefined),
  reschedule: jest.fn().mockResolvedValue(undefined),
};
const mockCall = jest.fn();
const mockMarkSeenOnOpen = jest.fn();
const mockClockIn = jest.fn().mockResolvedValue(undefined);
let mockDeal: Deal | undefined;
let mockContact: Contact | undefined;
let mockRecords: QueueRecord[] = [];
let mockClockState: ClockState = { status: 'off' };

jest.mock('./hooks', () => ({
  useJob: () => ({
    data: mockDeal,
    isPending: mockDeal === undefined,
    error: null,
    refetch: jest.fn(),
  }),
  useMe: () => ({ data: { id: 't1', email: 'tech@slk-s.com' } }),
  useJobContact: () => ({ data: mockContact }),
  useMarkSeenOnOpen: (...args: unknown[]) => mockMarkSeenOnOpen(...args),
}));
jest.mock('./use-job-actions', () => ({ useJobActions: () => mockActions }));
jest.mock('../telephony/use-masked-call', () => ({
  useMaskedCall: () => ({ mutate: mockCall, isPending: false }),
}));
jest.mock('../queue/queue-provider', () => ({
  useQueue: () => ({ records: mockRecords }),
}));
// The clock on a job is a feature of its own — it reads the outbox and the
// query cache, and has its own suite (`features/timeclock`). This file is about
// the job screen, so what it asserts is that `Start` reaches the clock and
// reflects it, not what the clock itself does.
jest.mock('../timeclock/components/JobClockCard', () => ({
  JobClockCard: () => null,
}));
jest.mock('../timeclock/hooks', () => ({
  useClockState: () => ({
    state: mockClockState,
    failed: [],
    isLoading: false,
    refetch: jest.fn(),
  }),
  useClockActions: () => ({ clockIn: mockClockIn, clockOut: jest.fn() }),
  useDealNumber: () => undefined,
}));

const deal = (over: Partial<Deal> = {}): Deal => ({
  id: 'd1',
  dealNumber: 'K4T9ZW',
  contactId: 'c1',
  address: { street: '1 Main St', city: 'Hartford', state: 'CT', zip: '06103' },
  superStatus: JobSuperStatus.SUBMITTED,
  scheduledDate: '2026-09-16',
  scheduledTimeSlot: '09:00-12:00',
  clientName: { firstName: 'Ada', lastName: 'Byron' },
  assignedTechIds: ['t1'],
  createdAt: '2026-09-15T12:00:00.000Z',
  ...over,
});

describe('JobDetailScreen', () => {
  const props = {
    onBack: jest.fn(),
    onOpenPhotos: jest.fn(),
    onOpenChat: jest.fn(),
    onOpenClientThread: jest.fn(),
  };

  beforeEach(() => {
    mockDeal = deal();
    mockContact = undefined;
    mockRecords = [];
    mockClockState = { status: 'off' };
    Object.values(mockActions).forEach((fn) => fn.mockClear());
    mockCall.mockReset();
    mockClockIn.mockClear();
    mockMarkSeenOnOpen.mockClear();
    props.onBack.mockReset();
    props.onOpenPhotos.mockReset();
    props.onOpenChat.mockReset();
  });

  it('reaches the office thread in one tap, carrying the job', async () => {
    await renderScreen(<JobDetailScreen dealId="d1" {...props} />);
    await fireEvent.press(screen.getByTestId('action-message-office'));
    expect(props.onOpenChat).toHaveBeenCalledWith('d1');
  });

  it('reaches the client’s own text thread, by a different button', async () => {
    await renderScreen(<JobDetailScreen dealId="d1" {...props} />);
    await fireEvent.press(screen.getByTestId('action-text-client'));

    expect(props.onOpenClientThread).toHaveBeenCalledWith('d1');
    expect(props.onOpenChat).not.toHaveBeenCalled();
  });

  // Two buttons a thumb apart, each opening a thread the other cannot reach.
  // They are told apart by name before either screen is even open.
  it('names the client on one button and the office on the other', async () => {
    await renderScreen(<JobDetailScreen dealId="d1" {...props} />);

    expect(screen.getByLabelText('Text Ada Byron')).toBeTruthy();
    expect(screen.getByLabelText('Message the office')).toBeTruthy();
    expect(screen.getByText(/they see it, the office does not/)).toBeTruthy();
    expect(screen.getByText(/the client does not see it/)).toBeTruthy();
  });

  it('offers no text thread for a job with no client on it', async () => {
    mockDeal = deal({ contactId: '', clientName: undefined });
    await renderScreen(<JobDetailScreen dealId="d1" {...props} />);

    expect(
      screen.getByTestId('action-text-client').props.accessibilityState.disabled,
    ).toBe(true);
  });

  it.each(['light', 'dark'] as const)('renders the job in the %s theme', async (scheme) => {
    await renderScreen(<JobDetailScreen dealId="d1" {...props} />, { scheme });
    expect(screen.getByTestId('job-screen')).toBeTruthy();
    // Their header, verbatim — "Job #<number>", not "Job <number>".
    expect(screen.getByText('Job #K4T9ZW')).toBeTruthy();
    expect(screen.getByText('Ada Byron')).toBeTruthy();
    expect(screen.getByText('9:00 AM – 12:00 PM')).toBeTruthy();
  });

  it('tells the server the job has been opened, with the job and who opened it', async () => {
    // What fills the Seen stamp this screen draws, and dispatch's own Seen
    // column. Nothing else in the app writes it.
    await renderScreen(<JobDetailScreen dealId="d1" {...props} />);
    expect(mockMarkSeenOnOpen).toHaveBeenCalledWith(mockDeal, 't1');
  });

  it('offers the whole flow on a fresh Submitted job', async () => {
    await renderScreen(<JobDetailScreen dealId="d1" {...props} />);
    expect(screen.getByTestId('action-confirm')).toBeTruthy();
    expect(screen.getByTestId('action-arrived')).toBeTruthy();
    expect(screen.getByTestId('action-start')).toBeTruthy();
    expect(screen.queryByTestId('action-done')).toBeNull();
  });

  it('carries the time clock, the way Workiz leads its quick actions with Start', async () => {
    // §1.4: the first thing in Workiz's quick-action panel is Start, which
    // "launches a running clock" on this job. Ours is the first of the three
    // buttons in the row under the tabs, and one tap starts the clock — no
    // sheet in the way, exactly as theirs.
    await renderScreen(<JobDetailScreen dealId="d1" {...props} />);

    await fireEvent.press(screen.getByTestId('action-clock'));
    expect(mockClockIn).toHaveBeenCalledWith('d1');
    expect(screen.queryByTestId('clock-sheet')).toBeNull();
  });

  it('shows the clock running on this job, and opens the clock to stop it', async () => {
    mockClockState = {
      status: 'on',
      entry: {
        id: 'e1',
        userId: 't1',
        dealId: 'd1',
        startedAt: new Date(Date.now() - 65 * 60_000).toISOString(),
        source: 'mobile',
        createdAt: '2026-09-17T06:00:00.000Z',
        updatedAt: '2026-09-17T06:00:00.000Z',
      },
    };
    await renderScreen(<JobDetailScreen dealId="d1" {...props} />);

    // The word on the button is the truth about the clock, not an invitation
    // to start a second one.
    expect(screen.getByLabelText('Running')).toBeTruthy();
    expect(screen.getByText('1:05')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('action-clock'));
    expect(mockClockIn).not.toHaveBeenCalled();
    expect(screen.getByTestId('clock-sheet')).toBeTruthy();
  });

  it('will not start a second clock while one runs on another job', async () => {
    mockClockState = {
      status: 'starting',
      rowId: 'r9',
      dealId: 'another-job',
      startedAt: new Date().toISOString(),
    };
    await renderScreen(<JobDetailScreen dealId="d1" {...props} />);

    await fireEvent.press(screen.getByTestId('action-clock'));
    expect(mockClockIn).not.toHaveBeenCalled();
    // Sent to the clock, which is what explains the other job and offers the
    // only move that helps — clocking out there.
    expect(screen.getByTestId('clock-sheet')).toBeTruthy();
  });

  it('confirms receipt on a tap, with no dialog in the way', async () => {
    await renderScreen(<JobDetailScreen dealId="d1" {...props} />);
    await fireEvent.press(screen.getByTestId('action-confirm'));
    expect(mockActions.confirm).toHaveBeenCalledTimes(1);
  });

  it('records an arrival straight away — it is idempotent, so a mis-tap is free', async () => {
    await renderScreen(<JobDetailScreen dealId="d1" {...props} />);
    await fireEvent.press(screen.getByTestId('action-arrived'));
    expect(mockActions.arrive).toHaveBeenCalledTimes(1);
  });

  it('hides Confirm and Arrived once they have happened, and offers Done', async () => {
    mockDeal = deal({
      superStatus: JobSuperStatus.IN_PROGRESS,
      techConfirmedAt: '2026-09-16T13:04:00.000Z',
      arrivedAt: '2026-09-16T13:31:00.000Z',
    });
    await renderScreen(<JobDetailScreen dealId="d1" {...props} />);

    expect(screen.queryByTestId('action-confirm')).toBeNull();
    expect(screen.queryByTestId('action-arrived')).toBeNull();
    expect(screen.getByTestId('action-done')).toBeTruthy();
  });

  it('asks before finishing — that is the one move that is awkward to undo', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockDeal = deal({ superStatus: JobSuperStatus.IN_PROGRESS });
    await renderScreen(<JobDetailScreen dealId="d1" {...props} />);

    await fireEvent.press(screen.getByTestId('action-done'));
    expect(mockActions.finish).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledWith(
      'Finish this job?',
      expect.any(String),
      expect.any(Array),
    );

    // Say yes the way the dialog would.
    const buttons = alert.mock.calls[0]![2] as { text: string; onPress?: () => void }[];
    buttons.find((b) => b.text === 'Done')?.onPress?.();
    expect(mockActions.finish).toHaveBeenCalledTimes(1);
    alert.mockRestore();
  });

  it('picks the minutes before telling the client anything', async () => {
    await renderScreen(<JobDetailScreen dealId="d1" {...props} />);

    // Both notices live behind Workiz's own ETA button now (§1.4), which is
    // the one word they put on "on my way or running late".
    await fireEvent.press(screen.getByTestId('action-eta'));
    await fireEvent.press(screen.getByTestId('action-late'));
    expect(screen.getByTestId('minutes-sheet')).toBeTruthy();
    expect(mockActions.runningLate).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId('minutes-30'));
    expect(mockActions.runningLate).toHaveBeenCalledWith(30);
  });

  it('lets the technician back out of the minutes sheet', async () => {
    await renderScreen(<JobDetailScreen dealId="d1" {...props} />);
    await fireEvent.press(screen.getByTestId('action-eta'));
    await fireEvent.press(screen.getByTestId('action-on-my-way'));
    await fireEvent.press(screen.getByTestId('minutes-cancel'));
    expect(mockActions.onMyWay).not.toHaveBeenCalled();
  });

  it('keeps Save note inert until something has been typed', async () => {
    await renderScreen(<JobDetailScreen dealId="d1" {...props} />);
    await fireEvent.press(screen.getByTestId('action-save-note'));
    expect(mockActions.addNote).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByTestId('note-input'), '  Gate code 4821  ');
    await fireEvent.press(screen.getByTestId('action-save-note'));
    expect(mockActions.addNote).toHaveBeenCalledWith('Gate code 4821');
  });

  it('says plainly what has not reached the server', async () => {
    mockRecords = [
      {
        queue: 'outbox',
        id: 'r1',
        userId: 'tech-1',
        kind: 'note',
        dealId: 'd1',
        payload: '{}',
        createdAt: 0,
        attempts: 5,
        nextAttemptAt: 0,
        lastError: 'Job is already closed',
        state: 'failed',
      },
    ];
    await renderScreen(<JobDetailScreen dealId="d1" {...props} />);
    expect(screen.getByTestId('queue-summary')).toBeTruthy();
    expect(screen.getByText('1 item not sent')).toBeTruthy();
  });

  it('counts only this job’s queued work, not the whole van’s', async () => {
    mockRecords = [
      {
        queue: 'outbox',
        id: 'r1',
        userId: 'tech-1',
        kind: 'note',
        dealId: 'some-other-job',
        payload: '{}',
        createdAt: 0,
        attempts: 0,
        nextAttemptAt: 0,
        lastError: null,
        state: 'pending',
      },
    ];
    await renderScreen(<JobDetailScreen dealId="d1" {...props} />);
    expect(screen.queryByTestId('queue-summary')).toBeNull();
  });

  it('offers nothing but a call on a closed job', async () => {
    mockDeal = deal({ superStatus: JobSuperStatus.DONE });
    await renderScreen(<JobDetailScreen dealId="d1" {...props} />);

    expect(screen.queryByTestId('action-confirm')).toBeNull();
    expect(screen.queryByTestId('action-done')).toBeNull();
    expect(screen.getByText(/This job is closed/)).toBeTruthy();
    expect(screen.getByLabelText('Call client')).toBeTruthy();
  });

  it('opens the photo screen for this job', async () => {
    await renderScreen(<JobDetailScreen dealId="d1" {...props} />);
    await fireEvent.press(screen.getByTestId('action-photos'));
    expect(props.onOpenPhotos).toHaveBeenCalledWith('d1');
  });
});

/** Moving the visit from the phone — 15 956 of them in this account (§1.3). */
describe('JobDetailScreen — rescheduling', () => {
  const props = {
    onBack: jest.fn(),
    onOpenPhotos: jest.fn(),
    onOpenChat: jest.fn(),
    onOpenClientThread: jest.fn(),
  };
  const today = localDateIso();
  const tomorrow = shiftDateIso(today, 1);

  beforeEach(() => {
    mockDeal = deal({ scheduledDate: today, scheduledTimeSlot: '09:00-12:00' });
    mockContact = undefined;
    mockRecords = [];
    mockClockState = { status: 'off' };
    Object.values(mockActions).forEach((fn) => fn.mockClear());
    mockCall.mockReset();
    mockClockIn.mockClear();
    mockMarkSeenOnOpen.mockClear();
  });

  it('opens the sheet on the day the job is booked for', async () => {
    await renderScreen(<JobDetailScreen dealId="d1" {...props} />);
    await fireEvent.press(screen.getByTestId('action-reschedule'));

    expect(screen.getByTestId('reschedule-sheet')).toBeTruthy();
    expect(screen.getByText(/Booked for/)).toBeTruthy();
  });

  it('queues the day and the window the technician picked', async () => {
    await renderScreen(<JobDetailScreen dealId="d1" {...props} />);
    await fireEvent.press(screen.getByTestId('action-reschedule'));

    await fireEvent.press(screen.getByTestId(`day-${tomorrow}`));
    await fireEvent.press(screen.getByTestId('slot-14:00-16:00'));
    await fireEvent.press(screen.getByTestId('reschedule-confirm'));

    expect(mockActions.reschedule).toHaveBeenCalledWith({
      scheduledDate: tomorrow,
      scheduledTimeSlot: '14:00-16:00',
      allDay: false,
    });
    // The sheet closes behind it — the move is in the outbox, not in a dialog.
    expect(screen.queryByTestId('reschedule-sheet')).toBeNull();
  });

  it('sends no window at all for an all-day move', async () => {
    await renderScreen(<JobDetailScreen dealId="d1" {...props} />);
    await fireEvent.press(screen.getByTestId('action-reschedule'));

    await fireEvent.press(screen.getByTestId(`day-${tomorrow}`));
    await fireEvent.press(screen.getByTestId('slot-all-day'));
    await fireEvent.press(screen.getByTestId('reschedule-confirm'));

    expect(mockActions.reschedule).toHaveBeenCalledWith({
      scheduledDate: tomorrow,
      allDay: true,
    });
  });

  // The rule the whole feature turns on: a visit never moves backwards. A job
  // dated yesterday falls into "still open from earlier", where it reads as
  // work somebody forgot.
  it('will not let a day already gone be chosen', async () => {
    await renderScreen(<JobDetailScreen dealId="d1" {...props} />);
    await fireEvent.press(screen.getByTestId('action-reschedule'));

    const yesterday = screen.queryByTestId(`day-${shiftDateIso(today, -1)}`);
    // Either off this month's grid entirely, or drawn dead.
    if (yesterday) {
      expect(yesterday.props.accessibilityState.disabled).toBe(true);
      await fireEvent.press(yesterday);
    }

    await fireEvent.press(screen.getByTestId('reschedule-confirm'));
    expect(mockActions.reschedule).toHaveBeenCalledWith(
      expect.objectContaining({ scheduledDate: today }),
    );
  });

  it('keeps the job’s own odd window on offer, so only the day moves', async () => {
    mockDeal = deal({ scheduledDate: today, scheduledTimeSlot: '09:30-11:30' });
    await renderScreen(<JobDetailScreen dealId="d1" {...props} />);
    await fireEvent.press(screen.getByTestId('action-reschedule'));

    expect(screen.getByTestId('slot-09:30-11:30')).toBeTruthy();
    await fireEvent.press(screen.getByTestId(`day-${tomorrow}`));
    await fireEvent.press(screen.getByTestId('reschedule-confirm'));

    expect(mockActions.reschedule).toHaveBeenCalledWith({
      scheduledDate: tomorrow,
      scheduledTimeSlot: '09:30-11:30',
      allDay: false,
    });
  });

  it('tells the technician when a move was refused, rather than failing quietly', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockActions.reschedule.mockRejectedValueOnce(
      new RescheduleRefused('past_slot'),
    );

    await renderScreen(<JobDetailScreen dealId="d1" {...props} />);
    await fireEvent.press(screen.getByTestId('action-reschedule'));
    await fireEvent.press(screen.getByTestId(`day-${tomorrow}`));
    await fireEvent.press(screen.getByTestId('reschedule-confirm'));

    expect(alert).toHaveBeenCalledWith('Not moved', describeRefusal('past_slot'));
    alert.mockRestore();
  });

  it('does not offer to move a job that is already closed', async () => {
    mockDeal = deal({ superStatus: JobSuperStatus.DONE });
    await renderScreen(<JobDetailScreen dealId="d1" {...props} />);

    expect(
      screen.getByTestId('action-reschedule').props.accessibilityState.disabled,
    ).toBe(true);
    expect(screen.getByText(/closed job cannot be moved/)).toBeTruthy();
  });
});

/**
 * The card as Workiz lays it out, which is the whole point of this wave: the
 * owner installed Workiz for Android 4.281, read our app next to it and said
 * ours is not like it. These assert the structure itself — the header, the two
 * tabs, the three actions and the order of the Details blocks — because that is
 * the requirement, not a side effect of one.
 */
describe('JobDetailScreen — the Workiz job card', () => {
  const props = {
    onBack: jest.fn(),
    onOpenPhotos: jest.fn(),
    onOpenChat: jest.fn(),
    onOpenClientThread: jest.fn(),
  };

  beforeEach(() => {
    mockDeal = deal();
    mockContact = undefined;
    mockRecords = [];
    mockClockState = { status: 'off' };
    Object.values(mockActions).forEach((fn) => fn.mockClear());
    mockCall.mockReset();
    mockClockIn.mockClear();
    mockMarkSeenOnOpen.mockClear();
    props.onOpenPhotos.mockReset();
  });

  it('opens on Details, with both of their tabs and their three actions', async () => {
    await renderScreen(<JobDetailScreen dealId="d1" {...props} />);

    expect(screen.getByTestId('job-tab-details').props.accessibilityState.selected)
      .toBe(true);
    expect(screen.getByTestId('job-tab-finance').props.accessibilityState.selected)
      .toBe(false);

    // Their words, their order: Start · ETA · Pay.
    expect(screen.getByLabelText('Start')).toBeTruthy();
    expect(screen.getByLabelText('ETA')).toBeTruthy();
    expect(screen.getByLabelText('Pay')).toBeTruthy();
    expect(screen.getByTestId('details-tab')).toBeTruthy();
  });

  it('keeps the three actions on both tabs — they belong to the job, not a tab', async () => {
    await renderScreen(<JobDetailScreen dealId="d1" {...props} />);
    await fireEvent.press(screen.getByTestId('job-tab-finance'));

    expect(screen.getByTestId('finance-tab')).toBeTruthy();
    expect(screen.queryByTestId('details-tab')).toBeNull();
    expect(screen.getByLabelText('Start')).toBeTruthy();
    expect(screen.getByLabelText('ETA')).toBeTruthy();
    expect(screen.getByLabelText('Pay')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('job-tab-details'));
    expect(screen.getByTestId('details-tab')).toBeTruthy();
  });

  it('leads Details with the address, and hands it to the maps app on a tap', async () => {
    const open = jest
      .spyOn(Linking, 'openURL')
      .mockResolvedValue(undefined as never);
    await renderScreen(<JobDetailScreen dealId="d1" {...props} />);

    expect(screen.getByTestId('job-map')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('job-map'));
    expect(open).toHaveBeenCalledWith(
      expect.stringContaining('google.com/maps/dir/'),
    );
    open.mockRestore();
  });

  it('shows the client’s number, and still calls through the bridge', async () => {
    mockContact = {
      id: 'c1',
      firstName: 'Ada',
      lastName: 'Byron',
      phones: ['+18605551234'],
      emails: [],
      addresses: [],
    } as unknown as Contact;
    await renderScreen(<JobDetailScreen dealId="d1" {...props} />);

    expect(screen.getByTestId('client-phone').props.children).toBe(
      '(860) 555-1234',
    );

    await fireEvent.press(screen.getByTestId('action-call-client'));
    expect(mockCall).toHaveBeenCalledWith({ dealId: 'd1', contactId: 'c1' });
  });

  it('says there is no number rather than showing a blank where one goes', async () => {
    await renderScreen(<JobDetailScreen dealId="d1" {...props} />);
    expect(screen.getByText('No phone number on file')).toBeTruthy();
  });

  it('shows what the office wrote as the description, apart from the notes box', async () => {
    mockDeal = deal({ notes: 'Side gate, dog in the yard' });
    await renderScreen(<JobDetailScreen dealId="d1" {...props} />);

    expect(screen.getByText('Description')).toBeTruthy();
    expect(screen.getByText('Side gate, dog in the yard')).toBeTruthy();
    // The box the technician types into is still its own thing.
    expect(screen.getByTestId('note-input')).toBeTruthy();
  });

  it('leaves the description out entirely when the office wrote nothing', async () => {
    await renderScreen(<JobDetailScreen dealId="d1" {...props} />);
    expect(screen.queryByText('Description')).toBeNull();
    expect(screen.queryByTestId('job-description')).toBeNull();
  });

  it('answers the one question the roster can answer: am I on my own', async () => {
    mockDeal = deal({ assignedTechIds: ['t1', 't7'] });
    await renderScreen(<JobDetailScreen dealId="d1" {...props} />);
    expect(screen.getByText('You and one other technician.')).toBeTruthy();
  });

  it('shares the job through the phone’s own share sheet', async () => {
    const share = jest
      .spyOn(Share, 'share')
      .mockResolvedValue({ action: Share.sharedAction } as never);
    await renderScreen(<JobDetailScreen dealId="d1" {...props} />);

    await fireEvent.press(screen.getByTestId('job-share'));
    expect(share).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('Job #K4T9ZW'),
      }),
    );
    share.mockRestore();
  });

  it('draws no row for anything the phone has nothing behind', async () => {
    // Checklists, Equipment, Tasks, Job tags and Job type are Workiz blocks we
    // have either no field or only an unresolvable catalog id for. A row a
    // technician taps twice a day for nothing is worse than an absent one, so
    // none of them is drawn — this is the assertion that keeps it that way.
    await renderScreen(<JobDetailScreen dealId="d1" {...props} />);

    for (const absent of ['Checklists', 'Equipment', 'Tasks', 'Job tags', 'Job type']) {
      expect(screen.queryByText(absent)).toBeNull();
    }
  });
});

/** The money, mocked — and unable to look like it is not. */
describe('JobDetailScreen — Finance and Pay are mocked', () => {
  const props = {
    onBack: jest.fn(),
    onOpenPhotos: jest.fn(),
    onOpenChat: jest.fn(),
    onOpenClientThread: jest.fn(),
  };

  beforeEach(() => {
    mockDeal = deal();
    mockContact = undefined;
    mockRecords = [];
    mockClockState = { status: 'off' };
    mockCall.mockReset();
    mockClockIn.mockClear();
  });

  it('says on the face of the tab that nothing there is connected', async () => {
    await renderScreen(<JobDetailScreen dealId="d1" {...props} />);
    await fireEvent.press(screen.getByTestId('job-tab-finance'));

    expect(screen.getByTestId('finance-not-connected')).toBeTruthy();
    expect(screen.getByText(/Not connected yet/)).toBeTruthy();
  });

  it('says on the Pay sheet that taking payment is not connected', async () => {
    await renderScreen(<JobDetailScreen dealId="d1" {...props} />);
    await fireEvent.press(screen.getByTestId('action-pay'));

    expect(screen.getByTestId('pay-sheet')).toBeTruthy();
    expect(screen.getByText(/Taking payment is not connected yet/)).toBeTruthy();
    // Nothing on it charges anybody, so nothing on it is a button.
    expect(screen.queryByLabelText('Cash')).toBeNull();
    expect(screen.getByTestId('pay-method-cash')).toBeTruthy();
  });

  it('closes the Pay sheet without doing anything at all', async () => {
    await renderScreen(<JobDetailScreen dealId="d1" {...props} />);
    await fireEvent.press(screen.getByTestId('action-pay'));
    await fireEvent.press(screen.getByTestId('pay-sheet-close'));
    expect(screen.queryByTestId('pay-sheet')).toBeNull();
  });
});
