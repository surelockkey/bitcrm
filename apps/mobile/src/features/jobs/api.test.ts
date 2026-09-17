import { http } from '../../lib/api/http';
import { rescheduleDeal } from './api';

jest.mock('../../lib/api/http', () => ({
  http: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));

const mockHttp = http as jest.Mocked<typeof http>;

describe('rescheduleDeal', () => {
  beforeEach(() => mockHttp.put.mockReset().mockResolvedValue({}));

  it('moves the visit through the same PUT the app’s other edits use', async () => {
    await rescheduleDeal('deal-7', {
      scheduledDate: '2026-09-18',
      scheduledTimeSlot: '14:00-16:00',
      allDay: false,
    });

    expect(mockHttp.put).toHaveBeenCalledWith('/deals/deal-7', {
      scheduledDate: '2026-09-18',
      scheduledTimeSlot: '14:00-16:00',
      allDay: false,
    });
  });

  // The body is the whole request: `PUT /deals/:id` writes only the fields it
  // is given, so anything absent here is left exactly as dispatch set it.
  it('sends nothing but the date, the window and all-day', async () => {
    await rescheduleDeal('deal-7', { scheduledDate: '2026-09-18', allDay: true });

    const [, body] = mockHttp.put.mock.calls[0]!;
    expect(Object.keys(body as object).sort()).toEqual(['allDay', 'scheduledDate']);
  });
});
