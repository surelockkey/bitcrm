import { Test, TestingModule } from '@nestjs/testing';
import { DynamoDbService } from '@bitcrm/shared';
import { ContainersRepository } from 'src/containers/containers.repository';
import { createMockContainer, createMockDynamoDbService } from '../mocks';

describe('ContainersRepository', () => {
  let repository: ContainersRepository;
  let dynamoDb: ReturnType<typeof createMockDynamoDbService>;

  beforeEach(async () => {
    dynamoDb = createMockDynamoDbService();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContainersRepository,
        { provide: DynamoDbService, useValue: dynamoDb },
      ],
    }).compile();

    repository = module.get<ContainersRepository>(ContainersRepository);
  });

  /**
   * `toContainer` maps DynamoDB items field by field, so a field that is written
   * but not listed there round-trips to nothing. Guarding the van explicitly —
   * this exact whitelist trap already cost us `externalCompanyId` on the deal side.
   */
  describe('findById read whitelist', () => {
    it('returns the van, name and templateId stored on the item', async () => {
      const stored = createMockContainer({
        name: '(AZ) ELI SZENDER',
        templateId: 'tpl-1',
        van: {
          vin: '1FTYE1YM7HKA12345',
          make: 'Ford',
          model: 'Transit',
          year: 2017,
          licensePlate: 'AZ-1234',
        },
      });
      dynamoDb.client.send.mockResolvedValue({ Item: stored });

      const result = await repository.findById('container-1');

      expect(result?.name).toBe('(AZ) ELI SZENDER');
      expect(result?.templateId).toBe('tpl-1');
      expect(result?.van).toEqual({
        vin: '1FTYE1YM7HKA12345',
        make: 'Ford',
        model: 'Transit',
        year: 2017,
        licensePlate: 'AZ-1234',
      });
    });

    it('leaves van undefined when the container has no vehicle yet', async () => {
      dynamoDb.client.send.mockResolvedValue({ Item: createMockContainer() });

      const result = await repository.findById('container-1');

      expect(result).not.toBeNull();
      expect(result?.van).toBeUndefined();
    });
  });

  describe('update', () => {
    it('persists van attributes', async () => {
      const van = { vin: '1FTYE1YM7HKA12345', make: 'Ford' };
      dynamoDb.client.send.mockResolvedValue({
        Attributes: createMockContainer({ van }),
      });

      const result = await repository.update('container-1', { van });

      const command = dynamoDb.client.send.mock.calls[0][0];
      expect(command.input.ExpressionAttributeValues[':van']).toEqual(van);
      expect(result.van).toEqual(van);
    });

    it('refuses to reassign the owning technician', async () => {
      dynamoDb.client.send.mockResolvedValue({
        Attributes: createMockContainer(),
      });

      await repository.update('container-1', {
        technicianId: 'tech-2',
        name: 'Renamed',
      });

      const command = dynamoDb.client.send.mock.calls[0][0];
      expect(command.input.ExpressionAttributeValues).not.toHaveProperty(
        ':technicianId',
      );
      expect(command.input.ExpressionAttributeValues[':name']).toBe('Renamed');
    });
  });
});
