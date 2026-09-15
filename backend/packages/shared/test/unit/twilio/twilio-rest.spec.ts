import { HttpException } from '@nestjs/common';
import { type Twilio } from 'twilio';
import {
  TwilioRest,
  toTwilioHttpException,
} from '../../../src/twilio/twilio-rest';

const CREDENTIALS = {
  accountSid: 'AC00000000000000000000000000000000',
  authToken: 'the-auth-token',
};

function makeRest() {
  const client = { calls: { create: jest.fn() } } as unknown as Twilio;
  const factory = jest.fn().mockReturnValue(client);
  const rest = new TwilioRest(CREDENTIALS, factory);
  return { rest, client, factory };
}

describe('TwilioRest', () => {
  it('builds the client lazily, once, from the credentials', () => {
    const { rest, client, factory } = makeRest();
    expect(factory).not.toHaveBeenCalled();

    expect(rest.client).toBe(client);
    expect(rest.client).toBe(client);

    expect(factory).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledWith(
      CREDENTIALS.accountSid,
      CREDENTIALS.authToken,
    );
  });

  it('hands the client to the callback and returns its result', async () => {
    const { rest, client } = makeRest();
    const result = await rest.run(async (c) => {
      expect(c).toBe(client);
      return { sid: 'CA1' };
    });
    expect(result).toEqual({ sid: 'CA1' });
  });

  it('surfaces the Twilio status and reason instead of a generic 500', async () => {
    const { rest } = makeRest();
    const twilioError = Object.assign(
      new Error('Trial accounts are allowed only one Twilio number'),
      { status: 400, code: 21404 },
    );

    const failure = rest.run(async () => {
      throw twilioError;
    });

    await expect(failure).rejects.toBeInstanceOf(HttpException);
    await expect(failure).rejects.toMatchObject({
      message: 'Trial accounts are allowed only one Twilio number',
    });
    await failure.catch((e: HttpException) => expect(e.getStatus()).toBe(400));
  });

  it('reports a failure with no usable status as a 502 upstream error', async () => {
    const { rest } = makeRest();

    const failure = rest.run(async () => {
      throw new Error('socket hang up');
    });

    await failure.catch((e: HttpException) => {
      expect(e.getStatus()).toBe(502);
      expect(e.message).toBe('socket hang up');
    });
  });

  it('defaults to the real SDK factory when none is given', () => {
    const rest = new TwilioRest(CREDENTIALS);
    // The SDK validates the sid shape when the client is built; a client for a
    // well-formed sid must come back without touching the network.
    expect(rest.client.accountSid).toBe(CREDENTIALS.accountSid);
  });
});

describe('toTwilioHttpException', () => {
  it.each([
    [{ status: 404, message: 'not found' }, 404, 'not found'],
    [{ status: 429, message: 'throttled' }, 429, 'throttled'],
    [{ status: 200, message: 'odd' }, 502, 'odd'],
    [{ status: 'bad' }, 502, 'Twilio request failed'],
    [null, 502, 'Twilio request failed'],
  ])('maps %p to HTTP %i', (input, status, message) => {
    const e = toTwilioHttpException(input);
    expect(e.getStatus()).toBe(status);
    expect(e.message).toBe(message);
  });
});
