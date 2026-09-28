import { IsString, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ConfirmMfaDto {
  @ApiProperty({ example: '123456', description: 'The code texted to the phone on your profile.' })
  @IsString()
  @Matches(/^\d{4,10}$/, { message: 'code must be the digits from the text' })
  code!: string;
}
