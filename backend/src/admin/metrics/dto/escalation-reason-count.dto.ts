import { ApiProperty } from '@nestjs/swagger';

export class EscalationReasonCountDto {
  @ApiProperty({ example: 'HIGH_VALUE' }) reason: string;
  @ApiProperty() count: number;
}
