import webhook_router, {
  is_unsupported_media_message,
  unsupported_media_message,
  clear_media_notification_cooldowns,
} from '../webhook/controller';
import {
  set_chatwoot_message_sender,
  pause_conversation_for_human,
  clear_all_handoff_sessions,
} from '../webhook/chatwoot_client';

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

async function run_media_tests(): Promise<void> {
  const { post_handler } = get_handlers();
  const sent_messages: { account_id: any; conversation_id: any; content: string }[] = [];

  set_chatwoot_message_sender(async (account_id, conversation_id, content) => {
    sent_messages.push({ account_id, conversation_id, content });
    return true;
  });

  clear_media_notification_cooldowns();
  clear_all_handoff_sessions();

  const is_image_detected = is_unsupported_media_message({
    attachments: [{ id: 1, file_type: 'image' }],
    content: '',
  });
  test_results.push({
    name: 'is_unsupported_media_message: detecta anexo de imagem com texto vazio',
    passed: is_image_detected === true,
  });

  const is_image_caption_detected = is_unsupported_media_message({
    attachments: [{ id: 1, file_type: 'image' }],
    content: 'Veja essa foto',
  });
  test_results.push({
    name: 'is_unsupported_media_message: detecta anexo de imagem com legenda de texto',
    passed: is_image_caption_detected === true,
  });

  const is_audio_detected = is_unsupported_media_message({
    attachments: [{ id: 2, file_type: 'audio' }],
    content: null,
  });
  test_results.push({
    name: 'is_unsupported_media_message: detecta anexo de audio',
    passed: is_audio_detected === true,
  });

  const is_video_detected = is_unsupported_media_message({
    attachments: [{ id: 3, file_type: 'video' }],
    content: '',
  });
  test_results.push({
    name: 'is_unsupported_media_message: detecta anexo de video',
    passed: is_video_detected === true,
  });

  const is_doc_detected = is_unsupported_media_message({
    attachments: [{ id: 4, file_type: 'file' }],
    content: 'documento.pdf',
  });
  test_results.push({
    name: 'is_unsupported_media_message: detecta anexo de documento ou arquivo',
    passed: is_doc_detected === true,
  });

  const is_custom_content_type_detected = is_unsupported_media_message({
    content_type: 'location',
    content: '',
  });
  test_results.push({
    name: 'is_unsupported_media_message: detecta content_type diferente de text',
    passed: is_custom_content_type_detected === true,
  });

  const is_plain_text_allowed = is_unsupported_media_message({
    attachments: [],
    content_type: 'text',
    content: 'Qual o valor da formatacao?',
  });
  test_results.push({
    name: 'is_unsupported_media_message: permite texto puro sem anexos',
    passed: is_plain_text_allowed === false,
  });

  sent_messages.length = 0;
  clear_media_notification_cooldowns();

  const res_image_post = await invoke_handler(post_handler, {
    body: {
      event: 'message_created',
      message_type: 'incoming',
      content: '',
      attachments: [{ id: 10, file_type: 'image' }],
      conversation: { id: 701, status: 'bot' },
      account: { id: 1 },
      sender: { phone_number: '5511999990002', name: 'Cliente Imagem' },
    },
  });

  test_results.push({
    name: 'POST /webhook: mensagem com imagem dispara aviso de texto exclusivo e responde 200',
    passed:
      res_image_post.status === 200 &&
      sent_messages.length === 1 &&
      sent_messages[0].conversation_id === 701 &&
      sent_messages[0].content === unsupported_media_message,
  });

  const res_image_burst = await invoke_handler(post_handler, {
    body: {
      event: 'message_created',
      message_type: 'incoming',
      content: '',
      attachments: [{ id: 11, file_type: 'image' }],
      conversation: { id: 701, status: 'bot' },
      account: { id: 1 },
      sender: { phone_number: '5511999990002', name: 'Cliente Imagem' },
    },
  });

  test_results.push({
    name: 'POST /webhook: rajada de midias dentro do cooldown nao duplica envio de aviso',
    passed: res_image_burst.status === 200 && sent_messages.length === 1,
  });

  sent_messages.length = 0;
  clear_media_notification_cooldowns();

  const res_audio_post = await invoke_handler(post_handler, {
    body: {
      event: 'message_created',
      message_type: 'incoming',
      content: null,
      attachments: [{ id: 20, file_type: 'audio' }],
      conversation: { id: 702, status: 'bot' },
      account: { id: 1 },
      sender: { phone_number: '5511999990003', name: 'Cliente Audio' },
    },
  });

  test_results.push({
    name: 'POST /webhook: mensagem de audio dispara aviso de suporte exclusivo a texto',
    passed:
      res_audio_post.status === 200 &&
      sent_messages.length === 1 &&
      sent_messages[0].conversation_id === 702 &&
      sent_messages[0].content === unsupported_media_message,
  });

  sent_messages.length = 0;
  clear_media_notification_cooldowns();

  const res_image_caption = await invoke_handler(post_handler, {
    body: {
      event: 'message_created',
      message_type: 'incoming',
      content: 'Conserta esse defeito da foto?',
      attachments: [{ id: 30, file_type: 'image' }],
      conversation: { id: 703, status: 'bot' },
      account: { id: 1 },
      sender: { phone_number: '5511999990004', name: 'Cliente Legenda' },
    },
  });

  test_results.push({
    name: 'POST /webhook: imagem com legenda e interceptada e gera aviso de texto exclusivo',
    passed:
      res_image_caption.status === 200 &&
      sent_messages.length === 1 &&
      sent_messages[0].conversation_id === 703 &&
      sent_messages[0].content === unsupported_media_message,
  });

  sent_messages.length = 0;
  clear_media_notification_cooldowns();

  const res_human_open = await invoke_handler(post_handler, {
    body: {
      event: 'message_created',
      message_type: 'incoming',
      content: '',
      attachments: [{ id: 40, file_type: 'image' }],
      conversation: { id: 704, status: 'open' },
      account: { id: 1 },
      sender: { phone_number: '5511999990005', name: 'Cliente Humano' },
    },
  });

  test_results.push({
    name: 'POST /webhook: midia em conversa com status open nao dispara aviso automatico',
    passed: res_human_open.status === 200 && sent_messages.length === 0,
  });

  sent_messages.length = 0;
  clear_media_notification_cooldowns();

  pause_conversation_for_human(1, 705, 'teste_handoff_midia');
  const res_human_handoff = await invoke_handler(post_handler, {
    body: {
      event: 'message_created',
      message_type: 'incoming',
      content: '',
      attachments: [{ id: 50, file_type: 'audio' }],
      conversation: { id: 705 },
      account: { id: 1 },
      sender: { phone_number: '5511999990006', name: 'Cliente Handoff' },
    },
  });

  test_results.push({
    name: 'POST /webhook: midia em sessao de handoff humano nao dispara aviso automatico',
    passed: res_human_handoff.status === 200 && sent_messages.length === 0,
  });

  sent_messages.length = 0;
  clear_media_notification_cooldowns();

  const res_human_assignee = await invoke_handler(post_handler, {
    body: {
      event: 'message_created',
      message_type: 'incoming',
      content: '',
      attachments: [{ id: 60, file_type: 'image' }],
      conversation: { id: 706, assignee_id: 99 },
      account: { id: 1 },
      sender: { phone_number: '5511999990007', name: 'Cliente Atendente' },
    },
  });

  test_results.push({
    name: 'POST /webhook: midia em conversa com assignee humano nao dispara aviso automatico',
    passed: res_human_assignee.status === 200 && sent_messages.length === 0,
  });

  set_chatwoot_message_sender(null);
  clear_media_notification_cooldowns();
  clear_all_handoff_sessions();
}

async function main(): Promise<void> {
  await run_get_tests();
  await run_post_tests();
  await run_media_tests();

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
