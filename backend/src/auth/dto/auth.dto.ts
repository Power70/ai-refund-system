import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, Length } from 'class-validator';

export class StartSessionDto {
  @ApiProperty({ example: 'someone+1@example.org' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  @Length(3, 254)
  email: string;

  @ApiProperty({ format: 'password' })
  @IsString()
  @Length(1, 200)
  password: string;
}

export class SessionResponseDto {
  @ApiProperty({ example: 'Ada' })
  firstName: string;

  @ApiProperty({ example: '2026-09-27T12:30:00.000Z' })
  expiresAt: string;
}

export class CurrentCustomerDto {
  @ApiProperty({ example: 'Ada' })
  firstName: string;
}

export class StartAdminSessionDto {
  @ApiProperty({ format: 'password', description: 'ADMIN_PASSWORD' })
  @IsString()
  @Length(1, 200)
  password: string;
}

export class AdminSessionResponseDto {
  @ApiProperty({ example: '2026-09-27T12:30:00.000Z', description: 'When the session ends if unused; it extends while in use' })
  expiresAt: string;
}
