import { IsEmail, IsString, MinLength, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class PasswordResetConfirmDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: '123456', description: 'Confirmation code emailed by Cognito.' })
  @IsString()
  @MinLength(1)
  code!: string;

  @ApiProperty({ example: 'NewPassw0rd!' })
  @IsString()
  @MinLength(8)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).{8,}$/, {
    message: 'newPassword must be at least 8 characters and include a letter and a number',
  })
  newPassword!: string;
}
