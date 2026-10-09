import { BadRequestException } from '@nestjs/common';
import type { EstimateSettings } from '@bitcrm/types';
import { EstimateSettingsService } from 'src/documents/estimate-settings.service';
import { NOW } from './mocks';

function mockRepo(stored?: Partial<EstimateSettings>) {
  let row: Partial<EstimateSettings> | undefined = stored;
  return {
    getSettings: jest.fn(async () => row),
    putSettings: jest.fn(async (s: EstimateSettings) => {
      row = s;
      return s;
    }),
  };
}

/**
 * Settings → Estimates (Workiz `/root/estimatesSettings`): "Attach PDF files"
 * and "Auto-decline estimates related to the same job". The account has both
 * ON in Workiz, so that is what an account that never saved reads.
 */
describe('EstimateSettingsService', () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(new Date(NOW)));
  afterEach(() => jest.useRealTimers());

  it('reads the account’s Workiz values when nothing was ever saved: both ON', async () => {
    const s = await new EstimateSettingsService(mockRepo() as never).get();
    expect(s).toEqual({ attachPdf: true, autoDeclineSameJob: true });
  });

  it('merges a partial update over what is stored and stamps the author', async () => {
    const repo = mockRepo({ attachPdf: false });
    const saved = await new EstimateSettingsService(repo as never).update({ autoDeclineSameJob: false }, 'u-9');
    expect(saved).toEqual({ attachPdf: false, autoDeclineSameJob: false, updatedBy: 'u-9', updatedAt: NOW });
    expect(repo.putSettings).toHaveBeenCalledTimes(1);
  });

  it('takes only booleans, and refuses an empty update', async () => {
    const service = new EstimateSettingsService(mockRepo() as never);
    await expect(service.update({ attachPdf: 'yes' as unknown as boolean }, 'u')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.update({}, 'u')).rejects.toBeInstanceOf(BadRequestException);
  });
});
