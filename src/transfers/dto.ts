import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsOptional, IsString, Matches, MaxLength, ValidateNested } from 'class-validator';

const DECIMAL = /^(?:0|[1-9]\d{0,19})(?:\.\d{1,18})?$/;
const TOKEN = /^[A-Za-z0-9_-]{1,64}$/;
const RAIL = /^[a-z0-9_]{1,64}$/;

export class SourceDto {
  @ApiProperty({ example: 'ach_push' })
  @IsString()
  @Matches(RAIL)
  paymentRail!: string;

  @ApiProperty({ example: 'usd' })
  @IsString()
  @Matches(RAIL)
  currency!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(256)
  fromAddress?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  bridgeWalletId?: string;

  @ApiPropertyOptional({ description: 'HTTPS return URL forwarded only for a co_bank_transfer source. This service does not fetch it.' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  senderReturnUrl?: string;
}

export class DestinationDto {
  @ApiProperty({ example: 'ethereum' })
  @IsString()
  @Matches(RAIL)
  paymentRail!: string;

  @ApiProperty({ example: 'usdc' })
  @IsString()
  @Matches(RAIL)
  currency!: string;

  @ApiPropertyOptional({ example: '0x71C7656EC7ab88b098defB751B7401B5f6d8976F' })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  toAddress?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  externalAccountId?: string;

  @ApiPropertyOptional({ description: 'Mapped to the rail-specific Bridge reference field when the charset is documented.' })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  reference?: string;
}

export class CreateTransferDto {
  @ApiProperty({
    description:
      'Decision reference that a configured compliance verifier must accept as a positive decision. A correlation string is not an approval. This service does not collect identity data or call simulate_kyc_approval.',
  })
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,128}$/)
  complianceDecisionRef!: string;

  @ApiProperty({ description: 'Existing Bridge customer id. This service does not create customers or call simulate_kyc_approval.' })
  @IsString()
  @Matches(TOKEN)
  onBehalfOf!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_.:-]{1,256}$/)
  clientReferenceId?: string;

  @ApiProperty({ example: '250.00', description: 'Decimal string. Never a JSON number.' })
  @IsString()
  @Matches(DECIMAL)
  amount!: string;

  @ApiPropertyOptional({ example: '1.25' })
  @IsOptional()
  @IsString()
  @Matches(DECIMAL)
  developerFee?: string;

  @ApiProperty({ type: SourceDto })
  @ValidateNested()
  @Type(() => SourceDto)
  source!: SourceDto;

  @ApiProperty({ type: DestinationDto })
  @ValidateNested()
  @Type(() => DestinationDto)
  destination!: DestinationDto;
}
