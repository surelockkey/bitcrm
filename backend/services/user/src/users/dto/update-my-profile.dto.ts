import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * The fields a user may change on their own record, whatever their role.
 * Deliberately narrow: name, department and role stay admin-owned.
 */
export class UpdateMyProfileDto {
  @ApiProperty({
    example: '+14045551234',
    description: 'Any format — stored E.164. Empty string clears it.',
  })
  @IsString()
  phone!: string;
}
