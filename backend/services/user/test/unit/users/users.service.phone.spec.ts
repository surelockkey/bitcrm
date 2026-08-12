import { ConflictException } from '@nestjs/common';
import { UsersService } from 'src/users/users.service';

/**
 * The personal-phone index: one number belongs to one person, and telephony
 * resolves call endpoints through it to say "we rang Nazarii's mobile".
 *
 * The service has a wide constructor; these cases only exercise the phone
 * paths, so collaborators are stubbed to just what they touch.
 */
function makeService(over: Partial<Record<string, unknown>> = {}) {
  const repository = {
    findById: jest.fn(),
    findByPhone: jest.fn().mockResolvedValue(null),
    putPhoneIndex: jest.fn().mockResolvedValue(undefined),
    deletePhoneIndex: jest.fn().mockResolvedValue(undefined),
    update: jest.fn(async (id: string, attrs: Record<string, unknown>) => ({
      id,
      ...attrs,
    })),
    ...over,
  };
  const cache = {
    // findById reads through the cache; a miss sends it to the repository.
    getUser: jest.fn().mockResolvedValue(null),
    setUser: jest.fn(),
    invalidateUser: jest.fn(),
  };
  const cognitoAdmin = { updateUserAttributes: jest.fn() };

  const service = new UsersService(
    repository as never,
    cache as never,
    cognitoAdmin as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, repository, cognitoAdmin };
}

const existing = {
  id: 'u1',
  cognitoSub: 'sub-1',
  firstName: 'Nazarii',
  lastName: 'Shparhalo',
  phone: '+14045551234',
};

describe('UsersService — personal phone', () => {
  describe('findManyByPhone', () => {
    it('resolves numbers to their owners, keyed both ways', async () => {
      const { service, repository } = makeService({
        findByPhone: jest.fn().mockResolvedValue(existing),
      });

      const out = await service.findManyByPhone(['(404) 555-1234']);

      expect(repository.findByPhone).toHaveBeenCalledWith('+14045551234');
      expect(out['(404) 555-1234']).toMatchObject({ id: 'u1' });
      expect(out['+14045551234']).toMatchObject({ id: 'u1' });
    });

    it('omits unknown numbers and skips unparseable endpoints', async () => {
      const { service, repository } = makeService();

      const out = await service.findManyByPhone(['client:abc', '+14045551234']);

      expect(repository.findByPhone).toHaveBeenCalledTimes(1);
      expect(out).toEqual({});
    });

    it('asks once per distinct number', async () => {
      const { service, repository } = makeService({
        findByPhone: jest.fn().mockResolvedValue(existing),
      });

      await service.findManyByPhone([
        '+14045551234',
        '(404) 555-1234',
        '+14045551234',
      ]);

      expect(repository.findByPhone).toHaveBeenCalledTimes(1);
    });
  });

  describe('updateOwnPhone', () => {
    it('sets your own number without needing users.edit', async () => {
      const { service, repository } = makeService({
        findById: jest.fn().mockResolvedValue(existing),
      });

      await service.updateOwnPhone('u1', '(541) 283-0739');

      expect(repository.putPhoneIndex).toHaveBeenCalledWith('+15412830739', 'u1');
      expect(repository.deletePhoneIndex).toHaveBeenCalledWith('+14045551234');
      expect(repository.update).toHaveBeenCalledWith('u1', {
        phone: '+15412830739',
      });
    });

    it('clears it on an empty value', async () => {
      const { service, repository } = makeService({
        findById: jest.fn().mockResolvedValue(existing),
      });

      await service.updateOwnPhone('u1', '  ');

      expect(repository.putPhoneIndex).not.toHaveBeenCalled();
      expect(repository.deletePhoneIndex).toHaveBeenCalledWith('+14045551234');
      expect(repository.update).toHaveBeenCalledWith('u1', { phone: undefined });
    });

    it('still refuses a number someone else holds', async () => {
      const { service } = makeService({
        findById: jest.fn().mockResolvedValue(existing),
        findByPhone: jest.fn().mockResolvedValue({
          id: 'u2',
          firstName: 'Tamir',
          lastName: 'Levi',
        }),
      });

      await expect(
        service.updateOwnPhone('u1', '+15412830739'),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('update', () => {
    it('normalizes, indexes, and drops the previous number', async () => {
      const { service, repository } = makeService({
        findById: jest.fn().mockResolvedValue(existing),
      });

      await service.update('u1', { phone: '(541) 283-0739' }, {} as never);

      expect(repository.putPhoneIndex).toHaveBeenCalledWith('+15412830739', 'u1');
      expect(repository.deletePhoneIndex).toHaveBeenCalledWith('+14045551234');
      expect(repository.update).toHaveBeenCalledWith(
        'u1',
        expect.objectContaining({ phone: '+15412830739' }),
      );
    });

    it('refuses a number another user already holds', async () => {
      const { service } = makeService({
        findById: jest.fn().mockResolvedValue(existing),
        findByPhone: jest.fn().mockResolvedValue({
          id: 'u2',
          firstName: 'Tamir',
          lastName: 'Levi',
        }),
      });

      await expect(
        service.update('u1', { phone: '+15412830739' }, {} as never),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('lets a user keep their own number on an unrelated edit', async () => {
      const { service, repository } = makeService({
        findById: jest.fn().mockResolvedValue(existing),
        findByPhone: jest.fn().mockResolvedValue(existing),
      });

      await service.update('u1', { phone: '+14045551234' }, {} as never);

      expect(repository.deletePhoneIndex).not.toHaveBeenCalled();
      expect(repository.putPhoneIndex).toHaveBeenCalledWith('+14045551234', 'u1');
    });

    it('clears the number and its index on an empty string', async () => {
      const { service, repository } = makeService({
        findById: jest.fn().mockResolvedValue(existing),
      });

      await service.update('u1', { phone: '' }, {} as never);

      expect(repository.deletePhoneIndex).toHaveBeenCalledWith('+14045551234');
      expect(repository.update).toHaveBeenCalledWith(
        'u1',
        expect.objectContaining({ phone: undefined }),
      );
    });

    it('leaves the phone alone when the edit doesn\'t mention it', async () => {
      const { service, repository } = makeService({
        findById: jest.fn().mockResolvedValue(existing),
      });

      await service.update('u1', { department: 'Dispatch' }, {} as never);

      expect(repository.putPhoneIndex).not.toHaveBeenCalled();
      expect(repository.deletePhoneIndex).not.toHaveBeenCalled();
    });
  });
});
