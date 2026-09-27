import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, Length, Matches } from 'class-validator';

export class StartSessionDto {
  @ApiProperty({ example: 'ada.okafor@example.com' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  @Length(3, 254)
  email: string;

  @ApiProperty({ example: 'WN-7K3P9Q' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsString()
  @Matches(/^WN-[A-Z0-9]{6}$/, { message: 'orderNumber looks like WN-7K3P9Q' })
  orderNumber: string;
}
