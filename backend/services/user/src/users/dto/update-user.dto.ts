import {
  IsBoolean,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

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
}
