import type { Invoice, InvoiceItem } from '@bitcrm/types';
import { InvoicesRepository } from 'src/invoices/invoices.repository';
import { ACCOUNT_COUNTERS_PK, COUNTERS_SK } from 'src/common/constants/dynamo.constants';
import { NOW } from './mocks';

/** A DynamoDB client that records every command and answers what the test says. */
function fakeDb(answer: (cmd: { input: Record<string, unknown> }) => unknown = () => ({})) {
  const sent: Array<{ name: string; input: Record<string, unknown> }> = [];
  return {
    sent,
    client: {
      send: jest.fn(async (cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
        sent.push({ name: cmd.constructor.name, input: cmd.input });
        return answer(cmd);
      }),
    },
  };
}

const invoice = (over: Partial<Invoice> = {}): Invoice =>
  ({
    id: 'inv-1',
    number: '1001',
    contactId: 'contact-1',
    invoiceDate: '2026-09-16',
    paymentTerms: 'cash',
    dueDate: '2026-09-16',
    status: 'no_amount',
    totals: { total: 0, balanceDue: 0 } as never,
    version: 1,
    createdBy: 'u-1',
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  }) as Invoice;

describe('InvoicesRepository — client invoices', () => {
  it('stores a client invoice under its own id with the list + contact keys and no dealId', async () => {
    const db = fakeDb();
    await new InvoicesRepository(db as never).create(invoice());
    expect(db.sent[0]!.input.Item).toMatchObject({
      PK: 'INVOICE#inv-1',
      SK: 'METADATA',
      GSI1PK: 'INVOICES',
      GSI2PK: 'CONTACT#contact-1',
      GSI2SK: `INVOICE#${NOW}#inv-1`,
    });
    expect(db.sent[0]!.input.Item).not.toHaveProperty('dealId');
  });

  it('keeps its lines as ITEM# rows in the invoice partition, apart from the PAYMENT# rows', async () => {
    const db = fakeDb(() => ({
      Items: [
        { PK: 'INVOICE#inv-1', SK: 'ITEM#l2', lineId: 'l2', invoiceId: 'inv-1', position: 1, createdAt: NOW },
        { PK: 'INVOICE#inv-1', SK: 'ITEM#l1', lineId: 'l1', invoiceId: 'inv-1', position: 0, createdAt: NOW },
      ],
    }));
    const repo = new InvoicesRepository(db as never);
    const item: InvoiceItem = {
      lineId: 'l1',
      invoiceId: 'inv-1',
      position: 0,
      productId: 'p',
      name: 'Lock',
      sku: 'L',
      quantity: 1,
      priceClient: 10,
      costCompany: 0,
      costForTech: 0,
      taxable: true,
      createdAt: NOW,
      updatedAt: NOW,
    };
    await repo.putItem(item);
    expect(db.sent[0]!.input.Item).toMatchObject({ PK: 'INVOICE#inv-1', SK: 'ITEM#l1', entityType: 'invoice_item' });

    const items = await repo.getItems('inv-1');
    expect(db.sent[1]!.input).toMatchObject({
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': 'INVOICE#inv-1', ':sk': 'ITEM#' },
    });
    expect(items.map((i) => i.lineId)).toEqual(['l1', 'l2']);
    expect(items[0]).not.toHaveProperty('PK');

    await repo.deleteItem('inv-1', 'l1');
    expect(db.sent[2]!.input).toMatchObject({ Key: { PK: 'INVOICE#inv-1', SK: 'ITEM#l1' } });
  });

  it('takes stub numbers from the same account counter as client estimates', async () => {
    const db = fakeDb(() => ({ Attributes: { documentSeq: 7 } }));
    await expect(new InvoicesRepository(db as never).nextAccountSeq()).resolves.toBe(7);
    expect(db.sent[0]!.input).toMatchObject({
      Key: { PK: ACCOUNT_COUNTERS_PK, SK: COUNTERS_SK },
      UpdateExpression: 'ADD documentSeq :one',
    });
  });
});
