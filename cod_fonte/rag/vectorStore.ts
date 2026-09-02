import path from 'path';
import { prisma } from '../config/prisma';
import { embeddings } from '../config/llm';
import { process_directory_documents, prepare_chunks, document_chunk } from './doc_conversor';

export async function populateVectorStore(): Promise<void> {
  const count = await prisma.documentEmbedding.count();

  if (count > 0) {
    console.log(`[SEED RAG] A tabela DocumentEmbedding já possui ${count} registro(s). Ignorando geração de embeddings.`);
    return;
  }

  console.log('[SEED RAG] Tabela DocumentEmbedding vazia. Iniciando conversão de documentos e geração de embeddings...');

  const source_dir = path.join(__dirname, 'doc_bruto');
  const target_dir = path.join(__dirname, 'doc_markdown');

  const converted_docs = await process_directory_documents(source_dir, target_dir);

  if (converted_docs.length === 0) {
    console.log('[SEED RAG] Nenhum documento encontrado para conversão em doc_bruto.');
    return;
  }

  console.log(`[SEED RAG] ${converted_docs.length} documento(s) convertido(s). Gerando chunks...`);

  const all_chunks: document_chunk[] = [];
  for (const doc of converted_docs) {
    const chunks = prepare_chunks(doc);
    all_chunks.push(...chunks);
  }

  if (all_chunks.length === 0) {
    console.log('[SEED RAG] Nenhum chunk gerado dos documentos.');
    return;
  }

  console.log(`[SEED RAG] Total de ${all_chunks.length} chunk(s) gerado(s). Solicitando vetores de embedding...`);

  const texts = all_chunks.map(chunk => chunk.content);
  const vector_list = await embeddings.embedDocuments(texts);

  console.log('[SEED RAG] Vetores gerados com sucesso. Persistindo na tabela DocumentEmbedding...');

  for (let i = 0; i < all_chunks.length; i++) {
    const chunk = all_chunks[i];
    const vector = vector_list[i];
    const vectorLiteral = `[${vector.join(',')}]`;
    const metadataJson = JSON.stringify(chunk.metadata);

    await prisma.$executeRawUnsafe(
      `INSERT INTO "DocumentEmbedding" (id, content, embedding, metadata, source, "createdAt")
       VALUES (gen_random_uuid(), $1, $2::vector, $3::jsonb, $4, NOW())`,
      chunk.content,
      vectorLiteral,
      metadataJson,
      chunk.source_file
    );
  }

  console.log(`[SEED RAG] ${all_chunks.length} embedding(s) inserido(s) com sucesso na tabela DocumentEmbedding.`);
}

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

