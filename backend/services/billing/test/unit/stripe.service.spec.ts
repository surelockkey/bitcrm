/* eslint-disable @typescript-eslint/no-explicit-any */
import { ServiceUnavailableException } from '@nestjs/common';
import { StripeService } from 'src/payments/stripe/stripe.service';

/** The slice of the Stripe SDK the Terminal methods use — nothing here reaches the network. */
function fakeStripeClient() {
  return {
    terminal: {
      connectionTokens: {
        create: jest.fn(async (_params?: any) => ({ object: 'terminal.connection_token', secret: 'pst_test_123' })),
      },
      locations: {
        create: jest.fn(async (params: any, _opts?: any) => ({ id: 'tml_1', object: 'terminal.location', ...params })),
      },
    },
    paymentIntents: {
      create: jest.fn(async (params: any, _opts?: any) => ({
        id: 'pi_t1',
        object: 'payment_intent',
        client_secret: 'pi_t1_secret_x',
        status: 'requires_payment_method',
        ...params,
      })),
      cancel: jest.fn(async (id: string, _params?: any) => ({ id, object: 'payment_intent', status: 'canceled' })),
      retrieve: jest.fn(async (id: string, _params?: any) => ({ id, object: 'payment_intent', status: 'succeeded' })),
    },
  };
}

const intentInput = {
  amount: 100,
  tipAmount: 15.5,
  currency: 'usd',
  description: 'Invoice K4T9ZW',
  metadata: { paymentId: 'p1', invoiceId: 'deal-1', dealId: 'deal-1', env: 'local' },
  idempotencyKey: 'terminal_p1',
};

describe('StripeService — Stripe Terminal (Tap to Pay)', () => {
  it('mints a connection token — scoped to the Location when there is one', async () => {
    const client = fakeStripeClient();
    const stripe = new StripeService(client as any);
    await expect(stripe.createConnectionToken('tml_1')).resolves.toEqual({ secret: 'pst_test_123' });
    expect(client.terminal.connectionTokens.create).toHaveBeenCalledWith({ location: 'tml_1' });
    await stripe.createConnectionToken();
    expect(client.terminal.connectionTokens.create).toHaveBeenLastCalledWith({});
  });

  it('creates a Terminal Location from an address, under an idempotency key', async () => {
    const client = fakeStripeClient();
    const stripe = new StripeService(client as any);
    const address = { line1: '1 Main St', line2: 'Suite 2', city: 'Hartford', state: 'CT', postal_code: '06103', country: 'US' };
    await expect(
      stripe.createTerminalLocation({ displayName: 'Sure Lock Key', address, idempotencyKey: 'terminal_location_x' }),
    ).resolves.toMatchObject({ id: 'tml_1' });
    expect(client.terminal.locations.create).toHaveBeenCalledWith(
      { display_name: 'Sure Lock Key', address },
      { idempotencyKey: 'terminal_location_x' },
    );
  });

  it('creates a card_present PaymentIntent for amount + tip in cents, captured automatically, with our metadata', async () => {
    const client = fakeStripeClient();
    const stripe = new StripeService(client as any);
    const intent = await stripe.createTerminalIntent(intentInput);
    expect(client.paymentIntents.create).toHaveBeenCalledWith(
      {
        amount: 11_550,
        currency: 'usd',
        payment_method_types: ['card_present'],
        capture_method: 'automatic',
        description: 'Invoice K4T9ZW',
        metadata: { paymentId: 'p1', invoiceId: 'deal-1', dealId: 'deal-1', env: 'local' },
      },
      { idempotencyKey: 'terminal_p1' },
    );
    expect(intent).toMatchObject({ id: 'pi_t1', client_secret: 'pi_t1_secret_x' });
  });

  it('charges the service fee with the amount and the tip — all of it in cents', async () => {
    const client = fakeStripeClient();
    const stripe = new StripeService(client as any);
    await stripe.createTerminalIntent({ ...intentInput, feeAmount: 3.47 });
    expect(client.paymentIntents.create).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 11_897, payment_method_types: ['card_present'] }),
      { idempotencyKey: 'terminal_p1' },
    );
  });

  it('refuses an intent Stripe returned without a client secret — the phone could not collect it', async () => {
    const client = fakeStripeClient();
    client.paymentIntents.create.mockResolvedValueOnce({ id: 'pi_t1', object: 'payment_intent', client_secret: null } as any);
    const stripe = new StripeService(client as any);
    await expect(stripe.createTerminalIntent(intentInput)).rejects.toThrow(ServiceUnavailableException);
  });

  it('cancels an intent, saying why', async () => {
    const client = fakeStripeClient();
    const stripe = new StripeService(client as any);
    await expect(stripe.cancelPaymentIntent('pi_t1', 'requested_by_customer')).resolves.toMatchObject({ status: 'canceled' });
    expect(client.paymentIntents.cancel).toHaveBeenCalledWith('pi_t1', { cancellation_reason: 'requested_by_customer' });
  });

  it('reads an intent with its latest charge expanded when asked (the card that paid), and as before otherwise', async () => {
    const client = fakeStripeClient();
    const stripe = new StripeService(client as any);
    await stripe.retrievePaymentIntent('pi_t1', { expandCharge: true });
    expect(client.paymentIntents.retrieve).toHaveBeenCalledWith('pi_t1', { expand: ['latest_charge'] });
    await stripe.retrievePaymentIntent('pi_t1');
    expect(client.paymentIntents.retrieve).toHaveBeenLastCalledWith('pi_t1');
  });

  it('answers 503 for every Terminal call when Stripe is not configured', async () => {
    const stripe = new StripeService(null);
    await expect(stripe.createConnectionToken()).rejects.toThrow(ServiceUnavailableException);
    await expect(
      stripe.createTerminalLocation({
        displayName: 'x',
        address: { line1: 'a', city: 'b', state: 'CT', postal_code: '06103', country: 'US' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(ServiceUnavailableException);
    await expect(stripe.createTerminalIntent(intentInput)).rejects.toThrow(ServiceUnavailableException);
    await expect(stripe.cancelPaymentIntent('pi_t1', 'abandoned')).rejects.toThrow(ServiceUnavailableException);
  });
});

describe('StripeService — a card typed in on the phone (keyed, card-not-present)', () => {
  const keyedInput = {
    amount: 100,
    tipAmount: 15,
    feeAmount: 3.45,
    currency: 'usd',
    paymentMethodId: 'pm_1Abc',
    description: 'Invoice K4T9ZW',
    metadata: { paymentId: 'p1', invoiceId: 'deal-1', dealId: 'deal-1', contactId: 'contact-1', channel: 'keyed', env: 'local' },
    idempotencyKey: 'keyed_p1',
  };

  it('creates AND confirms a `card` PaymentIntent with the phone’s PaymentMethod, for amount + tip + fee in cents', async () => {
    const client = fakeStripeClient();
    client.paymentIntents.create.mockResolvedValueOnce({
      id: 'pi_k1',
      object: 'payment_intent',
      client_secret: 'pi_k1_secret_x',
      status: 'succeeded',
    } as any);
    const stripe = new StripeService(client as any);
    const intent = await stripe.createKeyedIntent(keyedInput);
    expect(client.paymentIntents.create).toHaveBeenCalledWith(
      {
        amount: 11_845,
        currency: 'usd',
        payment_method: 'pm_1Abc',
        payment_method_types: ['card'],
        confirm: true,
        capture_method: 'automatic',
        use_stripe_sdk: true,
        description: 'Invoice K4T9ZW',
        metadata: { paymentId: 'p1', invoiceId: 'deal-1', dealId: 'deal-1', contactId: 'contact-1', channel: 'keyed', env: 'local' },
        // The card that paid comes back with it — brand and last 4 land with the settlement.
        expand: ['latest_charge'],
      },
      { idempotencyKey: 'keyed_p1' },
    );
    expect(intent).toMatchObject({ id: 'pi_k1', status: 'succeeded' });
  });

  it('lets Stripe’s own error through untouched — a decline is the caller’s to read', async () => {
    const client = fakeStripeClient();
    const declined = Object.assign(new Error('Your card was declined.'), { type: 'StripeCardError', rawType: 'card_error', statusCode: 402 });
    client.paymentIntents.create.mockRejectedValueOnce(declined);
    const stripe = new StripeService(client as any);
    await expect(stripe.createKeyedIntent(keyedInput)).rejects.toBe(declined);
  });

  it('answers 503 when Stripe is not configured', async () => {
    await expect(new StripeService(null).createKeyedIntent(keyedInput)).rejects.toThrow(ServiceUnavailableException);
  });
});
