import { prisma } from '../config/prisma';
import { embeddings } from '../config/llm';

export async function queryDocuments(query: string, nResults = 4): Promise<{ content: string; metadata: any; source: string }[]> {
  try {
    const embedding = await embeddings.embedQuery(query);
    // pgvector syntax for cosine distance: <=>
    const sql = `
      SELECT content, metadata, source 
      FROM "DocumentEmbedding" 
      ORDER BY embedding <=> $1::vector 
      LIMIT $2
    `;

    // Note: To pass the array as a vector to pg, it needs to be formatted as a string literal '[v1,v2,...]'
    const vectorLiteral = `[${embedding.join(',')}]`;
    const results = await prisma.$queryRawUnsafe<any[]>(sql, vectorLiteral, nResults);

    return results;
  } catch (error) {
    console.error('Erro na busca vetorial de documentos:', error);
    return [];
  }
}
