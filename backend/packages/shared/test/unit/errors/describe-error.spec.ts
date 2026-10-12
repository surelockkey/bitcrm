import { describeError } from '../../../src/errors/describe-error';

/** An AWS SDK v3 error: the SDK sets `name` to the service's exception type. */
const aws = (name: string, message: string) =>
  Object.assign(new Error(message), { name, $metadata: { httpStatusCode: 400 } });

describe('describeError — a real reason instead of "Internal server error"', () => {
  describe('Cognito', () => {
    it.each([
      ['UserNotFoundException', 'User does not exist.', 404, /no sign-in account/i],
      ['UnsupportedUserStateException', 'Resend not possible.', 409, /already accepted|current state/i],
      ['UsernameExistsException', 'An account with the given email already exists.', 409, /already exists/i],
      ['NotAuthorizedException', 'User password cannot be reset in the current state.', 400, /cannot be reset in the current state/i],
      ['InvalidPasswordException', 'Password did not conform with policy: Password must have symbol characters', 400, /must have symbol/i],
      ['CodeMismatchException', 'Invalid verification code provided, please try again.', 400, /invalid verification code/i],
      ['LimitExceededException', 'Attempt limit exceeded, please try after some time.', 429, /try (again )?after some time|too many/i],
      ['TooManyRequestsException', 'Too many requests', 429, /too many/i],
      ['CodeDeliveryFailureException', 'Unable to deliver message', 502, /could not (be )?sen[dt]|deliver/i],
    ])('%s → %i', (name, message, status, reason) => {
      const out = describeError(aws(name, message));
      expect(out.status).toBe(status);
      expect(out.message).toMatch(reason);
    });
  });

  describe('DynamoDB', () => {
    it('a failed condition is a conflict: someone changed it first', () => {
      const out = describeError(aws('ConditionalCheckFailedException', 'The conditional request failed'));
      expect(out.status).toBe(409);
      expect(out.message).toMatch(/changed|no longer exists/i);
      expect(out.message).toMatch(/reload/i);
    });

    it('a cancelled transaction is a conflict too', () => {
      expect(describeError(aws('TransactionCanceledException', 'Transaction cancelled')).status).toBe(409);
    });

    it.each(['ProvisionedThroughputExceededException', 'ThrottlingException', 'RequestLimitExceeded'])(
      '%s is "busy, try again"',
      (name) => {
        const out = describeError(aws(name, 'Rate exceeded'));
        expect(out.status).toBe(503);
        expect(out.message).toMatch(/try again/i);
      },
    );
  });

  describe('calls to another BitCRM service (axios)', () => {
    const axiosError = (status: number | undefined, data: unknown, code?: string) =>
      Object.assign(new Error(`Request failed with status code ${status}`), {
        isAxiosError: true,
        code,
        config: { baseURL: 'http://crm.bitcrm.local:4002', url: '/api/crm/contacts/internal/c1' },
        response: status === undefined ? undefined : { status, data },
      });

    it('passes the other service\'s own 4xx answer through', () => {
      const out = describeError(
        axiosError(404, { success: false, error: { code: 'NOT_FOUND', message: 'Contact c1 not found' } }),
      );
      expect(out).toMatchObject({ status: 404, message: 'Contact c1 not found' });
    });

    it('names the other service\'s failure as a bad gateway, with its reason', () => {
      const out = describeError(
        axiosError(500, { success: false, error: { code: 'X', message: 'UserNotFoundException: User does not exist.' } }),
      );
      expect(out.status).toBe(502);
      expect(out.message).toMatch(/User does not exist/);
    });

    it('says which service did not answer', () => {
      const out = describeError(axiosError(undefined, undefined, 'ECONNREFUSED'));
      expect(out.status).toBe(503);
      expect(out.message).toMatch(/crm/i);
      expect(out.message).toMatch(/ECONNREFUSED|not responding/i);
    });
  });

  it('a Stripe card error keeps Stripe\'s words', () => {
    const err = Object.assign(new Error('Your card was declined.'), {
      type: 'StripeCardError',
      statusCode: 402,
    });
    expect(describeError(err)).toMatchObject({ status: 402, message: 'Your card was declined.' });
  });

  it('any other Stripe failure is a bad gateway naming Stripe', () => {
    const err = Object.assign(new Error('Invalid API Key provided'), {
      type: 'StripeAuthenticationError',
      statusCode: 401,
    });
    const out = describeError(err);
    expect(out.status).toBe(502);
    expect(out.message).toMatch(/Stripe: Invalid API Key provided/);
  });

  it('a Twilio refusal keeps Twilio\'s words', () => {
    const err = Object.assign(new Error("The 'To' number +1555 is not a valid phone number."), {
      status: 400,
      code: 21211,
      moreInfo: 'https://www.twilio.com/docs/errors/21211',
    });
    const out = describeError(err);
    expect(out.status).toBe(400);
    expect(out.message).toMatch(/Twilio: The 'To' number \+1555 is not a valid phone number/);
  });

  it('a network failure says it could not reach the address', () => {
    const err = Object.assign(new Error('connect ETIMEDOUT 10.0.0.1:443'), { code: 'ETIMEDOUT' });
    const out = describeError(err);
    expect(out.status).toBe(503);
    expect(out.message).toMatch(/ETIMEDOUT/);
  });

  it('anything else still says what went wrong', () => {
    const out = describeError(new TypeError("Cannot read properties of undefined (reading 'id')"));
    expect(out.status).toBe(500);
    expect(out.message).toMatch(/TypeError: Cannot read properties of undefined \(reading 'id'\)/);
  });

  it('a thrown non-Error is shown as it is', () => {
    expect(describeError('boom').message).toMatch(/boom/);
  });

  it('never returns an empty reason', () => {
    expect(describeError(new Error('')).message).not.toBe('');
    expect(describeError(undefined).message).not.toBe('');
  });
});
