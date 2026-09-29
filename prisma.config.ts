import 'dotenv/config';
import { defineConfig } from '@prisma/config';

const user = process.env.POSTGRES_USER;
const password = process.env.POSTGRES_PASSWORD || '';
const host = process.env.POSTGRES_HOST || 'localhost';
const port = process.env.POSTGRES_PORT || '5432';
const db = process.env.POSTGRES_DB;
const database_url = process.env.DATABASE_URL || `postgresql://${user}:${password}@${host}:${port}/${db}`;

export default defineConfig({
  migrations: {
    seed: 'ts-node cod_fonte/database/seed.ts',
  },
  datasource: {
    url: database_url,
  },
});
