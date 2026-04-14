import { IsEmail, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

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
}
