import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { execute_chatwoot_handoff } from '../../webhook/chatwoot_client';

let current_handoff_context: { account_id?: number | string; conversation_id?: number | string } | null = null;

export function set_current_handoff_context(
  context: { account_id?: number | string; conversation_id?: number | string } | null
): void {
  current_handoff_context = context;
}

export const handoff_tool = tool(
  async ({ motivo }: { motivo: string }) => {
    if (current_handoff_context?.account_id && current_handoff_context?.conversation_id) {
      await execute_chatwoot_handoff({
        account_id: current_handoff_context.account_id,
        conversation_id: current_handoff_context.conversation_id,
        reason: motivo,
      });
    }

    return `Atendimento transferido para a equipe tecnica humana com sucesso. Motivo registrado: ${motivo}. Informe ao cliente de maneira assertiva e gentil que ele foi transferido para um de nossos tecnicos especializados e que em instantes sera atendido por aqui.`;
  },
  {
    name: 'transferir_atendimento_humano',
    description:
      'Transfere o atendimento para um atendente ou tecnico humano no Chatwoot. Deve ser acionada obrigatoriamente quando o cliente solicitar falar com atendente ou tecnico, concordar com a transferencia sugerida (ex: sim, pode transferir, quero falar com um tecnico), ou quando a demanda exigir avaliacao tecnica personalizada.',
    schema: z.object({
      motivo: z
        .string()
        .describe('Motivo objetivo da transferencia para atendimento humano'),
    }),
  }
);
