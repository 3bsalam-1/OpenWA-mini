import { EventEmitter } from 'events';
import { Client, LocalAuth } from 'whatsapp-web.js';
import * as qrcode from 'qrcode';
import * as path from 'path';
import {
  IWhatsAppEngine,
  EngineStatus,
  EngineEventCallbacks,
  MessageResult,
  IncomingMessage,
} from '../interfaces/whatsapp-engine.interface';
import { createLogger } from '../../common/services/logger.service';

export interface WhatsAppWebJsConfig {
  sessionId: string;
  sessionDataPath: string;
  puppeteer?: {
    headless?: boolean;
    args?: string[];
  };
  proxy?: {
    url: string;
    type: 'http' | 'https' | 'socks4' | 'socks5';
  };
}

export class WhatsAppWebJsAdapter extends EventEmitter implements IWhatsAppEngine {
  private client: Client | null = null;
  private status: EngineStatus = EngineStatus.DISCONNECTED;
  private qrCode: string | null = null;
  private phoneNumber: string | null = null;
  private pushName: string | null = null;
  private callbacks: EngineEventCallbacks = {};

  constructor(private readonly config: WhatsAppWebJsConfig) {
    super();
  }

  private readonly logger = createLogger('WhatsAppWebJsAdapter');

  async initialize(callbacks: EngineEventCallbacks): Promise<void> {
    this.callbacks = callbacks;
    this.setStatus(EngineStatus.INITIALIZING);

    try {
      const puppeteerArgs = this.config.puppeteer?.args || [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
      ];

      if (this.config.proxy) {
        puppeteerArgs.push(`--proxy-server=${this.config.proxy.url}`);
        this.logger.log(
          `Using proxy: ${this.config.proxy.type}://${this.config.proxy.url.replace(/:[^:@]*@/, ':***@')}`,
        );
      }

      this.client = new Client({
        authStrategy: new LocalAuth({
          clientId: this.config.sessionId,
          dataPath: path.resolve(this.config.sessionDataPath),
        }),
        puppeteer: {
          headless: this.config.puppeteer?.headless ?? true,
          args: puppeteerArgs,
        },
      });

      this.setupEventHandlers();
      await this.client.initialize();
    } catch (error) {
      this.setStatus(EngineStatus.FAILED);
      throw error;
    }
  }

  private setupEventHandlers(): void {
    if (!this.client) return;

    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    this.client.on('qr', async (qr: string) => {
      try {
        this.qrCode = await qrcode.toDataURL(qr);
        this.setStatus(EngineStatus.QR_READY);
        this.callbacks.onQRCode?.(this.qrCode);
      } catch (error) {
        this.logger.error('Error generating QR code', String(error));
      }
    });

    this.client.on('authenticated', () => {
      this.setStatus(EngineStatus.AUTHENTICATING);
      this.qrCode = null;
    });

    this.client.on('ready', () => {
      try {
        const info = this.client?.info;
        this.phoneNumber = info?.wid?.user || null;
        this.pushName = info?.pushname || null;
        this.setStatus(EngineStatus.READY);
        this.callbacks.onReady?.(this.phoneNumber || '', this.pushName || '');
      } catch (error) {
        this.logger.error('Error getting client info', String(error));
        this.setStatus(EngineStatus.READY);
        this.callbacks.onReady?.('', '');
      }
    });

    this.client.on('message', msg => {
      try {
        const incomingMessage: IncomingMessage = {
          id: msg.id._serialized,
          from: msg.from,
          to: msg.to,
          chatId: msg.from,
          body: msg.body,
          type: msg.type,
          timestamp: msg.timestamp,
          fromMe: msg.fromMe,
          isGroup: msg.from.endsWith('@g.us'),
        };
        this.callbacks.onMessage?.(incomingMessage);
      } catch (error) {
        this.logger.error('Error processing incoming message', String(error));
      }
    });

    this.client.on('message_ack', (msg, ack) => {
      this.callbacks.onMessageAck?.(msg.id._serialized, ack);
    });

    this.client.on('disconnected', reason => {
      this.setStatus(EngineStatus.DISCONNECTED);
      this.callbacks.onDisconnected?.(reason);
    });

    this.client.on('auth_failure', () => {
      this.setStatus(EngineStatus.FAILED);
      this.callbacks.onDisconnected?.('Authentication failed');
    });
  }

  private setStatus(status: EngineStatus): void {
    this.status = status;
    this.callbacks.onStateChanged?.(status);
    this.emit('stateChanged', status);
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      try {
        await this.client.destroy();
      } catch (error) {
        this.logger.warn('Destroy client failed:', String(error));
      }
      this.client = null;
      this.setStatus(EngineStatus.DISCONNECTED);
    }
  }

  async logout(): Promise<void> {
    if (this.client) {
      try {
        await this.client.logout();
      } catch (error) {
        this.logger.warn('Logout failed:', String(error));
        try {
          await this.client.destroy();
        } catch (destroyError) {
          this.logger.warn('Client destroy also failed during logout fallback', String(destroyError));
        }
      }
      this.client = null;
      this.setStatus(EngineStatus.DISCONNECTED);
    }
  }

  async destroy(): Promise<void> {
    if (this.client) {
      await this.client.destroy();
      this.client = null;
      this.setStatus(EngineStatus.DISCONNECTED);
    }
  }

  getStatus(): EngineStatus {
    return this.status;
  }

  getQRCode(): string | null {
    return this.qrCode;
  }

  getPhoneNumber(): string | null {
    return this.phoneNumber;
  }

  getPushName(): string | null {
    return this.pushName;
  }

  async sendTextMessage(chatId: string, text: string): Promise<MessageResult> {
    this.ensureReady();
    const msg = await this.client!.sendMessage(chatId, text);
    return {
      id: msg.id._serialized,
      timestamp: msg.timestamp,
    };
  }

  private ensureReady(): void {
    if (this.status !== EngineStatus.READY || !this.client) {
      throw new Error('WhatsApp client is not ready');
    }
  }
}
