import { HumanMessage, SystemMessage, AIMessage, ToolMessage, BaseMessage } from '@langchain/core/messages';
import { llm } from '../config/llm';
import { prisma } from '../config/prisma';
import { agent_tools, services_tool, knowledge_tool } from './tools';

const tools_map: Record<string, (args: any) => Promise<any>> = {
  [services_tool.name]: (args: any) => services_tool.invoke(args),
  [knowledge_tool.name]: (args: any) => knowledge_tool.invoke(args),
};

const llm_with_tools = llm.bindTools(agent_tools);

const system_prompt_text = `Voce e o assistente virtual oficial da Это-Тек (comercialmente identificada como @eto_tek).
Sua funcao e atender clientes tirando duvidas sobre servicos, precos, diagnosticos, reparos, formatacoes, infraestrutura de TI e informacoes institucionais da empresa.

Diretrizes de operacao:
1. Para duvidas sobre servicos, precos, valores, diagnosticos, manutencoes, instalacoes, desenvolvimento de software, planilhas ou redes, utilize a ferramenta consultar_servicos.
2. Se o cliente solicitar a lista completa ou catalogo de todos os servicos disponiveis, utilize consultar_servicos com o parametro obter_todos=true.
3. Para informacoes sobre a empresa (quem somos, historia, identidade visual, missao, visao, valores e presenca digital), utilize a ferramenta consultar_base_conhecimento.
4. Para saudacoes simples, agradecimentos ou dialogos sociais basicos, responda diretamente de forma cordial, profissional e concisa, sem invocar ferramentas.
5. Baseie suas respostas sobre valores e servicos estritamente nas informacoes retornadas pelas ferramentas. Nao invente precos ou servicos nao listados.`;

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
