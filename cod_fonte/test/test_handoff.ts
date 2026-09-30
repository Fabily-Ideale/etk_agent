import webhook_router from '../webhook/controller';
import {
  is_conversation_in_human_handoff,
  pause_conversation_for_human,
  resume_conversation_bot,
  clear_all_handoff_sessions,
  execute_chatwoot_handoff,
  set_chatwoot_handoff_handler,
  chatwoot_handoff_params,
} from '../webhook/chatwoot_client';
import {
  enqueue_conversation_message,
  set_message_processor,
  set_typing_status_sender,
  set_queue_debounce_ms,
  clear_all_queues,
  get_active_queue_count,
} from '../webhook/conversation_queue';
import { handoff_tool, set_current_handoff_context } from '../rag/tools/handoff_tool';

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

function get_post_handler(): any {
  const layers = (webhook_router as any).stack || [];
  for (const layer of layers) {
    if (layer.route && layer.route.stack && layer.route.stack.length > 0) {
      if (layer.route.methods?.post) {
        return layer.route.stack[0].handle;
      }
    }
  }
  return null;
}

function invoke_handler(handler: any, req: any): Promise<{ status: number; body: any }> {
  return new Promise((resolve) => {
    let captured_status = 200;
    let captured_body: any = null;

    const res: any = {
      status: (code: number) => {
        captured_status = code;
        return res;
      },
      json: (data: any) => {
        captured_body = data;
        resolve({ status: captured_status, body: captured_body });
        return res;
      },
    };

    try {
      const result = handler(req, res, () => {});
      if (result && typeof result.then === 'function') {
        result.then(
          () => resolve({ status: captured_status, body: captured_body }),
          (err: any) => resolve({ status: 500, body: { error: String(err) } })
        );
      }
    } catch (handler_error) {
      resolve({ status: 500, body: { error: String(handler_error) } });
    }
  });
}

async function test_webhook_ignores_open_status(): Promise<void> {
  clear_all_queues();
  clear_all_handoff_sessions();
  const post_handler = get_post_handler();

  const response = await invoke_handler(post_handler, {
    body: {
      event: 'message_created',
      message_type: 'incoming',
      content: 'Ola atendente humano',
      conversation: { id: 701, status: 'open' },
      account: { id: 1 },
      sender: { phone_number: '5511999991111', name: 'Cliente' },
    },
  });

  const queue_count = get_active_queue_count();
  const passed = response.status === 200 && queue_count === 0;

  test_results.push({
    name: 'Webhook ignora mensagem quando status da conversa for open',
    passed,
    details: passed ? undefined : `Status HTTP: ${response.status}, itens na fila: ${queue_count}`,
  });
}

async function test_webhook_ignores_assigned_conversation(): Promise<void> {
  clear_all_queues();
  clear_all_handoff_sessions();
  const post_handler = get_post_handler();

  const response = await invoke_handler(post_handler, {
    body: {
      event: 'message_created',
      message_type: 'incoming',
      content: 'Mensagem para suporte atribuido',
      conversation: { id: 702, status: 'pending', assignee_id: 42 },
      account: { id: 1 },
      sender: { phone_number: '5511999992222', name: 'Cliente' },
    },
  });

  const queue_count = get_active_queue_count();
  const passed = response.status === 200 && queue_count === 0;

  test_results.push({
    name: 'Webhook ignora mensagem quando conversa possui operador atribuido',
    passed,
    details: passed ? undefined : `Status HTTP: ${response.status}, itens na fila: ${queue_count}`,
  });
}

async function test_webhook_ignores_paused_handoff_session(): Promise<void> {
  clear_all_queues();
  clear_all_handoff_sessions();
  pause_conversation_for_human(1, 703, 'handoff_teste');
  const post_handler = get_post_handler();

  const response = await invoke_handler(post_handler, {
    body: {
      event: 'message_created',
      message_type: 'incoming',
      content: 'Cliente enviando mensagem apos transferencia',
      conversation: { id: 703 },
      account: { id: 1 },
      sender: { phone_number: '5511999993333', name: 'Cliente' },
    },
  });

  const queue_count = get_active_queue_count();
  const passed = response.status === 200 && queue_count === 0;

  test_results.push({
    name: 'Webhook ignora mensagem quando a sessao local estiver marcada como handoff',
    passed,
    details: passed ? undefined : `Status HTTP: ${response.status}, itens na fila: ${queue_count}`,
  });
}

async function test_webhook_resumes_bot_when_pending(): Promise<void> {
  clear_all_queues();
  clear_all_handoff_sessions();
  pause_conversation_for_human(1, 704, 'handoff_inicial');
  const post_handler = get_post_handler();

  const response = await invoke_handler(post_handler, {
    body: {
      event: 'message_created',
      message_type: 'incoming',
      content: 'Atendente devolveu para o bot',
      conversation: { id: 704, status: 'pending' },
      account: { id: 1 },
      sender: { phone_number: '5511999994444', name: 'Cliente' },
    },
  });

  const is_still_paused = is_conversation_in_human_handoff(1, 704);
  const queue_count = get_active_queue_count();
  const passed = response.status === 200 && !is_still_paused && queue_count === 1;

  test_results.push({
    name: 'Webhook retoma processamento do bot quando status retorna para pending',
    passed,
    details: passed
      ? undefined
      : `Pausado: ${is_still_paused}, itens na fila: ${queue_count}, status HTTP: ${response.status}`,
  });
}

async function test_handoff_tool_execution(): Promise<void> {
  clear_all_handoff_sessions();
  const captured_params: chatwoot_handoff_params[] = [];

  set_chatwoot_handoff_handler(async (params) => {
    captured_params.push(params);
    return true;
  });

  set_current_handoff_context({ account_id: 1, conversation_id: 801 });

  const result = await handoff_tool.invoke({
    motivo: 'Cliente quer orcamento sob medida de servidor',
  });

  set_current_handoff_context(null);
  set_chatwoot_handoff_handler(null);

  const is_paused = is_conversation_in_human_handoff(1, 801);
  const passed =
    captured_params.length === 1 &&
    captured_params[0].conversation_id === 801 &&
    captured_params[0].account_id === 1 &&
    is_paused &&
    result.includes('transferido para a equipe tecnica');

  test_results.push({
    name: 'Ferramenta transferir_atendimento_humano executa handoff e pausa sessao',
    passed,
    details: passed ? undefined : `Parametros capturados: ${JSON.stringify(captured_params)}, resultado: ${result}`,
  });
}

async function test_conversation_queue_blocks_messages_in_handoff(): Promise<void> {
  clear_all_queues();
  clear_all_handoff_sessions();
  set_queue_debounce_ms(50);

  const processed: string[] = [];
  set_message_processor(async (_acc, _conv, _sender, text) => {
    processed.push(text);
  });

  pause_conversation_for_human(1, 901, 'teste_bloqueio');

  enqueue_conversation_message({
    account_id: 1,
    conversation_id: 901,
    sender_identifier: 'user_901',
    text: 'Mensagem que nao deve ser processada',
  });

  await sleep(100);

  const passed = processed.length === 0;

  test_results.push({
    name: 'Fila descarta enfileiramento de mensagens para conversas sob tutela humana',
    passed,
    details: passed ? undefined : `Mensagens processadas indevidamente: ${JSON.stringify(processed)}`,
  });
}

async function test_session_state_lifecycle(): Promise<void> {
  clear_all_handoff_sessions();

  const initially_paused = is_conversation_in_human_handoff(1, 999);
  pause_conversation_for_human(1, 999, 'teste_ciclo');
  const is_paused_after = is_conversation_in_human_handoff(1, 999);
  resume_conversation_bot(1, 999);
  const is_resumed = !is_conversation_in_human_handoff(1, 999);

  const passed = !initially_paused && is_paused_after && is_resumed;

  test_results.push({
    name: 'Ciclo de vida do estado em memoria de handoff (pausar, verificar, retomar)',
    passed,
    details: passed ? undefined : `Inicial: ${initially_paused}, Pausado: ${is_paused_after}, Retomado: ${is_resumed}`,
  });
}

async function main(): Promise<void> {
  await test_webhook_ignores_open_status();
  await test_webhook_ignores_assigned_conversation();
  await test_webhook_ignores_paused_handoff_session();
  await test_webhook_resumes_bot_when_pending();
  await test_handoff_tool_execution();
  await test_conversation_queue_blocks_messages_in_handoff();
  await test_session_state_lifecycle();

  let failed_count = 0;
  for (const res of test_results) {
    if (res.passed) {
      console.log(`SUCESSO: [${res.name}]`);
    } else {
      failed_count++;
      console.error(`FALHA: [${res.name}] - ${res.details || 'Resultado inesperado'}`);
    }
  }

  clear_all_queues();
  clear_all_handoff_sessions();

  if (failed_count > 0) {
    console.error(`Total de falhas no teste de handoff: ${failed_count}`);
    process.exit(1);
  } else {
    console.log(`Todos os ${test_results.length} testes de handoff passaram com exito.`);
    process.exit(0);
  }
}

main();
