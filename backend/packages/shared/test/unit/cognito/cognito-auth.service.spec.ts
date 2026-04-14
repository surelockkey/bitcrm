import { UnauthorizedException } from '@nestjs/common';
import { CognitoAuthService } from '../../../src/cognito/cognito-auth.service';

const mockSend = jest.fn();

jest.mock('@aws-sdk/client-cognito-identity-provider', () => {
  const actual = jest.requireActual(
    '@aws-sdk/client-cognito-identity-provider',
  );
  return {
    ...actual,
    CognitoIdentityProviderClient: jest.fn().mockImplementation(() => ({
      send: mockSend,
    })),
  };
});

describe('CognitoAuthService', () => {
  let service: CognitoAuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.COGNITO_USER_POOL_ID = 'test-pool-id';
    process.env.COGNITO_CLIENT_ID = 'test-client-id';
    process.env.AWS_REGION = 'us-east-1';
    service = new CognitoAuthService();
  });

  afterEach(() => {
    delete process.env.COGNITO_USER_POOL_ID;
    delete process.env.COGNITO_CLIENT_ID;
    delete process.env.AWS_REGION;
  });

  describe('login', () => {
    it('should return tokens on successful authentication', async () => {
      mockSend.mockResolvedValue({
        AuthenticationResult: {
          AccessToken: 'access-token-123',
          RefreshToken: 'refresh-token-123',
          IdToken: 'id-token-123',
          ExpiresIn: 3600,
        },
      });

      const result = await service.login('user@test.com', 'password123');

      expect(result).toEqual({
        accessToken: 'access-token-123',
        refreshToken: 'refresh-token-123',
        idToken: 'id-token-123',
        expiresIn: 3600,
      });

      const command = mockSend.mock.calls[0][0];
      expect(command.input).toEqual({
        AuthFlow: 'USER_PASSWORD_AUTH',
        ClientId: 'test-client-id',
        AuthParameters: {
          USERNAME: 'user@test.com',
          PASSWORD: 'password123',
        },
      });
    });

    it('should return challenge response when NEW_PASSWORD_REQUIRED', async () => {
      mockSend.mockResolvedValue({
        ChallengeName: 'NEW_PASSWORD_REQUIRED',
        Session: 'session-token-abc',
      });

      const result = await service.login('user@test.com', 'temp-password');

      expect(result).toEqual({
        challengeName: 'NEW_PASSWORD_REQUIRED',
        session: 'session-token-abc',
      });
    });

    it('should throw UnauthorizedException on invalid credentials', async () => {
      const error = new Error('Incorrect username or password.');
      error.name = 'NotAuthorizedException';
      mockSend.mockRejectedValue(error);

      await expect(
        service.login('user@test.com', 'wrong-password'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when user not found', async () => {
      const error = new Error('User does not exist.');
      error.name = 'UserNotFoundException';
      mockSend.mockRejectedValue(error);

      await expect(
        service.login('nonexistent@test.com', 'password'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should re-throw unexpected errors', async () => {
      mockSend.mockRejectedValue(new Error('Service unavailable'));

      await expect(
        service.login('user@test.com', 'password'),
      ).rejects.toThrow('Service unavailable');
    });
  });

  describe('refreshToken', () => {
    it('should return new tokens on valid refresh token', async () => {
      mockSend.mockResolvedValue({
        AuthenticationResult: {
          AccessToken: 'new-access-token',
          IdToken: 'new-id-token',
          ExpiresIn: 3600,
        },
      });

      const result = await service.refreshToken('valid-refresh-token');

      expect(result).toEqual({
        accessToken: 'new-access-token',
        idToken: 'new-id-token',
        expiresIn: 3600,
      });

      const command = mockSend.mock.calls[0][0];
      expect(command.input).toEqual({
        AuthFlow: 'REFRESH_TOKEN_AUTH',
        ClientId: 'test-client-id',
        AuthParameters: {
          REFRESH_TOKEN: 'valid-refresh-token',
        },
      });
    });

    it('should throw UnauthorizedException on invalid refresh token', async () => {
      const error = new Error('Invalid Refresh Token');
      error.name = 'NotAuthorizedException';
      mockSend.mockRejectedValue(error);

      await expect(
        service.refreshToken('expired-token'),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('respondToNewPasswordChallenge', () => {
    it('should return tokens after setting new password', async () => {
      mockSend.mockResolvedValue({
        AuthenticationResult: {
          AccessToken: 'access-token-123',
          RefreshToken: 'refresh-token-123',
          IdToken: 'id-token-123',
          ExpiresIn: 3600,
        },
      });

      const result = await service.respondToNewPasswordChallenge(
        'user@test.com',
        'new-password',
        'session-token',
      );

      expect(result).toEqual({
        accessToken: 'access-token-123',
        refreshToken: 'refresh-token-123',
        idToken: 'id-token-123',
        expiresIn: 3600,
      });

      const command = mockSend.mock.calls[0][0];
      expect(command.input).toEqual({
        ChallengeName: 'NEW_PASSWORD_REQUIRED',
        ClientId: 'test-client-id',
        ChallengeResponses: {
          USERNAME: 'user@test.com',
          NEW_PASSWORD: 'new-password',
        },
        Session: 'session-token',
      });
    });

    it('should throw UnauthorizedException on invalid session', async () => {
      const error = new Error('Invalid session');
      error.name = 'CodeMismatchException';
      mockSend.mockRejectedValue(error);

      await expect(
        service.respondToNewPasswordChallenge(
          'user@test.com',
          'new-pass',
          'bad-session',
        ),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
