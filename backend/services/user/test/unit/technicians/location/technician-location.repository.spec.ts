import { type TechnicianLocationPoint } from '@bitcrm/types';
import { TechnicianLocationRepository } from '../../../../src/technicians/location/technician-location.repository';
import { createMockDynamoDbClient } from '../../mocks';

const RECORDED_AT = '2026-09-17T08:00:00.000Z';
const THIRTY_DAYS_S = 30 * 86_400;

function point(over?: Partial<TechnicianLocationPoint>): TechnicianLocationPoint {
  return {
    userId: 'tech-1',
    recordedAt: RECORDED_AT,
    lat: 33.749,
    lng: -84.388,
    accuracy: 12,
    timeClockEntryId: 'tc-1',
    ...over,
  };
}

describe('TechnicianLocationRepository (unit)', () => {
  let client: ReturnType<typeof createMockDynamoDbClient>;
  let repo: TechnicianLocationRepository;

  beforeEach(() => {
    client = createMockDynamoDbClient();
    repo = new TechnicianLocationRepository({ client } as never);
  });

  // The track gets its own partition so a read of USER#<id> — profile,
  // calendar, documents, timesheet — never pages past thousands of GPS rows.
  it('appends to the technician’s own track partition, keyed by instant', async () => {
    client.send.mockResolvedValue({});
    await repo.append(point());

    const item = client.send.mock.calls[0][0].input.Item;
    expect(item.PK).toBe('TRACK#tech-1');
    expect(item.SK).toBe(RECORDED_AT);
    expect(item.lat).toBe(33.749);
    expect(item.timeClockEntryId).toBe('tc-1');
  });

  it('stamps a 30-day TTL in epoch seconds', async () => {
    client.send.mockResolvedValue({});
    await repo.append(point());

    const item = client.send.mock.calls[0][0].input.Item;
    expect(item.expiresAt).toBe(Math.floor(Date.parse(RECORDED_AT) / 1000) + THIRTY_DAYS_S);
  });

  it('queries a day of the trail between its UTC boundaries', async () => {
    client.send.mockResolvedValue({ Items: [] });
    await repo.listInRange('tech-1', '2026-09-17', '2026-09-17');

    const input = client.send.mock.calls[0][0].input;
    expect(input.ExpressionAttributeValues).toEqual({
      ':pk': 'TRACK#tech-1',
      ':lo': '2026-09-17T00:00:00.000Z',
      ':hi': '2026-09-17T23:59:59.999Z',
    });
    expect(input.IndexName).toBeUndefined();
  });

  it('follows pagination — a full shift is more than one page', async () => {
    client.send
      .mockResolvedValueOnce({ Items: [{ ...point(), expiresAt: farFuture() }], LastEvaluatedKey: { PK: 'x' } })
      .mockResolvedValueOnce({
        Items: [{ ...point({ recordedAt: '2026-09-17T08:02:00.000Z' }), expiresAt: farFuture() }],
      });

    const points = await repo.listInRange('tech-1', '2026-09-17', '2026-09-17');

    expect(points).toHaveLength(2);
    expect(client.send).toHaveBeenCalledTimes(2);
  });

  // DynamoDB deletes expired items within ~48h, and TTL may not be switched on
  // at all yet — so the 30-day promise is kept on read as well as on write.
  it('hides points whose TTL has passed, whatever the table has swept', async () => {
    client.send.mockResolvedValue({
      Items: [
        { ...point(), expiresAt: 1 },
        { ...point({ recordedAt: '2026-09-17T08:02:00.000Z' }), expiresAt: farFuture() },
      ],
    });

    const points = await repo.listInRange('tech-1', '2026-09-17', '2026-09-17');

    expect(points.map((p) => p.recordedAt)).toEqual(['2026-09-17T08:02:00.000Z']);
  });

  it('keeps a legacy row that carries no TTL at all', async () => {
    client.send.mockResolvedValue({ Items: [point()] });
    expect(await repo.listInRange('tech-1', '2026-09-17', '2026-09-17')).toHaveLength(1);
  });
});

function farFuture(): number {
  return Math.floor(Date.now() / 1000) + THIRTY_DAYS_S;
}
