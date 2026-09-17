import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import { PUSH_PLATFORMS, type PushPlatform } from '@bitcrm/types';

/**
 * `POST /devices` — the technician app hands over the Expo token it got from
 * the OS. Deliberately no `userId`: the token is registered for whoever the
 * bearer token says is calling, so nobody can point someone else's user at
 * their phone.
 */
export class RegisterDeviceDto {
  @ApiProperty({
    example: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]',
    description: 'Expo push token from `expo-notifications` on the device.',
  })
  @IsString()
  @Length(1, 256)
  token!: string;

  @ApiProperty({ enum: PUSH_PLATFORMS, example: 'ios' })
  @IsIn(PUSH_PLATFORMS)
  platform!: PushPlatform;

  @ApiPropertyOptional({ example: '1.4.0', description: 'App build, so the logs can name a misbehaving version.' })
  @IsOptional()
  @IsString()
  @Length(1, 32)
  appVersion?: string;

  @ApiPropertyOptional({ example: "Ihor's iPhone", description: 'What the owner calls the phone.' })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  deviceName?: string;
}
