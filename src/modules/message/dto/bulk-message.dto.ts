import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsArray, IsOptional, IsNumber, IsBoolean, ValidateNested, Min, Max, ArrayMaxSize, IsNotEmpty } from 'class-validator';
import { Type } from 'class-transformer';

class BulkMessageItemDto {
  @ApiProperty({ description: 'Recipient chat ID', example: '966512345678@c.us' })
  @IsString()
  @IsNotEmpty()
  chatId: string;

  @ApiProperty({ description: 'Text message content', maxLength: 4096 })
  @IsString()
  @IsNotEmpty()
  text: string;

  @ApiPropertyOptional({ description: 'Template variables for substitution (e.g. {name} → "Ahmed")' })
  @IsOptional()
  variables?: Record<string, string>;
}

class BulkMessageOptionsDto {
  @ApiPropertyOptional({ description: 'Delay between messages in ms (min: 1000, default: 3000)', default: 3000 })
  @IsOptional()
  @IsNumber()
  @Min(1000)
  @Max(60000)
  delayBetweenMessages?: number;

  @ApiPropertyOptional({ description: 'Add random 0-2s to delay', default: true })
  @IsOptional()
  @IsBoolean()
  randomizeDelay?: boolean;

  @ApiPropertyOptional({ description: 'Stop batch on first error', default: false })
  @IsOptional()
  @IsBoolean()
  stopOnError?: boolean;
}

export class SendBulkMessageDto {
  @ApiPropertyOptional({ description: 'Custom batch ID (auto-generated if not provided)' })
  @IsOptional()
  @IsString()
  batchId?: string;

  @ApiProperty({ description: 'Recipients and their messages (max 100)', type: [BulkMessageItemDto] })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => BulkMessageItemDto)
  messages: BulkMessageItemDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateNested()
  @Type(() => BulkMessageOptionsDto)
  options?: BulkMessageOptionsDto;
}

export class BulkMessageResponseDto {
  @ApiProperty()
  batchId: string;

  @ApiProperty()
  status: string;

  @ApiProperty()
  totalMessages: number;

  @ApiPropertyOptional()
  estimatedCompletionTime?: string;

  @ApiProperty()
  statusUrl: string;
}
