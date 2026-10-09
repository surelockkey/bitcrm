import { CommissionReportClient } from 'src/commission-report/commission-report.client';

describe('CommissionReportClient.userNames', () => {
  it('names a technician as Workiz does — the imported Workiz name first, else first and last', async () => {
    const client = new CommissionReportClient();
    const post = jest.fn().mockResolvedValue({
      data: {
        data: [
          { id: 'u1', firstName: 'Ricky', lastName: 'Sledge', workizName: '(2) TX - Ricky Sledge' },
          { id: 'u2', firstName: 'Tom', lastName: 'Tech' },
          { id: 'u3', firstName: 'Ann', lastName: 'Lee', workizName: '  ' },
        ],
      },
    });
    (client as unknown as { user: { post: jest.Mock } }).user = { post };
    const names = await client.userNames(['u1', 'u2', 'u3']);
    expect(post).toHaveBeenCalledWith('/api/users/internal/names-by-ids', { userIds: ['u1', 'u2', 'u3'] });
    expect([...names.entries()]).toEqual([
      ['u1', '(2) TX - Ricky Sledge'],
      ['u2', 'Tom Tech'],
      ['u3', 'Ann Lee'],
    ]);
  });
});
