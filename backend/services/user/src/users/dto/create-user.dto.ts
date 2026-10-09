import { IsEmail, IsIn, IsOptional, IsString, MinLength, ValidateIf } from 'class-validator';
import { USER_TYPES, type UserType } from '@bitcrm/types';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateUserDto {
  @ApiProperty({ example: 'john@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'John' })
  @IsString()
  @MinLength(1)
  firstName!: string;

  @ApiProperty({ example: 'Doe' })
  @IsString()
  @MinLength(1)
  lastName!: string;

  @ApiPropertyOptional({
    enum: USER_TYPES,
    default: 'regular',
    description:
      'Workiz "User type". A `subcontractor` cannot sign in: the account is made ' +
      'without an invitation and switched off, the role is always the technician ' +
      'role (any `roleId` is ignored), and they join the field team.',
  })
  @IsOptional()
  @IsIn(USER_TYPES)
  userType?: UserType;

  @ApiProperty({
    example: 'role-technician',
    description:
      'ID of the role to assign. Must reference an existing role. Not needed — ' +
      'and ignored — for a subcontractor.',
  })
  @ValidateIf((o: CreateUserDto) => o.userType !== 'subcontractor')
  @IsString()
  roleId!: string;

  @ApiProperty({ example: 'HVAC' })
  @IsString()
  @MinLength(1)
  department!: string;

  @ApiPropertyOptional({
    example: '+14045551234',
    description:
      "The user's own phone, any format — stored E.164. Calls to or from it " +
      'are attributed to them in the call log.',
  })
  @IsOptional()
  @IsString()
  phone?: string;
}
