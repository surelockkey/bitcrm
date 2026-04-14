import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
  CognitoAuthService,
  CognitoAuthModule,
  DynamoDbModule,
  RedisModule,
  PermissionGuard,
  PermissionCacheReader,
  HttpExceptionFilter,
} from '@bitcrm/shared';
import { AuthModule } from '../../src/auth/auth.module';

describe('Auth API (e2e)', () => {
  let app: INestApplication;
  let httpServer: ReturnType<INestApplication['getHttpServer']>;

  const mockCognitoAuth = {
    login: jest.fn(),
    refreshToken: jest.fn(),
    respondToNewPasswordChallenge: jest.fn(),
  };

  beforeAll(async () => {
    process.env.REDIS_URL = 'redis://localhost:6379';

    const moduleRef = await Test.createTestingModule({
      imports: [DynamoDbModule, RedisModule, CognitoAuthModule, AuthModule],
      providers: [
        PermissionCacheReader,
        { provide: APP_GUARD, useClass: PermissionGuard },
      ],
    })
      .overrideProvider(CognitoAuthService)
      .useValue(mockCognitoAuth)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/users');
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    httpServer = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/users/auth/login', () => {
    it('should return tokens on successful login', async () => {
      mockCognitoAuth.login.mockResolvedValue({
        accessToken: 'access-123',
        refreshToken: 'refresh-123',
        idToken: 'id-123',
        expiresIn: 3600,
      });

      const res = await request(httpServer)
        .post('/api/users/auth/login')
        .send({ email: 'user@test.com', password: 'Password123' });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        success: true,
        data: {
          accessToken: 'access-123',
          refreshToken: 'refresh-123',
          idToken: 'id-123',
          expiresIn: 3600,
        },
      });
    });

    it('should return challenge when NEW_PASSWORD_REQUIRED', async () => {
      mockCognitoAuth.login.mockResolvedValue({
        challengeName: 'NEW_PASSWORD_REQUIRED',
        session: 'session-abc',
      });

      const res = await request(httpServer)
        .post('/api/users/auth/login')
        .send({ email: 'user@test.com', password: 'TempPass123' });

      expect(res.status).toBe(201);
      expect(res.body.data.challengeName).toBe('NEW_PASSWORD_REQUIRED');
      expect(res.body.data.session).toBeDefined();
    });

    it('should return 401 on invalid credentials', async () => {
      const { UnauthorizedException } = require('@nestjs/common');
      mockCognitoAuth.login.mockRejectedValue(
        new UnauthorizedException('Invalid credentials'),
      );

      const res = await request(httpServer)
        .post('/api/users/auth/login')
        .send({ email: 'user@test.com', password: 'wrong' });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should return 400 when email is missing', async () => {
      const res = await request(httpServer)
        .post('/api/users/auth/login')
        .send({ password: 'Password123' });

      expect(res.status).toBe(400);
    });

    it('should return 400 when password is missing', async () => {
      const res = await request(httpServer)
        .post('/api/users/auth/login')
        .send({ email: 'user@test.com' });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/users/auth/refresh', () => {
    it('should return new tokens on valid refresh', async () => {
      mockCognitoAuth.refreshToken.mockResolvedValue({
        accessToken: 'new-access',
        idToken: 'new-id',
        expiresIn: 3600,
      });

      const res = await request(httpServer)
        .post('/api/users/auth/refresh')
        .send({ refreshToken: 'valid-refresh-token' });

      expect(res.status).toBe(201);
      expect(res.body.data.accessToken).toBe('new-access');
    });

    it('should return 401 on invalid refresh token', async () => {
      const { UnauthorizedException } = require('@nestjs/common');
      mockCognitoAuth.refreshToken.mockRejectedValue(
        new UnauthorizedException('Invalid refresh token'),
      );

      const res = await request(httpServer)
        .post('/api/users/auth/refresh')
        .send({ refreshToken: 'expired-token' });

      expect(res.status).toBe(401);
    });

    it('should return 400 when refreshToken is missing', async () => {
      const res = await request(httpServer)
        .post('/api/users/auth/refresh')
        .send({});

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/users/auth/change-password', () => {
    it('should return tokens after password change', async () => {
      mockCognitoAuth.respondToNewPasswordChallenge.mockResolvedValue({
        accessToken: 'access-123',
        refreshToken: 'refresh-123',
        idToken: 'id-123',
        expiresIn: 3600,
      });

      const res = await request(httpServer)
        .post('/api/users/auth/change-password')
        .send({
          email: 'user@test.com',
          newPassword: 'NewPass123',
          session: 'session-abc',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.accessToken).toBe('access-123');
    });

    it('should return 401 on invalid session', async () => {
      const { UnauthorizedException } = require('@nestjs/common');
      mockCognitoAuth.respondToNewPasswordChallenge.mockRejectedValue(
        new UnauthorizedException('Invalid session'),
      );

      const res = await request(httpServer)
        .post('/api/users/auth/change-password')
        .send({
          email: 'user@test.com',
          newPassword: 'NewPass123',
          session: 'bad-session',
        });

      expect(res.status).toBe(401);
    });

    it('should return 400 when fields are missing', async () => {
      const res = await request(httpServer)
        .post('/api/users/auth/change-password')
        .send({ email: 'user@test.com' });

      expect(res.status).toBe(400);
    });
  });
});
