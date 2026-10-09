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
      verifyMfa: jest.fn(),
      resendMfa: jest.fn(),
      setupMfa: jest.fn(),
      emailMfaCode: jest.fn(),
    };

    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: service }],
    }).compile();

    controller = module.get(AuthController);
  });

  describe('POST /auth/mfa', () => {
    it('trades the texted code for the tokens', async () => {
      const tokens = { accessToken: 'a', refreshToken: 'r', idToken: 'i', expiresIn: 3600 };
      service.verifyMfa.mockResolvedValue(tokens);

      await expect(controller.verifyMfa({ session: 's1', code: '123456' } as never)).resolves.toEqual({
        success: true,
        data: tokens,
      });
      expect(service.verifyMfa).toHaveBeenCalledWith({ session: 's1', code: '123456' });
    });

    it('resends the code', async () => {
      service.resendMfa.mockResolvedValue({ destination: '•••• 1234' });

      await expect(controller.resendMfa({ session: 's1' } as never)).resolves.toEqual({
        success: true,
        data: { destination: '•••• 1234' },
      });
    });

    it('POST /auth/mfa/setup texts the phone given for an MFA_SETUP challenge', async () => {
      service.setupMfa.mockResolvedValue({ destination: '•••• 0739' });

      await expect(controller.setupMfa({ session: 's1', phone: '541-283-0739' } as never)).resolves.toEqual({
        success: true,
        data: { destination: '•••• 0739' },
      });
      expect(service.setupMfa).toHaveBeenCalledWith({ session: 's1', phone: '541-283-0739' });
    });

    it('POST /auth/mfa/email sends the code to the account\'s email', async () => {
      service.emailMfaCode.mockResolvedValue({ destination: 'b•••@x.com' });

      await expect(controller.emailMfaCode({ session: 's1' } as never)).resolves.toEqual({
        success: true,
        data: { destination: 'b•••@x.com' },
      });
      expect(service.emailMfaCode).toHaveBeenCalledWith({ session: 's1' });
    });
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
