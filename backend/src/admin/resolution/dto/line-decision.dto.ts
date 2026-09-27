import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsUUID } from 'class-validator';

export class LineDecisionDto {
  @ApiProperty({ format: 'uuid', description: 'lineId from the case brief' })
  @IsUUID()
  lineId: string;

  @ApiProperty({ description: 'true refunds this line; false does not' })
  @IsBoolean()
  approve: boolean;
}
