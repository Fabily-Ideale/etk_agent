import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai';
import { env } from './env';

// Instância do modelo principal configurada para a NIM API
export const llm = new ChatOpenAI({
  openAIApiKey: env.NVIDIA_NIM_API_KEY || env.OPENAI_API_KEY,
  configuration: {
    baseURL: env.NVIDIA_NIM_BASE_URL,
  },
  modelName: env.NVIDIA_NIM_MODEL,
  temperature: 0.2,
});

// Instância do modelo de embeddings da NIM API
export const embeddings = new OpenAIEmbeddings({
  openAIApiKey: env.NVIDIA_NIM_API_KEY || env.OPENAI_API_KEY,
  configuration: {
    baseURL: env.NVIDIA_NIM_BASE_URL,
  },
  modelName: env.NVIDIA_NIM_EMBEDDING_MODEL,
});
