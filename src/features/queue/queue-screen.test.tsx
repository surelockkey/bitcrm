import { Alert } from 'react-native';
import { fireEvent, screen } from '@testing-library/react-native';
import { renderScreen } from '../../test/render';
import { QueueScreen } from './queue-screen';
import type { OutboxRecord, QueueRecord, UploadRecord } from '../../lib/queue/types';

const mockRetry = jest.fn();
const mockRetryAll = jest.fn();
const mockDiscard = jest.fn();
const mockDrainNow = jest.fn();
let mockRecords: QueueRecord[] = [];

jest.mock('./queue-provider', () => ({
  useQueue: () => ({
    records: mockRecords,
    retry: mockRetry,
    retryAll: mockRetryAll,
    discard: mockDiscard,
    drainNow: mockDrainNow,
    isDraining: false,
  }),
}));

const NOW = 1_700_000_000_000;

const action = (over: Partial<OutboxRecord> = {}): QueueRecord => ({
  queue: 'outbox',
  id: 'r1',
  kind: 'arrived',
  dealId: 'd1',
  payload: '{}',
  createdAt: NOW,
  attempts: 0,
  nextAttemptAt: 0,
  lastError: null,
  state: 'pending',
  ...over,
});

const upload = (over: Partial<UploadRecord> = {}): QueueRecord => ({
  queue: 'uploads',
  id: 'u1',
  dealId: 'd1',
  localUri: 'file:///a.jpg',
  fileName: 'job-d1.jpg',
  contentType: 'image/jpeg',
  size: 1,
  category: null,
  attachmentId: null,
  uploadUrl: null,
  uploadHeaders: null,
  progress: 0,
  attempts: 0,
  nextAttemptAt: 0,
  lastError: null,
  state: 'pending',
  createdAt: NOW,
  ...over,
});

describe('QueueScreen', () => {
  const onOpenJob = jest.fn();

  beforeEach(() => {
    mockRecords = [];
    mockRetry.mockReset();
    mockRetryAll.mockReset();
    mockDiscard.mockReset();
    mockDrainNow.mockReset();
    onOpenJob.mockReset();
  });

  it('reassures rather than showing a blank screen when there is nothing waiting', async () => {
    await renderScreen(<QueueScreen onOpenJob={onOpenJob} />);
    expect(screen.getByTestId('queue-empty')).toBeTruthy();
    expect(screen.getByText('Everything has been sent')).toBeTruthy();
  });

  it.each(['light', 'dark'] as const)('lists what is waiting in the %s theme', async (scheme) => {
    mockRecords = [action({ kind: 'note' }), upload({ id: 'u1' })];
    await renderScreen(<QueueScreen onOpenJob={onOpenJob} />, { scheme });

    expect(screen.getByTestId('queue-item-r1')).toBeTruthy();
    expect(screen.getByTestId('queue-item-u1')).toBeTruthy();
    expect(screen.getByText('Note')).toBeTruthy();
    expect(screen.getByText('Photo — job-d1.jpg')).toBeTruthy();
  });

  it("gives a parked row the server's own reason", async () => {
    mockRecords = [action({ state: 'failed', lastError: 'Job is already closed' })];
    await renderScreen(<QueueScreen onOpenJob={onOpenJob} />);
    expect(screen.getByText('Not sent: Job is already closed')).toBeTruthy();
  });

  it('retries one row on demand', async () => {
    mockRecords = [action({ state: 'failed', lastError: 'gateway down' })];
    await renderScreen(<QueueScreen onOpenJob={onOpenJob} />);

    await fireEvent.press(screen.getByTestId('queue-retry-r1'));
    expect(mockRetry).toHaveBeenCalledWith('outbox', 'r1');
  });

  it('retries everything that failed at once — the gesture after finding signal', async () => {
    mockRecords = [
      action({ id: 'a', state: 'failed' }),
      action({ id: 'b', state: 'failed' }),
    ];
    await renderScreen(<QueueScreen onOpenJob={onOpenJob} />);

    expect(screen.getByText('Try the 2 that failed again')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('queue-retry-all'));
    expect(mockRetryAll).toHaveBeenCalledTimes(1);
  });

  it('offers no retry-all when nothing has failed', async () => {
    mockRecords = [action()];
    await renderScreen(<QueueScreen onOpenJob={onOpenJob} />);
    expect(screen.queryByTestId('queue-retry-all')).toBeNull();
  });

  it('drains on demand, for a technician who has just found a signal', async () => {
    mockRecords = [action()];
    await renderScreen(<QueueScreen onOpenJob={onOpenJob} />);

    await fireEvent.press(screen.getByTestId('queue-drain'));
    expect(mockDrainNow).toHaveBeenCalledTimes(1);
  });

  it('leads to the job a queued item belongs to', async () => {
    mockRecords = [action({ dealId: 'job-7' })];
    await renderScreen(<QueueScreen onOpenJob={onOpenJob} />);

    await fireEvent.press(screen.getByTestId('queue-open-r1'));
    expect(onOpenJob).toHaveBeenCalledWith('job-7');
  });

  it('asks before discarding, and only discards on a yes', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockRecords = [upload({ state: 'failed', lastError: 'refused' })];
    await renderScreen(<QueueScreen onOpenJob={onOpenJob} />);

    await fireEvent.press(screen.getByTestId('queue-discard-u1'));
    expect(mockDiscard).not.toHaveBeenCalled();

    const buttons = alert.mock.calls[0]![2] as { text: string; onPress?: () => void }[];
    buttons.find((b) => b.text === 'Discard')?.onPress?.();
    expect(mockDiscard).toHaveBeenCalledWith('uploads', 'u1');
    alert.mockRestore();
  });

  it('will not offer to discard a photo the job already shows', async () => {
    // Presign already wrote the metadata and a timeline entry; discarding here
    // would leave a gap on the job nobody could explain.
    mockRecords = [upload({ state: 'failed', attachmentId: 'att-1' })];
    await renderScreen(<QueueScreen onOpenJob={onOpenJob} />);
    expect(screen.queryByTestId('queue-discard-u1')).toBeNull();
  });

  it('never offers to retry something already in flight', async () => {
    mockRecords = [action({ state: 'sending' })];
    await renderScreen(<QueueScreen onOpenJob={onOpenJob} />);
    expect(screen.queryByTestId('queue-retry-r1')).toBeNull();
  });
});
