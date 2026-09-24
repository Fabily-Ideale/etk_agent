import { Router, Request, Response } from 'express';
import { env } from '../config/env';
import { handleUserMessage } from '../rag/agent';
import { log_error_event } from '../logging/logger';
import axios from 'axios';

const router = Router();

async function send_chatwoot_message(
  account_id: number | string,
  conversation_id: number | string,
  content: string
): Promise<void> {
  if (!env.CHATWOOT_API_TOKEN) {
    return;
  }

  const url = `${env.CHATWOOT_BASE_URL}/api/v1/accounts/${account_id}/conversations/${conversation_id}/messages`;

  await axios.post(
    url,
    {
      content,
      message_type: 'outgoing',
    },
    {
      headers: {
        api_access_token: env.CHATWOOT_API_TOKEN,
      },
      timeout: 10000,
    }
  );
}

async function process_chatwoot_webhook(req: Request, res: Response): Promise<void> {
  const body = req.body;

  if (!body || typeof body !== 'object') {
    res.status(400).json({ error: 'corpo_invalido' });
    return;
  }

  res.status(200).json({ status: 'received' });

  if (body.event !== 'message_created') {
    return;
  }

  if (body.message_type !== 'incoming') {
    return;
  }

  if (body.private === true) {
    return;
  }

  const text = typeof body.content === 'string' ? body.content.trim() : '';
  if (text.length === 0) {
    return;
  }

  const conversation_id = body.conversation?.id;
  const account_id = body.account?.id;

  if (!conversation_id || !account_id) {
    return;
  }

  const sender_phone = body.sender?.phone_number;
  const sender_name = body.sender?.name;
  const sender_identifier = typeof sender_phone === 'string' && sender_phone.trim().length > 0
    ? sender_phone.trim()
    : typeof sender_name === 'string' && sender_name.trim().length > 0
    ? sender_name.trim()
    : `chatwoot_${conversation_id}`;

  try {
    const answer = await handleUserMessage(sender_identifier, text);
    await send_chatwoot_message(account_id, conversation_id, answer);
  } catch (error) {
    log_error_event(
      'CHATWOOT_WEBHOOK_PROCESSING_ERROR',
      error instanceof Error ? error.message : String(error),
      error instanceof Error ? error.stack : undefined,
      { conversation_id, account_id, sender_identifier }
    );
  }
}

router.get('/', (_req: Request, res: Response): void => {
  res.status(200).json({ status: 'ok' });
});

router.post('/', process_chatwoot_webhook);
router.post('/chatwoot', process_chatwoot_webhook);

export default router;
