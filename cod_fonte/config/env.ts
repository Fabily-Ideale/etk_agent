import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  PORT: z.string().default('3000'),
  DATABASE_URL: z.string().url(),
  OPENAI_API_KEY: z.string().min(1),
  NVIDIA_NIM_API_KEY: z.string().optional(),
  NVIDIA_NIM_BASE_URL: z.string().default('https://integrate.api.nvidia.com/v1'),
  NVIDIA_NIM_MODEL: z.string().default('meta/llama3-70b-instruct'),
  NVIDIA_NIM_EMBEDDING_MODEL: z.string().default('nvidia/nv-embedqa-e5-v5'),
  WA_ACCESS_TOKEN: z.string().optional(),
  WA_PHONE_NUMBER_ID: z.string().optional(),
  VERIFY_TOKEN: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Configuração de variáveis de ambiente inválida:', parsed.error.format());
  process.exit(1);
}

export const env = parsed.data;