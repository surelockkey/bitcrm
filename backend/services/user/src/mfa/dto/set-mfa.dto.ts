import { IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SetMfaDto {
  @ApiProperty({ description: 'On: their next sign-in texts the phone on their profile. Off: password only.' })
  @IsBoolean()
  enabled!: boolean;
}
