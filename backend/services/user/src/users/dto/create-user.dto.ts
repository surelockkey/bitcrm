import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';
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

  @ApiProperty({
    example: 'role-technician',
    description: 'ID of the role to assign. Must reference an existing role.',
  })
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
