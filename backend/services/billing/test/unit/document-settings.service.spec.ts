import { BadRequestException } from '@nestjs/common';
import { DEFAULT_DOCUMENT_NOTES, type DocumentSettings } from '@bitcrm/types';
import { DocumentSettingsService } from 'src/documents/document-settings.service';
import { NOW } from './mocks';

function mockRepo(stored?: Partial<DocumentSettings>) {
  let row: Partial<DocumentSettings> | undefined = stored;
  return {
    getSettings: jest.fn(async () => row),
    putSettings: jest.fn(async (s: DocumentSettings) => {
      row = s;
      return s;
    }),
  };
}

describe('DocumentSettingsService', () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(new Date(NOW)));
  afterEach(() => jest.useRealTimers());

  it('reads Workiz defaults when nothing was ever saved', async () => {
    const service = new DocumentSettingsService(mockRepo() as never);
    const s = await service.get();
    expect(s.estimateNotes).toBe(DEFAULT_DOCUMENT_NOTES);
    expect(s.invoiceNotes).toBe(DEFAULT_DOCUMENT_NOTES);
    expect(s.requestInvoiceSignature).toBe(true);
    expect(s.depositPercentage).toBeUndefined();
    expect(s.depositAmount).toBeUndefined();
  });

  it('ships Workiz’s default send messages per document, with short codes', async () => {
    const s = await new DocumentSettingsService(mockRepo() as never).get();
    expect(s.invoiceEmailSubject).toBe('Your invoice from {{business.name}}');
    expect(s.invoiceMessage).toContain('{{client.firstName}}');
    expect(s.invoiceMessage).toContain('{{portal_link}}');
    expect(s.estimateEmailSubject).toBe('Your estimate from {{business.name}}');
    expect(s.proposalEmailSubject).toBe('View your proposal from {{business.name}}');
    expect(s.proposalMessage).toContain('{{portal_link}}');
  });

  it('a send message must keep the portal link', async () => {
    const service = new DocumentSettingsService(mockRepo() as never);
    await expect(service.update({ invoiceMessage: 'Hi, pay me' }, 'u-1')).rejects.toBeInstanceOf(BadRequestException);
    const ok = await service.update({ invoiceMessage: 'Hi {{client.firstName}}, see {{portal_link}}' }, 'u-1');
    expect(ok.invoiceMessage).toBe('Hi {{client.firstName}}, see {{portal_link}}');
  });

  it('merges a partial update over what is stored and stamps the author', async () => {
    const repo = mockRepo({ estimateNotes: 'Old' });
    const service = new DocumentSettingsService(repo as never);
    const saved = await service.update({ invoiceNotes: 'Thanks!' }, 'u-9');
    expect(saved.estimateNotes).toBe('Old');
    expect(saved.invoiceNotes).toBe('Thanks!');
    expect(saved.updatedBy).toBe('u-9');
    expect(saved.updatedAt).toBe(NOW);
    expect(repo.putSettings).toHaveBeenCalledTimes(1);
  });

  it('keeps ONE default deposit: setting a percent clears a stored amount and vice versa', async () => {
    const service = new DocumentSettingsService(mockRepo({ depositAmount: 75 }) as never);
    const pct = await service.update({ depositPercentage: 50 }, 'u-1');
    expect(pct.depositPercentage).toBe(50);
    expect(pct.depositAmount).toBeUndefined();
    const amt = await service.update({ depositAmount: 100 }, 'u-1');
    expect(amt.depositAmount).toBe(100);
    expect(amt.depositPercentage).toBeUndefined();
  });

  it('null clears the default deposit', async () => {
    const service = new DocumentSettingsService(mockRepo({ depositPercentage: 50 }) as never);
    const s = await service.update({ depositPercentage: null }, 'u-1');
    expect(s.depositPercentage).toBeUndefined();
    expect(s.depositAmount).toBeUndefined();
  });

  it('refuses a percent outside 0–100, a negative amount, or both at once', async () => {
    const service = new DocumentSettingsService(mockRepo() as never);
    await expect(service.update({ depositPercentage: 101 }, 'u-1')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.update({ depositAmount: -1 }, 'u-1')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.update({ depositPercentage: 10, depositAmount: 10 }, 'u-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('refuses notes over the document limit', async () => {
    const service = new DocumentSettingsService(mockRepo() as never);
    await expect(service.update({ estimateNotes: 'x'.repeat(5001) }, 'u-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('an empty string means "no default notes"', async () => {
    const service = new DocumentSettingsService(mockRepo() as never);
    const s = await service.update({ estimateNotes: '   ' }, 'u-1');
    expect(s.estimateNotes).toBe('');
  });
});
