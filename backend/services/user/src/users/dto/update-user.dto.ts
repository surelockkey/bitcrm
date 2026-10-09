import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { USER_TYPES, type UserType } from '@bitcrm/types';

export class UpdateUserDto {
  @ApiPropertyOptional({ example: 'John' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  firstName?: string;

  @ApiPropertyOptional({ example: 'Doe' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  lastName?: string;

  @ApiPropertyOptional({ example: 'Plumbing' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  department?: string;

  @ApiPropertyOptional({
    example: '+14045551234',
    description:
      "The user's own phone, any format — stored E.164. Pass an empty string " +
      'to clear it.',
  })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({
    example: true,
    description:
      'Workiz "Field team member": whether this person goes out on jobs and may ' +
      'be put on one, whatever their role. Switching it on provisions a ' +
      'technician profile; dispatch is told either way.',
  })
  @IsOptional()
  @IsBoolean()
  fieldTeamMember?: boolean;

  @ApiPropertyOptional({
    enum: USER_TYPES,
    description:
      'Workiz "User type". To `subcontractor` takes the sign-in away at once ' +
      '(account off, live sessions refused); back to `regular` gives it back and ' +
      're-sends the invitation. Only someone who outranks the person, never on ' +
      'yourself.',
  })
  @IsOptional()
  @IsIn(USER_TYPES)
  userType?: UserType;
}
