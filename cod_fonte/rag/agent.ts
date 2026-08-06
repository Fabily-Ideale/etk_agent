import { llm } from '../config/llm';
import { queryDocuments } from './vectorStore';
import { prisma } from '../config/prisma';
import { HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages';

export async function handleUserMessage(phoneNumber: string, text: string): Promise<string> {
  // 1. Busca ou cria o cliente
  let client = await prisma.client.findUnique({ where: { phoneNumber } });
  if (!client) {
    client = await prisma.client.create({ data: { phoneNumber } });
  }

  // 2. Salva a mensagem do usuário
  await prisma.message.create({
    data: {
      text,
      role: 'user',
      clientId: client.id,
    }
  });

  // 3. Recupera documentos do RAG baseados na mensagem atual
  const docs = await queryDocuments(text);
  const contextText = docs.map(d => d.content).join('\n\n');

  // 4. Recupera histórico (últimas 6 mensagens)
  const history = await prisma.message.findMany({
    where: { clientId: client.id },
    orderBy: { createdAt: 'desc' },
    take: 6
  });

  // Ordena cronologicamente (do mais antigo para o mais novo)
  history.reverse();

  // 5. Monta as mensagens para o LLM
  const systemPrompt = `Você é um assistente virtual útil que responde dúvidas baseado nos documentos fornecidos.
Sempre seja educado e conciso.
Se não souber a resposta com base no contexto, informe que não sabe.
Contexto:
${contextText}`;

  const messages: any[] = [new SystemMessage(systemPrompt)];

  for (const msg of history) {
    if (msg.role === 'user') {
      messages.push(new HumanMessage(msg.text));
    } else if (msg.role === 'assistant') {
      messages.push(new AIMessage(msg.text));
    }
  }

  // 6. Chama o LLM
  try {
    const response = await llm.invoke(messages);
    const answerText = response.content.toString();

    // 7. Salva a resposta do assistente no banco
    await prisma.message.create({
      data: {
        text: answerText,
        role: 'assistant',
        clientId: client.id,
      }
    });

    return answerText;
  } catch (error) {
    console.error('Erro ao chamar LLM NIM:', error);
    return 'Desculpe, ocorreu um erro ao processar sua mensagem.';
  }
}
