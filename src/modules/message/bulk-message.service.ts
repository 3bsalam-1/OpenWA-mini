import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import {
  MessageBatch,
  BatchStatus,
  BatchMessageStatus,
  BatchProgress,
  BatchMessageResult,
} from './entities/message-batch.entity';
import { SendBulkMessageDto } from './dto/bulk-message.dto';
import { SessionService } from '../session/session.service';

@Injectable()
export class BulkMessageService {
  private readonly logger = new Logger(BulkMessageService.name);
  private readonly processingBatches = new Map<string, boolean>();

  constructor(
    @InjectRepository(MessageBatch, 'data')
    private readonly batchRepository: Repository<MessageBatch>,
    private readonly sessionService: SessionService,
  ) {}

  async createBatch(sessionId: string, dto: SendBulkMessageDto): Promise<MessageBatch> {
    const engine = this.sessionService.getEngine(sessionId);
    if (!engine) {
      throw new BadRequestException(`Session '${sessionId}' is not active`);
    }

    const batchId = dto.batchId || `batch_${randomUUID().split('-')[0]}`;

    const existing = await this.batchRepository.findOne({ where: { batchId } });
    if (existing) {
      throw new BadRequestException(`Batch ID '${batchId}' already exists`);
    }

    const options = {
      delayBetweenMessages: dto.options?.delayBetweenMessages ?? 3000,
      randomizeDelay: dto.options?.randomizeDelay ?? true,
      stopOnError: dto.options?.stopOnError ?? false,
    };

    const progress: BatchProgress = {
      total: dto.messages.length,
      sent: 0,
      failed: 0,
      pending: dto.messages.length,
      cancelled: 0,
    };

    // Normalise to the internal message-batch shape (type=text, content.text)
    const messages = dto.messages.map(m => ({
      chatId: m.chatId,
      type: 'text' as const,
      content: { text: m.text },
      variables: m.variables,
    }));

    const batch = this.batchRepository.create({
      batchId,
      sessionId,
      status: BatchStatus.PENDING,
      messages: messages as MessageBatch['messages'],
      options,
      progress,
      results: [],
      currentIndex: 0,
    });

    await this.batchRepository.save(batch);
    this.logger.log(`Created batch ${batchId} with ${dto.messages.length} messages`);

    this.processBatch(batch.id).catch(err => {
      this.logger.error(`Batch ${batchId} processing error: ${String(err)}`);
    });

    return batch;
  }

  async getBatchStatus(sessionId: string, batchId: string): Promise<MessageBatch> {
    const batch = await this.batchRepository.findOne({ where: { batchId, sessionId } });
    if (!batch) throw new NotFoundException(`Batch '${batchId}' not found`);
    return batch;
  }

  async cancelBatch(sessionId: string, batchId: string): Promise<MessageBatch> {
    const batch = await this.batchRepository.findOne({ where: { batchId, sessionId } });
    if (!batch) throw new NotFoundException(`Batch '${batchId}' not found`);

    if (batch.status === BatchStatus.COMPLETED || batch.status === BatchStatus.CANCELLED) {
      throw new BadRequestException(`Batch '${batchId}' is already ${batch.status}`);
    }

    this.processingBatches.set(batch.id, false);
    batch.status = BatchStatus.CANCELLED;
    batch.progress.cancelled = batch.progress.total - batch.progress.sent - batch.progress.failed;
    batch.progress.pending = 0;
    batch.completedAt = new Date();

    await this.batchRepository.save(batch);
    this.logger.log(`Cancelled batch ${batchId}`);
    return batch;
  }

  private async processBatch(batchDbId: string): Promise<void> {
    const batch = await this.batchRepository.findOne({ where: { id: batchDbId } });
    if (!batch) return;

    this.processingBatches.set(batch.id, true);
    batch.status = BatchStatus.PROCESSING;
    batch.startedAt = new Date();
    await this.batchRepository.save(batch);

    const engine = this.sessionService.getEngine(batch.sessionId);
    if (!engine) {
      batch.status = BatchStatus.FAILED;
      batch.completedAt = new Date();
      await this.batchRepository.save(batch);
      return;
    }

    const results: BatchMessageResult[] = batch.results || [];

    for (let i = batch.currentIndex; i < batch.messages.length; i++) {
      if (!this.processingBatches.get(batch.id)) break;

      const msg = batch.messages[i];
      const result: BatchMessageResult = { chatId: msg.chatId, status: BatchMessageStatus.PENDING };

      try {
        const text = this.applyVariables((msg.content as { text?: string }).text || '', msg.variables);
        const messageResult = await engine.sendTextMessage(msg.chatId, text);

        result.status = BatchMessageStatus.SENT;
        result.messageId = messageResult.id;
        result.sentAt = new Date();
        batch.progress.sent++;
        batch.progress.pending--;

        this.logger.debug(`Batch ${batch.batchId}: ${i + 1}/${batch.messages.length} → ${msg.chatId}`);
      } catch (error) {
        result.status = BatchMessageStatus.FAILED;
        result.error = { code: 'SEND_FAILED', message: String(error) };
        batch.progress.failed++;
        batch.progress.pending--;

        this.logger.warn(`Batch ${batch.batchId}: failed ${i + 1} → ${msg.chatId}: ${String(error)}`);

        if (batch.options.stopOnError) {
          batch.status = BatchStatus.FAILED;
          results.push(result);
          break;
        }
      }

      results.push(result);
      batch.currentIndex = i + 1;
      batch.results = results;

      if (i % 10 === 0 || i === batch.messages.length - 1) {
        await this.batchRepository.save(batch);
      }

      if (i < batch.messages.length - 1 && this.processingBatches.get(batch.id)) {
        await this.sleep(this.calculateDelay(batch.options));
      }
    }

    if (this.processingBatches.get(batch.id)) {
      batch.status =
        batch.progress.failed > 0 && batch.progress.sent === 0 ? BatchStatus.FAILED : BatchStatus.COMPLETED;
    }
    batch.completedAt = new Date();
    batch.results = results;
    await this.batchRepository.save(batch);

    this.processingBatches.delete(batch.id);
    this.logger.log(`Batch ${batch.batchId} done: ${batch.progress.sent} sent, ${batch.progress.failed} failed`);
  }

  private applyVariables(text: string, variables?: Record<string, string>): string {
    if (!variables) return text;
    return text.replace(/\{(\w+)\}/g, (_, key: string) => variables[key] || `{${key}}`);
  }

  private calculateDelay(options: { delayBetweenMessages: number; randomizeDelay: boolean }): number {
    return options.delayBetweenMessages + (options.randomizeDelay ? Math.random() * 2000 : 0);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
