import { Test } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { CognitoAdminService, CognitoAuthService } from '@bitcrm/shared';
import { AuthService } from '../../../src/auth/auth.service';
import { MfaService } from '../../../src/mfa/mfa.service';

describe('AuthService', () => {
  let service: AuthService;
  let cognitoAuth: Record<string, jest.Mock>;
  let cognitoAdmin: Record<string, jest.Mock>;
  let mfa: Record<string, jest.Mock>;

  beforeEach(async () => {
    cognitoAuth = {
      login: jest.fn(),
      refreshToken: jest.fn(),
      respondToNewPasswordChallenge: jest.fn(),
      forgotPassword: jest.fn().mockResolvedValue({ delivery: null }),
      confirmForgotPassword: jest.fn().mockResolvedValue(undefined),
    };

    // No second step unless a test says so: the tokens pass straight through.
    mfa = {
      gate: jest.fn(async (tokens: unknown) => tokens),
      verify: jest.fn(),
      resend: jest.fn(),
      setupPhone: jest.fn(),
      sendEmailCode: jest.fn(),
    };

    cognitoAdmin = {
      getUser: jest.fn(),
      resendInvite: jest.fn().mockResolvedValue(undefined),
    };

    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: CognitoAuthService, useValue: cognitoAuth },
        { provide: CognitoAdminService, useValue: cognitoAdmin },
        { provide: MfaService, useValue: mfa },
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

  describe('two-step sign-in', () => {
    const tokens = { accessToken: 'a', refreshToken: 'r', idToken: 'i', expiresIn: 3600 };
    const challenge = { challengeName: 'SMS_MFA', session: 's1', destination: '•••• 1234' };

    it('hands the password step\'s tokens to the second step, and returns what it answers', async () => {
      cognitoAuth.login.mockResolvedValue(tokens);
      mfa.gate.mockResolvedValue(challenge);

      await expect(service.login({ email: 'u@t.com', password: 'pw' })).resolves.toEqual(challenge);
      expect(mfa.gate).toHaveBeenCalledWith(tokens);
    });

    it('leaves Cognito\'s first-password challenge alone — there are no tokens yet', async () => {
      const newPassword = { challengeName: 'NEW_PASSWORD_REQUIRED', session: 'cog' };
      cognitoAuth.login.mockResolvedValue(newPassword);

      await expect(service.login({ email: 'u@t.com', password: 'pw' })).resolves.toEqual(newPassword);
      expect(mfa.gate).not.toHaveBeenCalled();
    });

    // Setting a first password signs the person in: the same gate applies.
    it('gates the sign-in that setting a first password completes', async () => {
      cognitoAuth.respondToNewPasswordChallenge.mockResolvedValue(tokens);
      mfa.gate.mockResolvedValue(challenge);

      await expect(
        service.changePassword({ email: 'u@t.com', newPassword: 'Pw123456', session: 'cog' }),
      ).resolves.toEqual(challenge);
      expect(mfa.gate).toHaveBeenCalledWith(tokens);
    });

    it('checks the texted code and resends it', async () => {
      mfa.verify.mockResolvedValue(tokens);
      mfa.resend.mockResolvedValue({ destination: '•••• 1234' });

      await expect(service.verifyMfa({ session: 's1', code: '123456' })).resolves.toEqual(tokens);
      expect(mfa.verify).toHaveBeenCalledWith('s1', '123456');
      await expect(service.resendMfa({ session: 's1' })).resolves.toEqual({ destination: '•••• 1234' });
      expect(mfa.resend).toHaveBeenCalledWith('s1');
    });

    // The account requires it and the person has no phone: the phone given
    // on the way in, and the code to the account's email, both go to the gate.
    it('hands a phone being set up, and a request for the code by email, to the second step', async () => {
      mfa.setupPhone.mockResolvedValue({ destination: '•••• 0739' });
      mfa.sendEmailCode.mockResolvedValue({ destination: 'b•••@x.com' });

      await expect(service.setupMfa({ session: 's1', phone: '541-283-0739' })).resolves.toEqual({ destination: '•••• 0739' });
      expect(mfa.setupPhone).toHaveBeenCalledWith('s1', '541-283-0739');
      await expect(service.emailMfaCode({ session: 's1' })).resolves.toEqual({ destination: 'b•••@x.com' });
      expect(mfa.sendEmailCode).toHaveBeenCalledWith('s1');
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

  describe('requestPasswordReset', () => {
    it('delegates to forgotPassword and returns a non-enumerating message', async () => {
      const result = await service.requestPasswordReset({ email: 'user@test.com' });
      expect(cognitoAuth.forgotPassword).toHaveBeenCalledWith('user@test.com');
      expect(result.message).toMatch(/if the account exists/i);
    });

    // Cognito will not reset the password of someone who never set one
    // ("User password cannot be reset in the current state") — that was a 500.
    const notResettable = () =>
      Object.assign(new Error('User password cannot be reset in the current state.'), {
        name: 'NotAuthorizedException',
      });

    it('re-sends the invitation to someone who never accepted it', async () => {
      cognitoAuth.forgotPassword.mockRejectedValue(notResettable());
      cognitoAdmin.getUser.mockResolvedValue({ status: 'FORCE_CHANGE_PASSWORD', enabled: true });

      const result = await service.requestPasswordReset({ email: 'new@test.com' });

      expect(cognitoAdmin.resendInvite).toHaveBeenCalledWith('new@test.com');
      expect(result.message).toMatch(/if the account exists/i);
    });

    it('sends nothing to a switched-off account, and still answers the same', async () => {
      cognitoAuth.forgotPassword.mockRejectedValue(notResettable());
      cognitoAdmin.getUser.mockResolvedValue({ status: 'FORCE_CHANGE_PASSWORD', enabled: false });

      const result = await service.requestPasswordReset({ email: 'sub@test.com' });

      expect(cognitoAdmin.resendInvite).not.toHaveBeenCalled();
      expect(result.message).toMatch(/if the account exists/i);
    });

    it('answers the same when the invitation cannot be re-sent either', async () => {
      cognitoAuth.forgotPassword.mockRejectedValue(notResettable());
      cognitoAdmin.getUser.mockResolvedValue({ status: 'FORCE_CHANGE_PASSWORD', enabled: true });
      cognitoAdmin.resendInvite.mockRejectedValue(new Error('LimitExceededException'));

      await expect(
        service.requestPasswordReset({ email: 'new@test.com' }),
      ).resolves.toEqual({ message: expect.stringMatching(/if the account exists/i) });
    });

    it('answers the same for an email with no account (no 500, no enumeration)', async () => {
      cognitoAuth.forgotPassword.mockRejectedValue(
        Object.assign(new Error('User does not exist.'), { name: 'UserNotFoundException' }),
      );
      await expect(service.requestPasswordReset({ email: 'nobody@test.com' })).resolves.toEqual({
        message: expect.stringMatching(/if the account exists/i),
      });
      expect(cognitoAdmin.resendInvite).not.toHaveBeenCalled();
    });

    it('answers 429 when Cognito says too many attempts', async () => {
      cognitoAuth.forgotPassword.mockRejectedValue(
        Object.assign(new Error('Attempt limit exceeded'), { name: 'LimitExceededException' }),
      );
      await expect(service.requestPasswordReset({ email: 'user@test.com' })).rejects.toMatchObject({
        status: 429,
      });
    });

    it('lets any other failure through', async () => {
      cognitoAuth.forgotPassword.mockRejectedValue(new Error('Rate exceeded'));
      await expect(service.requestPasswordReset({ email: 'user@test.com' })).rejects.toThrow(
        'Rate exceeded',
      );
      expect(cognitoAdmin.resendInvite).not.toHaveBeenCalled();
    });
  });

  describe('confirmPasswordReset', () => {
    it('delegates to confirmForgotPassword with code + new password', async () => {
      const result = await service.confirmPasswordReset({
        email: 'user@test.com',
        code: '123456',
        newPassword: 'NewPass1!',
      });
      expect(cognitoAuth.confirmForgotPassword).toHaveBeenCalledWith(
        'user@test.com',
        '123456',
        'NewPass1!',
      );
      expect(result.message).toMatch(/reset/i);
    });
  });
});
