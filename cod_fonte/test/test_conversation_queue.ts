import {
  enqueue_conversation_message,
  set_message_processor,
  set_typing_status_sender,
  set_queue_debounce_ms,
  clear_all_queues,
  get_active_queue_count,
} from '../webhook/conversation_queue';

interface test_case_result {
  name: string;
  passed: boolean;
  details?: string;
}

const test_results: test_case_result[] = [];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

set_typing_status_sender(async () => {});

async function run_burst_aggregation_test(): Promise<void> {
  clear_all_queues();
  set_queue_debounce_ms(200);
  const processed_payloads: { account_id: any; conversation_id: any; text: string }[] = [];

  set_message_processor(async (account_id, conversation_id, _sender, text) => {
    processed_payloads.push({ account_id, conversation_id, text });
  });

  enqueue_conversation_message({
    account_id: 1,
    conversation_id: 101,
    sender_identifier: 'user_101',
    text: 'Primeira frase',
  });

  enqueue_conversation_message({
    account_id: 1,
    conversation_id: 101,
    sender_identifier: 'user_101',
    text: 'Segunda frase',
  });

  enqueue_conversation_message({
    account_id: 1,
    conversation_id: 101,
    sender_identifier: 'user_101',
    text: 'Terceira frase',
  });

  await sleep(350);

  const passed =
    processed_payloads.length === 1 &&
    processed_payloads[0].text === 'Primeira frase\nSegunda frase\nTerceira frase';

  test_results.push({
    name: 'Agregacao de rajada (burst): consolida mensagens rapidas em lote unico',
    passed,
    details: passed
      ? undefined
      : `Esperado 1 processamento consolidado, obtido ${processed_payloads.length} com conteudo: ${JSON.stringify(processed_payloads)}`,
  });
}

async function run_timer_reset_on_new_message_test(): Promise<void> {
  clear_all_queues();
  set_queue_debounce_ms(200);
  const call_timestamps: number[] = [];

  set_message_processor(async () => {
    call_timestamps.push(Date.now());
  });

  const start_time = Date.now();

  enqueue_conversation_message({
    account_id: 1,
    conversation_id: 105,
    sender_identifier: 'user_105',
    text: 'Mensagem inicial',
  });

  await sleep(120);

  enqueue_conversation_message({
    account_id: 1,
    conversation_id: 105,
    sender_identifier: 'user_105',
    text: 'Mensagem que reseta temporizador',
  });

  await sleep(120);

  const was_prematurely_called = call_timestamps.length > 0;

  await sleep(150);

  const total_duration = call_timestamps.length === 1 ? call_timestamps[0] - start_time : 0;
  const passed = !was_prematurely_called && call_timestamps.length === 1 && total_duration >= 290;

  test_results.push({
    name: 'Reset do temporizador: chegada de nova mensagem prorroga o debounce',
    passed,
    details: passed
      ? undefined
      : `Chamado prematuramente: ${was_prematurely_called}, chamadas totais: ${call_timestamps.length}, duracao: ${total_duration}ms`,
  });
}

async function run_inter_thinking_arrival_test(): Promise<void> {
  clear_all_queues();
  set_queue_debounce_ms(200);
  const execution_history: string[] = [];

  set_message_processor(async (_account_id, _conversation_id, _sender, text) => {
    execution_history.push(`START:${text}`);
    await sleep(200);
    execution_history.push(`FINISH:${text}`);
  });

  enqueue_conversation_message({
    account_id: 1,
    conversation_id: 102,
    sender_identifier: 'user_102',
    text: 'Mensagem Inicial',
  });

  await sleep(250);

  enqueue_conversation_message({
    account_id: 1,
    conversation_id: 102,
    sender_identifier: 'user_102',
    text: 'Chegou no meio 1',
  });

  enqueue_conversation_message({
    account_id: 1,
    conversation_id: 102,
    sender_identifier: 'user_102',
    text: 'Chegou no meio 2',
  });

  await sleep(600);

  const expected_sequence = [
    'START:Mensagem Inicial',
    'FINISH:Mensagem Inicial',
    'START:Chegou no meio 1\nChegou no meio 2',
    'FINISH:Chegou no meio 1\nChegou no meio 2',
  ];

  const passed =
    execution_history.length === expected_sequence.length &&
    execution_history.every((val, idx) => val === expected_sequence[idx]);

  test_results.push({
    name: 'Concorrencia durante processamento: enfileira e consolida mensagens pendentes',
    passed,
    details: passed
      ? undefined
      : `Sequencia incorreta: ${JSON.stringify(execution_history)} vs esperada: ${JSON.stringify(expected_sequence)}`,
  });
}

async function run_multi_conversation_isolation_test(): Promise<void> {
  clear_all_queues();
  set_queue_debounce_ms(200);
  const completed_conversations: (string | number)[] = [];

  set_message_processor(async (_account_id, conversation_id, _sender, _text) => {
    await sleep(100);
    completed_conversations.push(conversation_id);
  });

  enqueue_conversation_message({
    account_id: 1,
    conversation_id: 201,
    sender_identifier: 'user_201',
    text: 'Ola cliente 1',
  });

  enqueue_conversation_message({
    account_id: 1,
    conversation_id: 202,
    sender_identifier: 'user_202',
    text: 'Ola cliente 2',
  });

  await sleep(450);

  const passed =
    completed_conversations.length === 2 &&
    completed_conversations.includes(201) &&
    completed_conversations.includes(202);

  test_results.push({
    name: 'Isolamento entre conversas: processamento simultaneo de conversas distintas',
    passed,
    details: passed
      ? undefined
      : `Resultado inesperado de isolamento: ${JSON.stringify(completed_conversations)}`,
  });
}

async function run_error_resilience_test(): Promise<void> {
  clear_all_queues();
  set_queue_debounce_ms(200);
  const successful_calls: string[] = [];
  let should_fail = true;

  set_message_processor(async (_account_id, _conversation_id, _sender, text) => {
    if (should_fail) {
      should_fail = false;
      throw new Error('Falha simulada na API de LLM');
    }
    successful_calls.push(text);
  });

  enqueue_conversation_message({
    account_id: 1,
    conversation_id: 301,
    sender_identifier: 'user_301',
    text: 'Tentativa que vai falhar',
  });

  await sleep(250);

  enqueue_conversation_message({
    account_id: 1,
    conversation_id: 301,
    sender_identifier: 'user_301',
    text: 'Tentativa que deve recuperar',
  });

  await sleep(350);

  const passed =
    successful_calls.length === 1 &&
    successful_calls[0] === 'Tentativa que deve recuperar' &&
    get_active_queue_count() === 0;

  test_results.push({
    name: 'Resiliencia contra falhas: destravamento da fila apos excecao',
    passed,
    details: passed
      ? undefined
      : `Chamadas bem-sucedidas: ${JSON.stringify(successful_calls)}, Filas ativas: ${get_active_queue_count()}`,
  });
}

async function run_memory_cleanup_test(): Promise<void> {
  clear_all_queues();
  set_queue_debounce_ms(200);

  set_message_processor(async () => {
    await sleep(50);
  });

  enqueue_conversation_message({
    account_id: 1,
    conversation_id: 401,
    sender_identifier: 'user_401',
    text: 'Mensagem para teste de limpeza',
  });

  await sleep(350);

  const active_count = get_active_queue_count();
  const passed = active_count === 0;

  test_results.push({
    name: 'Limpeza de memoria: remoção automatica de chaves ociosas',
    passed,
    details: passed ? undefined : `Esperado 0 filas ativas, encontrado: ${active_count}`,
  });
}

async function run_typing_indicator_lifecycle_test(): Promise<void> {
  clear_all_queues();
  set_queue_debounce_ms(150);
  const events_sequence: string[] = [];

  set_typing_status_sender(async (account_id, conversation_id, status) => {
    events_sequence.push(`TYPING_${status}:${account_id}_${conversation_id}`);
  });

  set_message_processor(async (_account_id, _conversation_id, _sender, text) => {
    events_sequence.push(`PROCESS:${text}`);
    await sleep(50);
  });

  enqueue_conversation_message({
    account_id: 1,
    conversation_id: 501,
    sender_identifier: 'user_501',
    text: 'Mensagem para teste de digitando',
  });

  await sleep(300);

  const expected_sequence = [
    'TYPING_on:1_501',
    'PROCESS:Mensagem para teste de digitando',
    'TYPING_off:1_501',
  ];

  const passed =
    events_sequence.length === expected_sequence.length &&
    events_sequence.every((val, idx) => val === expected_sequence[idx]);

  test_results.push({
    name: 'Ciclo de vida do indicador: aciona on antes do processamento e off apos finalizar',
    passed,
    details: passed
      ? undefined
      : `Sequencia incorreta: ${JSON.stringify(events_sequence)} vs esperada: ${JSON.stringify(expected_sequence)}`,
  });
}

async function run_typing_indicator_error_cleanup_test(): Promise<void> {
  clear_all_queues();
  set_queue_debounce_ms(150);
  const events_sequence: string[] = [];

  set_typing_status_sender(async (_account_id, _conversation_id, status) => {
    events_sequence.push(`TYPING_${status}`);
  });

  set_message_processor(async () => {
    events_sequence.push('PROCESS_FAIL');
    throw new Error('Falha no modelo LLM');
  });

  enqueue_conversation_message({
    account_id: 1,
    conversation_id: 502,
    sender_identifier: 'user_502',
    text: 'Mensagem com falha',
  });

  await sleep(300);

  const expected_sequence = ['TYPING_on', 'PROCESS_FAIL', 'TYPING_off'];

  const passed =
    events_sequence.length === expected_sequence.length &&
    events_sequence.every((val, idx) => val === expected_sequence[idx]);

  test_results.push({
    name: 'Garantia de desligamento do indicador: status off emitido mesmo se houver excecao',
    passed,
    details: passed
      ? undefined
      : `Sequencia incorreta: ${JSON.stringify(events_sequence)} vs esperada: ${JSON.stringify(expected_sequence)}`,
  });
}

async function run_typing_indicator_failure_resilience_test(): Promise<void> {
  clear_all_queues();
  set_queue_debounce_ms(150);
  let processor_executed = false;

  set_typing_status_sender(async () => {
    throw new Error('Chatwoot endpoint toggle_typing indisponivel');
  });

  set_message_processor(async () => {
    processor_executed = true;
  });

  enqueue_conversation_message({
    account_id: 1,
    conversation_id: 503,
    sender_identifier: 'user_503',
    text: 'Mensagem com endpoint de typing falhando',
  });

  await sleep(300);

  const passed = processor_executed && get_active_queue_count() === 0;

  test_results.push({
    name: 'Resiliencia de falha de typing: falha na API de status nao bloqueia a resposta do agente',
    passed,
    details: passed
      ? undefined
      : `Processador executado: ${processor_executed}, filas ativas: ${get_active_queue_count()}`,
  });
}

async function main(): Promise<void> {
  await run_burst_aggregation_test();
  await run_timer_reset_on_new_message_test();
  await run_inter_thinking_arrival_test();
  await run_multi_conversation_isolation_test();
  await run_error_resilience_test();
  await run_memory_cleanup_test();
  await run_typing_indicator_lifecycle_test();
  await run_typing_indicator_error_cleanup_test();
  await run_typing_indicator_failure_resilience_test();

  clear_all_queues();
  set_message_processor(null);
  set_typing_status_sender(null);
  set_queue_debounce_ms(null);

  let failed_count = 0;
  for (const res of test_results) {
    if (res.passed) {
      console.log(`SUCESSO: [${res.name}]`);
    } else {
      failed_count++;
      console.error(`FALHA: [${res.name}] - ${res.details || 'Resultado inesperado'}`);
    }
  }

  if (failed_count > 0) {
    console.error(`Total de falhas no teste de fila de conversas: ${failed_count}`);
    process.exit(1);
  } else {
    console.log(`Todos os ${test_results.length} testes de fila de conversas passaram com exito.`);
    process.exit(0);
  }
}

main();
