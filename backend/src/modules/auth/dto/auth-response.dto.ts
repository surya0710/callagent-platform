import { ApiProperty } from '@nestjs/swagger';

export class AuthUserDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  lastName!: string;

  @ApiProperty({ type: [String] })
  roles!: string[];

  @ApiProperty({ type: [String] })
  permissions!: string[];
}

export class AuthResponseDto {
  @ApiProperty({
    type: AuthUserDto,
    description: 'Authenticated user profile. JWT is stored in an httpOnly cookie.',
  })
  user!: AuthUserDto;
}
