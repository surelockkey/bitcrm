import { ServiceUnavailableException } from '@nestjs/common';
import { EmailCodeSender } from '../../../src/security/email-code.sender';

/**
 * A sign-in code by email, over the SES identity messaging already mails
 * from (`MESSAGING_EMAIL_FROM`). Without that sender there is no email
 * option at all — `available` is what the Security Center's switch and the
 * sign-in gate ask before offering it.
 */
function make(from = 'office@slk.example', configurationSet?: string) {
  const ses = { send: jest.fn(async () => ({ MessageId: 'm-1' })) };
  const sender = new EmailCodeSender({ from, configurationSet }, ses as never);
  return { sender, ses };
}

describe('EmailCodeSender', () => {
  it('is unavailable without a sender address, and says so instead of sending', async () => {
    const { sender, ses } = make('');

    expect(sender.available).toBe(false);
    await expect(sender.send('bob@x.com', '123456')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(ses.send).not.toHaveBeenCalled();
  });

  it('mails the code to the address, from the configured sender, through the configuration set', async () => {
    const { sender, ses } = make('office@slk.example', 'bitcrm-events');

    expect(sender.available).toBe(true);
    await sender.send('bob@x.com', '123456');

    const input = ses.send.mock.calls[0][0].input;
    expect(input.FromEmailAddress).toBe('office@slk.example');
    expect(input.Destination).toEqual({ ToAddresses: ['bob@x.com'] });
    expect(input.ConfigurationSetName).toBe('bitcrm-events');
    expect(input.Content.Simple.Subject.Data).toMatch(/sign-in code/i);
    expect(input.Content.Simple.Body.Text.Data).toContain('123456');
  });

  it('leaves the configuration set out when there is none', async () => {
    const { sender, ses } = make();

    await sender.send('bob@x.com', '654321');

    expect(ses.send.mock.calls[0][0].input.ConfigurationSetName).toBeUndefined();
  });

  it('turns a provider failure into 503, never a silent pass', async () => {
    const { sender, ses } = make();
    ses.send.mockRejectedValueOnce(new Error('MessageRejected'));

    await expect(sender.send('bob@x.com', '123456')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
