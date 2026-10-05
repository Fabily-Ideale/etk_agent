import { generate_system_prompt, system_prompt_text } from '../rag/agent';
import { knowledge_tool } from '../rag/tools/knowledge_tool';

interface test_case_result {
  name: string;
  passed: boolean;
  details?: string;
}

const test_results: test_case_result[] = [];

function record_test(name: string, condition: boolean, details?: string): void {
  test_results.push({
    name,
    passed: condition,
    details: condition ? undefined : details,
  });
}

function test_dynamic_timestamp_generation(): void {
  const fixed_date = new Date('2026-10-05T15:30:00.000Z');
  const prompt = generate_system_prompt(fixed_date);

  const contains_fixed_iso = prompt.includes('2026-10-05T15:30:00.000Z');
  const contains_timezone = prompt.includes('America/Sao_Paulo');
  const contains_context_header = prompt.includes('CONTEXTO TEMPORAL:');

  record_test(
    'Injecao dinamica de timestamp e fuso horario no prompt',
    contains_fixed_iso && contains_timezone && contains_context_header,
    `Falha ao verificar injecao dinamica de timestamp. ISO: ${contains_fixed_iso}, Timezone: ${contains_timezone}`
  );
}

function test_company_knowledge_tool_directive(): void {
  const prompt = generate_system_prompt();

  const mentions_knowledge_tool = prompt.includes('consultar_base_conhecimento');
  const mentions_company_scope = prompt.includes('do que se trata a empresa') && prompt.includes('onde ela atua');
  const mentions_digital_presence = prompt.includes('presenca digital');
  const forbids_hallucination = prompt.includes('Nao faca deducoes ou suposicoes sobre dados institucionais');

  record_test(
    'Obrigatoriedade de consulta a ferramenta de conhecimento para dados institucionais',
    mentions_knowledge_tool && mentions_company_scope && mentions_digital_presence && forbids_hallucination,
    `Falha nas diretrizes da ferramenta de conhecimento no prompt do sistema.`
  );
}

function test_non_commercial_hours_policy(): void {
  const prompt = generate_system_prompt();

  const mentions_no_fixed_schedule = prompt.includes('A empresa nao possui horario rigido de atuacao definido');
  const mentions_unlikely_support = prompt.includes('atendimento realizado por operadores humanos em horarios nao comerciais') &&
    prompt.includes('e improvavel');
  const mentions_queue_registration = prompt.includes('solicitacao ficara registrada na fila para atendimento');

  record_test(
    'Politica de ausencia de horario fixo e aviso sobre atendimento humano em horarios nao comerciais',
    mentions_no_fixed_schedule && mentions_unlikely_support && mentions_queue_registration,
    `Falha na politica de horarios de atendimento humano no prompt do sistema.`
  );
}

function test_redundancy_reduction(): void {
  const prompt = generate_system_prompt();

  const minimal_company_mention = prompt.includes('Você é o assistente virtual oficial de triagem da empresa de TI Это-Тек no WhatsApp.');
  const avoids_colors_raw = !prompt.includes('#c8ca33');
  const avoids_full_portfolio_dump = !prompt.includes('Manutenção e Otimização de PCs: Diagnóstico de lentidão');

  record_test(
    'Reducao de redundancias institucionais no prompt de sistema',
    minimal_company_mention && avoids_colors_raw && avoids_full_portfolio_dump,
    `Falha ao verificar reducao de redundancias no prompt.`
  );
}

function test_knowledge_tool_metadata(): void {
  const description = knowledge_tool.description;

  const covers_where_it_acts = description.includes('onde atua');
  const covers_digital_presence = description.includes('presenca digital e redes sociais');

  record_test(
    'Descricao da ferramenta de conhecimento contem escopo de atuacao e presenca digital',
    covers_where_it_acts && covers_digital_presence,
    `Descricao da ferramenta nao contem escopo esperado: ${description}`
  );
}

function main(): void {
  test_dynamic_timestamp_generation();
  test_company_knowledge_tool_directive();
  test_non_commercial_hours_policy();
  test_redundancy_reduction();
  test_knowledge_tool_metadata();

  let failed_count = 0;
  for (const item of test_results) {
    if (!item.passed) {
      failed_count++;
      console.error(`[FALHA] ${item.name}: ${item.details}`);
    } else {
      console.log(`[PASSOU] ${item.name}`);
    }
  }

  if (failed_count > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

main();
