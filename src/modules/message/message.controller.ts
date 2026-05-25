import { Controller, Post, Get, Param, Body, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { MessageService } from './message.service';
import { BulkMessageService } from './bulk-message.service';
import { SendTextMessageDto, MessageResponseDto } from './dto';
import { SendBulkMessageDto, BulkMessageResponseDto } from './dto/bulk-message.dto';
import { RequireRole } from '../auth/decorators/auth.decorators';
import { ApiKeyRole } from '../auth/entities/api-key.entity';

@ApiTags('messages')
@Controller('sessions/:sessionId/messages')
export class MessageController {
  constructor(
    private readonly messageService: MessageService,
    private readonly bulkMessageService: BulkMessageService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get message history for a session' })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiQuery({ name: 'chatId', required: false })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  async getMessages(
    @Param('sessionId') sessionId: string,
    @Query('chatId') chatId?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.messageService.getMessages(sessionId, {
      chatId,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  @Post('send-text')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'Send a text message' })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiResponse({ status: 201, type: MessageResponseDto })
  async sendText(@Param('sessionId') sessionId: string, @Body() dto: SendTextMessageDto): Promise<MessageResponseDto> {
    return this.messageService.sendText(sessionId, dto);
  }

  @Post('send-bulk')
  @RequireRole(ApiKeyRole.OPERATOR)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Send the same text message to multiple recipients' })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiResponse({ status: 202, type: BulkMessageResponseDto })
  async sendBulk(
    @Param('sessionId') sessionId: string,
    @Body() dto: SendBulkMessageDto,
  ): Promise<BulkMessageResponseDto> {
    const batch = await this.bulkMessageService.createBatch(sessionId, dto);
    const estimatedTime = new Date(Date.now() + batch.messages.length * (batch.options?.delayBetweenMessages || 3000));
    return {
      batchId: batch.batchId,
      status: batch.status,
      totalMessages: batch.messages.length,
      estimatedCompletionTime: estimatedTime.toISOString(),
      statusUrl: `/api/sessions/${sessionId}/messages/batch/${batch.batchId}`,
    };
  }

  @Get('batch/:batchId')
  @ApiOperation({ summary: 'Get bulk send batch status' })
  @ApiParam({ name: 'sessionId' })
  @ApiParam({ name: 'batchId' })
  async getBatchStatus(@Param('sessionId') sessionId: string, @Param('batchId') batchId: string) {
    const batch = await this.bulkMessageService.getBatchStatus(sessionId, batchId);
    return {
      batchId: batch.batchId,
      status: batch.status,
      progress: batch.progress,
      results: batch.results,
      startedAt: batch.startedAt,
      completedAt: batch.completedAt,
    };
  }

  @Post('batch/:batchId/cancel')
  @RequireRole(ApiKeyRole.OPERATOR)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a running bulk send batch' })
  async cancelBatch(@Param('sessionId') sessionId: string, @Param('batchId') batchId: string) {
    const batch = await this.bulkMessageService.cancelBatch(sessionId, batchId);
    return { batchId: batch.batchId, status: batch.status, progress: batch.progress };
  }
}
