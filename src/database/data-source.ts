import { DataSource } from 'typeorm';
import { config } from 'dotenv';

config();

const dbType = process.env.DATABASE_TYPE || 'sqlite';

const sqliteDataSource = new DataSource({
  type: 'sqlite',
  database: process.env.DATABASE_NAME || './data/openwa-mini.sqlite',
  entities: [__dirname + '/../**/*.entity{.ts,.js}'],
  migrations: [__dirname + '/migrations/*{.ts,.js}'],
  synchronize: false,
  logging: process.env.DATABASE_LOGGING === 'true',
});

const postgresDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DATABASE_HOST || 'localhost',
  port: parseInt(process.env.DATABASE_PORT || '5432', 10),
  username: process.env.DATABASE_USERNAME,
  password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME || 'openwa-mini',
  entities: [__dirname + '/../**/*.entity{.ts,.js}'],
  migrations: [__dirname + '/migrations/*{.ts,.js}'],
  synchronize: false,
  logging: process.env.DATABASE_LOGGING === 'true',
  extra: {
    max: parseInt(process.env.DATABASE_POOL_SIZE || '10', 10),
  },
});

export default dbType === 'postgres' ? postgresDataSource : sqliteDataSource;
