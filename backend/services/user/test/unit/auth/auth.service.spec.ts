import { Test } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { CognitoAuthService } from '@bitcrm/shared';
import { AuthService } from '../../../src/auth/auth.service';

describe('AuthService', () => {
  let service: AuthService;
  let cognitoAuth: Record<string, jest.Mock>;

  beforeEach(async () => {
    cognitoAuth = {
      login: jest.fn(),
      refreshToken: jest.fn(),
      respondToNewPasswordChallenge: jest.fn(),
    };

    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: CognitoAuthService, useValue: cognitoAuth },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  describe('login', () => {
    it('should return tokens on successful login', async () => {
      const tokens = {
        accessToken: 'access-123',
        refreshToken: 'refresh-123',
        idToken: 'id-123',
        expiresIn: 3600,
      };
      cognitoAuth.login.mockResolvedValue(tokens);

      const result = await service.login({
        email: 'user@test.com',
        password: 'password123',
      });

      expect(result).toEqual(tokens);
      expect(cognitoAuth.login).toHaveBeenCalledWith(
        'user@test.com',
        'password123',
      );
    });

    it('should return challenge when NEW_PASSWORD_REQUIRED', async () => {
      const challenge = {
        challengeName: 'NEW_PASSWORD_REQUIRED',
        session: 'session-abc',
      };
      cognitoAuth.login.mockResolvedValue(challenge);

      const result = await service.login({
        email: 'user@test.com',
        password: 'temp-password',
      });

      expect(result).toEqual(challenge);
    });

    it('should propagate UnauthorizedException from Cognito', async () => {
      cognitoAuth.login.mockRejectedValue(
        new UnauthorizedException('Invalid credentials'),
      );

      await expect(
        service.login({ email: 'user@test.com', password: 'wrong' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('refreshToken', () => {
    it('should return new tokens on valid refresh', async () => {
      const tokens = {
        accessToken: 'new-access',
        idToken: 'new-id',
        expiresIn: 3600,
      };
      cognitoAuth.refreshToken.mockResolvedValue(tokens);

      const result = await service.refreshToken({
        refreshToken: 'valid-refresh',
      });

      expect(result).toEqual(tokens);
      expect(cognitoAuth.refreshToken).toHaveBeenCalledWith('valid-refresh');
    });

    it('should propagate UnauthorizedException on invalid token', async () => {
      cognitoAuth.refreshToken.mockRejectedValue(
        new UnauthorizedException('Invalid refresh token'),
      );

      await expect(
        service.refreshToken({ refreshToken: 'expired' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('changePassword', () => {
    it('should return tokens after password change', async () => {
      const tokens = {
        accessToken: 'access-123',
        refreshToken: 'refresh-123',
        idToken: 'id-123',
        expiresIn: 3600,
      };
      cognitoAuth.respondToNewPasswordChallenge.mockResolvedValue(tokens);

      const result = await service.changePassword({
        email: 'user@test.com',
        newPassword: 'NewPass123',
        session: 'session-abc',
      });

      expect(result).toEqual(tokens);
      expect(cognitoAuth.respondToNewPasswordChallenge).toHaveBeenCalledWith(
        'user@test.com',
        'NewPass123',
        'session-abc',
      );
    });

    it('should propagate UnauthorizedException on invalid session', async () => {
      cognitoAuth.respondToNewPasswordChallenge.mockRejectedValue(
        new UnauthorizedException('Invalid session'),
      );

      await expect(
        service.changePassword({
          email: 'user@test.com',
          newPassword: 'NewPass123',
          session: 'bad-session',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
