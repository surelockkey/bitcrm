import { Share } from 'react-native';
import { jobShareText, shareJob } from './share';
import { JobSuperStatus, type Deal } from './types';

const deal = (over: Partial<Deal> = {}): Deal => ({
  id: 'd1',
  dealNumber: 'K4T9ZW',
  contactId: 'c1',
  address: { street: '1 Main St', city: 'Hartford', state: 'CT', zip: '06103' },
  superStatus: JobSuperStatus.SUBMITTED,
  scheduledDate: '2026-09-18',
  scheduledTimeSlot: '09:00-12:00',
  clientName: { firstName: 'Ada', lastName: 'Byron' },
  assignedTechIds: ['t1'],
  ...over,
});

describe('jobShareText', () => {
  it('leads with the job the way the header names it', () => {
    expect(jobShareText(deal()).split('\n')[0]).toBe('Job #K4T9ZW');
  });

  it('carries who, where, when and what state — and nothing else', () => {
    expect(jobShareText(deal())).toBe(
      [
        'Job #K4T9ZW',
        'Client: Ada Byron',
        'Address: 1 Main St, Hartford, CT 06103',
        'When: Fri, Sep 18, 9:00 AM – 12:00 PM',
        'Status: Submitted',
      ].join('\n'),
    );
  });

  it('never leaks the client’s number into text leaving the app', () => {
    // This string goes wherever the technician sent it — another app, another
    // person. The contact's phone is on the screen and deliberately not here.
    expect(jobShareText(deal())).not.toMatch(/\d{3}-\d{4}/);
  });

  it('says a job has no date rather than leaving the line off', () => {
    const text = jobShareText(
      deal({ scheduledDate: undefined, scheduledTimeSlot: undefined }),
    );
    expect(text).toContain('When: Not scheduled yet');
  });

  it('drops the lines a job genuinely has nothing for', () => {
    const text = jobShareText(
      deal({ clientName: undefined, address: {} as Deal['address'] }),
    );
    expect(text).not.toContain('Client:');
    expect(text).not.toContain('Address:');
    expect(text).toContain('Job #K4T9ZW');
  });
});

describe('shareJob', () => {
  it('reports back whether the job actually went anywhere', async () => {
    const share = jest
      .spyOn(Share, 'share')
      .mockResolvedValue({ action: Share.sharedAction } as never);
    await expect(shareJob(deal())).resolves.toBe(true);

    share.mockResolvedValue({ action: Share.dismissedAction } as never);
    await expect(shareJob(deal())).resolves.toBe(false);
    share.mockRestore();
  });

  it('is a no-op rather than a crash when the OS refuses the sheet', async () => {
    const share = jest
      .spyOn(Share, 'share')
      .mockRejectedValue(new Error('no activity found'));
    await expect(shareJob(deal())).resolves.toBe(false);
    share.mockRestore();
  });
});
