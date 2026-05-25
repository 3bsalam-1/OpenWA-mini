import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BadRequestException } from '@nestjs/common';
import { MessageService } from './message.service';
import { Message, MessageDirection, MessageStatus } from './entities/message.entity';
import { SessionService } from '../session/session.service';
import { HookManager } from '../../core/hooks';

const mockEngineResult = { id: 'wa-msg-1', timestamp: 1706868000 };

describe('MessageService', () => {
  let service: MessageService;
  let repository: jest.Mocked<Partial<Repository<Message>>>;
  let sessionService: jest.Mocked<Partial<SessionService>>;
  let hookManager: jest.Mocked<Partial<HookManager>>;
  let mockEngine: { sendTextMessage: jest.Mock };

  beforeEach(async () => {
    repository = {
      create: jest.fn().mockImplementation((data: Partial<Message>) => ({ id: 'msg-uuid-1', ...data }) as Message),
      save: jest.fn().mockImplementation(msg => Promise.resolve(msg)),
      createQueryBuilder: jest.fn(),
    };

    mockEngine = {
      sendTextMessage: jest.fn().mockResolvedValue(mockEngineResult),
    };

    sessionService = {
      getEngine: jest.fn().mockReturnValue(mockEngine),
      findOne: jest.fn().mockResolvedValue({ id: 'sess-1', phone: '628123456789' }),
    };

    hookManager = {
      execute: jest.fn().mockResolvedValue({
        continue: true,
        data: { sessionId: 'sess-1', input: { chatId: '628123456789@c.us', text: 'Hello' }, type: 'text' },
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MessageService,
        { provide: getRepositoryToken(Message, 'data'), useValue: repository },
        { provide: SessionService, useValue: sessionService },
        { provide: HookManager, useValue: hookManager },
      ],
    }).compile();

    service = module.get<MessageService>(MessageService);
  });

  // ── sendText ──────────────────────────────────────────────────────

  describe('sendText', () => {
    it('should send text message and return messageId + timestamp', async () => {
      const result = await service.sendText('sess-1', {
        chatId: '628123456789@c.us',
        text: 'Hello',
      });

      expect(result.messageId).toBe('wa-msg-1');
      expect(result.timestamp).toBe(1706868000);
      expect(mockEngine.sendTextMessage).toHaveBeenCalledWith('628123456789@c.us', 'Hello');
    });

    it('should save outgoing message as pending before sending, then update to sent', async () => {
      await service.sendText('sess-1', {
        chatId: '628123456789@c.us',
        text: 'Hello',
      });

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'sess-1',
          direction: MessageDirection.OUTGOING,
          type: 'text',
          body: 'Hello',
          status: MessageStatus.PENDING,
        }),
      );
      expect(repository.save).toHaveBeenCalledTimes(2);
    });

    it('should execute message:sending and message:sent hooks', async () => {
      await service.sendText('sess-1', {
        chatId: '628123456789@c.us',
        text: 'Hello',
      });

      expect(hookManager.execute).toHaveBeenCalledWith(
        'message:sending',
        expect.objectContaining({ type: 'text' }),
        expect.any(Object),
      );
      expect(hookManager.execute).toHaveBeenCalledWith(
        'message:sent',
        expect.objectContaining({ result: mockEngineResult }),
        expect.any(Object),
      );
    });

    it('should throw BadRequestException when plugin blocks sending', async () => {
      (hookManager.execute as jest.Mock).mockResolvedValueOnce({ continue: false, data: {} });

      await expect(service.sendText('sess-1', { chatId: 'test@c.us', text: 'blocked' })).rejects.toThrow(
        'Message sending blocked by plugin',
      );
    });

    it('should throw BadRequestException if session is not active', async () => {
      (sessionService.getEngine as jest.Mock).mockReturnValue(undefined);

      await expect(service.sendText('inactive', { chatId: 'test@c.us', text: 'hello' })).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ── saveIncomingMessage ───────────────────────────────────────────

  describe('saveIncomingMessage', () => {
    it('should save with INCOMING direction', async () => {
      await service.saveIncomingMessage('sess-1', {
        waMessageId: 'wa-in-1',
        chatId: 'sender@c.us',
        body: 'Hi there',
        type: 'text',
      });

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'sess-1',
          direction: MessageDirection.INCOMING,
        }),
      );
    });
  });
});
