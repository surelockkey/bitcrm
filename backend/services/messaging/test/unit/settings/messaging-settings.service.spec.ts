import { BadRequestException } from '@nestjs/common';
import {
  DEFAULT_MESSAGING_SETTINGS,
  MessagingSettingsService,
} from '../../../src/settings/messaging-settings.service';
import { T1 } from '../mocks';

function makeService(stored: Record<string, unknown> | null = null) {
  let doc = stored;
  const repo = {
    get: jest.fn(async () => doc),
    put: jest.fn(async (settings, updatedBy: string) => {
      doc = { ...settings, updatedAt: T1, updatedBy };
      return doc;
    }),
  };
  return { service: new MessagingSettingsService(repo as any), repo };
}

const caller = { id: 'u1' };

describe('MessagingSettingsService', () => {
  it('answers the defaults until first saved', async () => {
    const { service } = makeService();
    expect(await service.get()).toEqual(DEFAULT_MESSAGING_SETTINGS);
    expect(DEFAULT_MESSAGING_SETTINGS.timezone).toBe('America/New_York');
    expect(DEFAULT_MESSAGING_SETTINGS.stopReplyText).toMatch(/START/);
    expect(DEFAULT_MESSAGING_SETTINGS.helpReplyText).toMatch(/STOP/);
  });

  it('lays the stored document over the defaults', async () => {
    const { service } = makeService({ smsFormat: 'New job #{{job_id}}', stopReplyText: 'Bye.', updatedAt: T1 });
    expect(await service.get()).toEqual({
      ...DEFAULT_MESSAGING_SETTINGS,
      smsFormat: 'New job #{{job_id}}',
      stopReplyText: 'Bye.',
      updatedAt: T1,
    });
  });

  it('merges the update over what is stored and stamps the caller', async () => {
    const { service, repo } = makeService({ smsPre: 'SLK: ', sndFwd: ['+15550001111'] });
    const saved = await service.update(
      {
        defaultSenderNumber: '+12034036303',
        quietHours: { from: '20:00', to: '08:00', timezone: 'America/New_York' },
        confirmLinkBaseUrl: 'https://book.example.com/confirm',
        helpReplyText: 'Sure Lock & Key: reply STOP to unsubscribe, call (203) 403-6303 for help.',
        companyName: 'Sure Lock & Key',
      },
      caller,
    );
    expect(repo.put).toHaveBeenCalledWith(
      {
        smsPre: 'SLK: ',
        sndFwd: ['+15550001111'],
        defaultSenderNumber: '+12034036303',
        quietHours: { from: '20:00', to: '08:00', timezone: 'America/New_York' },
        confirmLinkBaseUrl: 'https://book.example.com/confirm',
        helpReplyText: 'Sure Lock & Key: reply STOP to unsubscribe, call (203) 403-6303 for help.',
        companyName: 'Sure Lock & Key',
      },
      'u1',
    );
    expect(saved).toMatchObject({ smsPre: 'SLK: ', companyName: 'Sure Lock & Key', updatedAt: T1, updatedBy: 'u1' });
    expect(saved.timezone).toBe('America/New_York'); // default still shown
  });

  it('clears a text field with an empty string and leaves untouched fields alone', async () => {
    const { service, repo } = makeService({ smsPre: 'SLK: ', signature: '- SLK', companyEmail: 'a@b.co' });
    await service.update({ signature: '', companyEmail: 'office@b.co' }, caller);
    expect(repo.put.mock.calls[0][0]).toEqual({ smsPre: 'SLK: ', companyEmail: 'office@b.co' });
  });

  it('rejects unknown timezones for the company default and the quiet hours', async () => {
    const { service, repo } = makeService();
    await expect(service.update({ timezone: 'Mars/Olympus' }, caller)).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.update({ quietHours: { from: '20:00', to: '08:00', timezone: 'Nowhere' } }, caller),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.put).not.toHaveBeenCalled();
    await service.update({ timezone: 'Europe/Kyiv' }, caller);
    expect(repo.put).toHaveBeenCalledTimes(1);
  });

  it('keeps the Workiz fields verbatim so the account_sms_settings import is a straight copy', async () => {
    const { service, repo } = makeService();
    const workiz = {
      defaultSenderNumber: '+12034036303',
      sndFwd: [],
      smsFormat: 'New job #{{job_id}}\n{{full_name}}   \n\n\n{{phone_number}}\n\n\n{{full_address}}\n\n \n{{job_type}} \nNotes: {{description}}',
      useCloseLink: false,
      onMyWayMsg: 'Hi {{first_name}}, \nThis is {{tech_assigned}} from Sure Lock and Key LLC. \nJust letting you know I’m on the way!',
      lateMsg: 'Hi {{first_name}}, I will be {{late_value}} minutes late.',
      lateMsgNotify: true,
      onMyWayMsgNotify: true,
    };
    await service.update(workiz, caller);
    expect(repo.put.mock.calls[0][0]).toEqual(workiz);
  });
});
