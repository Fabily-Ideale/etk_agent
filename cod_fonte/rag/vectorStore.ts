import path from 'path';
import { prisma } from '../config/prisma';
import { embeddings } from '../config/llm';
import { process_directory_documents, prepare_chunks, document_chunk } from './doc_conversor';

export async function populateVectorStore(force_reload = false): Promise<void> {
  const source_dir = path.join(__dirname, 'doc_bruto');
  const target_dir = path.join(__dirname, 'doc_markdown');

  const converted_docs = await process_directory_documents(source_dir, target_dir);

  if (converted_docs.length === 0) {
    return;
  }

  for (const doc of converted_docs) {
    const existing_count = await prisma.documentEmbedding.count({
      where: { source: doc.target_path },
    });

    if (existing_count > 0 && !force_reload) {
      continue;
    }

    if (existing_count > 0 && force_reload) {
      await prisma.documentEmbedding.deleteMany({
        where: { source: doc.target_path },
      });
    }

    const doc_chunks = prepare_chunks(doc);
    if (doc_chunks.length === 0) {
      continue;
    }

    const texts = doc_chunks.map(chunk => chunk.content);
    const vector_list = await embeddings.embedDocuments(texts);

    for (let i = 0; i < doc_chunks.length; i++) {
      const chunk = doc_chunks[i];
      const vector = vector_list[i];
      const vector_literal = `[${vector.join(',')}]`;
      const metadata_json = JSON.stringify(chunk.metadata);

      await prisma.$executeRawUnsafe(
        `INSERT INTO "DocumentEmbedding" (id, content, embedding, metadata, source, "createdAt")
         VALUES (gen_random_uuid(), $1, $2::vector, $3::jsonb, $4, NOW())`,
        chunk.content,
        vector_literal,
        metadata_json,
        chunk.source_file
      );
    }
  }
}

export async function queryDocuments(query: string, n_results = 4): Promise<{ content: string; metadata: any; source: string }[]> {
  try {
    const embedding = await embeddings.embedQuery(query);
    const sql = `
      SELECT content, metadata, source 
      FROM "DocumentEmbedding" 
      ORDER BY embedding <=> $1::vector 
      LIMIT $2
    `;

    const vector_literal = `[${embedding.join(',')}]`;
    const results = await prisma.$queryRawUnsafe<any[]>(sql, vector_literal, n_results);

    return results;
  } catch (error) {
    console.error('Erro na busca vetorial de documentos:', error);
    return [];
  }
}
