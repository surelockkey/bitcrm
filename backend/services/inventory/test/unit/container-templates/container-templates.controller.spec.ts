import { Test, TestingModule } from '@nestjs/testing';
import { InventoryStatus } from '@bitcrm/types';
import { ContainerTemplatesController } from 'src/container-templates/container-templates.controller';
import { ContainerTemplatesService } from 'src/container-templates/container-templates.service';
import { createMockContainerTemplate, createMockJwtUser } from '../mocks';

describe('ContainerTemplatesController', () => {
  let controller: ContainerTemplatesController;
  let service: Record<string, jest.Mock>;

  beforeEach(async () => {
    service = {
      list: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      archive: jest.fn(),
      diff: jest.fn(),
      fill: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ContainerTemplatesController],
      providers: [{ provide: ContainerTemplatesService, useValue: service }],
    }).compile();
    controller = module.get(ContainerTemplatesController);
  });

  const template = createMockContainerTemplate();

  it('lists by status in the envelope', async () => {
    service.list.mockResolvedValue([template]);

    expect(await controller.list({ status: InventoryStatus.ARCHIVED })).toEqual({ success: true, data: [template] });
    expect(service.list).toHaveBeenCalledWith(InventoryStatus.ARCHIVED);
  });

  it('reads, creates, updates and archives', async () => {
    service.findById.mockResolvedValue(template);
    service.create.mockResolvedValue(template);
    service.update.mockResolvedValue(template);
    service.archive.mockResolvedValue({ ...template, status: InventoryStatus.ARCHIVED });
    const dto = { name: 'Standard van', items: [{ productId: 'prod-1', quantity: 5 }] };

    expect(await controller.findById('tpl-1')).toEqual({ success: true, data: template });
    expect(await controller.create(dto)).toEqual({ success: true, data: template });
    expect(service.create).toHaveBeenCalledWith(dto);
    expect(await controller.update('tpl-1', { name: 'x' })).toEqual({ success: true, data: template });
    expect(service.update).toHaveBeenCalledWith('tpl-1', { name: 'x' });
    expect((await controller.archive('tpl-1')).data.status).toBe(InventoryStatus.ARCHIVED);
  });

  it('diffs a container, optionally against a warehouse', async () => {
    service.diff.mockResolvedValue({ lines: [] });

    await controller.diff('tpl-1', { containerId: 'c-1', warehouseId: 'wh-1' });

    expect(service.diff).toHaveBeenCalledWith('tpl-1', 'c-1', 'wh-1');
  });

  it('fills as the calling user', async () => {
    const user = createMockJwtUser();
    const dto = { containerId: 'c-1', warehouseId: 'wh-1' };
    service.fill.mockResolvedValue({ moved: [], short: [] });

    expect(await controller.fill('tpl-1', dto, user)).toEqual({ success: true, data: { moved: [], short: [] } });
    expect(service.fill).toHaveBeenCalledWith('tpl-1', dto, user);
  });
});
