import { ApiProperty } from '@nestjs/swagger';

export class ResolutionCountsDto {
  @ApiProperty() approved: number;
  @ApiProperty() partiallyApproved: number;
  @ApiProperty() denied: number;
}
