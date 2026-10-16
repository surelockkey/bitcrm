import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, Matches, MaxLength } from 'class-validator';
import { EXPO_PUSH_TOKEN_MAX_LENGTH, EXPO_PUSH_TOKEN_PATTERN, PUSH_PLATFORMS, type PushPlatform } from '../push.constants';

/** `PUT /push-tokens` — the technician app registers the Expo token of the phone it runs on. */
export class RegisterPushTokenDto {
  @ApiProperty({ example: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]', description: 'From `getExpoPushTokenAsync`.' })
  @IsString()
  @MaxLength(EXPO_PUSH_TOKEN_MAX_LENGTH)
  @Matches(EXPO_PUSH_TOKEN_PATTERN, { message: 'token must be an Expo push token (ExponentPushToken[…])' })
  token!: string;

  @ApiProperty({ enum: PUSH_PLATFORMS })
  @IsIn(PUSH_PLATFORMS)
  platform!: PushPlatform;
}
