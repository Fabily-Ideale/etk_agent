import { prisma } from '../config/prisma';
import { populateVectorStore } from '../rag/vectorStore';

async function main() {
  console.log('Iniciando o povoamento do banco de dados (seed)...');

  // Cliente de teste para desenvolvimento
  const testPhoneNumber = '5511999999999';

  const client = await prisma.client.upsert({
    where: { phoneNumber: testPhoneNumber },
    update: {},
    create: {
      phoneNumber: testPhoneNumber,
    },
  });

  console.log(`Cliente de teste pronto: ID=${client.id}, Telefone=${client.phoneNumber}`);

  // Limpa mensagens antigas do cliente de teste para garantir idempotência
  await prisma.message.deleteMany({
    where: { clientId: client.id },
  });

  // Insere mensagens de teste para simular um histórico de conversa inicial
  const createdMessages = await prisma.message.createMany({
    data: [
      {
        clientId: client.id,
        role: 'user',
        text: 'Olá, gostaria de obter informações sobre os serviços.',
      },
      {
        clientId: client.id,
        role: 'assistant',
        text: 'Olá! Sou o assistente virtual. Como posso ajudar você hoje?',
      },
      {
        clientId: client.id,
        role: 'user',
        text: 'Quais são os horários de atendimento?',
      },
      {
        clientId: client.id,
        role: 'assistant',
        text: 'Nosso horário de atendimento é de segunda a sexta, das 08h às 18h.',
      },
    ],
  });

  console.log(`${createdMessages.count} mensagens de teste inseridas com sucesso.`);

  // Invocação do fluxo de conversão de documentos e geração de embeddings
  await populateVectorStore();

  console.log('Seed concluído com sucesso!');
}

main()
  .catch((e) => {
    console.error('Erro ao executar o seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });