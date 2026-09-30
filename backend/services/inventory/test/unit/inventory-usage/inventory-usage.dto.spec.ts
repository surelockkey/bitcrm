import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UsageJobDto } from 'src/inventory-usage/dto/usage-job.dto';
import { DeductStockDto } from 'src/transfers/dto/deduct-stock.dto';
import { RestoreStockDto } from 'src/transfers/dto/restore-stock.dto';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const errorsFor = async (cls: any, payload: unknown) =>
  (await validate(plainToInstance(cls, payload), { whitelist: true, forbidNonWhitelisted: true })).map(
    (e) => e.property,
  );

const job = {
  dealNumber: 'K4T9ZW',
  scheduledDate: '2026-09-10',
  clientName: 'Kristie Spegal',
  contactId: 'contact-1',
  techIds: ['tech-1', 'tech-2'],
  techNames: ['Dave Tech', 'Eli Tech'],
};

/** Знімок роботи, який deal-service шле зі списанням і при зміні роботи. */
describe('UsageJobDto', () => {
  it('accepts the full snapshot, and just the job number', async () => {
    expect(await errorsFor(UsageJobDto, job)).toEqual([]);
    expect(await errorsFor(UsageJobDto, { dealNumber: 'K4T9ZW' })).toEqual([]);
  });

  it('requires the job number and a YYYY-MM-DD date', async () => {
    expect(await errorsFor(UsageJobDto, { scheduledDate: '2026-09-10' })).toEqual(['dealNumber']);
    expect(await errorsFor(UsageJobDto, { dealNumber: 'X', scheduledDate: '09/10/2026' })).toEqual(['scheduledDate']);
    expect(await errorsFor(UsageJobDto, { dealNumber: 'X', scheduledDate: '2026-09-10T10:00:00Z' })).toEqual([
      'scheduledDate',
    ]);
  });

  it('takes technicians as lists of strings', async () => {
    expect(await errorsFor(UsageJobDto, { dealNumber: 'X', techIds: 'tech-1' })).toEqual(['techIds']);
    expect(await errorsFor(UsageJobDto, { dealNumber: 'X', techNames: [1] })).toEqual(['techNames']);
  });
});

/**
 * Старі виклики (без `job`, без цін рядка) лишаються дійсними; нові несуть
 * знімок роботи й ціну/собівартість рядка роботи.
 */
describe.each([
  ['DeductStockDto', DeductStockDto],
  ['RestoreStockDto', RestoreStockDto],
])('%s', (_name, cls) => {
  const base = {
    containerId: 'tech-1',
    items: [{ productId: 'prod-1', productName: 'Deadbolt', quantity: 2 }],
    dealId: 'deal-1',
    performedBy: 'user-1',
    performedByName: 'user@test.com',
  };

  it('still accepts a call without the job', async () => {
    expect(await errorsFor(cls, base)).toEqual([]);
  });

  it('accepts the job snapshot and the line price and cost', async () => {
    expect(
      await errorsFor(cls, {
        ...base,
        items: [{ ...base.items[0], unitPrice: 95.89, unitCost: 12.5 }],
        job,
      }),
    ).toEqual([]);
  });

  it('validates the nested job and the line values', async () => {
    expect(await errorsFor(cls, { ...base, job: { scheduledDate: 'soon' } })).toEqual(['job']);
    expect(await errorsFor(cls, { ...base, items: [{ ...base.items[0], unitPrice: -1 }] })).toEqual(['items']);
  });
});
