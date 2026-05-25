import { Injectable, NotFoundException, UnauthorizedException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash, randomBytes } from 'crypto';
import { existsSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { ApiKey, ApiKeyRole } from './entities/api-key.entity';
import { CreateApiKeyDto, UpdateApiKeyDto } from './dto';
import { createLogger } from '../../common/services/logger.service';

const API_KEY_FILE = join(process.cwd(), 'data', '.api-key');
const DEFAULT_KEY_NAME = 'Default Admin Key';

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = createLogger('AuthService');

  constructor(
    @InjectRepository(ApiKey, 'main')
    private readonly apiKeyRepository: Repository<ApiKey>,
  ) {}

  async onModuleInit(): Promise<void> {
    const envKey = process.env.API_KEY?.trim();
    let displayKey: string;
    let keySource: 'env' | 'new' | 'existing';

    if (envKey) {
      // Sync the env key into the DB (replace the default key if it differs)
      await this.syncEnvKey(envKey);
      displayKey = envKey;
      keySource = 'env';
    } else {
      const count = await this.apiKeyRepository.count();

      if (count === 0) {
        // First boot, no env key — auto-generate
        displayKey =
          process.env.NODE_ENV === 'production' ? `owa_k1_${randomBytes(32).toString('hex')}` : 'dev-admin-key';
        await this.seedApiKey(displayKey, DEFAULT_KEY_NAME, ApiKeyRole.ADMIN);
        try {
          writeFileSync(API_KEY_FILE, displayKey, 'utf-8');
        } catch (err) {
          this.logger.warn('Could not save API key file', { error: String(err) });
        }
        keySource = 'new';
      } else {
        // Keys already exist — read from file
        if (existsSync(API_KEY_FILE)) {
          try {
            displayKey = readFileSync(API_KEY_FILE, 'utf-8').trim();
          } catch (error) {
            this.logger.warn(`Failed to read API key file: ${API_KEY_FILE}`, { error: String(error) });
            displayKey = '(set API_KEY in .env to configure)';
          }
        } else {
          displayKey = '(set API_KEY in .env to configure)';
        }
        keySource = 'existing';
      }
    }

    const apiBaseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 2785}`;

    this.logger.log('');
    this.logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    this.logger.log('');
    this.logger.log('  🟢 Welcome to OpenWA - WhatsApp API Gateway');
    this.logger.log('');
    this.logger.log(`  📚 API Docs:  ${apiBaseUrl}/api/docs`);
    this.logger.log('');
    if (keySource === 'env') {
      this.logger.log('  🔑 API Key (from API_KEY env):');
    } else if (keySource === 'new') {
      this.logger.log('  🔑 API Key (auto-generated — set API_KEY in .env to pin it):');
    } else {
      this.logger.log('  🔑 API Key:');
    }
    this.logger.log(`     ${displayKey}`);
    this.logger.log('');
    this.logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    this.logger.log('');
  }

  // Ensure the env-supplied key is the active default key.
  // If it already exists in the DB, nothing changes.
  // If it doesn't exist, the old default key is replaced with the new value.
  private async syncEnvKey(rawKey: string): Promise<void> {
    const keyHash = this.hashKey(rawKey);
    const existing = await this.apiKeyRepository.findOne({ where: { keyHash } });
    if (existing) return; // env key already active

    // Replace the auto-seeded default key with the new env value
    const defaultKey = await this.apiKeyRepository.findOne({ where: { name: DEFAULT_KEY_NAME } });
    if (defaultKey) {
      defaultKey.keyHash = keyHash;
      defaultKey.keyPrefix = rawKey.substring(0, 12);
      await this.apiKeyRepository.save(defaultKey);
    } else {
      await this.seedApiKey(rawKey, DEFAULT_KEY_NAME, ApiKeyRole.ADMIN);
    }

    try {
      writeFileSync(API_KEY_FILE, rawKey, 'utf-8');
    } catch (err) {
      this.logger.warn('Could not save API key file', { error: String(err) });
    }

    this.logger.log('API key updated from API_KEY env variable', { action: 'api_key_synced' });
  }

  private async seedApiKey(rawKey: string, name: string, role: ApiKeyRole): Promise<ApiKey> {
    const keyHash = this.hashKey(rawKey);
    const keyPrefix = rawKey.substring(0, 12);

    const apiKey = this.apiKeyRepository.create({ name, keyHash, keyPrefix, role });
    return this.apiKeyRepository.save(apiKey);
  }

  async createApiKey(dto: CreateApiKeyDto): Promise<{ apiKey: ApiKey; rawKey: string }> {
    const rawKey = `owa_k1_${randomBytes(32).toString('hex')}`;
    const keyHash = this.hashKey(rawKey);
    const keyPrefix = rawKey.substring(0, 12);

    const apiKey = this.apiKeyRepository.create({
      name: dto.name,
      keyHash,
      keyPrefix,
      role: dto.role || ApiKeyRole.OPERATOR,
      allowedIps: dto.allowedIps || null,
      allowedSessions: dto.allowedSessions || null,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
    });

    const saved = await this.apiKeyRepository.save(apiKey);
    this.logger.log(`API key created: ${saved.name}`, { keyId: saved.id, role: saved.role, action: 'api_key_created' });

    return { apiKey: saved, rawKey };
  }

  async findAll(): Promise<ApiKey[]> {
    return this.apiKeyRepository.find({ order: { createdAt: 'DESC' } });
  }

  async findOne(id: string): Promise<ApiKey> {
    const apiKey = await this.apiKeyRepository.findOne({ where: { id } });
    if (!apiKey) {
      throw new NotFoundException(`API key with id '${id}' not found`);
    }
    return apiKey;
  }

  async update(id: string, dto: UpdateApiKeyDto): Promise<ApiKey> {
    const apiKey = await this.findOne(id);

    if (dto.name) apiKey.name = dto.name;
    if (dto.role) apiKey.role = dto.role;
    if (dto.allowedIps !== undefined) apiKey.allowedIps = dto.allowedIps;
    if (dto.allowedSessions !== undefined) apiKey.allowedSessions = dto.allowedSessions;
    if (dto.expiresAt !== undefined) apiKey.expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;

    return this.apiKeyRepository.save(apiKey);
  }

  async delete(id: string): Promise<void> {
    const apiKey = await this.findOne(id);
    await this.apiKeyRepository.remove(apiKey);
    this.logger.log(`API key deleted: ${apiKey.name}`, { keyId: id, action: 'api_key_deleted' });
  }

  async revoke(id: string): Promise<ApiKey> {
    const apiKey = await this.findOne(id);
    apiKey.isActive = false;
    return this.apiKeyRepository.save(apiKey);
  }

  async validateApiKey(rawKey: string, clientIp?: string, sessionId?: string): Promise<ApiKey> {
    const keyHash = this.hashKey(rawKey);
    const apiKey = await this.apiKeyRepository.findOne({ where: { keyHash } });

    if (!apiKey) {
      throw new UnauthorizedException('Invalid API key');
    }

    if (!apiKey.isActive) {
      throw new UnauthorizedException('API key is revoked');
    }

    if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
      throw new UnauthorizedException('API key has expired');
    }

    if (apiKey.allowedIps && apiKey.allowedIps.length > 0 && clientIp) {
      if (!this.isIpAllowed(clientIp, apiKey.allowedIps)) {
        this.logger.warn(`IP not allowed: ${clientIp}`, { keyId: apiKey.id, action: 'ip_rejected' });
        throw new UnauthorizedException('IP address not allowed');
      }
    }

    if (apiKey.allowedSessions && apiKey.allowedSessions.length > 0 && sessionId) {
      if (!apiKey.allowedSessions.includes(sessionId)) {
        throw new UnauthorizedException('API key not authorized for this session');
      }
    }

    apiKey.lastUsedAt = new Date();
    apiKey.usageCount += 1;
    await this.apiKeyRepository.save(apiKey);

    return apiKey;
  }

  private hashKey(rawKey: string): string {
    return createHash('sha256').update(rawKey).digest('hex');
  }

  private isIpAllowed(clientIp: string, allowedIps: string[]): boolean {
    for (const entry of allowedIps) {
      if (entry.includes('/')) {
        if (this.ipInCidr(clientIp, entry)) return true;
      } else {
        if (clientIp === entry) return true;
      }
    }
    return false;
  }

  private ipInCidr(ip: string, cidr: string): boolean {
    try {
      const [range, bitsStr] = cidr.split('/');
      const bits = parseInt(bitsStr, 10);
      if (isNaN(bits) || bits < 0 || bits > 32) return false;
      const mask = ~(2 ** (32 - bits) - 1);
      const ipNum = this.ipToNumber(ip);
      const rangeNum = this.ipToNumber(range);
      return (ipNum & mask) === (rangeNum & mask);
    } catch (error) {
      this.logger.warn(`Invalid CIDR format: ${cidr}`, { error: String(error) });
      return false;
    }
  }

  private ipToNumber(ip: string): number {
    const parts = ip.split('.');
    if (parts.length !== 4) return 0;
    return parts.reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
  }

  hasPermission(apiKey: ApiKey, requiredRole: ApiKeyRole): boolean {
    const roleHierarchy: Record<ApiKeyRole, number> = {
      [ApiKeyRole.VIEWER]: 1,
      [ApiKeyRole.OPERATOR]: 2,
      [ApiKeyRole.ADMIN]: 3,
    };
    return roleHierarchy[apiKey.role] >= roleHierarchy[requiredRole];
  }
}
