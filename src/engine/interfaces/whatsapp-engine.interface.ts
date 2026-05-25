// WhatsApp Engine Interface - OTP-only minimal surface

export enum EngineStatus {
  DISCONNECTED = 'disconnected',
  INITIALIZING = 'initializing',
  QR_READY = 'qr_ready',
  AUTHENTICATING = 'authenticating',
  READY = 'ready',
  FAILED = 'failed',
}

export interface MessageResult {
  id: string;
  timestamp: number;
  ack?: number;
}

export interface IncomingMessage {
  id: string;
  from: string;
  to: string;
  chatId: string;
  body: string;
  type: string;
  timestamp: number;
  fromMe: boolean;
  isGroup: boolean;
}

export interface EngineEventCallbacks {
  onQRCode?: (qr: string) => void;
  onReady?: (phone: string, pushName: string) => void;
  onMessage?: (message: IncomingMessage) => void;
  onMessageAck?: (messageId: string, ack: number) => void;
  onDisconnected?: (reason: string) => void;
  onStateChanged?: (state: EngineStatus) => void;
}

export interface IWhatsAppEngine {
  // Lifecycle
  initialize(callbacks: EngineEventCallbacks): Promise<void>;
  disconnect(): Promise<void>;
  logout(): Promise<void>;
  destroy(): Promise<void>;

  // Status
  getStatus(): EngineStatus;
  getQRCode(): string | null;
  getPhoneNumber(): string | null;
  getPushName(): string | null;

  // Messaging
  sendTextMessage(chatId: string, text: string): Promise<MessageResult>;
}
