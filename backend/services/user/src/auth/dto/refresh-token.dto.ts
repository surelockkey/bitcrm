import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { type RefreshTokenRequest } from '@bitcrm/types';

export class RefreshTokenDto implements RefreshTokenRequest {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  refreshToken!: string;
}
