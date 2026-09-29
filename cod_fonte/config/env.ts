import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const env_schema = z.object({
  PORT: z.string(),
  POSTGRES_USER: z.string(),
  POSTGRES_PASSWORD: z.string(),
  POSTGRES_HOST: z.string().default('localhost'),
  POSTGRES_PORT: z.coerce.number().default(5432),
  POSTGRES_DB: z.string(),
  DATABASE_URL: z.string().optional(),
  OPENAI_API_KEY: z.string().min(1),
  NVIDIA_NIM_BASE_URL: z.string().default('https://integrate.api.nvidia.com/v1'),
  NVIDIA_NIM_MODEL: z.string().default('meta/llama3-70b-instruct'),
  NVIDIA_NIM_EMBEDDING_MODEL: z.string().default('nvidia/nv-embedqa-e5-v5'),
  CHATWOOT_BASE_URL: z.string().default('http://chatwoot:3000'),
  CHATWOOT_API_TOKEN: z.string().optional(),
  LANGSMITH_TRACING: z.string().default('false'),
  LANGSMITH_API_KEY: z.string().optional(),
  LANGSMITH_PROJECT: z.string().default('default'),
  LANGSMITH_ENDPOINT: z.string().default('https://api.smith.langchain.com'),
  RATE_LIMIT_IP_MAX_REQUESTS: z.coerce.number().default(30),
  RATE_LIMIT_IP_WINDOW_MS: z.coerce.number().default(60000),
  RATE_LIMIT_PHONE_MAX_REQUESTS: z.coerce.number().default(10),
  RATE_LIMIT_PHONE_WINDOW_MS: z.coerce.number().default(60000),
  LOG_DIR: z.string().default('./logs'),
  LOG_MAX_LINES: z.coerce.number().default(10000),
  LOG_MAX_FILES: z.coerce.number().default(1),
  QUEUE_DEBOUNCE_MS: z.coerce.number().default(1500)
}).transform((data) => {
  const dynamic_database_url = data.DATABASE_URL || `postgresql://${data.POSTGRES_USER}:${data.POSTGRES_PASSWORD}@${data.POSTGRES_HOST}:${data.POSTGRES_PORT}/${data.POSTGRES_DB}`;
  return {
    ...data,
    DATABASE_URL: dynamic_database_url,
  };
});

const parsed = env_schema.safeParse(process.env);

if (!parsed.success) {
  console.error('Configuração de variáveis de ambiente inválida:', parsed.error.format());
  process.exit(1);
}

export const env = parsed.data;

process.env.DATABASE_URL = env.DATABASE_URL;

if (env.LANGSMITH_TRACING === 'true') {
  process.env.LANGCHAIN_TRACING_V2 = 'true';
  process.env.LANGSMITH_TRACING = 'true';
  if (env.LANGSMITH_API_KEY) {
    process.env.LANGCHAIN_API_KEY = env.LANGSMITH_API_KEY;
    process.env.LANGSMITH_API_KEY = env.LANGSMITH_API_KEY;
  }
  if (env.LANGSMITH_PROJECT) {
    process.env.LANGCHAIN_PROJECT = env.LANGSMITH_PROJECT;
    process.env.LANGSMITH_PROJECT = env.LANGSMITH_PROJECT;
  }
  if (env.LANGSMITH_ENDPOINT) {
    process.env.LANGCHAIN_ENDPOINT = env.LANGSMITH_ENDPOINT;
    process.env.LANGSMITH_ENDPOINT = env.LANGSMITH_ENDPOINT;
  }
}
