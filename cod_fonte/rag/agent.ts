import { HumanMessage, SystemMessage, AIMessage, ToolMessage, BaseMessage } from '@langchain/core/messages';
import { llm } from '../config/llm';
import { prisma } from '../config/prisma';
import { agent_tools, services_tool, knowledge_tool } from './tools';

const tools_map: Record<string, (args: any) => Promise<any>> = {
  [services_tool.name]: (args: any) => services_tool.invoke(args),
  [knowledge_tool.name]: (args: any) => knowledge_tool.invoke(args),
};

const llm_with_tools = llm.bindTools(agent_tools);

const system_prompt_text = `Voce e o assistente virtual oficial de atendimento e vendas da Isso-Tek (comercialmente identificada como @eto_tek) no WhatsApp.
Sua funcao e esclarecer duvidas de clientes sobre precos, valores e descricoes de servicos de forma agil, assertiva, persuasiva e concisa. Apos esclarecer essas informacoes, voce deve direcionar o cliente para atendimento com um dos nossos tecnicos especializados.

DIRETRIZES DE EXTENSAO E FORMATO:
1. Responda em no maximo 2 a 3 paragrafos curtos ou topicos breves. Mensagens longas reduzem o engajamento no WhatsApp e prejudicam a conversao de vendas.
2. Seja direto e objetivo: elimine enrolacoes, introducoes prolixas ou despedidas repetitivas.
3. Nao utilize formatacoes de cabecalho markdown como '#', '##' ou '###', e nao utilize tabelas. Utilize apenas quebras de linha e negrito (*texto*) para destacar valores ou nomes de servicos.
4. Nao utilize emojis sob nenhuma circunstancia.

ESTRUTURA DE RESPOSTA E CONVERSAO:
1. Resposta Direta e Valores: Responda imediatamente a duvida do cliente na primeira frase, informando o valor inicial/estimado e a descricao essencial do servico.
2. Proposta de Valor: Explique de maneira breve e segura o diferencial ou o que esta incluso no servico.
3. Direcionamento Tecnico: Conclua sempre com uma pergunta de proximo passo convidando o cliente a ser transferido para um de nossos tecnicos especializados formalizar o atendimento ou avaliar os detalhes do equipamento.

DIRETRIZES PARA CONSULTA DE CATALOGO E SERVICOS:
1. Para servicos, precos, manutencoes, formatacoes, suporte, desenvolvimento ou redes, consulte a ferramenta consultar_servicos.
2. Sob hipotese alguma despeje o catalogo completo na conversa. Se o cliente insistir em ver tudo ou todos os precos, apresente as categorias disponiveis para que ele escolha uma, ou mostre apenas os servicos de uma categoria especifica solicitada. Nunca liste itens de categorias diferentes em uma mesma resposta volumosa.
3. Para informacoes sobre a empresa (quem somos, missao, visao, valores), consulte consultar_base_conhecimento e responda em no maximo 2 frases objetivas.
4. Para saudacoes simples ou dialogos sociais basicos, responda cordialmente em 1 ou 2 frases sem acionar ferramentas, perguntando como pode ajudar.
5. Baseie valores e servicos estritamente nas ferramentas. Nao invente precos ou servicos.`;

export async function handleUserMessage(phone_number: string, text: string): Promise<string> {
  let client = await prisma.client.findUnique({
    where: { phoneNumber: phone_number },
  });

  if (!client) {
    client = await prisma.client.create({
      data: { phoneNumber: phone_number },
    });
  }

  await prisma.message.create({
    data: {
      text,
      role: 'user',
      clientId: client.id,
    },
  });

  const raw_history = await prisma.message.findMany({
    where: { clientId: client.id },
    orderBy: { createdAt: 'desc' },
    take: 6,
  });

  const history = [...raw_history].reverse();

  const conversation_messages: BaseMessage[] = [new SystemMessage(system_prompt_text)];

  for (const item of history) {
    if (item.role === 'user') {
      conversation_messages.push(new HumanMessage(item.text));
    } else if (item.role === 'assistant') {
      conversation_messages.push(new AIMessage(item.text));
    }
  }

  try {
    let current_iteration = 0;
    const max_iterations = 5;

    while (current_iteration < max_iterations) {
      current_iteration++;

      const response = await llm_with_tools.invoke(conversation_messages);
      conversation_messages.push(response);

      const tool_calls = response.tool_calls;
      if (!tool_calls || tool_calls.length === 0) {
        const final_answer = typeof response.content === 'string'
          ? response.content
          : JSON.stringify(response.content);

        await prisma.message.create({
          data: {
            text: final_answer,
            role: 'assistant',
            clientId: client.id,
          },
        });

        return final_answer;
      }

      for (const call of tool_calls) {
        const executor = tools_map[call.name];
        let tool_output: string;

        if (executor) {
          try {
            const raw_result = await executor(call.args);
            tool_output = typeof raw_result === 'string' ? raw_result : JSON.stringify(raw_result);
          } catch (exec_error) {
            tool_output = `Erro ao executar a ferramenta ${call.name}: ${String(exec_error)}`;
          }
        } else {
          tool_output = `Ferramenta ${call.name} nao encontrada.`;
        }

        conversation_messages.push(
          new ToolMessage({
            tool_call_id: call.id ?? '',
            content: tool_output,
            name: call.name,
          })
        );
      }
    }

    const fallback_message = 'Nao foi possivel concluir o processamento dentro do limite de etapas.';
    await prisma.message.create({
      data: {
        text: fallback_message,
        role: 'assistant',
        clientId: client.id,
      },
    });

    return fallback_message;
  } catch (error) {
    console.error('Erro no processamento do agente com ferramentas:', error);
    const error_response = 'Desculpe, ocorreu um erro ao processar sua solicitacao.';
    return error_response;
  }
}
