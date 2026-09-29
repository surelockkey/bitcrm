import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class MfaResendDto {
  @ApiProperty({ description: 'The `session` of the `SMS_MFA` challenge to text the code for again.' })
  @IsString()
  @MinLength(1)
  session!: string;
}
