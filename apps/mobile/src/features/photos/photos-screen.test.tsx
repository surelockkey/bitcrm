import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import { createTestQueryClient } from '../../test/query';
import { renderScreen } from '../../test/render';
import { PhotosScreen } from './photos-screen';
import type { QueueRecord } from '../../lib/queue/types';

const mockEnqueueUpload = jest.fn().mockResolvedValue('u1');
const mockRetry = jest.fn();
const mockDiscard = jest.fn();
const mockCapture = jest.fn();
const mockPick = jest.fn();
let mockRecords: QueueRecord[] = [];

jest.mock('../queue/queue-provider', () => ({
  useQueue: () => ({
    records: mockRecords,
    enqueueUpload: mockEnqueueUpload,
    retry: mockRetry,
    discard: mockDiscard,
  }),
}));
jest.mock('./capture', () => ({
  capturePhoto: (...args: unknown[]) => mockCapture(...args),
  pickPhoto: (...args: unknown[]) => mockPick(...args),
}));
jest.mock('../jobs/api', () => ({ listAttachments: jest.fn().mockResolvedValue([]) }));

const upload = (over: Partial<QueueRecord & { queue: 'uploads' }> = {}) =>
  ({
    queue: 'uploads',
    id: 'u1',
    dealId: 'd1',
    localUri: 'file:///job-photos/a.jpg',
    fileName: 'job-d1-a.jpg',
    contentType: 'image/jpeg',
    size: 1024,
    category: 'onsite',
    attachmentId: null,
    uploadUrl: null,
    uploadHeaders: null,
    progress: 0,
    attempts: 0,
    nextAttemptAt: 0,
    lastError: null,
    state: 'pending',
    createdAt: 0,
    ...over,
  }) as QueueRecord;

/** Renders, then waits for the attachment list to settle so nothing updates late. */
async function render() {
  const rendered = await renderScreen(
    <QueryClientProvider client={createTestQueryClient()}>
      <PhotosScreen dealId="d1" onBack={jest.fn()} />
    </QueryClientProvider>,
  );
  await screen.findByText('Nothing has been uploaded to this job yet.');
  return rendered;
}

describe('PhotosScreen', () => {
  beforeEach(() => {
    mockRecords = [];
    mockEnqueueUpload.mockClear();
    mockRetry.mockReset();
    mockDiscard.mockReset();
    mockCapture.mockReset();
    mockPick.mockReset();
  });

  it('queues a capture rather than uploading it there and then', async () => {
    mockCapture.mockResolvedValue({
      localUri: 'file:///job-photos/a.jpg',
      fileName: 'job-d1-a.jpg',
      contentType: 'image/jpeg',
      size: 2048,
    });
    await render();

    await fireEvent.press(screen.getByTestId('take-photo'));

    await waitFor(() => expect(mockEnqueueUpload).toHaveBeenCalled());
    expect(mockEnqueueUpload).toHaveBeenCalledWith({
      dealId: 'd1',
      localUri: 'file:///job-photos/a.jpg',
      fileName: 'job-d1-a.jpg',
      contentType: 'image/jpeg',
      size: 2048,
      category: 'onsite',
    });
  });

  it('queues nothing when the technician backs out of the camera', async () => {
    mockCapture.mockResolvedValue(null);
    await render();
    await fireEvent.press(screen.getByTestId('take-photo'));
    await waitFor(() => expect(mockCapture).toHaveBeenCalled());
    expect(mockEnqueueUpload).not.toHaveBeenCalled();
  });

  it('shows every queued photo, so none of them is invisible', async () => {
    mockRecords = [upload({ state: 'sending', progress: 0.4 })];
    await render();

    expect(screen.getByTestId('upload-u1')).toBeTruthy();
    expect(screen.getByText('Uploading 40%')).toBeTruthy();
  });

  it('says a photo is waiting for a connection, not that it failed', async () => {
    mockRecords = [upload()];
    await render();
    expect(screen.getByText('Waiting for a connection')).toBeTruthy();
    expect(screen.queryByTestId('retry-u1')).toBeNull();
  });

  it('offers a manual retry, with the server’s own reason, on one that failed', async () => {
    mockRecords = [upload({ state: 'failed', lastError: 'Upload link expired (403)' })];
    await render();

    expect(screen.getByText('Upload link expired (403)')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('retry-u1'));
    expect(mockRetry).toHaveBeenCalledWith('uploads', 'u1');
  });

  it('hides photos belonging to another job', async () => {
    mockRecords = [upload({ dealId: 'other' })];
    await render();
    expect(screen.queryByTestId('upload-u1')).toBeNull();
  });

  it('stops listing a photo once it has landed', async () => {
    mockRecords = [upload({ state: 'done', progress: 1 })];
    await render();
    expect(screen.queryByTestId('upload-u1')).toBeNull();
  });
});
