import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  RespondToAuthChallengeCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import type {
  LoginResponse,
  LoginChallengeResponse,
  RefreshTokenResponse,
  ChangePasswordResponse,
} from '@bitcrm/types';

@Injectable()
export class CognitoAuthService {
  private readonly client: CognitoIdentityProviderClient;
  private readonly clientId: string;
  private readonly logger = new Logger(CognitoAuthService.name);

  constructor() {
    const clientId = process.env.COGNITO_CLIENT_ID;
    if (!clientId) {
      this.logger.warn(
        'COGNITO_CLIENT_ID is not set — auth operations will fail',
      );
    }
    this.clientId = clientId || '';
    this.client = new CognitoIdentityProviderClient({
      region: process.env.AWS_REGION || 'us-east-1',
    });
  }

  async login(
    email: string,
    password: string,
  ): Promise<LoginResponse | LoginChallengeResponse> {
    try {
      const result = await this.client.send(
        new InitiateAuthCommand({
          AuthFlow: 'USER_PASSWORD_AUTH',
          ClientId: this.clientId,
          AuthParameters: {
            USERNAME: email,
            PASSWORD: password,
          },
        }),
      );

      if (result.ChallengeName === 'NEW_PASSWORD_REQUIRED') {
        return {
          challengeName: 'NEW_PASSWORD_REQUIRED',
          session: result.Session!,
        };
      }

      return {
        accessToken: result.AuthenticationResult!.AccessToken!,
        refreshToken: result.AuthenticationResult!.RefreshToken!,
        idToken: result.AuthenticationResult!.IdToken!,
        expiresIn: result.AuthenticationResult!.ExpiresIn!,
      };
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        (error.name === 'NotAuthorizedException' ||
          error.name === 'UserNotFoundException')
      ) {
        throw new UnauthorizedException('Invalid email or password');
      }
      throw error;
    }
  }

  async refreshToken(token: string): Promise<RefreshTokenResponse> {
    try {
      const result = await this.client.send(
        new InitiateAuthCommand({
          AuthFlow: 'REFRESH_TOKEN_AUTH',
          ClientId: this.clientId,
          AuthParameters: {
            REFRESH_TOKEN: token,
          },
        }),
      );

      return {
        accessToken: result.AuthenticationResult!.AccessToken!,
        idToken: result.AuthenticationResult!.IdToken!,
        expiresIn: result.AuthenticationResult!.ExpiresIn!,
      };
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        error.name === 'NotAuthorizedException'
      ) {
        throw new UnauthorizedException('Invalid refresh token');
      }
      throw error;
    }
  }

  async respondToNewPasswordChallenge(
    email: string,
    newPassword: string,
    session: string,
  ): Promise<ChangePasswordResponse> {
    try {
      const result = await this.client.send(
        new RespondToAuthChallengeCommand({
          ChallengeName: 'NEW_PASSWORD_REQUIRED',
          ClientId: this.clientId,
          ChallengeResponses: {
            USERNAME: email,
            NEW_PASSWORD: newPassword,
          },
          Session: session,
        }),
      );

      return {
        accessToken: result.AuthenticationResult!.AccessToken!,
        refreshToken: result.AuthenticationResult!.RefreshToken!,
        idToken: result.AuthenticationResult!.IdToken!,
        expiresIn: result.AuthenticationResult!.ExpiresIn!,
      };
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        (error.name === 'CodeMismatchException' ||
          error.name === 'NotAuthorizedException' ||
          error.name === 'ExpiredCodeException')
      ) {
        throw new UnauthorizedException('Invalid or expired session');
      }
      throw error;
    }
  }
}
