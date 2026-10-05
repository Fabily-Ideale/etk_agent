import { prisma } from '../config/prisma';
import { prisma_session_store, memory_session_store } from '../persistence/session_store';
import { prisma_rate_limit_store } from '../persistence/rate_limit_store';
import { run_with_conversation_context, get_conversation_context } from '../runtime/request_context';
import {
  enqueue_conversation_message,
  recover_pending_queues,
  clear_all_queues,
  set_message_processor,
  set_typing_status_sender,
  get_active_queue_count,
} from '../webhook/conversation_queue';
import {
  hydrate_handoff_sessions,
  pause_conversation_for_human,
  resume_conversation_bot,
  is_conversation_in_human_handoff,
  clear_all_handoff_sessions,
} from '../webhook/chatwoot_client';

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

async function test_async_local_storage_concurrency(): Promise<void> {
  const executions: Array<{ id: number; observed: any }> = [];

  const task1 = run_with_conversation_context({ account_id: 1, conversation_id: 1001 }, async () => {
    await sleep(40);
    executions.push({ id: 1, observed: get_conversation_context() });
  });

  const task2 = run_with_conversation_context({ account_id: 2, conversation_id: 2002 }, async () => {
    await sleep(20);
    executions.push({ id: 2, observed: get_conversation_context() });
  });

  await Promise.all([task1, task2]);

  const task1_result = executions.find((e) => e.id === 1);
  const task2_result = executions.find((e) => e.id === 2);

  const passed =
    task1_result?.observed?.conversation_id === 1001 &&
    task2_result?.observed?.conversation_id === 2002;

  test_results.push({
    name: 'AsyncLocalStorage: isolamento estrito de contexto entre execucoes concorrentes',
    passed,
    details: passed ? undefined : `Resultados capturados: ${JSON.stringify(executions)}`,
  });
}

async function test_memory_session_store_crud(): Promise<void> {
  const store = new memory_session_store();

  await store.activate_handoff(1, 10, 'motivo_teste');
  let active = await store.load_active_handoffs();
  const activated = active.length === 1 && active[0].conversation_id === 10;

  await store.release_handoff(1, 10);
  active = await store.load_active_handoffs();
  const released = active.length === 0;

  await store.append_pending_message(1, 20, 'sender_20', 'msg1');
  await store.append_pending_message(1, 20, 'sender_20', 'msg2');
  const pending_list = await store.list_sessions_with_pending();
  const has_pending = pending_list.length === 1 && pending_list[0].pending_count === 2;

  const consumed = await store.consume_pending_messages(1, 20);
  const consumed_ok = consumed.length === 2 && consumed[0] === 'msg1' && consumed[1] === 'msg2';

  const after_consume = await store.consume_pending_messages(1, 20);
  const empty_after = after_consume.length === 0;

  const passed = activated && released && has_pending && consumed_ok && empty_after;

  test_results.push({
    name: 'memory_session_store: ciclo de handoff e buffer pendente em memoria',
    passed,
    details: passed ? undefined : 'Falha em operacoes basicas de memoria',
  });
}

async function test_prisma_session_store_integration(): Promise<void> {
  const store = new prisma_session_store();
  await store.clear_all();

  await store.activate_handoff(99, 9901, 'handoff_postgres');
  const active_handoffs = await store.load_active_handoffs();
  const handoff_persisted =
    active_handoffs.some((h) => String(h.conversation_id) === '9901' && h.reason === 'handoff_postgres');

  await store.release_handoff(99, 9901);
  const active_after_release = await store.load_active_handoffs();
  const release_persisted = !active_after_release.some((h) => String(h.conversation_id) === '9901');

  await store.append_pending_message(99, 9902, 'user_db', 'linha 1');
  await store.append_pending_message(99, 9902, 'user_db', 'linha 2');

  const pending_sessions = await store.list_sessions_with_pending();
  const pending_found = pending_sessions.some((s) => String(s.conversation_id) === '9902');

  const consumed = await store.consume_pending_messages(99, 9902);
  const consumed_match = consumed.length === 2 && consumed[0] === 'linha 1' && consumed[1] === 'linha 2';

  const second_consume = await store.consume_pending_messages(99, 9902);
  const at_most_once = second_consume.length === 0;

  await store.clear_all();

  const passed =
    handoff_persisted &&
    release_persisted &&
    pending_found &&
    consumed_match &&
    at_most_once;

  test_results.push({
    name: 'prisma_session_store: persistencia duravel de handoff e fila pendente no PostgreSQL',
    passed,
    details: passed ? undefined : 'Inconsistencia na gravacao ou consumo de sessoes no PostgreSQL',
  });
}

async function test_prisma_rate_limit_store_atomic_upsert(): Promise<void> {
  const limiter = new prisma_rate_limit_store();
  const test_key = `test_rate_phone_${Date.now()}`;

  await limiter.reset(test_key);

  const res1 = await limiter.consume(test_key, 2, 3000);
  const pass1 = res1.allowed && res1.remaining === 1;

  const res2 = await limiter.consume(test_key, 2, 3000);
  const pass2 = res2.allowed && res2.remaining === 0;

  const res3 = await limiter.consume(test_key, 2, 3000);
  const pass3 = !res3.allowed && res3.retry_after_seconds > 0;

  await limiter.reset(test_key);
  const res4 = await limiter.consume(test_key, 2, 3000);
  const pass4 = res4.allowed && res4.remaining === 1;

  await limiter.reset(test_key);
  limiter.destroy();

  const passed = pass1 && pass2 && pass3 && pass4;

  test_results.push({
    name: 'prisma_rate_limit_store: contagem atomica em PostgreSQL via upsert parametrizado',
    passed,
    details: passed ? undefined : 'Falha na contagem atomica de limite em PostgreSQL',
  });
}

async function test_handoff_hydration_on_startup(): Promise<void> {
  clear_all_handoff_sessions();
  await sleep(50);

  await pause_conversation_for_human(88, 8801, 'motivo_hidratacao');
  await sleep(100);

  clear_all_handoff_sessions();
  const cleared_in_memory = !is_conversation_in_human_handoff(88, 8801);

  const hydrated_count = await hydrate_handoff_sessions();
  const is_active_after_hydration = is_conversation_in_human_handoff(88, 8801);

  await resume_conversation_bot(88, 8801);
  await sleep(50);
  clear_all_handoff_sessions();

  const passed = cleared_in_memory && hydrated_count >= 1 && is_active_after_hydration;

  test_results.push({
    name: 'Hidratacao no boot: recupera sessoes pausadas do banco para cache L1',
    passed,
    details: passed ? undefined : `Limpo: ${cleared_in_memory}, contagem: ${hydrated_count}, ativo: ${is_active_after_hydration}`,
  });
}

async function test_pending_message_recovery_on_startup(): Promise<void> {
  clear_all_queues();
  await sleep(50);

  const processed: string[] = [];
  set_message_processor(async (_acc, _conv, _sender, text) => {
    processed.push(text);
  });

  const session_store = new prisma_session_store();
  await session_store.append_pending_message(77, 7701, '5511999997701', 'Mensagem pendente antes do crash');

  const recovered_count = await recover_pending_queues();
  const queue_scheduled = get_active_queue_count() >= 1;

  await sleep(300);

  const message_processed = processed.includes('Mensagem pendente antes do crash');

  clear_all_queues();

  const passed = recovered_count >= 1 && queue_scheduled && message_processed;

  test_results.push({
    name: 'Recuperacao no boot: descarrega e processa mensagens pendentes deixadas no banco',
    passed,
    details: passed ? undefined : `Recuperados: ${recovered_count}, Fila agendada: ${queue_scheduled}, Processado: ${message_processed}`,
  });
}

async function main(): Promise<void> {
  await test_async_local_storage_concurrency();
  await test_memory_session_store_crud();
  await test_prisma_session_store_integration();
  await test_prisma_rate_limit_store_atomic_upsert();
  await test_handoff_hydration_on_startup();
  await test_pending_message_recovery_on_startup();

  clear_all_queues();
  clear_all_handoff_sessions();

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
    console.error(`Total de falhas na suite de persistencia: ${failed_count}`);
    process.exit(1);
  } else {
    console.log(`Todos os ${test_results.length} testes de persistencia passaram com exito.`);
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('Erro fatal no teste de persistencia:', err);
  process.exit(1);
});
