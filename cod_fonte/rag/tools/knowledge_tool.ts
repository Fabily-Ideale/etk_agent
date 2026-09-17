import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { queryDocuments } from '../vectorStore';

export const knowledge_tool = tool(
  async ({ pergunta_ou_termo, limite }) => {
    const results_limit = limite ?? 4;
    const documents = await queryDocuments(pergunta_ou_termo, results_limit);

    if (documents.length === 0) {
      return 'Nenhuma informacao relevante encontrada na base de conhecimento.';
    }

    return documents
      .map(doc => {
        const source_name = doc.metadata?.filename_source || doc.source || 'Documento';
        return `[Fonte: ${source_name}]\n${doc.content}`;
      })
      .join('\n\n---\n\n');
  },
  {
    name: 'consultar_base_conhecimento',
    description:
      'Consulta a base de conhecimento institucional da Это-Тек (historico, quem somos, branding, missao, visao, valores, politicas, estrategia de redes sociais e artigos tecnicos).',
    schema: z.object({
      pergunta_ou_termo: z
        .string()
        .describe('Pergunta ou termo para busca semantica na base de documentos institucionais'),
      limite: z
        .number()
        .optional()
        .describe('Quantidade maxima de trechos de documentos a recuperar (padrao 4)'),
    }),
  }
);
