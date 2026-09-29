import {
  enqueue_conversation_message,
  set_message_processor,
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

async function run_burst_aggregation_test(): Promise<void> {
  clear_all_queues();
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

  await sleep(1800);

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

async function run_inter_thinking_arrival_test(): Promise<void> {
  clear_all_queues();
  const execution_history: string[] = [];

  set_message_processor(async (_account_id, _conversation_id, _sender, text) => {
    execution_history.push(`START:${text}`);
    await sleep(400);
    execution_history.push(`FINISH:${text}`);
  });

  enqueue_conversation_message({
    account_id: 1,
    conversation_id: 102,
    sender_identifier: 'user_102',
    text: 'Mensagem Inicial',
  });

  await sleep(1600);

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

  await sleep(800);

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
  const completed_conversations: (string | number)[] = [];

  set_message_processor(async (_account_id, conversation_id, _sender, _text) => {
    await sleep(200);
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

  await sleep(1900);

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

  await sleep(1600);

  enqueue_conversation_message({
    account_id: 1,
    conversation_id: 301,
    sender_identifier: 'user_301',
    text: 'Tentativa que deve recuperar',
  });

  await sleep(1700);

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

  set_message_processor(async () => {
    await sleep(50);
  });

  enqueue_conversation_message({
    account_id: 1,
    conversation_id: 401,
    sender_identifier: 'user_401',
    text: 'Mensagem para teste de limpeza',
  });

  await sleep(1700);

  const active_count = get_active_queue_count();
  const passed = active_count === 0;

  test_results.push({
    name: 'Limpeza de memoria: remoção automatica de chaves ociosas',
    passed,
    details: passed ? undefined : `Esperado 0 filas ativas, encontrado: ${active_count}`,
  });
}

async function main(): Promise<void> {
  await run_burst_aggregation_test();
  await run_inter_thinking_arrival_test();
  await run_multi_conversation_isolation_test();
  await run_error_resilience_test();
  await run_memory_cleanup_test();

  clear_all_queues();
  set_message_processor(null);

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
