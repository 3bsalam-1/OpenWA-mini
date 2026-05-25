import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule } from '@nestjs/throttler';
import configuration from './config/configuration';
import { SessionModule } from './modules/session/session.module';
import { MessageModule } from './modules/message/message.module';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { EngineModule } from './engine/engine.module';
import { LoggerModule } from './common/services/logger.module';
import { HooksModule } from './core/hooks';
import { PluginsModule } from './core/plugins';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),

    // Auth/system database (SQLite, always)
    TypeOrmModule.forRootAsync({
      name: 'main',
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'sqlite' as const,
        database: configService.get<string>('database.database', './data/main.sqlite'),
        entities: [__dirname + '/modules/auth/**/*.entity{.ts,.js}'],
        synchronize: true,
        logging: configService.get<boolean>('database.logging', false),
      }),
    }),

    // Data database (sessions, messages — SQLite or Postgres)
    TypeOrmModule.forRootAsync({
      name: 'data',
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const dbType = configService.get<'sqlite' | 'postgres'>('dataDatabase.type', 'sqlite');
        const baseConfig = {
          entities: [
            __dirname + '/modules/session/**/*.entity{.ts,.js}',
            __dirname + '/modules/message/**/*.entity{.ts,.js}',
          ],
          migrations: [__dirname + '/database/migrations/*{.ts,.js}'],
          logging: configService.get<boolean>('dataDatabase.logging', false),
        };

        if (dbType === 'postgres') {
          return {
            ...baseConfig,
            type: 'postgres' as const,
            host: configService.get<string>('dataDatabase.host'),
            port: configService.get<number>('dataDatabase.port'),
            username: configService.get<string>('dataDatabase.username'),
            password: configService.get<string>('dataDatabase.password'),
            database: 'openwa-mini',
            synchronize: configService.get<boolean>('dataDatabase.synchronize', false),
            migrationsRun: true,
            retryAttempts: 10,
            retryDelay: 3000,
            extra: { max: configService.get<number>('dataDatabase.poolSize', 10) },
          };
        }

        return {
          ...baseConfig,
          type: 'sqlite' as const,
          database: configService.get<string>('dataDatabase.database', './data/openwa-mini.sqlite'),
          synchronize: configService.get<boolean>('dataDatabase.synchronize', true),
          migrationsRun: !configService.get<boolean>('dataDatabase.synchronize', true),
        };
      },
    }),

    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        throttlers: [
          {
            name: 'short',
            ttl: configService.get<number>('api.rateLimit.shortTtl', 1000),
            limit: configService.get<number>('api.rateLimit.shortLimit', 10),
          },
          {
            name: 'medium',
            ttl: configService.get<number>('api.rateLimit.mediumTtl', 60000),
            limit: configService.get<number>('api.rateLimit.mediumLimit', 100),
          },
          {
            name: 'long',
            ttl: configService.get<number>('api.rateLimit.longTtl', 3600000),
            limit: configService.get<number>('api.rateLimit.longLimit', 1000),
          },
        ],
      }),
    }),

    HooksModule,
    PluginsModule,
    LoggerModule,
    AuthModule,
    EngineModule,
    SessionModule,
    MessageModule,
    HealthModule,
  ],
})
export class AppModule {}
