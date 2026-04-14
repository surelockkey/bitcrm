import { Test } from '@nestjs/testing';
import { AuthController } from '../../../src/auth/auth.controller';
import { AuthService } from '../../../src/auth/auth.service';

describe('AuthController', () => {
  let controller: AuthController;
  let service: Record<string, jest.Mock>;

  beforeEach(async () => {
    service = {
      login: jest.fn(),
      refreshToken: jest.fn(),
      changePassword: jest.fn(),
    };

    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: service }],
    }).compile();

    controller = module.get(AuthController);
  });

  describe('POST /auth/login', () => {
    it('should return success wrapper with tokens', async () => {
      const tokens = {
        accessToken: 'access-123',
        refreshToken: 'refresh-123',
        idToken: 'id-123',
        expiresIn: 3600,
      };
      service.login.mockResolvedValue(tokens);

      const result = await controller.login({
        email: 'user@test.com',
        password: 'password123',
      } as never);

      expect(result).toEqual({ success: true, data: tokens });
    });

    it('should return success wrapper with challenge', async () => {
      const challenge = {
        challengeName: 'NEW_PASSWORD_REQUIRED',
        session: 'session-abc',
      };
      service.login.mockResolvedValue(challenge);

      const result = await controller.login({
        email: 'user@test.com',
        password: 'temp',
      } as never);

      expect(result).toEqual({ success: true, data: challenge });
    });
  });

  describe('POST /auth/refresh', () => {
    it('should return success wrapper with new tokens', async () => {
      const tokens = {
        accessToken: 'new-access',
        idToken: 'new-id',
        expiresIn: 3600,
      };
      service.refreshToken.mockResolvedValue(tokens);

      const result = await controller.refresh({
        refreshToken: 'valid-refresh',
      } as never);

      expect(result).toEqual({ success: true, data: tokens });
    });
  });

  describe('POST /auth/change-password', () => {
    it('should return success wrapper with tokens', async () => {
      const tokens = {
        accessToken: 'access-123',
        refreshToken: 'refresh-123',
        idToken: 'id-123',
        expiresIn: 3600,
      };
      service.changePassword.mockResolvedValue(tokens);

      const result = await controller.changePassword({
        email: 'user@test.com',
        newPassword: 'NewPass123',
        session: 'session-abc',
      } as never);

      expect(result).toEqual({ success: true, data: tokens });
    });
  });
});
