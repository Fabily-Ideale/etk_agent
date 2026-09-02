import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { prisma } from '../config/prisma';

async function confirm_action(question_text: string): Promise<boolean> {
  const readline_interface = readline.createInterface({ input, output });
  const user_response = await readline_interface.question(question_text);
  readline_interface.close();
  const trimmed_response = user_response.trim().toLowerCase();
  return trimmed_response === 'y';
}

async function clear_database(): Promise<void> {
  console.log('Limpando o banco de dados...');
  const deleted_messages = await prisma.message.deleteMany();
  console.log(`${deleted_messages.count} mensagens removidas.`);

  const deleted_clients = await prisma.client.deleteMany();
  console.log(`${deleted_clients.count} clientes removidos.`);

  const deleted_embeddings = await prisma.documentEmbedding.deleteMany();
  console.log(`${deleted_embeddings.count} embeddings de documentos removidos.`);

  console.log('Banco de dados limpo com sucesso.');
}

async function main_reset(): Promise<void> {
  await prisma.$connect();
  const confirmation_message = 'Tem certeza que deseja apagar todo o banco de dados? (N/y): ';
  const confirmed = await confirm_action(confirmation_message);

  if (!confirmed) {
    console.log('Operacao cancelada pelo usuario.');
    return;
  }

  await clear_database();
}

main_reset()
  .catch((error: unknown) => {
    console.error('Erro ao executar a limpeza do banco de dados:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });