import 'dotenv/config';
import { defineConfig } from '@prisma/config';

export default defineConfig({
  migrations: {
    seed: 'ts-node cod_fonte/database/seed.ts',
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
