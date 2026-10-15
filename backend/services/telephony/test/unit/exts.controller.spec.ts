import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ExtsController } from '../../src/exts/exts.controller';

const DEAL = {
  id: 'deal-1',
  contactId: 'contact-1',
  assignedTechIds: ['tech-1'],
};
const TECH = { id: 'tech-1', roleId: 'role-technician' } as never;

function make(
  over: {
    deal?: unknown;
    phones?: { phones: string[] } | null;
    mayReach?: boolean;
  } = {},
) {
  let n = 0;
  const exts = {
    forDealPhones: jest.fn(async (_dealId: string, count: number) =>
      Array.from({ length: Math.max(1, count) }, (_, phoneIndex) => ({
        code: String(4000 + phoneIndex),
        dealId: 'deal-1',
        phoneIndex,
        status: 'active',
      })),
    ),
    rotate: jest.fn(async (_dealId: string, phoneIndex = 0) => ({
      code: String(9000 + (n += 1)),
      dealId: 'deal-1',
      phoneIndex,
      status: 'active',
    })),
  };
  const bridge = { mayReachDeal: jest.fn(async () => over.mayReach ?? true) };
  const deals = { find: jest.fn(async () => (over.deal === undefined ? DEAL : over.deal)) };
  const contacts = {
    phonesOf: jest.fn(async () =>
      over.phones === undefined ? { phones: ['+14045551234', '+14045555678'] } : over.phones,
    ),
  };
  const controller = new ExtsController(
    exts as never,
    bridge as never,
    deals as never,
    contacts as never,
  );
  return { controller, exts, bridge, contacts };
}

describe('ExtsController.byDeal — a masked number per client number', () => {
  it('answers a code for every number on the job, keeping the first as `code`', async () => {
    const { controller, exts } = make();

    const res = await controller.byDeal('deal-1', TECH);

    expect(exts.forDealPhones).toHaveBeenCalledWith('deal-1', 2);
    expect(res.data).toEqual({
      code: '4000',
      phones: [
        { phoneIndex: 0, code: '4000' },
        { phoneIndex: 1, code: '4001' },
      ],
    });
  });

  /** Never a number in the answer — a masked viewer reads this. */
  it('never answers a phone number', async () => {
    const { controller } = make();

    const res = await controller.byDeal('deal-1', TECH);

    expect(JSON.stringify(res)).not.toMatch(/\+1\d{10}/);
  });

  it('counts the job’s own first number when the client has none', async () => {
    const { controller, exts } = make({
      deal: { ...DEAL, clientPhone: '+12035550123' },
      phones: { phones: [] },
    });

    await controller.byDeal('deal-1', TECH);

    expect(exts.forDealPhones).toHaveBeenCalledWith('deal-1', 1);
  });

  /** An unreadable client must not cost the code the job always had. */
  it('still answers the first number’s code when the client cannot be read', async () => {
    const { controller } = make({ phones: null });

    const res = await controller.byDeal('deal-1', TECH);

    expect(res.data.code).toBe('4000');
    expect(res.data.phones).toHaveLength(1);
  });

  it('refuses somebody who may not call about the job', async () => {
    const { controller, exts } = make({ mayReach: false });

    await expect(controller.byDeal('deal-1', TECH)).rejects.toThrow(ForbiddenException);
    expect(exts.forDealPhones).not.toHaveBeenCalled();
  });

  it('404s an unknown job', async () => {
    const { controller } = make({ deal: null });

    await expect(controller.byDeal('deal-1', TECH)).rejects.toThrow(NotFoundException);
  });
});

describe('ExtsController.rotate', () => {
  it('rotates the number it is asked about', async () => {
    const { controller, exts } = make();

    const res = await controller.rotate('deal-1', TECH, '1');

    expect(exts.rotate).toHaveBeenCalledWith('deal-1', 1);
    expect(res.data).toMatchObject({ phoneIndex: 1 });
  });

  it('rotates the first number when none is named', async () => {
    const { controller, exts } = make();

    await controller.rotate('deal-1', TECH, undefined);

    expect(exts.rotate).toHaveBeenCalledWith('deal-1', 0);
  });

  it('refuses somebody who may not call about the job', async () => {
    const { controller } = make({ mayReach: false });

    await expect(controller.rotate('deal-1', TECH, undefined)).rejects.toThrow(ForbiddenException);
  });
});
