import { Injectable, Logger } from '@nestjs/common';
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminUpdateUserAttributesCommand,
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  AdminDeleteUserCommand,
  type AdminCreateUserCommandOutput,
  type AttributeType,
} from '@aws-sdk/client-cognito-identity-provider';

@Injectable()
export class CognitoAdminService {
  private readonly client: CognitoIdentityProviderClient;
  private readonly userPoolId: string;
  private readonly logger = new Logger(CognitoAdminService.name);

  constructor() {
    const userPoolId = process.env.COGNITO_USER_POOL_ID;
    if (!userPoolId) {
      this.logger.warn(
        'COGNITO_USER_POOL_ID is not set — Cognito admin operations will fail',
      );
    }
    this.userPoolId = userPoolId || '';
    this.client = new CognitoIdentityProviderClient({
      region: process.env.AWS_REGION || 'us-east-1',
    });
  }

  async createUser(
    email: string,
    attributes: Record<string, string>,
  ): Promise<AdminCreateUserCommandOutput> {
    const userAttributes: AttributeType[] = [
      { Name: 'email', Value: email },
      { Name: 'email_verified', Value: 'true' },
      ...Object.entries(attributes).map(([key, value]) => ({
        Name: key,
        Value: value,
      })),
    ];

    return this.client.send(
      new AdminCreateUserCommand({
        UserPoolId: this.userPoolId,
        Username: email,
        UserAttributes: userAttributes,
        DesiredDeliveryMediums: ['EMAIL'],
      }),
    );
  }

  async updateUserAttributes(
    username: string,
    attributes: Record<string, string>,
  ): Promise<void> {
    const userAttributes: AttributeType[] = Object.entries(attributes).map(
      ([key, value]) => ({ Name: key, Value: value }),
    );

    await this.client.send(
      new AdminUpdateUserAttributesCommand({
        UserPoolId: this.userPoolId,
        Username: username,
        UserAttributes: userAttributes,
      }),
    );
  }

  async disableUser(username: string): Promise<void> {
    await this.client.send(
      new AdminDisableUserCommand({
        UserPoolId: this.userPoolId,
        Username: username,
      }),
    );
  }

  async enableUser(username: string): Promise<void> {
    await this.client.send(
      new AdminEnableUserCommand({
        UserPoolId: this.userPoolId,
        Username: username,
      }),
    );
  }

  async deleteUser(username: string): Promise<void> {
    await this.client.send(
      new AdminDeleteUserCommand({
        UserPoolId: this.userPoolId,
        Username: username,
      }),
    );
  }
}
