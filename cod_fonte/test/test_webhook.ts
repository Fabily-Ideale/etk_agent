import webhook_router from '../webhook/controller';

interface test_case_result {
  name: string;
  passed: boolean;
  details?: string;
}

const test_results: test_case_result[] = [];

function get_handlers(): { get_handler: any; post_handler: any } {
  const layers = (webhook_router as any).stack || [];
  let get_handler: any = null;
  let post_handler: any = null;

  for (const layer of layers) {
    if (layer.route && layer.route.stack && layer.route.stack.length > 0) {
      if (layer.route.methods?.get && !get_handler) {
        get_handler = layer.route.stack[0].handle;
      }
      if (layer.route.methods?.post && !post_handler) {
        post_handler = layer.route.stack[0].handle;
      }
    }
  }

  return { get_handler, post_handler };
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
      sendStatus: (code: number) => {
        captured_status = code;
        return res;
      },
      json: (data: any) => {
        captured_body = data;
        resolve({ status: captured_status, body: captured_body });
        return res;
      },
      send: (data: any) => {
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

async function run_get_tests(): Promise<void> {
  const { get_handler } = get_handlers();
  const res = await invoke_handler(get_handler, {});
  test_results.push({
    name: 'GET /webhook: retorna status 200 com status ok',
    passed: res.status === 200 && res.body?.status === 'ok',
  });
}

async function run_post_tests(): Promise<void> {
  const { post_handler } = get_handlers();

  const res_null = await invoke_handler(post_handler, { body: null });
  test_results.push({
    name: 'POST /webhook: body nulo retorna 400',
    passed: res_null.status === 400,
  });

  const res_string = await invoke_handler(post_handler, { body: 'string_payload' });
  test_results.push({
    name: 'POST /webhook: body nao-objeto retorna 400',
    passed: res_string.status === 400,
  });

  const res_other_event = await invoke_handler(post_handler, {
    body: { event: 'conversation_created' },
  });
  test_results.push({
    name: 'POST /webhook: evento diferente de message_created retorna 200 sem processar',
    passed: res_other_event.status === 200 && res_other_event.body?.status === 'received',
  });

  const res_outgoing = await invoke_handler(post_handler, {
    body: {
      event: 'message_created',
      message_type: 'outgoing',
      content: 'Mensagem do atendente',
    },
  });
  test_results.push({
    name: 'POST /webhook: message_type outgoing ignorado para evitar loop',
    passed: res_outgoing.status === 200 && res_outgoing.body?.status === 'received',
  });

  const res_private = await invoke_handler(post_handler, {
    body: {
      event: 'message_created',
      message_type: 'incoming',
      private: true,
      content: 'Nota interna privada',
    },
  });
  test_results.push({
    name: 'POST /webhook: mensagem privada ignorada',
    passed: res_private.status === 200 && res_private.body?.status === 'received',
  });

  const res_empty_content = await invoke_handler(post_handler, {
    body: {
      event: 'message_created',
      message_type: 'incoming',
      content: '   ',
    },
  });
  test_results.push({
    name: 'POST /webhook: mensagem com conteudo vazio ignorada',
    passed: res_empty_content.status === 200 && res_empty_content.body?.status === 'received',
  });

  const res_missing_ids = await invoke_handler(post_handler, {
    body: {
      event: 'message_created',
      message_type: 'incoming',
      content: 'Ola',
    },
  });
  test_results.push({
    name: 'POST /webhook: mensagem sem conversation_id ou account_id ignorada com 200',
    passed: res_missing_ids.status === 200 && res_missing_ids.body?.status === 'received',
  });

  const res_valid_incoming = await invoke_handler(post_handler, {
    body: {
      event: 'message_created',
      message_type: 'incoming',
      content: 'Ola, quanto custa a formatacao?',
      conversation: { id: 123 },
      account: { id: 1 },
      sender: { phone_number: '5511999990001', name: 'Cliente' },
    },
  });
  test_results.push({
    name: 'POST /webhook: mensagem incoming valida aceita com status 200 received',
    passed: res_valid_incoming.status === 200 && res_valid_incoming.body?.status === 'received',
  });
}

async function main(): Promise<void> {
  await run_get_tests();
  await run_post_tests();

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
    console.error(`Total de falhas no teste de webhook Chatwoot: ${failed_count}`);
    process.exit(1);
  } else {
    console.log(`Todos os ${test_results.length} testes de webhook passaram com exito.`);
    process.exit(0);
  }
}

main();
