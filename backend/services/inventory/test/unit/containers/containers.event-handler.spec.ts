import { Test, TestingModule } from '@nestjs/testing';
import { ContainersEventHandler } from 'src/containers/containers.event-handler';
import { ContainersService } from 'src/containers/containers.service';
import { createMockContainer } from '../mocks';

describe('ContainersEventHandler', () => {
  let handler: ContainersEventHandler;
  let containersService: Record<string, jest.Mock>;

  beforeEach(async () => {
    containersService = {
      ensureContainer: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContainersEventHandler,
        { provide: ContainersService, useValue: containersService },
      ],
    }).compile();

    handler = module.get<ContainersEventHandler>(ContainersEventHandler);
  });

  describe('handleUserEvent', () => {
    it('should call ensureContainer for technician role', async () => {
      const container = createMockContainer();
      containersService.ensureContainer.mockResolvedValue(container);

      await handler.handleUserEvent({
        userId: 'tech-1',
        roleId: 'role-technician',
        department: 'Atlanta',
        firstName: 'John',
        lastName: 'Doe',
      });

      expect(containersService.ensureContainer).toHaveBeenCalledWith({
        technicianId: 'tech-1',
        technicianName: 'John Doe',
        department: 'Atlanta',
      });
    });

    it('should skip non-technician roles', async () => {
      await handler.handleUserEvent({
        userId: 'admin-1',
        roleId: 'role-admin',
        department: 'HQ',
        firstName: 'Admin',
        lastName: 'User',
      });

      expect(containersService.ensureContainer).not.toHaveBeenCalled();
    });

    it('should skip dispatcher role', async () => {
      await handler.handleUserEvent({
        userId: 'disp-1',
        roleId: 'role-dispatcher',
        department: 'HQ',
        firstName: 'Dispatch',
        lastName: 'User',
      });

      expect(containersService.ensureContainer).not.toHaveBeenCalled();
    });

    it('should trim technician name', async () => {
      containersService.ensureContainer.mockResolvedValue(createMockContainer());

      await handler.handleUserEvent({
        userId: 'tech-1',
        roleId: 'role-technician',
        department: 'Atlanta',
        firstName: 'John',
        lastName: '',
      });

      expect(containersService.ensureContainer).toHaveBeenCalledWith(
        expect.objectContaining({ technicianName: 'John' }),
      );
    });
  });
});
