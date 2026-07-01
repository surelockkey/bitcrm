import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  RespondToAuthChallengeCommand,
  ForgotPasswordCommand,
  ConfirmForgotPasswordCommand,
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

  /**
   * Start a self-service password reset — Cognito emails a confirmation code.
   * Never reveals whether the account exists (returns null delivery on
   * UserNotFound) to avoid account enumeration.
   */
  async forgotPassword(email: string): Promise<{ delivery: unknown | null }> {
    try {
      const result = await this.client.send(
        new ForgotPasswordCommand({ ClientId: this.clientId, Username: email }),
      );
      return { delivery: result.CodeDeliveryDetails ?? null };
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        (error.name === 'UserNotFoundException' ||
          error.name === 'InvalidParameterException')
      ) {
        // Don't leak account existence.
        return { delivery: null };
      }
      throw error;
    }
  }

  /** Complete a password reset with the emailed code + a new password. */
  async confirmForgotPassword(
    email: string,
    code: string,
    newPassword: string,
  ): Promise<void> {
    try {
      await this.client.send(
        new ConfirmForgotPasswordCommand({
          ClientId: this.clientId,
          Username: email,
          ConfirmationCode: code,
          Password: newPassword,
        }),
      );
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        (error.name === 'CodeMismatchException' ||
          error.name === 'ExpiredCodeException' ||
          error.name === 'NotAuthorizedException' ||
          error.name === 'UserNotFoundException')
      ) {
        throw new UnauthorizedException('Invalid or expired reset code');
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
