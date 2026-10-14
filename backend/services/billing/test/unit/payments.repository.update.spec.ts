/* eslint-disable @typescript-eslint/no-explicit-any */
import { PaymentsRepository, PaymentVersionConflictError } from 'src/payments/payments.repository';
import { payment } from './payment-mocks';

/**
 * `update` writes both copies of a payment in one transaction. When only the
 * copy under the job is missing, that is not a version conflict: the copy is
 * put back from the canonical row and the write retried once. Payment
 * fccf6b59 was retried every 15 minutes for a week because this was reported
 * as "Payment version conflict".
 */
const cancelled = (reasons: Array<{ Code: string }>) =>
  Object.assign(new Error('Transaction cancelled'), { name: 'TransactionCanceledException', CancellationReasons: reasons });

const commandName = (call: any[]) => call[0].constructor.name;

describe('PaymentsRepository.update', () => {
  const p = payment({ id: 'pay-1', invoiceId: 'deal-1', version: 2, status: 'pending' });

  it('restores a missing job copy and retries the write once', async () => {
    let transactions = 0;
    const send = jest.fn(async (cmd: any) => {
      const name = cmd.constructor.name;
      if (name === 'TransactWriteCommand') {
        transactions++;
        if (transactions === 1) throw cancelled([{ Code: 'None' }, { Code: 'ConditionalCheckFailed' }]);
        return {};
      }
      if (name === 'GetCommand') return { Item: { PK: 'PAYMENT#pay-1', SK: 'METADATA', ...p } };
      return {};
    });
    const repo = new PaymentsRepository({ client: { send } } as any);

    const fresh = await repo.update(p, { status: 'failed' }, [], { expectedVersion: 2 });

    expect(fresh.id).toBe('pay-1');
    expect(transactions).toBe(2);
    const put = send.mock.calls.find((c) => commandName(c) === 'PutCommand')![0].input;
    expect(put.Item).toMatchObject({ PK: 'INVOICE#deal-1', id: 'pay-1', entityType: 'payment' });
    expect(put.Item.SK).toMatch(/^PAYMENT#.*#pay-1$/);
    expect(put.Item.GSI1PK).toBeUndefined();
    expect(put.ConditionExpression).toBe('attribute_not_exists(PK)');
  });

  it('is still a version conflict when the canonical row refused', async () => {
    const send = jest.fn(async (cmd: any) => {
      if (cmd.constructor.name === 'TransactWriteCommand') {
        throw cancelled([{ Code: 'ConditionalCheckFailed' }, { Code: 'None' }]);
      }
      return {};
    });
    const repo = new PaymentsRepository({ client: { send } } as any);
    await expect(repo.update(p, { status: 'failed' }, [], { expectedVersion: 2 })).rejects.toBeInstanceOf(
      PaymentVersionConflictError,
    );
    expect(send.mock.calls.some((c) => commandName(c) === 'PutCommand')).toBe(false);
  });
});
