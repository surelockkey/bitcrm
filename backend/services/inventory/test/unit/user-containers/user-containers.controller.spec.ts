import { Test, TestingModule } from '@nestjs/testing';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { UserContainerAccess } from '@bitcrm/types';
import {
  ContainerUsersController,
  UserContainersController,
} from 'src/user-containers/user-containers.controller';
import { UserContainersService } from 'src/user-containers/user-containers.service';
import { createMockJwtUser, createMockUserContainer } from '../mocks';

describe('UserContainersController', () => {
  let controller: UserContainersController;
  let containerUsers: ContainerUsersController;
  let service: Record<string, jest.Mock>;

  beforeEach(async () => {
    service = {
      list: jest.fn(),
      mine: jest.fn(),
      findByUser: jest.fn(),
      assign: jest.fn(),
      listByContainer: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserContainersController, ContainerUsersController],
      providers: [{ provide: UserContainersService, useValue: service }],
    }).compile();

    controller = module.get(UserContainersController);
    containerUsers = module.get(ContainerUsersController);
  });

  it('lists every assignment in the envelope', async () => {
    const rows = [createMockUserContainer()];
    service.list.mockResolvedValue(rows);

    expect(await controller.list()).toEqual({ success: true, data: rows });
  });

  it('answers the caller’s own row', async () => {
    const user = createMockJwtUser({ id: 'tech-1' });
    const row = createMockUserContainer();
    service.mine.mockResolvedValue(row);

    expect(await controller.mine(user)).toEqual({ success: true, data: row });
    expect(service.mine).toHaveBeenCalledWith(user);
  });

  it('answers one user’s row', async () => {
    const row = createMockUserContainer();
    service.findByUser.mockResolvedValue(row);

    expect(await controller.findByUser('tech-1')).toEqual({ success: true, data: row });
    expect(service.findByUser).toHaveBeenCalledWith('tech-1');
  });

  it('replaces an assignment as the calling user', async () => {
    const user = createMockJwtUser();
    const dto = { userName: 'Mike', access: UserContainerAccess.ALL };
    const row = createMockUserContainer({ access: UserContainerAccess.ALL });
    service.assign.mockResolvedValue(row);

    expect(await controller.assign('tech-1', dto, user)).toEqual({ success: true, data: row });
    expect(service.assign).toHaveBeenCalledWith('tech-1', dto, user);
  });

  it('lists the users of one container', async () => {
    const rows = [createMockUserContainer()];
    service.listByContainer.mockResolvedValue(rows);

    expect(await containerUsers.listUsers('c-1')).toEqual({ success: true, data: rows });
    expect(service.listByContainer).toHaveBeenCalledWith('c-1');
  });

  // `me` має стояти перед `:userId`, інакше параметр його ковтає.
  it('declares GET me before GET :userId', () => {
    const handlers = Object.getOwnPropertyNames(UserContainersController.prototype)
      .map((name) => (UserContainersController.prototype as any)[name])
      .filter((fn) => typeof fn === 'function' && Reflect.getMetadata(METHOD_METADATA, fn) === RequestMethod.GET)
      .map((fn) => Reflect.getMetadata(PATH_METADATA, fn));

    expect(handlers.indexOf('me')).toBeGreaterThanOrEqual(0);
    expect(handlers.indexOf('me')).toBeLessThan(handlers.indexOf(':userId'));
    expect(Reflect.getMetadata(PATH_METADATA, ContainerUsersController)).toBe('containers');
    expect(Reflect.getMetadata(PATH_METADATA, ContainerUsersController.prototype.listUsers)).toBe(':id/users');
  });
});
