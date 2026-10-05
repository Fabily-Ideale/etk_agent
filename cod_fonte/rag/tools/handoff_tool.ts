import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { execute_chatwoot_handoff } from '../../webhook/chatwoot_client';
import { get_conversation_context, conversation_context } from '../../runtime/request_context';

let fallback_handoff_context: conversation_context | null = null;

export function set_current_handoff_context(context: conversation_context | null): void {
  fallback_handoff_context = context;
}

export const handoff_tool = tool(
  async ({ motivo }: { motivo: string }) => {
    const active_context = get_conversation_context() || fallback_handoff_context;

    if (active_context?.account_id && active_context?.conversation_id) {
      await execute_chatwoot_handoff({
        account_id: active_context.account_id,
        conversation_id: active_context.conversation_id,
        reason: motivo,
      });
    }

    return `Atendimento transferido para a equipe tecnica humana com sucesso. Resumo da triagem registrado: ${motivo}. Informe ao cliente que a triagem foi concluida e que um de nossos tecnicos especializados dara inicio ao atendimento por aqui em instantes.`;
  },
  {
    name: 'transferir_atendimento_humano',
    description:
      'Transfere o atendimento para a equipe tecnica humana no Chatwoot para que ela de inicio ao atendimento real. Deve ser acionada assim que os 3 pilares da triagem forem atendidos (1: o que o cliente deseja; 2: qual servico do catalogo se encaixa; 3: contexto relevante do problema/pedido), ou se o proposito do cliente permanecer incompreensivel apos tentativas de clarificacao. O agente sob nenhuma hipotese inicia o atendimento por conta propria.',
    schema: z.object({
      motivo: z
        .string()
        .describe('Resumo estruturado da triagem contendo: 1) o que o cliente deseja, 2) qual servico se encaixa, 3) contexto relevante do problema/pedido (ou justificativa de incompreensao)'),
    }),
  }
);
