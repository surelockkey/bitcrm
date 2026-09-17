import { Alert } from 'react-native';
import { fireEvent, screen } from '@testing-library/react-native';
import { renderScreen } from '../../test/render';
import { JobDetailScreen } from './job-detail-screen';
import { localDateIso, shiftDateIso } from './lib';
import { RescheduleRefused, describeRefusal } from './reschedule';
import { JobSuperStatus, type Deal } from './types';
import type { QueueRecord } from '../../lib/queue/types';

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
let mockDeal: Deal | undefined;
let mockRecords: QueueRecord[] = [];

jest.mock('./hooks', () => ({
  useJob: () => ({
    data: mockDeal,
    isPending: mockDeal === undefined,
    error: null,
    refetch: jest.fn(),
  }),
  useMe: () => ({ data: { id: 't1', email: 'tech@slk-s.com' } }),
  useMarkSeenOnOpen: (...args: unknown[]) => mockMarkSeenOnOpen(...args),
}));
jest.mock('./use-job-actions', () => ({ useJobActions: () => mockActions }));
jest.mock('../telephony/use-masked-call', () => ({
  useMaskedCall: () => ({ mutate: mockCall, isPending: false }),
}));
jest.mock('../queue/queue-provider', () => ({
  useQueue: () => ({ records: mockRecords }),
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
  createdAt: '2026-09-15T12:00:00.000Z',
  ...over,
});

describe('JobDetailScreen', () => {
  const props = { onBack: jest.fn(), onOpenPhotos: jest.fn(), onOpenChat: jest.fn() };

  beforeEach(() => {
    mockDeal = deal();
    mockRecords = [];
    Object.values(mockActions).forEach((fn) => fn.mockClear());
    mockCall.mockReset();
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

  it.each(['light', 'dark'] as const)('renders the job in the %s theme', async (scheme) => {
    await renderScreen(<JobDetailScreen dealId="d1" {...props} />, { scheme });
    expect(screen.getByTestId('job-screen')).toBeTruthy();
    expect(screen.getByText('Job K4T9ZW')).toBeTruthy();
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

    await fireEvent.press(screen.getByTestId('action-late'));
    expect(screen.getByTestId('minutes-sheet')).toBeTruthy();
    expect(mockActions.runningLate).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId('minutes-30'));
    expect(mockActions.runningLate).toHaveBeenCalledWith(30);
  });

  it('lets the technician back out of the minutes sheet', async () => {
    await renderScreen(<JobDetailScreen dealId="d1" {...props} />);
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
  const props = { onBack: jest.fn(), onOpenPhotos: jest.fn(), onOpenChat: jest.fn() };
  const today = localDateIso();
  const tomorrow = shiftDateIso(today, 1);

  beforeEach(() => {
    mockDeal = deal({ scheduledDate: today, scheduledTimeSlot: '09:00-12:00' });
    mockRecords = [];
    Object.values(mockActions).forEach((fn) => fn.mockClear());
    mockCall.mockReset();
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
