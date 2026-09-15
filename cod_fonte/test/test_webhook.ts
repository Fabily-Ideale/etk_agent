import { Request, Response, NextFunction } from 'express';
import webhook_router from '../webhook/controller';
import { env } from '../config/env';

interface test_case_result {
  name: string;
  passed: boolean;
  details?: string;
}

const test_results: test_case_result[] = [];

function get_route_handlers(): { get_handler: any; post_handler: any } {
  const layers = (webhook_router as any).stack || [];
  let get_handler: any = null;
  let post_handler: any = null;

  for (const layer of layers) {
    if (layer.route && layer.route.stack && layer.route.stack.length > 0) {
      if (layer.route.methods?.get) {
        get_handler = layer.route.stack[0].handle;
      }
      if (layer.route.methods?.post) {
        post_handler = layer.route.stack[0].handle;
      }
    }
  }

  return { get_handler, post_handler };
}

function invoke_handler(handler: any, req: any, res: any): Promise<void> {
  return new Promise((resolve) => {
    const next: NextFunction = () => {
      resolve();
    };

    try {
      const result = handler(req, res, next);
      if (result && typeof result.then === 'function') {
        result.then(() => resolve(), () => resolve());
      } else {
        resolve();
      }
    } catch {
      resolve();
    }
  });
}

async function run_webhook_verification_tests(): Promise<void> {
  const { get_handler } = get_route_handlers();
  const valid_token = env.VERIFY_TOKEN || 'token_teste_verificacao';
  const original_token = env.VERIFY_TOKEN;
  (env as any).VERIFY_TOKEN = valid_token;

  try {
    const valid_req = {
      query: {
        'hub.mode': 'subscribe',
        'hub.verify_token': valid_token,
        'hub.challenge': 'desafio_seguranca_123',
      },
    } as unknown as Request;

    let res_valid_status: number | null = null;
    let res_valid_body: any = null;
    const res_valid: Partial<Response> = {
      status: (code: number) => {
        res_valid_status = code;
        return res_valid as Response;
      },
      send: (data: any) => {
        res_valid_body = data;
        return res_valid as Response;
      },
      sendStatus: (code: number) => {
        res_valid_status = code;
        return res_valid as Response;
      },
    };

    await invoke_handler(get_handler, valid_req, res_valid);
    test_results.push({
      name: 'GET /webhook: verificacao valida da Meta retorna status 200 com challenge',
      passed: res_valid_status === 200 && res_valid_body === 'desafio_seguranca_123',
    });

    const invalid_mode_req = {
      query: {
        'hub.mode': 'publish',
        'hub.verify_token': valid_token,
        'hub.challenge': 'desafio_seguranca_123',
      },
    } as unknown as Request;
    let res_mode_status: number | null = null;
    const res_mode: Partial<Response> = {
      sendStatus: (code: number) => {
        res_mode_status = code;
        return res_mode as Response;
      },
    };
    await invoke_handler(get_handler, invalid_mode_req, res_mode);
    test_results.push({
      name: 'GET /webhook: hub.mode incorreto retorna 403',
      passed: res_mode_status === 403,
    });

    const invalid_token_req = {
      query: {
        'hub.mode': 'subscribe',
        'hub.verify_token': 'token_incorreto_ataque',
        'hub.challenge': 'desafio_seguranca_123',
      },
    } as unknown as Request;
    let res_token_status: number | null = null;
    const res_token: Partial<Response> = {
      sendStatus: (code: number) => {
        res_token_status = code;
        return res_token as Response;
      },
    };
    await invoke_handler(get_handler, invalid_token_req, res_token);
    test_results.push({
      name: 'GET /webhook: hub.verify_token divergente retorna 403',
      passed: res_token_status === 403,
    });

    const missing_query_req = {} as unknown as Request;
    let res_missing_status: number | null = null;
    const res_missing: Partial<Response> = {
      sendStatus: (code: number) => {
        res_missing_status = code;
        return res_missing as Response;
      },
    };
    await invoke_handler(get_handler, missing_query_req, res_missing);
    test_results.push({
      name: 'GET /webhook: requisicao sem query parameters retorna 403 com seguranca',
      passed: res_missing_status === 403,
    });

    const sqli_query_req = {
      query: {
        'hub.mode': "' OR '1'='1",
        'hub.verify_token': "' UNION SELECT NULL--",
      },
    } as unknown as Request;
    let res_sqli_status: number | null = null;
    const res_sqli: Partial<Response> = {
      sendStatus: (code: number) => {
        res_sqli_status = code;
        return res_sqli as Response;
      },
    };
    await invoke_handler(get_handler, sqli_query_req, res_sqli);
    test_results.push({
      name: 'GET /webhook: tentativa de injecao de query string rejeitada com 403',
      passed: res_sqli_status === 403,
    });
  } finally {
    (env as any).VERIFY_TOKEN = original_token;
  }
}

async function run_webhook_event_tests(): Promise<void> {
  const { post_handler } = get_route_handlers();

  const invoke_post = async (body_payload: any): Promise<{ status: number | null; body: any }> => {
    let captured_status: number | null = null;
    let captured_body: any = null;

    const res_mock: Partial<Response> = {
      status: (code: number) => {
        captured_status = code;
        return res_mock as Response;
      },
      sendStatus: (code: number) => {
        captured_status = code;
        return res_mock as Response;
      },
      send: (data: any) => {
        captured_body = data;
        return res_mock as Response;
      },
    };

    const req_mock = { body: body_payload } as unknown as Request;
    await invoke_handler(post_handler, req_mock, res_mock);

    return { status: captured_status, body: captured_body };
  };

  const null_body_res = await invoke_post(null);
  test_results.push({
    name: 'POST /webhook: corpo nulo retorna 404',
    passed: null_body_res.status === 404,
  });

  const string_body_res = await invoke_post('corpo_em_texto_puro');
  test_results.push({
    name: 'POST /webhook: corpo primitivo string retorna 404',
    passed: string_body_res.status === 404,
  });

  const invalid_object_res = await invoke_post({ object: 'page' });
  test_results.push({
    name: 'POST /webhook: object diferente de whatsapp_business_account retorna 404',
    passed: invalid_object_res.status === 404,
  });

  const missing_entry_res = await invoke_post({ object: 'whatsapp_business_account' });
  test_results.push({
    name: 'POST /webhook: objeto whatsapp valido sem array entry responde 200 EVENT_RECEIVED com seguranca',
    passed: missing_entry_res.status === 200 && missing_entry_res.body === 'EVENT_RECEIVED',
  });

  const empty_entry_res = await invoke_post({
    object: 'whatsapp_business_account',
    entry: [],
  });
  test_results.push({
    name: 'POST /webhook: array entry vazio responde 200 EVENT_RECEIVED',
    passed: empty_entry_res.status === 200 && empty_entry_res.body === 'EVENT_RECEIVED',
  });

  const status_event_res = await invoke_post({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '123456',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '1234', phone_number_id: '5678' },
              statuses: [
                {
                  id: 'wamid.HBgL...',
                  status: 'delivered',
                  timestamp: '1710000000',
                  recipient_id: '5511999990001',
                },
              ],
            },
          },
        ],
      },
    ],
  });
  test_results.push({
    name: 'POST /webhook: evento de notificacao de entrega/leitura sem mensagens tratado com 200',
    passed: status_event_res.status === 200 && status_event_res.body === 'EVENT_RECEIVED',
  });

  const media_event_res = await invoke_post({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '123456',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              messages: [
                {
                  from: '5511999990001',
                  id: 'wamid.media1',
                  timestamp: '1710000000',
                  type: 'image',
                  image: { id: 'media_id_123', mime_type: 'image/jpeg' },
                },
              ],
            },
          },
        ],
      },
    ],
  });
  test_results.push({
    name: 'POST /webhook: mensagem de midia ignorada com seguranca retornando 200',
    passed: media_event_res.status === 200 && media_event_res.body === 'EVENT_RECEIVED',
  });

  const empty_text_res = await invoke_post({
    object: 'whatsapp_business_account',
    entry: [
      {
        changes: [
          {
            field: 'messages',
            value: {
              messages: [
                {
                  from: '5511999990001',
                  type: 'text',
                  text: { body: '   ' },
                },
              ],
            },
          },
        ],
      },
    ],
  });
  test_results.push({
    name: 'POST /webhook: mensagem de texto vazia descartada sem acionar processamento',
    passed: empty_text_res.status === 200 && empty_text_res.body === 'EVENT_RECEIVED',
  });
}

async function main(): Promise<void> {
  await run_webhook_verification_tests();
  await run_webhook_event_tests();

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
    console.error(`Total de falhas no teste de webhook: ${failed_count}`);
    process.exit(1);
  } else {
    console.log(`Todos os ${test_results.length} testes de webhook passaram com exito.`);
    process.exit(0);
  }
}

main();
