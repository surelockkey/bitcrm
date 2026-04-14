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
});
