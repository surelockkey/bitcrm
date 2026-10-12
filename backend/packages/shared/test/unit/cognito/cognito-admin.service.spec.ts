import { CognitoAdminService } from '../../../src/cognito/cognito-admin.service';

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

describe('CognitoAdminService', () => {
  let service: CognitoAdminService;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.COGNITO_USER_POOL_ID = 'test-pool-id';
    process.env.AWS_REGION = 'us-east-1';
    service = new CognitoAdminService();
  });

  afterEach(() => {
    delete process.env.COGNITO_USER_POOL_ID;
    delete process.env.AWS_REGION;
  });

  describe('createUser', () => {
    it('should send AdminCreateUserCommand with correct parameters', async () => {
      mockSend.mockResolvedValue({ User: { Attributes: [] } });

      await service.createUser('test@example.com', {
        'custom:role': 'admin',
        'custom:department': 'Engineering',
        'custom:user_id': 'user-123',
      });

      expect(mockSend).toHaveBeenCalledTimes(1);
      const command = mockSend.mock.calls[0][0];
      expect(command.input).toEqual({
        UserPoolId: 'test-pool-id',
        Username: 'test@example.com',
        UserAttributes: [
          { Name: 'email', Value: 'test@example.com' },
          { Name: 'email_verified', Value: 'true' },
          { Name: 'custom:role', Value: 'admin' },
          { Name: 'custom:department', Value: 'Engineering' },
          { Name: 'custom:user_id', Value: 'user-123' },
        ],
        DesiredDeliveryMediums: ['EMAIL'],
      });
    });

    it('creates the account without emailing anyone when the invite is suppressed', async () => {
      // A Workiz subcontractor gets an account (so their email stays theirs
      // and they can be made a User later) but no invitation to sign in.
      mockSend.mockResolvedValue({ User: { Attributes: [] } });

      await service.createUser(
        'sub@example.com',
        { 'custom:user_id': 'user-9' },
        { suppressInvite: true },
      );

      const command = mockSend.mock.calls[0][0];
      expect(command.input.MessageAction).toBe('SUPPRESS');
      expect(command.input.DesiredDeliveryMediums).toBeUndefined();
      expect(command.input.Username).toBe('sub@example.com');
    });
  });

  describe('updateUserAttributes', () => {
    it('should send AdminUpdateUserAttributesCommand with mapped attributes', async () => {
      mockSend.mockResolvedValue({});

      await service.updateUserAttributes('cognito-sub-123', {
        'custom:role': 'dispatcher',
      });

      const command = mockSend.mock.calls[0][0];
      expect(command.input).toEqual({
        UserPoolId: 'test-pool-id',
        Username: 'cognito-sub-123',
        UserAttributes: [{ Name: 'custom:role', Value: 'dispatcher' }],
      });
    });
  });

  describe('disableUser', () => {
    it('should send AdminDisableUserCommand', async () => {
      mockSend.mockResolvedValue({});

      await service.disableUser('cognito-sub-123');

      const command = mockSend.mock.calls[0][0];
      expect(command.input).toEqual({
        UserPoolId: 'test-pool-id',
        Username: 'cognito-sub-123',
      });
    });
  });

  describe('enableUser', () => {
    it('should send AdminEnableUserCommand', async () => {
      mockSend.mockResolvedValue({});

      await service.enableUser('cognito-sub-123');

      const command = mockSend.mock.calls[0][0];
      expect(command.input).toEqual({
        UserPoolId: 'test-pool-id',
        Username: 'cognito-sub-123',
      });
    });
  });

  describe('deleteUser', () => {
    it('should send AdminDeleteUserCommand', async () => {
      mockSend.mockResolvedValue({});

      await service.deleteUser('cognito-sub-123');

      const command = mockSend.mock.calls[0][0];
      expect(command.input).toEqual({
        UserPoolId: 'test-pool-id',
        Username: 'cognito-sub-123',
      });
    });
  });

  describe('resendInvite', () => {
    it('re-sends the invitation email via AdminCreateUser MessageAction=RESEND', async () => {
      mockSend.mockResolvedValue({});
      await service.resendInvite('user@test.com');
      const command = mockSend.mock.calls[0][0];
      expect(command.input).toMatchObject({
        UserPoolId: 'test-pool-id',
        Username: 'user@test.com',
        MessageAction: 'RESEND',
        DesiredDeliveryMediums: ['EMAIL'],
      });
    });
  });

  describe('getUser', () => {
    it('reads the sign-in state of an account by its username', async () => {
      mockSend.mockResolvedValue({ UserStatus: 'FORCE_CHANGE_PASSWORD', Enabled: true });
      await expect(service.getUser('user@test.com')).resolves.toEqual({
        status: 'FORCE_CHANGE_PASSWORD',
        enabled: true,
      });
      expect(mockSend.mock.calls[0][0].input).toEqual({
        UserPoolId: 'test-pool-id',
        Username: 'user@test.com',
      });
    });

    it('names the user the app made the account for', async () => {
      mockSend.mockResolvedValue({
        UserStatus: 'FORCE_CHANGE_PASSWORD',
        Enabled: true,
        UserAttributes: [
          { Name: 'sub', Value: 'sub-1' },
          { Name: 'email', Value: 'user@test.com' },
          { Name: 'custom:user_id', Value: 'u-1' },
        ],
      });
      await expect(service.getUser('user@test.com')).resolves.toEqual({
        status: 'FORCE_CHANGE_PASSWORD',
        enabled: true,
        sub: 'sub-1',
        userId: 'u-1',
      });
    });

    it('answers null when there is no such account', async () => {
      mockSend.mockRejectedValue(
        Object.assign(new Error('User does not exist.'), { name: 'UserNotFoundException' }),
      );
      await expect(service.getUser('ghost@test.com')).resolves.toBeNull();
    });

    it('lets any other failure through', async () => {
      mockSend.mockRejectedValue(
        Object.assign(new Error('Rate exceeded'), { name: 'TooManyRequestsException' }),
      );
      await expect(service.getUser('user@test.com')).rejects.toThrow('Rate exceeded');
    });
  });
});
