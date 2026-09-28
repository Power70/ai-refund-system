import { ApiProperty } from '@nestjs/swagger';

export class ActivePolicyDto {
  @ApiProperty({ example: '2026.09-1' }) version: string;
  @ApiProperty() effectiveFrom: string;
  @ApiProperty({ description: 'SHA-256 of the rules' }) contentHash: string;
  @ApiProperty({ description: 'The policy rendered as Markdown, as customers and reviewers read it' }) markdown: string;
  @ApiProperty({ description: 'The validated policy document' }) document: object;
}
