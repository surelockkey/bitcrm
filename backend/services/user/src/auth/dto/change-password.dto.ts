import { IsEmail, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { type ChangePasswordRequest } from '@bitcrm/types';

export class ChangePasswordDto implements ChangePasswordRequest {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'NewPassword123' })
  @IsString()
  @MinLength(8)
  newPassword!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  session!: string;
}
